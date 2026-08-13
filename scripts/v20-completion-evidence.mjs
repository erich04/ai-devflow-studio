import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readBoundedUtf8FileSync } from './release-evidence-file.mjs'
import {
  evaluateV20CompletionRecord,
  parseV20EvaluationDataset,
  parseV20EvaluationRecord,
} from './v20-agent-runtime-evaluator.mjs'

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

export const v20CompletionEvidencePaths = Object.freeze({
  evaluation: 'docs/releases/v2.0.0/agent-runtime-evaluation.json',
  requiredGates: 'docs/releases/v2.0.0/required-gates.json',
})

export const v20CompletionSignoffFiles = Object.freeze([
  'README.md',
  'docs/plans/v2.0-native-agent-runtime.md',
  'docs/product/prd/v2.0-native-agent-runtime-prd.md',
  v20CompletionEvidencePaths.evaluation,
  v20CompletionEvidencePaths.requiredGates,
  'docs/roadmap.md',
])

function invalid() {
  throw new Error('v20_required_gates_invalid')
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isCanonicalIso(value) {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function hasZeroScanCounts(scans) {
  return hasExactKeys(scans, [
    'secretLeaks',
    'absolutePathLeaks',
    'sourceLeaks',
    'rawOutputLeaks',
    'isolationViolations',
  ]) && Object.values(scans).every(isNonNegativeInteger)
}

export function parseV20RequiredGates(value) {
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
    ]) ||
    value.schemaVersion !== 1 ||
    value.targetMilestone !== 'v2.0' ||
    !sha1Pattern.test(String(value.candidateSha)) ||
    value.status !== 'passed' ||
    !isCanonicalIso(value.recordedAt)
  ) invalid()

  const local = value.localMatrix
  if (
    !hasExactKeys(local, ['candidateSha', 'verify', 'evaluator', 'worktreeCleanAfter']) ||
    !sha1Pattern.test(String(local.candidateSha)) ||
    local.verify !== 'passed' ||
    local.evaluator !== 'passed' ||
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
    !Number.isSafeInteger(run.runId) ||
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
    !Number.isSafeInteger(artifact.archiveSizeBytes) ||
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
      'scenarioCount',
      'passedScenarioCount',
      'totalLatencyMs',
      'totalCostUsd',
      'totalHumanInterventions',
      'paidProviderCalls',
      'scans',
      'status',
    ]) ||
    evaluation.path !== v20CompletionEvidencePaths.evaluation ||
    evaluation.datasetId !== 'v2.0-native-agent-runtime-completion' ||
    evaluation.datasetVersion !== 1 ||
    !sha256Pattern.test(String(evaluation.datasetSha256)) ||
    !isNonNegativeInteger(evaluation.scenarioCount) ||
    !isNonNegativeInteger(evaluation.passedScenarioCount) ||
    !isNonNegativeInteger(evaluation.totalLatencyMs) ||
    !isNonNegativeNumber(evaluation.totalCostUsd) ||
    !isNonNegativeInteger(evaluation.totalHumanInterventions) ||
    !isNonNegativeInteger(evaluation.paidProviderCalls) ||
    !hasZeroScanCounts(evaluation.scans) ||
    evaluation.status !== 'passed'
  ) invalid()

  return value
}

function sameStringSet(actual, expected) {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== 'string')) return false
  const normalized = [...new Set(actual)].sort()
  const target = [...expected].sort()
  return normalized.length === actual.length &&
    normalized.length === target.length &&
    normalized.every((value, index) => value === target[index])
}

function evaluationSummary(record) {
  return {
    datasetId: record.datasetId,
    datasetVersion: record.datasetVersion,
    datasetSha256: record.datasetSha256,
    scenarioCount: record.scenarioResults.length,
    passedScenarioCount: record.scenarioResults.filter((result) => result.status === 'passed').length,
    totalLatencyMs: record.scenarioResults.reduce(
      (total, result) => total + result.observation.metrics.latencyMs,
      0,
    ),
    totalCostUsd: record.scenarioResults.reduce(
      (total, result) => total + result.observation.metrics.costUsd,
      0,
    ),
    totalHumanInterventions: record.scenarioResults.reduce(
      (total, result) => total + result.observation.metrics.humanInterventions,
      0,
    ),
    paidProviderCalls: record.paidProviderCalls,
    scans: record.scans,
    status: record.status,
  }
}

