import type { DesktopPairingCredential } from '@ai-devflow/shared'
import { describe, expect, it } from 'vitest'
import { resolveTrustedCodingPermissionReply } from './coding-permission-authority'

const pairing: DesktopPairingCredential = {
  tokenId: 'pair-token-1',
  organizationId: 'org-1',
  projectId: 'team-project-1',
  localProjectId: 'local-project-1',
  userId: 'paired-user-1',
  userName: 'Paired User',
  role: 'lead',
  authAccountId: 'account-1',
  projectMemberships: [
    { projectId: 'team-project-1', userId: 'paired-user-1', role: 'lead' },
  ],
  createdAt: '2026-08-30T00:00:00.000Z',
}

describe('coding permission reply authority', () => {
  it('replaces a renderer-supplied identity with the trusted local pairing identity', () => {
    expect(resolveTrustedCodingPermissionReply({
      input: {
        requestId: 'permission-1',
        codingRunId: 'coding-run-1',
        decidedBy: 'forged-renderer-user',
        decision: 'approved',
        comment: 'Approve bounded worktree write.',
      },
      projectId: 'local-project-1',
      pairing,
    })).toEqual({
      requestId: 'permission-1',
      codingRunId: 'coding-run-1',
      decidedBy: 'paired-user-1',
      decision: 'approved',
      comment: 'Approve bounded worktree write.',
    })
  })

  it.each([
    { name: 'missing pairing', pairing: null },
    { name: 'different local project', pairing: { ...pairing, localProjectId: 'local-project-2' } },
    { name: 'unproven membership', pairing: { ...pairing, projectMemberships: [] } },
  ])('fails closed for $name', ({ pairing: candidate }) => {
    expect(() => resolveTrustedCodingPermissionReply({
      input: {
        requestId: 'permission-1',
        codingRunId: 'coding-run-1',
        decidedBy: 'forged-renderer-user',
        decision: 'approved',
        comment: '',
      },
      projectId: 'local-project-1',
      pairing: candidate,
    })).toThrow('Coding permission reply requires the current trusted project pairing')
  })
})
