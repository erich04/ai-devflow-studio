import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { inspectDesktopArtifactTrioSync } from './desktop-artifact-trio.mjs'
import {
  readBoundedJsonFileSync,
  readBoundedUtf8FileSync,
  ReleaseEvidenceFileError,
} from './release-evidence-file.mjs'

const rootPackagePath = 'package.json'
const defaultDesktopArtifactIndexPath = 'out/desktop-pilot/artifact-index.json'
const releaseModes = new Set(['pre-tag', 'tagged'])

export const packagePaths = [
  'package.json',
  'packages/shared/package.json',
  'apps/desktop/package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/worker/package.json',
]

export const requiredDocPaths = [
  'docs/plans/v1.3-closeout-execution-2026-07-31.md',
  'docs/plans/v1.3-delivery-flow-completion.md',
  'docs/guides/devflow-studio-v1.3-walkthrough.md',
  'docs/plans/release-only-real-opencode-smoke.md',
]

export const requiredGateIds = [
  'verify',
  'windows-compatibility',
  'e2e',
  'electron-smoke',
  'postgres-smoke',
  'docker-smoke',
  'build',
  'build-output-smoke',
]

const realOpencodeEvidence = {
  kind: 'real-opencode',
  pathKey: 'realOpencode',
  snapshotKey: 'realOpencodeRecord',
  fileName: 'real-opencode.json',
  envName: 'DEVFLOW_RELEASE_OPENCODE_RECORD',
}

const githubSandboxEvidence = {
  kind: 'github-sandbox',
  pathKey: 'githubSandbox',
  snapshotKey: 'githubSandboxRecord',
  fileName: 'github-sandbox.json',
  envName: 'DEVFLOW_RELEASE_GITHUB_SANDBOX_RECORD',
  canonicalSignoffPaths: true,
}

const releaseProfiles = {
  '1.3': {
    requiredDocPaths,
    requiredGateIds,
    evidence: realOpencodeEvidence,
  },
  '1.4': {
    requiredDocPaths: [
      'docs/product/prd/v1.4-pilot-trust-boundary-prd.md',
      'docs/plans/v1.4-pilot-trust-boundary.md',
      'docs/plans/v1.4-release-signoff.md',
      'docs/guides/devflow-studio-v1.4-walkthrough.md',
      'docs/plans/release-only-real-opencode-smoke.md',
    ],
    requiredGateIds: [
      'verify',
      'windows-compatibility',
      'e2e',
      'electron-smoke',
      'postgres-smoke',
      'docker-smoke',
      'docker-lifecycle-smoke',
      'build',
      'build-output-smoke',
      'desktop-pilot-build',
      'desktop-pilot-smoke',
    ],
    realOpencodeControls: {
      attemptCount: 1,
      automaticRetry: false,
      costCapUsd: null,
      releaseProfile: 'v1.4',
      providerApiMode: 'responses',
      resolvedConfigPreflight: 'passed',
      opencodeVersion: '1.18.15',
      provider: 'double',
      model: 'ark-code-latest',
      keyEnvName: 'ANTHROPIC_AUTH_TOKEN',
      providerRetryObserved: false,
      permissionRelay: 'bash -> edit',
      diffEvidence: ['devflow-opencode-smoke.txt'],
    },
    evidence: realOpencodeEvidence,
  },
  '1.5': {
    requiredDocPaths: [
      'docs/product/prd/v1.5-github-delivery-prd.md',
      'docs/plans/v1.5-github-delivery.md',
      'docs/adr/0013-github-app-delivery-authority.md',
      'docs/guides/devflow-studio-v1.5-walkthrough.md',
      'docs/guides/devflow-studio-self-hosted-pilot.md',
    ],
    requiredGateIds: [
      'verify',
      'windows-compatibility',
      'v15-github-delivery-deterministic',
      'e2e',
      'electron-smoke',
      'postgres-smoke',
      'docker-smoke',
      'docker-lifecycle-smoke',
      'build',
      'build-output-smoke',
      'desktop-pilot-build',
      'desktop-pilot-smoke',
      'v15-github-delivery-packaged-smoke',
      'github-sandbox-draft-pr',
    ],
    evidence: githubSandboxEvidence,
  },
}

function releaseSeriesFor(targetVersion) {
  if (typeof targetVersion !== 'string') {
    return null
  }

  const match = /^(\d+)\.(\d+)\.\d+$/.exec(targetVersion.trim())
  return match ? `${match[1]}.${match[2]}` : null
}

export function releaseProfileFor(targetVersion) {
  const releaseSeries = releaseSeriesFor(targetVersion)
  return releaseSeries ? (releaseProfiles[releaseSeries] ?? null) : null
}

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function readPackageVersion(path) {
  if (!existsSync(path)) {
    return null
  }

  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw)
  return parsed.version ?? null
}

function resolveTargetVersion(env = process.env) {
  const envVersion = env.DEVFLOW_RELEASE_TARGET_VERSION?.trim()
  return envVersion || readPackageVersion(rootPackagePath)
}

export function parseReleaseMode(args) {
  const inlineModes = args
    .filter((arg) => arg.startsWith('--mode='))
    .map((arg) => arg.slice('--mode='.length))
  const separateModeIndex = args.indexOf('--mode')
  const separateModes =
    separateModeIndex === -1 || separateModeIndex === args.length - 1
      ? []
      : [args[separateModeIndex + 1]]
  const modes = [...inlineModes, ...separateModes]

  if (modes.length !== 1 || !releaseModes.has(modes[0])) {
    throw new Error('Specify exactly one release mode: --mode=pre-tag|tagged.')
  }

  return modes[0]
}

export function releaseEvidencePaths(targetVersion, env = process.env) {
  const releaseDir = `docs/releases/v${targetVersion}`
  const profile = releaseProfileFor(targetVersion)
  const evidence = profile?.evidence ?? realOpencodeEvidence

  if (
    evidence.canonicalSignoffPaths === true &&
    [
      env.DEVFLOW_RELEASE_WALKTHROUGH_RECORD,
      env.DEVFLOW_RELEASE_GATE_RECORD,
      env[evidence.envName],
    ].some((value) => typeof value === 'string' && value.trim().length > 0)
  ) {
    throw new Error('noncanonical_v15_evidence_path')
  }

  return {
    walkthrough:
      env.DEVFLOW_RELEASE_WALKTHROUGH_RECORD?.trim() || `${releaseDir}/walkthrough.json`,
    requiredGates:
      env.DEVFLOW_RELEASE_GATE_RECORD?.trim() || `${releaseDir}/required-gates.json`,
    [evidence.pathKey]:
      env[evidence.envName]?.trim() || `${releaseDir}/${evidence.fileName}`,
  }
}

