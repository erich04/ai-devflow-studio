import { redactSensitiveText } from './redaction'
import type { Role } from './domain'
import { assertCanonicalLocalNodeId } from './remote-node-identity'

export const GATE_COMMAND_ID_MAX_LENGTH = 200
export const GATE_COMMAND_IDEMPOTENCY_KEY_MAX_LENGTH = 200
export const GATE_COMMAND_REASON_MAX_LENGTH = 2_000
export const GATE_COMMAND_BLOCKER_ID_MAX_LENGTH = 200
export const GATE_COMMAND_BLOCKER_COUNT_MAX = 100
export const GATE_COMMAND_INT4_MAX = 2_147_483_647
export const GATE_COMMAND_MAX_TTL_MS = 15 * 60 * 1_000
export const GATE_COMMAND_RECEIPT_MAX_LEASE_MS = 60 * 1_000

export const GATE_COMMAND_ACTIONS = ['approve', 'reject'] as const
export const GATE_COMMAND_WORKFLOW_COMMANDS = [
  'approve_gate',
  'approve_acceptance',
] as const
export const GATE_COMMAND_EVALUATION_STATUSES = ['allowed', 'blocked'] as const
export const GATE_COMMAND_STATUSES = [
  'pending',
  'delivering',
  'applied',
  'rejected',
  'expired',
] as const
export const GATE_COMMAND_OUTCOME_CODES = [
  'applied',
  'human_rejected',
  'requester_revoked',
  'expired',
  'scope_mismatch',
  'run_not_found',
  'stale_run',
  'stale_policy',
  'blockers_changed',
  'evidence_blocked',
  'authorization_denied',
] as const
export const GATE_COMMAND_ACKNOWLEDGEMENT_OUTCOME_CODES = [
  'applied',
  'human_rejected',
  'expired',
  'scope_mismatch',
  'run_not_found',
  'stale_run',
  'stale_policy',
  'blockers_changed',
  'evidence_blocked',
  'authorization_denied',
] as const
export const GATE_COMMAND_CREATE_KEYS = [
  'action',
  'expectedBlockerIds',
  'expectedPolicyVersion',
  'expectedRunVersion',
  'idempotencyKey',
  'nodeId',
  'projectId',
  'reason',
  'runId',
] as const
export const GATE_COMMAND_RECORD_KEYS = [
  'action',
  'createdAt',
  'evaluatedAt',
  'evaluationBlockerIds',
  'evaluationStatus',
  'expectedBlockerIds',
  'expectedPolicyVersion',
  'expectedRunVersion',
  'expiresAt',
  'id',
  'idempotencyKey',
  'nodeId',
  'organizationId',
  'outcomeCode',
  'projectId',
  'reason',
  'requestFingerprint',
  'requestedByUserId',
  'requestedRole',
  'runId',
  'status',
  'updatedAt',
  'version',
  'workRequestId',
  'workflowCommand',
] as const
export const GATE_COMMAND_RECEIPT_RECORD_KEYS = [
  'acknowledgedAt',
  'attempt',
  'commandId',
  'id',
  'leaseExpiresAt',
  'leasedAt',
] as const
export const GATE_COMMAND_ACKNOWLEDGEMENT_RECORD_KEYS = [
  'afterRunVersion',
  'beforeRunVersion',
  'commandId',
  'createdAt',
  'evaluatedAt',
  'id',
  'outcomeCode',
  'receiptId',
] as const
export const GATE_COMMAND_ACKNOWLEDGEMENT_CREATE_KEYS = [
  'afterRunVersion',
  'beforeRunVersion',
  'commandId',
  'evaluatedAt',
  'outcomeCode',
] as const

export type GateCommandAction = (typeof GATE_COMMAND_ACTIONS)[number]
export type GateCommandWorkflowCommand =
  (typeof GATE_COMMAND_WORKFLOW_COMMANDS)[number]
export type GateCommandEvaluationStatus =
  (typeof GATE_COMMAND_EVALUATION_STATUSES)[number]
export type GateCommandStatus = (typeof GATE_COMMAND_STATUSES)[number]
export type GateCommandOutcomeCode =
  (typeof GATE_COMMAND_OUTCOME_CODES)[number]