export function evaluateV20CompletionSignoff(input) {
  const datasetBytes = Buffer.from(input.datasetBytes)
  const dataset = parseV20EvaluationDataset(JSON.parse(datasetBytes.toString('utf8')))
  const record = parseV20EvaluationRecord(input.evaluationRecord)
  const gates = parseV20RequiredGates(input.requiredGates)
  const datasetSha256 = createHash('sha256').update(datasetBytes).digest('hex')
  const failures = []
  const add = (failure) => {
    if (!failures.includes(failure)) failures.push(failure)
  }

  if (
    !sha1Pattern.test(String(input.signoffSha)) ||
    !sha1Pattern.test(String(input.candidateSha)) ||
    input.signoffSha === input.candidateSha
  ) add('signoff_identity')
  if (input.signoffParentSha !== input.candidateSha) add('not_direct_child')
  if (!sameStringSet(input.changedFiles, v20CompletionSignoffFiles)) add('signoff_file_set')
  if (input.evidenceImmutable !== true) add('evidence_history_mismatch')
  if (input.worktreeClean !== true) add('worktree_dirty')

  if (
    record.candidateSha !== input.candidateSha ||
    gates.candidateSha !== input.candidateSha ||
    gates.localMatrix.candidateSha !== input.candidateSha ||
    gates.verifyRun.headSha !== input.candidateSha
  ) add('candidate_mismatch')

  const evaluation = evaluateV20CompletionRecord({
    dataset,
    record,
    expectedCandidateSha: input.candidateSha,
    expectedDatasetSha256: datasetSha256,
  })
  if (!evaluation.ready) add('evaluation_record')

  if (
    gates.verifyRun.runAttempt !== 1 ||
    gates.verifyRun.event !== 'workflow_dispatch' ||
    gates.verifyRun.conclusion !== 'success' ||
    !hasExactKeys(gates.verifyRun.jobs, expectedJobs) ||
    !Object.values(gates.verifyRun.jobs).every((status) => status === 'success')
  ) add('verify_run')

  const summary = evaluationSummary(record)
  const declared = gates.evaluation
  if (
    declared.datasetId !== summary.datasetId ||
    declared.datasetVersion !== summary.datasetVersion ||
    declared.datasetSha256 !== summary.datasetSha256 ||
    declared.scenarioCount !== summary.scenarioCount ||
    declared.passedScenarioCount !== summary.passedScenarioCount ||
    declared.totalLatencyMs !== summary.totalLatencyMs ||
    declared.totalCostUsd !== summary.totalCostUsd ||
    declared.totalHumanInterventions !== summary.totalHumanInterventions ||
    declared.paidProviderCalls !== summary.paidProviderCalls ||
    Object.keys(summary.scans).some((key) => declared.scans[key] !== summary.scans[key]) ||
    declared.status !== summary.status
  ) add('evaluation_summary')

  if (Date.parse(gates.recordedAt) < Date.parse(record.recordedAt)) add('recording_order')
  return { ready: failures.length === 0, failures }
}

function runGit(arguments_, cwd) {
  return execFileSync('git', arguments_, { cwd, encoding: 'utf8' }).trim()
}

function readGitBlob(commitSha, path, cwd) {
  const bytes = execFileSync('git', ['show', `${commitSha}:${path}`], {
    cwd,
    encoding: 'buffer',
    maxBuffer: 64 * 1024,
  })
  if (bytes.byteLength > 64 * 1024) throw new Error('v20_completion_evidence_unavailable')
  return bytes
}

function findV20SignoffSha(candidateSha, cwd) {
  const ancestry = runGit(
    ['rev-list', '--parents', '--ancestry-path', `${candidateSha}..HEAD`],
    cwd,
  )
  const directChildren = ancestry
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' '))
    .filter(([_commitSha, ...parentShas]) => parentShas.includes(candidateSha))
    .map(([commitSha]) => commitSha)
    .filter((commitSha) => {
      const changedFiles = runGit(
        ['diff', '--name-only', `${candidateSha}..${commitSha}`],
        cwd,
      ).split('\n').filter(Boolean)
      return sameStringSet(changedFiles, v20CompletionSignoffFiles)
    })
  if (directChildren.length !== 1) throw new Error('v20_completion_evidence_unavailable')
  return directChildren[0]
}

export function collectV20CompletionSignoff(cwd = process.cwd()) {
  const requiredGatesText = readBoundedUtf8FileSync(
    resolve(cwd, v20CompletionEvidencePaths.requiredGates),
  )
  const evaluationRecordText = readBoundedUtf8FileSync(
    resolve(cwd, v20CompletionEvidencePaths.evaluation),
  )
  const requiredGates = parseV20RequiredGates(JSON.parse(requiredGatesText))
  const candidateSha = requiredGates.candidateSha
  const signoffSha = findV20SignoffSha(candidateSha, cwd)
  const signoffParentSha = runGit(['rev-parse', `${signoffSha}^`], cwd)
  const changedFiles = runGit(['diff', '--name-only', `${candidateSha}..${signoffSha}`], cwd)
    .split('\n')
    .filter(Boolean)
  const worktreeClean = runGit(['status', '--porcelain=v1', '--untracked-files=all'], cwd) === ''
  const datasetBytes = readGitBlob(
    signoffSha,
    'scripts/fixtures/v2.0-agent-runtime-scenarios.json',
    cwd,
  )
  const evaluationRecordBytes = readGitBlob(
    signoffSha,
    v20CompletionEvidencePaths.evaluation,
    cwd,
  )
  const requiredGatesBytes = readGitBlob(
    signoffSha,
    v20CompletionEvidencePaths.requiredGates,
    cwd,
  )
  const headEvaluationRecordBytes = readGitBlob(
    'HEAD',
    v20CompletionEvidencePaths.evaluation,
    cwd,
  )
  const headRequiredGatesBytes = readGitBlob(
    'HEAD',
    v20CompletionEvidencePaths.requiredGates,
    cwd,
  )
  const currentEvidenceIsImmutable =
    evaluationRecordBytes.equals(headEvaluationRecordBytes) &&
    requiredGatesBytes.equals(headRequiredGatesBytes)
  const evaluationRecord = JSON.parse(evaluationRecordText)
  return {
    signoffSha,
    candidateSha,
    result: evaluateV20CompletionSignoff({
      datasetBytes,
      evaluationRecord,
      requiredGates,
      signoffSha,
      candidateSha,
      signoffParentSha,
      changedFiles,
      evidenceImmutable: currentEvidenceIsImmutable,
      worktreeClean,
    }),
  }
}

async function main() {
  try {
    const collected = collectV20CompletionSignoff()
    process.stdout.write(`${JSON.stringify({
      status: collected.result.ready ? 'passed' : 'failed',
      candidateSha: collected.candidateSha,
      signoffSha: collected.signoffSha,
      failures: collected.result.failures,
    })}\n`)
    if (!collected.result.ready) process.exitCode = 1
  } catch (error) {
    const code = error instanceof Error && /^v20_[a-z_]+$/u.test(error.message)
      ? error.message
      : 'v20_completion_evidence_unavailable'
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
