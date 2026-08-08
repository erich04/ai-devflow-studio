import { createHash, randomUUID } from 'node:crypto'
import {
  GATE_COMMAND_MAX_TTL_MS,
  GATE_COMMAND_RECEIPT_MAX_LEASE_MS,
  parseGateCommandAcknowledgementCreate,
  parseGateCommandCreate,
  toTeamStoredNodeId,
  type CreateGateCommandAcknowledgementInput,
  type CreateGateCommandInput,
  type GateCommand,
  type GateCommandAction,
  type GateCommandEvaluationStatus,
  type GateCommandOutcomeCode,
  type GateCommandStatus,
  type GateCommandWorkflowCommand,
  type Role,
} from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'
import type { TeamDbRepositoryClient } from '../db/client'
import {
  withTeamDbTransaction,
  type TeamDbTransactionClient,
} from '../db/transaction'
import {
  GateCommandAuthoritativeStateUnavailableError,
  fingerprintGateCommandCreate,
  safeGateCommand,
  safeGateCommandAcknowledgement,
  safeGateCommandReceipt,
  type GateCommandAcknowledgementResult,
  type GateCommandCreateResult,
  type GateCommandReceiptResult,
  type GateCommandRejectionCode,
  type GateCommandRejectionResult,
  type GateCommandRepository,
} from './gate-command-contract'
import type { GateCommandPreflightResult } from './gate-command-preflight'

type TimestampValue = string | Date

type GateCommandRow = {
  id: string
  version: number
  organization_id: string
  project_id: string
  work_request_id: string | null
  run_id: string
  node_id: string
  action: GateCommandAction
  workflow_command: GateCommandWorkflowCommand | null
  reason: string
  requested_by_user_id: string
  requested_role: Role
  idempotency_key: string
  request_fingerprint: string
  expected_run_version: number
  expected_policy_version: number
  expected_blocker_ids: unknown
  evaluation_status: GateCommandEvaluationStatus
  evaluation_blocker_ids: unknown
  evaluated_at: TimestampValue
  status: GateCommandStatus
  outcome_code: GateCommandOutcomeCode | null
  expires_at: TimestampValue
  created_at: TimestampValue
  updated_at: TimestampValue
}

type GateCommandReceiptRow = {
  id: string
  command_id: string
  attempt: number
  leased_to_token_id: string
  leased_at: TimestampValue
  lease_expires_at: TimestampValue
  acknowledged_at: TimestampValue | null
}

type GateCommandAcknowledgementRow = {
  id: string
  command_id: string
  receipt_id: string
  outcome_code: GateCommandOutcomeCode
  before_run_version: number
  after_run_version: number
  evaluated_at: TimestampValue
  created_at: TimestampValue
}

type IdentityRow = {
  user_id: string
  organization_id: string
  organization_role: Role
  project_role: Role | null
}

type BearerIdentityRow = IdentityRow & { project_id: string }

type CreateAuthorityRow = {
  work_request_id: string
  claimed_by_token_id: string
  run_id: string
  run_version: number
  current_node_id: string
  creator_id: string
}

type DeliveryAuthorityRow = GateCommandRow & {
  claimed_by_token_id: string
  requester_is_live: boolean
}

type AcknowledgementAuthorityRow = GateCommandRow & {
  claimed_by_token_id: string
  receipt_id: string
  receipt_command_id: string
  receipt_attempt: number
  receipt_leased_to_token_id: string
  receipt_leased_at: TimestampValue
  receipt_lease_expires_at: TimestampValue
  receipt_acknowledged_at: TimestampValue | null
}

type IdempotencyRow = {
  request_fingerprint: string
  response_json: unknown
}

export type VerifiedGateCommandIdentity = {
  organizationId: string
  projectId: string
  userId: string
  role: Role
  authKind: RequestPrincipal['authentication']['kind']
  tokenRecordId: string | null
}

export type AuditedGateCommandPreflightResult = GateCommandPreflightResult & {
  observedPolicyVersion: number
  observedBlockerIds: string[]
}

export type GateCommandPreflightResolver = (input: {
  tx: TeamDbTransactionClient
  command: CreateGateCommandInput
  principal: RequestPrincipal
  identity: VerifiedGateCommandIdentity
  authority: {
    workRequestId: string
    claimantTokenId: string
    runId: string
    runVersion: number
    currentNodeId: string
    creatorId: string
  }
}) => Promise<AuditedGateCommandPreflightResult | null>

type IdKind =
  | 'gate_command'
  | 'gate_receipt'
  | 'gate_acknowledgement'
  | 'audit'
  | 'idempotency'

export type PostgresGateCommandRepositoryOptions = {
  now?: () => Date
  createId?: (kind: IdKind) => string
  resolvePreflight?: GateCommandPreflightResolver
  commandTtlMs?: number
  receiptLeaseMs?: number
}

const gateCommandColumns = `
  gate_commands.id,
  gate_commands.version,
  gate_commands.organization_id,
  gate_commands.project_id,
  gate_commands.work_request_id,
  gate_commands.run_id,
  gate_commands.node_id,
  gate_commands.action,
  gate_commands.workflow_command,
  gate_commands.reason,
  gate_commands.requested_by_user_id,
  gate_commands.requested_role,
  gate_commands.idempotency_key,
  gate_commands.request_fingerprint,
  gate_commands.expected_run_version,
  gate_commands.expected_policy_version,
  gate_commands.expected_blocker_ids,
  gate_commands.evaluation_status,
  gate_commands.evaluation_blocker_ids,
  gate_commands.evaluated_at,
  gate_commands.status,
  gate_commands.outcome_code,
  gate_commands.expires_at,
  gate_commands.created_at,
  gate_commands.updated_at
`

const gateReceiptColumns = `
  gate_command_receipts.id,
  gate_command_receipts.command_id,
  gate_command_receipts.attempt,
  gate_command_receipts.leased_to_token_id,
  gate_command_receipts.leased_at,
  gate_command_receipts.lease_expires_at,
  gate_command_receipts.acknowledged_at
`

const gateAcknowledgementColumns = `
  gate_command_acknowledgements.id,
  gate_command_acknowledgements.command_id,
  gate_command_acknowledgements.receipt_id,
  gate_command_acknowledgements.outcome_code,
  gate_command_acknowledgements.before_run_version,
  gate_command_acknowledgements.after_run_version,
  gate_command_acknowledgements.evaluated_at,
  gate_command_acknowledgements.created_at
`

function toIso(value: TimestampValue): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Invalid Gate Command timestamp loaded from storage.')
  }
  return date.toISOString()
}

function parseJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}

function mapCommandRow(row: GateCommandRow): GateCommand {
  return safeGateCommand({
    id: row.id,
    version: row.version,
    organizationId: row.organization_id,
    projectId: row.project_id,
    workRequestId: row.work_request_id,
    runId: row.run_id,
    nodeId: row.node_id,
    action: row.action,
    workflowCommand: row.workflow_command,
    reason: row.reason,
    requestedByUserId: row.requested_by_user_id,
    requestedRole: row.requested_role,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    expectedRunVersion: row.expected_run_version,
    expectedPolicyVersion: row.expected_policy_version,
    expectedBlockerIds: parseJson(row.expected_blocker_ids),
    evaluationStatus: row.evaluation_status,
    evaluationBlockerIds: parseJson(row.evaluation_blocker_ids),
    evaluatedAt: toIso(row.evaluated_at),
    status: row.status,
    outcomeCode: row.outcome_code,
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  })
}

function mapReceiptRow(row: GateCommandReceiptRow) {
  return safeGateCommandReceipt({
    id: row.id,
    commandId: row.command_id,
    attempt: row.attempt,
    leasedAt: toIso(row.leased_at),
    leaseExpiresAt: toIso(row.lease_expires_at),
    acknowledgedAt:
      row.acknowledged_at === null ? null : toIso(row.acknowledged_at),
  })
}

