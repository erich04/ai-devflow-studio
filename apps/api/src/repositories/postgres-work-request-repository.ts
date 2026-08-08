import { randomUUID } from 'node:crypto'
import type {
  ClaimWorkRequestInput,
  CreateWorkRequestInput,
  MaterializeWorkRequestInput,
  ReleaseWorkRequestInput,
  Role,
  WorkRequest,
  WorkRequestStatus,
} from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'
import type { TeamDbRepositoryClient } from '../db/client'
import {
  withTeamDbTransaction,
  type TeamDbTransactionClient,
} from '../db/transaction'
import {
  fingerprintWorkRequestOperation,
  safeWorkRequest,
  type MaterializedWorkRequestClaimResolver,
  type WorkRequestMutationResult,
  type WorkRequestOperationInput,
  type WorkRequestOperationKind,
  type WorkRequestRejectionCode,
  type WorkRequestRepository,
  type WorkRequestSuccessCode,
} from './work-request-contract'
import { collaborationRunLockKey } from './collaboration-run-lock'

type TimestampValue = string | Date

type WorkRequestRow = {
  id: string
  organization_id: string
  project_id: string
  title: string
  request: string
  version: number
  status: WorkRequestStatus
  created_by_user_id: string
  claimed_by_token_id: string | null
  claimed_run_id: string | null
  claimed_at: TimestampValue | null
  materialized_at: TimestampValue | null
  expires_at: TimestampValue | null
  created_at: TimestampValue
  updated_at: TimestampValue
}

type WorkRequestProbeRow = {
  project_id: string
  claimed_run_id: string | null
}

type IdentityRow = {
  user_id: string
  organization_id: string
  organization_role: Role
  project_role: Role | null
}

type BearerIdentityRow = IdentityRow & { project_id: string }

type IdempotencyRow = {
  project_id: string
  request_fingerprint: string
  response_json: unknown
}

type VerifiedIdentity = {
  organizationId: string
  projectId: string
  userId: string
  role: Role
  hasProjectAccess: boolean
  authKind: RequestPrincipal['authentication']['kind']
  tokenRecordId: string | null
}

type IdKind = 'work_request' | 'idempotency' | 'audit'

export type PostgresWorkRequestRepositoryOptions = {
  now?: () => Date
  createId?: (kind: IdKind) => string
}

const workRequestColumns = `
  work_requests.id,
  work_requests.organization_id,
  work_requests.project_id,
  work_requests.title,
  work_requests.request,
  work_requests.version,
  work_requests.status,
  work_requests.created_by_user_id,
  work_requests.claimed_by_token_id,
  work_requests.claimed_run_id,
  work_requests.claimed_at,
  work_requests.materialized_at,
  work_requests.expires_at,
  work_requests.created_at,
  work_requests.updated_at
`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toIso(value: TimestampValue): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Invalid Work Request timestamp loaded from storage.')
  }
  return date.toISOString()
}

function mapWorkRequestRow(row: WorkRequestRow): WorkRequest {
  const hasClaim = row.claimed_run_id !== null && row.claimed_at !== null
  return safeWorkRequest({
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    title: row.title,
    request: row.request,
    version: row.version,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    claim: hasClaim
      ? {
          runId: row.claimed_run_id,
          claimedAt: toIso(row.claimed_at as TimestampValue),
          materializedAt:
            row.materialized_at === null ? null : toIso(row.materialized_at),
        }
      : null,
    expiresAt: row.expires_at === null ? null : toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  })
}

function rejection(code: WorkRequestRejectionCode): WorkRequestMutationResult {
  const statusByCode: Record<
    WorkRequestRejectionCode,
    403 | 404 | 409 | 410
  > = {
    authentication_forbidden: 403,
    project_forbidden: 403,
    not_found: 404,
    idempotency_conflict: 409,
    stale_version: 409,
    claim_conflict: 409,
    claimant_forbidden: 403,
    not_claim_pending: 409,
    canonical_projection_exists: 409,
    expired: 410,
  }
  return {
    ok: false,
    responseStatus: statusByCode[code],
    outcomeCode: code,
    replayed: false,
  }
}

function success(
  code: WorkRequestSuccessCode,
  workRequest: WorkRequest,
): WorkRequestMutationResult {
  return {
    ok: true,
    responseStatus: code === 'created' ? 201 : 200,
    outcomeCode: code,
    replayed: false,
    workRequest: safeWorkRequest(workRequest),
  }
}

