import { describe, expect, it, vi } from 'vitest'
import {
  createRecommendedEnforcementPreset,
  resolveEffectivePolicy,
  type GateOverrideDecision,
  type DesktopPairingCredential,
  type LocalProject,
  type PolicySnapshot,
  type WorkflowRun,
} from '@ai-devflow/shared'
import {
  resolveLocalGateOverrideSettlement,
  loadPolicySnapshotForProject,
  selectRemoteGateOverridesForLocalStore,
} from './enforcement-policy'

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

describe('selectRemoteGateOverridesForLocalStore', () => {
  const pairing: DesktopPairingCredential = {
    tokenId: 'desktop-token-1',
    organizationId: 'org-demo',
    projectId: 'p-payments',
    localProjectId: localProject.id,
    userId: 'u-review-lead',
    role: 'lead',
    authAccountId: 'acct-review-lead',
    projectMemberships: [
      { projectId: 'p-payments', userId: 'u-review-lead', role: 'lead' },
    ],
    createdAt: '2026-06-18T00:00:00.000Z',
  }
  const run: WorkflowRun = {
    id: 'run-1',
    title: 'Remote override sync',
    request: 'Sync an accepted Team override.',
    projectId: localProject.id,
    creatorId: 'u-author',
    status: 'paused_at_gate',
    currentNodeId: 'n-gate',
    branchName: 'ai/remote-override',
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:01:00.000Z',
    nodes: [{
      id: 'n-gate',
      stage: 'design',
      title: 'Design Gate',
      subtitle: 'Review the design.',
      kind: 'gate',
      status: 'blocked',
      ownerId: 'u-author',
      requiredRole: 'lead',
      retryCount: 0,
      artifactIds: [],
    }],
    edges: [],
  }
  const remoteOverride: GateOverrideDecision = {
    ...localOverride,
    id: 'gate-override-team',
    nodeId: 'run-1:n-gate',
    projectId: 'p-payments',
    userId: 'u-review-lead',
    provisional: false,
    status: 'accepted',
  }

  it('maps an accepted Team override back to the paired local Run and node IDs', () => {
    expect(selectRemoteGateOverridesForLocalStore({
      remoteOverrides: [remoteOverride],
      existingOverrides: [],
      localRuns: [run],
      pairing,
    })).toEqual([{
      ...remoteOverride,
      nodeId: 'n-gate',
      projectId: localProject.id,
    }])
  })

  it('skips unpaired, provisional, unknown-node, and equivalent local overrides', () => {
    const equivalent = {
      ...remoteOverride,
      id: 'gate-override-local-copy',
      nodeId: 'n-gate',
      projectId: localProject.id,
    }
    expect(selectRemoteGateOverridesForLocalStore({
      remoteOverrides: [
        remoteOverride,
        { ...remoteOverride, id: 'provisional', status: 'provisional', provisional: true },
        { ...remoteOverride, id: 'unknown-node', nodeId: 'run-1:n-other' },
        { ...remoteOverride, id: 'wrong-project', projectId: 'p-admin' },
      ],
      existingOverrides: [equivalent],
      localRuns: [run],
      pairing,
    })).toEqual([])
  })
})
