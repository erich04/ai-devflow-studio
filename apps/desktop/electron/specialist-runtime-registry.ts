import { createHash } from 'node:crypto'

export const SPECIALIST_RUNTIME_MAX_STEPS = 2
export const SPECIALIST_RUNTIME_MAX_WALL_TIME_MS = 2 * 60_000
export const SPECIALIST_RUNTIME_MAX_TOOL_CALLS = 2
export const SPECIALIST_RUNTIME_MAX_TOKENS = 5_000
export const SPECIALIST_RUNTIME_MAX_COST_USD = 0.5
export const SPECIALIST_RUNTIME_MAX_TOOL_RESULT_BYTES = 64 * 1_024
export const SPECIALIST_RUNTIME_MAX_TRAJECTORY_METADATA_BYTES = 16 * 1_024
export const SPECIALIST_RUNTIME_MAX_CHECKPOINT_BYTES = 128 * 1_024

export type SpecialistRoleId =
  | 'contract-analyst'
  | 'test-analyst'
  | 'bounded-implementer'

export type SpecialistDescriptor = {
  stateVersion: 1
  id: SpecialistRoleId
  version: 1
  capabilityIds: string[]
  resourceMode: 'read' | 'write'
}

const descriptors: readonly Readonly<SpecialistDescriptor>[] = [
  {
    stateVersion: 1,
    id: 'contract-analyst',
    version: 1,
    capabilityIds: ['repository_read'],
    resourceMode: 'read',
  },
  {
    stateVersion: 1,
    id: 'test-analyst',
    version: 1,
    capabilityIds: ['repository_read', 'saved_test'],
    resourceMode: 'read',
  },
  {
    stateVersion: 1,
    id: 'bounded-implementer',
    version: 1,
    capabilityIds: [
      'repository_read',
      'managed_workspace_edit',
      'saved_test',
      'deterministic_evaluation',
    ],
    resourceMode: 'write',
  },
]

function cloneDescriptor(descriptor: Readonly<SpecialistDescriptor>): SpecialistDescriptor {
  return {
    ...descriptor,
    capabilityIds: [...descriptor.capabilityIds],
  }
}

export function listSpecialistDescriptors(): SpecialistDescriptor[] {
  return descriptors.map(cloneDescriptor)
}

export function getAcceptedSpecialistRoleIds(): SpecialistRoleId[] {
  return descriptors.map((descriptor) => descriptor.id)
}

export function resolveSpecialistDescriptor(roleId: unknown): SpecialistDescriptor {
  const descriptor = typeof roleId === 'string'
    ? descriptors.find((candidate) => candidate.id === roleId)
    : undefined
  if (descriptor === undefined) throw new Error('specialist_role_not_registered')
  return cloneDescriptor(descriptor)
}

export function digestSpecialistCapabilitySet(input: {
  roleId: SpecialistRoleId
  roleVersion: 1
  taskContextDigest: string
  capabilityIds: readonly string[]
}): string {
  return createHash('sha256').update(JSON.stringify({
    stateVersion: 1,
    roleId: input.roleId,
    roleVersion: input.roleVersion,
    taskContextDigest: input.taskContextDigest,
    capabilityIds: [...input.capabilityIds],
  })).digest('hex')
}
