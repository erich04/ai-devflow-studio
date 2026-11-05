import { lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { redactSensitiveText } from '@ai-devflow/shared'
import { atomicCodingFile, codingDigest, codingFilePath, codingRelativePath, snapshotCodingTree, type CodingCandidateWorkspace, type CodingRevision } from './coding-candidate-workspace'
import { codingDependencyPlan, prepareCodingDependencies } from './coding-dependency-preparation'
import { restoreCodingDependencySeed } from './coding-dependency-seed'
import type { CodingCommandPlan, CodingCommandRunner, CodingExecutionProfile } from './coding-command-runner'
import type { CodingVerificationResult } from './coding-evidence-v3'
import { fixtureTemplate, type FixtureTemplate } from './native-coding-fixture-cases'

export type ApprovedCodingTests = {
  version: 1
  sourceRef: string
  expectedTests: number
  files: Array<{ path: string; content: string; digest: string }>
  digest: string
}
export type ApprovedCodingVerification = {
  objectiveVersion: number
  sourceDigest: string
  baselineDigest: string
  tests: ApprovedCodingTests
}

export function freezeApprovedCodingTests(input: {
  sourceRef: string; expectedTests: number; files: Array<{ path: string; content: string }>
}): ApprovedCodingTests {
  const files = input.files.map(file => ({ path: file.path, content: file.content, digest: codingDigest(file.content) }))
    .sort((left, right) => left.path < right.path ? -1 : 1)
  const body = { version: 1 as const, sourceRef: input.sourceRef, expectedTests: input.expectedTests, files }
  return validateApprovedCodingTests({ ...body, digest: codingDigest(JSON.stringify(body)) })
}

export function validateApprovedCodingTests(value: ApprovedCodingTests): ApprovedCodingTests {
  if (!value || Object.keys(value).length !== 5 || value.version !== 1 || typeof value.sourceRef !== 'string' || !value.sourceRef.trim() || value.sourceRef.length > 1000 ||
      !Number.isSafeInteger(value.expectedTests) || value.expectedTests < 1 || value.expectedTests > 100000 ||
      !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 100 ||
      new Set(value.files.map(file => file?.path?.toLowerCase())).size !== value.files.length)
    throw new Error('Invalid approved test bundle')
  let bytes = 0
  for (const file of value.files) {
    if (!file || Object.keys(file).length !== 3 || typeof file.path !== 'string' || file.path.length > 500 || file.path.startsWith('-') || /[\u0000-\u001f\u007f]/u.test(file.path) || codingRelativePath(file.path) !== file.path ||
        file.path.split('/').some(part => ['.git', 'node_modules', '.cache', 'out', 'dist', '.next'].includes(part.toLowerCase())) ||
        !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file.path) || typeof file.content !== 'string' ||
        !file.content.trim() || file.content.includes('\0') || Buffer.byteLength(file.content) > 1024 * 1024 ||
        file.digest !== codingDigest(file.content)) throw new Error('Invalid approved test file')
    bytes += Buffer.byteLength(file.content)
  }
  if (bytes > 4 * 1024 * 1024) throw new Error('Approved test bundle exceeds capacity')
  const { digest, ...body } = value
  if (digest !== codingDigest(JSON.stringify(body))) throw new Error('Approved test bundle changed')
  return value
}

// The user-supplied tests own their runner configuration and pre-existing test
// inputs. This is also the original evaluation's protected-path policy.
function protectedTestInput(file: string) {
  return /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|pnpm-workspace\.yaml|\.npmrc|vitest[^/]*|vite\.config\.[^/]+|tsconfig[^/]*)$/u.test(file) || /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file)
}

type TestReport = {
  numTotalTests?: number; numPassedTests?: number; numFailedTests?: number
  numPendingTests?: number; numTodoTests?: number; numUnhandledErrors?: number
  testResults?: Array<{ name: string; status?: string; message?: string; assertionResults?: Array<{
    fullName?: string; status: string; failureMessages?: string[]
  }> }>
}

export function approvedCodingTestCommand(tests: ApprovedCodingTests, profile: CodingExecutionProfile, reportPath: string): CodingCommandPlan {
  return { executable: 'node',
    args: ['node_modules/vitest/vitest.mjs', 'run', ...tests.files.map(file => file.path), '--reporter=json', '--outputFile', reportPath],
    timeoutMs: 300000, profile }
}

