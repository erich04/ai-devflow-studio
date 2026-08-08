import {
  WORK_REQUEST_ID_MAX_LENGTH,
  parseWorkRequestClaim,
  parseWorkRequestCreate,
  parseWorkRequestMaterialize,
  parseWorkRequestRecord,
  parseWorkRequestRelease,
  type WorkRequest,
} from '@ai-devflow/shared'
import { canAccessProject, canSyncProject } from '../auth/session'
import type { RequestPrincipal } from '../auth/request-auth'
import {
  workRequestRejectionMessage,
  type WorkRequestMutationResult,
  type WorkRequestRejectionCode,
  type WorkRequestRepository,
  type WorkRequestSuccessCode,
} from '../repositories/work-request-contract'

export type WorkRequestRouteResult = {
  status: number
  body: unknown
}

export type ResolveWorkRequestRouteOptions = {
  body?: unknown
  principal?: RequestPrincipal | null
}

type WorkRequestRoute =
  | { kind: 'project_collection'; identifier: string }
  | { kind: 'claim'; identifier: string }
  | { kind: 'materialized'; identifier: string }
  | { kind: 'release'; identifier: string }

const rejectionStatuses: Record<WorkRequestRejectionCode, 403 | 404 | 409 | 410> = {
  authentication_forbidden: 403,
  project_forbidden: 403,
  claimant_forbidden: 403,
  not_found: 404,
  idempotency_conflict: 409,
  stale_version: 409,
  claim_conflict: 409,
  not_claim_pending: 409,
  canonical_projection_exists: 409,
  expired: 410,
}

const rejectionErrors: Record<403 | 404 | 409 | 410, string> = {
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  410: 'gone',
}

function matchWorkRequestRoute(method: string, pathname: string): WorkRequestRoute | null {
  const projectCollection = pathname.match(
    /^\/api\/team\/projects\/([^/]+)\/work-requests$/,
  )
  if ((method === 'GET' || method === 'POST') && projectCollection) {
    return { kind: 'project_collection', identifier: projectCollection[1] ?? '' }
  }

  const claim = pathname.match(/^\/api\/desktop\/work-requests\/([^/]+)\/claim$/)
  if (method === 'POST' && claim) {
    return { kind: 'claim', identifier: claim[1] ?? '' }
  }

  const materialized = pathname.match(
    /^\/api\/desktop\/work-requests\/([^/]+)\/materialized$/,
  )
  if (method === 'POST' && materialized) {
    return { kind: 'materialized', identifier: materialized[1] ?? '' }
  }

  const release = pathname.match(/^\/api\/team\/work-requests\/([^/]+)\/release$/)
  if (method === 'POST' && release) {
    return { kind: 'release', identifier: release[1] ?? '' }
  }

  return null
}

function decodeRouteIdentifier(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    if (
      decoded.length === 0 ||
      decoded.length > WORK_REQUEST_ID_MAX_LENGTH ||
      decoded.trim() !== decoded ||
      decoded.includes('/')
    ) {
      return null
    }

    return decoded
  } catch {
    return null
  }
}

function badRequest(message: string): WorkRequestRouteResult {
  return { status: 400, body: { error: 'bad_request', message } }
}

function unauthorized(): WorkRequestRouteResult {
  return {
    status: 401,
    body: { error: 'unauthorized', message: 'Authentication required' },
  }
}

function forbidden(message: string): WorkRequestRouteResult {
  return { status: 403, body: { error: 'forbidden', message } }
}

function authenticationForbidden(): WorkRequestRouteResult {
  return forbidden(workRequestRejectionMessage('authentication_forbidden'))
}

function hasBrowserAuthentication(principal: RequestPrincipal): boolean {
  return (
    principal.authentication.kind === 'session_cookie' ||
    principal.authentication.kind === 'development_header'
  )
}

function hasPossibleLeadAuthority(principal: RequestPrincipal): boolean {
  if (principal.session.role === 'owner') {
    return true
  }

  return principal.session.projectMemberships.some(
    (membership) =>
      membership.userId === principal.session.userId &&
      (membership.role === 'lead' || membership.role === 'owner'),
  )
}

function assertRecordScope(
  workRequest: WorkRequest,
  principal: RequestPrincipal,
  expectedProjectId?: string,
  requiredRole: 'member' | 'lead' = 'member',
): void {
  const projectMatches =
    expectedProjectId === undefined || workRequest.projectId === expectedProjectId
  if (
    workRequest.organizationId !== principal.session.organizationId ||
    !projectMatches ||
    !canSyncProject(principal.session, workRequest.projectId, requiredRole)
  ) {
    throw new Error('Work Request repository returned an out-of-scope record.')
  }
}