export type CreateGateCommandInput = {
  projectId: string
  runId: string
  nodeId: string
  action: GateCommandAction
  reason: string
  expectedRunVersion: number
  expectedPolicyVersion: number
  expectedBlockerIds: string[]
  idempotencyKey: string
}

export type GateCommand = {
  id: string
  organizationId: string
  projectId: string
  workRequestId: string | null
  runId: string
  nodeId: string
  action: GateCommandAction
  workflowCommand: GateCommandWorkflowCommand | null
  reason: string
  requestedByUserId: string
  requestedRole: Role
  idempotencyKey: string
  requestFingerprint: string
  expectedRunVersion: number
  expectedPolicyVersion: number
  expectedBlockerIds: string[]
  version: number
  evaluationStatus: GateCommandEvaluationStatus
  evaluationBlockerIds: string[]
  evaluatedAt: string
  status: GateCommandStatus
  outcomeCode: GateCommandOutcomeCode | null
  expiresAt: string
  createdAt: string
  updatedAt: string
}

export type GateCommandReceipt = {
  id: string
  commandId: string
  attempt: number
  leasedAt: string
  leaseExpiresAt: string
  acknowledgedAt: string | null
}

export type GateCommandAcknowledgement = {
  id: string
  commandId: string
  receiptId: string
  outcomeCode: GateCommandOutcomeCode
  beforeRunVersion: number
  afterRunVersion: number
  evaluatedAt: string
  createdAt: string
}

export type CreateGateCommandAcknowledgementInput = {
  commandId: string
  outcomeCode: GateCommandOutcomeCode
  beforeRunVersion: number
  afterRunVersion: number
  evaluatedAt: string
}

const invalidGateCommandCreate = 'Invalid Gate Command create input.'
const invalidGateCommandRecord = 'Invalid Gate Command record.'
const invalidGateCommandReceiptRecord =
  'Invalid Gate Command receipt record.'
const invalidGateCommandAcknowledgementRecord =
  'Invalid Gate Command acknowledgement record.'
const invalidGateCommandAcknowledgementCreate =
  'Invalid Gate Command acknowledgement create input.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort()
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  )
}

function readIdentifier(value: unknown, errorMessage: string): string {
  if (
    typeof value !== 'string' ||
    value.length > GATE_COMMAND_ID_MAX_LENGTH ||
    value.trim().length === 0 ||
    value.trim() !== value
  ) {
    throw new Error(errorMessage)
  }
  return value
}

function readNullableIdentifier(
  value: unknown,
  errorMessage: string,
): string | null {
  return value === null ? null : readIdentifier(value, errorMessage)
}

function readIdempotencyKey(value: unknown, errorMessage: string): string {
  if (
    typeof value !== 'string' ||
    value.length > GATE_COMMAND_IDEMPOTENCY_KEY_MAX_LENGTH ||
    value.trim().length === 0 ||
    value.trim() !== value
  ) {
    throw new Error(errorMessage)
  }
  return value
}

function readInteger(
  value: unknown,
  minimum: number,
  errorMessage: string,
): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < minimum ||
    (value as number) > GATE_COMMAND_INT4_MAX
  ) {
    throw new Error(errorMessage)
  }
  return value as number
}

function readCanonicalBlockerIds(
  value: unknown,
  errorMessage: string,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length > GATE_COMMAND_BLOCKER_COUNT_MAX
  ) {
    throw new Error(errorMessage)
  }

  const blockerIds = value.map((blockerId) => {
    if (
      typeof blockerId !== 'string' ||
      blockerId.length > GATE_COMMAND_BLOCKER_ID_MAX_LENGTH ||
      blockerId.trim().length === 0 ||
      blockerId.trim() !== blockerId
    ) {
      throw new Error(errorMessage)
    }
    return blockerId
  })

  for (let index = 1; index < blockerIds.length; index += 1) {
    if (blockerIds[index - 1]! >= blockerIds[index]!) {
      throw new Error(errorMessage)
    }
  }
  return blockerIds
}

function readReason(value: unknown, errorMessage: string): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > GATE_COMMAND_REASON_MAX_LENGTH
  ) {
    throw new Error(errorMessage)
  }

  return redactSensitiveText(value).value.slice(0, GATE_COMMAND_REASON_MAX_LENGTH)
}

function readCanonicalIso(value: unknown, errorMessage: string): string {
  if (typeof value !== 'string') {
    throw new Error(errorMessage)
  }

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(errorMessage)
  }
  return value
}

