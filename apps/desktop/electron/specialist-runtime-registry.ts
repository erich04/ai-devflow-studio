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
