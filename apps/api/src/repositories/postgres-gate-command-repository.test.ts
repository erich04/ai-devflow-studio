import { describe, expect, it, vi } from 'vitest'
import type { RequestPrincipal } from '../auth/request-auth'
import type { TeamDbRepositoryClient } from '../db/client'
import {
  GateCommandAuthoritativeStateUnavailableError,
  fingerprintGateCommandCreate,
} from './gate-command-contract'
import {
  createPostgresGateCommandRepository,
  type GateCommandPreflightResolver,
} from './postgres-gate-command-repository'

type QueryCall = { sql: string; params: unknown[] }
type QueryHandler = (
  sql: string,
  params: unknown[],
) => unknown[] | Promise<unknown[]>

const now = '2026-08-01T12:00:00.000Z'

const cookiePrincipal: RequestPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-lead',
    organizationId: 'org-demo',
    userId: 'u-lead',
    role: 'lead',
    projectMemberships: [
      { projectId: 'p-payments', userId: 'u-lead', role: 'lead' },
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
    tokenRecordId: 'desktop-token-claimant',
  },
}

const createInput = {
  projectId: 'p-payments',
  runId: 'run-1',
  nodeId: 'gate-current',
  action: 'approve' as const,
  reason: 'Reviewed current projection.',
  expectedRunVersion: 3,
  expectedPolicyVersion: 2,
  expectedBlockerIds: [] as string[],
  idempotencyKey: 'gate:create:run-1:v3',
}

const commandRow = {
  id: 'gate-command-fixed',
  version: 1,
  organization_id: 'org-demo',
  project_id: 'p-payments',
  work_request_id: 'wr-1',
  run_id: 'run-1',
  node_id: 'gate-current',
  action: 'approve',
  workflow_command: 'approve_gate',
  reason: 'Reviewed current projection.',
  requested_by_user_id: 'u-lead',
  requested_role: 'lead',
  idempotency_key: 'gate:create:run-1:v3',
  request_fingerprint: 'a'.repeat(64),
  expected_run_version: 3,
  expected_policy_version: 2,
  expected_blocker_ids: [],
  evaluation_status: 'allowed',
  evaluation_blocker_ids: [],
  evaluated_at: now,
  status: 'pending',
  outcome_code: null,
  expires_at: '2026-08-01T12:15:00.000Z',
  created_at: now,
  updated_at: now,
}

const commandRecord = {
  id: 'gate-command-fixed',
  version: 1,
  organizationId: 'org-demo',
  projectId: 'p-payments',
  workRequestId: 'wr-1',
  runId: 'run-1',
  nodeId: 'gate-current',
  action: 'approve' as const,
  workflowCommand: 'approve_gate' as const,
  reason: 'Reviewed current projection.',
  requestedByUserId: 'u-lead',
  requestedRole: 'lead' as const,
  idempotencyKey: 'gate:create:run-1:v3',
  requestFingerprint: 'a'.repeat(64),
  expectedRunVersion: 3,
  expectedPolicyVersion: 2,
  expectedBlockerIds: [] as string[],
  evaluationStatus: 'allowed' as const,
  evaluationBlockerIds: [] as string[],
  evaluatedAt: now,
  status: 'pending' as const,
  outcomeCode: null,
  expiresAt: '2026-08-01T12:15:00.000Z',
  createdAt: now,
  updatedAt: now,
}

const deliveringRow = {
  ...commandRow,
  version: 2,
  status: 'delivering',
  updated_at: '2026-08-01T12:01:00.000Z',
}

const receiptRow = {
  id: 'gate-receipt-fixed',
  command_id: 'gate-command-fixed',
  attempt: 1,
  leased_to_token_id: 'desktop-token-claimant',
  leased_at: '2026-08-01T12:01:00.000Z',
  lease_expires_at: '2026-08-01T12:02:00.000Z',
  acknowledged_at: null,
}

const acknowledgementInput = {
  commandId: 'gate-command-fixed',
  outcomeCode: 'applied' as const,
  beforeRunVersion: 3,
  afterRunVersion: 4,
  evaluatedAt: '2026-08-01T12:01:20.000Z',
}

const acknowledgementRow = {
  id: 'gate-acknowledgement-fixed',
  command_id: 'gate-command-fixed',
  receipt_id: 'gate-receipt-fixed',
  outcome_code: 'applied',
  before_run_version: 3,
  after_run_version: 4,
  evaluated_at: '2026-08-01T12:01:20.000Z',
  created_at: '2026-08-01T12:01:21.000Z',
}

