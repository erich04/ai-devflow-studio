import { describe, expect, it } from 'vitest'
import {
  fingerprintGateCommandCreate,
  gateCommandRejectionMessage,
  safeGateCommand,
} from './gate-command-contract'

function validGateCommand() {
  return {
    id: 'gate-command-1',
    version: 1,
    organizationId: 'org-demo',
    projectId: 'p-payments',
    workRequestId: 'wr-1',
    runId: 'run-1',
    nodeId: 'gate-1',
    action: 'approve',
    workflowCommand: 'approve_gate',
    reason: 'Reviewed current projection.',
    requestedByUserId: 'u-lead',
    requestedRole: 'lead',
    idempotencyKey: 'gate:create:run-1:v3',
    requestFingerprint: 'a'.repeat(64),
    expectedRunVersion: 3,
    expectedPolicyVersion: 2,
    expectedBlockerIds: [],
    evaluationStatus: 'allowed',
    evaluationBlockerIds: [],
    evaluatedAt: '2026-08-01T00:00:00.000Z',
    status: 'pending',
    outcomeCode: null,
    expiresAt: '2026-08-01T00:15:00.000Z',
    createdAt: '2026-08-01T00:00:01.000Z',
    updatedAt: '2026-08-01T00:00:01.000Z',
  } as const
}

describe('Gate Command repository contract', () => {
  it('uses a stable create fingerprint over only strict browser input', () => {
    const input = {
      projectId: 'p-payments',
      runId: 'run-1',
      nodeId: 'gate-1',
      action: 'approve' as const,
      reason: 'Reviewed current projection.',
      expectedRunVersion: 3,
      expectedPolicyVersion: 2,
      expectedBlockerIds: ['blocker-a'],
      idempotencyKey: 'gate:create:run-1:v3',
    }

    expect(fingerprintGateCommandCreate(input)).toBe(
      fingerprintGateCommandCreate({
        ...input,
        expectedBlockerIds: [...input.expectedBlockerIds],
      }),
    )
    expect(fingerprintGateCommandCreate(input)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('re-parses the public record and rejects internal delivery authority', () => {
    expect(safeGateCommand(validGateCommand())).toEqual(validGateCommand())
    expect(() =>
      safeGateCommand({
        ...validGateCommand(),
        authKind: 'session_cookie',
        authTokenRecordId: 'must-not-cross-boundary',
      }),
    ).toThrow('Invalid Gate Command record.')
  })

  it('maps denials to fixed, non-sensitive messages', () => {
    expect(gateCommandRejectionMessage('stale_run')).toBe(
      'The Team Run projection changed; refresh before submitting another command.',
    )
    expect(gateCommandRejectionMessage('claimant_forbidden')).not.toContain(
      'token',
    )
    expect(gateCommandRejectionMessage('authoritative_state_unavailable')).not.toContain(
      'database',
    )
  })
})
