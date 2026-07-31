import {
  createWarnOnlyDefaultPolicy,
  resolveEffectivePolicy,
  type GateOverrideDecision,
  type DesktopPairingCredential,
  type LocalProject,
  type PolicySnapshot,
  type WorkflowRun,
} from '@ai-devflow/shared'

type PolicySnapshotStore = {
  getPolicySnapshot(projectId: string): Promise<PolicySnapshot | null>
  listProjects(): Promise<LocalProject[]>
}

function isLocalProjectId(projectId: string): boolean {
  return projectId.startsWith('local-')
}

export function createBuiltInPolicySnapshot(projectId: string, timestamp = new Date().toISOString()): PolicySnapshot {
  const organizationPolicy = createWarnOnlyDefaultPolicy({
    organizationId: `local-policy-${projectId}`,
    updatedAt: timestamp,
  })
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

function hasSameBlockerSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return leftSet.size === rightSet.size && [...leftSet].every((id) => rightSet.has(id))
}

export function selectRemoteGateOverridesForLocalStore(input: {
  remoteOverrides: GateOverrideDecision[]
  existingOverrides: GateOverrideDecision[]
  localRuns: WorkflowRun[]
  pairing: DesktopPairingCredential | null
}): GateOverrideDecision[] {
  if (!input.pairing?.localProjectId) {
    return []
  }

  return input.remoteOverrides.flatMap((remoteOverride) => {
    if (
      remoteOverride.projectId !== input.pairing?.projectId ||
      remoteOverride.status !== 'accepted' ||
      remoteOverride.provisional
    ) {
      return []
    }

    const run = input.localRuns.find(
      (candidate) =>
        candidate.id === remoteOverride.runId &&
        candidate.projectId === input.pairing?.localProjectId,
    )
    if (!run) {
      return []
    }

    const remotePrefix = `${run.id}:`
    const nodeId = remoteOverride.nodeId.startsWith(remotePrefix)
      ? remoteOverride.nodeId.slice(remotePrefix.length)
      : remoteOverride.nodeId
    if (!run.nodes.some((node) => node.id === nodeId)) {
      return []
    }

    const localOverride: GateOverrideDecision = {
      ...remoteOverride,
      nodeId,
      projectId: run.projectId,
      provisional: false,
      status: 'accepted',
    }
    const alreadyStored = input.existingOverrides.some(
      (existing) =>
        existing.id === localOverride.id ||
        (existing.runId === localOverride.runId &&
          existing.nodeId === localOverride.nodeId &&
          existing.userId === localOverride.userId &&
          existing.status === 'accepted' &&
          existing.policyVersion === localOverride.policyVersion &&
          existing.reason === localOverride.reason &&
          hasSameBlockerSet(existing.blockedReasonIds, localOverride.blockedReasonIds)),
    )
    return alreadyStored ? [] : [localOverride]
  })
}
