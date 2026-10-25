/**
 * Finish PR validation from already completed coding, official tests and independently
 * rerun browser evidence. No coding/test replay and no remote delivery.
 * DEVFLOW_FULLCHAIN_LIVE=1 DEVFLOW_FULLCHAIN_CDP=http://127.0.0.1:<port>
 * DEVFLOW_FULLCHAIN_OUTPUT=<correction evidence directory>
 * DEVFLOW_FULLCHAIN_BROWSER_SHA256=<reviewed browser report digest>
 * corepack pnpm exec tsx scripts/hindsight-fullchain-pr-finish.mts
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { chromium, type Page } from '@playwright/test'
import type { LocalExecutionState, TestEvidence } from '../packages/shared/src/index.ts'
import type { CreatePrDraftResult, RunKnowledgeReviewResult } from '../apps/desktop/src/desktop-api.ts'
import { assertFullchainKnowledgeReceipt } from './hindsight-fullchain-electron.mts'
import { HINDSIGHT_TODO_KNOWLEDGE_PATHS } from './hindsight-todo-fixture.ts'
import type { HindsightTodoBrowserReport } from './hindsight-todo-browser-check.mts'

const execute = promisify(execFile)
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
async function main() {
  assert.equal(process.env.DEVFLOW_FULLCHAIN_LIVE, '1')
  assert(process.env.DEVFLOW_FULLCHAIN_OUTPUT && process.env.DEVFLOW_FULLCHAIN_BROWSER_SHA256)
  const output = path.resolve(process.env.DEVFLOW_FULLCHAIN_OUTPUT)
  const originalBytes = await readFile(path.join(output, 'report.json'))
  const prior = JSON.parse(originalBytes.toString())
  assert.equal(prior.evidence.coding.status, 'completed')
  const approved = JSON.parse(await readFile(path.join(output, 'pending-approval.json'), 'utf8'))
  assert.equal(approved.codingRunId, prior.evidence.coding.codingRunId)
  assert.equal((await readFile(path.join(output, 'approved-digest.txt'), 'utf8')).trim(), approved.changeSetDigest)
  const testsBytes = await readFile(path.join(output, 'tests.json'))
  const tests = JSON.parse(testsBytes.toString()) as TestEvidence
  assert.equal(tests.status, 'passed'); assert.equal(tests.exitCode, 0)
  assert.equal(tests.runId, prior.runId); assert.equal(tests.projectId, prior.projectId)
  const browserPath = path.resolve(process.env.DEVFLOW_FULLCHAIN_BROWSER_REPORT ??
    path.join(output, 'browser-rerun/browser-check-report.json'))
  const browserBytes = await readFile(browserPath)
  assert.equal(hash(browserBytes), process.env.DEVFLOW_FULLCHAIN_BROWSER_SHA256)
  const browserReport = JSON.parse(browserBytes.toString()) as HindsightTodoBrowserReport
  assert(browserReport.passed && browserReport.sourceBytesUnchanged)
  assert.equal(browserReport.engine, 'real-playwright-chromium')
  assert.equal(browserReport.checks.length, 16)
  assert.deepEqual(browserReport.sourceDigestsBefore, browserReport.sourceDigestsAfter)
  assert(browserReport.sourceDigestsAfter && Object.keys(browserReport.sourceDigestsAfter).length > 0)
  const managedPath = await realpath(prior.evidence.coding.workspace)
  assert.equal(browserReport.managedRepository, managedPath)
  assert.equal(browserReport.originalRepository, await realpath(prior.workspace.repoDir))
  const verifySource = async () => {
    const { stdout } = await execute('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: managedPath })
    const paths = [...new Set(stdout.split('\0').filter(Boolean))].sort()
    assert.deepEqual(paths, Object.keys(browserReport.sourceDigestsAfter!).sort())
    for (const file of paths) {
      const resolved = await realpath(path.join(managedPath, file))
      const relative = path.relative(managedPath, resolved)
      assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
      assert.equal(hash(await readFile(resolved)), browserReport.sourceDigestsAfter![file], `Changed browser-tested file: ${file}`)
    }
    for (const file of prior.evidence.coding.changedPaths as string[]) {
      assert(paths.includes(file))
      assert.deepEqual(await readFile(path.join(managedPath, file)),
        await readFile(path.join(output, 'generated', file)), `Changed exported coding artifact: ${file}`)
    }
  }
  await verifySource()
  const endpoint = new URL(process.env.DEVFLOW_FULLCHAIN_CDP ?? '')
  assert.equal(endpoint.protocol, 'http:')
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))
  assert(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash)
  const report: Record<string, any> = {
    startedAt: new Date().toISOString(), passed: false, output, runId: prior.runId, projectId: prior.projectId,
    workflowCompleted: false, deliveryPublished: false, steps: [],
    evidence: { inheritedWorkflow: prior.evidence.inheritedWorkflow, rejectedProposal: prior.evidence.rejectedProposal,
      coding: prior.evidence.coding, test: prior.evidence.test, browser: browserReport,
      referencedReports: [
        { path: path.join(output, 'report.json'), sha256: hash(originalBytes), retainsFailure: true },
        { path: path.join(output, 'tests.json'), sha256: hash(testsBytes) },
        { path: browserPath, sha256: hash(browserBytes) },
      ] },
  }
  const destination = path.join(output, 'final-report.json')
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  const save = () => writeFile(destination, `${JSON.stringify(report, null, 2)}\n`)
  const step = async (phase: string, details: Record<string, unknown> = {}) => {
    const entry = { phase, at: new Date().toISOString(), ...details }
    report.steps.push(entry); await save(); console.log(JSON.stringify(entry))
  }
  try {
    const connection = await chromium.connectOverCDP(endpoint.href)
    let page: Page | undefined
    for (const candidate of connection.contexts().flatMap((context) => context.pages())) {
      if (await candidate.evaluate(() => Boolean(window.aiDevFlowDesktop)).catch(() => false)) {
        assert(!page, 'More than one DevFlow renderer found'); page = candidate
      }
    }
    assert(page)
    const renderer = page
    const ipc = <T,>(method: string, input?: unknown): Promise<T> => renderer.evaluate(async ({ method, input }) => {
      const api = window.aiDevFlowDesktop as unknown as Record<string, (value?: unknown) => Promise<unknown>>
      if (typeof api[method] !== 'function') throw new Error(`Missing official IPC ${method}`)
      return api[method]!(input)
    }, { method, input }) as Promise<T>
    let state = await ipc<LocalExecutionState>('loadState')
    const coding = state.codingRuns.find((item) => item.id === prior.evidence.coding.codingRunId)
    assert(coding && coding.runId === prior.runId && coding.projectId === prior.projectId)
    assert.equal(coding.status, 'completed')
    assert(state.codingPermissionRequests.some((item) => item.id === approved.permissionId &&
      item.codingRunId === coding.id && item.status === 'approved' &&
      item.changeSetDigest === approved.changeSetDigest))
    assert.deepEqual(coding.changedPaths, prior.evidence.coding.changedPaths)
    const managed = state.managedCodingWorkspaces.find((item) => item.codingRunId === coding.id)
    assert(managed && managed.id === tests.sourceTree?.workspaceId)
    assert.equal(await realpath(managed.worktreePath), managedPath)
    assert.deepEqual(state.testEvidence.find((item) => item.id === tests.id), tests)
    assert(state.testEvidence.some((item) => item.id === coding.testEvidenceId && item.status === 'passed' && item.exitCode === 0))
    const run = state.runs.find((item) => item.id === prior.runId)
    assert(run && run.projectId === prior.projectId)
    const pr = run.nodes.find((node) => node.id === run.currentNodeId)
    const accept = run.nodes.find((node) => node.stage === 'accept')
    assert(pr && pr.stage === 'pr' && accept)
    assert.equal(run.pullRequestUrl, undefined)
    assert.equal(tests.nodeId, run.nodes.find((node) => node.kind === 'test')?.id)
    const receipt = async (phase: string, value: unknown, stage: string) => {
      report.evidence[phase] = await assertFullchainKnowledgeReceipt(value, {
        stage, projectId: prior.projectId, repositoryPath: prior.workspace.repoDir,
        selectedPaths: [...HINDSIGHT_TODO_KNOWLEDGE_PATHS],
      })
    }
    await receipt('coding-receipt', coding.contextReceipt, 'build')
    await receipt('test', tests, 'test')
    await step('existing-evidence:verified', { codingRunId: coding.id, testEvidenceId: tests.id,
      browserChecks: browserReport.checks.length, sourceFiles: Object.keys(browserReport.sourceDigestsAfter!).length })
    const draft = await ipc<CreatePrDraftResult>('createPrDraft', { runId: run.id, nodeId: pr.id })
    assert.equal(draft.artifact.kind, 'pr')
    assert.equal(draft.run.pullRequestUrl, undefined)
    report.evidence['pr-package'] = { artifactId: draft.artifact.id, modelCall: false,
      source: 'trusted-coding-diff-and-test-evidence' }
    await writeFile(path.join(output, 'pr-package.md'), draft.artifact.content, { flag: 'wx' })
    await step('pr-review:started')
    const reviewed = await ipc<RunKnowledgeReviewResult>('runKnowledgeReview', {
      runId: run.id, nodeId: pr.id, projectId: prior.projectId, requestedBy: 'u-erich',
      runtime: 'electron', providerId: coding.providerId,
    })
    assert(reviewed.review?.id)
    await receipt('pr-review', reviewed.review, 'pr')
    report.evidence['pr-review-outcome'] = {
      conclusion: reviewed.review.conclusion,
      advisory: reviewed.review.gateAdvisory,
      businessApprovalGranted: false,
      note: 'A successful invocation and verified knowledge receipt do not mean the PR satisfies business delivery requirements.',
    }
    await writeFile(path.join(output, 'pr-review.json'), `${JSON.stringify(reviewed.review, null, 2)}\n`, { flag: 'wx' })
    await step('pr-review:complete', { reviewId: reviewed.review.id })
    await assert.rejects(() => ipc('runKnowledgeReview', {
      runId: run.id, nodeId: accept.id, projectId: prior.projectId, requestedBy: 'u-erich',
      runtime: 'electron', providerId: coding.providerId,
    }), /只能针对当前 Gate、PR 交付或 Acceptance 节点运行/u)
    report.evidence.acceptanceElectronBoundary = { status: 'correctly-blocked-before-delivery',
      knowledgeReceiptVerified: false, requiredAdditionalEvidence: 'Separate public runtime integration evidence covers Acceptance knowledge delivery.' }
    state = await ipc<LocalExecutionState>('loadState')
    const final = state.runs.find((item) => item.id === run.id)
    assert.equal(final?.pullRequestUrl, undefined)
    assert.equal(final?.currentNodeId, pr.id)
    await verifySource()
    report.workflowCompleted = final?.status === 'completed'
    report.evidence.workflowBoundary = { status: final?.status, currentNodeId: final?.currentNodeId,
      note: 'Actual upstream, corrected coding, tests and browser evidence were reused. PR knowledge was reviewed; Acceptance remains blocked before remote delivery.' }
    await renderer.reload(); await renderer.waitForLoadState('domcontentloaded')
    await renderer.screenshot({ path: path.join(output, 'desktop-final.png'), scale: 'css' })
    report.passed = true
    report.passScope = 'Knowledge integration, existing coding/test/browser evidence, and the pre-delivery Acceptance boundary; not PR business approval or remote delivery.'
    await step('electron-available-phases:passed', { deliveryPublished: false, workflowCompleted: report.workflowCompleted })
  } catch (error) {
    report.failure = error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000)
    await step('pr-continuation:failed', { reason: report.failure })
  } finally {
    report.finishedAt = new Date().toISOString(); await save()
  }
  return report
}
const result = await main()
console.log(JSON.stringify({ passed: result.passed, output: result.output, failure: result.failure }))
// End only this CDP client, never send Browser.close to the existing Electron process.
process.exit(result.passed ? 0 : 1)
