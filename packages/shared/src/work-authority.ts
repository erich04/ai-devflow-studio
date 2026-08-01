import { redactSensitiveText } from './redaction'

export const WORK_REQUEST_ID_MAX_LENGTH = 200
export const WORK_REQUEST_TITLE_MAX_LENGTH = 200
export const WORK_REQUEST_BODY_MAX_LENGTH = 8_000
export const WORK_REQUEST_IDEMPOTENCY_KEY_MAX_LENGTH = 200
export const WORK_REQUEST_VERSION_MAX = 2_147_483_647
export const WORK_REQUEST_STATUSES = [
  'open',
  'claim_pending',
  'materialized',
  'cancelled',
  'expired',
] as const

export const WORK_REQUEST_RECORD_KEYS = [
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
] as const
export const WORK_REQUEST_CLAIM_KEYS = [
  'claimedAt',
  'materializedAt',
  'runId',
] as const
export const WORK_REQUEST_CREATE_KEYS = [
  'expiresAt',
  'idempotencyKey',
  'projectId',
  'request',
  'title',
] as const
export const WORK_REQUEST_CLAIM_INPUT_KEYS = [
  'expectedVersion',
  'idempotencyKey',
  'runId',
  'workRequestId',
] as const

const invalidWorkRequestRecord = 'Invalid Work Request record.'
const invalidWorkRequestCreate = 'Invalid Work Request create input.'
const invalidWorkRequestClaim = 'Invalid Work Request claim input.'
const invalidWorkRequestMaterialize = 'Invalid Work Request materialize input.'

export type WorkRequestStatus = (typeof WORK_REQUEST_STATUSES)[number]

export type WorkRequestClaim = {
  runId: string
  claimedAt: string
  materializedAt: string | null
}

export type WorkRequest = {
  id: string
  organizationId: string
  projectId: string
  title: string
  request: string
  version: number
  status: WorkRequestStatus
  createdByUserId: string
  claim: WorkRequestClaim | null
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

export type CreateWorkRequestInput = {
  projectId: string
  title: string
  request: string
  idempotencyKey: string
  expiresAt: string | null
}

export type ClaimWorkRequestInput = {
  workRequestId: string
  expectedVersion: number
  runId: string
  idempotencyKey: string
}

export type MaterializeWorkRequestInput = {
  workRequestId: string
  expectedVersion: number
  runId: string
  idempotencyKey: string
}

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
    value.length > WORK_REQUEST_ID_MAX_LENGTH ||
    value.trim().length === 0 ||
    value.trim() !== value
  ) {
    throw new Error(errorMessage)
  }

  return value
}

function readIdempotencyKey(value: unknown, errorMessage: string): string {
  if (
    typeof value !== 'string' ||
    value.length > WORK_REQUEST_IDEMPOTENCY_KEY_MAX_LENGTH ||
    value.trim().length === 0 ||
    value.trim() !== value
  ) {
    throw new Error(errorMessage)
  }

  return value
}

function readPositiveInteger(value: unknown, errorMessage: string): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > WORK_REQUEST_VERSION_MAX
  ) {
    throw new Error(errorMessage)
  }

  return value as number
}

function readWorkRequestStatus(
  value: unknown,
  errorMessage: string,
): WorkRequestStatus {
  if (
    typeof value !== 'string' ||
    !WORK_REQUEST_STATUSES.includes(value as WorkRequestStatus)
  ) {
    throw new Error(errorMessage)
  }

  return value as WorkRequestStatus
}