function approvedFailureSource(fixture: FixtureTemplate | undefined, testName: string, messages: string[]): string {
  if (!fixture) return ''
  const diagnostic = messages.join('\n').replaceAll('\\', '/')
  const marker = `${fixture.path}:`
  const offset = diagnostic.indexOf(marker)
  const lineMatch = offset >= 0 ? diagnostic.slice(offset + marker.length).match(/^(\d+):\d+/u) : null
  const line = lineMatch ? Number(lineMatch[1]) - 1 : undefined
  const starts = fixture.tree.getLineStarts()
  const position = line === undefined ? undefined : starts[line]
  const anchor = fixture.anchors.find(item => position !== undefined && item.start <= position && position <= item.end)
    ?? fixture.anchors.find(item => testName.endsWith(item.title))
  const lines = fixture.source.split('\n')
  let first = anchor ? fixture.tree.getLineAndCharacterOfPosition(anchor.start).line : Math.max(0, (line ?? 0) - 24)
  let last = anchor ? fixture.tree.getLineAndCharacterOfPosition(anchor.end).line : Math.min(lines.length - 1, (line ?? 0) + 24)
  if (last - first > 80) {
    first = Math.max(first, (line ?? first) - 48)
    last = Math.min(last, first + 80)
  }
  const excerpt = lines.slice(first, last + 1).map((text, index) => `${first + index + 1} ${text}`).join('\n')
  return redactSensitiveText(`Approved fixed acceptance source ${fixture.path}, SHA-256 ${fixture.hash}\n${excerpt}`).value.slice(0, 6000)
}

/** Executes the approved contract against an exact revision in its own copy.
 * Concrete failures are authorized feedback. The external scorer remains a
 * separate observation of the eventual delivery. */
