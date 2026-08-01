import {
  GATE_COMMAND_ID_MAX_LENGTH,
  parseGateCommandAcknowledgementCreate,
  parseGateCommandAcknowledgementRecord,
  parseGateCommandCreate,
  parseGateCommandReceiptRecord,
  parseGateCommandRecord,
  type GateCommand,
} from '@ai-devflow/shared'
import { canAccessProject } from '../auth/session'
import type { RequestPrincipal } from '../auth/request-auth'
import {
  GateCommandAuthoritativeStateUnavailableError,
  gateCommandRejectionMessage,
  type GateCommandAcknowledgementResult,
  type GateCommandCreateResult,
  type GateCommandReceiptResult,
  type GateCommandRejectionCode,
  type GateCommandRejectionResult,
  type GateCommandRepository,
} from '../repositories/gate-command-contract'

export type GateCommandRouteResult = {
  status: number
  body: unknown
}

export type ResolveGateCommandRouteOptions = {
  body?: unknown
  principal?: RequestPrincipal | null
}

type GateCommandRoute =
  | { kind: 'team_collection'; identifier: string }
  | { kind: 'desktop_inbox'; identifier: string }
  | { kind: 'receipt'; identifier: string }
  | { kind: 'acknowledgement'; identifier: string }

const rejectionStatuses: Record<
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

const rejectionErrors: Record<403 | 404 | 409 | 410 | 503, string> = {
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  410: 'gone',
  503: 'service_unavailable',
}

function matchGateCommandRoute(
  method: string,
  pathname: string,
): GateCommandRoute | null {
  const teamCollection = pathname.match(
    /^\/api\/team\/projects\/([^/]+)\/gate-commands$/,
  )
  if ((method === 'GET' || method === 'POST') && teamCollection) {
    return { kind: 'team_collection', identifier: teamCollection[1] ?? '' }
  }

  const inbox = pathname.match(
    /^\/api\/desktop\/projects\/([^/]+)\/gate-commands\/inbox$/,
  )
  if (method === 'GET' && inbox) {
    return { kind: 'desktop_inbox', identifier: inbox[1] ?? '' }
  }

  const receipt = pathname.match(
    /^\/api\/desktop\/gate-commands\/([^/]+)\/receipts$/,
  )
  if (method === 'POST' && receipt) {
    return { kind: 'receipt', identifier: receipt[1] ?? '' }
  }

  const acknowledgement = pathname.match(
    /^\/api\/desktop\/gate-command-receipts\/([^/]+)\/acknowledgements$/,
  )
  if (method === 'POST' && acknowledgement) {
    return { kind: 'acknowledgement', identifier: acknowledgement[1] ?? '' }
  }

  return null
}

function decodeRouteIdentifier(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    if (
      decoded.length === 0 ||
      decoded.length > GATE_COMMAND_ID_MAX_LENGTH ||
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

function badRequest(message: string): GateCommandRouteResult {
  return { status: 400, body: { error: 'bad_request', message } }
}

function unauthorized(): GateCommandRouteResult {
  return {
    status: 401,
    body: { error: 'unauthorized', message: 'Authentication required' },
  }
}

function authenticationForbidden(): GateCommandRouteResult {
  return rejectionResult({
    ok: false,
    responseStatus: 403,
    outcomeCode: 'authentication_forbidden',
    replayed: false,
  })
}

async function readAuthoritativeGateList<T>(
  read: () => Promise<T>,
): Promise<T | GateCommandRouteResult> {
  try {
    return await read()
  } catch (error) {
    if (error instanceof GateCommandAuthoritativeStateUnavailableError) {
      return rejectionResult({
        ok: false,
        responseStatus: 503,
        outcomeCode: 'authoritative_state_unavailable',
        replayed: false,
      })
    }
    throw error
  }
}

function isGateCommandRouteResult(
  value: unknown,
): value is GateCommandRouteResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { status?: unknown }).status === 'number' &&
    Object.prototype.hasOwnProperty.call(value, 'body')
  )
}

