import { describe, expect, it } from 'vitest'
import {
  canAccessProject,
  canSatisfyRole,
  canSyncProject,
  createDemoSession,
  resolveRequestSession,
} from './session'

describe('API session boundary', () => {
  it('parses a demo request session from explicit headers', () => {
    const session = resolveRequestSession({
      'x-devflow-organization-id': 'org-demo',
      'x-devflow-user-id': 'u-ling',
      'x-devflow-user-role': 'lead',
      'x-devflow-project-roles': 'p-payments:lead,p-admin:member',
    }, { allowDemoFallback: false })

    expect(session).toEqual({
      organizationId: 'org-demo',
      userId: 'u-ling',
      role: 'lead',
      projectMemberships: [
        { projectId: 'p-payments', userId: 'u-ling', role: 'lead' },
        { projectId: 'p-admin', userId: 'u-ling', role: 'member' },
      ],
    })
  })

  it('returns null when auth headers are missing and demo fallback is disabled', () => {
    expect(resolveRequestSession({}, { allowDemoFallback: false })).toBeNull()
  })

  it('keeps owner, lead, and member gate roles ordered like workflow gates', () => {
    expect(canSatisfyRole('owner', 'lead')).toBe(true)
    expect(canSatisfyRole('lead', 'member')).toBe(true)
    expect(canSatisfyRole('member', 'lead')).toBe(false)
  })

  it('uses organization owner as the demo fallback session', () => {
    const session = resolveRequestSession({})

    expect(session).toEqual(createDemoSession())
    expect(canAccessProject(session!, 'p-payments')).toBe(true)
    expect(canSyncProject(session!, 'p-payments', 'owner')).toBe(true)
  })

  it('limits non-owner access to explicit project memberships', () => {
    const session = resolveRequestSession({
      'x-devflow-organization-id': 'org-demo',
      'x-devflow-user-id': 'u-yu',
      'x-devflow-user-role': 'member',
      'x-devflow-project-roles': 'p-payments:member',
    }, { allowDemoFallback: false })

    expect(canAccessProject(session!, 'p-payments')).toBe(true)
    expect(canAccessProject(session!, 'p-admin')).toBe(false)
    expect(canSyncProject(session!, 'p-payments', 'member')).toBe(true)
    expect(canSyncProject(session!, 'p-payments', 'lead')).toBe(false)
  })
})