function readEvidenceRecord(path) {
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      parseError: null,
      value: null,
    }
  }

  try {
    const parsed = readBoundedJsonFileSync(path)
    return {
      path,
      exists: true,
      parseError: null,
      value: parsed,
    }
  } catch (error) {
    return {
      path,
      exists: true,
      parseError:
        error instanceof ReleaseEvidenceFileError
          ? error.code
          : 'RELEASE_EVIDENCE_FILE_READ_FAILED',
      value: null,
    }
  }
}

function nullDesktopArtifactEvidence(indexPath, exists, parseError) {
  return {
    indexPath,
    exists,
    parseError,
    version: null,
    platform: null,
    declaredSha256: null,
    actualSha256: null,
  }
}

export function collectDesktopArtifactEvidence(
  indexPath = defaultDesktopArtifactIndexPath,
) {
  if (!existsSync(indexPath)) {
    return nullDesktopArtifactEvidence(indexPath, false, null)
  }

  try {
    const artifact = inspectDesktopArtifactTrioSync(indexPath)
    return {
      indexPath,
      exists: true,
      parseError: null,
      version: artifact.version,
      platform: `${artifact.platform}-${artifact.arch}`,
      declaredSha256: artifact.archiveSha256,
      actualSha256: artifact.archiveSha256,
    }
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : ''
    const parseError = code === 'artifact_digest_mismatch'
      ? 'artifact_digest_mismatch'
      : code.startsWith('artifact_manifest') || code === 'artifact_names_not_bound'
        ? 'invalid_artifact_manifest'
        : code.startsWith('artifact_archive')
          ? 'invalid_artifact_archive'
          : 'invalid_artifact_index'
    return nullDesktopArtifactEvidence(indexPath, true, parseError)
  }
}

function collectWalkthroughEvidence(path) {
  const record = readEvidenceRecord(path)
  const evidencePath = record.value?.evidencePath

  if (typeof evidencePath !== 'string') {
    return {
      ...record,
      referencedEvidenceExists: false,
      referencedEvidenceContent: null,
      referencedEvidenceReadError: null,
    }
  }

  const releaseSeries = releaseSeriesFor(record.value?.targetVersion)
  const date = record.value?.date
  const expectedPath =
    typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && releaseSeries
      ? `docs/guides/devflow-studio-v${releaseSeries}-walkthrough-result-${date}.md`
      : null
  if (expectedPath === null || evidencePath !== expectedPath) {
    return {
      ...record,
      referencedEvidenceExists: false,
      referencedEvidenceContent: null,
      referencedEvidenceReadError: null,
    }
  }

  if (!existsSync(evidencePath)) {
    return {
      ...record,
      referencedEvidenceExists: false,
      referencedEvidenceContent: null,
      referencedEvidenceReadError: null,
    }
  }

  try {
    return {
      ...record,
      referencedEvidenceExists: true,
      referencedEvidenceContent: readBoundedUtf8FileSync(
        evidencePath,
        128 * 1024,
      ),
      referencedEvidenceReadError: null,
    }
  } catch (error) {
    return {
      ...record,
      referencedEvidenceExists: true,
      referencedEvidenceContent: null,
      referencedEvidenceReadError:
        error instanceof ReleaseEvidenceFileError
          ? 'walkthrough_result_unsafe'
          : 'walkthrough_result_unreadable',
    }
  }
}

export function collectReleaseSignoffSnapshot(mode, env = process.env) {
  if (!releaseModes.has(mode)) {
    throw new Error('Release snapshot mode must be pre-tag or tagged.')
  }

  const targetVersion = resolveTargetVersion(env)
  const releaseProfile = releaseProfileFor(targetVersion)
  const releaseEvidence = releaseProfile?.evidence ?? realOpencodeEvidence
  const packageVersions = Object.fromEntries(
    packagePaths.map((path) => [path, readPackageVersion(path)]),
  )
  const requiredDocs = Object.fromEntries(
    (releaseProfile?.requiredDocPaths ?? []).map((path) => [path, existsSync(path)]),
  )
  const status = runGit(['status', '--short'])
  const currentBranch = runGit(['branch', '--show-current'])
  const headSha = runGit(['rev-parse', 'HEAD'])
  let candidateSha = null
  let changedFilesFromCandidate = null
  try {
    candidateSha = runGit(['rev-parse', 'HEAD^1'])
    const changedFiles = runGit([
      'diff',
      '--name-only',
      '--diff-filter=ACDMRTUXB',
      `${candidateSha}..${headSha}`,
    ])
    changedFilesFromCandidate = changedFiles ? changedFiles.split('\n') : []
  } catch {
    candidateSha = null
    changedFilesFromCandidate = null
  }
  const evidencePaths = releaseEvidencePaths(targetVersion, env)
  const desktopArtifactIndexPath =
    env.DEVFLOW_RELEASE_DESKTOP_ARTIFACT_INDEX?.trim() ||
    defaultDesktopArtifactIndexPath

  let releaseTagExists = false
  let releaseTagTarget = null
  let releaseTagObjectType = null
  try {
    const releaseTag = `v${targetVersion}`
    releaseTagExists = runGit(['tag', '--list', releaseTag]) === releaseTag
    if (releaseTagExists) {
      releaseTagTarget = runGit(['rev-list', '-n', '1', releaseTag])
      releaseTagObjectType = runGit(['cat-file', '-t', `refs/tags/${releaseTag}`])
    }
  } catch {
    releaseTagExists = false
    releaseTagTarget = null
    releaseTagObjectType = null
  }

  return {
    mode,
    targetVersion,
    headSha,
    candidateSha,
    changedFilesFromCandidate,
    packageVersions,
    requiredDocs,
    workingTreeClean: status.length === 0,
    currentBranch,
    releaseTagExists,
    releaseTagTarget,
    releaseTagObjectType,
    desktopArtifactEvidence: collectDesktopArtifactEvidence(desktopArtifactIndexPath),
    walkthroughEvidence: collectWalkthroughEvidence(evidencePaths.walkthrough),
    requiredGateRecord: readEvidenceRecord(evidencePaths.requiredGates),
    [releaseEvidence.snapshotKey]: readEvidenceRecord(
      evidencePaths[releaseEvidence.pathKey],
    ),
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) {
    return false
  }
  const actualKeys = Object.keys(value)
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  )
}

