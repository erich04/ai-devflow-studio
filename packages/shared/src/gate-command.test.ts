import { describe, expect, it } from 'vitest'
import {
  GATE_COMMAND_BLOCKER_COUNT_MAX,
  GATE_COMMAND_BLOCKER_ID_MAX_LENGTH,
  GATE_COMMAND_ACKNOWLEDGEMENT_OUTCOME_CODES,
  GATE_COMMAND_ID_MAX_LENGTH,
  GATE_COMMAND_IDEMPOTENCY_KEY_MAX_LENGTH,
  GATE_COMMAND_INT4_MAX,
  GATE_COMMAND_OUTCOME_CODES,
  GATE_COMMAND_MAX_TTL_MS,
  GATE_COMMAND_RECEIPT_MAX_LEASE_MS,
  GATE_COMMAND_REASON_MAX_LENGTH,
  parseGateCommandAcknowledgementCreate,
  parseGateCommandAcknowledgementRecord,
  parseGateCommandCreate,
  parseGateCommandReceiptRecord,
  parseGateCommandRecord,
} from './index'

function validGateCommand(): Record<string, unknown> {
  return {
    id: 'gate-command-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    workRequestId: 'wr-1',
    runId: 'run-1',
    nodeId: 'gate-1',
    action: 'approve',
    workflowCommand: 'approve_gate',
    reason: 'Review /Users/alice/private/plan.md with API_KEY=sk-secret.',
    requestedByUserId: 'user-1',
    requestedRole: 'lead',
    idempotencyKey: 'gate:run-1:gate-1:v3',
    requestFingerprint: 'a'.repeat(64),
    expectedRunVersion: 3,
    expectedPolicyVersion: 0,
    expectedBlockerIds: [],
    version: 1,
    evaluationStatus: 'allowed',
    evaluationBlockerIds: [],
    evaluatedAt: '2026-08-01T00:00:00.000Z',
    status: 'pending',
    outcomeCode: null,
    expiresAt: '2026-08-01T00:15:00.000Z',
    createdAt: '2026-08-01T00:00:01.000Z',
    updatedAt: '2026-08-01T00:00:01.000Z',
  }
}

