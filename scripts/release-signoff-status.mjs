import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TARGET_VERSION = '0.8.1'
const PRE_RELEASE_VERSION = '0.7.5'

export const packagePaths = [
  'package.json',
  'packages/shared/package.json',
  'apps/desktop/package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/worker/package.json',
]

export const requiredDocPaths = [
  'docs/guides/devflow-studio-v0.8-user-guide.md',
  'docs/guides/devflow-studio-v0.9-demo-script.md',
  'docs/knowledge/checklists/v09-demo-readiness.md',
  'docs/plans/v0.8.1-release-signoff.md',
  'docs/plans/v0.9-real-runtime-observability.md',
  'docs/research/2026-06-19-opencode-runtime-contract-refresh.md',
]

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

export function collectReleaseSignoffSnapshot(env = process.env) {
  const packageVersions = Object.fromEntries(
    packagePaths.map((path) => [path, readPackageVersion(path)]),
  )
  const requiredDocs = Object.fromEntries(requiredDocPaths.map((path) => [path, existsSync(path)]))
  const status = runGit(['status', '--short'])
  const currentBranch = runGit(['branch', '--show-current'])

  let releaseTagExists = false
  try {
    releaseTagExists = runGit(['tag', '--list', `v${TARGET_VERSION}`]) === `v${TARGET_VERSION}`
  } catch {
    releaseTagExists = false
  }

  return {
    targetVersion: TARGET_VERSION,
    packageVersions,
    requiredDocs,
    workingTreeClean: status.length === 0,
    currentBranch,
    releaseTagExists,
    manualWalkthroughPassed: env.DEVFLOW_RELEASE_WALKTHROUGH === 'passed',
  }
}

export function evaluateReleaseSignoffSnapshot(snapshot) {
  const versions = Object.values(snapshot.packageVersions)
  const missingPackages = Object.entries(snapshot.packageVersions)
    .filter(([, version]) => version === null)
    .map(([path]) => path)
  const targetPackages = Object.entries(snapshot.packageVersions)
    .filter(([, version]) => version === snapshot.targetVersion)
    .map(([path]) => path)
  const preReleasePackages = Object.entries(snapshot.packageVersions)
    .filter(([, version]) => version === PRE_RELEASE_VERSION)
    .map(([path]) => path)
  const unexpectedPackages = Object.entries(snapshot.packageVersions)
    .filter(([, version]) => version !== snapshot.targetVersion && version !== PRE_RELEASE_VERSION)
    .map(([path, version]) => `${path}=${version ?? 'missing'}`)

  const packageState =
    missingPackages.length > 0 || unexpectedPackages.length > 0
      ? 'attention'
      : targetPackages.length === versions.length
        ? 'ready'
        : 'pending'

  const missingDocs = Object.entries(snapshot.requiredDocs)
    .filter(([, exists]) => !exists)
    .map(([path]) => path)

  return [
    {
      id: 'package-versions',
      label: 'Package metadata',
      state: packageState,
      detail:
        packageState === 'ready'
          ? `All packages are ${snapshot.targetVersion}.`
          : packageState === 'pending'
            ? `${preReleasePackages.length} package(s) remain at ${PRE_RELEASE_VERSION}; bump after automated verification passes.`
            : `Package metadata needs attention: ${[...missingPackages, ...unexpectedPackages].join(', ')}.`,
    },
    {
      id: 'release-tag',
      label: `Git tag v${snapshot.targetVersion}`,
      state: snapshot.releaseTagExists ? 'ready' : 'pending',
      detail: snapshot.releaseTagExists
        ? `v${snapshot.targetVersion} exists.`
        : `Create v${snapshot.targetVersion} after automated verification and version bump; manual walkthrough remains tracked separately.`,
    },
    {
      id: 'working-tree',
      label: 'Working tree',
      state: snapshot.workingTreeClean ? 'ready' : 'attention',
      detail: snapshot.workingTreeClean
        ? `Clean on ${snapshot.currentBranch}.`
        : `Uncommitted changes exist on ${snapshot.currentBranch}.`,
    },
    {
      id: 'release-docs',
      label: 'Release docs',
      state: missingDocs.length === 0 ? 'ready' : 'attention',
      detail: missingDocs.length === 0 ? 'Required signoff docs exist.' : `Missing ${missingDocs.join(', ')}.`,
    },
    {
      id: 'manual-walkthrough',
      label: 'Manual walkthrough',
      state: snapshot.manualWalkthroughPassed ? 'ready' : 'pending',
      detail: snapshot.manualWalkthroughPassed
        ? 'Marked passed by DEVFLOW_RELEASE_WALKTHROUGH=passed.'
        : 'Pending human walkthrough against the v0.8 user guide.',
    },
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
  const strict = process.argv.includes('--strict')
  const snapshot = collectReleaseSignoffSnapshot()
  const items = evaluateReleaseSignoffSnapshot(snapshot)
  console.log(formatReleaseSignoffItems(items))

  const hasAttention = items.some((item) => item.state === 'attention')
  const hasPending = items.some((item) => item.state === 'pending')
  if (hasAttention || (strict && hasPending)) {
    process.exitCode = 1
  }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCli) {
  runCli()
}