function readNullableCanonicalIso(
  value: unknown,
  errorMessage: string,
): string | null {
  return value === null ? null : readCanonicalIso(value, errorMessage)
}

function readRole(value: unknown, errorMessage: string): Role {
  if (value !== 'owner' && value !== 'lead' && value !== 'member') {
    throw new Error(errorMessage)
  }
  return value
}

function readRequestFingerprint(value: unknown, errorMessage: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(errorMessage)
  }
  return value
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  errorMessage: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(errorMessage)
  }
  return value as T
}

function readNullableEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  errorMessage: string,
): T | null {
  return value === null ? null : readEnum(value, allowed, errorMessage)
}

function hasConsistentAction(
  action: GateCommandAction,
  workflowCommand: GateCommandWorkflowCommand | null,
): boolean {
  return action === 'approve'
    ? workflowCommand !== null
    : workflowCommand === null
}

const rejectionOutcomeCodes: readonly GateCommandOutcomeCode[] = [
  'requester_revoked',
  'scope_mismatch',
  'run_not_found',
  'stale_run',
  'stale_policy',
  'blockers_changed',
  'evidence_blocked',
  'authorization_denied',
]

function hasConsistentLifecycle(
  status: GateCommandStatus,
  action: GateCommandAction,
  outcomeCode: GateCommandOutcomeCode | null,
): boolean {
  if (status === 'pending' || status === 'delivering') {
    return outcomeCode === null
  }
  if (status === 'expired') {
    return outcomeCode === 'expired'
  }
  if (status === 'rejected') {
    return (
      outcomeCode !== null && rejectionOutcomeCodes.includes(outcomeCode)
    )
  }
  return action === 'approve'
    ? outcomeCode === 'applied'
    : outcomeCode === 'human_rejected'
}

export function parseGateCommandRecord(value: unknown): GateCommand {
  if (!isRecord(value) || !hasExactKeys(value, GATE_COMMAND_RECORD_KEYS)) {
    throw new Error(invalidGateCommandRecord)
  }

  const action = readEnum(
    value.action,
    GATE_COMMAND_ACTIONS,
    invalidGateCommandRecord,
  )
  const workflowCommand = readNullableEnum(
    value.workflowCommand,
    GATE_COMMAND_WORKFLOW_COMMANDS,
    invalidGateCommandRecord,
  )
  const evaluationStatus = readEnum(
    value.evaluationStatus,
    GATE_COMMAND_EVALUATION_STATUSES,
    invalidGateCommandRecord,
  )
  const evaluationBlockerIds = readCanonicalBlockerIds(
    value.evaluationBlockerIds,
    invalidGateCommandRecord,
  )
  const expectedBlockerIds = readCanonicalBlockerIds(
    value.expectedBlockerIds,
    invalidGateCommandRecord,
  )
  const runId = readIdentifier(value.runId, invalidGateCommandRecord)
  const nodeId = readIdentifier(value.nodeId, invalidGateCommandRecord)
  try {
    assertCanonicalLocalNodeId(runId, nodeId)
  } catch {
    throw new Error(invalidGateCommandRecord)
  }
  const status = readEnum(
    value.status,
    GATE_COMMAND_STATUSES,
    invalidGateCommandRecord,
  )
  const outcomeCode = readNullableEnum(
    value.outcomeCode,
    GATE_COMMAND_OUTCOME_CODES,
    invalidGateCommandRecord,
  )
  const evaluatedAt = readCanonicalIso(
    value.evaluatedAt,
    invalidGateCommandRecord,
  )
  const expiresAt = readCanonicalIso(value.expiresAt, invalidGateCommandRecord)
  const createdAt = readCanonicalIso(value.createdAt, invalidGateCommandRecord)
  const updatedAt = readCanonicalIso(value.updatedAt, invalidGateCommandRecord)

  if (
    !hasConsistentAction(action, workflowCommand) ||
    !hasConsistentLifecycle(status, action, outcomeCode) ||
    (evaluationStatus === 'allowed' &&
      (expectedBlockerIds.length !== evaluationBlockerIds.length ||
        expectedBlockerIds.some(
          (blockerId, index) => blockerId !== evaluationBlockerIds[index],
        ))) ||
    (evaluationStatus === 'blocked' && evaluationBlockerIds.length === 0) ||
    (evaluationStatus === 'blocked' && status !== 'rejected') ||
    Date.parse(evaluatedAt) > Date.parse(createdAt) ||
    Date.parse(updatedAt) < Date.parse(createdAt) ||
    Date.parse(expiresAt) <= Date.parse(createdAt) ||
    Date.parse(expiresAt) - Date.parse(createdAt) > GATE_COMMAND_MAX_TTL_MS ||
    (status === 'expired' && Date.parse(updatedAt) < Date.parse(expiresAt))
  ) {
    throw new Error(invalidGateCommandRecord)
  }

  return {
    id: readIdentifier(value.id, invalidGateCommandRecord),
    organizationId: readIdentifier(
      value.organizationId,
      invalidGateCommandRecord,
    ),
    projectId: readIdentifier(value.projectId, invalidGateCommandRecord),
    workRequestId: readNullableIdentifier(
      value.workRequestId,
      invalidGateCommandRecord,
    ),
    runId,
    nodeId,
    action,
    workflowCommand,
    reason: readReason(value.reason, invalidGateCommandRecord),
    requestedByUserId: readIdentifier(
      value.requestedByUserId,
      invalidGateCommandRecord,
    ),
    requestedRole: readRole(value.requestedRole, invalidGateCommandRecord),
    idempotencyKey: readIdempotencyKey(
      value.idempotencyKey,
      invalidGateCommandRecord,
    ),
    requestFingerprint: readRequestFingerprint(
      value.requestFingerprint,
      invalidGateCommandRecord,
    ),
    expectedRunVersion: readInteger(
      value.expectedRunVersion,
      1,
      invalidGateCommandRecord,
    ),
    expectedPolicyVersion: readInteger(
      value.expectedPolicyVersion,
      0,
      invalidGateCommandRecord,
    ),
    expectedBlockerIds,
    version: readInteger(value.version, 1, invalidGateCommandRecord),
    evaluationStatus,
    evaluationBlockerIds,
    evaluatedAt,
    status,
    outcomeCode,
    expiresAt,
    createdAt,
    updatedAt,
  }
}

