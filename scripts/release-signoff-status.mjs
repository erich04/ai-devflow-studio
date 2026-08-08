import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const rootPackagePath = 'package.json'
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

const releaseProfiles = {
  '1.3': {
    requiredDocPaths,
    requiredGateIds,
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
    },
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

  return {
    walkthrough:
      env.DEVFLOW_RELEASE_WALKTHROUGH_RECORD?.trim() || `${releaseDir}/walkthrough.json`,
    requiredGates:
      env.DEVFLOW_RELEASE_GATE_RECORD?.trim() || `${releaseDir}/required-gates.json`,
    realOpencode:
      env.DEVFLOW_RELEASE_OPENCODE_RECORD?.trim() || `${releaseDir}/real-opencode.json`,
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
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
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
      parseError: error instanceof Error ? error.message : String(error),
      value: null,
    }
  }
}

function collectWalkthroughEvidence(path) {
  const record = readEvidenceRecord(path)
  const evidencePath = record.value?.evidencePath

  if (typeof evidencePath !== 'string') {
    return record
  }

  return {
    ...record,
    value: {
      ...record.value,
      evidenceExists: existsSync(evidencePath),
    },
  }
}

export function collectReleaseSignoffSnapshot(mode, env = process.env) {
  if (!releaseModes.has(mode)) {
    throw new Error('Release snapshot mode must be pre-tag or tagged.')
  }

  const targetVersion = resolveTargetVersion(env)
  const releaseProfile = releaseProfileFor(targetVersion)
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

  let releaseTagExists = false
  let releaseTagTarget = null
  try {
    const releaseTag = `v${targetVersion}`
    releaseTagExists = runGit(['tag', '--list', releaseTag]) === releaseTag
    if (releaseTagExists) {
      releaseTagTarget = runGit(['rev-list', '-n', '1', releaseTag])
    }
  } catch {
    releaseTagExists = false
    releaseTagTarget = null
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
    walkthroughEvidence: collectWalkthroughEvidence(evidencePaths.walkthrough),
    requiredGateRecord: readEvidenceRecord(evidencePaths.requiredGates),
    realOpencodeRecord: readEvidenceRecord(evidencePaths.realOpencode),
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function evidenceBaseState(record, snapshot) {
  if (!record.exists) {
    return {
      state: 'pending',
      detail: `Missing evidence record ${record.path}.`,
    }
  }

  if (record.parseError || !isRecord(record.value)) {
    return {
      state: 'attention',
      detail: `Invalid evidence record ${record.path}: ${record.parseError ?? 'expected a JSON object'}.`,
    }
  }

  if (record.value.targetVersion !== snapshot.targetVersion) {
    return {
      state: 'attention',
      detail: `${record.path} targets ${record.value.targetVersion ?? 'no version'}, expected ${snapshot.targetVersion}.`,
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
  const releaseSeries = releaseSeriesFor(snapshot.targetVersion)
  const expectedPath = `docs/guides/devflow-studio-v${releaseSeries ?? 'unknown'}-walkthrough-result-${value.date}.md`
  const validDate = typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
  const validEvidence =
    validDate &&
    value.method === 'computer-use' &&
    value.evidencePath === expectedPath &&
    value.evidenceExists === true

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

  const gates = snapshot.requiredGateRecord.value.gates
  const profileGateIds = releaseProfileFor(snapshot.targetVersion)?.requiredGateIds ?? []
  const missingOrFailed =
    isRecord(gates) === false
      ? profileGateIds
      : profileGateIds.filter((gate) => gates[gate] !== 'passed')

  return {
    id: 'required-gates',
    label: 'Required deterministic gates',
    state: missingOrFailed.length === 0 ? 'ready' : 'attention',
    detail:
      missingOrFailed.length === 0
        ? `All required gates passed for ${snapshot.candidateSha}.`
        : `Missing or non-passing gates: ${missingOrFailed.join(', ')}.`,
  }
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
    'password',
    'providertoken',
    'secret',
    'token',
  ])

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const normalizedKey = key.replaceAll('-', '').replaceAll('_', '').toLowerCase()
    const fieldPath = parentPath ? `${parentPath}.${key}` : key
    const current = forbiddenNames.has(normalizedKey) ? [fieldPath] : []
    return [...current, ...findForbiddenEvidenceFields(nestedValue, fieldPath)]
  })
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
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
    value.diffEvidence.every(isNonEmptyString)
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
      value.costCapUsd === expectedControls.costCapUsd)
  const ready = requiredMetadataValid && controlsValid && forbiddenFields.length === 0

  return {
    id: 'real-opencode',
    label: 'Real opencode release smoke',
    state: ready ? 'ready' : 'attention',
    detail: ready
      ? `Live smoke passed for ${snapshot.candidateSha}; only non-secret metadata is recorded.`
      : forbiddenFields.length > 0
        ? `Secret-bearing fields are forbidden in ${snapshot.realOpencodeRecord.path}: ${forbiddenFields.join(', ')}.`
        : !controlsValid
          ? `${snapshot.realOpencodeRecord.path} must record one attempt, no automatic retry, and an explicit uncapped authorization.`
        : `${snapshot.realOpencodeRecord.path} is missing required non-secret live-smoke metadata.`,
  }
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
    snapshot.releaseTagExists && snapshot.releaseTagTarget === snapshot.headSha

  return {
    id: 'release-tag',
    label: `Git tag ${tag}`,
    state: tagMatchesHead ? 'ready' : 'attention',
    detail: tagMatchesHead
      ? `${tag} resolves to signoff commit ${snapshot.headSha}.`
      : snapshot.releaseTagExists
        ? `${tag} resolves to ${snapshot.releaseTagTarget ?? 'an unknown target'}, not HEAD ${snapshot.headSha}.`
        : `${tag} does not exist; tagged mode requires the exact version tag at HEAD.`,
  }
}

function evaluateSignoffContents(snapshot) {
  const walkthroughPath = snapshot.walkthroughEvidence.value?.evidencePath
  const expectedFiles = [
    snapshot.walkthroughEvidence.path,
    snapshot.requiredGateRecord.path,
    snapshot.realOpencodeRecord.path,
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
    evaluateRealOpencodeRecord(snapshot),
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
  } catch (error) {
    console.error(`!! Release status: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCli) {
  runCli()
}