function hasExactDesktopProject(
  principal: RequestPrincipal,
  projectId: string,
): boolean {
  return principal.session.projectMemberships.some(
    (membership) =>
      membership.projectId === projectId &&
      membership.userId === principal.session.userId,
  )
}

function rejectionResult(
  result: GateCommandRejectionResult,
): GateCommandRouteResult {
  const status = rejectionStatuses[result.outcomeCode]
  if (status === undefined || result.responseStatus !== status) {
    throw new Error('Invalid Gate Command repository result.')
  }
  return {
    status,
    body: {
      error: rejectionErrors[status],
      message: gateCommandRejectionMessage(result.outcomeCode),
      outcomeCode: result.outcomeCode,
      replayed: result.replayed,
    },
  }
}

function assertCommandScope(
  command: GateCommand,
  principal: RequestPrincipal,
  expectedProjectId?: string,
): void {
  const hasProject =
    principal.authentication.kind === 'desktop_bearer'
      ? hasExactDesktopProject(principal, command.projectId)
      : canAccessProject(principal.session, command.projectId)
  if (
    command.organizationId !== principal.session.organizationId ||
    (expectedProjectId !== undefined && command.projectId !== expectedProjectId) ||
    !hasProject
  ) {
    throw new Error('Gate Command repository returned an out-of-scope Gate Command.')
  }
}

function parseCreateResult(
  result: GateCommandCreateResult,
  principal: RequestPrincipal,
  projectId: string,
): GateCommandRouteResult {
  if (!result.ok) return rejectionResult(result)
  if (
    result.responseStatus !== 201 ||
    result.outcomeCode !== 'created' ||
    typeof result.replayed !== 'boolean'
  ) {
    throw new Error('Invalid Gate Command repository result.')
  }
  const command = parseGateCommandRecord(result.command)
  assertCommandScope(command, principal, projectId)
  return {
    status: 201,
    body: {
      command,
      outcomeCode: result.outcomeCode,
      replayed: result.replayed,
    },
  }
}

function parseReceiptResult(
  result: GateCommandReceiptResult,
  principal: RequestPrincipal,
  commandId: string,
): GateCommandRouteResult {
  if (!result.ok) return rejectionResult(result)
  if (
    result.responseStatus !== 201 ||
    result.outcomeCode !== 'receipt_created' ||
    typeof result.replayed !== 'boolean'
  ) {
    throw new Error('Invalid Gate Command repository result.')
  }
  const command = parseGateCommandRecord(result.command)
  const receipt = parseGateCommandReceiptRecord(result.receipt)
  assertCommandScope(command, principal)
  if (
    command.id !== commandId ||
    receipt.commandId !== command.id ||
    command.workRequestId === null ||
    (command.status !== 'pending' && command.status !== 'delivering')
  ) {
    throw new Error('Invalid Gate Command repository result.')
  }
  return {
    status: 201,
    body: {
      command,
      receipt,
      outcomeCode: result.outcomeCode,
      replayed: result.replayed,
    },
  }
}

function parseAcknowledgementResult(
  result: GateCommandAcknowledgementResult,
  principal: RequestPrincipal,
  receiptId: string,
): GateCommandRouteResult {
  if (!result.ok) return rejectionResult(result)
  if (
    result.responseStatus !== 201 ||
    result.outcomeCode !== 'acknowledged' ||
    typeof result.replayed !== 'boolean'
  ) {
    throw new Error('Invalid Gate Command repository result.')
  }
  const command = parseGateCommandRecord(result.command)
  const receipt = parseGateCommandReceiptRecord(result.receipt)
  const acknowledgement = parseGateCommandAcknowledgementRecord(
    result.acknowledgement,
  )
  assertCommandScope(command, principal)
  if (
    receipt.id !== receiptId ||
    receipt.commandId !== command.id ||
    receipt.acknowledgedAt === null ||
    acknowledgement.receiptId !== receipt.id ||
    acknowledgement.commandId !== command.id ||
    acknowledgement.outcomeCode !== command.outcomeCode ||
    (command.status !== 'applied' &&
      command.status !== 'rejected' &&
      command.status !== 'expired')
  ) {
    throw new Error('Invalid Gate Command repository result.')
  }
  return {
    status: 201,
    body: {
      command,
      receipt,
      acknowledgement,
      outcomeCode: result.outcomeCode,
      replayed: result.replayed,
    },
  }
}