function cookieIdentity() {
  return {
    user_id: 'u-lead',
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

function createAuthority() {
  return {
    work_request_id: 'wr-1',
    claimed_by_token_id: 'desktop-token-claimant',
    run_id: 'run-1',
    run_version: 3,
    current_node_id: 'run-1:gate-current',
    creator_id: 'u-creator',
  }
}

function acknowledgementAuthority(
  overrides: Record<string, unknown> = {},
) {
  return {
    ...deliveringRow,
    receipt_id: receiptRow.id,
    receipt_command_id: receiptRow.command_id,
    receipt_attempt: receiptRow.attempt,
    receipt_leased_to_token_id: receiptRow.leased_to_token_id,
    receipt_leased_at: receiptRow.leased_at,
    receipt_lease_expires_at: receiptRow.lease_expires_at,
    receipt_acknowledged_at: null,
    claimed_by_token_id: 'desktop-token-claimant',
    ...overrides,
  }
}

function marker(sql: string): string | null {
  return /\/\* gate_command:([^*]+) \*\//.exec(sql)?.[1] ?? null
}

class FakeGateCommandDb implements TeamDbRepositoryClient {
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
    if (
      sql === 'BEGIN' ||
      sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ' ||
      sql === 'COMMIT' ||
      sql === 'ROLLBACK'
    ) {
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

describe('Postgres Gate Command repository', () => {
  it('holds every live Cookie authority row until Gate Command creation commits', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
        case 'active-lock':
        case 'expire-active-tuple':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'idempotency-read':
        case 'active-read':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'create-authority':
          return [createAuthority()]
        case 'create':
          return [commandRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `${kind}-fixed`,
      resolvePreflight: async () => ({
        allowed: true,
        workflowCommand: 'approve_gate',
        evaluationStatus: 'allowed',
        evaluationBlockerIds: [],
        observedPolicyVersion: 2,
        observedBlockerIds: [],
      }),
    })

    await expect(
      repository.createGateCommand(createInput, cookiePrincipal),
    ).resolves.toMatchObject({ ok: true, outcomeCode: 'created' })

    const identitySql = db.calls.find(
      ({ sql }) => marker(sql) === 'cookie-identity',
    )?.sql
    expect(identitySql).toMatch(
      /\(\s*SELECT\s+project_members\.role[\s\S]*?FROM\s+project_members[\s\S]*?FOR SHARE\s*\)\s+AS project_role/,
    )
    expect(identitySql).toMatch(
      /FOR SHARE OF auth_accounts, users, projects/,
    )
    expect(db.calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('holds every live Desktop authority row until inbox terminalization commits', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'lazy-expire':
        case 'lazy-revoke':
        case 'inbox':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(now),
    })

    await expect(
      repository.listGateCommandInbox('p-payments', bearerPrincipal),
    ).resolves.toEqual([])

    const identitySql = db.calls.find(
      ({ sql }) => marker(sql) === 'bearer-identity',
    )?.sql
    expect(identitySql).toMatch(
      /JOIN\s+project_members[\s\S]*?project_members\.project_id\s*=\s*desktop_tokens\.project_id/,
    )
    expect(identitySql).toMatch(
      /FOR SHARE OF desktop_tokens, users, projects, project_members/,
    )
    expect(db.calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('creates after live Cookie, materialized claim, Run, and policy authority in one transaction', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
        case 'active-lock':
        case 'expire-active-tuple':
        case 'audit-insert':
        case 'idempotency-insert':
        case 'policy-preflight':
          return []
        case 'idempotency-read':
        case 'active-read':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'create-authority':
          return [createAuthority()]
        case 'create':
          return [commandRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const resolvePreflight = vi.fn<GateCommandPreflightResolver>(
      async ({ tx }) => {
        await tx.query('/* gate_command:policy-preflight */ SELECT 1')
        return {
          allowed: true,
          workflowCommand: 'approve_gate',
          evaluationStatus: 'allowed',
          evaluationBlockerIds: [],
          observedPolicyVersion: 2,
          observedBlockerIds: [],
        }
      },
    )
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `${kind}-fixed`,
      resolvePreflight,
    })

    const result = await repository.createGateCommand(
      createInput,
      cookiePrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'created',
      replayed: false,
      command: {
        id: 'gate-command-fixed',
        version: 1,
        status: 'pending',
      },
    })
    expect(db.calls[0]?.sql).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ')
    expect(db.calls.at(-1)?.sql).toBe('COMMIT')
    expect(db.checkoutCount).toBe(1)
    expect(db.releaseCount).toBe(1)
    expect(db.markers()).toEqual([
      'idempotency-lock',
      'idempotency-read',
      'cookie-identity',
      'create-authority',
      'policy-preflight',
      'audit-insert',
      'active-lock',
      'expire-active-tuple',
      'active-read',
      'create',
      'audit-insert',
      'idempotency-insert',
    ])
    const auditCalls = db.calls.filter(
      ({ sql }) => marker(sql) === 'audit-insert',
    )
    expect(auditCalls).toHaveLength(2)
    expect(auditCalls.map(({ params }) => params[9])).toEqual([
      'gate_command_preflight',
      'gate_command_create',
    ])
    expect(JSON.parse(String(auditCalls[0]?.params[14]))).toMatchObject({
      expectedPolicyVersion: 2,
      observedPolicyVersion: 2,
      expectedBlockerIdsHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      observedBlockerIdsHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(resolvePreflight).toHaveBeenCalledTimes(1)
    expect(resolvePreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({ nodeId: 'gate-current' }),
        authority: expect.objectContaining({ currentNodeId: 'gate-current' }),
      }),
    )
    const createCall = db.calls.find(({ sql }) => marker(sql) === 'create')
    expect(createCall?.params[5]).toBe('gate-current')
    expect(db.calls.map(({ sql }) => sql).join('\n')).not.toMatch(
      /UPDATE\s+workflow_runs/i,
    )
  })

  it('replays a matching create only after rechecking the live Cookie identity', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
          return []
        case 'idempotency-read':
          return [{
            request_fingerprint: fingerprintGateCommandCreate(createInput),
            response_json: {
              ok: true,
              responseStatus: 201,
              outcomeCode: 'created',
              replayed: false,
              command: commandRecord,
            },
          }]
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'audit-insert':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db)

    await expect(
      repository.createGateCommand(createInput, cookiePrincipal),
    ).resolves.toMatchObject({
      ok: true,
      outcomeCode: 'created',
      replayed: true,
      command: { id: 'gate-command-fixed' },
    })

    expect(db.markers()).toEqual([
      'idempotency-lock',
      'idempotency-read',
      'cookie-identity',
      'audit-insert',
    ])
    const audit = db.calls.find(({ sql }) => marker(sql) === 'audit-insert')
    expect(audit?.params[9]).toBe('gate_command_create')
    expect(audit?.params[12]).toBe('created')
    expect(audit?.params[13]).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(audit?.params)).not.toContain(createInput.reason)
    expect(JSON.stringify(audit?.params)).not.toContain(
      createInput.idempotencyKey,
    )
  })

  it('rejects reuse of a create idempotency key with a different fingerprint', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
          return []
        case 'idempotency-read':
          return [{
            request_fingerprint: fingerprintGateCommandCreate(createInput),
            response_json: {
              ok: false,
              responseStatus: 409,
              outcomeCode: 'stale_policy',
              replayed: false,
            },
          }]
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'audit-insert':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db)

    await expect(
      repository.createGateCommand(
        {
          ...createInput,
          reason: 'A different request using the same key.',
        },
        cookiePrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'idempotency_conflict',
      replayed: false,
    })
    expect(db.markers()).toEqual([
      'idempotency-lock',
      'idempotency-read',
      'cookie-identity',
      'audit-insert',
    ])
    const audit = db.calls.find(({ sql }) => marker(sql) === 'audit-insert')
    expect(audit?.params[9]).toBe('gate_command_create')
    expect(audit?.params[12]).toBe('idempotency_conflict')
    expect(audit?.params[13]).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(audit?.params)).not.toContain(createInput.reason)
    expect(JSON.stringify(audit?.params)).not.toContain(
      createInput.idempotencyKey,
    )
  })

  it('fails closed when a stored create rejection contains an unknown outcome', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
          return []
        case 'idempotency-read':
          return [{
            request_fingerprint: fingerprintGateCommandCreate(createInput),
            response_json: {
              ok: false,
              outcomeCode: 'unknown_stored_outcome',
              replayed: false,
            },
          }]
        case 'cookie-identity':
          return [cookieIdentity()]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db)

    await expect(
      repository.createGateCommand(createInput, cookiePrincipal),
    ).rejects.toThrow('Invalid Gate Command idempotency result.')
    expect(db.calls.map(({ sql }) => sql)).toContain('ROLLBACK')
  })

  it('persists an active tuple conflict as the deterministic create result', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
        case 'policy-preflight':
        case 'active-lock':
        case 'expire-active-tuple':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'idempotency-read':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'create-authority':
          return [createAuthority()]
        case 'active-read':
          return [{ id: 'gate-command-active' }]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const resolvePreflight: GateCommandPreflightResolver = async ({ tx }) => {
      await tx.query('/* gate_command:policy-preflight */ SELECT 1')
      return {
        allowed: true,
        workflowCommand: 'approve_gate',
        evaluationStatus: 'allowed',
        evaluationBlockerIds: [],
        observedPolicyVersion: 2,
        observedBlockerIds: [],
      }
    }
    const repository = createPostgresGateCommandRepository(db, {
      resolvePreflight,
      createId: (kind) => `${kind}-fixed`,
    })

    await expect(
      repository.createGateCommand(createInput, cookiePrincipal),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'active_command_conflict',
      replayed: false,
    })

    expect(db.markers()).toEqual([
      'idempotency-lock',
      'idempotency-read',
      'cookie-identity',
      'create-authority',
      'policy-preflight',
      'audit-insert',
      'active-lock',
      'expire-active-tuple',
      'active-read',
      'audit-insert',
      'idempotency-insert',
    ])
    const createAudit = db.calls.find(
      ({ sql, params }) =>
        marker(sql) === 'audit-insert' &&
        params[9] === 'gate_command_create',
    )
    expect(createAudit?.params[8]).toBe('gate_command-fixed')
    expect(JSON.parse(String(createAudit?.params[14]))).toMatchObject({
      activeCommandIdHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it.each([
    {
      race: 'the active tuple unique index rejects the stale snapshot',
      failure: Object.assign(
        new Error('simulated concurrent active Gate Command insert'),
        {
          code: '23505',
          constraint: 'gate_commands_active_target_version_unique',
        },
      ),
    },
    {
      race: 'Postgres reports a serialization failure',
      failure: Object.assign(new Error('simulated serialization failure'), {
        code: '40001',
      }),
    },
  ])(
    'retries the whole repeatable-read create when $race',
    async ({ failure }) => {
      let activeReadCount = 0
      const db = new FakeGateCommandDb((sql) => {
        switch (marker(sql)) {
          case 'idempotency-lock':
          case 'policy-preflight':
          case 'active-lock':
          case 'expire-active-tuple':
          case 'audit-insert':
          case 'idempotency-insert':
            return []
          case 'idempotency-read':
            return []
          case 'cookie-identity':
            return [cookieIdentity()]
          case 'create-authority':
            return [createAuthority()]
          case 'active-read':
            activeReadCount += 1
            return activeReadCount === 1 ? [] : [{ id: 'gate-command-winner' }]
          case 'create':
            throw failure
          default:
            throw new Error(`Unexpected query: ${sql}`)
        }
      })
      const resolvePreflight = vi.fn<GateCommandPreflightResolver>(
        async ({ tx }) => {
          await tx.query('/* gate_command:policy-preflight */ SELECT 1')
          return {
            allowed: true,
            workflowCommand: 'approve_gate',
            evaluationStatus: 'allowed',
            evaluationBlockerIds: [],
            observedPolicyVersion: 2,
            observedBlockerIds: [],
          }
        },
      )
      const repository = createPostgresGateCommandRepository(db, {
        resolvePreflight,
        createId: (kind) => `${kind}-fixed`,
      })

      await expect(
        repository.createGateCommand(createInput, cookiePrincipal),
      ).resolves.toMatchObject({
        ok: false,
        responseStatus: 409,
        outcomeCode: 'active_command_conflict',
        replayed: false,
      })

      expect(resolvePreflight).toHaveBeenCalledTimes(2)
      expect(db.checkoutCount).toBe(2)
      expect(db.releaseCount).toBe(2)
      expect(
        db.calls.filter(
          ({ sql }) => sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ',
        ),
      ).toHaveLength(2)
      expect(db.calls.filter(({ sql }) => sql === 'ROLLBACK')).toHaveLength(1)
      expect(db.calls.filter(({ sql }) => sql === 'COMMIT')).toHaveLength(1)
      const committedCreateAudit = db.calls.find(
        ({ sql, params }) =>
          marker(sql) === 'audit-insert' &&
          params[9] === 'gate_command_create' &&
          params[12] === 'active_command_conflict',
      )
      expect(committedCreateAudit).toBeDefined()
    },
  )

  it('does not retry an unrelated unique violation from Gate Command create', async () => {
    const unrelatedUnique = Object.assign(
      new Error('simulated unrelated unique violation'),
      { code: '23505', constraint: 'unrelated_unique_constraint' },
    )
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
        case 'policy-preflight':
        case 'active-lock':
        case 'expire-active-tuple':
        case 'audit-insert':
          return []
        case 'idempotency-read':
        case 'active-read':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'create-authority':
          return [createAuthority()]
        case 'create':
          throw unrelatedUnique
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      resolvePreflight: async ({ tx }) => {
        await tx.query('/* gate_command:policy-preflight */ SELECT 1')
        return {
          allowed: true,
          workflowCommand: 'approve_gate',
          evaluationStatus: 'allowed',
          evaluationBlockerIds: [],
          observedPolicyVersion: 2,
          observedBlockerIds: [],
        }
      },
    })

    await expect(
      repository.createGateCommand(createInput, cookiePrincipal),
    ).rejects.toBe(unrelatedUnique)
    expect(db.checkoutCount).toBe(1)
    expect(db.calls.filter(({ sql }) => sql === 'ROLLBACK')).toHaveLength(1)
  })

  it('expires and audits an old active tuple before creating its replacement', async () => {
    const expiredRow = {
      ...commandRow,
      id: 'gate-command-expired',
      version: 2,
      status: 'expired',
      outcome_code: 'expired',
      updated_at: now,
    }
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
        case 'policy-preflight':
        case 'active-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'idempotency-read':
        case 'active-read':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'create-authority':
          return [createAuthority()]
        case 'expire-active-tuple':
          return [expiredRow]
        case 'create':
          return [commandRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `${kind}-fixed`,
      resolvePreflight: async ({ tx }) => {
        await tx.query('/* gate_command:policy-preflight */ SELECT 1')
        return {
          allowed: true,
          workflowCommand: 'approve_gate',
          evaluationStatus: 'allowed',
          evaluationBlockerIds: [],
          observedPolicyVersion: 2,
          observedBlockerIds: [],
        }
      },
    })

    await expect(
      repository.createGateCommand(createInput, cookiePrincipal),
    ).resolves.toMatchObject({ ok: true, outcomeCode: 'created' })

    const expireCall = db.calls.find(
      ({ sql }) => marker(sql) === 'expire-active-tuple',
    )
    expect(expireCall?.params).toEqual([
      'org-demo',
      'p-payments',
      'run-1',
      'gate-current',
      3,
      now,
    ])
    expect(expireCall?.sql).toMatch(
      /status\s+IN\s*\('pending',\s*'delivering'\)[\s\S]*expires_at\s*<=\s*\$6/i,
    )
    expect(
      db.markers().filter((value) => value === 'audit-insert'),
    ).toHaveLength(3)
    expect(db.markers().indexOf('expire-active-tuple')).toBeLessThan(
      db.markers().indexOf('active-read'),
    )
  })

  it('persists and exactly replays a deterministic preflight rejection', async () => {
    const requestFingerprint = fingerprintGateCommandCreate(createInput)
    let stored = false
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
        case 'audit-insert':
          return []
        case 'idempotency-read':
          return stored
            ? [{
                request_fingerprint: requestFingerprint,
                response_json: {
                  ok: false,
                  responseStatus: 409,
                  outcomeCode: 'stale_policy',
                  replayed: false,
                },
              }]
            : []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'create-authority':
          return [createAuthority()]
        case 'idempotency-insert':
          stored = true
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const resolvePreflight = vi.fn<GateCommandPreflightResolver>(async () => ({
      allowed: false,
      code: 'stale_policy',
      observedPolicyVersion: 3,
      observedBlockerIds: [],
    }))
    const repository = createPostgresGateCommandRepository(db, {
      resolvePreflight,
      createId: (kind) => `${kind}-fixed`,
    })

    await expect(
      repository.createGateCommand(createInput, cookiePrincipal),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'stale_policy',
      replayed: false,
    })
    await expect(
      repository.createGateCommand(createInput, cookiePrincipal),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'stale_policy',
      replayed: true,
    })

    expect(resolvePreflight).toHaveBeenCalledTimes(1)
    expect(db.markers().filter((value) => value === 'audit-insert')).toHaveLength(3)
    expect(
      db.markers().filter((value) => value === 'idempotency-insert'),
    ).toHaveLength(1)
  })

  it.each([
    {
      name: 'missing canonical Run authority',
      authorityRows: [] as ReturnType<typeof createAuthority>[],
      outcomeCode: 'not_found',
    },
    {
      name: 'stale Run version',
      authorityRows: [{ ...createAuthority(), run_version: 4 }],
      outcomeCode: 'stale_run',
    },
    {
      name: 'non-current node',
      authorityRows: [{
        ...createAuthority(),
        current_node_id: 'run-1:gate-other',
      }],
      outcomeCode: 'node_not_current',
    },
  ] as const)(
    'audits the server preflight and submission for $name',
    async ({ authorityRows, outcomeCode }) => {
      const db = new FakeGateCommandDb((sql) => {
        switch (marker(sql)) {
          case 'idempotency-lock':
          case 'idempotency-read':
          case 'audit-insert':
          case 'idempotency-insert':
            return []
          case 'cookie-identity':
            return [cookieIdentity()]
          case 'create-authority':
            return [...authorityRows]
          default:
            throw new Error(`Unexpected query: ${sql}`)
        }
      })
      const repository = createPostgresGateCommandRepository(db, {
        createId: (kind) => `${kind}-fixed`,
      })

      await expect(
        repository.createGateCommand(createInput, cookiePrincipal),
      ).resolves.toMatchObject({ ok: false, outcomeCode })

      const audits = db.calls.filter(
        ({ sql }) => marker(sql) === 'audit-insert',
      )
      expect(audits.map(({ params }) => params[9])).toEqual([
        'gate_command_preflight',
        'gate_command_create',
      ])
      expect(audits.map(({ params }) => params[12])).toEqual([
        outcomeCode,
        outcomeCode,
      ])
      expect(db.markers()).not.toContain('active-lock')
    },
  )

  it('rolls back transient authoritative-state unavailability without storing idempotency', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
          return []
        case 'idempotency-read':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'create-authority':
          return [createAuthority()]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      resolvePreflight: async () => null,
    })

    await expect(
      repository.createGateCommand(createInput, cookiePrincipal),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 503,
      outcomeCode: 'authoritative_state_unavailable',
      replayed: false,
    })

    expect(db.calls.map(({ sql }) => sql)).toContain('ROLLBACK')
    expect(db.calls.map(({ sql }) => sql)).not.toContain('COMMIT')
    expect(db.markers()).not.toContain('audit-insert')
    expect(db.markers()).not.toContain('idempotency-insert')
  })

  it.each(['cookie-identity', 'create-authority'] as const)(
    'returns a transient 503 when the %s read is unavailable',
    async (failedMarker) => {
      const db = new FakeGateCommandDb((sql) => {
        const currentMarker = marker(sql)
        if (currentMarker === failedMarker) {
          throw new Error(`${failedMarker} unavailable`)
        }
        switch (currentMarker) {
          case 'idempotency-lock':
          case 'idempotency-read':
            return []
          case 'cookie-identity':
            return [cookieIdentity()]
          default:
            throw new Error(`Unexpected query: ${sql}`)
        }
      })
      const repository = createPostgresGateCommandRepository(db)

      await expect(
        repository.createGateCommand(createInput, cookiePrincipal),
      ).resolves.toMatchObject({
        ok: false,
        responseStatus: 503,
        outcomeCode: 'authoritative_state_unavailable',
        replayed: false,
      })

      expect(db.calls.map(({ sql }) => sql)).toContain('ROLLBACK')
      expect(db.calls.map(({ sql }) => sql)).not.toContain('COMMIT')
      expect(db.markers()).not.toContain('audit-insert')
      expect(db.markers()).not.toContain('idempotency-insert')
    },
  )

  it('returns a transient 503 when authoritative preflight throws', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'idempotency-lock':
          return []
        case 'idempotency-read':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'create-authority':
          return [createAuthority()]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      resolvePreflight: async () => {
        throw new Error('authoritative policy read failed')
      },
    })

    await expect(
      repository.createGateCommand(createInput, cookiePrincipal),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 503,
      outcomeCode: 'authoritative_state_unavailable',
      replayed: false,
    })

    expect(db.calls.map(({ sql }) => sql)).toContain('ROLLBACK')
    expect(db.calls.map(({ sql }) => sql)).not.toContain('COMMIT')
    expect(db.markers()).not.toContain('audit-insert')
    expect(db.markers()).not.toContain('idempotency-insert')
    expect(db.releaseCount).toBe(1)
  })

  it('lists browser records only after a live Cookie project membership check', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'lazy-expire':
        case 'lazy-revoke':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'list':
          return [{
            ...commandRow,
            auth_kind: 'session_cookie',
            auth_token_record_id: 'must-not-cross-boundary',
          }]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db)

    const result = await repository.listGateCommands(
      'p-payments',
      cookiePrincipal,
    )

    expect(result).toEqual([commandRecord])
    expect(JSON.stringify(result)).not.toContain('auth_token')
    const listCall = db.calls.find(({ sql }) => marker(sql) === 'list')
    expect(listCall?.params).toEqual(['org-demo', 'p-payments'])
    expect(listCall?.sql).toMatch(/organization_id\s*=\s*\$1/i)
    expect(listCall?.sql).toMatch(/project_id\s*=\s*\$2/i)
  })

  it.each(['cookie-identity', 'list'] as const)(
    'surfaces a typed authoritative outage when the browser %s read fails',
    async (failedMarker) => {
      const db = new FakeGateCommandDb((sql) => {
        const currentMarker = marker(sql)
        if (currentMarker === failedMarker) {
          throw new Error(`${failedMarker} unavailable`)
        }
        switch (currentMarker) {
          case 'cookie-identity':
            return [cookieIdentity()]
          case 'lazy-expire':
          case 'lazy-revoke':
            return []
          default:
            throw new Error(`Unexpected query: ${sql}`)
        }
      })
      const repository = createPostgresGateCommandRepository(db)

      await expect(
        repository.listGateCommands('p-payments', cookiePrincipal),
      ).rejects.toBeInstanceOf(GateCommandAuthoritativeStateUnavailableError)
      expect(db.calls.map(({ sql }) => sql)).toContain('ROLLBACK')
    },
  )

  it('lazily expires an observed active command once and exposes its terminal lifecycle', async () => {
    const observedAt = '2026-08-01T12:16:00.000Z'
    const expiredRow = {
      ...commandRow,
      version: 2,
      status: 'expired',
      outcome_code: 'expired',
      updated_at: observedAt,
    }
    let active = true
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'lazy-expire':
          if (!active) return []
          active = false
          return [expiredRow]
        case 'lazy-revoke':
        case 'audit-insert':
          return []
        case 'list':
          return [expiredRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(observedAt),
    })

    await expect(
      repository.listGateCommands('p-payments', cookiePrincipal),
    ).resolves.toMatchObject([
      { id: commandRow.id, version: 2, status: 'expired', outcomeCode: 'expired' },
    ])
    await repository.listGateCommands('p-payments', cookiePrincipal)

    expect(
      db.markers().filter((value) => value === 'audit-insert'),
    ).toHaveLength(1)
    const expireCall = db.calls.find(({ sql }) => marker(sql) === 'lazy-expire')
    expect(expireCall?.sql).toMatch(/status\s+IN\s*\('pending',\s*'delivering'\)/i)
    expect(expireCall?.sql).toMatch(/expires_at\s*<=\s*\$3/i)
  })

  it('scopes the Desktop inbox to the exact materialized claimant and live requester', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'lazy-expire':
        case 'lazy-revoke':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'inbox':
          return [commandRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(now),
    })

    await expect(
      repository.listGateCommandInbox('p-payments', bearerPrincipal),
    ).resolves.toEqual([commandRecord])

    const inboxCall = db.calls.find(({ sql }) => marker(sql) === 'inbox')
    expect(inboxCall?.params).toEqual([
      'org-demo',
      'p-payments',
      'desktop-token-claimant',
      now,
    ])
    expect(inboxCall?.sql).toMatch(/work_requests\.status\s*=\s*'materialized'/i)
    expect(inboxCall?.sql).toMatch(/claimed_by_token_id\s*=\s*\$3/i)
    expect(inboxCall?.sql).toMatch(/requested_by_user_id/i)
    expect(inboxCall?.sql).toMatch(/project_members/i)
    expect(inboxCall?.sql).toMatch(
      /\(\s*SELECT[\s\S]*?FROM\s+project_members AS requester_members[\s\S]*?FOR SHARE\s*\)/,
    )
    expect(inboxCall?.sql).toMatch(/FOR SHARE OF requester_users/)
    expect(inboxCall?.sql).toMatch(/expires_at\s*>\s*\$4/i)
  })

  it.each(['bearer-identity', 'inbox'] as const)(
    'surfaces a typed authoritative outage when the Desktop %s read fails',
    async (failedMarker) => {
      const db = new FakeGateCommandDb((sql) => {
        const currentMarker = marker(sql)
        if (currentMarker === failedMarker) {
          throw new Error(`${failedMarker} unavailable`)
        }
        switch (currentMarker) {
          case 'bearer-identity':
            return [bearerIdentity()]
          case 'lazy-expire':
          case 'lazy-revoke':
            return []
          default:
            throw new Error(`Unexpected query: ${sql}`)
        }
      })
      const repository = createPostgresGateCommandRepository(db)

      await expect(
        repository.listGateCommandInbox('p-payments', bearerPrincipal),
      ).rejects.toBeInstanceOf(GateCommandAuthoritativeStateUnavailableError)
      expect(db.calls.map(({ sql }) => sql)).toContain('ROLLBACK')
    },
  )

  it('lazily terminalizes requester revocation in the exact claimant inbox once', async () => {
    const observedAt = '2026-08-01T12:01:00.000Z'
    const revokedRow = {
      ...commandRow,
      version: 2,
      status: 'rejected',
      outcome_code: 'requester_revoked',
      updated_at: observedAt,
    }
    let requesterIsLive = false
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'lazy-expire':
          return []
        case 'lazy-revoke':
          if (requesterIsLive) return []
          requesterIsLive = true
          return [revokedRow]
        case 'audit-insert':
          return []
        case 'inbox':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(observedAt),
    })

    await repository.listGateCommandInbox('p-payments', bearerPrincipal)
    await repository.listGateCommandInbox('p-payments', bearerPrincipal)

    expect(
      db.markers().filter((value) => value === 'audit-insert'),
    ).toHaveLength(1)
    const revokeCall = db.calls.find(({ sql }) => marker(sql) === 'lazy-revoke')
    expect(revokeCall?.sql).toMatch(/status\s+IN\s*\('pending',\s*'delivering'\)/i)
    expect(revokeCall?.sql).toMatch(/claimed_by_token_id\s*=\s*\$4/i)
    expect(revokeCall?.sql).toMatch(/NOT EXISTS/i)
    expect(revokeCall?.sql).toMatch(
      /\(\s*SELECT[\s\S]*?FROM\s+project_members AS requester_members[\s\S]*?FOR SHARE\s*\)/,
    )
    expect(revokeCall?.sql).toMatch(/FOR SHARE OF requester_users/)
  })

  it('leases a receipt only to the exact materialized Work Request claimant', async () => {
    const receiptNow = '2026-08-01T12:01:00.000Z'
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'receipt-lock':
        case 'audit-insert':
          return []
        case 'receipt-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'receipt-authority':
          return [{
            ...commandRow,
            claimed_by_token_id: 'desktop-token-claimant',
            requester_is_live: true,
          }]
        case 'receipt-ack-read':
        case 'receipt-latest':
          return []
        case 'deliver-command':
          return [deliveringRow]
        case 'receipt-create':
          return [receiptRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(receiptNow),
      createId: (kind) => `${kind}-fixed`,
    })

    const result = await repository.createGateCommandReceipt(
      'gate-command-fixed',
      bearerPrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'receipt_created',
      replayed: false,
      command: { version: 2, status: 'delivering' },
      receipt: {
        id: 'gate-receipt-fixed',
        commandId: 'gate-command-fixed',
        attempt: 1,
        leasedAt: receiptNow,
        leaseExpiresAt: '2026-08-01T12:02:00.000Z',
      },
    })
    expect(db.markers()).toEqual([
      'receipt-project-probe',
      'bearer-identity',
      'receipt-lock',
      'receipt-authority',
      'receipt-ack-read',
      'receipt-latest',
      'deliver-command',
      'receipt-create',
      'audit-insert',
    ])
    const authorityCall = db.calls.find(
      ({ sql }) => marker(sql) === 'receipt-authority',
    )
    expect(authorityCall?.sql).toMatch(/claimed_by_token_id/i)
    expect(authorityCall?.sql).toMatch(/requested_by_user_id/i)
    expect(authorityCall?.sql).toMatch(/FOR UPDATE OF gate_commands/i)
    expect(authorityCall?.sql).toMatch(
      /\(\s*SELECT[\s\S]*?FROM\s+project_members AS requester_members[\s\S]*?FOR SHARE\s*\)/,
    )
    expect(authorityCall?.sql).toMatch(
      /FOR UPDATE OF gate_commands[\s\S]*?FOR SHARE OF requester_users/,
    )
    expect(authorityCall?.params).toEqual([
      'gate-command-fixed',
      'org-demo',
      'p-payments',
    ])
  })

  it.each([
    'receipt-project-probe',
    'bearer-identity',
    'receipt-authority',
  ] as const)(
    'returns a transient 503 when the %s authority read is unavailable',
    async (failedMarker) => {
      const db = new FakeGateCommandDb((sql) => {
        const currentMarker = marker(sql)
        if (currentMarker === failedMarker) {
          throw new Error(`${failedMarker} unavailable`)
        }
        switch (currentMarker) {
          case 'receipt-project-probe':
            return [{ project_id: 'p-payments' }]
          case 'bearer-identity':
            return [bearerIdentity()]
          case 'receipt-lock':
            return []
          case 'receipt-authority':
            return [{
              ...commandRow,
              claimed_by_token_id: 'desktop-token-claimant',
              requester_is_live: true,
            }]
          default:
            throw new Error(`Unexpected query: ${sql}`)
        }
      })
      const repository = createPostgresGateCommandRepository(db)

      await expect(
        repository.createGateCommandReceipt(commandRow.id, bearerPrincipal),
      ).resolves.toMatchObject({
        ok: false,
        responseStatus: 503,
        outcomeCode: 'authoritative_state_unavailable',
      })
      expect(db.calls.map(({ sql }) => sql)).toContain('ROLLBACK')
      expect(db.markers()).not.toContain('audit-insert')
      expect(db.markers()).not.toContain('receipt-create')
    },
  )

  it('audits a receipt denial after live Desktop identity when materialized authority disappears', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'receipt-lock':
        case 'audit-insert':
          return []
        case 'receipt-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'receipt-authority':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db)

    await expect(
      repository.createGateCommandReceipt(commandRow.id, bearerPrincipal),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'not_found',
    })

    const audit = db.calls.find(({ sql }) => marker(sql) === 'audit-insert')
    expect(audit?.params).toMatchObject({
      8: commandRow.id,
      9: 'gate_command_receipt',
      10: null,
      11: null,
      12: 'not_found',
    })
  })

  it('rejects a different live Desktop token before creating a receipt', async () => {
    const otherPrincipal: RequestPrincipal = {
      ...bearerPrincipal,
      authentication: {
        kind: 'desktop_bearer',
        tokenRecordId: 'desktop-token-other',
      },
    }
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'receipt-lock':
        case 'audit-insert':
          return []
        case 'receipt-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'receipt-authority':
          return [{
            ...commandRow,
            claimed_by_token_id: 'desktop-token-claimant',
            requester_is_live: true,
          }]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db)

    await expect(
      repository.createGateCommandReceipt(
        'gate-command-fixed',
        otherPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'claimant_forbidden',
    })

    expect(db.markers()).toEqual([
      'receipt-project-probe',
      'bearer-identity',
      'receipt-lock',
      'receipt-authority',
      'audit-insert',
    ])
    const audit = db.calls.find(({ sql }) => marker(sql) === 'audit-insert')
    expect(audit?.params).toMatchObject({
      7: 'gate_command',
      8: 'gate-command-fixed',
      9: 'gate_command_receipt',
      12: 'claimant_forbidden',
      13: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(JSON.stringify(audit?.params)).not.toContain(commandRow.reason)
    expect(JSON.stringify(audit?.params)).not.toContain(
      commandRow.idempotency_key,
    )
  })

  it('replays the still-active receipt without incrementing its attempt', async () => {
    const receiptNow = '2026-08-01T12:01:30.000Z'
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'receipt-lock':
        case 'audit-insert':
          return []
        case 'receipt-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'receipt-authority':
          return [{
            ...deliveringRow,
            claimed_by_token_id: 'desktop-token-claimant',
            requester_is_live: true,
          }]
        case 'receipt-ack-read':
          return []
        case 'receipt-latest':
          return [receiptRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(receiptNow),
    })

    await expect(
      repository.createGateCommandReceipt(
        'gate-command-fixed',
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: true,
      receipt: { attempt: 1 },
      command: { version: 2, status: 'delivering' },
    })

    expect(db.markers()).not.toContain('receipt-create')
    expect(db.markers()).not.toContain('deliver-command')
    const audit = db.calls.find(({ sql }) => marker(sql) === 'audit-insert')
    expect(audit?.params).toMatchObject({
      8: 'gate-command-fixed',
      9: 'gate_command_receipt',
      12: 'receipt_created',
    })
  })

  it('audits a receipt conflict when the command already has a terminal acknowledgement', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'receipt-lock':
        case 'audit-insert':
          return []
        case 'receipt-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'receipt-authority':
          return [{
            ...deliveringRow,
            claimed_by_token_id: 'desktop-token-claimant',
            requester_is_live: true,
          }]
        case 'receipt-ack-read':
          return [acknowledgementRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date('2026-08-01T12:01:30.000Z'),
    })

    await expect(
      repository.createGateCommandReceipt(commandRow.id, bearerPrincipal),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'receipt_conflict',
    })

    const audit = db.calls.find(({ sql }) => marker(sql) === 'audit-insert')
    expect(audit?.params).toMatchObject({
      9: 'gate_command_receipt',
      12: 'receipt_conflict',
    })
  })

  it('audits a receipt conflict when another token owns the active lease', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'receipt-lock':
        case 'audit-insert':
          return []
        case 'receipt-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'receipt-authority':
          return [{
            ...deliveringRow,
            claimed_by_token_id: 'desktop-token-claimant',
            requester_is_live: true,
          }]
        case 'receipt-ack-read':
          return []
        case 'receipt-latest':
          return [{
            ...receiptRow,
            leased_to_token_id: 'desktop-token-other',
          }]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date('2026-08-01T12:01:30.000Z'),
    })

    await expect(
      repository.createGateCommandReceipt(commandRow.id, bearerPrincipal),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'receipt_conflict',
    })

    const audit = db.calls.find(({ sql }) => marker(sql) === 'audit-insert')
    expect(audit?.params).toMatchObject({
      9: 'gate_command_receipt',
      12: 'receipt_conflict',
    })
  })

  it('redelivers with the next attempt after the 60-second lease expires', async () => {
    const redeliveryNow = '2026-08-01T12:03:00.000Z'
    const redeliveryReceipt = {
      ...receiptRow,
      id: 'gate-receipt-redelivery',
      attempt: 2,
      leased_at: redeliveryNow,
      lease_expires_at: '2026-08-01T12:04:00.000Z',
    }
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'receipt-lock':
        case 'audit-insert':
          return []
        case 'receipt-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'receipt-authority':
          return [{
            ...deliveringRow,
            claimed_by_token_id: 'desktop-token-claimant',
            requester_is_live: true,
          }]
        case 'receipt-ack-read':
          return []
        case 'receipt-latest':
          return [receiptRow]
        case 'receipt-create':
          return [redeliveryReceipt]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(redeliveryNow),
      createId: () => 'gate-receipt-redelivery',
    })

    await expect(
      repository.createGateCommandReceipt(
        'gate-command-fixed',
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      receipt: {
        attempt: 2,
        leasedAt: redeliveryNow,
        leaseExpiresAt: '2026-08-01T12:04:00.000Z',
      },
      command: { version: 2 },
    })

    expect(db.markers()).not.toContain('deliver-command')
    const createCall = db.calls.find(
      ({ sql }) => marker(sql) === 'receipt-create',
    )
    expect(createCall?.params).toEqual([
      'gate-receipt-redelivery',
      'gate-command-fixed',
      2,
      'desktop-token-claimant',
      redeliveryNow,
      '2026-08-01T12:04:00.000Z',
    ])
  })

  it('terminally rejects delivery when the original requester lost authority', async () => {
    const rejectedRow = {
      ...commandRow,
      version: 2,
      status: 'rejected',
      outcome_code: 'requester_revoked',
      updated_at: '2026-08-01T12:01:00.000Z',
    }
    let revoked = false
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'receipt-lock':
        case 'audit-insert':
          return []
        case 'receipt-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'receipt-authority':
          return [{
            ...(revoked ? rejectedRow : commandRow),
            claimed_by_token_id: 'desktop-token-claimant',
            requester_is_live: false,
          }]
        case 'revoke-requester': {
          revoked = true
          return [rejectedRow]
        }
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date('2026-08-01T12:01:00.000Z'),
    })

    await expect(
      repository.createGateCommandReceipt(
        'gate-command-fixed',
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'requester_revoked',
    })
    await expect(
      repository.createGateCommandReceipt(
        'gate-command-fixed',
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'requester_revoked',
    })

    expect(
      db.markers().filter((value) => value === 'revoke-requester'),
    ).toHaveLength(1)
    expect(
      db.markers().filter((value) => value === 'audit-insert'),
    ).toHaveLength(3)
    expect(
      db.calls
        .filter(({ sql }) => marker(sql) === 'audit-insert')
        .map(({ params }) => [params[9], params[12]]),
    ).toEqual([
      ['gate_command_requester_recheck', 'requester_revoked'],
      ['gate_command_receipt', 'requester_revoked'],
      ['gate_command_receipt', 'requester_revoked'],
    ])
    expect(db.markers()).not.toContain('receipt-create')
  })

  it('returns a receipt conflict for an already-terminal command even after expiry time', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'receipt-lock':
        case 'audit-insert':
          return []
        case 'receipt-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'receipt-authority':
          return [{
            ...commandRow,
            version: 3,
            status: 'applied',
            outcome_code: 'applied',
            claimed_by_token_id: 'desktop-token-claimant',
            requester_is_live: true,
          }]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date('2026-08-01T12:16:00.000Z'),
    })

    await expect(
      repository.createGateCommandReceipt(commandRow.id, bearerPrincipal),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'receipt_conflict',
    })
    expect(db.markers()).not.toContain('expire-command')
    expect(db.markers()).not.toContain('revoke-requester')
    const audit = db.calls.find(({ sql }) => marker(sql) === 'audit-insert')
    expect(audit?.params).toMatchObject({
      9: 'gate_command_receipt',
      12: 'receipt_conflict',
    })
  })

  it('audits the denied receipt attempt when it expires the command', async () => {
    const expiredAt = '2026-08-01T12:16:00.000Z'
    const expiredRow = {
      ...commandRow,
      version: 2,
      status: 'expired',
      outcome_code: 'expired',
      updated_at: expiredAt,
    }
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'receipt-lock':
        case 'audit-insert':
          return []
        case 'receipt-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'receipt-authority':
          return [{
            ...commandRow,
            claimed_by_token_id: 'desktop-token-claimant',
            requester_is_live: true,
          }]
        case 'expire-command':
          return [expiredRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(expiredAt),
    })

    await expect(
      repository.createGateCommandReceipt(commandRow.id, bearerPrincipal),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'expired',
    })

    expect(
      db.calls
        .filter(({ sql }) => marker(sql) === 'audit-insert')
        .map(({ params }) => [params[9], params[12]]),
    ).toEqual([
      ['gate_command_expire', 'expired'],
      ['gate_command_receipt', 'expired'],
    ])
  })

  it('records an applied acknowledgement without updating the Run projection', async () => {
    const acknowledgedAt = '2026-08-01T12:01:21.000Z'
    const appliedRow = {
      ...deliveringRow,
      version: 3,
      status: 'applied',
      outcome_code: 'applied',
      updated_at: acknowledgedAt,
    }
    const acknowledgedReceipt = {
      ...receiptRow,
      acknowledged_at: acknowledgedAt,
    }
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'ack-lock':
        case 'audit-insert':
          return []
        case 'ack-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'ack-authority':
          return [acknowledgementAuthority()]
        case 'ack-existing':
          return []
        case 'ack-terminalize':
          return [appliedRow]
        case 'ack-create':
          return [acknowledgementRow]
        case 'ack-receipt':
          return [acknowledgedReceipt]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(acknowledgedAt),
      createId: (kind) => `${kind}-fixed`,
    })

    const result = await repository.acknowledgeGateCommand(
      'gate-receipt-fixed',
      acknowledgementInput,
      bearerPrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'acknowledged',
      replayed: false,
      command: { version: 3, status: 'applied', outcomeCode: 'applied' },
      receipt: { acknowledgedAt },
      acknowledgement: {
        outcomeCode: 'applied',
        beforeRunVersion: 3,
        afterRunVersion: 4,
      },
    })
    expect(db.markers()).toEqual([
      'ack-project-probe',
      'bearer-identity',
      'ack-lock',
      'ack-authority',
      'ack-existing',
      'ack-terminalize',
      'ack-create',
      'ack-receipt',
      'audit-insert',
    ])
    const allSql = db.calls.map(({ sql }) => sql).join('\n')
    expect(allSql).not.toMatch(/(?:UPDATE|INSERT INTO)\s+workflow_runs/i)
    const terminalizeCall = db.calls.find(
      ({ sql }) => marker(sql) === 'ack-terminalize',
    )
    expect(terminalizeCall?.sql).toMatch(/version\s*=\s*version\s*\+\s*1/i)
  })

  it.each([
    'ack-project-probe',
    'bearer-identity',
    'ack-authority',
  ] as const)(
    'returns a transient 503 when the %s acknowledgement authority read is unavailable',
    async (failedMarker) => {
      const db = new FakeGateCommandDb((sql) => {
        const currentMarker = marker(sql)
        if (currentMarker === failedMarker) {
          throw new Error(`${failedMarker} unavailable`)
        }
        switch (currentMarker) {
          case 'ack-project-probe':
            return [{ project_id: 'p-payments' }]
          case 'bearer-identity':
            return [bearerIdentity()]
          case 'ack-lock':
            return []
          case 'ack-authority':
            return [acknowledgementAuthority()]
          default:
            throw new Error(`Unexpected query: ${sql}`)
        }
      })
      const repository = createPostgresGateCommandRepository(db)

      await expect(
        repository.acknowledgeGateCommand(
          receiptRow.id,
          acknowledgementInput,
          bearerPrincipal,
        ),
      ).resolves.toMatchObject({
        ok: false,
        responseStatus: 503,
        outcomeCode: 'authoritative_state_unavailable',
      })
      expect(db.calls.map(({ sql }) => sql)).toContain('ROLLBACK')
      expect(db.markers()).not.toContain('audit-insert')
      expect(db.markers()).not.toContain('ack-create')
      expect(db.markers()).not.toContain('ack-terminalize')
    },
  )

  it('audits an acknowledgement denial after live Desktop identity when materialized authority disappears', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'ack-lock':
        case 'audit-insert':
          return []
        case 'ack-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'ack-authority':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db)

    await expect(
      repository.acknowledgeGateCommand(
        receiptRow.id,
        acknowledgementInput,
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'not_found',
    })

    const audit = db.calls.find(({ sql }) => marker(sql) === 'audit-insert')
    expect(audit?.params).toMatchObject({
      7: 'gate_receipt',
      8: receiptRow.id,
      9: 'gate_command_acknowledge',
      12: 'not_found',
    })
  })

  it('audits an acknowledgement conflict when the receipt and command do not match', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'ack-lock':
        case 'audit-insert':
          return []
        case 'ack-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'ack-authority':
          return [acknowledgementAuthority()]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db)

    await expect(
      repository.acknowledgeGateCommand(
        receiptRow.id,
        { ...acknowledgementInput, commandId: 'gate-command-other' },
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'acknowledgement_conflict',
    })

    const audit = db.calls.find(({ sql }) => marker(sql) === 'audit-insert')
    expect(audit?.params).toMatchObject({
      9: 'gate_command_acknowledge',
      12: 'acknowledgement_conflict',
    })
  })

  it('accepts a late acknowledgement evaluated inside the original receipt lease', async () => {
    const acknowledgedAt = '2026-08-01T12:05:00.000Z'
    const appliedRow = {
      ...deliveringRow,
      version: 3,
      status: 'applied',
      outcome_code: 'applied',
      updated_at: acknowledgedAt,
    }
    const acknowledgedReceipt = {
      ...receiptRow,
      acknowledged_at: acknowledgedAt,
    }
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'ack-lock':
        case 'audit-insert':
          return []
        case 'ack-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'ack-authority':
          return [acknowledgementAuthority()]
        case 'ack-existing':
          return []
        case 'ack-terminalize':
          return [appliedRow]
        case 'ack-create':
          return [
            {
              ...acknowledgementRow,
              created_at: acknowledgedAt,
            },
          ]
        case 'ack-receipt':
          return [acknowledgedReceipt]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(acknowledgedAt),
    })

    await expect(
      repository.acknowledgeGateCommand(
        receiptRow.id,
        acknowledgementInput,
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      acknowledgement: {
        evaluatedAt: acknowledgementInput.evaluatedAt,
        createdAt: acknowledgedAt,
      },
    })
    expect(db.markers()).toContain('ack-terminalize')
    expect(db.calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('accepts a bounded fast-client evaluation inside the server-issued receipt lease', async () => {
    const acknowledgedAt = '2026-08-01T12:01:10.000Z'
    const fastClientInput = {
      ...acknowledgementInput,
      evaluatedAt: '2026-08-01T12:01:40.000Z',
    }
    const appliedRow = {
      ...deliveringRow,
      version: 3,
      status: 'applied',
      outcome_code: 'applied',
      updated_at: acknowledgedAt,
    }
    const acknowledgedReceipt = {
      ...receiptRow,
      acknowledged_at: acknowledgedAt,
    }
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'ack-lock':
        case 'audit-insert':
          return []
        case 'ack-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'ack-authority':
          return [acknowledgementAuthority()]
        case 'ack-existing':
          return []
        case 'ack-terminalize':
          return [appliedRow]
        case 'ack-create':
          return [
            {
              ...acknowledgementRow,
              evaluated_at: fastClientInput.evaluatedAt,
              created_at: acknowledgedAt,
            },
          ]
        case 'ack-receipt':
          return [acknowledgedReceipt]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(acknowledgedAt),
    })

    await expect(
      repository.acknowledgeGateCommand(
        receiptRow.id,
        fastClientInput,
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      acknowledgement: { evaluatedAt: fastClientInput.evaluatedAt },
    })
    expect(db.markers()).toContain('ack-terminalize')
    expect(db.calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('rejects a non-expired outcome evaluated at the receipt lease deadline', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'ack-lock':
        case 'audit-insert':
          return []
        case 'ack-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'ack-authority':
          return [acknowledgementAuthority()]
        case 'ack-existing':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date('2026-08-01T12:05:00.000Z'),
    })

    await expect(
      repository.acknowledgeGateCommand(
        receiptRow.id,
        {
          ...acknowledgementInput,
          evaluatedAt: '2026-08-01T12:02:00.000Z',
        },
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'acknowledgement_conflict',
    })
    expect(db.markers()).not.toContain('ack-terminalize')
    expect(db.markers()).not.toContain('ack-create')
    expect(db.calls.at(-1)?.sql).toBe('COMMIT')
    expect(
      db.calls.find(({ sql }) => marker(sql) === 'audit-insert')?.params,
    ).toMatchObject({
      9: 'gate_command_acknowledge',
      12: 'acknowledgement_conflict',
    })
  })

  it('rejects an acknowledgement evaluated against a different Run version', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'ack-lock':
        case 'audit-insert':
          return []
        case 'ack-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'ack-authority':
          return [acknowledgementAuthority()]
        case 'ack-existing':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date('2026-08-01T12:01:21.000Z'),
    })

    await expect(
      repository.acknowledgeGateCommand(
        receiptRow.id,
        {
          ...acknowledgementInput,
          beforeRunVersion: 4,
          afterRunVersion: 5,
        },
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'acknowledgement_conflict',
    })
    expect(db.markers()).not.toContain('ack-terminalize')
    expect(db.markers()).not.toContain('ack-create')
    const audit = db.calls.find(({ sql }) => marker(sql) === 'audit-insert')
    expect(audit?.params).toMatchObject({
      9: 'gate_command_acknowledge',
      12: 'acknowledgement_conflict',
    })
  })

  it('records stale_run with the actual unchanged local Run version', async () => {
    const acknowledgedAt = '2026-08-01T12:01:21.000Z'
    const input = {
      ...acknowledgementInput,
      outcomeCode: 'stale_run' as const,
      beforeRunVersion: 4,
      afterRunVersion: 4,
    }
    const rejectedRow = {
      ...deliveringRow,
      version: 3,
      status: 'rejected',
      outcome_code: 'stale_run',
      updated_at: acknowledgedAt,
    }
    const staleAcknowledgementRow = {
      ...acknowledgementRow,
      outcome_code: 'stale_run',
      before_run_version: 4,
      after_run_version: 4,
    }
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'ack-lock':
        case 'audit-insert':
          return []
        case 'ack-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'ack-authority':
          return [acknowledgementAuthority()]
        case 'ack-existing':
          return []
        case 'ack-terminalize':
          return [rejectedRow]
        case 'ack-create':
          return [staleAcknowledgementRow]
        case 'ack-receipt':
          return [{ ...receiptRow, acknowledged_at: acknowledgedAt }]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(acknowledgedAt),
    })

    await expect(
      repository.acknowledgeGateCommand(
        receiptRow.id,
        input,
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      command: { status: 'rejected', outcomeCode: 'stale_run' },
      acknowledgement: { beforeRunVersion: 4, afterRunVersion: 4 },
    })
  })

  it('rejects an acknowledgement outcome that does not match the requested action', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'ack-lock':
        case 'audit-insert':
          return []
        case 'ack-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'ack-authority':
          return [acknowledgementAuthority()]
        case 'ack-existing':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date('2026-08-01T12:01:21.000Z'),
    })

    await expect(
      repository.acknowledgeGateCommand(
        receiptRow.id,
        {
          ...acknowledgementInput,
          outcomeCode: 'human_rejected',
          afterRunVersion: 3,
        },
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'acknowledgement_conflict',
    })
    expect(db.markers()).not.toContain('ack-terminalize')
    expect(db.markers()).not.toContain('ack-create')
    expect(
      db.calls.find(({ sql }) => marker(sql) === 'audit-insert')?.params,
    ).toMatchObject({
      9: 'gate_command_acknowledge',
      12: 'acknowledgement_conflict',
    })
  })

  it('records an expired report without advancing a command already expired', async () => {
    const acknowledgedAt = '2026-08-01T12:15:10.000Z'
    const expiredInput = {
      ...acknowledgementInput,
      outcomeCode: 'expired' as const,
      afterRunVersion: 3,
      evaluatedAt: '2026-08-01T12:15:01.000Z',
    }
    const expiredAuthority = acknowledgementAuthority({
      version: 3,
      status: 'expired',
      outcome_code: 'expired',
      updated_at: '2026-08-01T12:15:00.000Z',
    })
    const expiredAcknowledgement = {
      ...acknowledgementRow,
      outcome_code: 'expired',
      after_run_version: 3,
      evaluated_at: expiredInput.evaluatedAt,
      created_at: acknowledgedAt,
    }
    const acknowledgedReceipt = {
      ...receiptRow,
      acknowledged_at: acknowledgedAt,
    }
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'ack-lock':
        case 'audit-insert':
          return []
        case 'ack-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'ack-authority':
          return [expiredAuthority]
        case 'ack-existing':
          return []
        case 'ack-create':
          return [expiredAcknowledgement]
        case 'ack-receipt':
          return [acknowledgedReceipt]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date(acknowledgedAt),
    })

    await expect(
      repository.acknowledgeGateCommand(
        receiptRow.id,
        expiredInput,
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      command: { version: 3, status: 'expired', outcomeCode: 'expired' },
      receipt: { acknowledgedAt },
      acknowledgement: {
        outcomeCode: 'expired',
        beforeRunVersion: 3,
        afterRunVersion: 3,
      },
    })
    expect(db.markers()).not.toContain('ack-terminalize')
    expect(db.markers()).toContain('ack-create')
    expect(db.calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('replays only an exact acknowledgement and rejects a different terminal result', async () => {
    const replayDb = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'ack-lock':
        case 'audit-insert':
          return []
        case 'ack-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'ack-authority':
          return [
            acknowledgementAuthority({
              version: 3,
              status: 'applied',
              outcome_code: 'applied',
              receipt_acknowledged_at: acknowledgementRow.created_at,
            }),
          ]
        case 'ack-existing':
          return [acknowledgementRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const replayRepository = createPostgresGateCommandRepository(replayDb)

    await expect(
      replayRepository.acknowledgeGateCommand(
        receiptRow.id,
        acknowledgementInput,
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: true,
      command: { version: 3, status: 'applied' },
      acknowledgement: { outcomeCode: 'applied' },
    })
    expect(replayDb.markers()).not.toContain('ack-terminalize')
    expect(replayDb.markers()).not.toContain('ack-create')
    expect(
      replayDb.calls.find(({ sql }) => marker(sql) === 'audit-insert')?.params,
    ).toMatchObject({
      9: 'gate_command_acknowledge',
      12: 'acknowledged',
    })

    const conflictDb = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'ack-lock':
        case 'audit-insert':
          return []
        case 'ack-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'ack-authority':
          return [
            acknowledgementAuthority({
              version: 3,
              status: 'applied',
              outcome_code: 'applied',
              receipt_acknowledged_at: acknowledgementRow.created_at,
            }),
          ]
        case 'ack-existing':
          return [acknowledgementRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const conflictRepository = createPostgresGateCommandRepository(conflictDb)

    await expect(
      conflictRepository.acknowledgeGateCommand(
        receiptRow.id,
        {
          ...acknowledgementInput,
          outcomeCode: 'stale_run',
          afterRunVersion: 3,
        },
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'acknowledgement_conflict',
    })
    expect(conflictDb.markers()).not.toContain('ack-terminalize')
    expect(conflictDb.markers()).not.toContain('ack-create')
    expect(
      conflictDb.calls.find(({ sql }) => marker(sql) === 'audit-insert')
        ?.params,
    ).toMatchObject({
      9: 'gate_command_acknowledge',
      12: 'acknowledgement_conflict',
    })
  })

  it('audits an acknowledgement conflict when the receipt is already terminal without a matching record', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'ack-lock':
        case 'audit-insert':
          return []
        case 'ack-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'ack-authority':
          return [
            acknowledgementAuthority({
              receipt_acknowledged_at: acknowledgementRow.created_at,
            }),
          ]
        case 'ack-existing':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db)

    await expect(
      repository.acknowledgeGateCommand(
        receiptRow.id,
        acknowledgementInput,
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'acknowledgement_conflict',
    })

    expect(
      db.calls.find(({ sql }) => marker(sql) === 'audit-insert')?.params,
    ).toMatchObject({
      9: 'gate_command_acknowledge',
      12: 'acknowledgement_conflict',
    })
  })

  it('rejects acknowledgement from a token other than the exact claimant and lessee', async () => {
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'ack-lock':
        case 'audit-insert':
          return []
        case 'ack-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'ack-authority':
          return [
            acknowledgementAuthority({
              claimed_by_token_id: 'desktop-token-other',
            }),
          ]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db)

    await expect(
      repository.acknowledgeGateCommand(
        receiptRow.id,
        acknowledgementInput,
        bearerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'claimant_forbidden',
    })
    expect(db.markers()).not.toContain('ack-existing')
    expect(db.markers()).not.toContain('ack-terminalize')
    expect(db.markers()).not.toContain('ack-create')
    const audit = db.calls.find(({ sql }) => marker(sql) === 'audit-insert')
    expect(audit?.params).toMatchObject({
      9: 'gate_command_acknowledge',
      12: 'claimant_forbidden',
    })
  })

  it('rolls back the command terminal update when acknowledgement creation fails', async () => {
    const appliedRow = {
      ...deliveringRow,
      version: 3,
      status: 'applied',
      outcome_code: 'applied',
      updated_at: '2026-08-01T12:01:21.000Z',
    }
    const failure = new Error('simulated acknowledgement insert failure')
    const db = new FakeGateCommandDb((sql) => {
      switch (marker(sql)) {
        case 'ack-lock':
          return []
        case 'ack-project-probe':
          return [{ project_id: 'p-payments' }]
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'ack-authority':
          return [acknowledgementAuthority()]
        case 'ack-existing':
          return []
        case 'ack-terminalize':
          return [appliedRow]
        case 'ack-create':
          throw failure
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGateCommandRepository(db, {
      now: () => new Date('2026-08-01T12:01:21.000Z'),
    })

    await expect(
      repository.acknowledgeGateCommand(
        receiptRow.id,
        acknowledgementInput,
        bearerPrincipal,
      ),
    ).rejects.toBe(failure)
    expect(db.markers()).toContain('ack-terminalize')
    expect(db.calls.map(({ sql }) => sql)).toContain('ROLLBACK')
    expect(db.calls.map(({ sql }) => sql)).not.toContain('COMMIT')
  })
})
