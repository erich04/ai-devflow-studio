import { describe, expect, it, vi } from 'vitest'
import {
  createRecommendedEnforcementPreset,
  resolveEffectivePolicy,
  type GateOverrideDecision,
  type LocalProject,
  type PolicySnapshot,
} from '@ai-devflow/shared'
import { resolveLocalGateOverrideSettlement, loadPolicySnapshotForProject } from './enforcement-policy'

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
    expect(snapshot.organizationPolicy?.organizationId).toBe(`local-policy-${localProject.id}`)
    expect(snapshot.effectivePolicy?.rules.every((rule) => rule.action !== 'block')).toBe(true)
  })
})

const localOverride: GateOverrideDecision = {
  id: 'gate-override-local',
  runId: 'run-1',
  nodeId: 'n-gate',
  projectId: 'p-payments',
  userId: 'u-ling',
  role: 'lead',
  reason: 'Lead approved a temporary exception.',
  blockedReasonIds: ['missing_agent_review:protected_gate:missing'],
  policyVersion: 1,
  provisional: true,
  status: 'provisional',
  createdAt: '2026-06-18T00:00:00.000Z',
}

describe('resolveLocalGateOverrideSettlement', () => {
  it('keeps confirmed server overrides accepted locally', () => {
    const remoteOverride: GateOverrideDecision = {
      ...localOverride,
      id: 'gate-override-remote',
      provisional: false,
      status: 'accepted',
    }

    expect(resolveLocalGateOverrideSettlement(localOverride, { status: 'confirmed', override: remoteOverride }))
      .toEqual({
        ...remoteOverride,
        id: localOverride.id,
        provisional: false,
        status: 'accepted',
      })
  })

  it('keeps network failures provisional for later reconciliation', () => {
    expect(resolveLocalGateOverrideSettlement(localOverride, { status: 'offline' })).toEqual({
      ...localOverride,
      provisional: true,
      status: 'provisional',
    })
  })

  it('marks server rejections as rejected with the server reason', () => {
    expect(
      resolveLocalGateOverrideSettlement(localOverride, {
        status: 'rejected',
        reason: 'Policy version is stale; re-evaluate before overriding',
      }),
    ).toEqual({
      ...localOverride,
      provisional: true,
      status: 'rejected',
      reason: 'Policy version is stale; re-evaluate before overriding',
    })
  })
})
