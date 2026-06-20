import { describe, expect, it } from 'vitest'
import {
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
    targetVersion: '0.8.1',
    packageVersions: Object.fromEntries(packagePaths.map((path) => [path, '0.7.5'])),
    requiredDocs: Object.fromEntries(requiredDocPaths.map((path) => [path, true])),
    workingTreeClean: true,
    currentBranch: 'devflow-v0.8.1-release-v0.9-planning',
    releaseTagExists: false,
    manualWalkthroughPassed: false,
    ...overrides,
  }
}

describe('release signoff status', () => {
  it('treats the current pre-release package version as pending, not failed', () => {
    const items = evaluateReleaseSignoffSnapshot(snapshot())

    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'package-versions',
        state: 'pending',
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
        packageVersions: Object.fromEntries(packagePaths.map((path) => [path, '0.8.1'])),
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
          ...Object.fromEntries(packagePaths.map((path) => [path, '0.7.5'])),
          'apps/web/package.json': '0.8.0',
        },
        requiredDocs: {
          ...Object.fromEntries(requiredDocPaths.map((path) => [path, true])),
          'docs/plans/v0.9-real-runtime-observability.md': false,
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
    expect(output).toContain('.. Package metadata')
    expect(output).toContain('.. Manual walkthrough')
  })
})