function parseMutationResult(
  result: WorkRequestMutationResult,
  expectedOutcome: WorkRequestSuccessCode,
  principal: RequestPrincipal,
  expectedProjectId?: string,
  requiredRole: 'member' | 'lead' = 'member',
): WorkRequestRouteResult {
  if (typeof result.replayed !== 'boolean') {
    throw new Error('Invalid Work Request repository result.')
  }

  if (!result.ok) {
    const status = rejectionStatuses[result.outcomeCode]
    if (status === undefined || result.responseStatus !== status) {
      throw new Error('Invalid Work Request repository result.')
    }

    return {
      status,
      body: {
        error: rejectionErrors[status],
        message: workRequestRejectionMessage(result.outcomeCode),
        outcomeCode: result.outcomeCode,
        replayed: result.replayed,
      },
    }
  }

  const expectedStatus = expectedOutcome === 'created' ? 201 : 200
  if (result.outcomeCode !== expectedOutcome || result.responseStatus !== expectedStatus) {
    throw new Error('Invalid Work Request repository result.')
  }

  const workRequest = parseWorkRequestRecord(result.workRequest)
  assertRecordScope(
    workRequest,
    principal,
    expectedProjectId,
    requiredRole,
  )

  return {
    status: expectedStatus,
    body: {
      workRequest,
      replayed: result.replayed,
      outcomeCode: result.outcomeCode,
    },
  }
}

function parserError(error: unknown, fallback: string): WorkRequestRouteResult {
  return badRequest(error instanceof Error ? error.message : fallback)
}

export async function resolveWorkRequestRoute(
  method: string,
  pathname: string,
  repository: WorkRequestRepository,
  options: ResolveWorkRequestRouteOptions = {},
): Promise<WorkRequestRouteResult | null> {
  const route = matchWorkRequestRoute(method, pathname)
  if (!route) {
    return null
  }

  const principal = options.principal
  if (!principal) {
    return unauthorized()
  }

  const routeIdentifier = decodeRouteIdentifier(route.identifier)
  if (routeIdentifier === null) {
    return badRequest('Invalid Work Request route identifier.')
  }

  if (route.kind === 'project_collection' && method === 'GET') {
    if (!canAccessProject(principal.session, routeIdentifier)) {
      return forbidden('Project access required.')
    }

    const records = await repository.listWorkRequests(routeIdentifier, principal)
    if (!Array.isArray(records)) {
      throw new Error('Invalid Work Request repository result.')
    }

    const workRequests = records.map((record) => {
      const workRequest = parseWorkRequestRecord(record)
      assertRecordScope(workRequest, principal, routeIdentifier)
      return workRequest
    })
    return { status: 200, body: { workRequests } }
  }

  if (route.kind === 'project_collection') {
    if (!hasBrowserAuthentication(principal)) {
      return authenticationForbidden()
    }

    let input
    try {
      input = parseWorkRequestCreate(options.body)
    } catch (error) {
      return parserError(error, 'Invalid Work Request create input.')
    }
    if (input.projectId !== routeIdentifier) {
      return badRequest('Work Request projectId must match route projectId.')
    }
    if (!canAccessProject(principal.session, routeIdentifier)) {
      return forbidden('Project access required.')
    }

    return parseMutationResult(
      await repository.createWorkRequest(input, principal),
      'created',
      principal,
      routeIdentifier,
    )
  }

  if (route.kind === 'claim') {
    if (principal.authentication.kind !== 'desktop_bearer') {
      return authenticationForbidden()
    }

    let input
    try {
      input = parseWorkRequestClaim(options.body)
    } catch (error) {
      return parserError(error, 'Invalid Work Request claim input.')
    }
    if (input.workRequestId !== routeIdentifier) {
      return badRequest('Work Request workRequestId must match route id.')
    }

    return parseMutationResult(
      await repository.claimWorkRequest(input, principal),
      'claimed',
      principal,
    )
  }

  if (route.kind === 'materialized') {
    if (principal.authentication.kind !== 'desktop_bearer') {
      return authenticationForbidden()
    }

    let input
    try {
      input = parseWorkRequestMaterialize(options.body)
    } catch (error) {
      return parserError(error, 'Invalid Work Request materialize input.')
    }
    if (input.workRequestId !== routeIdentifier) {
      return badRequest('Work Request workRequestId must match route id.')
    }

    return parseMutationResult(
      await repository.materializeWorkRequest(input, principal),
      'materialized',
      principal,
    )
  }

  if (!hasBrowserAuthentication(principal)) {
    return authenticationForbidden()
  }
  if (!hasPossibleLeadAuthority(principal)) {
    return forbidden('Project role lead required.')
  }

  let input
  try {
    input = parseWorkRequestRelease(options.body)
  } catch (error) {
    return parserError(error, 'Invalid Work Request release input.')
  }
  if (input.workRequestId !== routeIdentifier) {
    return badRequest('Work Request workRequestId must match route id.')
  }

  return parseMutationResult(
    await repository.releaseWorkRequest(input, principal),
    'released',
    principal,
    undefined,
    'lead',
  )
}
