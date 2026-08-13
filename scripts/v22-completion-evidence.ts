import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  evaluateV22CompletionRecord,
  parseV22EvaluationRecord,
  type V22EvaluationRecord,
} from './v22-multi-agent-evaluator'
import {
  createV22ContractDigest,
  V22_EVALUATION_CONTRACT_PATHS,
} from './v22-multi-agent-evaluation-runner'

const sha1Pattern = /^[a-f0-9]{40}$/u
const sha256Pattern = /^[a-f0-9]{64}$/u
const runUrlPattern = /^https:\/\/github\.com\/erich04\/ai-devflow-studio\/actions\/runs\/[1-9][0-9]*$/u
const expectedJobs = [
  'Docker lifecycle smoke',
  'Docker smoke',
  'Postgres integration',
  'Windows compatibility',
  'macOS verify',
]

export const V22_COMPLETION_EVIDENCE_PATHS = Object.freeze({
  evaluation: 'docs/releases/v2.2.0/multi-agent-evaluation.json',
  requiredGates: 'docs/releases/v2.2.0/required-gates.json',
})

export const V22_COMPLETION_SIGNOFF_FILES = Object.freeze([
  'README.md',
  'docs/plans/v2.2-multi-agent-execution-tenancy.md',
  'docs/product/prd/v2.2-multi-agent-execution-tenancy-prd.md',
  V22_COMPLETION_EVIDENCE_PATHS.evaluation,
  V22_COMPLETION_EVIDENCE_PATHS.requiredGates,
  'docs/roadmap.md',
])