export function parseGateCommandReceiptRecord(
  value: unknown,
): GateCommandReceipt {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, GATE_COMMAND_RECEIPT_RECORD_KEYS)
  ) {
    throw new Error(invalidGateCommandReceiptRecord)
  }

  const leasedAt = readCanonicalIso(
    value.leasedAt,
    invalidGateCommandReceiptRecord,
  )
  const leaseExpiresAt = readCanonicalIso(
    value.leaseExpiresAt,
    invalidGateCommandReceiptRecord,
  )
  const acknowledgedAt = readNullableCanonicalIso(
    value.acknowledgedAt,
    invalidGateCommandReceiptRecord,
  )
  if (
    Date.parse(leaseExpiresAt) <= Date.parse(leasedAt) ||
    Date.parse(leaseExpiresAt) - Date.parse(leasedAt) >
      GATE_COMMAND_RECEIPT_MAX_LEASE_MS ||
    (acknowledgedAt !== null && Date.parse(acknowledgedAt) < Date.parse(leasedAt))
  ) {
    throw new Error(invalidGateCommandReceiptRecord)
  }

  return {
    id: readIdentifier(value.id, invalidGateCommandReceiptRecord),
    commandId: readIdentifier(
      value.commandId,
      invalidGateCommandReceiptRecord,
    ),
    attempt: readInteger(value.attempt, 1, invalidGateCommandReceiptRecord),
    leasedAt,
    leaseExpiresAt,
    acknowledgedAt,
  }
}