const v15WalkthroughKeys = [
  'targetVersion',
  'candidateSha',
  'status',
  'date',
  'method',
  'evidencePath',
]

const v15RequiredGateKeys = [
  'targetVersion',
  'candidateSha',
  'status',
  'recordedAt',
  'gates',
  'localMatrix',
  'verifyRun',
  'desktopArtifact',
]

const v15GitHubSandboxKeys = [
  'targetVersion',
  'candidateSha',
  'status',
  'recordedAt',
  'repository',
  'repositoryVisibility',
  'appSlug',
  'installationIdSuffix',
  'repositoryIdSuffix',
  'bindingVersion',
  'deliverySeriesKey',
  'deliveryAttempt',
  'intentRevision',
  'intentDigest',
  'runVersion',
  'testEvidenceDigest',
  'prPackageDigest',
  'expectedCommitSha',
  'remoteHeadSha',
  'baseBranch',
  'headBranch',
  'pullRequestNumber',
  'pullRequestUrl',
  'draft',
  'merged',
  'approvalRole',
  'approvalAuthKind',
  'workRequestCount',
  'canonicalRunCount',
  'credentialGrantCount',
  'branchPublicationCount',
  'draftPullRequestCount',
  'automaticRetry',
  'acceptanceStatus',
  'restartRecovery',
  'bindingRevocation',
  'postRevocationGrant',
  'redactionCheck',
  'cleanup',
  'cleanupMethod',
  'operatorRole',
  'adHocMaintainerAssistance',
]

function v15EvidenceShapeIssue(snapshot, kind, value) {
  if (releaseSeriesFor(snapshot.targetVersion) !== '1.5') {
    return null
  }
  const profileGateIds = releaseProfileFor(snapshot.targetVersion)?.requiredGateIds ?? []
  const expectedJobs = [
    'macOS verify',
    'Windows compatibility',
    'Postgres integration',
    'Docker smoke',
    'Docker lifecycle smoke',
  ]
  const valid =
    kind === 'walkthrough'
      ? hasExactKeys(value, v15WalkthroughKeys)
      : kind === 'required-gates'
        ? hasExactKeys(value, v15RequiredGateKeys) &&
          hasExactKeys(value.gates, profileGateIds) &&
          hasExactKeys(value.localMatrix, [
            'candidateSha',
            'result',
            'worktreeCleanAfter',
          ]) &&
          hasExactKeys(value.verifyRun, [
            'workflow',
            'event',
            'runId',
            'runAttempt',
            'url',
            'headSha',
            'conclusion',
            'jobs',
          ]) &&
          hasExactKeys(value.verifyRun?.jobs, expectedJobs) &&
          hasExactKeys(value.desktopArtifact, ['version', 'platform', 'sha256'])
        : hasExactKeys(value, v15GitHubSandboxKeys)
  return valid ? null : `Unexpected or missing fields in the v1.5 ${kind} evidence.`
}

function evidenceBaseState(record, snapshot) {
  if (!record.exists) {
    return {
      state: 'pending',
      detail: 'Missing required evidence record.',
    }
  }

  if (record.parseError || !isRecord(record.value)) {
    return {
      state: 'attention',
      detail: 'Invalid bounded evidence record.',
    }
  }

  if (record.value.targetVersion !== snapshot.targetVersion) {
    return {
      state: 'attention',
      detail: `${record.path} targets a different release version; expected ${snapshot.targetVersion}.`,
    }
  }

  if (record.value.candidateSha !== snapshot.candidateSha) {
    return {
      state: 'attention',
      detail: `${record.path} is not bound to candidate ${snapshot.candidateSha ?? 'S^1 (unavailable)'}.`,
    }
  }

  if (record.value.status === 'pending') {
    return {
      state: 'pending',
      detail: `${record.path} is recorded as pending.`,
    }
  }

  if (record.value.status !== 'passed') {
    return {
      state: 'attention',
      detail: `${record.path} is not recorded as passed.`,
    }
  }

  return null
}

function evaluateWalkthroughEvidence(snapshot) {
  const baseState = evidenceBaseState(snapshot.walkthroughEvidence, snapshot)
  if (baseState) {
    return {
      id: 'dated-walkthrough',
      label: 'Dated Computer Use walkthrough',
      ...baseState,
    }
  }

  const value = snapshot.walkthroughEvidence.value
  const safetyIssue = evidenceSafetyIssue(
    snapshot.walkthroughEvidence.path,
    value,
  )
  if (safetyIssue) {
    return {
      id: 'dated-walkthrough',
      label: 'Dated Computer Use walkthrough',
      state: 'attention',
      detail: safetyIssue,
    }
  }
  const shapeIssue = v15EvidenceShapeIssue(snapshot, 'walkthrough', value)
  if (shapeIssue) {
    return {
      id: 'dated-walkthrough',
      label: 'Dated Computer Use walkthrough',
      state: 'attention',
      detail: shapeIssue,
    }
  }
  const releaseSeries = releaseSeriesFor(snapshot.targetVersion)
  const expectedPath = `docs/guides/devflow-studio-v${releaseSeries ?? 'unknown'}-walkthrough-result-${value.date}.md`
  const validDate = typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
  const validEvidence =
    validDate &&
    value.method === 'computer-use' &&
    value.evidencePath === expectedPath &&
    snapshot.walkthroughEvidence.referencedEvidenceExists === true &&
    snapshot.walkthroughEvidence.referencedEvidenceReadError === null &&
    (releaseSeries !== '1.5' ||
      isValidV15WalkthroughContent(
        snapshot.walkthroughEvidence.referencedEvidenceContent,
        snapshot,
      ))

  return {
    id: 'dated-walkthrough',
    label: 'Dated Computer Use walkthrough',
    state: validEvidence ? 'ready' : 'attention',
    detail: validEvidence
      ? `${value.evidencePath} passed for ${snapshot.candidateSha}.`
      : `Walkthrough record must name an existing dated v${releaseSeries ?? 'unknown'} Computer Use result for ${snapshot.candidateSha}.`,
  }
}