function decodeStoredResult(value: unknown): WorkRequestMutationResult {
  const decoded = typeof value === 'string' ? JSON.parse(value) : value
  if (!isRecord(decoded) || typeof decoded.ok !== 'boolean') {
    throw new Error('Invalid Work Request idempotency result.')
  }

  if (decoded.ok) {
    if (
      typeof decoded.outcomeCode !== 'string' ||
      !['created', 'claimed', 'materialized', 'released'].includes(
        decoded.outcomeCode,
      )
    ) {
      throw new Error('Invalid Work Request idempotency result.')
    }
    const outcomeCode = decoded.outcomeCode as WorkRequestSuccessCode
    const expectedStatus = outcomeCode === 'created' ? 201 : 200
    if (decoded.responseStatus !== expectedStatus) {
      throw new Error('Invalid Work Request idempotency result.')
    }
    return {
      ok: true,
      responseStatus: expectedStatus,
      outcomeCode,
      replayed: true,
      workRequest: safeWorkRequest(decoded.workRequest),
    }
  }

  if (
    typeof decoded.outcomeCode !== 'string' ||
    ![
      'authentication_forbidden',
      'project_forbidden',
      'not_found',
      'idempotency_conflict',
      'stale_version',
      'claim_conflict',
      'claimant_forbidden',
      'not_claim_pending',
      'canonical_projection_exists',
      'expired',
    ].includes(decoded.outcomeCode)
  ) {
    throw new Error('Invalid Work Request idempotency result.')
  }
  const original = rejection(decoded.outcomeCode as WorkRequestRejectionCode)
  if (decoded.responseStatus !== original.responseStatus) {
    throw new Error('Invalid Work Request idempotency result.')
  }
  return { ...original, replayed: true }
}

function soleSessionProject(principal: RequestPrincipal): string | null {
  const projectIds = [
    ...new Set(
      principal.session.projectMemberships.map(({ projectId }) => projectId),
    ),
  ]
  return projectIds.length === 1 ? (projectIds[0] ?? null) : null
}

function isLeadOrOwner(role: Role): boolean {
  return role === 'lead' || role === 'owner'
}

