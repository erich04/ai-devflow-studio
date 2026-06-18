import { describe, expect, it, vi } from 'vitest'
import {
  createRecommendedEnforcementPreset,
  resolveEffectivePolicy,
  type LocalProject,
  type PolicySnapshot,
} from '@ai-devflow/shared'
import { loadPolicySnapshotForProject } from './enforcement-policy'

const localProject: LocalProject = {
  id: 'local-abc123',
  name: 'Local Repo',
  path: '/Users/erich/repo',
  packageManager: 'pnpm',
  testCommand: 'pnpm test',
  createdAt: '2026-06-18T00:00:00.000Z',
  updatedAt: '2026-06-18T00:00:00.000Z',
}

const cachedPolicy = createRecommendedEnforcementPreset({
  organizationId: 'org-demo',
  updatedAt: '2026-06-18T00:00:00.000Z',
})

const cachedSnapshot: PolicySnapshot = {
  projectId: 'p-payments',
  organizationPolicy: cachedPolicy,
  projectOverride: null,
  effectivePolicy: resolveEffectivePolicy(cachedPolicy, null),
  version: cachedPolicy.version,
  updatedAt: cachedPolicy.updatedAt,
  syncedAt: '2026-06-18T00:00:10.000Z',
  source: 'remote_cache',
}

function createStore(input: {
  cached?: PolicySnapshot | null
  projects?: LocalProject[]
}) {
  return {
    getPolicySnapshot: vi.fn(async (projectId: string) =>
      input.cached?.projectId === projectId ? input.cached : null,
    ),
    listProjects: vi.fn(async () => input.projects ?? []),
  }
}

describe('loadPolicySnapshotForProject', () => {
  it('uses the authoritative cached team policy when present', async () => {
    const store = createStore({ cached: cachedSnapshot })

    await expect(loadPolicySnapshotForProject(store, 'p-payments')).resolves.toEqual(cachedSnapshot)
  })

  it('returns blocked-policy-unavailable for team projects without a cached policy', async () => {
    const store = createStore({ projects: [] })
    const snapshot = await loadPolicySnapshotForProject(store, 'p-payments')

    expect(snapshot).toMatchObject({
      projectId: 'p-payments',
      organizationPolicy: null,
      projectOverride: null,
      effectivePolicy: null,
      version: 0,
      source: 'unavailable',
    })
  })

  it('uses the built-in warn-only policy for pure local projects', async () => {
    const store = createStore({ projects: [localProject] })
    const snapshot = await loadPolicySnapshotForProject(store, localProject.id)

    expect(snapshot.source).toBe('built_in_default')
    expect(snapshot.effectivePolicy?.rules.every((rule) => rule.action !== 'block')).toBe(true)
  })
})