describe('Gate Command network contract', () => {
  it('parses only the browser-owned create fields and redacts the reason', () => {
    const input = {
      projectId: 'project-1',
      runId: 'run-1',
      nodeId: 'gate-1',
      action: 'approve',
      reason: 'Review /Users/alice/private/plan.md with API_KEY=sk-secret.',
      expectedRunVersion: 3,
      expectedPolicyVersion: 0,
      expectedBlockerIds: ['blocker-a', 'blocker-b'],
      idempotencyKey: 'gate:run-1:gate-1:v3',
    }

    const result = parseGateCommandCreate(input)

    expect(result).not.toBe(input)
    expect(result.expectedBlockerIds).not.toBe(input.expectedBlockerIds)
    expect(result).toEqual({
      ...input,
      reason:
        'Review [REDACTED:local_absolute_path] with [REDACTED:env_secret_assignment]',
    })
    expect(Object.keys(result).sort()).toEqual([
      'action',
      'expectedBlockerIds',
      'expectedPolicyVersion',
      'expectedRunVersion',
      'idempotencyKey',
      'nodeId',
      'projectId',
      'reason',
      'runId',
    ])

    expect(() =>
      parseGateCommandCreate({
        ...input,
        requestedByUserId: 'browser-must-not-choose-identity',
      }),
    ).toThrow('Invalid Gate Command create input.')
  })

  it('returns a fresh, allowlisted Gate Command record', () => {
    const input = validGateCommand()
    const result = parseGateCommandRecord(input)

    expect(result).not.toBe(input)
    expect(result.expectedBlockerIds).not.toBe(input.expectedBlockerIds)
    expect(result.evaluationBlockerIds).not.toBe(input.evaluationBlockerIds)
    expect(result).toEqual({
      ...input,
      reason:
        'Review [REDACTED:local_absolute_path] with [REDACTED:env_secret_assignment]',
    })
    expect(Object.keys(result).sort()).toEqual(Object.keys(input).sort())
  })

  it('rejects an allowed record whose evaluated blockers differ from the browser snapshot', () => {
    expect(() =>
      parseGateCommandRecord({
        ...validGateCommand(),
        expectedBlockerIds: ['blocker-a'],
        evaluationBlockerIds: [],
      }),
    ).toThrow('Invalid Gate Command record.')
  })

  it('returns a receipt without exposing its leased Desktop token identity', () => {
    const input = {
      id: 'receipt-1',
      commandId: 'gate-command-1',
      attempt: 1,
      leasedAt: '2026-08-01T00:01:00.000Z',
      leaseExpiresAt: '2026-08-01T00:02:00.000Z',
      acknowledgedAt: null,
    }

    const result = parseGateCommandReceiptRecord(input)

    expect(result).not.toBe(input)
    expect(result).toEqual(input)
    expect(Object.keys(result).sort()).toEqual([
      'acknowledgedAt',
      'attempt',
      'commandId',
      'id',
      'leaseExpiresAt',
      'leasedAt',
    ])
    expect(() =>
      parseGateCommandReceiptRecord({
        ...input,
        leasedToTokenId: 'must-remain-server-side',
      }),
    ).toThrow('Invalid Gate Command receipt record.')
  })

  it('returns a bounded acknowledgement that cannot act as a Run patch', () => {
    const input = {
      id: 'ack-1',
      commandId: 'gate-command-1',
      receiptId: 'receipt-1',
      outcomeCode: 'human_rejected',
      beforeRunVersion: 3,
      afterRunVersion: 3,
      evaluatedAt: '2026-08-01T00:01:30.000Z',
      createdAt: '2026-08-01T00:01:31.000Z',
    }

    const result = parseGateCommandAcknowledgementRecord(input)

    expect(result).not.toBe(input)
    expect(result).toEqual(input)
    expect(Object.keys(result).sort()).toEqual([
      'afterRunVersion',
      'beforeRunVersion',
      'commandId',
      'createdAt',
      'evaluatedAt',
      'id',
      'outcomeCode',
      'receiptId',
    ])
    expect(() =>
      parseGateCommandAcknowledgementRecord({
        ...input,
        runStatus: 'completed',
      }),
    ).toThrow('Invalid Gate Command acknowledgement record.')
  })

  it('parses only Desktop-owned acknowledgement create fields', () => {
    const input = {
      commandId: 'gate-command-1',
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
      evaluatedAt: '2026-08-01T00:01:30.000Z',
    }

    const result = parseGateCommandAcknowledgementCreate(input)

    expect(result).not.toBe(input)
    expect(result).toEqual(input)
    expect(Object.keys(result).sort()).toEqual([
      'afterRunVersion',
      'beforeRunVersion',
      'commandId',
      'evaluatedAt',
      'outcomeCode',
    ])
    expect(() =>
      parseGateCommandAcknowledgementCreate({
        ...input,
        receiptId: 'server-derives-receipt-from-lease-context',
      }),
    ).toThrow('Invalid Gate Command acknowledgement create input.')
  })

  it('rejects malformed create fields and non-canonical blocker sets', () => {
    const validCreate = {
      projectId: 'project-1',
      runId: 'run-1',
      nodeId: 'gate-1',
      action: 'reject',
      reason: 'The acceptance evidence is incomplete.',
      expectedRunVersion: 3,
      expectedPolicyVersion: 0,
      expectedBlockerIds: ['blocker-a', 'blocker-b'],
      idempotencyKey: 'gate:run-1:gate-1:v3',
    }

    for (const invalidValue of [
      [],
      { ...validCreate, organizationId: 'server-derived' },
      { ...validCreate, workflowCommand: 'approve_gate' },
      { ...validCreate, projectId: ' project-1 ' },
      { ...validCreate, runId: '' },
      { ...validCreate, nodeId: 'run-1:gate-1' },
      { ...validCreate, nodeId: 'x'.repeat(GATE_COMMAND_ID_MAX_LENGTH + 1) },
      { ...validCreate, action: 'cancel' },
      { ...validCreate, reason: '   ' },
      {
        ...validCreate,
        reason: 'x'.repeat(GATE_COMMAND_REASON_MAX_LENGTH + 1),
      },
      { ...validCreate, expectedRunVersion: 0 },
      { ...validCreate, expectedRunVersion: 1.5 },
      { ...validCreate, expectedRunVersion: GATE_COMMAND_INT4_MAX + 1 },
      { ...validCreate, expectedPolicyVersion: -1 },
      { ...validCreate, expectedPolicyVersion: '0' },
      { ...validCreate, expectedBlockerIds: ['blocker-b', 'blocker-a'] },
      { ...validCreate, expectedBlockerIds: ['blocker-a', 'blocker-a'] },
      { ...validCreate, expectedBlockerIds: [' padded-blocker '] },
      {
        ...validCreate,
        expectedBlockerIds: [
          'x'.repeat(GATE_COMMAND_BLOCKER_ID_MAX_LENGTH + 1),
        ],
      },
      {
        ...validCreate,
        expectedBlockerIds: Array.from(
          { length: GATE_COMMAND_BLOCKER_COUNT_MAX + 1 },
          (_, index) => `blocker-${String(index).padStart(3, '0')}`,
        ),
      },
      {
        ...validCreate,
        idempotencyKey: 'x'.repeat(
          GATE_COMMAND_IDEMPOTENCY_KEY_MAX_LENGTH + 1,
        ),
      },
      { ...validCreate, idempotencyKey: ' padded-key ' },
    ]) {
      expect(() => parseGateCommandCreate(invalidValue)).toThrow(
        'Invalid Gate Command create input.',
      )
    }

    const { reason: _reason, ...missingReason } = validCreate
    expect(() => parseGateCommandCreate(missingReason)).toThrow(
      'Invalid Gate Command create input.',
    )

    expect(
      parseGateCommandCreate({
        ...validCreate,
        expectedRunVersion: GATE_COMMAND_INT4_MAX,
        expectedPolicyVersion: GATE_COMMAND_INT4_MAX,
        expectedBlockerIds: [],
        reason: 'x'.repeat(GATE_COMMAND_REASON_MAX_LENGTH),
      }),
    ).toMatchObject({
      expectedRunVersion: GATE_COMMAND_INT4_MAX,
      expectedPolicyVersion: GATE_COMMAND_INT4_MAX,
      expectedBlockerIds: [],
    })
  })

  it('enforces the Gate Command lifecycle, action, and terminal outcome mapping', () => {
    for (const changes of [
      { status: 'pending', outcomeCode: null },
      { status: 'delivering', outcomeCode: null, version: 2 },
      { status: 'applied', outcomeCode: 'applied', version: 3 },
      {
        action: 'reject',
        workflowCommand: null,
        status: 'applied',
        outcomeCode: 'human_rejected',
        version: 3,
      },
      ...[
        'requester_revoked',
        'scope_mismatch',
        'run_not_found',
        'stale_run',
        'stale_policy',
        'blockers_changed',
        'evidence_blocked',
        'authorization_denied',
      ].map((outcomeCode) => ({
        status: 'rejected',
        outcomeCode,
        version: 3,
      })),
      {
        status: 'expired',
        outcomeCode: 'expired',
        version: 2,
        updatedAt: '2026-08-01T00:15:00.000Z',
      },
    ]) {
      expect(
        parseGateCommandRecord({ ...validGateCommand(), ...changes }),
      ).toMatchObject(changes)
    }

    for (const changes of [
      { status: 'pending', outcomeCode: 'applied' },
      { status: 'delivering', outcomeCode: 'stale_run' },
      { status: 'applied', outcomeCode: null },
      { status: 'applied', outcomeCode: 'human_rejected' },
      { status: 'rejected', outcomeCode: 'expired' },
      { status: 'expired', outcomeCode: null },
      { action: 'reject', workflowCommand: 'approve_gate' },
      { action: 'approve', workflowCommand: null },
      { action: 'approve', workflowCommand: 'complete_build' },
    ]) {
      expect(() =>
        parseGateCommandRecord({ ...validGateCommand(), ...changes }),
      ).toThrow('Invalid Gate Command record.')
    }
  })

  it('rejects unsafe, non-exact, or internally inconsistent command records', () => {
    expect(
      parseGateCommandRecord({ ...validGateCommand(), workRequestId: null })
        .workRequestId,
    ).toBeNull()

    for (const invalidValue of [
      [],
      { ...validGateCommand(), bearerToken: 'must-never-cross-the-network' },
      { ...validGateCommand(), nodeId: 'run-1:gate-1' },
      { ...validGateCommand(), authTokenRecordId: 'server-only-attribution' },
      { ...validGateCommand(), version: 0 },
      { ...validGateCommand(), version: GATE_COMMAND_INT4_MAX + 1 },
      { ...validGateCommand(), requestedRole: 'admin' },
      { ...validGateCommand(), requestFingerprint: 'A'.repeat(64) },
      { ...validGateCommand(), requestFingerprint: 'a'.repeat(63) },
      {
        ...validGateCommand(),
        expectedBlockerIds: ['blocker-b', 'blocker-a'],
      },
      {
        ...validGateCommand(),
        evaluationStatus: 'blocked',
        evaluationBlockerIds: [],
        status: 'rejected',
        outcomeCode: 'authorization_denied',
      },
      {
        ...validGateCommand(),
        evaluationStatus: 'blocked',
        evaluationBlockerIds: ['policy-denied'],
      },
      { ...validGateCommand(), evaluatedAt: '2026-08-01T00:00:00Z' },
      { ...validGateCommand(), evaluatedAt: '2026-08-01T00:00:02.000Z' },
      { ...validGateCommand(), createdAt: '2026-08-01T00:15:00.000Z' },
      { ...validGateCommand(), updatedAt: '2026-07-31T23:59:59.999Z' },
      {
        ...validGateCommand(),
        status: 'expired',
        outcomeCode: 'expired',
        updatedAt: '2026-08-01T00:14:59.999Z',
      },
    ]) {
      expect(() => parseGateCommandRecord(invalidValue)).toThrow(
        'Invalid Gate Command record.',
      )
    }
  })

  it('retains canonical blocker IDs when an accepted override allows preflight', () => {
    expect(
      parseGateCommandRecord({
        ...validGateCommand(),
        expectedBlockerIds: ['policy-blocker-a'],
        evaluationStatus: 'allowed',
        evaluationBlockerIds: ['policy-blocker-a'],
      }),
    ).toMatchObject({
      expectedBlockerIds: ['policy-blocker-a'],
      evaluationStatus: 'allowed',
      evaluationBlockerIds: ['policy-blocker-a'],
    })
  })

  it('accepts only bounded, canonical receipt fields and forward timestamps', () => {
    const validReceipt = {
      id: 'receipt-1',
      commandId: 'gate-command-1',
      attempt: 1,
      leasedAt: '2026-08-01T00:01:00.000Z',
      leaseExpiresAt: '2026-08-01T00:02:00.000Z',
      acknowledgedAt: null,
    }

    expect(
      parseGateCommandReceiptRecord({
        ...validReceipt,
        acknowledgedAt: '2026-08-01T00:02:30.000Z',
      }).acknowledgedAt,
    ).toBe('2026-08-01T00:02:30.000Z')

    for (const invalidValue of [
      [],
      { ...validReceipt, attempt: 0 },
      { ...validReceipt, attempt: 1.5 },
      { ...validReceipt, attempt: GATE_COMMAND_INT4_MAX + 1 },
      { ...validReceipt, commandId: ' command-1 ' },
      { ...validReceipt, leasedAt: '2026-08-01T00:01:00Z' },
      { ...validReceipt, leaseExpiresAt: validReceipt.leasedAt },
      {
        ...validReceipt,
        acknowledgedAt: '2026-08-01T00:00:59.999Z',
      },
    ]) {
      expect(() => parseGateCommandReceiptRecord(invalidValue)).toThrow(
        'Invalid Gate Command receipt record.',
      )
    }
  })

  it('allowlists acknowledgement outcomes and constrains reported Run versions', () => {
    const baseCreate = {
      commandId: 'gate-command-1',
      outcomeCode: 'human_rejected',
      beforeRunVersion: 3,
      afterRunVersion: 3,
      evaluatedAt: '2026-08-01T00:01:30.000Z',
    }

    for (const outcomeCode of GATE_COMMAND_ACKNOWLEDGEMENT_OUTCOME_CODES) {
      const beforeRunVersion = 3
      const afterRunVersion = outcomeCode === 'applied' ? 4 : 3
      expect(
        parseGateCommandAcknowledgementCreate({
          ...baseCreate,
          outcomeCode,
          beforeRunVersion,
          afterRunVersion,
        }).outcomeCode,
      ).toBe(outcomeCode)
    }

    for (const invalidValue of [
      [],
      { ...baseCreate, outcomeCode: 'retry' },
      { ...baseCreate, outcomeCode: 'requester_revoked' },
      { ...baseCreate, beforeRunVersion: 0, afterRunVersion: 0 },
      { ...baseCreate, beforeRunVersion: 3, afterRunVersion: 4 },
      {
        ...baseCreate,
        outcomeCode: 'applied',
        beforeRunVersion: 3,
        afterRunVersion: 3,
      },
      {
        ...baseCreate,
        outcomeCode: 'applied',
        beforeRunVersion: 3,
        afterRunVersion: 5,
      },
      { ...baseCreate, evaluatedAt: '2026-08-01T00:01:30Z' },
    ]) {
      expect(() =>
        parseGateCommandAcknowledgementCreate(invalidValue),
      ).toThrow('Invalid Gate Command acknowledgement create input.')
    }

    const validRecord = {
      id: 'ack-1',
      receiptId: 'receipt-1',
      createdAt: '2026-08-01T00:01:31.000Z',
      ...baseCreate,
    }
    expect(
      parseGateCommandAcknowledgementRecord({
        ...validRecord,
        createdAt: '2026-08-01T00:01:00.000Z',
      }).evaluatedAt,
    ).toBe(baseCreate.evaluatedAt)
    for (const invalidValue of [
      { ...validRecord, createdAt: '2026-08-01T00:00:29.999Z' },
      {
        ...validRecord,
        outcomeCode: 'expired',
        createdAt: '2026-08-01T00:01:29.999Z',
      },
      { ...validRecord, receiptId: ' receipt-1 ' },
      { ...validRecord, outcomeCode: 'unknown' },
    ]) {
      expect(() =>
        parseGateCommandAcknowledgementRecord(invalidValue),
      ).toThrow('Invalid Gate Command acknowledgement record.')
    }
  })

  it('bounds command TTL to 15 minutes and receipt leases to 60 seconds', () => {
    expect(GATE_COMMAND_MAX_TTL_MS).toBe(15 * 60 * 1_000)
    expect(GATE_COMMAND_RECEIPT_MAX_LEASE_MS).toBe(60 * 1_000)

    expect(
      parseGateCommandRecord({
        ...validGateCommand(),
        createdAt: '2026-08-01T00:00:00.000Z',
        expiresAt: '2026-08-01T00:15:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }).expiresAt,
    ).toBe('2026-08-01T00:15:00.000Z')
    expect(() =>
      parseGateCommandRecord({
        ...validGateCommand(),
        createdAt: '2026-08-01T00:00:00.000Z',
        expiresAt: '2026-08-01T00:15:00.001Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }),
    ).toThrow('Invalid Gate Command record.')

    const receipt = {
      id: 'receipt-1',
      commandId: 'gate-command-1',
      attempt: 1,
      leasedAt: '2026-08-01T00:01:00.000Z',
      leaseExpiresAt: '2026-08-01T00:02:00.000Z',
      acknowledgedAt: null,
    }
    expect(parseGateCommandReceiptRecord(receipt)).toEqual(receipt)
    expect(() =>
      parseGateCommandReceiptRecord({
        ...receipt,
        leaseExpiresAt: '2026-08-01T00:02:00.001Z',
      }),
    ).toThrow('Invalid Gate Command receipt record.')
  })
})