function mapAcknowledgementRow(row: GateCommandAcknowledgementRow) {
  return safeGateCommandAcknowledgement({
    id: row.id,
    commandId: row.command_id,
    receiptId: row.receipt_id,
    outcomeCode: row.outcome_code,
    beforeRunVersion: row.before_run_version,
    afterRunVersion: row.after_run_version,
    evaluatedAt: toIso(row.evaluated_at),
    createdAt: toIso(row.created_at),
  })
}

const gateCommandRejectionCodes = [
  'authentication_forbidden',
  'project_forbidden',
  'role_forbidden',
  'separation_of_duties',
  'requester_revoked',
  'claimant_forbidden',
  'not_found',
  'idempotency_conflict',
  'active_command_conflict',
  'stale_run',
  'stale_policy',
  'blockers_changed',
  'node_not_current',
  'preflight_blocked',
  'receipt_conflict',
  'acknowledgement_conflict',
  'expired',
  'authoritative_state_unavailable',
] as const satisfies readonly GateCommandRejectionCode[]

function isGateCommandRejectionCode(
  value: unknown,
): value is GateCommandRejectionCode {
  return (
    typeof value === 'string' &&
    (gateCommandRejectionCodes as readonly string[]).includes(value)
  )
}

function rejection(code: GateCommandRejectionCode): GateCommandRejectionResult {
  const statusByCode: Record<
    GateCommandRejectionCode,
    403 | 404 | 409 | 410 | 503
  > = {
    authentication_forbidden: 403,
    project_forbidden: 403,
    role_forbidden: 403,
    separation_of_duties: 403,
    requester_revoked: 403,
    claimant_forbidden: 403,
    not_found: 404,
    idempotency_conflict: 409,
    active_command_conflict: 409,
    stale_run: 409,
    stale_policy: 409,
    blockers_changed: 409,
    node_not_current: 409,
    preflight_blocked: 409,
    receipt_conflict: 409,
    acknowledgement_conflict: 409,
    expired: 410,
    authoritative_state_unavailable: 503,
  }
  return {
    ok: false,
    responseStatus: statusByCode[code],
    outcomeCode: code,
    replayed: false,
  }
}

function created(command: GateCommand): GateCommandCreateResult {
  return {
    ok: true,
    responseStatus: 201,
    outcomeCode: 'created',
    replayed: false,
    command: safeGateCommand(command),
  }
}

function receiptCreated(
  command: GateCommand,
  receipt: ReturnType<typeof mapReceiptRow>,
  replayed = false,
): GateCommandReceiptResult {
  return {
    ok: true,
    responseStatus: 201,
    outcomeCode: 'receipt_created',
    replayed,
    command: safeGateCommand(command),
    receipt: safeGateCommandReceipt(receipt),
  }
}

function acknowledged(
  command: GateCommand,
  receipt: ReturnType<typeof mapReceiptRow>,
  acknowledgement: ReturnType<typeof mapAcknowledgementRow>,
  replayed = false,
): GateCommandAcknowledgementResult {
  return {
    ok: true,
    responseStatus: 201,
    outcomeCode: 'acknowledged',
    replayed,
    command: safeGateCommand(command),
    receipt: safeGateCommandReceipt(receipt),
    acknowledgement: safeGateCommandAcknowledgement(acknowledgement),
  }
}

function mapAuthorityReceipt(row: AcknowledgementAuthorityRow) {
  return safeGateCommandReceipt({
    id: row.receipt_id,
    commandId: row.receipt_command_id,
    attempt: row.receipt_attempt,
    leasedAt: toIso(row.receipt_leased_at),
    leaseExpiresAt: toIso(row.receipt_lease_expires_at),
    acknowledgedAt:
      row.receipt_acknowledged_at === null
        ? null
        : toIso(row.receipt_acknowledged_at),
  })
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex')
}

const GATE_COMMAND_ACTIVE_UNIQUE_INDEX =
  'gate_commands_active_target_version_unique'

function isRetryableGateCommandCreateConcurrencyError(
  error: unknown,
): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const postgresError = error as { code?: unknown; constraint?: unknown }
  return (
    postgresError.code === '40001' ||
    (postgresError.code === '23505' &&
      postgresError.constraint === GATE_COMMAND_ACTIVE_UNIQUE_INDEX)
  )
}

async function readGateCommandAuthority<T>(
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read()
  } catch {
    throw new GateCommandAuthoritativeStateUnavailableError()
  }
}

