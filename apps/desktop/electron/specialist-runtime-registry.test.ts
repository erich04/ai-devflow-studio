import { describe, expect, it } from 'vitest'
import {
  getAcceptedSpecialistRoleIds,
  listSpecialistDescriptors,
  resolveSpecialistDescriptor,
  resolveSpecialistToolLeasePolicy,
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

  it('maps only fixed Native Tools to attenuated Specialist lease capabilities', () => {
    expect([
      'repo.list_entries',
      'repo.read_text',
      'workspace.write_text',
      'project.run_saved_test',
      'workspace.run_saved_test',
      'scenario.evaluate',
    ].map((toolId) => resolveSpecialistToolLeasePolicy(toolId))).toEqual([
      { capabilityId: 'repository_read', acceptedModes: ['read', 'write'] },
      { capabilityId: 'repository_read', acceptedModes: ['read', 'write'] },
      { capabilityId: 'managed_workspace_edit', acceptedModes: ['write'] },
      { capabilityId: 'saved_test', acceptedModes: ['read', 'write'] },
      { capabilityId: 'saved_test', acceptedModes: ['read', 'write'] },
      { capabilityId: 'deterministic_evaluation', acceptedModes: ['read', 'write'] },
    ])
    expect(() => resolveSpecialistToolLeasePolicy('renderer.tool'))
      .toThrowError('specialist_tool_not_registered')
    expect(() => resolveSpecialistToolLeasePolicy({ toolId: 'repo.read_text' }))
      .toThrowError('specialist_tool_not_registered')
  })
})
