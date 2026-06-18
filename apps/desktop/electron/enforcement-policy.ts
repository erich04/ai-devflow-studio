import {
  createWarnOnlyDefaultPolicy,
  resolveEffectivePolicy,
  type GateOverrideDecision,
  type LocalProject,
  type PolicySnapshot,
} from '@ai-devflow/shared'

type PolicySnapshotStore = {
  getPolicySnapshot(projectId: string): Promise<PolicySnapshot | null>
  listProjects(): Promise<LocalProject[]>
}

function isLocalProjectId(projectId: string): boolean {
  return projectId.startsWith('local-')
}

export function createBuiltInPolicySnapshot(projectId: string, timestamp = new Date().toISOString()): PolicySnapshot {
  const organizationPolicy = createWarnOnlyDefaultPolicy({ updatedAt: timestamp })
  const effectivePolicy = resolveEffectivePolicy(organizationPolicy, null)

  return {
    projectId,
    organizationPolicy,
    projectOverride: null,
    effectivePolicy,
    version: effectivePolicy.version,
    updatedAt: organizationPolicy.updatedAt,
    syncedAt: timestamp,
    source: 'built_in_default',
  }
}

export function createUnavailablePolicySnapshot(projectId: string, timestamp = new Date().toISOString()): PolicySnapshot {
  return {
    projectId,
    organizationPolicy: null,
    projectOverride: null,
    effectivePolicy: null,
    version: 0,
    updatedAt: timestamp,
    syncedAt: timestamp,
    source: 'unavailable',
  }
}

export async function loadPolicySnapshotForProject(
  store: PolicySnapshotStore,
  projectId: string,
): Promise<PolicySnapshot> {
  const cached = await store.getPolicySnapshot(projectId)
  if (cached) {
    return cached
  }

  const localProjects = await store.listProjects()
  const isPureLocalProject = isLocalProjectId(projectId) || localProjects.some((project) => project.id === projectId)

  return isPureLocalProject
    ? createBuiltInPolicySnapshot(projectId)
    : createUnavailablePolicySnapshot(projectId)
}

export type GateOverrideSettlement =
  | { status: 'confirmed'; override: GateOverrideDecision }
  | { status: 'offline' }
  | { status: 'rejected'; reason: string }

export function resolveLocalGateOverrideSettlement(
  localOverride: GateOverrideDecision,
  settlement: GateOverrideSettlement,
): GateOverrideDecision {
  if (settlement.status === 'confirmed') {
    return {
      ...settlement.override,
      id: localOverride.id,
      provisional: false,
      status: 'accepted',
    }
  }

  if (settlement.status === 'rejected') {
    return {
      ...localOverride,
      provisional: true,
      status: 'rejected',
      reason: settlement.reason,
    }
  }

  return {
    ...localOverride,
    provisional: true,
    status: 'provisional',
  }
}
