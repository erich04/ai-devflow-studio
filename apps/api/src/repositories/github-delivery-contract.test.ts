import { describe, expect, it } from 'vitest'
import type { GitHubDeliveryIntent } from '@ai-devflow/shared'
import {
  cloneGitHubCredentialGrant,
  cloneGitHubDeliveryRequest,
  cloneGitHubRepositoryBinding,
  fingerprintGitHubDeliveryRequest,
  githubDeliveryRejection,
  githubDeliveryRejectionMessage,
  type GitHubDeliveryRejectionCode,
  type GitHubDeliveryRequest,
} from './github-delivery-contract'

describe('GitHub Delivery repository contract', () => {
  it('fingerprints the logical intent digest and bounded PR copy deterministically', () => {
    const input = {
      intent: {
        intentDigest: 'a'.repeat(64),
        idempotencyKey: `github-delivery:${'b'.repeat(64)}`,
      } as GitHubDeliveryIntent,
      prTitle: 'Reviewed change',
      prBody: 'Bound delivery evidence.',
    }

    const first = fingerprintGitHubDeliveryRequest(input)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(fingerprintGitHubDeliveryRequest({ ...input })).toBe(first)
    expect(
      fingerprintGitHubDeliveryRequest({
        ...input,
        prBody: 'Changed delivery evidence.',
      }),
    ).not.toBe(first)
  })

  it('clones changed paths and exposes bounded rejection messages', () => {
    const source = {
      changedPaths: ['apps/api/src/example.ts'],
    } as GitHubDeliveryRequest
    const clone = cloneGitHubDeliveryRequest(source)
    clone.changedPaths.push('apps/api/src/other.ts')
    expect(source.changedPaths).toEqual(['apps/api/src/example.ts'])

    const codes: GitHubDeliveryRejectionCode[] = [
      'authentication_forbidden',
      'project_forbidden',
      'role_forbidden',
      'not_found',
      'stale_version',
      'binding_inactive',
      'binding_conflict',
      'invalid_state',
      'intent_conflict',
      'approval_required',
      'approval_conflict',
      'grant_conflict',
      'publication_conflict',
      'pull_request_conflict',
      'expired',
    ]
    for (const code of codes) {
      expect(githubDeliveryRejection(code)).toMatchObject({
        ok: false,
        outcomeCode: code,
        replayed: false,
      })
      expect(githubDeliveryRejectionMessage(code)).toMatch(/^[A-Z].+\.$/)
    }
  })

  it('copies only allowlisted public fields from internal repository records', () => {
    const request = {
      changedPaths: ['apps/api/src/example.ts'],
      requestedByTokenId: 'desktop-token-secret-scope',
      requestFingerprint: 'internal-fingerprint',
    } as unknown as GitHubDeliveryRequest
    const grant = {
      issuedToTokenId: 'desktop-token-secret-scope',
    } as never
    const binding = {
      configuredByUserId: 'internal-user-id',
      revokedAt: '2026-08-11T10:00:00.000Z',
    } as never

    expect(cloneGitHubDeliveryRequest(request)).not.toHaveProperty(
      'requestedByTokenId',
    )
    expect(cloneGitHubDeliveryRequest(request)).not.toHaveProperty(
      'requestFingerprint',
    )
    expect(cloneGitHubCredentialGrant(grant)).not.toHaveProperty(
      'issuedToTokenId',
    )
    expect(cloneGitHubRepositoryBinding(binding)).not.toHaveProperty(
      'configuredByUserId',
    )
    expect(cloneGitHubRepositoryBinding(binding)).not.toHaveProperty(
      'revokedAt',
    )
  })
})