function evaluateRequiredGateRecord(snapshot) {
  const baseState = evidenceBaseState(snapshot.requiredGateRecord, snapshot)
  if (baseState) {
    return {
      id: 'required-gates',
      label: 'Required deterministic gates',
      ...baseState,
    }
  }

  const value = snapshot.requiredGateRecord.value
  const safetyIssue = evidenceSafetyIssue(snapshot.requiredGateRecord.path, value)
  if (safetyIssue) {
    return {
      id: 'required-gates',
      label: 'Required deterministic gates',
      state: 'attention',
      detail: safetyIssue,
    }
  }
  const shapeIssue = v15EvidenceShapeIssue(snapshot, 'required-gates', value)
  if (shapeIssue) {
    return {
      id: 'required-gates',
      label: 'Required deterministic gates',
      state: 'attention',
      detail: shapeIssue,
    }
  }
  const gates = value.gates
  const profileGateIds = releaseProfileFor(snapshot.targetVersion)?.requiredGateIds ?? []
  const missingOrFailed =
    isRecord(gates) === false
      ? profileGateIds
      : profileGateIds.filter((gate) => gates[gate] !== 'passed')

  const v15MetadataValid =
    releaseSeriesFor(snapshot.targetVersion) !== '1.5' ||
    isValidV15GateMetadata(value, snapshot)
  return {
    id: 'required-gates',
    label: 'Required deterministic gates',
    state: missingOrFailed.length === 0 && v15MetadataValid ? 'ready' : 'attention',
    detail:
      missingOrFailed.length > 0
        ? `Missing or non-passing gates: ${missingOrFailed.join(', ')}.`
        : v15MetadataValid
        ? `All required gates passed for ${snapshot.candidateSha}.`
        : `${snapshot.requiredGateRecord.path} must bind the clean local matrix, exact-SHA Verify run, and packaged Desktop artifact digest to ${snapshot.candidateSha}.`,
  }
}

function isValidV15GateMetadata(value, snapshot) {
  const localMatrix = value.localMatrix
  const verifyRun = value.verifyRun
  const desktopArtifact = value.desktopArtifact
  const collectedArtifact = snapshot.desktopArtifactEvidence
  const verifyRunUrlMatch =
    typeof verifyRun?.url === 'string'
      ? /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/([1-9]\d*)$/.exec(
          verifyRun.url,
        )
      : null
  const expectedJobs = [
    'macOS verify',
    'Windows compatibility',
    'Postgres integration',
    'Docker smoke',
    'Docker lifecycle smoke',
  ]
  return (
    isNonEmptyString(value.recordedAt) &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    isRecord(localMatrix) &&
    localMatrix.candidateSha === snapshot.candidateSha &&
    localMatrix.result === 'passed' &&
    localMatrix.worktreeCleanAfter === true &&
    isRecord(verifyRun) &&
    verifyRun.workflow === 'Verify' &&
    verifyRun.event === 'workflow_dispatch' &&
    Number.isSafeInteger(verifyRun.runId) &&
    verifyRun.runId > 0 &&
    verifyRun.runAttempt === 1 &&
    verifyRunUrlMatch?.[1] === String(verifyRun.runId) &&
    verifyRun.headSha === snapshot.candidateSha &&
    verifyRun.conclusion === 'success' &&
    isRecord(verifyRun.jobs) &&
    expectedJobs.every((job) => verifyRun.jobs[job] === 'success') &&
    isRecord(desktopArtifact) &&
    desktopArtifact.version === snapshot.targetVersion &&
    typeof desktopArtifact.platform === 'string' &&
    /^(?:darwin|linux|win32)-(?:arm64|x64)$/.test(desktopArtifact.platform) &&
    typeof desktopArtifact.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(desktopArtifact.sha256) &&
    isRecord(collectedArtifact) &&
    collectedArtifact.exists === true &&
    collectedArtifact.parseError === null &&
    collectedArtifact.version === desktopArtifact.version &&
    collectedArtifact.platform === desktopArtifact.platform &&
    collectedArtifact.declaredSha256 === desktopArtifact.sha256 &&
    collectedArtifact.actualSha256 === desktopArtifact.sha256
  )
}

function findForbiddenEvidenceFields(value, parentPath = '') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findForbiddenEvidenceFields(item, `${parentPath}[${index}]`),
    )
  }

  if (!isRecord(value)) {
    return []
  }

  const forbiddenNames = new Set([
    'apikey',
    'apikeyvalue',
    'authorization',
    'credential',
    'installationtoken',
    'password',
    'providertoken',
    'secret',
    'token',
  ])

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const normalizedKey = key.replaceAll('-', '').replaceAll('_', '').toLowerCase()
    const fieldPath = parentPath ? `${parentPath}.${key}` : key
    const hasForbiddenSuffix = [
      'authorization',
      'authorizationheader',
      'credential',
      'password',
      'privatekey',
      'secret',
      'token',
    ].some((suffix) => normalizedKey.endsWith(suffix))
    const current =
      forbiddenNames.has(normalizedKey) || hasForbiddenSuffix ? [fieldPath] : []
    return [...current, ...findForbiddenEvidenceFields(nestedValue, fieldPath)]
  })
}

function findUnsafeEvidenceValues(value, parentPath = '') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findUnsafeEvidenceValues(item, `${parentPath}[${index}]`),
    )
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, nestedValue]) =>
      findUnsafeEvidenceValues(
        nestedValue,
        parentPath ? `${parentPath}.${key}` : key,
      ),
    )
  }
  if (typeof value !== 'string') {
    return []
  }
  const trimmed = value.trim()
  const unsafe =
    /^file:\/\//i.test(trimmed) ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    /(?:^|[\s"'(=])\/(?!\/)/.test(value) ||
    containsSecretOrRawPatch(value)
  return unsafe ? [parentPath || '<root>'] : []
}