function invalid(): never {
  throw new Error('v22_required_gates_invalid')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasValidScanCounts(value: unknown): boolean {
  return hasExactKeys(value, [
    'secretLeaks',
    'absolutePathLeaks',
    'sourceContentLeaks',
    'rawOutputLeaks',
    'isolationViolations',
    'authorityViolations',
    'terminationViolations',
    'replayViolations',
    'redactionViolations',
  ]) && Object.values(value).every(isNonNegativeInteger)
}

export function parseV22RequiredGates(value: unknown) {
  if (
    !hasExactKeys(value, [
      'schemaVersion',
      'targetMilestone',
      'candidateSha',
      'status',
      'recordedAt',
      'localMatrix',
      'verifyRun',
      'desktopArtifact',
      'evaluation',
      'roadmapClosure',
    ]) ||
    value.schemaVersion !== 1 ||
    value.targetMilestone !== 'v2.2' ||
    !sha1Pattern.test(String(value.candidateSha)) ||
    value.status !== 'passed' ||
    !isCanonicalIso(value.recordedAt)
  ) invalid()

  const local = value.localMatrix
  if (
    !hasExactKeys(local, [
      'candidateSha',
      'verify',
      'evaluator',
      'postgres',
      'docker',
      'packagedDesktop',
      'singleAgentRegression',
      'worktreeCleanAfter',
    ]) ||
    !sha1Pattern.test(String(local.candidateSha)) ||
    ![
      'verify',
      'evaluator',
      'postgres',
      'docker',
      'packagedDesktop',
      'singleAgentRegression',
    ].every((key) => local[key] === 'passed') ||
    local.worktreeCleanAfter !== true
  ) invalid()

  const run = value.verifyRun
  if (
    !hasExactKeys(run, [
      'workflow',
      'event',
      'runId',
      'runAttempt',
      'url',
      'headSha',
      'conclusion',
      'jobs',
    ]) ||
    run.workflow !== 'Verify' ||
    run.event !== 'workflow_dispatch' ||
    !isNonNegativeInteger(run.runId) ||
    run.runId < 1 ||
    run.runAttempt !== 1 ||
    !runUrlPattern.test(String(run.url)) ||
    run.url !== `https://github.com/erich04/ai-devflow-studio/actions/runs/${run.runId}` ||
    !sha1Pattern.test(String(run.headSha)) ||
    run.conclusion !== 'success' ||
    !hasExactKeys(run.jobs, expectedJobs) ||
    !Object.values(run.jobs).every((status) => status === 'success')
  ) invalid()

  const artifact = value.desktopArtifact
  if (
    !hasExactKeys(artifact, [
      'name',
      'productVersion',
      'platform',
      'arch',
      'electronVersion',
      'archiveSha256',
      'archiveSizeBytes',
      'signed',
      'installer',
    ]) ||
    artifact.name !== 'ai-devflow-studio-v15-candidate-desktop' ||
    artifact.productVersion !== '1.5.0' ||
    artifact.platform !== 'darwin' ||
    artifact.arch !== 'arm64' ||
    artifact.electronVersion !== '33.4.11' ||
    !sha256Pattern.test(String(artifact.archiveSha256)) ||
    !isNonNegativeInteger(artifact.archiveSizeBytes) ||
    artifact.archiveSizeBytes < 1 ||
    artifact.signed !== false ||
    artifact.installer !== false
  ) invalid()

  const evaluation = value.evaluation
  if (
    !hasExactKeys(evaluation, [
      'path',
      'datasetId',
      'datasetVersion',
      'datasetSha256',
      'contractSha256',
      'coordinationContractVersion',
      'executionTenancyContractVersion',
      'scenarioCount',
      'aggregateSingleQuality',
      'aggregateMultiQuality',
      'aggregateImprovementOverSingle',
      'costMultiplierOverSingle',
      'latencyMultiplierOverSingle',
      'additionalHumanInterventions',
      'isolationViolations',
      'authorityViolations',
      'terminationViolations',
      'replayViolations',
      'redactionViolations',
      'paidProviderCalls',
      'scans',
      'status',
    ]) ||
    evaluation.path !== V22_COMPLETION_EVIDENCE_PATHS.evaluation ||
    evaluation.datasetId !== 'v2.2-multi-agent-execution-tenancy' ||
    evaluation.datasetVersion !== 1 ||
    !sha256Pattern.test(String(evaluation.datasetSha256)) ||
    !sha256Pattern.test(String(evaluation.contractSha256)) ||
    evaluation.coordinationContractVersion !== 1 ||
    evaluation.executionTenancyContractVersion !== 1 ||
    evaluation.scenarioCount !== 10 ||
    ![
      'aggregateSingleQuality',
      'aggregateMultiQuality',
      'aggregateImprovementOverSingle',
      'costMultiplierOverSingle',
      'latencyMultiplierOverSingle',
    ].every((key) => isFiniteNumber(evaluation[key])) ||
    ![
      'additionalHumanInterventions',
      'isolationViolations',
      'authorityViolations',
      'terminationViolations',
      'replayViolations',
      'redactionViolations',
      'paidProviderCalls',
    ].every((key) => isNonNegativeInteger(evaluation[key])) ||
    !hasValidScanCounts(evaluation.scans) ||
    evaluation.status !== 'passed'
  ) invalid()

  const closure = value.roadmapClosure
  if (
    !hasExactKeys(closure, ['versionLine', 'status', 'automaticNextMilestone']) ||
    closure.versionLine !== '2.x' ||
    closure.status !== 'completed' ||
    closure.automaticNextMilestone !== false
  ) invalid()
  return value
}

function sameStringSet(actual: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== 'string')) return false
  const normalized = [...new Set(actual)].sort()
  const target = [...expected].sort()
  return normalized.length === actual.length &&
    normalized.length === target.length &&
    normalized.every((value, index) => value === target[index])
}

