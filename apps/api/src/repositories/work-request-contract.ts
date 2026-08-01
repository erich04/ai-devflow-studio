import { createHash } from 'node:crypto'
import {
  parseWorkRequestRecord,
  type ClaimWorkRequestInput,
  type CreateWorkRequestInput,
  type MaterializeWorkRequestInput,
  type ReleaseWorkRequestInput,
  type WorkRequest,
} from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'

export type WorkRequestOperationKind =
  | 'work_request_create'
  | 'work_request_claim'
  | 'work_request_materialize'
  | 'work_request_release'

export type WorkRequestSuccessCode =
  | 'created'
  | 'claimed'
  | 'materialized'
  | 'released'

export type WorkRequestRejectionCode =
  | 'authentication_forbidden'
  | 'project_forbidden'
  | 'not_found'
  | 'idempotency_conflict'
  | 'stale_version'
  | 'claim_conflict'
  | 'claimant_forbidden'
  | 'not_claim_pending'
  | 'canonical_projection_exists'
  | 'expired'

export type WorkRequestMutationResult =
  | {
      ok: true
      responseStatus: 200 | 201
      outcomeCode: WorkRequestSuccessCode
      replayed: boolean
      workRequest: WorkRequest
    }
  | {
      ok: false
      responseStatus: 403 | 404 | 409 | 410
      outcomeCode: WorkRequestRejectionCode
      replayed: boolean
    }

export type WorkRequestRepository = {
  listWorkRequests(
    projectId: string,
    principal: RequestPrincipal,
  ): Promise<WorkRequest[]>
  createWorkRequest(
    input: CreateWorkRequestInput,
    principal: RequestPrincipal,
  ): Promise<WorkRequestMutationResult>
  claimWorkRequest(
    input: ClaimWorkRequestInput,
    principal: RequestPrincipal,
  ): Promise<WorkRequestMutationResult>
  materializeWorkRequest(
    input: MaterializeWorkRequestInput,
    principal: RequestPrincipal,
  ): Promise<WorkRequestMutationResult>
  releaseWorkRequest(
    input: ReleaseWorkRequestInput,
    principal: RequestPrincipal,
  ): Promise<WorkRequestMutationResult>
}

export type WorkRequestOperationInput =
  | CreateWorkRequestInput
  | ClaimWorkRequestInput
  | MaterializeWorkRequestInput
  | ReleaseWorkRequestInput

export function fingerprintWorkRequestOperation(
  operation: WorkRequestOperationKind,
  input: WorkRequestOperationInput,
): string {
  return createHash('sha256')
    .update(JSON.stringify([operation, input]), 'utf8')
    .digest('hex')
}

export function safeWorkRequest(value: unknown): WorkRequest {
  return parseWorkRequestRecord(value)
}

export function workRequestRejectionMessage(
  code: WorkRequestRejectionCode,
): string {
  switch (code) {
    case 'authentication_forbidden':
      return 'This authentication method cannot perform that Work Request operation.'
    case 'project_forbidden':
    case 'claimant_forbidden':
      return 'Project access required.'
    case 'not_found':
      return 'Work Request not found.'
    case 'expired':
      return 'Work Request expired before it could be claimed.'
    case 'canonical_projection_exists':
      return 'The pending claim cannot be released after canonical execution was observed.'
    case 'not_claim_pending':
      return 'Work Request is not awaiting local materialization.'
    case 'idempotency_conflict':
      return 'Idempotency key was already used for a different request.'
    case 'stale_version':
      return 'Work Request version is stale.'
    case 'claim_conflict':
      return 'Work Request is already bound to another claim.'
  }
}
