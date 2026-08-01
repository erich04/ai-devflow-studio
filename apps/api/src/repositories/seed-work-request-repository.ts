import { createHash, randomUUID } from 'node:crypto'
import type {
  ClaimWorkRequestInput,
  CreateWorkRequestInput,
  MaterializeWorkRequestInput,
  ReleaseWorkRequestInput,
  Role,
  WorkRequest,
} from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'
import {
  fingerprintWorkRequestOperation,
  safeWorkRequest,
  type WorkRequestMutationResult,
  type WorkRequestOperationInput,
  type WorkRequestOperationKind,
  type WorkRequestRejectionCode,
  type WorkRequestRepository,
  type WorkRequestSuccessCode,
} from './work-request-contract'

type MaybePromise<T> = T | Promise<T>

export type SeedWorkRequestRepositoryOptions = {
  projectExists(
    organizationId: string,
    projectId: string,
  ): MaybePromise<boolean>
  canonicalProjectionExists(
    runId: string,
    organizationId: string,
    projectId: string,
  ): MaybePromise<boolean>
  now?: () => Date | string
  id?: () => string
}

type InternalWorkRequest = WorkRequest & {
  claimedByTokenId: string | null
}

type StoredIdempotencyResult = {
  fingerprint: string
  result: WorkRequestMutationResult
}

export type SeedWorkRequestAuditEvent = {
  organizationId: string
  projectId: string
  actorUserId: string
  actorRole: Role
  authenticationKind: RequestPrincipal['authentication']['kind']
  authenticationTokenRecordId: string | null
  operation: WorkRequestOperationKind | 'work_request_expire'
  workRequestId: string | null
  expectedVersion: number | null
  outcomeCode: WorkRequestSuccessCode | WorkRequestRejectionCode
  requestFingerprint: string
  replayed: boolean
  createdAt: string
}

export type SeedWorkRequestRepository = WorkRequestRepository & {
  inspectForTests(): {
    internalRecords: InternalWorkRequest[]
    auditEvents: SeedWorkRequestAuditEvent[]
    idempotencyRecordCount: number
  }
}

const permittedBrowserAuthentication = new Set<
  RequestPrincipal['authentication']['kind']
>(['session_cookie', 'development_header'])

function cloneWorkRequest(workRequest: WorkRequest): WorkRequest {
  return {
    ...workRequest,
    claim: workRequest.claim ? { ...workRequest.claim } : null,
  }
}

function cloneResult(
  result: WorkRequestMutationResult,
  replayed = result.replayed,
): WorkRequestMutationResult {
  if (!result.ok) {
    return { ...result, replayed }
  }

  return {
    ...result,
    replayed,
    workRequest: cloneWorkRequest(result.workRequest),
  }
}

