import { describe, expect, it } from 'vitest'
import {
  fingerprintWorkRequestOperation,
  safeWorkRequest,
  workRequestRejectionMessage,
} from './work-request-contract'

describe('Work Request repository contract', () => {
  it('uses stable operation-scoped fingerprints', () => {
    const input = {
      projectId: 'p-payments',
      title: 'Prepare rollout',
      request: 'Keep the rollout reversible.',
      idempotencyKey: 'create:rollout',
      expiresAt: null,
    }

    expect(fingerprintWorkRequestOperation('work_request_create', input)).toBe(
      fingerprintWorkRequestOperation('work_request_create', { ...input }),
    )
    expect(fingerprintWorkRequestOperation('work_request_create', input)).not.toBe(
      fingerprintWorkRequestOperation('work_request_claim', {
        workRequestId: 'wr-1',
        expectedVersion: 1,
        runId: 'run-1',
        idempotencyKey: 'create:rollout',
      }),
    )
  })

  it('re-parses records before they leave the repository boundary', () => {
    expect(() =>
      safeWorkRequest({
        id: 'wr-1',
        organizationId: 'org-demo',
        projectId: 'p-payments',
        title: 'Prepare rollout',
        request: 'Keep the rollout reversible.',
        version: 1,
        status: 'open',
        createdByUserId: 'u-ling',
        claim: null,
        expiresAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        claimedByTokenId: 'must-not-cross-boundary',
      }),
    ).toThrow('Invalid Work Request record.')
  })

  it('maps every rejection to a fixed safe message', () => {
    expect(workRequestRejectionMessage('idempotency_conflict')).toBe(
      'Idempotency key was already used for a different request.',
    )
    expect(workRequestRejectionMessage('expired')).not.toContain('token')
  })
})
