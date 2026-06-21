import { describe, expect, it } from 'vitest'
import {
  collectReleaseSignoffSnapshot,
  evaluateReleaseSignoffSnapshot,
  formatReleaseSignoffItems,
  packagePaths,
  requiredDocPaths,
} from './release-signoff-status.mjs'

type ReleaseSignoffSnapshot = {
  targetVersion: string
  packageVersions: Record<string, string | null>
  requiredDocs: Record<string, boolean>
  workingTreeClean: boolean
  currentBranch: string
  releaseTagExists: boolean
  manualWalkthroughPassed: boolean
}

function snapshot(overrides: Partial<ReleaseSignoffSnapshot> = {}): ReleaseSignoffSnapshot {
  return {
    targetVersion: '1.1.0',
    packageVersions: Object.fromEntries(packagePaths.map((path) => [path, '1.1.0'])),
    requiredDocs: Object.fromEntries(requiredDocPaths.map((path) => [path, true])),
    workingTreeClean: true,
    currentBranch: 'devflow-v0.8.1-release-v0.9-planning',
    releaseTagExists: false,
    manualWalkthroughPassed: false,
    ...overrides,
  }
}

describe('release signoff status', () => {
  it('derives the target release version from root package metadata', () => {
    const snapshot = collectReleaseSignoffSnapshot()

    expect(snapshot.targetVersion).toBe('1.1.0')
    expect(snapshot.packageVersions['package.json']).toBe('1.1.0')
  })

  it('requires current release docs plus runtime planning docs', () => {
    expect(requiredDocPaths).toEqual(
      expect.arrayContaining([
        'docs/guides/devflow-studio-v1.0-user-guide.md',
        'docs/guides/devflow-studio-self-hosted-pilot.md',
        'docs/guides/devflow-studio-v0.9-demo-script.md',
        'docs/plans/v1.0-team-pilot-foundation.md',
        'docs/plans/v1.0-release-signoff.md',
        'docs/plans/v1.1-runtime-cost-budget-guard.md',
        'docs/plans/v1.1-release-signoff.md',
        'docs/plans/v0.9-real-runtime-observability.md',
      ]),
    )
  })

  it('marks current package metadata ready when every package matches the derived release version', () => {
    const items = evaluateReleaseSignoffSnapshot(snapshot())

    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'package-versions',
        state: 'ready',
      }),
    )
    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'manual-walkthrough',
        state: 'pending',
      }),
    )
    expect(items).not.toContainEqual(expect.objectContaining({ state: 'attention' }))
  })

  it('marks release state ready after version bump, tag, and walkthrough', () => {
    const items = evaluateReleaseSignoffSnapshot(
      snapshot({
        releaseTagExists: true,
        manualWalkthroughPassed: true,
      }),
    )

    expect(items.every((item) => item.state === 'ready')).toBe(true)
  })

  it('flags missing docs and unexpected package versions for attention', () => {
    const items = evaluateReleaseSignoffSnapshot(
      snapshot({
        packageVersions: {
          ...Object.fromEntries(packagePaths.map((path) => [path, '1.1.0'])),
          'apps/web/package.json': '0.9.0',
        },
        requiredDocs: {
          ...Object.fromEntries(requiredDocPaths.map((path) => [path, true])),
          'docs/plans/v1.1-release-signoff.md': false,
        },
      }),
    )

    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'package-versions',
        state: 'attention',
      }),
    )
    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'release-docs',
        state: 'attention',
      }),
    )
  })

  it('formats status output without relying on terminal color', () => {
    const output = formatReleaseSignoffItems(evaluateReleaseSignoffSnapshot(snapshot()))

    expect(output).toContain('OK Working tree')
    expect(output).toContain('OK Package metadata')
    expect(output).toContain('.. Manual walkthrough')
  })
})