function containsSecretOrRawPatch(value) {
  return (
    /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/.test(value) ||
    /\bgithub_pat_[A-Za-z0-9_]{8,}\b/.test(value) ||
    /\bsk-(?:ant-)?[A-Za-z0-9_-]{6,}\b/.test(value) ||
    /\bsk_(?:live|test)_[A-Za-z0-9]{8,}\b/.test(value) ||
    /\bxox(?:b|p|a|r|s)-[A-Za-z0-9-]{8,}\b/i.test(value) ||
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(value) ||
    /\bAIza[A-Za-z0-9_-]{20,}\b/.test(value) ||
    /\bglpat-[A-Za-z0-9_-]{10,}\b/.test(value) ||
    /\bnpm_[A-Za-z0-9]{10,}\b/.test(value) ||
    /\bpypi-[A-Za-z0-9_-]{10,}\b/.test(value) ||
    /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/.test(
      value,
    ) ||
    /\bdesktop-pairing-[A-Za-z0-9._-]+\.[A-Za-z0-9_-]{6,}\b/i.test(value) ||
    /\bdesktop-token-[A-Za-z0-9._-]{6,}\b/i.test(value) ||
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(value) ||
    /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]{8,}/i.test(value) ||
    /\bAuthorization\s*:\s*token\s+\S+/i.test(value) ||
    /(?:^|\n)[ \t]*(?:X-API-Key|Private-Token)\s*:\s*\S+/i.test(value) ||
    /(?:^|\n)[ \t]*(?:Cookie|Set-Cookie|Proxy-Authorization)\s*:\s*\S+/i.test(
      value,
    ) ||
    /\bdevflow_session\s*=\s*[A-Za-z0-9._-]{8,}/i.test(value) ||
    /(?:^|\n)[ \t]*["']?(?:api[_-]?key|client[_-]?secret|password|private[_-]?key|secret|token)["']?[ \t]*:[ \t]*["']?[^\s"',;]{4,}/i.test(
      value,
    ) ||
    /\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|COOKIE)\s*=\s*\S+/i.test(
      value,
    ) ||
    /\b(?:AWS_SECRET_ACCESS_KEY|_authToken)\s*=\s*\S+/i.test(value) ||
    /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i.test(value) ||
    /(?:^|\n)[ \t]*diff --git\s/.test(value) ||
    /(?:^|\n)[ \t]*@@\s+-\d/.test(value)
  )
}