export async function runApprovedCodingVerification(input: {
  approved: ApprovedCodingVerification; workspace: CodingCandidateWorkspace; revision: CodingRevision
  runner: CodingCommandRunner; profile: CodingExecutionProfile; operationId: string; signal: AbortSignal
}): Promise<CodingVerificationResult> {
  const { approved, workspace, revision, runner, profile, signal } = input
  const tests = validateApprovedCodingTests(approved.tests)
  if (approved.baselineDigest !== workspace.identity.base.digest || approved.baselineDigest !== revision.base.digest ||
      approved.objectiveVersion !== revision.objectiveVersion) throw new Error('Approved test source changed')
  const directory = path.join(workspace.root, `approved-check-${codingDigest(input.operationId)}`)
  const reportPath = path.join(directory, '.devflow-approved-result.json')
  const logId = `${input.operationId}:approved-tests`
  signal.throwIfAborted()
  try {
    await workspace.materialize(revision.target, directory)
    const canonicalDirectory = await realpath(directory)
    for (const file of revision.base.files.filter(file => protectedTestInput(file.path))) {
      signal.throwIfAborted()
      await atomicCodingFile(await codingFilePath(directory, file.path, true), await workspace.blob(file.hash), file.mode)
    }
    for (const file of tests.files) {
      signal.throwIfAborted()
      await atomicCodingFile(await codingFilePath(directory, file.path, true), Buffer.from(file.content), 0o644)
    }
    const expected = await snapshotCodingTree(directory, revision.base.excludedPaths)
    const dependencies = await codingDependencyPlan(directory, profile, revision.base.excludedPaths, { isolatedStore: true })
    await restoreCodingDependencySeed({ workspace, directory, plan: dependencies, signal })
    await prepareCodingDependencies({ directory, profile, excludedPaths: revision.base.excludedPaths, runner,
      operationId: input.operationId, plan: dependencies, signal, final: true })
    await runner.start(logId, approvedCodingTestCommand(tests, profile, reportPath), directory, signal)
    const receipt = await runner.wait(logId)
    let report: TestReport | undefined, reportBytes: Buffer | undefined
    try {
      const safeReport = await codingFilePath(directory, '.devflow-approved-result.json')
      if ((await lstat(safeReport)).size > 32 * 1024 * 1024) throw new Error('Test report exceeds capacity')
      reportBytes = await readFile(safeReport); report = JSON.parse(reportBytes.toString()) as TestReport
    }
    catch { /* Missing or malformed reports fail acceptance. */ }
    await rm(reportPath, { force: true })
    const after = await snapshotCodingTree(directory, revision.base.excludedPaths)
    const clean = (message: string) => redactSensitiveText(stripVTControlCharacters(message)
      .replaceAll(canonicalDirectory, '<verification>').replaceAll(directory, '<verification>')).value.slice(0, 1200)
    // Resolve both ends. macOS /var aliases and Windows short temporary paths
    // may appear differently in the runner report and the workspace identity.
    const suites = await Promise.all((report?.testResults ?? []).map(async suite => {
      const absolute = path.resolve(directory, suite.name)
      const canonical = await realpath(absolute).catch(() => absolute)
      return { ...suite, file: path.relative(canonicalDirectory, canonical).split(path.sep).join('/') }
    }))
    const observed = new Set(suites.map(suite => suite.file))
    const failures: Array<{ file: string; test: string; message: string; sourceExcerpt?: string }> = suites.flatMap(suite => {
      const assertions = (suite.assertionResults ?? []).filter(test => test.status !== 'passed')
      const source = tests.files.find(file => file.path === suite.file)
      const fixture = source && (assertions.length || suite.status === 'failed') ? fixtureTemplate(source.path, source.content) : undefined
      const failed = assertions.map(test => ({ file: suite.file, test: clean(test.fullName ?? ''),
        message: clean((test.failureMessages ?? []).join('\n') || `Test status ${test.status}`),
        sourceExcerpt: approvedFailureSource(fixture, test.fullName ?? '', test.failureMessages ?? []) }))
      return failed.length ? failed : suite.status === 'failed' ? [{ file: suite.file, test: '', message: clean(suite.message ?? 'Test module failed'),
        sourceExcerpt: approvedFailureSource(fixture, '', [suite.message ?? '']) }] : []
    }).slice(0, 12)
    const missing = tests.files.filter(file => !observed.has(file.path))
    for (const file of missing.slice(0, 12)) failures.push({ file: file.path, test: '', message: 'The approved test file was not present in the runner report.' })
    if (after.digest !== expected.digest) failures.push({ file: '', test: '', message: 'The test execution changed its frozen source inputs.' })
    const passed = receipt.status === 'passed' && report?.numTotalTests === tests.expectedTests &&
      report.numPassedTests === tests.expectedTests && !report.numFailedTests && !report.numPendingTests &&
      !report.numTodoTests && !report.numUnhandledErrors && missing.length === 0 &&
      after.digest === expected.digest && failures.length === 0
    if (!passed && !failures.length) failures.push({ file: '', test: '', message: `Fixed acceptance did not pass. Runner ${receipt.status}; observed ${report?.numPassedTests ?? 0}/${report?.numTotalTests ?? 0}, expected ${tests.expectedTests}. Inspect the retained command log.` })
    const status = receipt.status === 'cancelled' || receipt.status === 'timed_out' ? receipt.status : passed ? 'passed' as const : 'failed' as const
    const evidence = { bundleDigest: tests.digest, sourceRef: tests.sourceRef, revisionDigest: revision.digest,
      expectedTests: tests.expectedTests, passedTests: report?.numPassedTests ?? 0, totalTests: report?.numTotalTests ?? 0,
      reportDigest: reportBytes ? codingDigest(reportBytes) : null, before: expected.digest, after: after.digest,
      status, failures }
    await mkdir(path.join(workspace.root, 'approved-results'), { recursive: true, mode: 0o700 })
    await atomicCodingFile(path.join(workspace.root, 'approved-results', `${codingDigest(input.operationId)}.json`), Buffer.from(JSON.stringify({ ...evidence, report })))
    return { exitCode: passed ? 0 : receipt.exitCode === 0 ? 1 : receipt.exitCode, status, logId,
      independentVerification: { planDigest: tests.digest, status, checkedCriteria: tests.files.filter(file => observed.has(file.path)).map(file => file.path),
        failedCriteria: passed ? [] : [...new Set(failures.map(failure => failure.file || 'approved-contract'))],
        failedRequirements: failures.map((failure, index) => ({ id: `approved-failure-${index + 1}`, sourceRef: tests.sourceRef,
          text: [failure.file, failure.test, failure.message, failure.sourceExcerpt].filter(Boolean).join('\n') })), approvedTests: evidence } }
  } finally {
    // wait() and cancellation finish the owned process before its copy is removed.
    await runner.cancelAll()
    await rm(directory, { recursive: true, force: true })
  }
}
