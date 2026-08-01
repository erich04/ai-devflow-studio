import { describe, expect, it } from 'vitest'
import {
  WORK_REQUEST_BODY_MAX_LENGTH,
  WORK_REQUEST_ID_MAX_LENGTH,
  WORK_REQUEST_IDEMPOTENCY_KEY_MAX_LENGTH,
  WORK_REQUEST_TITLE_MAX_LENGTH,
  parseWorkRequestClaim,
  parseWorkRequestCreate,
  parseWorkRequestMaterialize,
  parseWorkRequestRecord,
  parseWorkRequestRelease,
} from './index'

function validOpenRecord(): Record<string, unknown> {
  return {
    id: 'wr-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    title: 'Read /Users/alice/private/plan.md',
    request: 'Use API_KEY=sk-secret-value and keep the public API stable.',
    version: 1,
    status: 'open',
    createdByUserId: 'user-1',
    claim: null,
    expiresAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:03:00.000Z',
  }
}

function validPendingClaim(): Record<string, unknown> {
  return {
    runId: 'run-1',
    claimedAt: '2026-08-01T00:01:00.000Z',
    materializedAt: null,
  }
}

describe('Work Request network contract', () => {
  it('returns a fresh allowlisted record with sensitive user text redacted', () => {
    const input = validOpenRecord()

    const result = parseWorkRequestRecord(input)

    expect(result).not.toBe(input)
    expect(result).toEqual({
      id: 'wr-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      title: 'Read [REDACTED:local_absolute_path]',
      request: 'Use [REDACTED:env_secret_assignment] and keep the public API stable.',
      version: 1,
      status: 'open',
      createdByUserId: 'user-1',
      claim: null,
      expiresAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:03:00.000Z',
    })
    expect(Object.keys(result).sort()).toEqual([
      'claim',
      'createdAt',
      'createdByUserId',
      'expiresAt',
      'id',
      'organizationId',
      'projectId',
      'request',
      'status',
      'title',
      'updatedAt',
      'version',
    ])
  })

  it('rejects arrays, missing fields, and unknown top-level fields', () => {
    expect(() => parseWorkRequestRecord([])).toThrow('Invalid Work Request record.')

    const { updatedAt: _updatedAt, ...missingField } = validOpenRecord()
    expect(() => parseWorkRequestRecord(missingField)).toThrow(
      'Invalid Work Request record.',
    )

    expect(() =>
      parseWorkRequestRecord({
        ...validOpenRecord(),
        claimTokenId: 'must-never-cross-the-network',
      }),
    ).toThrow('Invalid Work Request record.')
  })

  it('accepts only bounded identifiers, positive integer versions, and known statuses', () => {
    for (const key of ['id', 'organizationId', 'projectId', 'createdByUserId']) {
      expect(() =>
        parseWorkRequestRecord({ ...validOpenRecord(), [key]: '   ' }),
      ).toThrow('Invalid Work Request record.')
      expect(() =>
        parseWorkRequestRecord({
          ...validOpenRecord(),
          [key]: 'x'.repeat(WORK_REQUEST_ID_MAX_LENGTH + 1),
        }),
      ).toThrow('Invalid Work Request record.')
      expect(() =>
        parseWorkRequestRecord({ ...validOpenRecord(), [key]: ' padded-id ' }),
      ).toThrow('Invalid Work Request record.')
    }

    for (const version of [0, -1, 1.5, 2_147_483_648, Number.MAX_SAFE_INTEGER, Number.NaN, '1']) {
      expect(() =>
        parseWorkRequestRecord({ ...validOpenRecord(), version }),
      ).toThrow('Invalid Work Request record.')
    }

    expect(() =>
      parseWorkRequestRecord({ ...validOpenRecord(), status: 'queued' }),
    ).toThrow('Invalid Work Request record.')
  })

  it('requires non-empty bounded title and request text', () => {
    for (const [key, invalidValue] of [
      ['title', '   '],
      ['title', 'x'.repeat(WORK_REQUEST_TITLE_MAX_LENGTH + 1)],
      ['title', 42],
      ['request', ''],
      ['request', 'x'.repeat(WORK_REQUEST_BODY_MAX_LENGTH + 1)],
      ['request', null],
    ] as const) {
      expect(() =>
        parseWorkRequestRecord({ ...validOpenRecord(), [key]: invalidValue }),
      ).toThrow('Invalid Work Request record.')
    }

    expect(
      parseWorkRequestRecord({
        ...validOpenRecord(),
        title: 't'.repeat(WORK_REQUEST_TITLE_MAX_LENGTH),
        request: 'r'.repeat(WORK_REQUEST_BODY_MAX_LENGTH),
      }),
    ).toMatchObject({
      title: 't'.repeat(WORK_REQUEST_TITLE_MAX_LENGTH),
      request: 'r'.repeat(WORK_REQUEST_BODY_MAX_LENGTH),
    })

    const expandedByRedaction = parseWorkRequestRecord({
      ...validOpenRecord(),
      title: `${'t'.repeat(WORK_REQUEST_TITLE_MAX_LENGTH - 10)} sk-abcdef`,
    }).title
    expect(expandedByRedaction.length).toBeLessThanOrEqual(
      WORK_REQUEST_TITLE_MAX_LENGTH,
    )
    expect(expandedByRedaction).not.toContain('sk-abcdef')
  })

  it('accepts only canonical ISO timestamps and permits a null expiry', () => {
    expect(
      parseWorkRequestRecord({
        ...validOpenRecord(),
        expiresAt: '2026-08-02T00:00:00.000Z',
      }).expiresAt,
    ).toBe('2026-08-02T00:00:00.000Z')
    expect(parseWorkRequestRecord(validOpenRecord()).expiresAt).toBeNull()

    for (const [key, invalidValue] of [
      ['createdAt', null],
      ['updatedAt', '2026-08-01T00:00:00Z'],
      ['expiresAt', 'tomorrow'],
      ['expiresAt', '2026-08-02T00:00:00+00:00'],
    ] as const) {
      expect(() =>
        parseWorkRequestRecord({ ...validOpenRecord(), [key]: invalidValue }),
      ).toThrow('Invalid Work Request record.')
    }
  })

  it('returns a fresh exact claim without accepting local token metadata', () => {
    const claim = validPendingClaim()
    const result = parseWorkRequestRecord({
      ...validOpenRecord(),
      status: 'claim_pending',
      claim,
    })

    expect(result.claim).not.toBe(claim)
    expect(result.claim).toEqual({
      runId: 'run-1',
      claimedAt: '2026-08-01T00:01:00.000Z',
      materializedAt: null,
    })

    for (const invalidClaim of [
      [],
      { ...validPendingClaim(), claimTokenId: 'local-token-id' },
      { runId: 'run-1', claimedAt: '2026-08-01T00:01:00.000Z' },
      { ...validPendingClaim(), runId: ' padded-run ' },
      { ...validPendingClaim(), claimedAt: '2026-08-01T00:01:00Z' },
    ]) {
      expect(() =>
        parseWorkRequestRecord({
          ...validOpenRecord(),
          status: 'claim_pending',
          claim: invalidClaim,
        }),
      ).toThrow('Invalid Work Request record.')
    }
  })

  it('enforces the Work Request status and claim state machine', () => {
    const pendingClaim = validPendingClaim()
    const materializedClaim = {
      ...validPendingClaim(),
      materializedAt: '2026-08-01T00:02:00.000Z',
    }

    for (const [status, claim] of [
      ['open', null],
      ['claim_pending', pendingClaim],
      ['materialized', materializedClaim],
      ['cancelled', null],
      ['cancelled', pendingClaim],
    ] as const) {
      expect(
        parseWorkRequestRecord({ ...validOpenRecord(), status, claim }).status,
      ).toBe(status)
    }

    expect(
      parseWorkRequestRecord({
        ...validOpenRecord(),
        status: 'expired',
        expiresAt: '2026-08-01T00:02:00.000Z',
      }).status,
    ).toBe('expired')

    for (const [status, claim] of [
      ['open', pendingClaim],
      ['claim_pending', null],
      ['claim_pending', materializedClaim],
      ['materialized', null],
      ['materialized', pendingClaim],
      ['cancelled', materializedClaim],
      ['expired', pendingClaim],
      ['expired', materializedClaim],
    ] as const) {
      expect(() =>
        parseWorkRequestRecord({ ...validOpenRecord(), status, claim }),
      ).toThrow('Invalid Work Request record.')
    }
  })

  it('parses a fresh create input and redacts its user-authored text', () => {
    const input = {
      projectId: 'project-1',
      title: 'Change /Users/alice/private/app.ts',
      request: 'Use API_KEY=sk-secret-value while updating the endpoint.',
      idempotencyKey: 'create:project-1:request-1',
      expiresAt: '2026-08-02T00:00:00.000Z',
    }

    const result = parseWorkRequestCreate(input)

    expect(result).not.toBe(input)
    expect(result).toEqual({
      projectId: 'project-1',
      title: 'Change [REDACTED:local_absolute_path]',
      request:
        'Use [REDACTED:env_secret_assignment] while updating the endpoint.',
      idempotencyKey: 'create:project-1:request-1',
      expiresAt: '2026-08-02T00:00:00.000Z',
    })
  })

  it('rejects records whose lifecycle timestamps move backwards', () => {
    expect(
      parseWorkRequestRecord({
        ...validOpenRecord(),
        status: 'materialized',
        claim: {
          ...validPendingClaim(),
          materializedAt: '2026-08-01T00:01:00.000Z',
        },
        expiresAt: '2026-08-02T00:00:00.000Z',
      }).status,
    ).toBe('materialized')

    for (const changes of [
      { updatedAt: '2026-07-31T23:59:59.999Z' },
      { expiresAt: '2026-08-01T00:00:00.000Z' },
      { status: 'expired', expiresAt: null },
      {
        status: 'expired',
        expiresAt: '2026-08-01T00:04:00.000Z',
      },
      {
        status: 'claim_pending',
        claim: {
          ...validPendingClaim(),
          claimedAt: '2026-07-31T23:59:59.999Z',
        },
      },
      {
        status: 'claim_pending',
        expiresAt: '2026-08-01T00:01:00.000Z',
        claim: validPendingClaim(),
      },
      {
        status: 'claim_pending',
        updatedAt: '2026-08-01T00:00:30.000Z',
        claim: validPendingClaim(),
      },
      {
        status: 'materialized',
        claim: {
          ...validPendingClaim(),
          materializedAt: '2026-08-01T00:00:59.999Z',
        },
      },
      {
        status: 'materialized',
        updatedAt: '2026-08-01T00:01:30.000Z',
        claim: {
          ...validPendingClaim(),
          materializedAt: '2026-08-01T00:02:00.000Z',
        },
      },
    ]) {
      expect(() =>
        parseWorkRequestRecord({ ...validOpenRecord(), ...changes }),
      ).toThrow('Invalid Work Request record.')
    }
  })

  it('rejects non-exact or out-of-bounds create input', () => {
    const validCreate = {
      projectId: 'project-1',
      title: 'Implement the endpoint',
      request: 'Keep the public response stable.',
      idempotencyKey: 'create:project-1:request-1',
      expiresAt: null,
    }

    for (const invalidValue of [
      [],
      { ...validCreate, tokenId: 'must-stay-local' },
      { ...validCreate, projectId: ' project-1 ' },
      {
        ...validCreate,
        idempotencyKey: 'x'.repeat(
          WORK_REQUEST_IDEMPOTENCY_KEY_MAX_LENGTH + 1,
        ),
      },
      { ...validCreate, idempotencyKey: ' padded-key ' },
      { ...validCreate, title: 'x'.repeat(WORK_REQUEST_TITLE_MAX_LENGTH + 1) },
      { ...validCreate, request: 'x'.repeat(WORK_REQUEST_BODY_MAX_LENGTH + 1) },
      { ...validCreate, expiresAt: '2026-08-02T00:00:00Z' },
    ]) {
      expect(() => parseWorkRequestCreate(invalidValue)).toThrow(
        'Invalid Work Request create input.',
      )
    }

    const { request: _request, ...missingRequest } = validCreate
    expect(() => parseWorkRequestCreate(missingRequest)).toThrow(
      'Invalid Work Request create input.',
    )
  })

  it('parses a fresh exact claim input with optimistic concurrency metadata', () => {
    const input = {
      workRequestId: 'wr-1',
      expectedVersion: 2,
      runId: 'run-1',
      idempotencyKey: 'claim:wr-1:run-1',
    }

    const result = parseWorkRequestClaim(input)

    expect(result).not.toBe(input)
    expect(result).toEqual(input)
    expect(Object.keys(result).sort()).toEqual([
      'expectedVersion',
      'idempotencyKey',
      'runId',
      'workRequestId',
    ])
  })

  it('rejects non-exact or out-of-bounds claim input', () => {
    const validClaimInput = {
      workRequestId: 'wr-1',
      expectedVersion: 1,
      runId: 'run-1',
      idempotencyKey: 'claim:wr-1:run-1',
    }

    for (const invalidValue of [
      [],
      { ...validClaimInput, tokenId: 'must-stay-local' },
      { ...validClaimInput, workRequestId: '' },
      {
        ...validClaimInput,
        workRequestId: 'x'.repeat(WORK_REQUEST_ID_MAX_LENGTH + 1),
      },
      { ...validClaimInput, runId: ' run-1 ' },
      { ...validClaimInput, expectedVersion: 0 },
      { ...validClaimInput, expectedVersion: 1.5 },
      { ...validClaimInput, expectedVersion: 2_147_483_648 },
      { ...validClaimInput, expectedVersion: '1' },
      { ...validClaimInput, idempotencyKey: ' claim-key ' },
    ]) {
      expect(() => parseWorkRequestClaim(invalidValue)).toThrow(
        'Invalid Work Request claim input.',
      )
    }

    const { runId: _runId, ...missingRun } = validClaimInput
    expect(() => parseWorkRequestClaim(missingRun)).toThrow(
      'Invalid Work Request claim input.',
    )
  })

  it('parses a fresh exact materialize input with optimistic concurrency metadata', () => {
    const input = {
      workRequestId: 'wr-1',
      expectedVersion: 2,
      runId: 'run-1',
      idempotencyKey: 'materialize:wr-1:run-1',
    }

    const result = parseWorkRequestMaterialize(input)

    expect(result).not.toBe(input)
    expect(result).toEqual(input)
    expect(Object.keys(result).sort()).toEqual([
      'expectedVersion',
      'idempotencyKey',
      'runId',
      'workRequestId',
    ])
  })

  it('rejects non-exact or out-of-bounds materialize input', () => {
    const validMaterialize = {
      workRequestId: 'wr-1',
      expectedVersion: 2,
      runId: 'run-1',
      idempotencyKey: 'materialize:wr-1:run-1',
    }

    for (const invalidValue of [
      [],
      { ...validMaterialize, claimTokenId: 'must-stay-local' },
      { ...validMaterialize, workRequestId: ' wr-1 ' },
      { ...validMaterialize, runId: '' },
      { ...validMaterialize, expectedVersion: Number.NaN },
      { ...validMaterialize, expectedVersion: 2_147_483_648 },
      {
        ...validMaterialize,
        idempotencyKey: 'x'.repeat(
          WORK_REQUEST_IDEMPOTENCY_KEY_MAX_LENGTH + 1,
        ),
      },
    ]) {
      expect(() => parseWorkRequestMaterialize(invalidValue)).toThrow(
        'Invalid Work Request materialize input.',
      )
    }
  })

  it('parses a fresh exact release input with optimistic concurrency metadata', () => {
    const input = {
      workRequestId: 'wr-1',
      expectedVersion: 2,
      idempotencyKey: 'release:wr-1:v2',
    }

    const result = parseWorkRequestRelease(input)

    expect(result).not.toBe(input)
    expect(result).toEqual(input)
    expect(Object.keys(result).sort()).toEqual([
      'expectedVersion',
      'idempotencyKey',
      'workRequestId',
    ])
  })

  it('rejects non-exact or out-of-bounds release input', () => {
    const validRelease = {
      workRequestId: 'wr-1',
      expectedVersion: 2,
      idempotencyKey: 'release:wr-1:v2',
    }

    for (const invalidValue of [
      [],
      { ...validRelease, runId: 'renderer-must-not-release-by-run' },
      { ...validRelease, workRequestId: ' wr-1 ' },
      { ...validRelease, expectedVersion: 0 },
      { ...validRelease, expectedVersion: 2_147_483_648 },
      { ...validRelease, idempotencyKey: ' release-key ' },
    ]) {
      expect(() => parseWorkRequestRelease(invalidValue)).toThrow(
        'Invalid Work Request release input.',
      )
    }
  })
})
