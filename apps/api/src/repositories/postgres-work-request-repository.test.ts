import type { TeamDbRepositoryClient } from '../db/client'
import { describe, expect, it } from 'vitest'
import type { RequestPrincipal } from '../auth/request-auth'
import { createPostgresWorkRequestRepository } from './postgres-work-request-repository'

type QueryCall = { sql: string; params: unknown[] }
type QueryHandler = (sql: string, params: unknown[]) => unknown[] | Promise<unknown[]>

const now = '2026-08-01T12:00:00.000Z'

const openRow = {
  id: 'wr-1',
  organization_id: 'org-demo',
  project_id: 'p-payments',
  title: 'Prepare rollout',
  request: 'Keep the rollout reversible.',
  version: 1,
  status: 'open',
  created_by_user_id: 'u-ling',
  claimed_by_token_id: null,
  claimed_run_id: null,
  claimed_at: null,
  materialized_at: null,
  expires_at: '2026-08-02T12:00:00.000Z',
  created_at: now,
  updated_at: now,
}

const cookiePrincipal: RequestPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-ling',
    organizationId: 'org-demo',
    userId: 'u-ling',
    role: 'lead',
    projectMemberships: [
      { projectId: 'p-payments', userId: 'u-ling', role: 'lead' },
    ],
  },
  authentication: { kind: 'session_cookie', tokenRecordId: null },
}

const bearerPrincipal: RequestPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-desktop',
    organizationId: 'org-demo',
    userId: 'u-desktop',
    role: 'member',
    projectMemberships: [
      { projectId: 'p-payments', userId: 'u-desktop', role: 'member' },
    ],
  },
  authentication: {
    kind: 'desktop_bearer',
    tokenRecordId: 'desktop-token-safe-id',
  },
}

function marker(sql: string): string | null {
  return /\/\* work_request:([^*]+) \*\//.exec(sql)?.[1] ?? null
}

class FakeWorkRequestDb implements TeamDbRepositoryClient {
  readonly calls: QueryCall[] = []
  checkoutCount = 0
  releaseCount = 0

  constructor(private readonly handler: QueryHandler) {}

  async checkout(): Promise<this> {
    this.checkoutCount += 1
    return this
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.calls.push({ sql, params })
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return []
    }
    return (await this.handler(sql, params)) as T[]
  }

  release(): void {
    this.releaseCount += 1
  }

  async close(): Promise<void> {}

  markers(): string[] {
    return this.calls.flatMap(({ sql }) => {
      const value = marker(sql)
      return value === null ? [] : [value]
    })
  }
}

function cookieIdentity() {
  return {
    user_id: 'u-ling',
    organization_id: 'org-demo',
    organization_role: 'lead',
    project_role: 'lead',
  }
}

function bearerIdentity() {
  return {
    user_id: 'u-desktop',
    organization_id: 'org-demo',
    project_id: 'p-payments',
    organization_role: 'member',
    project_role: 'member',
  }
}