function evaluationSummary(record: V22EvaluationRecord) {
  return {
    path: V22_COMPLETION_EVIDENCE_PATHS.evaluation,
    datasetId: record.datasetId,
    datasetVersion: record.datasetVersion,
    datasetSha256: record.datasetSha256,
    contractSha256: record.contractSha256,
    coordinationContractVersion: record.coordinationContractVersion,
    executionTenancyContractVersion: record.executionTenancyContractVersion,
    scenarioCount: record.scenarioResults.length,
    aggregateSingleQuality: record.candidate.aggregateSingleQuality,
    aggregateMultiQuality: record.candidate.aggregateMultiQuality,
    aggregateImprovementOverSingle: record.candidate.aggregateImprovementOverSingle,
    costMultiplierOverSingle: record.candidate.costMultiplierOverSingle,
    latencyMultiplierOverSingle: record.candidate.latencyMultiplierOverSingle,
    additionalHumanInterventions: record.candidate.additionalHumanInterventions,
    isolationViolations: record.candidate.isolationViolations,
    authorityViolations: record.candidate.authorityViolations,
    terminationViolations: record.candidate.terminationViolations,
    replayViolations: record.candidate.replayViolations,
    redactionViolations: record.candidate.redactionViolations,
    paidProviderCalls: record.paidProviderCalls,
    scans: record.scans,
    status: record.status,
  }
}

export function evaluateV22CompletionSignoff(input: {
  datasetBytes: Uint8Array
  evaluationRecord: unknown
  requiredGates: unknown
  signoffSha: string
  candidateSha: string
  signoffParentSha: string
  changedFiles: string[]
  evidenceImmutable: boolean
  worktreeClean: boolean
  expectedContractSha256?: string
}) {
  const record = parseV22EvaluationRecord(input.evaluationRecord)
  const gates = parseV22RequiredGates(input.requiredGates)
  const failures: string[] = []
  const add = (failure: string) => {
    if (!failures.includes(failure)) failures.push(failure)
  }
  if (
    !sha1Pattern.test(input.signoffSha) ||
    !sha1Pattern.test(input.candidateSha) ||
    input.signoffSha === input.candidateSha
  ) add('signoff_identity')
  if (input.signoffParentSha !== input.candidateSha) add('not_direct_child')
  if (!sameStringSet(input.changedFiles, V22_COMPLETION_SIGNOFF_FILES)) {
    add('signoff_file_set')
  }
  if (!input.evidenceImmutable) add('evidence_history_mismatch')
  if (!input.worktreeClean) add('worktree_dirty')
  if (
    record.candidateSha !== input.candidateSha ||
    gates.candidateSha !== input.candidateSha ||
    (gates.localMatrix as Record<string, unknown>).candidateSha !== input.candidateSha ||
    (gates.verifyRun as Record<string, unknown>).headSha !== input.candidateSha
  ) add('candidate_mismatch')

  const evaluation = evaluateV22CompletionRecord({
    datasetBytes: input.datasetBytes,
    record,
    expectedCandidateSha: input.candidateSha,
    expectedContractSha256: input.expectedContractSha256 ?? record.contractSha256,
  })
  if (!evaluation.ready) add('evaluation_record')
  if (
    JSON.stringify(gates.evaluation) !== JSON.stringify(evaluationSummary(record))
  ) add('evaluation_summary')
  if (Date.parse(String(gates.recordedAt)) < Date.parse(record.recordedAt)) {
    add('recording_order')
  }
  return { ready: failures.length === 0, failures }
}

function runGit(arguments_: string[], cwd: string): string {
  return execFileSync('git', arguments_, { cwd, encoding: 'utf8' }).trim()
}

function readGitBlob(commitSha: string, path: string, cwd: string): Buffer {
  const bytes = execFileSync('git', ['show', `${commitSha}:${path}`], {
    cwd,
    encoding: 'buffer',
    maxBuffer: 512 * 1024,
  })
  if (bytes.byteLength > 512 * 1024) throw new Error('v22_completion_evidence_unavailable')
  return bytes
}

function readBoundedFile(path: string): Buffer {
  const bytes = readFileSync(path)
  if (bytes.byteLength > 512 * 1024) throw new Error('v22_completion_evidence_unavailable')
  return bytes
}