function remoteNodeId(runId: string, nodeId: string): string {
  return toTeamStoredNodeId(runId, nodeId)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeCreateResult(value: unknown): GateCommandCreateResult {
  const decoded = parseJson(value)
  if (!isRecord(decoded) || typeof decoded.ok !== 'boolean') {
    throw new Error('Invalid Gate Command idempotency result.')
  }
  if (decoded.ok) {
    if (
      decoded.responseStatus !== 201 ||
      decoded.outcomeCode !== 'created'
    ) {
      throw new Error('Invalid Gate Command idempotency result.')
    }
    return {
      ...created(safeGateCommand(decoded.command)),
      replayed: true,
    }
  }
  if (!isGateCommandRejectionCode(decoded.outcomeCode)) {
    throw new Error('Invalid Gate Command idempotency result.')
  }
  const original = rejection(decoded.outcomeCode)
  if (decoded.responseStatus !== original.responseStatus) {
    throw new Error('Invalid Gate Command idempotency result.')
  }
  return { ...original, replayed: true }
}

export function createPostgresGateCommandRepository(
  db: TeamDbRepositoryClient,
  options: PostgresGateCommandRepositoryOptions = {},
): GateCommandRepository {
  const now = options.now ?? (() => new Date())
  const createId =
    options.createId ??
    ((kind: IdKind) => `${kind.replaceAll('_', '-')}-${randomUUID()}`)
  const resolvePreflight = options.resolvePreflight ?? (async () => null)
  const commandTtlMs = Math.min(
    options.commandTtlMs ?? GATE_COMMAND_MAX_TTL_MS,
    GATE_COMMAND_MAX_TTL_MS,
  )
  const receiptLeaseMs = Math.min(
    options.receiptLeaseMs ?? GATE_COMMAND_RECEIPT_MAX_LEASE_MS,
    GATE_COMMAND_RECEIPT_MAX_LEASE_MS,
  )

  async function loadCookieIdentity(
    tx: TeamDbTransactionClient,
    principal: RequestPrincipal,
    projectId: string,
  ): Promise<VerifiedGateCommandIdentity | null> {
    if (
      principal.authentication.kind !== 'session_cookie' ||
      principal.session.source !== 'authenticated'
    ) {
      return null
    }
    const [row] = await tx.query<IdentityRow>(
      `
        /* gate_command:cookie-identity */
        SELECT
          users.id AS user_id,
          users.organization_id,
          users.role AS organization_role,
          (
            SELECT project_members.role
            FROM project_members
            WHERE project_members.project_id = projects.id
              AND project_members.user_id = users.id
            FOR SHARE
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
        FOR SHARE OF auth_accounts, users, projects
      `,
      [
        principal.session.authAccountId,
        principal.session.organizationId,
        principal.session.userId,
        projectId,
      ],
    )
    if (!row || (row.organization_role !== 'owner' && row.project_role === null)) {
      return null
    }
    return {
      organizationId: row.organization_id,
      projectId,
      userId: row.user_id,
      role:
        row.organization_role === 'owner'
          ? 'owner'
          : (row.project_role as Role),
      authKind: 'session_cookie',
      tokenRecordId: null,
    }
  }

  async function loadBearerIdentity(
    tx: TeamDbTransactionClient,
    principal: RequestPrincipal,
    projectId: string,
  ): Promise<VerifiedGateCommandIdentity | null> {
    if (
      principal.authentication.kind !== 'desktop_bearer' ||
      principal.session.source !== 'authenticated'
    ) {
      return null
    }
    const [row] = await tx.query<BearerIdentityRow>(
      `
        /* gate_command:bearer-identity */
        SELECT
          users.id AS user_id,
          users.organization_id,
          users.role AS organization_role,
          desktop_tokens.project_id,
          project_members.role AS project_role
        FROM desktop_tokens
        JOIN users
          ON users.id = desktop_tokens.user_id
         AND users.organization_id = desktop_tokens.organization_id
        JOIN projects
          ON projects.id = desktop_tokens.project_id
         AND projects.organization_id = desktop_tokens.organization_id
        JOIN project_members
          ON project_members.project_id = desktop_tokens.project_id
         AND project_members.user_id = desktop_tokens.user_id
        WHERE desktop_tokens.id = $1
          AND desktop_tokens.organization_id = $2
          AND desktop_tokens.user_id = $3
          AND desktop_tokens.project_id = $4
          AND desktop_tokens.revoked_at IS NULL
        LIMIT 1
        FOR SHARE OF desktop_tokens, users, projects, project_members
      `,
      [
        principal.authentication.tokenRecordId,
        principal.session.organizationId,
        principal.session.userId,
        projectId,
      ],
    )
    if (!row?.project_role) {
      return null
    }
    return {
      organizationId: row.organization_id,
      projectId: row.project_id,
      userId: row.user_id,
      role: row.project_role,
      authKind: 'desktop_bearer',
      tokenRecordId: principal.authentication.tokenRecordId,
    }
  }

  async function appendAudit(
    tx: TeamDbTransactionClient,
    input: {
      identity: VerifiedGateCommandIdentity
      recordKind: 'gate_command' | 'gate_receipt' | 'gate_acknowledgement'
      recordId: string
      action: string
      expectedVersion: number | null
      observedVersion: number | null
      outcomeCode: string
      requestFingerprint: string
      details?: {
        expectedPolicyVersion?: number
        observedPolicyVersion?: number
        expectedBlockerIdsHash?: string
        observedBlockerIdsHash?: string
        activeCommandIdHash?: string
      }
    },
  ): Promise<void> {
    await tx.query(
      `
        /* gate_command:audit-insert */
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
      `,
      [
        createId('audit'),
        input.identity.organizationId,
        input.identity.projectId,
        input.identity.userId,
        input.identity.role,
        input.identity.authKind,
        input.identity.tokenRecordId,
        input.recordKind,
        input.recordId,
        input.action,
        input.expectedVersion,
        input.observedVersion,
        input.outcomeCode,
        input.requestFingerprint,
        JSON.stringify(input.details ?? {}),
      ],
    )
  }

  async function terminalizeObservedCommands(
    tx: TeamDbTransactionClient,
    input: {
      identity: VerifiedGateCommandIdentity
      observedAt: string
      claimantTokenId: string | null
    },
  ): Promise<void> {
    const claimantScope =
      input.claimantTokenId === null
        ? ''
        : `
            AND EXISTS (
              SELECT 1
              FROM work_requests
              WHERE work_requests.id = gate_commands.work_request_id
                AND work_requests.organization_id = gate_commands.organization_id
                AND work_requests.project_id = gate_commands.project_id
                AND work_requests.claimed_run_id = gate_commands.run_id
                AND work_requests.status = 'materialized'
                AND work_requests.claimed_by_token_id = $4
            )
          `
    const params =
      input.claimantTokenId === null
        ? [
            input.identity.organizationId,
            input.identity.projectId,
            input.observedAt,
          ]
        : [
            input.identity.organizationId,
            input.identity.projectId,
            input.observedAt,
            input.claimantTokenId,
          ]
    const expiredRows = await tx.query<GateCommandRow>(
      `
        /* gate_command:lazy-expire */
        UPDATE gate_commands
        SET status = 'expired',
            outcome_code = 'expired',
            version = version + 1,
            updated_at = $3
        WHERE gate_commands.organization_id = $1
          AND gate_commands.project_id = $2
          AND gate_commands.status IN ('pending', 'delivering')
          AND gate_commands.expires_at <= $3
          ${claimantScope}
        RETURNING ${gateCommandColumns}
      `,
      params,
    )
    for (const row of expiredRows) {
      await appendAudit(tx, {
        identity: input.identity,
        recordKind: 'gate_command',
        recordId: row.id,
        action: 'gate_command_expire',
        expectedVersion: row.version - 1,
        observedVersion: row.version,
        outcomeCode: 'expired',
        requestFingerprint: fingerprint([
          'gate_command_expire',
          row.id,
          row.version - 1,
        ]),
      })
    }

    const revokedRows = await tx.query<GateCommandRow>(
      `
        /* gate_command:lazy-revoke */
        UPDATE gate_commands
        SET status = 'rejected',
            outcome_code = 'requester_revoked',
            version = version + 1,
            updated_at = $3
        WHERE gate_commands.organization_id = $1
          AND gate_commands.project_id = $2
          AND gate_commands.status IN ('pending', 'delivering')
          AND gate_commands.expires_at > $3
          ${claimantScope}
          AND NOT EXISTS (
            SELECT 1
            FROM users AS requester_users
            WHERE requester_users.id = gate_commands.requested_by_user_id
              AND requester_users.organization_id = gate_commands.organization_id
              AND (
                CASE
                  WHEN requester_users.role = 'owner' THEN 3
                  ELSE COALESCE((
                    SELECT CASE requester_members.role
                      WHEN 'owner' THEN 3
                      WHEN 'lead' THEN 2
                      WHEN 'member' THEN 1
                      ELSE 0
                    END
                    FROM project_members AS requester_members
                    WHERE requester_members.project_id = gate_commands.project_id
                      AND requester_members.user_id = requester_users.id
                    FOR SHARE
                  ), 0)
                END
              ) >= (
                CASE gate_commands.requested_role
                  WHEN 'owner' THEN 3
                  WHEN 'lead' THEN 2
                  WHEN 'member' THEN 1
                  ELSE 4
                END
              )
            FOR SHARE OF requester_users
          )
        RETURNING ${gateCommandColumns}
      `,
      params,
    )
    for (const row of revokedRows) {
      await appendAudit(tx, {
        identity: input.identity,
        recordKind: 'gate_command',
        recordId: row.id,
        action: 'gate_command_requester_recheck',
        expectedVersion: row.version - 1,
        observedVersion: row.version,
        outcomeCode: 'requester_revoked',
        requestFingerprint: fingerprint([
          'gate_command_requester_recheck',
          row.id,
          row.version - 1,
        ]),
      })
    }
  }

  async function persistCreateResult(
    tx: TeamDbTransactionClient,
    input: {
      identity: VerifiedGateCommandIdentity
      command: CreateGateCommandInput
      recordId: string
      observedVersion: number | null
      result: GateCommandCreateResult
      requestFingerprint: string
      details?: Parameters<typeof appendAudit>[1]['details']
    },
  ): Promise<GateCommandCreateResult> {
    await appendAudit(tx, {
      identity: input.identity,
      recordKind: 'gate_command',
      recordId: input.recordId,
      action: 'gate_command_create',
      expectedVersion: input.command.expectedRunVersion,
      observedVersion: input.observedVersion,
      outcomeCode: input.result.outcomeCode,
      requestFingerprint: input.requestFingerprint,
      ...(input.details ? { details: input.details } : {}),
    })
    await tx.query(
      `
        /* gate_command:idempotency-insert */
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
        VALUES (
          $1, $2, $3, $4, 'session_cookie', NULL,
          'gate_command_create', $5, $6, $7, $8, $9::jsonb
        )
      `,
      [
        createId('idempotency'),
        input.identity.organizationId,
        input.identity.projectId,
        input.identity.userId,
        input.command.idempotencyKey,
        input.requestFingerprint,
        input.result.responseStatus,
        input.result.outcomeCode,
        JSON.stringify(input.result),
      ],
    )
    return input.result
  }

  async function auditReceiptAttempt(
    tx: TeamDbTransactionClient,
    input: {
      identity: VerifiedGateCommandIdentity
      commandId: string
      outcomeCode: GateCommandRejectionCode | 'receipt_created'
      expectedVersion: number | null
      observedVersion: number | null
    },
  ): Promise<void> {
    await appendAudit(tx, {
      identity: input.identity,
      recordKind: 'gate_command',
      recordId: input.commandId,
      action: 'gate_command_receipt',
      expectedVersion: input.expectedVersion,
      observedVersion: input.observedVersion,
      outcomeCode: input.outcomeCode,
      requestFingerprint: fingerprint([
        'gate_command_receipt',
        input.identity.organizationId,
        input.identity.projectId,
        input.identity.userId,
        input.identity.tokenRecordId,
        input.commandId,
      ]),
    })
  }

  async function auditAcknowledgementAttempt(
    tx: TeamDbTransactionClient,
    input: {
      identity: VerifiedGateCommandIdentity
      receiptId: string
      acknowledgement: CreateGateCommandAcknowledgementInput
      outcomeCode: GateCommandRejectionCode | 'acknowledged'
      expectedVersion: number | null
      observedVersion: number | null
    },
  ): Promise<void> {
    await appendAudit(tx, {
      identity: input.identity,
      recordKind: 'gate_receipt',
      recordId: input.receiptId,
      action: 'gate_command_acknowledge',
      expectedVersion: input.expectedVersion,
      observedVersion: input.observedVersion,
      outcomeCode: input.outcomeCode,
      requestFingerprint: fingerprint([
        'gate_command_acknowledge',
        input.identity.organizationId,
        input.identity.projectId,
        input.identity.userId,
        input.receiptId,
        input.acknowledgement,
      ]),
    })
  }

  async function createGateCommand(
    rawInput: CreateGateCommandInput,
    principal: RequestPrincipal,
  ): Promise<GateCommandCreateResult> {
    const input = parseGateCommandCreate(rawInput)
    const authoritativeStateUnavailable = Symbol(
      'gate-command-authoritative-state-unavailable',
    )
    const readAuthoritativeState = async <T>(
      read: () => Promise<T>,
    ): Promise<T> => {
      try {
        return await read()
      } catch (error) {
        if (isRetryableGateCommandCreateConcurrencyError(error)) {
          throw error
        }
        throw authoritativeStateUnavailable
      }
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await withTeamDbTransaction(db, async (tx) => {
          const requestFingerprint = fingerprintGateCommandCreate(input)
          await tx.query(
            `
              /* gate_command:idempotency-lock */
              SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
            `,
            [
              JSON.stringify([
                principal.session.organizationId,
                principal.session.userId,
                'gate_command_create',
                input.idempotencyKey,
              ]),
            ],
          )
          const [existing] = await tx.query<IdempotencyRow>(
            `
              /* gate_command:idempotency-read */
              SELECT request_fingerprint, response_json
              FROM collaboration_idempotency
              WHERE organization_id = $1
                AND project_id = $2
                AND actor_user_id = $3
                AND operation_kind = 'gate_command_create'
                AND idempotency_key = $4
              LIMIT 1
            `,
            [
              principal.session.organizationId,
              input.projectId,
              principal.session.userId,
              input.idempotencyKey,
            ],
          )
          if (principal.authentication.kind !== 'session_cookie') {
            return rejection('authentication_forbidden')
          }
          const identity = await readAuthoritativeState(() =>
            loadCookieIdentity(tx, principal, input.projectId),
          )
          if (!identity) {
            return rejection('project_forbidden')
          }
          const baseCreateAuditDetails: Parameters<typeof appendAudit>[1]['details'] = {
            expectedPolicyVersion: input.expectedPolicyVersion,
            expectedBlockerIdsHash: fingerprint([
              'gate_command_blockers',
              input.expectedBlockerIds,
            ]),
          }
          if (existing) {
            const result = existing.request_fingerprint === requestFingerprint
              ? decodeCreateResult(existing.response_json)
              : rejection('idempotency_conflict')
            await appendAudit(tx, {
              identity,
              recordKind: 'gate_command',
              recordId: result.ok ? result.command.id : createId('gate_command'),
              action: 'gate_command_create',
              expectedVersion: input.expectedRunVersion,
              observedVersion: result.ok ? result.command.version : null,
              outcomeCode: result.outcomeCode,
              requestFingerprint,
              details: baseCreateAuditDetails,
            })
            return result
          }

          const commandId = createId('gate_command')
          let createAuditDetails = baseCreateAuditDetails
          const persistRejection = (
            code: GateCommandRejectionCode,
            recordId = commandId,
            observedVersion: number | null = null,
          ) =>
            persistCreateResult(tx, {
              identity,
              command: input,
              recordId,
              observedVersion,
              result: rejection(code),
              requestFingerprint,
              details: createAuditDetails,
            })
          const auditPreflight = (
            outcomeCode: string,
            observedVersion: number | null,
          ) =>
            appendAudit(tx, {
              identity,
              recordKind: 'gate_command',
              recordId: commandId,
              action: 'gate_command_preflight',
              expectedVersion: input.expectedRunVersion,
              observedVersion,
              outcomeCode,
              requestFingerprint,
              ...(createAuditDetails ? { details: createAuditDetails } : {}),
            })

          const [authorityRow] = await readAuthoritativeState(() =>
            tx.query<CreateAuthorityRow>(`
              /* gate_command:create-authority */
              SELECT
                work_requests.id AS work_request_id,
                work_requests.claimed_by_token_id,
                workflow_runs.id AS run_id,
                workflow_runs.run_version,
                workflow_runs.current_node_id,
                workflow_runs.creator_id
              FROM workflow_runs
              JOIN work_requests
                ON work_requests.organization_id = workflow_runs.organization_id
               AND work_requests.project_id = workflow_runs.project_id
               AND work_requests.claimed_run_id = workflow_runs.id
               AND work_requests.status = 'materialized'
               AND work_requests.materialized_at IS NOT NULL
               AND work_requests.claimed_by_token_id IS NOT NULL
              WHERE workflow_runs.organization_id = $1
                AND workflow_runs.project_id = $2
                AND workflow_runs.id = $3
                AND workflow_runs.data_origin = 'remote'
              FOR SHARE OF workflow_runs, work_requests
            `, [identity.organizationId, identity.projectId, input.runId]),
          )
          if (!authorityRow) {
            await auditPreflight('not_found', null)
            return persistRejection('not_found')
          }
          if (authorityRow.run_version !== input.expectedRunVersion) {
            await auditPreflight('stale_run', authorityRow.run_version)
            return persistRejection(
              'stale_run',
              commandId,
              authorityRow.run_version,
            )
          }
          if (
            authorityRow.current_node_id !== remoteNodeId(input.runId, input.nodeId)
          ) {
            await auditPreflight('node_not_current', authorityRow.run_version)
            return persistRejection(
              'node_not_current',
              commandId,
              authorityRow.run_version,
            )
          }
          const authority = {
            workRequestId: authorityRow.work_request_id,
            claimantTokenId: authorityRow.claimed_by_token_id,
            runId: authorityRow.run_id,
            runVersion: authorityRow.run_version,
            currentNodeId: input.nodeId,
            creatorId: authorityRow.creator_id,
          }
          const preflight = await readAuthoritativeState(() =>
            resolvePreflight({
              tx,
              command: input,
              principal,
              identity,
              authority,
            }),
          )
          if (!preflight) {
            throw authoritativeStateUnavailable
          }
          const observedBlockerIds = [...preflight.observedBlockerIds]
          const hasCanonicalObservedSnapshot =
            Number.isInteger(preflight.observedPolicyVersion) &&
            preflight.observedPolicyVersion >= 0 &&
            preflight.observedPolicyVersion <= 2_147_483_647 &&
            observedBlockerIds.length <= 100 &&
            observedBlockerIds.every(
              (blockerId, index) =>
                typeof blockerId === 'string' &&
                blockerId.length > 0 &&
                blockerId.length <= 200 &&
                blockerId.trim() === blockerId &&
                (index === 0 || observedBlockerIds[index - 1]! < blockerId),
            )
          if (!hasCanonicalObservedSnapshot) {
            throw authoritativeStateUnavailable
          }
          createAuditDetails = {
            ...createAuditDetails,
            observedPolicyVersion: preflight.observedPolicyVersion,
            observedBlockerIdsHash: fingerprint([
              'gate_command_blockers',
              observedBlockerIds,
            ]),
          }
          await auditPreflight(
            preflight.allowed ? 'allowed' : preflight.code,
            authorityRow.run_version,
          )
          if (!preflight.allowed) {
            return persistRejection(
              preflight.code,
              commandId,
              authorityRow.run_version,
            )
          }

          await tx.query(
            `
              /* gate_command:active-lock */
              SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
            `,
            [
              JSON.stringify([
                identity.organizationId,
                identity.projectId,
                input.runId,
                input.nodeId,
                input.expectedRunVersion,
              ]),
            ],
          )
          const timestamp = now().toISOString()
          const expiredActiveCommands = await tx.query<GateCommandRow>(
            `
              /* gate_command:expire-active-tuple */
              UPDATE gate_commands
              SET status = 'expired',
                  outcome_code = 'expired',
                  version = version + 1,
                  updated_at = $6
              WHERE organization_id = $1
                AND project_id = $2
                AND run_id = $3
                AND node_id = $4
                AND expected_run_version = $5
                AND status IN ('pending', 'delivering')
                AND expires_at <= $6
              RETURNING ${gateCommandColumns}
            `,
            [
              identity.organizationId,
              identity.projectId,
              input.runId,
              input.nodeId,
              input.expectedRunVersion,
              timestamp,
            ],
          )
          for (const expired of expiredActiveCommands) {
            await appendAudit(tx, {
              identity,
              recordKind: 'gate_command',
              recordId: expired.id,
              action: 'gate_command_expire',
              expectedVersion: expired.version - 1,
              observedVersion: expired.version,
              outcomeCode: 'expired',
              requestFingerprint: fingerprint([
                'gate_command_expire',
                expired.id,
                expired.version - 1,
              ]),
            })
          }
          const [active] = await tx.query<{ id: string }>(
            `
              /* gate_command:active-read */
              SELECT id
              FROM gate_commands
              WHERE organization_id = $1
                AND project_id = $2
                AND run_id = $3
                AND node_id = $4
                AND expected_run_version = $5
                AND status IN ('pending', 'delivering')
              LIMIT 1
            `,
            [
              identity.organizationId,
              identity.projectId,
              input.runId,
              input.nodeId,
              input.expectedRunVersion,
            ],
          )
          if (active) {
            createAuditDetails = {
              ...createAuditDetails,
              activeCommandIdHash: fingerprint([
                'gate_command_active_conflict',
                active.id,
              ]),
            }
            return persistRejection(
              'active_command_conflict',
              commandId,
              authorityRow.run_version,
            )
          }

          const expiresAt = new Date(
            Date.parse(timestamp) + commandTtlMs,
          ).toISOString()
          const [row] = await tx.query<GateCommandRow>(
            `
              /* gate_command:create */
              INSERT INTO gate_commands (
                id,
                organization_id,
                project_id,
                work_request_id,
                run_id,
                node_id,
                action,
                workflow_command,
                reason,
                requested_by_user_id,
                requested_role,
                auth_kind,
                auth_token_record_id,
                idempotency_key,
                request_fingerprint,
                expected_run_version,
                expected_policy_version,
                expected_blocker_ids,
                evaluation_status,
                evaluation_blocker_ids,
                evaluated_at,
                status,
                outcome_code,
                expires_at,
                created_at,
                updated_at
              )
              VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                'session_cookie', NULL, $12, $13, $14, $15, $16::jsonb,
                $17, $18::jsonb, $19, 'pending', NULL, $20, $19, $19
              )
              RETURNING ${gateCommandColumns}
            `,
            [
              commandId,
              identity.organizationId,
              identity.projectId,
              authority.workRequestId,
              input.runId,
              input.nodeId,
              input.action,
              preflight.workflowCommand,
              input.reason,
              identity.userId,
              identity.role,
              input.idempotencyKey,
              requestFingerprint,
              input.expectedRunVersion,
              input.expectedPolicyVersion,
              JSON.stringify(input.expectedBlockerIds),
              preflight.evaluationStatus,
              JSON.stringify(preflight.evaluationBlockerIds),
              timestamp,
              expiresAt,
            ],
          )
          if (!row) {
            throw new Error('Gate Command create returned no record.')
          }
          const result = created(mapCommandRow(row))
          return persistCreateResult(tx, {
            identity,
            command: input,
            recordId: row.id,
            observedVersion: row.version,
            result,
            requestFingerprint,
            details: createAuditDetails,
          })
        }, {
          isolationLevel: 'repeatable_read',
        })
      } catch (error) {
        if (error === authoritativeStateUnavailable) {
          return rejection('authoritative_state_unavailable')
        }
        if (
          attempt === 0 &&
          isRetryableGateCommandCreateConcurrencyError(error)
        ) {
          continue
        }
        throw error
      }
    }
    throw new Error('Gate Command create retry exhausted unexpectedly.')
  }

  async function listGateCommands(
    projectId: string,
    principal: RequestPrincipal,
  ): Promise<GateCommand[]> {
    if (principal.authentication.kind !== 'session_cookie') {
      return []
    }
    return withTeamDbTransaction(db, async (tx) => {
      const identity = await readGateCommandAuthority(() =>
        loadCookieIdentity(tx, principal, projectId),
      )
      if (!identity) {
        return []
      }
      const observedAt = now().toISOString()
      await terminalizeObservedCommands(tx, {
        identity,
        observedAt,
        claimantTokenId: null,
      })
      const rows = await readGateCommandAuthority(() => tx.query<GateCommandRow>(
        `
          /* gate_command:list */
          SELECT ${gateCommandColumns}
          FROM gate_commands
          WHERE gate_commands.organization_id = $1
            AND gate_commands.project_id = $2
          ORDER BY gate_commands.created_at DESC, gate_commands.id ASC
        `,
        [identity.organizationId, identity.projectId],
      ))
      return rows.map(mapCommandRow)
    })
  }

  async function listGateCommandInbox(
    projectId: string,
    principal: RequestPrincipal,
  ): Promise<GateCommand[]> {
    if (principal.authentication.kind !== 'desktop_bearer') {
      return []
    }
    return withTeamDbTransaction(db, async (tx) => {
      const identity = await readGateCommandAuthority(() =>
        loadBearerIdentity(tx, principal, projectId),
      )
      if (!identity?.tokenRecordId) {
        return []
      }
      const observedAt = now().toISOString()
      await terminalizeObservedCommands(tx, {
        identity,
        observedAt,
        claimantTokenId: identity.tokenRecordId,
      })
      const rows = await readGateCommandAuthority(() => tx.query<GateCommandRow>(
        `
          /* gate_command:inbox */
          SELECT ${gateCommandColumns}
          FROM gate_commands
          JOIN work_requests
            ON work_requests.id = gate_commands.work_request_id
           AND work_requests.organization_id = gate_commands.organization_id
           AND work_requests.project_id = gate_commands.project_id
           AND work_requests.claimed_run_id = gate_commands.run_id
           AND work_requests.status = 'materialized'
           AND work_requests.claimed_by_token_id = $3
          JOIN users AS requester_users
            ON requester_users.id = gate_commands.requested_by_user_id
           AND requester_users.organization_id = gate_commands.organization_id
          WHERE gate_commands.organization_id = $1
            AND gate_commands.project_id = $2
            AND gate_commands.status IN ('pending', 'delivering')
            AND gate_commands.expires_at > $4
            AND (
              CASE
                WHEN requester_users.role = 'owner' THEN 3
                ELSE COALESCE((
                  SELECT CASE requester_members.role
                    WHEN 'owner' THEN 3
                    WHEN 'lead' THEN 2
                    WHEN 'member' THEN 1
                    ELSE 0
                  END
                  FROM project_members AS requester_members
                  WHERE requester_members.project_id = gate_commands.project_id
                    AND requester_members.user_id = requester_users.id
                  FOR SHARE
                ), 0)
              END
            ) >= (
              CASE gate_commands.requested_role
                WHEN 'owner' THEN 3
                WHEN 'lead' THEN 2
                WHEN 'member' THEN 1
                ELSE 4
              END
            )
          ORDER BY gate_commands.created_at ASC, gate_commands.id ASC
          FOR SHARE OF requester_users
        `,
        [
          identity.organizationId,
          identity.projectId,
          identity.tokenRecordId,
          observedAt,
        ],
      ))
      return rows.map(mapCommandRow)
    })
  }

  async function createGateCommandReceipt(
    commandId: string,
    principal: RequestPrincipal,
  ): Promise<GateCommandReceiptResult> {
    if (principal.authentication.kind !== 'desktop_bearer') {
      return rejection('authentication_forbidden')
    }
    return withTeamDbTransaction(db, async (tx) => {
      const [project] = await readGateCommandAuthority(() =>
        tx.query<{ project_id: string }>(`
          /* gate_command:receipt-project-probe */
          SELECT project_id
          FROM gate_commands
          WHERE id = $1
            AND organization_id = $2
          LIMIT 1
        `,
        [commandId, principal.session.organizationId]),
      )
      if (!project) {
        return rejection('not_found')
      }
      const identity = await readGateCommandAuthority(() =>
        loadBearerIdentity(tx, principal, project.project_id),
      )
      if (!identity?.tokenRecordId) {
        return rejection('project_forbidden')
      }
      await tx.query(
        `
          /* gate_command:receipt-lock */
          SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
        `,
        [
          JSON.stringify([
            identity.organizationId,
            identity.projectId,
            commandId,
          ]),
        ],
      )
      const [authority] = await readGateCommandAuthority(() =>
        tx.query<DeliveryAuthorityRow>(`
          /* gate_command:receipt-authority */
          SELECT
            ${gateCommandColumns},
            work_requests.claimed_by_token_id,
            (
              (
                CASE
                  WHEN requester_users.role = 'owner' THEN 3
                  ELSE COALESCE((
                    SELECT CASE requester_members.role
                      WHEN 'owner' THEN 3
                      WHEN 'lead' THEN 2
                      WHEN 'member' THEN 1
                      ELSE 0
                    END
                    FROM project_members AS requester_members
                    WHERE requester_members.project_id = gate_commands.project_id
                      AND requester_members.user_id = requester_users.id
                    FOR SHARE
                  ), 0)
                END
              ) >= (
                CASE gate_commands.requested_role
                  WHEN 'owner' THEN 3
                  WHEN 'lead' THEN 2
                  WHEN 'member' THEN 1
                  ELSE 4
                END
              )
            ) AS requester_is_live
          FROM gate_commands
          JOIN work_requests
            ON work_requests.id = gate_commands.work_request_id
           AND work_requests.organization_id = gate_commands.organization_id
           AND work_requests.project_id = gate_commands.project_id
           AND work_requests.claimed_run_id = gate_commands.run_id
           AND work_requests.status = 'materialized'
          JOIN users AS requester_users
            ON requester_users.id = gate_commands.requested_by_user_id
           AND requester_users.organization_id = gate_commands.organization_id
          WHERE gate_commands.id = $1
            AND gate_commands.organization_id = $2
            AND gate_commands.project_id = $3
          FOR UPDATE OF gate_commands
          FOR SHARE OF requester_users
        `,
        [commandId, identity.organizationId, identity.projectId]),
      )
      if (!authority) {
        await auditReceiptAttempt(tx, {
          identity,
          commandId,
          outcomeCode: 'not_found',
          expectedVersion: null,
          observedVersion: null,
        })
        return rejection('not_found')
      }
      if (authority.claimed_by_token_id !== identity.tokenRecordId) {
        await auditReceiptAttempt(tx, {
          identity,
          commandId: authority.id,
          outcomeCode: 'claimant_forbidden',
          expectedVersion: authority.version,
          observedVersion: authority.version,
        })
        return rejection('claimant_forbidden')
      }
      if (
        authority.status === 'rejected' &&
        authority.outcome_code === 'requester_revoked'
      ) {
        await auditReceiptAttempt(tx, {
          identity,
          commandId: authority.id,
          outcomeCode: 'requester_revoked',
          expectedVersion: authority.version,
          observedVersion: authority.version,
        })
        return rejection('requester_revoked')
      }
      if (
        authority.status !== 'pending' &&
        authority.status !== 'delivering' &&
        authority.status !== 'expired'
      ) {
        await auditReceiptAttempt(tx, {
          identity,
          commandId: authority.id,
          outcomeCode: 'receipt_conflict',
          expectedVersion: authority.version,
          observedVersion: authority.version,
        })
        return rejection('receipt_conflict')
      }

      const timestamp = now().toISOString()
      const timestampMs = Date.parse(timestamp)
      const expiresAtMs = Date.parse(toIso(authority.expires_at))
      if (timestampMs >= expiresAtMs || authority.status === 'expired') {
        let observedVersion = authority.version
        if (authority.status !== 'expired') {
          const [expired] = await tx.query<GateCommandRow>(
            `
              /* gate_command:expire-command */
              UPDATE gate_commands
              SET status = 'expired',
                  outcome_code = 'expired',
                  version = version + 1,
                  updated_at = $4
              WHERE id = $1
                AND organization_id = $2
                AND project_id = $3
                AND version = $5
                AND status IN ('pending', 'delivering')
              RETURNING ${gateCommandColumns}
            `,
            [
              authority.id,
              identity.organizationId,
              identity.projectId,
              timestamp,
              authority.version,
            ],
          )
          if (!expired) {
            throw new Error('Gate Command expiry update returned no record.')
          }
          observedVersion = expired.version
          await appendAudit(tx, {
            identity,
            recordKind: 'gate_command',
            recordId: authority.id,
            action: 'gate_command_expire',
            expectedVersion: authority.version,
            observedVersion: expired.version,
            outcomeCode: 'expired',
            requestFingerprint: fingerprint([
              'gate_command_expire',
              authority.id,
              authority.version,
            ]),
          })
        }
        await auditReceiptAttempt(tx, {
          identity,
          commandId: authority.id,
          outcomeCode: 'expired',
          expectedVersion: authority.version,
          observedVersion,
        })
        return rejection('expired')
      }
      if (!authority.requester_is_live) {
        const [revoked] = await tx.query<GateCommandRow>(
          `
            /* gate_command:revoke-requester */
            UPDATE gate_commands
            SET status = 'rejected',
                outcome_code = 'requester_revoked',
                version = version + 1,
                updated_at = $4
            WHERE id = $1
              AND organization_id = $2
              AND project_id = $3
              AND version = $5
              AND status IN ('pending', 'delivering')
            RETURNING ${gateCommandColumns}
          `,
          [
            authority.id,
            identity.organizationId,
            identity.projectId,
            timestamp,
            authority.version,
          ],
        )
        if (!revoked) {
          throw new Error('Gate Command requester update returned no record.')
        }
        await appendAudit(tx, {
          identity,
          recordKind: 'gate_command',
          recordId: authority.id,
          action: 'gate_command_requester_recheck',
          expectedVersion: authority.version,
          observedVersion: revoked.version,
          outcomeCode: 'requester_revoked',
          requestFingerprint: fingerprint([
            'gate_command_requester_recheck',
            authority.id,
            authority.version,
          ]),
        })
        await auditReceiptAttempt(tx, {
          identity,
          commandId: authority.id,
          outcomeCode: 'requester_revoked',
          expectedVersion: authority.version,
          observedVersion: revoked.version,
        })
        return rejection('requester_revoked')
      }
      const [terminalAcknowledgement] =
        await tx.query<GateCommandAcknowledgementRow>(
          `
            /* gate_command:receipt-ack-read */
            SELECT ${gateAcknowledgementColumns}
            FROM gate_command_acknowledgements
            WHERE command_id = $1
            LIMIT 1
          `,
          [authority.id],
      )
      if (terminalAcknowledgement) {
        await auditReceiptAttempt(tx, {
          identity,
          commandId: authority.id,
          outcomeCode: 'receipt_conflict',
          expectedVersion: authority.version,
          observedVersion: authority.version,
        })
        return rejection('receipt_conflict')
      }
      const [latestReceipt] = await tx.query<GateCommandReceiptRow>(
        `
          /* gate_command:receipt-latest */
          SELECT ${gateReceiptColumns}
          FROM gate_command_receipts
          WHERE command_id = $1
          ORDER BY attempt DESC
          LIMIT 1
          FOR UPDATE
        `,
        [authority.id],
      )
      if (
        latestReceipt?.acknowledged_at === null &&
        Date.parse(toIso(latestReceipt.lease_expires_at)) > timestampMs
      ) {
        if (latestReceipt.leased_to_token_id !== identity.tokenRecordId) {
          await auditReceiptAttempt(tx, {
            identity,
            commandId: authority.id,
            outcomeCode: 'receipt_conflict',
            expectedVersion: authority.version,
            observedVersion: authority.version,
          })
          return rejection('receipt_conflict')
        }
        await auditReceiptAttempt(tx, {
          identity,
          commandId: authority.id,
          outcomeCode: 'receipt_created',
          expectedVersion: authority.version,
          observedVersion: authority.version,
        })
        return receiptCreated(
          mapCommandRow(authority),
          mapReceiptRow(latestReceipt),
          true,
        )
      }

      let deliveredCommand = mapCommandRow(authority)
      if (authority.status === 'pending') {
        const [delivered] = await tx.query<GateCommandRow>(
          `
            /* gate_command:deliver-command */
            UPDATE gate_commands
            SET status = 'delivering',
                version = version + 1,
                updated_at = $4
            WHERE id = $1
              AND organization_id = $2
              AND project_id = $3
              AND version = $5
              AND status = 'pending'
            RETURNING ${gateCommandColumns}
          `,
          [
            authority.id,
            identity.organizationId,
            identity.projectId,
            timestamp,
            authority.version,
          ],
        )
        if (!delivered) {
          throw new Error('Gate Command delivery update returned no record.')
        }
        deliveredCommand = mapCommandRow(delivered)
      }

      const leaseExpiresAt = new Date(
        Math.min(timestampMs + receiptLeaseMs, expiresAtMs),
      ).toISOString()
      const attempt = (latestReceipt?.attempt ?? 0) + 1
      const [receiptRow] = await tx.query<GateCommandReceiptRow>(
        `
          /* gate_command:receipt-create */
          INSERT INTO gate_command_receipts (
            id,
            command_id,
            attempt,
            leased_to_token_id,
            leased_at,
            lease_expires_at,
            acknowledged_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, NULL)
          RETURNING ${gateReceiptColumns}
        `,
        [
          createId('gate_receipt'),
          authority.id,
          attempt,
          identity.tokenRecordId,
          timestamp,
          leaseExpiresAt,
        ],
      )
      if (!receiptRow) {
        throw new Error('Gate Command receipt create returned no record.')
      }
      const receipt = mapReceiptRow(receiptRow)
      await appendAudit(tx, {
        identity,
        recordKind: 'gate_receipt',
        recordId: receipt.id,
        action: 'gate_command_receipt',
        expectedVersion: authority.version,
        observedVersion: deliveredCommand.version,
        outcomeCode: 'receipt_created',
        requestFingerprint: fingerprint([
          'gate_command_receipt',
          authority.id,
          attempt,
          identity.tokenRecordId,
        ]),
      })
      return receiptCreated(deliveredCommand, receipt)
    }).catch((error: unknown) => {
      if (error instanceof GateCommandAuthoritativeStateUnavailableError) {
        return rejection('authoritative_state_unavailable')
      }
      throw error
    })
  }

  async function acknowledgeGateCommand(
    receiptId: string,
    rawInput: CreateGateCommandAcknowledgementInput,
    principal: RequestPrincipal,
  ): Promise<GateCommandAcknowledgementResult> {
    const input = parseGateCommandAcknowledgementCreate(rawInput)
    if (principal.authentication.kind !== 'desktop_bearer') {
      return rejection('authentication_forbidden')
    }
    return withTeamDbTransaction(db, async (tx) => {
      const [project] = await readGateCommandAuthority(() =>
        tx.query<{ project_id: string }>(`
          /* gate_command:ack-project-probe */
          SELECT gate_commands.project_id
          FROM gate_command_receipts
          JOIN gate_commands
            ON gate_commands.id = gate_command_receipts.command_id
          WHERE gate_command_receipts.id = $1
            AND gate_commands.organization_id = $2
          LIMIT 1
        `,
        [receiptId, principal.session.organizationId]),
      )
      if (!project) {
        return rejection('not_found')
      }
      const identity = await readGateCommandAuthority(() =>
        loadBearerIdentity(tx, principal, project.project_id),
      )
      if (!identity?.tokenRecordId) {
        return rejection('project_forbidden')
      }
      await tx.query(
        `
          /* gate_command:ack-lock */
          SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
        `,
        [
          JSON.stringify([
            identity.organizationId,
            identity.projectId,
            input.commandId,
          ]),
        ],
      )
      const [authority] = await readGateCommandAuthority(() =>
        tx.query<AcknowledgementAuthorityRow>(`
          /* gate_command:ack-authority */
          SELECT
            ${gateCommandColumns},
            work_requests.claimed_by_token_id,
            gate_command_receipts.id AS receipt_id,
            gate_command_receipts.command_id AS receipt_command_id,
            gate_command_receipts.attempt AS receipt_attempt,
            gate_command_receipts.leased_to_token_id AS receipt_leased_to_token_id,
            gate_command_receipts.leased_at AS receipt_leased_at,
            gate_command_receipts.lease_expires_at AS receipt_lease_expires_at,
            gate_command_receipts.acknowledged_at AS receipt_acknowledged_at
          FROM gate_command_receipts
          JOIN gate_commands
            ON gate_commands.id = gate_command_receipts.command_id
          JOIN work_requests
            ON work_requests.id = gate_commands.work_request_id
           AND work_requests.organization_id = gate_commands.organization_id
           AND work_requests.project_id = gate_commands.project_id
           AND work_requests.claimed_run_id = gate_commands.run_id
           AND work_requests.status = 'materialized'
          WHERE gate_command_receipts.id = $1
            AND gate_commands.organization_id = $2
            AND gate_commands.project_id = $3
          FOR UPDATE OF gate_commands, gate_command_receipts
        `,
        [receiptId, identity.organizationId, identity.projectId]),
      )
      if (!authority) {
        await auditAcknowledgementAttempt(tx, {
          identity,
          receiptId,
          acknowledgement: input,
          outcomeCode: 'not_found',
          expectedVersion: null,
          observedVersion: null,
        })
        return rejection('not_found')
      }
      if (authority.id !== input.commandId) {
        await auditAcknowledgementAttempt(tx, {
          identity,
          receiptId,
          acknowledgement: input,
          outcomeCode: 'acknowledgement_conflict',
          expectedVersion: authority.version,
          observedVersion: authority.version,
        })
        return rejection('acknowledgement_conflict')
      }
      if (
        authority.claimed_by_token_id !== identity.tokenRecordId ||
        authority.receipt_leased_to_token_id !== identity.tokenRecordId
      ) {
        await auditAcknowledgementAttempt(tx, {
          identity,
          receiptId,
          acknowledgement: input,
          outcomeCode: 'claimant_forbidden',
          expectedVersion: authority.version,
          observedVersion: authority.version,
        })
        return rejection('claimant_forbidden')
      }
      if (
        (input.outcomeCode === 'stale_run'
          ? input.beforeRunVersion === authority.expected_run_version
          : input.beforeRunVersion !== authority.expected_run_version) ||
        (input.outcomeCode === 'applied' && authority.action !== 'approve') ||
        (input.outcomeCode === 'human_rejected' &&
          authority.action !== 'reject')
      ) {
        await auditAcknowledgementAttempt(tx, {
          identity,
          receiptId,
          acknowledgement: input,
          outcomeCode: 'acknowledgement_conflict',
          expectedVersion: authority.version,
          observedVersion: authority.version,
        })
        return rejection('acknowledgement_conflict')
      }

      const [existingAcknowledgement] =
        await tx.query<GateCommandAcknowledgementRow>(
          `
            /* gate_command:ack-existing */
            SELECT ${gateAcknowledgementColumns}
            FROM gate_command_acknowledgements
            WHERE command_id = $1
            LIMIT 1
          `,
          [authority.id],
        )
      if (existingAcknowledgement) {
        const existing = mapAcknowledgementRow(existingAcknowledgement)
        if (
          existing.receiptId !== receiptId ||
          existing.outcomeCode !== input.outcomeCode ||
          existing.beforeRunVersion !== input.beforeRunVersion ||
          existing.afterRunVersion !== input.afterRunVersion ||
          existing.evaluatedAt !== input.evaluatedAt
        ) {
          await auditAcknowledgementAttempt(tx, {
            identity,
            receiptId,
            acknowledgement: input,
            outcomeCode: 'acknowledgement_conflict',
            expectedVersion: authority.version,
            observedVersion: authority.version,
          })
          return rejection('acknowledgement_conflict')
        }
        await auditAcknowledgementAttempt(tx, {
          identity,
          receiptId,
          acknowledgement: input,
          outcomeCode: 'acknowledged',
          expectedVersion: authority.version,
          observedVersion: authority.version,
        })
        return acknowledged(
          mapCommandRow(authority),
          mapAuthorityReceipt(authority),
          existing,
          true,
        )
      }
      if (
        authority.receipt_acknowledged_at !== null ||
        (authority.status !== 'delivering' && authority.status !== 'expired')
      ) {
        await auditAcknowledgementAttempt(tx, {
          identity,
          receiptId,
          acknowledgement: input,
          outcomeCode: 'acknowledgement_conflict',
          expectedVersion: authority.version,
          observedVersion: authority.version,
        })
        return rejection('acknowledgement_conflict')
      }

      const timestamp = now().toISOString()
      const timestampMs = Date.parse(timestamp)
      const evaluatedAtMs = Date.parse(input.evaluatedAt)
      const leasedAtMs = Date.parse(toIso(authority.receipt_leased_at))
      const leaseExpiresAtMs = Date.parse(
        toIso(authority.receipt_lease_expires_at),
      )
      const commandExpiresAtMs = Date.parse(toIso(authority.expires_at))
      const maximumFutureEvaluationMs =
        timestampMs +
        Math.min(
          GATE_COMMAND_RECEIPT_MAX_LEASE_MS,
          Math.max(0, leaseExpiresAtMs - leasedAtMs),
        )
      const validEvaluationWindow =
        evaluatedAtMs >= leasedAtMs &&
        (input.outcomeCode === 'expired'
          ? evaluatedAtMs <= timestampMs
          : evaluatedAtMs <= maximumFutureEvaluationMs) &&
        (input.outcomeCode === 'expired'
          ? evaluatedAtMs >= commandExpiresAtMs
          : evaluatedAtMs < leaseExpiresAtMs &&
            evaluatedAtMs < commandExpiresAtMs)
      if (!validEvaluationWindow) {
        await auditAcknowledgementAttempt(tx, {
          identity,
          receiptId,
          acknowledgement: input,
          outcomeCode: 'acknowledgement_conflict',
          expectedVersion: authority.version,
          observedVersion: authority.version,
        })
        return rejection('acknowledgement_conflict')
      }

      const terminalStatus: GateCommandStatus =
        input.outcomeCode === 'applied' ||
        input.outcomeCode === 'human_rejected'
          ? 'applied'
          : input.outcomeCode === 'expired'
            ? 'expired'
            : 'rejected'
      let terminalCommand = mapCommandRow(authority)
      const alreadyExpired =
        authority.status === 'expired' && input.outcomeCode === 'expired'
      if (!alreadyExpired) {
        const [terminalRow] = await tx.query<GateCommandRow>(
          `
            /* gate_command:ack-terminalize */
            UPDATE gate_commands
            SET status = $4,
                outcome_code = $5,
                version = version + 1,
                updated_at = $6
            WHERE id = $1
              AND organization_id = $2
              AND project_id = $3
              AND version = $7
              AND status IN ('delivering', 'expired')
            RETURNING ${gateCommandColumns}
          `,
          [
            authority.id,
            identity.organizationId,
            identity.projectId,
            terminalStatus,
            input.outcomeCode,
            timestamp,
            authority.version,
          ],
        )
        if (!terminalRow) {
          throw new Error('Gate Command terminal update returned no record.')
        }
        terminalCommand = mapCommandRow(terminalRow)
      }

      const [acknowledgementRow] =
        await tx.query<GateCommandAcknowledgementRow>(
          `
            /* gate_command:ack-create */
            INSERT INTO gate_command_acknowledgements (
              id,
              command_id,
              receipt_id,
              outcome_code,
              before_run_version,
              after_run_version,
              evaluated_at,
              created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING ${gateAcknowledgementColumns}
          `,
          [
            createId('gate_acknowledgement'),
            authority.id,
            receiptId,
            input.outcomeCode,
            input.beforeRunVersion,
            input.afterRunVersion,
            input.evaluatedAt,
            timestamp,
          ],
        )
      if (!acknowledgementRow) {
        throw new Error('Gate Command acknowledgement create returned no record.')
      }
      const [acknowledgedReceiptRow] = await tx.query<GateCommandReceiptRow>(
        `
          /* gate_command:ack-receipt */
          UPDATE gate_command_receipts
          SET acknowledged_at = $4
          WHERE id = $1
            AND command_id = $2
            AND leased_to_token_id = $3
            AND acknowledged_at IS NULL
          RETURNING ${gateReceiptColumns}
        `,
        [receiptId, authority.id, identity.tokenRecordId, timestamp],
      )
      if (!acknowledgedReceiptRow) {
        throw new Error('Gate Command receipt acknowledgement returned no record.')
      }
      const acknowledgement = mapAcknowledgementRow(acknowledgementRow)
      const acknowledgedReceipt = mapReceiptRow(acknowledgedReceiptRow)
      await appendAudit(tx, {
        identity,
        recordKind: 'gate_acknowledgement',
        recordId: acknowledgement.id,
        action: 'gate_command_acknowledge',
        expectedVersion: authority.version,
        observedVersion: terminalCommand.version,
        outcomeCode: input.outcomeCode,
        requestFingerprint: fingerprint([
          'gate_command_acknowledge',
          receiptId,
          input,
        ]),
      })
      return acknowledged(
        terminalCommand,
        acknowledgedReceipt,
        acknowledgement,
      )
    }).catch((error: unknown) => {
      if (error instanceof GateCommandAuthoritativeStateUnavailableError) {
        return rejection('authoritative_state_unavailable')
      }
      throw error
    })
  }

  return {
    listGateCommands,
    createGateCommand,
    listGateCommandInbox,
    createGateCommandReceipt,
    acknowledgeGateCommand,
  }
}