function isEmptyBody(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0)
  )
}

export async function resolveGateCommandRoute(
  method: string,
  pathname: string,
  repository: GateCommandRepository,
  options: ResolveGateCommandRouteOptions = {},
): Promise<GateCommandRouteResult | null> {
  const route = matchGateCommandRoute(method, pathname)
  if (!route) return null

  const principal = options.principal
  if (!principal) return unauthorized()
  const identifier = decodeRouteIdentifier(route.identifier)
  if (identifier === null) {
    return badRequest('Invalid Gate Command route identifier.')
  }

  if (route.kind === 'team_collection') {
    if (principal.authentication.kind !== 'session_cookie') {
      return authenticationForbidden()
    }
    if (!canAccessProject(principal.session, identifier)) {
      return rejectionResult({
        ok: false,
        responseStatus: 403,
        outcomeCode: 'project_forbidden',
        replayed: false,
      })
    }
    if (method === 'GET') {
      const records = await readAuthoritativeGateList(() =>
        repository.listGateCommands(identifier, principal),
      )
      if (isGateCommandRouteResult(records)) return records
      if (!Array.isArray(records)) {
        throw new Error('Invalid Gate Command repository result.')
      }
      const commands = records.map((record) => {
        const command = parseGateCommandRecord(record)
        assertCommandScope(command, principal, identifier)
        return command
      })
      return { status: 200, body: { commands } }
    }

    let input
    try {
      input = parseGateCommandCreate(options.body)
    } catch (error) {
      return badRequest(
        error instanceof Error
          ? error.message
          : 'Invalid Gate Command create input.',
      )
    }
    if (input.projectId !== identifier) {
      return badRequest('Gate Command projectId must match route projectId.')
    }
    return parseCreateResult(
      await repository.createGateCommand(input, principal),
      principal,
      identifier,
    )
  }

  if (principal.authentication.kind !== 'desktop_bearer') {
    return authenticationForbidden()
  }

  if (route.kind === 'desktop_inbox') {
    if (!hasExactDesktopProject(principal, identifier)) {
      return rejectionResult({
        ok: false,
        responseStatus: 403,
        outcomeCode: 'project_forbidden',
        replayed: false,
      })
    }
    const records = await readAuthoritativeGateList(() =>
      repository.listGateCommandInbox(identifier, principal),
    )
    if (isGateCommandRouteResult(records)) return records
    if (!Array.isArray(records)) {
      throw new Error('Invalid Gate Command repository result.')
    }
    const commands = records.map((record) => {
      const command = parseGateCommandRecord(record)
      assertCommandScope(command, principal, identifier)
      if (
        command.workRequestId === null ||
        (command.status !== 'pending' && command.status !== 'delivering')
      ) {
        throw new Error('Invalid Gate Command repository result.')
      }
      return command
    })
    return { status: 200, body: { commands } }
  }

  if (route.kind === 'receipt') {
    if (!isEmptyBody(options.body)) {
      return badRequest('Gate Command receipt input must be empty.')
    }
    return parseReceiptResult(
      await repository.createGateCommandReceipt(identifier, principal),
      principal,
      identifier,
    )
  }

  let input
  try {
    input = parseGateCommandAcknowledgementCreate(options.body)
  } catch (error) {
    return badRequest(
      error instanceof Error
        ? error.message
        : 'Invalid Gate Command acknowledgement create input.',
    )
  }
  return parseAcknowledgementResult(
    await repository.acknowledgeGateCommand(identifier, input, principal),
    principal,
    identifier,
  )
}