function findV22SignoffSha(candidateSha: string, cwd: string): string {
  const ancestry = runGit(['rev-list', '--parents', '--ancestry-path', `${candidateSha}..HEAD`], cwd)
  const directChildren = ancestry.split('\n').filter(Boolean).map((line) => line.split(' '))
    .filter(([_commitSha, ...parentShas]) => parentShas.includes(candidateSha))
    .map(([commitSha]) => commitSha!)
    .filter((commitSha) => {
      const changedFiles = runGit(['diff', '--name-only', `${candidateSha}..${commitSha}`], cwd)
        .split('\n').filter(Boolean)
      return sameStringSet(changedFiles, V22_COMPLETION_SIGNOFF_FILES)
    })
  if (directChildren.length !== 1) throw new Error('v22_completion_evidence_unavailable')
  return directChildren[0]!
}

export function collectV22CompletionSignoff(cwd = process.cwd()) {
  const requiredGatesBytes = readBoundedFile(resolve(cwd, V22_COMPLETION_EVIDENCE_PATHS.requiredGates))
  const evaluationBytes = readBoundedFile(resolve(cwd, V22_COMPLETION_EVIDENCE_PATHS.evaluation))
  const requiredGates = parseV22RequiredGates(JSON.parse(requiredGatesBytes.toString('utf8')))
  const candidateSha = String(requiredGates.candidateSha)
  const signoffSha = findV22SignoffSha(candidateSha, cwd)
  const signoffParentSha = runGit(['rev-parse', `${signoffSha}^`], cwd)
  const changedFiles = runGit(['diff', '--name-only', `${candidateSha}..${signoffSha}`], cwd)
    .split('\n').filter(Boolean)
  const datasetBytes = readGitBlob(
    candidateSha,
    'scripts/fixtures/v2.2-multi-agent-evaluation.json',
    cwd,
  )
  const contractEntries = V22_EVALUATION_CONTRACT_PATHS.map((path) => ({
    path,
    bytes: readGitBlob(candidateSha, path, cwd),
  }))
  const expectedContractSha256 = createV22ContractDigest(contractEntries)
  const committedEvaluation = readGitBlob(signoffSha, V22_COMPLETION_EVIDENCE_PATHS.evaluation, cwd)
  const committedGates = readGitBlob(signoffSha, V22_COMPLETION_EVIDENCE_PATHS.requiredGates, cwd)
  const headEvaluation = readGitBlob('HEAD', V22_COMPLETION_EVIDENCE_PATHS.evaluation, cwd)
  const headGates = readGitBlob('HEAD', V22_COMPLETION_EVIDENCE_PATHS.requiredGates, cwd)
  const worktreeClean = runGit(['status', '--porcelain=v1', '--untracked-files=all'], cwd) === ''
  return {
    signoffSha,
    candidateSha,
    result: evaluateV22CompletionSignoff({
      datasetBytes,
      evaluationRecord: JSON.parse(evaluationBytes.toString('utf8')),
      requiredGates,
      signoffSha,
      candidateSha,
      signoffParentSha,
      changedFiles,
      evidenceImmutable:
        committedEvaluation.equals(headEvaluation) && committedGates.equals(headGates),
      worktreeClean,
      expectedContractSha256,
    }),
  }
}

async function main() {
  try {
    const collected = collectV22CompletionSignoff()
    process.stdout.write(`${JSON.stringify({
      status: collected.result.ready ? 'passed' : 'failed',
      candidateSha: collected.candidateSha,
      signoffSha: collected.signoffSha,
      failures: collected.result.failures,
    })}\n`)
    if (!collected.result.ready) process.exitCode = 1
  } catch (error) {
    const code = error instanceof Error && /^v22_[a-z_]+$/u.test(error.message)
      ? error.message
      : 'v22_completion_evidence_unavailable'
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main()
}