function readUserText(
  value: unknown,
  maxLength: number,
  errorMessage: string,
): string {
  if (
    typeof value !== 'string' ||
    value.length > maxLength ||
    value.trim().length === 0
  ) {
    throw new Error(errorMessage)
  }

  return redactSensitiveText(value).value.slice(0, maxLength)
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

function readWorkRequestClaim(
  value: unknown,
  errorMessage: string,
): WorkRequestClaim | null {
  if (value === null) {
    return null
  }
  if (!isRecord(value) || !hasExactKeys(value, WORK_REQUEST_CLAIM_KEYS)) {
    throw new Error(errorMessage)
  }

  return {
    runId: readIdentifier(value.runId, errorMessage),
    claimedAt: readCanonicalIso(value.claimedAt, errorMessage),
    materializedAt: readNullableCanonicalIso(value.materializedAt, errorMessage),
  }
}

function hasConsistentWorkRequestClaim(
  status: WorkRequestStatus,
  claim: WorkRequestClaim | null,
): boolean {
  if (status === 'open') {
    return claim === null
  }
  if (status === 'claim_pending') {
    return claim !== null && claim.materializedAt === null
  }
  if (status === 'materialized') {
    return claim !== null && claim.materializedAt !== null
  }
  if (status === 'expired') {
    return claim === null
  }

  return claim === null || claim.materializedAt === null
}

export function parseWorkRequestRecord(value: unknown): WorkRequest {
  if (!isRecord(value) || !hasExactKeys(value, WORK_REQUEST_RECORD_KEYS)) {
    throw new Error(invalidWorkRequestRecord)
  }

  const status = readWorkRequestStatus(value.status, invalidWorkRequestRecord)
  const claim = readWorkRequestClaim(value.claim, invalidWorkRequestRecord)
  if (!hasConsistentWorkRequestClaim(status, claim)) {
    throw new Error(invalidWorkRequestRecord)
  }
  const expiresAt = readNullableCanonicalIso(
    value.expiresAt,
    invalidWorkRequestRecord,
  )
  const createdAt = readCanonicalIso(value.createdAt, invalidWorkRequestRecord)
  const updatedAt = readCanonicalIso(value.updatedAt, invalidWorkRequestRecord)
  const createdTimestamp = Date.parse(createdAt)
  const updatedTimestamp = Date.parse(updatedAt)
  const expiresTimestamp = expiresAt === null ? null : Date.parse(expiresAt)
  const claimedTimestamp = claim === null ? null : Date.parse(claim.claimedAt)
  const materializedTimestamp =
    claim?.materializedAt === null || claim?.materializedAt === undefined
      ? null
      : Date.parse(claim.materializedAt)
  if (
    updatedTimestamp < createdTimestamp ||
    (expiresTimestamp !== null && expiresTimestamp <= createdTimestamp) ||
    (status === 'expired' && expiresTimestamp === null) ||
    (status === 'expired' && updatedTimestamp < (expiresTimestamp ?? 0)) ||
    (claimedTimestamp !== null && claimedTimestamp < createdTimestamp) ||
    (claimedTimestamp !== null && updatedTimestamp < claimedTimestamp) ||
    (claimedTimestamp !== null &&
      expiresTimestamp !== null &&
      claimedTimestamp >= expiresTimestamp) ||
    (materializedTimestamp !== null &&
      (claimedTimestamp === null || materializedTimestamp < claimedTimestamp)) ||
    (materializedTimestamp !== null && updatedTimestamp < materializedTimestamp)
  ) {
    throw new Error(invalidWorkRequestRecord)
  }

  return {
    id: readIdentifier(value.id, invalidWorkRequestRecord),
    organizationId: readIdentifier(
      value.organizationId,
      invalidWorkRequestRecord,
    ),
    projectId: readIdentifier(value.projectId, invalidWorkRequestRecord),
    title: readUserText(
      value.title,
      WORK_REQUEST_TITLE_MAX_LENGTH,
      invalidWorkRequestRecord,
    ),
    request: readUserText(
      value.request,
      WORK_REQUEST_BODY_MAX_LENGTH,
      invalidWorkRequestRecord,
    ),
    version: readPositiveInteger(value.version, invalidWorkRequestRecord),
    status,
    createdByUserId: readIdentifier(
      value.createdByUserId,
      invalidWorkRequestRecord,
    ),
    claim,
    expiresAt,
    createdAt,
    updatedAt,
  }
}

export function parseWorkRequestCreate(value: unknown): CreateWorkRequestInput {
  if (!isRecord(value) || !hasExactKeys(value, WORK_REQUEST_CREATE_KEYS)) {
    throw new Error(invalidWorkRequestCreate)
  }

  return {
    projectId: readIdentifier(value.projectId, invalidWorkRequestCreate),
    title: readUserText(
      value.title,
      WORK_REQUEST_TITLE_MAX_LENGTH,
      invalidWorkRequestCreate,
    ),
    request: readUserText(
      value.request,
      WORK_REQUEST_BODY_MAX_LENGTH,
      invalidWorkRequestCreate,
    ),
    idempotencyKey: readIdempotencyKey(
      value.idempotencyKey,
      invalidWorkRequestCreate,
    ),
    expiresAt: readNullableCanonicalIso(
      value.expiresAt,
      invalidWorkRequestCreate,
    ),
  }
}

function parseWorkRequestRunInput(
  value: unknown,
  errorMessage: string,
): ClaimWorkRequestInput {
  if (!isRecord(value) || !hasExactKeys(value, WORK_REQUEST_CLAIM_INPUT_KEYS)) {
    throw new Error(errorMessage)
  }

  return {
    workRequestId: readIdentifier(value.workRequestId, errorMessage),
    expectedVersion: readPositiveInteger(value.expectedVersion, errorMessage),
    runId: readIdentifier(value.runId, errorMessage),
    idempotencyKey: readIdempotencyKey(value.idempotencyKey, errorMessage),
  }
}

export function parseWorkRequestClaim(value: unknown): ClaimWorkRequestInput {
  return parseWorkRequestRunInput(value, invalidWorkRequestClaim)
}

export function parseWorkRequestMaterialize(
  value: unknown,
): MaterializeWorkRequestInput {
  return parseWorkRequestRunInput(value, invalidWorkRequestMaterialize)
}