export function parseGateCommandAcknowledgementRecord(
  value: unknown,
): GateCommandAcknowledgement {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, GATE_COMMAND_ACKNOWLEDGEMENT_RECORD_KEYS)
  ) {
    throw new Error(invalidGateCommandAcknowledgementRecord)
  }

  const outcomeCode = readEnum(
    value.outcomeCode,
    GATE_COMMAND_OUTCOME_CODES,
    invalidGateCommandAcknowledgementRecord,
  )
  const beforeRunVersion = readInteger(
    value.beforeRunVersion,
    1,
    invalidGateCommandAcknowledgementRecord,
  )
  const afterRunVersion = readInteger(
    value.afterRunVersion,
    1,
    invalidGateCommandAcknowledgementRecord,
  )
  const evaluatedAt = readCanonicalIso(
    value.evaluatedAt,
    invalidGateCommandAcknowledgementRecord,
  )
  const createdAt = readCanonicalIso(
    value.createdAt,
    invalidGateCommandAcknowledgementRecord,
  )
  const evaluatedAtMs = Date.parse(evaluatedAt)
  const createdAtMs = Date.parse(createdAt)
  if (
    evaluatedAtMs - createdAtMs > GATE_COMMAND_RECEIPT_MAX_LEASE_MS ||
    (outcomeCode === 'expired' && evaluatedAtMs > createdAtMs) ||
    (outcomeCode === 'applied'
      ? afterRunVersion !== beforeRunVersion + 1
      : afterRunVersion !== beforeRunVersion)
  ) {
    throw new Error(invalidGateCommandAcknowledgementRecord)
  }

  return {
    id: readIdentifier(value.id, invalidGateCommandAcknowledgementRecord),
    commandId: readIdentifier(
      value.commandId,
      invalidGateCommandAcknowledgementRecord,
    ),
    receiptId: readIdentifier(
      value.receiptId,
      invalidGateCommandAcknowledgementRecord,
    ),
    outcomeCode,
    beforeRunVersion,
    afterRunVersion,
    evaluatedAt,
    createdAt,
  }
}

export function parseGateCommandAcknowledgementCreate(
  value: unknown,
): CreateGateCommandAcknowledgementInput {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, GATE_COMMAND_ACKNOWLEDGEMENT_CREATE_KEYS)
  ) {
    throw new Error(invalidGateCommandAcknowledgementCreate)
  }

  const outcomeCode = readEnum(
    value.outcomeCode,
    GATE_COMMAND_ACKNOWLEDGEMENT_OUTCOME_CODES,
    invalidGateCommandAcknowledgementCreate,
  )
  const beforeRunVersion = readInteger(
    value.beforeRunVersion,
    1,
    invalidGateCommandAcknowledgementCreate,
  )
  const afterRunVersion = readInteger(
    value.afterRunVersion,
    1,
    invalidGateCommandAcknowledgementCreate,
  )
  if (
    (outcomeCode === 'applied'
      ? afterRunVersion !== beforeRunVersion + 1
      : afterRunVersion !== beforeRunVersion)
  ) {
    throw new Error(invalidGateCommandAcknowledgementCreate)
  }

  return {
    commandId: readIdentifier(
      value.commandId,
      invalidGateCommandAcknowledgementCreate,
    ),
    outcomeCode,
    beforeRunVersion,
    afterRunVersion,
    evaluatedAt: readCanonicalIso(
      value.evaluatedAt,
      invalidGateCommandAcknowledgementCreate,
    ),
  }
}

export function parseGateCommandCreate(value: unknown): CreateGateCommandInput {
  if (!isRecord(value) || !hasExactKeys(value, GATE_COMMAND_CREATE_KEYS)) {
    throw new Error(invalidGateCommandCreate)
  }

  if (
    typeof value.action !== 'string' ||
    !GATE_COMMAND_ACTIONS.includes(value.action as GateCommandAction)
  ) {
    throw new Error(invalidGateCommandCreate)
  }

  const runId = readIdentifier(value.runId, invalidGateCommandCreate)
  const nodeId = readIdentifier(value.nodeId, invalidGateCommandCreate)
  try {
    assertCanonicalLocalNodeId(runId, nodeId)
  } catch {
    throw new Error(invalidGateCommandCreate)
  }

  return {
    projectId: readIdentifier(value.projectId, invalidGateCommandCreate),
    runId,
    nodeId,
    action: value.action as GateCommandAction,
    reason: readReason(value.reason, invalidGateCommandCreate),
    expectedRunVersion: readInteger(
      value.expectedRunVersion,
      1,
      invalidGateCommandCreate,
    ),
    expectedPolicyVersion: readInteger(
      value.expectedPolicyVersion,
      0,
      invalidGateCommandCreate,
    ),
    expectedBlockerIds: readCanonicalBlockerIds(
      value.expectedBlockerIds,
      invalidGateCommandCreate,
    ),
    idempotencyKey: readIdempotencyKey(
      value.idempotencyKey,
      invalidGateCommandCreate,
    ),
  }
}
