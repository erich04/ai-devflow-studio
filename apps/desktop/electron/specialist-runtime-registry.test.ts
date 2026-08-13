import { describe, expect, it } from 'vitest'
import {
  getAcceptedSpecialistRoleIds,
  listSpecialistDescriptors,
  resolveSpecialistDescriptor,
} from './specialist-runtime-registry'

describe('main-owned Specialist registry', () => {
  it('exposes one fixed bounded role set without a caller registration seam', () => {
    expect(listSpecialistDescriptors()).toEqual([
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
    ])
    expect(getAcceptedSpecialistRoleIds()).toEqual([
      'contract-analyst',
      'test-analyst',
      'bounded-implementer',
    ])
  })

  it('returns isolated descriptors and rejects renderer, model, or Team-created roles', () => {
    const first = listSpecialistDescriptors()
    first[0]!.capabilityIds.push('renderer.escalation')

    expect(resolveSpecialistDescriptor('contract-analyst')).toEqual({
      stateVersion: 1,
      id: 'contract-analyst',
      version: 1,
      capabilityIds: ['repository_read'],
      resourceMode: 'read',
    })
    expect(() => resolveSpecialistDescriptor('renderer-created')).toThrowError(
      'specialist_role_not_registered',
    )
    expect(() => resolveSpecialistDescriptor({ id: 'contract-analyst' })).toThrowError(
      'specialist_role_not_registered',
    )
  })
})