describe('Postgres Work Request repository', () => {
  it('lists only through a live project-scoped identity and emits an allowlisted record', async () => {
    const db = new FakeWorkRequestDb((sql) => {
      switch (marker(sql)) {
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'list':
          return [{ ...openRow, claimed_by_token_id: 'must-stay-private' }]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresWorkRequestRepository(db, {
      now: () => new Date(now),
    })

    const result = await repository.listWorkRequests('p-payments', cookiePrincipal)

    expect(result).toEqual([
      {
        id: 'wr-1',
        organizationId: 'org-demo',
        projectId: 'p-payments',
        title: 'Prepare rollout',
        request: 'Keep the rollout reversible.',
        version: 1,
        status: 'open',
        createdByUserId: 'u-ling',
        claim: null,
        expiresAt: '2026-08-02T12:00:00.000Z',
        createdAt: now,
        updatedAt: now,
      },
    ])
    expect(JSON.stringify(result)).not.toContain('token')
    const listCall = db.calls.find(({ sql }) => marker(sql) === 'list')
    expect(listCall?.sql).toMatch(/organization_id\s*=\s*\$1/i)
    expect(listCall?.sql).toMatch(/project_id\s*=\s*\$2/i)
    expect(listCall?.params).toEqual(['org-demo', 'p-payments'])
  })

  it('limits the Desktop inbox to open requests and claims owned by its live token record', async () => {
    const db = new FakeWorkRequestDb((sql) => {
      switch (marker(sql)) {
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'list-bearer':
          return [openRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresWorkRequestRepository(db)

    await expect(
      repository.listWorkRequests('p-payments', bearerPrincipal),
    ).resolves.toHaveLength(1)

    const listCall = db.calls.find(({ sql }) => marker(sql) === 'list-bearer')
    expect(listCall?.sql).toMatch(/status\s*=\s*'open'/i)
    expect(listCall?.sql).toMatch(/claimed_by_token_id\s*=\s*\$3/i)
    expect(listCall?.sql).toMatch(/claim_pending/i)
    expect(listCall?.sql).toMatch(/materialized/i)
    expect(listCall?.params).toEqual([
      'org-demo',
      'p-payments',
      'desktop-token-safe-id',
    ])
  })

  it('creates under one transaction after lock, idempotency lookup, and live Cookie recheck', async () => {
    const insertedRow = { ...openRow, id: 'work-request-fixed' }
    const db = new FakeWorkRequestDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'idempotency-read':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'create':
          return [insertedRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresWorkRequestRepository(db, {
      now: () => new Date(now),
      createId: (kind) =>
        kind === 'work_request' ? 'work-request-fixed' : `${kind}-fixed`,
    })

    const result = await repository.createWorkRequest(
      {
        projectId: 'p-payments',
        title: 'Prepare rollout',
        request: 'Keep the rollout reversible.',
        expiresAt: '2026-08-02T12:00:00.000Z',
        idempotencyKey: 'create:rollout',
      },
      cookiePrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'created',
      replayed: false,
      workRequest: { id: 'work-request-fixed', version: 1, status: 'open' },
    })
    expect(db.checkoutCount).toBe(1)
    expect(db.releaseCount).toBe(1)
    expect(db.calls[0]?.sql).toBe('BEGIN')
    expect(db.calls.at(-1)?.sql).toBe('COMMIT')
    expect(db.markers()).toEqual([
      'idempotency-lock',
      'idempotency-read',
      'cookie-identity',
      'create',
      'audit-insert',
      'idempotency-insert',
    ])
    const persistedResponse = db.calls.find(
      ({ sql }) => marker(sql) === 'idempotency-insert',
    )?.params.at(-1)
    expect(String(persistedResponse)).not.toContain('desktop-token-safe-id')
    expect(String(persistedResponse)).not.toMatch(/claimed_by_token_id/i)
  })

  it('claims exactly one open version under live token, project, membership, and revocation scope', async () => {
    const claimedRow = {
      ...openRow,
      version: 2,
      status: 'claim_pending',
      claimed_by_token_id: 'desktop-token-safe-id',
      claimed_run_id: 'run-local-1',
      claimed_at: now,
      updated_at: now,
    }
    const db = new FakeWorkRequestDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
        case 'claim-run-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'project-probe':
          return [{ project_id: 'p-payments' }]
        case 'idempotency-read':
        case 'claim-run-conflict':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'row-lock':
          return [openRow]
        case 'claim':
          return [claimedRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresWorkRequestRepository(db, {
      now: () => new Date(now),
    })

    const result = await repository.claimWorkRequest(
      {
        workRequestId: 'wr-1',
        expectedVersion: 1,
        runId: 'run-local-1',
        idempotencyKey: 'claim:wr-1',
      },
      bearerPrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      outcomeCode: 'claimed',
      workRequest: {
        version: 2,
        status: 'claim_pending',
        claim: { runId: 'run-local-1', materializedAt: null },
      },
    })
    const authCall = db.calls.find(({ sql }) => marker(sql) === 'bearer-identity')
    expect(authCall?.sql).toMatch(/desktop_tokens\.revoked_at\s+IS\s+NULL/i)
    expect(authCall?.sql).toMatch(/project_members/i)
    expect(authCall?.params).toEqual([
      'desktop-token-safe-id',
      'org-demo',
      'u-desktop',
      'p-payments',
    ])
    const rowLock = db.calls.find(({ sql }) => marker(sql) === 'row-lock')
    expect(rowLock?.sql).toMatch(/FOR UPDATE/i)
    expect(rowLock?.sql).toMatch(/organization_id\s*=\s*\$2/i)
    expect(rowLock?.sql).toMatch(/project_id\s*=\s*\$3/i)
  })

  it('rejects a claim when its intended canonical Run ID already exists in the same scope', async () => {
    const db = new FakeWorkRequestDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
        case 'claim-run-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'project-probe':
          return [{ project_id: 'p-payments' }]
        case 'idempotency-read':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'row-lock':
          return [openRow]
        case 'claim-run-conflict':
          return /workflow_runs/i.test(sql)
            ? [{ conflict_kind: 'workflow_run' }]
            : []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresWorkRequestRepository(db, {
      now: () => new Date(now),
    })

    await expect(
      repository.claimWorkRequest(
        {
          workRequestId: 'wr-1',
          expectedVersion: 1,
          runId: 'run-local-1',
          idempotencyKey: 'claim:canonical-collision',
        },
        bearerPrincipal,
      ),
    ).resolves.toEqual({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'claim_conflict',
      replayed: false,
    })

    const conflictCall = db.calls.find(
      ({ sql }) => marker(sql) === 'claim-run-conflict',
    )
    expect(conflictCall?.sql).toMatch(/workflow_runs/i)
    expect(conflictCall?.sql).toMatch(/workflow_runs\.organization_id\s*=\s*\$1/i)
    expect(conflictCall?.sql).toMatch(/workflow_runs\.project_id\s*=\s*\$2/i)
    expect(conflictCall?.params).toEqual([
      'org-demo',
      'p-payments',
      'run-local-1',
      'wr-1',
    ])
    expect(db.markers()).not.toContain('claim')
    expect(db.markers()).toContain('audit-insert')
    expect(db.markers()).toContain('idempotency-insert')
    expect(db.calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('commits expiry plus an audited and idempotent 410 instead of rolling it back', async () => {
    const expiredOpen = {
      ...openRow,
      expires_at: '2026-08-01T11:59:59.000Z',
    }
    const db = new FakeWorkRequestDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'project-probe':
          return [{ project_id: 'p-payments' }]
        case 'idempotency-read':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'row-lock':
          return [expiredOpen]
        case 'expire':
          return [{ ...expiredOpen, status: 'expired', version: 2, updated_at: now }]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresWorkRequestRepository(db, {
      now: () => new Date(now),
    })

    await expect(
      repository.claimWorkRequest(
        {
          workRequestId: 'wr-1',
          expectedVersion: 1,
          runId: 'run-local-1',
          idempotencyKey: 'claim:expired',
        },
        bearerPrincipal,
      ),
    ).resolves.toEqual({
      ok: false,
      responseStatus: 410,
      outcomeCode: 'expired',
      replayed: false,
    })
    expect(db.markers()).toContain('expire')
    expect(db.markers().indexOf('expire')).toBeLessThan(
      db.markers().indexOf('audit-insert'),
    )
    expect(db.markers().indexOf('audit-insert')).toBeLessThan(
      db.markers().indexOf('idempotency-insert'),
    )
    expect(db.calls.at(-1)?.sql).toBe('COMMIT')
    expect(db.calls.some(({ sql }) => sql === 'ROLLBACK')).toBe(false)
  })

  it('materializes only the matching durable claimant and never expires it implicitly', async () => {
    const pendingRow = {
      ...openRow,
      version: 2,
      status: 'claim_pending',
      claimed_by_token_id: 'desktop-token-safe-id',
      claimed_run_id: 'run-local-1',
      claimed_at: '2026-08-01T11:00:00.000Z',
      expires_at: '2026-08-01T11:30:00.000Z',
      created_at: '2026-08-01T10:00:00.000Z',
      updated_at: '2026-08-01T11:00:00.000Z',
    }
    const materializedRow = {
      ...pendingRow,
      version: 3,
      status: 'materialized',
      materialized_at: now,
      updated_at: now,
    }
    const db = new FakeWorkRequestDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'project-probe':
          return [{ project_id: 'p-payments' }]
        case 'idempotency-read':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'row-lock':
          return [pendingRow]
        case 'materialize':
          return [materializedRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresWorkRequestRepository(db, {
      now: () => new Date(now),
    })

    const result = await repository.materializeWorkRequest(
      {
        workRequestId: 'wr-1',
        expectedVersion: 2,
        runId: 'run-local-1',
        idempotencyKey: 'materialize:wr-1',
      },
      bearerPrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      outcomeCode: 'materialized',
      workRequest: { version: 3, status: 'materialized' },
    })
    expect(db.markers()).not.toContain('expire')
  })

  it('lets a live lead release a pending claim only without its canonical Run projection', async () => {
    const pendingRow = {
      ...openRow,
      version: 2,
      status: 'claim_pending',
      claimed_by_token_id: 'desktop-token-safe-id',
      claimed_run_id: 'run-local-1',
      claimed_at: '2026-08-01T11:00:00.000Z',
      updated_at: '2026-08-01T11:00:00.000Z',
    }
    const releasedRow = {
      ...openRow,
      version: 3,
      updated_at: now,
    }
    const db = new FakeWorkRequestDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'project-probe':
          return [{ project_id: 'p-payments' }]
        case 'idempotency-read':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'row-lock':
          return [pendingRow]
        case 'canonical-run-check':
          return [{ projection_exists: false }]
        case 'release':
          return [releasedRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresWorkRequestRepository(db, {
      now: () => new Date(now),
    })

    const result = await repository.releaseWorkRequest(
      {
        workRequestId: 'wr-1',
        expectedVersion: 2,
        idempotencyKey: 'release:wr-1',
      },
      cookiePrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      outcomeCode: 'released',
      workRequest: { version: 3, status: 'open', claim: null },
    })
    const projectionCheck = db.calls.find(
      ({ sql }) => marker(sql) === 'canonical-run-check',
    )
    expect(projectionCheck?.sql).toMatch(/workflow_runs/i)
    expect(projectionCheck?.sql).toMatch(/organization_id\s*=\s*\$2/i)
    expect(projectionCheck?.sql).toMatch(/project_id\s*=\s*\$3/i)
  })

  it('replays only a matching fingerprint and commits mismatches as fixed conflicts', async () => {
    const storedResponse = {
      ok: true,
      responseStatus: 201,
      outcomeCode: 'created',
      replayed: false,
      workRequest: {
        id: 'wr-1',
        organizationId: 'org-demo',
        projectId: 'p-payments',
        title: 'Prepare rollout',
        request: 'Keep the rollout reversible.',
        version: 1,
        status: 'open',
        createdByUserId: 'u-ling',
        claim: null,
        expiresAt: '2026-08-02T12:00:00.000Z',
        createdAt: now,
        updatedAt: now,
      },
    }
    let storedFingerprint = ''
    const db = new FakeWorkRequestDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
          return []
        case 'idempotency-read':
          return [
            {
              project_id: 'p-payments',
              request_fingerprint: storedFingerprint,
              response_json: storedResponse,
            },
          ]
        case 'cookie-identity':
          return [cookieIdentity()]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresWorkRequestRepository(db, {
      now: () => new Date(now),
    })
    const input = {
      projectId: 'p-payments',
      title: 'Prepare rollout',
      request: 'Keep the rollout reversible.',
      expiresAt: '2026-08-02T12:00:00.000Z',
      idempotencyKey: 'create:rollout',
    }

    // Capture the implementation fingerprint through the lock-independent contract helper.
    const { fingerprintWorkRequestOperation } = await import('./work-request-contract')
    storedFingerprint = fingerprintWorkRequestOperation('work_request_create', input)
    await expect(repository.createWorkRequest(input, cookiePrincipal)).resolves.toMatchObject({
      ok: true,
      replayed: true,
      workRequest: { id: 'wr-1' },
    })

    storedFingerprint = 'different-fingerprint'
    await expect(repository.createWorkRequest(input, cookiePrincipal)).resolves.toEqual({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'idempotency_conflict',
      replayed: false,
    })
    expect(db.calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('rolls back and releases the same checkout on an unexpected audit failure', async () => {
    const db = new FakeWorkRequestDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
        case 'idempotency-read':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'create':
          return [{ ...openRow, id: 'work-request-fixed' }]
        case 'audit-insert':
          throw new Error('forced audit storage failure')
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresWorkRequestRepository(db, {
      now: () => new Date(now),
      createId: () => 'work-request-fixed',
    })

    await expect(
      repository.createWorkRequest(
        {
          projectId: 'p-payments',
          title: 'Prepare rollout',
          request: 'Keep the rollout reversible.',
          expiresAt: '2026-08-02T12:00:00.000Z',
          idempotencyKey: 'create:rollback',
        },
        cookiePrincipal,
      ),
    ).rejects.toThrow('forced audit storage failure')
    expect(db.calls.map(({ sql }) => sql).at(-1)).toBe('ROLLBACK')
    expect(db.releaseCount).toBe(1)
    expect(db.markers()).not.toContain('idempotency-insert')
  })

  it('fails closed on disallowed authentication kinds without a lifecycle write', async () => {
    const db = new FakeWorkRequestDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
        case 'idempotency-read':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresWorkRequestRepository(db, {
      now: () => new Date(now),
    })

    await expect(
      repository.createWorkRequest(
        {
          projectId: 'p-payments',
          title: 'Prepare rollout',
          request: 'Keep the rollout reversible.',
          expiresAt: null,
          idempotencyKey: 'create:wrong-auth',
        },
        bearerPrincipal,
      ),
    ).resolves.toEqual({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'authentication_forbidden',
      replayed: false,
    })
    expect(db.markers()).not.toContain('create')
    expect(db.calls.at(-1)?.sql).toBe('COMMIT')
  })
})