function publicWorkRequest(record: InternalWorkRequest): WorkRequest {
  return safeWorkRequest({
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    title: record.title,
    request: record.request,
    version: record.version,
    status: record.status,
    createdByUserId: record.createdByUserId,
    claim: record.claim ? { ...record.claim } : null,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
}

function success(
  outcomeCode: WorkRequestSuccessCode,
  workRequest: WorkRequest,
  responseStatus: 200 | 201,
): WorkRequestMutationResult {
  return {
    ok: true,
    responseStatus,
    outcomeCode,
    replayed: false,
    workRequest,
  }
}

function rejection(
  outcomeCode: WorkRequestRejectionCode,
): WorkRequestMutationResult {
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
    responseStatus: statusByCode[outcomeCode],
    outcomeCode,
    replayed: false,
  }
}

function projectRole(
  principal: RequestPrincipal,
  projectId: string,
): Role | null {
  if (
    principal.session.role === 'owner' &&
    principal.authentication.kind !== 'desktop_bearer'
  ) {
    return 'owner'
  }

  return (
    principal.session.projectMemberships.find(
      (membership) =>
        membership.projectId === projectId &&
        membership.userId === principal.session.userId,
    )?.role ?? null
  )
}

function canRelease(role: Role | null): boolean {
  return role === 'owner' || role === 'lead'
}

function expectedVersion(input: WorkRequestOperationInput): number | null {
  return 'expectedVersion' in input ? input.expectedVersion : null
}

export function createSeedWorkRequestRepository(
  options: SeedWorkRequestRepositoryOptions,
): SeedWorkRequestRepository {
  const records = new Map<string, InternalWorkRequest>()
  const idempotency = new Map<string, StoredIdempotencyResult>()
  const auditEvents: SeedWorkRequestAuditEvent[] = []
  const now = options.now ?? (() => new Date())
  const nextId = options.id ?? (() => `wr-${randomUUID()}`)

  function timestamp(): string {
    const value = now()
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isFinite(date.valueOf())) {
      throw new Error('Seed Work Request clock returned an invalid date.')
    }
    return date.toISOString()
  }

  function findRecord(
    workRequestId: string,
    principal: RequestPrincipal,
  ): InternalWorkRequest | null {
    const record = records.get(workRequestId)
    return record?.organizationId === principal.session.organizationId
      ? record
      : null
  }

  function idempotencyScope(
    principal: RequestPrincipal,
    projectId: string,
    operation: WorkRequestOperationKind,
    idempotencyKey: string,
  ): string {
    return JSON.stringify([
      principal.session.organizationId,
      projectId,
      principal.session.userId,
      operation,
      idempotencyKey,
    ])
  }

  function audit(
    principal: RequestPrincipal,
    projectId: string,
    operation: WorkRequestOperationKind,
    input: WorkRequestOperationInput,
    fingerprint: string,
    result: WorkRequestMutationResult,
    workRequestId: string | null,
  ): void {
    auditEvents.push({
      organizationId: principal.session.organizationId,
      projectId,
      actorUserId: principal.session.userId,
      actorRole: projectRole(principal, projectId) ?? principal.session.role,
      authenticationKind: principal.authentication.kind,
      authenticationTokenRecordId: principal.authentication.tokenRecordId,
      operation,
      workRequestId,
      expectedVersion: expectedVersion(input),
      outcomeCode: result.outcomeCode,
      requestFingerprint: fingerprint,
      replayed: result.replayed,
      createdAt: timestamp(),
    })
  }

  function inspectIdempotency(
    principal: RequestPrincipal,
    projectId: string,
    operation: WorkRequestOperationKind,
    input: WorkRequestOperationInput,
  ):
    | { kind: 'new'; scope: string; fingerprint: string }
    | {
        kind: 'replay'
        scope: string
        fingerprint: string
        result: WorkRequestMutationResult
      }
    | { kind: 'conflict'; scope: string; fingerprint: string } {
    const scope = idempotencyScope(
      principal,
      projectId,
      operation,
      input.idempotencyKey,
    )
    const fingerprint = fingerprintWorkRequestOperation(operation, input)
    const existing = idempotency.get(scope)
    if (!existing) {
      return { kind: 'new', scope, fingerprint }
    }
    if (existing.fingerprint !== fingerprint) {
      return { kind: 'conflict', scope, fingerprint }
    }

    return {
      kind: 'replay',
      scope,
      fingerprint,
      result: cloneResult(existing.result, true),
    }
  }

  function finish(
    principal: RequestPrincipal,
    projectId: string,
    operation: WorkRequestOperationKind,
    input: WorkRequestOperationInput,
    idempotencyCheck: ReturnType<typeof inspectIdempotency>,
    result: WorkRequestMutationResult,
    workRequestId: string | null,
  ): WorkRequestMutationResult {
    if (idempotencyCheck.kind === 'new') {
      idempotency.set(idempotencyCheck.scope, {
        fingerprint: idempotencyCheck.fingerprint,
        result: cloneResult(result, false),
      })
    }
    audit(
      principal,
      projectId,
      operation,
      input,
      idempotencyCheck.fingerprint,
      result,
      workRequestId,
    )
    return cloneResult(result)
  }

  function replayOrConflict(
    principal: RequestPrincipal,
    projectId: string,
    operation: WorkRequestOperationKind,
    input: WorkRequestOperationInput,
    check: ReturnType<typeof inspectIdempotency>,
    workRequestId: string | null,
  ): WorkRequestMutationResult | null {
    if (check.kind === 'new') {
      return null
    }
    const result =
      check.kind === 'replay'
        ? check.result
        : rejection('idempotency_conflict')
    audit(
      principal,
      projectId,
      operation,
      input,
      check.fingerprint,
      result,
      workRequestId,
    )
    return cloneResult(result)
  }

  function expireOpenRecord(record: InternalWorkRequest, at: string): boolean {
    if (
      record.status !== 'open' ||
      record.expiresAt === null ||
      Date.parse(record.expiresAt) > Date.parse(at)
    ) {
      return false
    }

    record.status = 'expired'
    record.version += 1
    record.updatedAt = at
    return true
  }

  function auditListExpiry(
    principal: RequestPrincipal,
    record: InternalWorkRequest,
    expiredVersion: number,
    at: string,
  ): void {
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          'work_request_expire',
          record.organizationId,
          record.projectId,
          record.id,
          expiredVersion,
        ]),
        'utf8',
      )
      .digest('hex')
    auditEvents.push({
      organizationId: record.organizationId,
      projectId: record.projectId,
      actorUserId: principal.session.userId,
      actorRole:
        projectRole(principal, record.projectId) ?? principal.session.role,
      authenticationKind: principal.authentication.kind,
      authenticationTokenRecordId: principal.authentication.tokenRecordId,
      operation: 'work_request_expire',
      workRequestId: record.id,
      expectedVersion: expiredVersion,
      outcomeCode: 'expired',
      requestFingerprint: fingerprint,
      replayed: false,
      createdAt: at,
    })
  }

  async function hasProject(
    principal: RequestPrincipal,
    projectId: string,
  ): Promise<boolean> {
    return (
      projectRole(principal, projectId) !== null &&
      (await options.projectExists(
        principal.session.organizationId,
        projectId,
      ))
    )
  }

  async function listWorkRequests(
    projectId: string,
    principal: RequestPrincipal,
  ): Promise<WorkRequest[]> {
    if (!(await hasProject(principal, projectId))) {
      return []
    }

    const at = timestamp()
    return [...records.values()]
      .filter(
        (record) =>
          record.organizationId === principal.session.organizationId &&
          record.projectId === projectId,
      )
      .map((record) => {
        const expiredVersion = record.version
        if (expireOpenRecord(record, at)) {
          auditListExpiry(principal, record, expiredVersion, at)
        }
        return record
      })
      .filter(
        (record) =>
          principal.authentication.kind !== 'desktop_bearer' ||
          record.status === 'open' ||
          ((record.status === 'claim_pending' ||
            record.status === 'materialized') &&
            record.claimedByTokenId ===
              principal.authentication.tokenRecordId),
      )
      .map(publicWorkRequest)
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          left.id.localeCompare(right.id),
      )
  }

  async function createWorkRequest(
    input: CreateWorkRequestInput,
    principal: RequestPrincipal,
  ): Promise<WorkRequestMutationResult> {
    if (!permittedBrowserAuthentication.has(principal.authentication.kind)) {
      return rejection('authentication_forbidden')
    }
    if (!(await hasProject(principal, input.projectId))) {
      return rejection('project_forbidden')
    }

    const operation = 'work_request_create'
    const check = inspectIdempotency(principal, input.projectId, operation, input)
    const prior = replayOrConflict(
      principal,
      input.projectId,
      operation,
      input,
      check,
      null,
    )
    if (prior) return prior

    const at = timestamp()
    if (input.expiresAt !== null && Date.parse(input.expiresAt) <= Date.parse(at)) {
      return finish(
        principal,
        input.projectId,
        operation,
        input,
        check,
        rejection('expired'),
        null,
      )
    }

    const workRequestId = nextId()
    if (records.has(workRequestId)) {
      throw new Error(`Duplicate seed Work Request ID: ${workRequestId}`)
    }
    const publicRecord = safeWorkRequest({
      id: workRequestId,
      organizationId: principal.session.organizationId,
      projectId: input.projectId,
      title: input.title,
      request: input.request,
      version: 1,
      status: 'open',
      createdByUserId: principal.session.userId,
      claim: null,
      expiresAt: input.expiresAt,
      createdAt: at,
      updatedAt: at,
    })
    records.set(workRequestId, {
      ...publicRecord,
      claim: null,
      claimedByTokenId: null,
    })
    return finish(
      principal,
      input.projectId,
      operation,
      input,
      check,
      success('created', publicRecord, 201),
      workRequestId,
    )
  }

  async function claimWorkRequest(
    input: ClaimWorkRequestInput,
    principal: RequestPrincipal,
  ): Promise<WorkRequestMutationResult> {
    if (
      principal.authentication.kind !== 'desktop_bearer' ||
      principal.authentication.tokenRecordId.trim().length === 0
    ) {
      return rejection('authentication_forbidden')
    }
    const record = findRecord(input.workRequestId, principal)
    if (!record) return rejection('not_found')
    if (!(await hasProject(principal, record.projectId))) {
      return rejection('project_forbidden')
    }

    const operation = 'work_request_claim'
    const check = inspectIdempotency(principal, record.projectId, operation, input)
    const prior = replayOrConflict(
      principal,
      record.projectId,
      operation,
      input,
      check,
      record.id,
    )
    if (prior) return prior

    const at = timestamp()
    expireOpenRecord(record, at)
    let result: WorkRequestMutationResult
    if (record.status === 'expired') {
      result = rejection('expired')
    } else if (record.version !== input.expectedVersion) {
      result = rejection('stale_version')
    } else if (record.status !== 'open') {
      result = rejection('claim_conflict')
    } else if (
      (await options.canonicalProjectionExists(
        input.runId,
        record.organizationId,
        record.projectId,
      )) ||
      [...records.values()].some(
        (candidate) =>
          candidate.id !== record.id &&
          candidate.organizationId === record.organizationId &&
          candidate.projectId === record.projectId &&
          candidate.claim?.runId === input.runId,
      )
    ) {
      result = rejection('claim_conflict')
    } else {
      record.status = 'claim_pending'
      record.version += 1
      record.claimedByTokenId = principal.authentication.tokenRecordId
      record.claim = {
        runId: input.runId,
        claimedAt: at,
        materializedAt: null,
      }
      record.updatedAt = at
      result = success('claimed', publicWorkRequest(record), 200)
    }
    return finish(
      principal,
      record.projectId,
      operation,
      input,
      check,
      result,
      record.id,
    )
  }

  async function materializeWorkRequest(
    input: MaterializeWorkRequestInput,
    principal: RequestPrincipal,
  ): Promise<WorkRequestMutationResult> {
    if (
      principal.authentication.kind !== 'desktop_bearer' ||
      principal.authentication.tokenRecordId.trim().length === 0
    ) {
      return rejection('authentication_forbidden')
    }
    const record = findRecord(input.workRequestId, principal)
    if (!record) return rejection('not_found')
    if (!(await hasProject(principal, record.projectId))) {
      return rejection('project_forbidden')
    }

    const operation = 'work_request_materialize'
    const check = inspectIdempotency(principal, record.projectId, operation, input)
    const prior = replayOrConflict(
      principal,
      record.projectId,
      operation,
      input,
      check,
      record.id,
    )
    if (prior) return prior

    let result: WorkRequestMutationResult
    if (record.version !== input.expectedVersion) {
      result = rejection('stale_version')
    } else if (record.status !== 'claim_pending' || record.claim === null) {
      result = rejection('not_claim_pending')
    } else if (
      record.claim.runId !== input.runId ||
      record.claimedByTokenId !== principal.authentication.tokenRecordId
    ) {
      result = rejection('claimant_forbidden')
    } else {
      const at = timestamp()
      record.status = 'materialized'
      record.version += 1
      record.claim.materializedAt = at
      record.updatedAt = at
      result = success('materialized', publicWorkRequest(record), 200)
    }
    return finish(
      principal,
      record.projectId,
      operation,
      input,
      check,
      result,
      record.id,
    )
  }

  async function releaseWorkRequest(
    input: ReleaseWorkRequestInput,
    principal: RequestPrincipal,
  ): Promise<WorkRequestMutationResult> {
    if (!permittedBrowserAuthentication.has(principal.authentication.kind)) {
      return rejection('authentication_forbidden')
    }
    const record = findRecord(input.workRequestId, principal)
    if (!record) return rejection('not_found')
    const role = projectRole(principal, record.projectId)
    if (
      !canRelease(role) ||
      !(await options.projectExists(
        principal.session.organizationId,
        record.projectId,
      ))
    ) {
      return rejection('project_forbidden')
    }

    const operation = 'work_request_release'
    const check = inspectIdempotency(principal, record.projectId, operation, input)
    const prior = replayOrConflict(
      principal,
      record.projectId,
      operation,
      input,
      check,
      record.id,
    )
    if (prior) return prior

    let result: WorkRequestMutationResult
    if (record.version !== input.expectedVersion) {
      result = rejection('stale_version')
    } else if (record.status !== 'claim_pending' || record.claim === null) {
      result = rejection('not_claim_pending')
    } else if (
      await options.canonicalProjectionExists(
        record.claim.runId,
        record.organizationId,
        record.projectId,
      )
    ) {
      result = rejection('canonical_projection_exists')
    } else {
      const at = timestamp()
      const expired =
        record.expiresAt !== null &&
        Date.parse(record.expiresAt) <= Date.parse(at)
      record.status = expired ? 'expired' : 'open'
      record.version += 1
      record.claim = null
      record.claimedByTokenId = null
      record.updatedAt = at
      result = success('released', publicWorkRequest(record), 200)
    }
    return finish(
      principal,
      record.projectId,
      operation,
      input,
      check,
      result,
      record.id,
    )
  }

  return {
    listWorkRequests,
    createWorkRequest,
    claimWorkRequest,
    materializeWorkRequest,
    releaseWorkRequest,
    inspectForTests() {
      return {
        internalRecords: [...records.values()].map((record) => ({
          ...publicWorkRequest(record),
          claimedByTokenId: record.claimedByTokenId,
        })),
        auditEvents: auditEvents.map((event) => ({ ...event })),
        idempotencyRecordCount: idempotency.size,
      }
    },
  }
}