function containsLocalAbsolutePath(value) {
  return (
    /file:\/\/\//i.test(value) ||
    /(?:^|[\s`'"(])[A-Za-z]:[\\/]/.test(value) ||
    /(?:^|[\s`'"(])\\\\[^\\\s]+\\/.test(value) ||
    /(?:^|[\s`'"(=:,\[])\/(?!\/)[A-Za-z0-9._~-]+(?:\/[^\s`'"<>{}\[\]]*)?/.test(
      value,
    )
  )
}

function isValidV15WalkthroughContent(content, snapshot) {
  if (
    typeof content !== 'string' ||
    content.trim().length === 0 ||
    containsSecretOrRawPatch(content) ||
    containsLocalAbsolutePath(content)
  ) {
    return false
  }

  const requiredGateValue = snapshot.requiredGateRecord?.value
  const sandboxValue = snapshot.githubSandboxRecord?.value
  const artifactVersion = requiredGateValue?.desktopArtifact?.version
  const artifactPlatform = requiredGateValue?.desktopArtifact?.platform
  const artifactSha = requiredGateValue?.desktopArtifact?.sha256
  const verifyUrl = requiredGateValue?.verifyRun?.url
  const pullRequestUrl = sandboxValue?.pullRequestUrl
  const exactValues = [snapshot.candidateSha, artifactSha, verifyUrl, pullRequestUrl]
  const deliveryValues = [
    sandboxValue?.deliverySeriesKey,
    sandboxValue?.intentDigest,
    sandboxValue?.testEvidenceDigest,
    sandboxValue?.prPackageDigest,
    sandboxValue?.expectedCommitSha,
  ]
  return (
    [...exactValues, ...deliveryValues].every(
      (value) => isNonEmptyString(value) && content.includes(value),
    ) &&
    /Status:\s*Passed/i.test(content) &&
    /Team schema v12/i.test(content) &&
    /Desktop schema v15/i.test(content) &&
    new RegExp(
      `Packaged artifact:[^\\n]*${escapeRegExp(String(artifactVersion))}[^\\n]*${escapeRegExp(String(artifactPlatform))}[^\\n]*${escapeRegExp(String(artifactSha))}`,
      'i',
    ).test(content) &&
    /Delivery attempt\s*:\s*1(?!\d)/i.test(content) &&
    /intent revision\s*:\s*1(?!\d)/i.test(content) &&
    new RegExp(
      `Sandbox/App:[^\\n]*private[^\\n]*${escapeRegExp(String(sandboxValue?.repository))}[^\\n]*${escapeRegExp(String(sandboxValue?.appSlug))}`,
      'i',
    ).test(content) &&
    new RegExp(
      `Approval role/auth:[^\\n]*${escapeRegExp(String(sandboxValue?.approvalRole))}[^\\n]*${escapeRegExp(String(sandboxValue?.approvalAuthKind))}`,
      'i',
    ).test(content) &&
    /Lifecycle counts:[^\n]*Work Request 1(?!\d)[^\n]*canonical Run 1(?!\d)[^\n]*credential grant 1(?!\d)[^\n]*branch publication 1(?!\d)[^\n]*Draft PR 1(?!\d)/i.test(
      content,
    ) &&
    new RegExp(
      `Expected commit:[^\\n]*${escapeRegExp(String(sandboxValue?.expectedCommitSha))}[^\\n]*remote head:[^\\n]*${escapeRegExp(String(sandboxValue?.remoteHeadSha))}`,
      'i',
    ).test(content) &&
    /Operator role[^\n]*non-maintainer/i.test(content) &&
    /Ad hoc maintainer assistance[^\n]*false/i.test(content) &&
    /Draft state[^\n]*true/i.test(content) &&
    /automatic retry[^\n]*false/i.test(content) &&
    /Restart side-effect repeats[^\n]*credential 0[^\n]*push 0[^\n]*pull request 0/i.test(
      content,
    ) &&
    /Restart recovery[^\n]*passed/i.test(content) &&
    /Binding revocation[^\n]*passed/i.test(content) &&
    /Post-revocation credential grant[^\n]*blocked/i.test(content) &&
    /Acceptance[^\n]*completed/i.test(content) &&
    /(?:not merged|no merge)/i.test(content) &&
    /Redaction[^\n]*passed/i.test(content) &&
    /Cleanup[^\n]*passed/i.test(content)
  )
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function evidenceSafetyIssue(recordPath, value) {
  const forbiddenFields = findForbiddenEvidenceFields(value)
  if (forbiddenFields.length > 0) {
    return 'Secret-bearing fields are forbidden in release evidence.'
  }
  const unsafeValues = findUnsafeEvidenceValues(value)
  if (unsafeValues.length > 0) {
    return 'Local absolute paths are forbidden; unsafe text is also forbidden in release evidence.'
  }
  return null
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isSafeRelativeEvidencePath(value) {
  if (!isNonEmptyString(value)) {
    return false
  }
  const trimmed = value.trim()
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(trimmed)
  ) {
    return false
  }
  const segments = trimmed.split(/[\\/]/)
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function isValidProviderEgressEvidence(value) {
  if (!isRecord(value)) {
    return false
  }
  const armed = value.armedSegmentCount
  const forwarded = value.forwardedRequestCount
  const completed = value.completedResponseCount
  return (
    Number.isSafeInteger(armed) &&
    armed === 3 &&
    forwarded === armed &&
    completed === forwarded &&
    value.blockedUncreditedRequestCount === 0 &&
    value.blockedInvalidCount === 0 &&
    value.failedSegmentCount === 0 &&
    value.activeRequestCount === 0 &&
    value.closed === true
  )
}

function evaluateRealOpencodeRecord(snapshot) {
  const baseState = evidenceBaseState(snapshot.realOpencodeRecord, snapshot)
  if (baseState) {
    return {
      id: 'real-opencode',
      label: 'Real opencode release smoke',
      ...baseState,
    }
  }

  const value = snapshot.realOpencodeRecord.value
  const forbiddenFields = findForbiddenEvidenceFields(value)
  const diffEvidenceValid =
    Array.isArray(value.diffEvidence) &&
    value.diffEvidence.length > 0 &&
    value.diffEvidence.every(isSafeRelativeEvidencePath)
  const requiredMetadataValid =
    isNonEmptyString(value.recordedAt) &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    isNonEmptyString(value.opencodeVersion) &&
    isNonEmptyString(value.provider) &&
    isNonEmptyString(value.model) &&
    isNonEmptyString(value.keyEnvName) &&
    isNonEmptyString(value.duration) &&
    isNonEmptyString(value.permissionRelay) &&
    diffEvidenceValid &&
    value.testEvidence === 'passed' &&
    value.cleanup === 'passed' &&
    value.redactionCheck === 'passed'
  const expectedControls = releaseProfileFor(snapshot.targetVersion)?.realOpencodeControls
  const controlsValid =
    expectedControls === undefined ||
    (value.attemptCount === expectedControls.attemptCount &&
      value.automaticRetry === expectedControls.automaticRetry &&
      value.costCapUsd === expectedControls.costCapUsd &&
      value.releaseProfile === expectedControls.releaseProfile &&
      value.providerApiMode === expectedControls.providerApiMode &&
      value.resolvedConfigPreflight === expectedControls.resolvedConfigPreflight &&
      value.opencodeVersion === expectedControls.opencodeVersion &&
      value.provider === expectedControls.provider &&
      value.model === expectedControls.model &&
      value.keyEnvName === expectedControls.keyEnvName &&
      value.providerRetryObserved === expectedControls.providerRetryObserved &&
      value.permissionRelay === expectedControls.permissionRelay &&
      JSON.stringify(value.diffEvidence) === JSON.stringify(expectedControls.diffEvidence) &&
      isValidProviderEgressEvidence(value.egressGate))
  const ready = requiredMetadataValid && controlsValid && forbiddenFields.length === 0

  return {
    id: 'real-opencode',
    label: 'Real opencode release smoke',
    state: ready ? 'ready' : 'attention',
    detail: ready
      ? `Live smoke passed for ${snapshot.candidateSha}; only non-secret metadata is recorded.`
      : forbiddenFields.length > 0
        ? 'Secret-bearing fields are forbidden in release evidence.'
        : !controlsValid
          ? `${snapshot.realOpencodeRecord.path} must record one attempt, no automatic retry, exactly three provider segments, and an explicit uncapped authorization.`
        : `${snapshot.realOpencodeRecord.path} is missing required non-secret live-smoke metadata.`,
  }
}

function evaluateGitHubSandboxRecord(snapshot) {
  const baseState = evidenceBaseState(snapshot.githubSandboxRecord, snapshot)
  if (baseState) {
    return {
      id: 'github-sandbox',
      label: 'GitHub sandbox Draft PR',
      ...baseState,
    }
  }

  const safetyIssue = evidenceSafetyIssue(
    snapshot.githubSandboxRecord.path,
    snapshot.githubSandboxRecord.value,
  )
  if (safetyIssue) {
    return {
      id: 'github-sandbox',
      label: 'GitHub sandbox Draft PR',
      state: 'attention',
      detail: safetyIssue,
    }
  }
  const shapeIssue = v15EvidenceShapeIssue(
    snapshot,
    'github-sandbox',
    snapshot.githubSandboxRecord.value,
  )
  if (shapeIssue) {
    return {
      id: 'github-sandbox',
      label: 'GitHub sandbox Draft PR',
      state: 'attention',
      detail: shapeIssue,
    }
  }
  const value = snapshot.githubSandboxRecord.value
  const safeRepositoryAndRefs = [
    value.repository,
    value.baseBranch,
    value.headBranch,
  ].every(isSafeRelativeEvidencePath)
  if (!safeRepositoryAndRefs) {
    return {
      id: 'github-sandbox',
      label: 'GitHub sandbox Draft PR',
      state: 'attention',
      detail: `${snapshot.githubSandboxRecord.path} must contain a safe repository and refs without absolute or traversal paths.`,
    }
  }
  const expectedCommitSha = value.expectedCommitSha
  const remoteHeadSha = value.remoteHeadSha
  const exactRemoteHead =
    typeof expectedCommitSha === 'string' &&
    /^[0-9a-f]{40}$/.test(expectedCommitSha) &&
    typeof remoteHeadSha === 'string' &&
    /^[0-9a-f]{40}$/.test(remoteHeadSha) &&
    remoteHeadSha === expectedCommitSha
  if (!exactRemoteHead) {
    return {
      id: 'github-sandbox',
      label: 'GitHub sandbox Draft PR',
      state: 'attention',
      detail: `${snapshot.githubSandboxRecord.path} must bind the exact expected commit and remote head to the same full SHA.`,
    }
  }
  const singleLifecycleCounts = [
    'workRequestCount',
    'canonicalRunCount',
    'credentialGrantCount',
    'branchPublicationCount',
    'draftPullRequestCount',
  ].every((field) => value[field] === 1)
  if (!singleLifecycleCounts) {
    return {
      id: 'github-sandbox',
      label: 'GitHub sandbox Draft PR',
      state: 'attention',
      detail: `${snapshot.githubSandboxRecord.path} must record exactly one Work Request, canonical Run, credential grant, branch publication, and Draft PR.`,
    }
  }
  const positiveInteger = (candidate) => Number.isSafeInteger(candidate) && candidate > 0
  const safeGitRef = (candidate) =>
    isSafeRelativeEvidencePath(candidate) &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(candidate) &&
    !candidate.includes('..') &&
    !candidate.includes('//') &&
    !candidate.endsWith('.') &&
    !candidate.endsWith('/')
  const repositoryValid =
    typeof value.repository === 'string' &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)
  const pullRequestIdentityValid =
    positiveInteger(value.pullRequestNumber) &&
    value.pullRequestUrl ===
      `https://github.com/${value.repository}/pull/${value.pullRequestNumber}`
  const identityMetadataValid =
    isNonEmptyString(value.recordedAt) &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    repositoryValid &&
    value.repositoryVisibility === 'private' &&
    typeof value.appSlug === 'string' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.appSlug) &&
    typeof value.installationIdSuffix === 'string' &&
    /^\d{4}$/.test(value.installationIdSuffix) &&
    typeof value.repositoryIdSuffix === 'string' &&
    /^\d{4}$/.test(value.repositoryIdSuffix) &&
    positiveInteger(value.bindingVersion) &&
    typeof value.deliverySeriesKey === 'string' &&
    /^github-delivery:[0-9a-f]{64}$/.test(value.deliverySeriesKey) &&
    value.deliveryAttempt === 1 &&
    value.intentRevision === 1 &&
    typeof value.intentDigest === 'string' &&
    /^[0-9a-f]{64}$/.test(value.intentDigest) &&
    positiveInteger(value.runVersion) &&
    typeof value.testEvidenceDigest === 'string' &&
    /^[0-9a-f]{64}$/.test(value.testEvidenceDigest) &&
    typeof value.prPackageDigest === 'string' &&
    /^[0-9a-f]{64}$/.test(value.prPackageDigest) &&
    safeGitRef(value.baseBranch) &&
    safeGitRef(value.headBranch) &&
    value.headBranch.startsWith('devflow/') &&
    pullRequestIdentityValid
  if (!identityMetadataValid) {
    return {
      id: 'github-sandbox',
      label: 'GitHub sandbox Draft PR',
      state: 'attention',
      detail: `${snapshot.githubSandboxRecord.path} is missing required private-repository identity metadata.`,
    }
  }
  const lifecycleControlsValid =
    value.draft === true &&
    value.merged === false &&
    (value.approvalRole === 'owner' || value.approvalRole === 'lead') &&
    value.approvalAuthKind === 'session_cookie' &&
    value.automaticRetry === false &&
    value.acceptanceStatus === 'completed' &&
    value.restartRecovery === 'passed' &&
    value.bindingRevocation === 'passed' &&
    value.postRevocationGrant === 'blocked' &&
    value.redactionCheck === 'passed' &&
    value.cleanup === 'passed' &&
    value.cleanupMethod === 'external-operator-no-merge' &&
    value.operatorRole === 'non-maintainer' &&
    value.adHocMaintainerAssistance === false
  if (!lifecycleControlsValid) {
    return {
      id: 'github-sandbox',
      label: 'GitHub sandbox Draft PR',
      state: 'attention',
      detail: `${snapshot.githubSandboxRecord.path} must record an approved Draft and completed lifecycle with no merge or automatic retry.`,
    }
  }

  return {
    id: 'github-sandbox',
    label: 'GitHub sandbox Draft PR',
    state: 'ready',
    detail: `Private sandbox Draft PR passed for ${snapshot.candidateSha}.`,
  }
}

function evaluateProfileEvidence(snapshot) {
  const evidence = releaseProfileFor(snapshot.targetVersion)?.evidence ?? realOpencodeEvidence
  return evidence.kind === 'github-sandbox'
    ? evaluateGitHubSandboxRecord(snapshot)
    : evaluateRealOpencodeRecord(snapshot)
}

function evaluateReleaseTag(snapshot) {
  const tag = `v${snapshot.targetVersion}`

  if (snapshot.mode === 'pre-tag') {
    return {
      id: 'release-tag',
      label: `Git tag ${tag}`,
      state: snapshot.releaseTagExists ? 'attention' : 'ready',
      detail: snapshot.releaseTagExists
        ? `${tag} already exists; pre-tag mode requires the tag to remain absent.`
        : 'Tag is correctly absent in pre-tag mode.',
    }
  }

  const tagMatchesHead =
    snapshot.releaseTagExists &&
    snapshot.releaseTagObjectType === 'tag' &&
    snapshot.releaseTagTarget === snapshot.headSha

  return {
    id: 'release-tag',
    label: `Git tag ${tag}`,
    state: tagMatchesHead ? 'ready' : 'attention',
    detail: tagMatchesHead
      ? `${tag} resolves to signoff commit ${snapshot.headSha}.`
      : snapshot.releaseTagExists
        ? snapshot.releaseTagObjectType !== 'tag'
          ? `${tag} must be an annotated tag, not ${snapshot.releaseTagObjectType ?? 'an unknown object type'}.`
          : `${tag} resolves to ${snapshot.releaseTagTarget ?? 'an unknown target'}, not HEAD ${snapshot.headSha}.`
        : `${tag} does not exist; tagged mode requires the exact version tag at HEAD.`,
  }
}

function evaluateSignoffContents(snapshot) {
  const walkthroughPath = snapshot.walkthroughEvidence.value?.evidencePath
  const evidence = releaseProfileFor(snapshot.targetVersion)?.evidence ?? realOpencodeEvidence
  const releaseEvidenceRecord = snapshot[evidence.snapshotKey]
  const releaseDir = `docs/releases/v${snapshot.targetVersion}`
  const evidenceRecordPaths =
    evidence.canonicalSignoffPaths === true
      ? [
          `${releaseDir}/walkthrough.json`,
          `${releaseDir}/required-gates.json`,
          `${releaseDir}/${evidence.fileName}`,
        ]
      : [
          snapshot.walkthroughEvidence.path,
          snapshot.requiredGateRecord.path,
          releaseEvidenceRecord.path,
        ]
  const expectedFiles = [
    ...evidenceRecordPaths,
    ...(typeof walkthroughPath === 'string' ? [walkthroughPath] : []),
  ]
  const actualFiles = snapshot.changedFilesFromCandidate

  if (!Array.isArray(actualFiles)) {
    return {
      id: 'signoff-contents',
      label: 'Signoff commit contents',
      state: 'attention',
      detail: 'Cannot inspect C..S; the signoff commit first-parent history is unavailable.',
    }
  }

  const expected = new Set(expectedFiles)
  const actual = new Set(actualFiles)
  const missing = [...expected].filter((path) => !actual.has(path))
  const unexpected = [...actual].filter((path) => !expected.has(path))
  const ready =
    expected.size === 4 &&
    actual.size === expected.size &&
    missing.length === 0 &&
    unexpected.length === 0

  return {
    id: 'signoff-contents',
    label: 'Signoff commit contents',
    state: ready ? 'ready' : 'attention',
    detail: ready
      ? 'C..S contains only the three release evidence records and their dated walkthrough result.'
      : `C..S must contain exactly the three evidence records and referenced walkthrough result; missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}.`,
  }
}

export function evaluateReleaseSignoffSnapshot(snapshot) {
  const releaseSeries = releaseSeriesFor(snapshot.targetVersion)
  const releaseSeriesLabel = releaseSeries ? `v${releaseSeries}` : 'Unknown'
  const releaseProfile = releaseProfileFor(snapshot.targetVersion)
  const versions = Object.values(snapshot.packageVersions)
  const missingPackages = Object.entries(snapshot.packageVersions)
    .filter(([, version]) => version === null)
    .map(([path]) => path)
  const unexpectedPackages = Object.entries(snapshot.packageVersions)
    .filter(([, version]) => version !== snapshot.targetVersion)
    .map(([path, version]) => `${path}=${version ?? 'missing'}`)
  const packageState =
    typeof snapshot.targetVersion !== 'string' ||
    missingPackages.length > 0 ||
    unexpectedPackages.length > 0
      ? 'attention'
      : 'ready'
  const missingDocs = Object.entries(snapshot.requiredDocs)
    .filter(([, exists]) => !exists)
    .map(([path]) => path)
  const candidateShaReady =
    /^[0-9a-f]{40}$/.test(snapshot.headSha) &&
    typeof snapshot.candidateSha === 'string' &&
    /^[0-9a-f]{40}$/.test(snapshot.candidateSha)

  return [
    {
      id: 'release-mode',
      label: 'Release status mode',
      state: releaseModes.has(snapshot.mode) ? 'ready' : 'attention',
      detail: releaseModes.has(snapshot.mode)
        ? `${snapshot.mode} checks are active.`
        : 'Mode must be pre-tag or tagged.',
    },
    {
      id: 'release-profile',
      label: 'Release profile',
      state: releaseProfile ? 'ready' : 'attention',
      detail: releaseProfile
        ? `Using the explicit ${releaseSeriesLabel} release profile.`
        : `Unknown release series for target ${String(snapshot.targetVersion)}; refusing to fall back.`,
    },
    {
      id: 'package-versions',
      label: 'Package metadata',
      state: packageState,
      detail:
        packageState === 'ready'
          ? `All ${versions.length} packages are ${snapshot.targetVersion}.`
          : `Package metadata needs attention: ${[...missingPackages, ...unexpectedPackages].join(', ') || 'target version is missing'}.`,
    },
    {
      id: 'candidate-sha',
      label: 'Candidate SHA',
      state: candidateShaReady ? 'ready' : 'attention',
      detail: candidateShaReady
        ? `Signoff ${snapshot.headSha} evidence must match first parent candidate ${snapshot.candidateSha}.`
        : 'Signoff HEAD and its first parent candidate must resolve to full commit SHAs.',
    },
    {
      id: 'working-tree',
      label: 'Working tree',
      state: snapshot.workingTreeClean ? 'ready' : 'attention',
      detail: snapshot.workingTreeClean
        ? `Clean on ${snapshot.currentBranch || 'detached HEAD'}.`
        : `Uncommitted changes exist on ${snapshot.currentBranch || 'detached HEAD'}.`,
    },
    {
      id: 'release-docs',
      label: `${releaseSeriesLabel} release docs`,
      state: missingDocs.length === 0 ? 'ready' : 'attention',
      detail:
        missingDocs.length === 0
          ? `Required ${releaseSeriesLabel} release docs exist.`
          : `Missing ${missingDocs.join(', ')}.`,
    },
    evaluateSignoffContents(snapshot),
    evaluateWalkthroughEvidence(snapshot),
    evaluateRequiredGateRecord(snapshot),
    evaluateProfileEvidence(snapshot),
    evaluateReleaseTag(snapshot),
  ]
}

export function formatReleaseSignoffItems(items) {
  const iconByState = {
    ready: 'OK',
    pending: '..',
    attention: '!!',
  }

  return items
    .map((item) => `${iconByState[item.state]} ${item.label}: ${item.detail}`)
    .join('\n')
}

function runCli() {
  try {
    const mode = parseReleaseMode(process.argv.slice(2))
    const snapshot = collectReleaseSignoffSnapshot(mode)
    const items = evaluateReleaseSignoffSnapshot(snapshot)
    console.log(formatReleaseSignoffItems(items))

    if (items.some((item) => item.state !== 'ready')) {
      process.exitCode = 1
    }
  } catch {
    console.error('!! Release status: Release status could not be collected safely.')
    process.exitCode = 1
  }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCli) {
  runCli()
}