export function createPostgresWorkRequestRepository(
  db: TeamDbRepositoryClient,
  options: PostgresWorkRequestRepositoryOptions = {},
): WorkRequestRepository & MaterializedWorkRequestClaimResolver {
  const now = options.now ?? (() => new Date())
  const createId =
    options.createId ?? ((kind: IdKind) => `${kind.replace('_', '-')}-${randomUUID()}`)

  async function lockIdempotencyKey(
    tx: TeamDbTransactionClient,
    operation: WorkRequestOperationKind,
    idempotencyKey: string,
    principal: RequestPrincipal,
  ): Promise<void> {
    await tx.query(
      `
        /* work_request:idempotency-lock */
        SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
      `,
      [
        JSON.stringify([
          principal.session.organizationId,
          principal.session.userId,
          operation,
          idempotencyKey,
        ]),
      ],
    )
  }

  async function probeWorkRequest(
    tx: TeamDbTransactionClient,
    workRequestId: string,
    principal: RequestPrincipal,
  ): Promise<{ projectId: string; claimedRunId: string | null } | null> {
    const [row] = await tx.query<WorkRequestProbeRow>(
      `
        /* work_request:project-probe */
        SELECT project_id, claimed_run_id
        FROM work_requests
        WHERE id = $1
          AND organization_id = $2
        LIMIT 1
      `,
      [workRequestId, principal.session.organizationId],
    )
    if (row) {
      return {
        projectId: row.project_id,
        claimedRunId: row.claimed_run_id ?? null,
      }
    }
    const projectId = soleSessionProject(principal)
    return projectId === null ? null : { projectId, claimedRunId: null }
  }

  async function lockRunAuthority(
    tx: TeamDbTransactionClient,
    input: { organizationId: string; projectId: string; runId: string },
    operation: 'claim' | 'release',
  ): Promise<void> {
    await tx.query(
      `
        /* work_request:${operation}-run-lock */
        SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
      `,
      [collaborationRunLockKey(input)],
    )
  }

  async function loadIdempotencyResult(
    tx: TeamDbTransactionClient,
    projectId: string,
    operation: WorkRequestOperationKind,
    idempotencyKey: string,
    principal: RequestPrincipal,
  ): Promise<IdempotencyRow | null> {
    const [row] = await tx.query<IdempotencyRow>(
      `
        /* work_request:idempotency-read */
        SELECT project_id, request_fingerprint, response_json
        FROM collaboration_idempotency
        WHERE organization_id = $1
          AND project_id = $2
          AND actor_user_id = $3
          AND operation_kind = $4
          AND idempotency_key = $5
        LIMIT 1
      `,
      [
        principal.session.organizationId,
        projectId,
        principal.session.userId,
        operation,
        idempotencyKey,
      ],
    )
    return row ?? null
  }

  async function loadCookieIdentity(
    query: TeamDbTransactionClient,
    principal: RequestPrincipal,
    projectId: string,
    lockAuthority = false,
  ): Promise<VerifiedIdentity | null> {
    if (
      principal.authentication.kind !== 'session_cookie' ||
      principal.session.source !== 'authenticated'
    ) {
      return null
    }
    const [row] = await query.query<IdentityRow>(
      `
        /* work_request:cookie-identity */
        SELECT
          users.id AS user_id,
          users.organization_id,
          users.role AS organization_role,
          (
            SELECT project_members.role
            FROM project_members
            WHERE project_members.project_id = projects.id
              AND project_members.user_id = users.id
            LIMIT 1
            ${lockAuthority ? 'FOR SHARE' : ''}
          ) AS project_role
        FROM auth_accounts
        JOIN users ON users.id = auth_accounts.user_id
        JOIN projects
          ON projects.id = $4
         AND projects.organization_id = users.organization_id
        WHERE auth_accounts.id = $1
          AND users.organization_id = $2
          AND users.id = $3
        LIMIT 1
        ${lockAuthority ? 'FOR SHARE OF auth_accounts, users, projects' : ''}
      `,
      [
        principal.session.authAccountId,
        principal.session.organizationId,
        principal.session.userId,
        projectId,
      ],
    )
    if (!row) {
      return null
    }
    const hasProjectAccess =
      row.organization_role === 'owner' || row.project_role !== null
    return {
      organizationId: row.organization_id,
      projectId,
      userId: row.user_id,
      role:
        row.organization_role === 'owner'
          ? 'owner'
          : (row.project_role ?? row.organization_role),
      hasProjectAccess,
      authKind: 'session_cookie',
      tokenRecordId: null,
    }
  }

  async function loadBearerIdentity(
    query: TeamDbTransactionClient,
    principal: RequestPrincipal,
    projectId: string,
    lockAuthority = false,
  ): Promise<VerifiedIdentity | null> {
    if (
      principal.authentication.kind !== 'desktop_bearer' ||
      principal.session.source !== 'authenticated'
    ) {
      return null
    }
    const [row] = await query.query<BearerIdentityRow>(
      `
        /* work_request:bearer-identity */
        SELECT
          users.id AS user_id,
          users.organization_id,
          users.role AS organization_role,
          desktop_tokens.project_id,
          (
            SELECT project_members.role
            FROM project_members
            WHERE project_members.project_id = projects.id
              AND project_members.user_id = users.id
            LIMIT 1
            ${lockAuthority ? 'FOR SHARE' : ''}
          ) AS project_role
        FROM desktop_tokens
        JOIN users
          ON users.id = desktop_tokens.user_id
         AND users.organization_id = desktop_tokens.organization_id
        JOIN projects
          ON projects.id = desktop_tokens.project_id
         AND projects.organization_id = desktop_tokens.organization_id
        WHERE desktop_tokens.id = $1
          AND desktop_tokens.organization_id = $2
          AND desktop_tokens.user_id = $3
          AND desktop_tokens.project_id = $4
          AND desktop_tokens.revoked_at IS NULL
        LIMIT 1
        ${lockAuthority ? 'FOR SHARE OF desktop_tokens, users, projects' : ''}
      `,
      [
        principal.authentication.tokenRecordId,
        principal.session.organizationId,
        principal.session.userId,
        projectId,
      ],
    )
    if (!row) {
      return null
    }
    return {
      organizationId: row.organization_id,
      projectId: row.project_id,
      userId: row.user_id,
      role:
        row.project_role === 'owner'
          ? 'lead'
          : (row.project_role ?? row.organization_role),
      hasProjectAccess: row.project_role !== null,
      authKind: 'desktop_bearer',
      tokenRecordId: principal.authentication.tokenRecordId,
    }
  }

  async function lockWorkRequest(
    tx: TeamDbTransactionClient,
    workRequestId: string,
    identity: VerifiedIdentity,
  ): Promise<WorkRequestRow | null> {
    const [row] = await tx.query<WorkRequestRow>(
      `
        /* work_request:row-lock */
        SELECT ${workRequestColumns}
        FROM work_requests
        WHERE id = $1
          AND organization_id = $2
          AND project_id = $3
        FOR UPDATE
      `,
      [workRequestId, identity.organizationId, identity.projectId],
    )
    return row ?? null
  }

  async function appendAudit(
    tx: TeamDbTransactionClient,
    input: {
      identity: VerifiedIdentity
      recordId: string
      operation: WorkRequestOperationKind
      expectedVersion: number | null
      observedVersion: number | null
      outcomeCode: string
      fingerprint: string
    },
  ): Promise<void> {
    await tx.query(
      `
        /* work_request:audit-insert */
        INSERT INTO collaboration_audit_events (
          id,
          organization_id,
          project_id,
          actor_user_id,
          actor_role,
          auth_kind,
          auth_token_record_id,
          record_kind,
          record_id,
          action,
          expected_version,
          observed_version,
          outcome_code,
          request_fingerprint,
          details
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          'work_request', $8, $9, $10, $11, $12, $13, $14::jsonb
        )
      `,
      [
        createId('audit'),
        input.identity.organizationId,
        input.identity.projectId,
        input.identity.userId,
        input.identity.role,
        input.identity.authKind,
        input.identity.tokenRecordId,
        input.recordId,
        input.operation,
        input.expectedVersion,
        input.observedVersion,
        input.outcomeCode,
        input.fingerprint,
        '{}',
      ],
    )
  }

  async function saveIdempotencyResult(
    tx: TeamDbTransactionClient,
    input: {
      identity: VerifiedIdentity
      operation: WorkRequestOperationKind
      idempotencyKey: string
      fingerprint: string
      result: WorkRequestMutationResult
    },
  ): Promise<void> {
    await tx.query(
      `
        /* work_request:idempotency-insert */
        INSERT INTO collaboration_idempotency (
          id,
          organization_id,
          project_id,
          actor_user_id,
          auth_kind,
          auth_token_record_id,
          operation_kind,
          idempotency_key,
          request_fingerprint,
          response_status,
          outcome_code,
          response_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      `,
      [
        createId('idempotency'),
        input.identity.organizationId,
        input.identity.projectId,
        input.identity.userId,
        input.identity.authKind,
        input.identity.tokenRecordId,
        input.operation,
        input.idempotencyKey,
        input.fingerprint,
        input.result.responseStatus,
        input.result.outcomeCode,
        JSON.stringify(input.result),
      ],
    )
  }

  async function finalize(
    tx: TeamDbTransactionClient,
    input: {
      identity: VerifiedIdentity
      recordId: string
      operation: WorkRequestOperationKind
      operationInput: WorkRequestOperationInput
      expectedVersion: number | null
      observedVersion: number | null
      result: WorkRequestMutationResult
    },
  ): Promise<WorkRequestMutationResult> {
    const fingerprint = fingerprintWorkRequestOperation(
      input.operation,
      input.operationInput,
    )
    await appendAudit(tx, {
      identity: input.identity,
      recordId: input.recordId,
      operation: input.operation,
      expectedVersion: input.expectedVersion,
      observedVersion: input.observedVersion,
      outcomeCode: input.result.outcomeCode,
      fingerprint,
    })
    await saveIdempotencyResult(tx, {
      identity: input.identity,
      operation: input.operation,
      idempotencyKey: input.operationInput.idempotencyKey,
      fingerprint,
      result: input.result,
    })
    return input.result
  }

  async function replayOrConflict(
    existing: IdempotencyRow | null,
    operation: WorkRequestOperationKind,
    input: WorkRequestOperationInput,
  ): Promise<WorkRequestMutationResult | null> {
    if (!existing) {
      return null
    }
    const fingerprint = fingerprintWorkRequestOperation(operation, input)
    if (existing.request_fingerprint !== fingerprint) {
      return rejection('idempotency_conflict')
    }
    return decodeStoredResult(existing.response_json)
  }

  async function mutationPrelude(
    tx: TeamDbTransactionClient,
    operation: WorkRequestOperationKind,
    input: WorkRequestOperationInput,
    principal: RequestPrincipal,
    projectId: string,
  ): Promise<{
    existing: IdempotencyRow | null
    replay: WorkRequestMutationResult | null
  }> {
    await lockIdempotencyKey(tx, operation, input.idempotencyKey, principal)
    const existing = await loadIdempotencyResult(
      tx,
      projectId,
      operation,
      input.idempotencyKey,
      principal,
    )
    return {
      existing,
      replay: await replayOrConflict(existing, operation, input),
    }
  }

  async function finalizeProjectDenial(
    tx: TeamDbTransactionClient,
    input: {
      identity: VerifiedIdentity | null
      existing: IdempotencyRow | null
      recordId: string
      operation: WorkRequestOperationKind
      operationInput: WorkRequestOperationInput
      expectedVersion: number | null
    },
  ): Promise<WorkRequestMutationResult> {
    const result = rejection('project_forbidden')
    if (!input.identity || input.existing) {
      return result
    }
    return finalize(tx, {
      identity: input.identity,
      recordId: input.recordId,
      operation: input.operation,
      operationInput: input.operationInput,
      expectedVersion: input.expectedVersion,
      observedVersion: null,
      result,
    })
  }

  async function listWorkRequests(
    projectId: string,
    principal: RequestPrincipal,
  ): Promise<WorkRequest[]> {
    const identity =
      principal.authentication.kind === 'session_cookie'
        ? await loadCookieIdentity(db, principal, projectId)
        : principal.authentication.kind === 'desktop_bearer'
          ? await loadBearerIdentity(db, principal, projectId)
          : null
    if (!identity?.hasProjectAccess) {
      return []
    }
    const rows =
      identity.authKind === 'desktop_bearer'
        ? await db.query<WorkRequestRow>(
            `
              /* work_request:list-bearer */
              SELECT ${workRequestColumns}
              FROM work_requests
              WHERE organization_id = $1
                AND project_id = $2
                AND (
                  status = 'open'
                  OR (
                    status IN ('claim_pending', 'materialized')
                    AND claimed_by_token_id = $3
                  )
                )
              ORDER BY created_at DESC, id ASC
            `,
            [
              identity.organizationId,
              identity.projectId,
              identity.tokenRecordId,
            ],
          )
        : await db.query<WorkRequestRow>(
            `
              /* work_request:list */
              SELECT ${workRequestColumns}
              FROM work_requests
              WHERE organization_id = $1
                AND project_id = $2
              ORDER BY created_at DESC, id ASC
            `,
            [identity.organizationId, identity.projectId],
          )
    return rows.map(mapWorkRequestRow)
  }

  async function createWorkRequest(
    input: CreateWorkRequestInput,
    principal: RequestPrincipal,
  ): Promise<WorkRequestMutationResult> {
    return withTeamDbTransaction(db, async (tx) => {
      const operation = 'work_request_create' as const
      const { existing, replay } = await mutationPrelude(
        tx,
        operation,
        input,
        principal,
        input.projectId,
      )
      if (principal.authentication.kind !== 'session_cookie') {
        return rejection('authentication_forbidden')
      }
      const identity = await loadCookieIdentity(
        tx,
        principal,
        input.projectId,
        true,
      )
      if (!identity?.hasProjectAccess) {
        return finalizeProjectDenial(tx, {
          identity,
          existing,
          recordId: createId('work_request'),
          operation,
          operationInput: input,
          expectedVersion: null,
        })
      }
      if (replay) {
        return replay
      }

      const workRequestId = createId('work_request')
      const timestamp = now().toISOString()
      if (
        input.expiresAt !== null &&
        Date.parse(input.expiresAt) <= Date.parse(timestamp)
      ) {
        return finalize(tx, {
          identity,
          recordId: workRequestId,
          operation,
          operationInput: input,
          expectedVersion: null,
          observedVersion: null,
          result: rejection('expired'),
        })
      }

      const [row] = await tx.query<WorkRequestRow>(
        `
          /* work_request:create */
          INSERT INTO work_requests (
            id,
            organization_id,
            project_id,
            title,
            request,
            version,
            status,
            created_by_user_id,
            expires_at,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, 1, 'open', $6, $7, $8, $8)
          RETURNING ${workRequestColumns}
        `,
        [
          workRequestId,
          identity.organizationId,
          identity.projectId,
          input.title,
          input.request,
          identity.userId,
          input.expiresAt,
          timestamp,
        ],
      )
      if (!row) {
        throw new Error('Work Request create returned no record.')
      }
      const result = success('created', mapWorkRequestRow(row))
      return finalize(tx, {
        identity,
        recordId: row.id,
        operation,
        operationInput: input,
        expectedVersion: null,
        observedVersion: row.version,
        result,
      })
    })
  }

  async function claimWorkRequest(
    input: ClaimWorkRequestInput,
    principal: RequestPrincipal,
  ): Promise<WorkRequestMutationResult> {
    return withTeamDbTransaction(db, async (tx) => {
      const operation = 'work_request_claim' as const
      await lockIdempotencyKey(tx, operation, input.idempotencyKey, principal)
      const probe = await probeWorkRequest(tx, input.workRequestId, principal)
      if (!probe) {
        return rejection('not_found')
      }
      const { projectId } = probe
      const existing = await loadIdempotencyResult(
        tx,
        projectId,
        operation,
        input.idempotencyKey,
        principal,
      )
      const replay = await replayOrConflict(existing, operation, input)
      if (principal.authentication.kind !== 'desktop_bearer') {
        return rejection('authentication_forbidden')
      }
      const identity = await loadBearerIdentity(
        tx,
        principal,
        projectId,
        true,
      )
      if (!identity?.hasProjectAccess) {
        return finalizeProjectDenial(tx, {
          identity,
          existing,
          recordId: input.workRequestId,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
        })
      }
      if (replay) {
        return replay
      }

      await lockRunAuthority(
        tx,
        {
          organizationId: identity.organizationId,
          projectId: identity.projectId,
          runId: input.runId,
        },
        'claim',
      )
      const row = await lockWorkRequest(tx, input.workRequestId, identity)
      if (!row) {
        return finalize(tx, {
          identity,
          recordId: input.workRequestId,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: null,
          result: rejection('not_found'),
        })
      }
      const timestamp = now().toISOString()
      if (
        row.status === 'open' &&
        row.expires_at !== null &&
        Date.parse(toIso(row.expires_at)) <= Date.parse(timestamp)
      ) {
        const [expiredRow] = await tx.query<WorkRequestRow>(
          `
            /* work_request:expire */
            UPDATE work_requests
            SET status = 'expired',
                version = version + 1,
                updated_at = $4
            WHERE id = $1
              AND organization_id = $2
              AND project_id = $3
              AND status = 'open'
              AND version = $5
            RETURNING ${workRequestColumns}
          `,
          [
            row.id,
            identity.organizationId,
            identity.projectId,
            timestamp,
            row.version,
          ],
        )
        if (!expiredRow) {
          throw new Error('Work Request expiry update returned no record.')
        }
        return finalize(tx, {
          identity,
          recordId: row.id,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: expiredRow.version,
          result: rejection('expired'),
        })
      }
      if (row.version !== input.expectedVersion) {
        return finalize(tx, {
          identity,
          recordId: row.id,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: row.version,
          result: rejection('stale_version'),
        })
      }
      if (row.status !== 'open') {
        return finalize(tx, {
          identity,
          recordId: row.id,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: row.version,
          result: rejection('claim_conflict'),
        })
      }

      const [runConflict] = await tx.query<{ conflict_kind: string }>(
        `
          /* work_request:claim-run-conflict */
          SELECT conflict_kind
          FROM (
            SELECT 'work_request' AS conflict_kind
            FROM work_requests
            WHERE work_requests.organization_id = $1
              AND work_requests.project_id = $2
              AND work_requests.claimed_run_id = $3
              AND work_requests.id <> $4

            UNION ALL

            SELECT 'workflow_run' AS conflict_kind
            FROM workflow_runs
            WHERE workflow_runs.organization_id = $1
              AND workflow_runs.project_id = $2
              AND workflow_runs.id = $3
          ) AS run_conflicts
          LIMIT 1
        `,
        [identity.organizationId, identity.projectId, input.runId, row.id],
      )
      if (runConflict) {
        return finalize(tx, {
          identity,
          recordId: row.id,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: row.version,
          result: rejection('claim_conflict'),
        })
      }

      const [claimedRow] = await tx.query<WorkRequestRow>(
        `
          /* work_request:claim */
          UPDATE work_requests
          SET status = 'claim_pending',
              version = version + 1,
              claimed_by_token_id = $4,
              claimed_run_id = $5,
              claimed_at = $6,
              updated_at = $6
          WHERE id = $1
            AND organization_id = $2
            AND project_id = $3
            AND version = $7
            AND status = 'open'
            AND claimed_by_token_id IS NULL
            AND claimed_run_id IS NULL
          RETURNING ${workRequestColumns}
        `,
        [
          row.id,
          identity.organizationId,
          identity.projectId,
          identity.tokenRecordId,
          input.runId,
          timestamp,
          input.expectedVersion,
        ],
      )
      if (!claimedRow) {
        return finalize(tx, {
          identity,
          recordId: row.id,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: row.version,
          result: rejection('claim_conflict'),
        })
      }
      const result = success('claimed', mapWorkRequestRow(claimedRow))
      return finalize(tx, {
        identity,
        recordId: row.id,
        operation,
        operationInput: input,
        expectedVersion: input.expectedVersion,
        observedVersion: claimedRow.version,
        result,
      })
    })
  }

  async function materializeWorkRequest(
    input: MaterializeWorkRequestInput,
    principal: RequestPrincipal,
  ): Promise<WorkRequestMutationResult> {
    return withTeamDbTransaction(db, async (tx) => {
      const operation = 'work_request_materialize' as const
      await lockIdempotencyKey(tx, operation, input.idempotencyKey, principal)
      const probe = await probeWorkRequest(tx, input.workRequestId, principal)
      if (!probe) {
        return rejection('not_found')
      }
      const { projectId } = probe
      const existing = await loadIdempotencyResult(
        tx,
        projectId,
        operation,
        input.idempotencyKey,
        principal,
      )
      const replay = await replayOrConflict(existing, operation, input)
      if (principal.authentication.kind !== 'desktop_bearer') {
        return rejection('authentication_forbidden')
      }
      const identity = await loadBearerIdentity(
        tx,
        principal,
        projectId,
        true,
      )
      if (!identity?.hasProjectAccess) {
        return finalizeProjectDenial(tx, {
          identity,
          existing,
          recordId: input.workRequestId,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
        })
      }
      if (replay) {
        return replay
      }

      const row = await lockWorkRequest(tx, input.workRequestId, identity)
      if (!row) {
        return finalize(tx, {
          identity,
          recordId: input.workRequestId,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: null,
          result: rejection('not_found'),
        })
      }
      if (row.version !== input.expectedVersion) {
        return finalize(tx, {
          identity,
          recordId: row.id,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: row.version,
          result: rejection('stale_version'),
        })
      }
      if (row.status !== 'claim_pending') {
        return finalize(tx, {
          identity,
          recordId: row.id,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: row.version,
          result: rejection('not_claim_pending'),
        })
      }
      if (
        row.claimed_by_token_id !== identity.tokenRecordId ||
        row.claimed_run_id !== input.runId
      ) {
        return finalize(tx, {
          identity,
          recordId: row.id,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: row.version,
          result: rejection('claimant_forbidden'),
        })
      }

      const timestamp = now().toISOString()
      const [materializedRow] = await tx.query<WorkRequestRow>(
        `
          /* work_request:materialize */
          UPDATE work_requests
          SET status = 'materialized',
              version = version + 1,
              materialized_at = $6,
              updated_at = $6
          WHERE id = $1
            AND organization_id = $2
            AND project_id = $3
            AND claimed_by_token_id = $4
            AND claimed_run_id = $5
            AND version = $7
            AND status = 'claim_pending'
          RETURNING ${workRequestColumns}
        `,
        [
          row.id,
          identity.organizationId,
          identity.projectId,
          identity.tokenRecordId,
          input.runId,
          timestamp,
          input.expectedVersion,
        ],
      )
      if (!materializedRow) {
        return finalize(tx, {
          identity,
          recordId: row.id,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: row.version,
          result: rejection('claimant_forbidden'),
        })
      }
      const result = success('materialized', mapWorkRequestRow(materializedRow))
      return finalize(tx, {
        identity,
        recordId: row.id,
        operation,
        operationInput: input,
        expectedVersion: input.expectedVersion,
        observedVersion: materializedRow.version,
        result,
      })
    })
  }

  async function releaseWorkRequest(
    input: ReleaseWorkRequestInput,
    principal: RequestPrincipal,
  ): Promise<WorkRequestMutationResult> {
    return withTeamDbTransaction(db, async (tx) => {
      const operation = 'work_request_release' as const
      await lockIdempotencyKey(tx, operation, input.idempotencyKey, principal)
      const probe = await probeWorkRequest(tx, input.workRequestId, principal)
      if (!probe) {
        return rejection('not_found')
      }
      const { projectId } = probe
      const existing = await loadIdempotencyResult(
        tx,
        projectId,
        operation,
        input.idempotencyKey,
        principal,
      )
      const replay = await replayOrConflict(existing, operation, input)
      if (principal.authentication.kind !== 'session_cookie') {
        return rejection('authentication_forbidden')
      }
      const identity = await loadCookieIdentity(
        tx,
        principal,
        projectId,
        true,
      )
      if (!identity?.hasProjectAccess || !isLeadOrOwner(identity.role)) {
        return finalizeProjectDenial(tx, {
          identity,
          existing,
          recordId: input.workRequestId,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
        })
      }
      if (replay) {
        return replay
      }

      if (probe.claimedRunId !== null) {
        await lockRunAuthority(
          tx,
          {
            organizationId: identity.organizationId,
            projectId: identity.projectId,
            runId: probe.claimedRunId,
          },
          'release',
        )
      }
      const row = await lockWorkRequest(tx, input.workRequestId, identity)
      if (!row) {
        return finalize(tx, {
          identity,
          recordId: input.workRequestId,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: null,
          result: rejection('not_found'),
        })
      }
      if (row.version !== input.expectedVersion) {
        return finalize(tx, {
          identity,
          recordId: row.id,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: row.version,
          result: rejection('stale_version'),
        })
      }
      if (row.status !== 'claim_pending' || row.claimed_run_id === null) {
        return finalize(tx, {
          identity,
          recordId: row.id,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: row.version,
          result: rejection('not_claim_pending'),
        })
      }
      if (probe.claimedRunId !== row.claimed_run_id) {
        return finalize(tx, {
          identity,
          recordId: row.id,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: row.version,
          result: rejection('stale_version'),
        })
      }

      const [projection] = await tx.query<{ projection_exists: boolean }>(
        `
          /* work_request:canonical-run-check */
          SELECT EXISTS (
            SELECT 1
            FROM workflow_runs
            WHERE id = $1
              AND organization_id = $2
              AND project_id = $3
          ) AS projection_exists
        `,
        [row.claimed_run_id, identity.organizationId, identity.projectId],
      )
      if (projection?.projection_exists !== false) {
        return finalize(tx, {
          identity,
          recordId: row.id,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: row.version,
          result: rejection('canonical_projection_exists'),
        })
      }

      const timestamp = now().toISOString()
      await tx.query(
        `
          /* work_request:release-tombstone */
          INSERT INTO released_work_request_claims (
            organization_id,
            project_id,
            work_request_id,
            run_id,
            claimed_by_token_id,
            released_by_user_id,
            released_claim_version,
            released_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (organization_id, project_id, run_id) DO UPDATE
          SET work_request_id = excluded.work_request_id,
              claimed_by_token_id = excluded.claimed_by_token_id,
              released_by_user_id = excluded.released_by_user_id,
              released_claim_version = excluded.released_claim_version,
              released_at = excluded.released_at
        `,
        [
          identity.organizationId,
          identity.projectId,
          row.id,
          row.claimed_run_id,
          row.claimed_by_token_id,
          identity.userId,
          row.version,
          timestamp,
        ],
      )
      const [releasedRow] = await tx.query<WorkRequestRow>(
        `
          /* work_request:release */
          UPDATE work_requests
          SET status = CASE
                WHEN expires_at IS NOT NULL AND expires_at <= $4 THEN 'expired'
                ELSE 'open'
              END,
              version = version + 1,
              claimed_by_token_id = NULL,
              claimed_run_id = NULL,
              claimed_at = NULL,
              materialized_at = NULL,
              updated_at = $4
          WHERE id = $1
            AND organization_id = $2
            AND project_id = $3
            AND version = $5
            AND status = 'claim_pending'
          RETURNING ${workRequestColumns}
        `,
        [
          row.id,
          identity.organizationId,
          identity.projectId,
          timestamp,
          input.expectedVersion,
        ],
      )
      if (!releasedRow) {
        return finalize(tx, {
          identity,
          recordId: row.id,
          operation,
          operationInput: input,
          expectedVersion: input.expectedVersion,
          observedVersion: row.version,
          result: rejection('not_claim_pending'),
        })
      }
      const result = success('released', mapWorkRequestRow(releasedRow))
      return finalize(tx, {
        identity,
        recordId: row.id,
        operation,
        operationInput: input,
        expectedVersion: input.expectedVersion,
        observedVersion: releasedRow.version,
        result,
      })
    })
  }

  async function resolveMaterializedWorkRequestClaim(input: {
    organizationId: string
    projectId: string
    runId: string
  }) {
    const [row] = await db.query<{
      organization_id: string
      project_id: string
      work_request_id: string
      run_id: string
      claimed_by_token_id: string
    }>(
      `
        /* work_request:materialized-claim-lookup */
        SELECT organization_id,
               project_id,
               id AS work_request_id,
               claimed_run_id AS run_id,
               claimed_by_token_id
        FROM work_requests
        WHERE organization_id = $1
          AND project_id = $2
          AND claimed_run_id = $3
          AND status = 'materialized'
          AND materialized_at IS NOT NULL
          AND claimed_by_token_id IS NOT NULL
        LIMIT 1
      `,
      [input.organizationId, input.projectId, input.runId],
    )
    if (!row) return null

    return {
      organizationId: row.organization_id,
      projectId: row.project_id,
      workRequestId: row.work_request_id,
      runId: row.run_id,
      claimedByTokenId: row.claimed_by_token_id,
    }
  }

  return {
    listWorkRequests,
    createWorkRequest,
    claimWorkRequest,
    materializeWorkRequest,
    releaseWorkRequest,
    resolveMaterializedWorkRequestClaim,
  }
}
