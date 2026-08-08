import { randomUUID } from 'node:crypto'
import {
  GATE_COMMAND_MAX_TTL_MS,
  GATE_COMMAND_RECEIPT_MAX_LEASE_MS,
  parseGateCommandAcknowledgementCreate,
  type CreateGateCommandAcknowledgementInput,
  type CreateGateCommandInput,
  type GateCommand,
  type GateCommandAcknowledgement,
  type GateCommandReceipt,
  type GateCommandWorkflowCommand,
  type Role,
} from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'
import type {
  MaterializedWorkRequestClaim,
  MaterializedWorkRequestClaimLookup,
} from './work-request-contract'
import {
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

type MaybePromise<T> = T | Promise<T>

export type GateCommandPreflightResult =
  | {
      ok: true
      requestedRole: Role
      workflowCommand: GateCommandWorkflowCommand | null
      evaluationBlockerIds: string[]
    }
  | {
      ok: false
      outcomeCode: GateCommandRejectionCode
    }

export type SeedGateCommandRepositoryOptions = {
  resolveMaterializedWorkRequestClaim(
    input: MaterializedWorkRequestClaimLookup,
  ): MaybePromise<MaterializedWorkRequestClaim | null>
  evaluatePreflight(
    input: CreateGateCommandInput,
    principal: RequestPrincipal,
  ): MaybePromise<GateCommandPreflightResult>
  requesterStillAuthorized(command: GateCommand): MaybePromise<boolean>
  now?: () => Date | string
  id?: (kind: 'gate-command' | 'gate-receipt' | 'gate-ack') => string
}

type InternalReceipt = GateCommandReceipt & {
  leasedToTokenId: string
}

type StoredCreateResult = {
  fingerprint: string
  result: GateCommandCreateResult
}

export type SeedGateCommandRepository = GateCommandRepository & {
  inspectForTests(): {
    commands: GateCommand[]
    receipts: InternalReceipt[]
    acknowledgements: GateCommandAcknowledgement[]
    idempotencyRecordCount: number
  }
}

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

function rejection(
  outcomeCode: GateCommandRejectionCode,
): GateCommandRejectionResult {
  return {
    ok: false,
    responseStatus: rejectionStatuses[outcomeCode],
    outcomeCode,
    replayed: false,
  }
}

function cloneCommand(command: GateCommand): GateCommand {
  return safeGateCommand({
    ...command,
    expectedBlockerIds: [...command.expectedBlockerIds],
    evaluationBlockerIds: [...command.evaluationBlockerIds],
  })
}

function cloneReceipt(receipt: InternalReceipt): GateCommandReceipt {
  return safeGateCommandReceipt({
    id: receipt.id,
    commandId: receipt.commandId,
    attempt: receipt.attempt,
    leasedAt: receipt.leasedAt,
    leaseExpiresAt: receipt.leaseExpiresAt,
    acknowledgedAt: receipt.acknowledgedAt,
  })
}

function cloneAcknowledgement(
  acknowledgement: GateCommandAcknowledgement,
): GateCommandAcknowledgement {
  return safeGateCommandAcknowledgement({ ...acknowledgement })
}

function cloneCreateResult(
  result: GateCommandCreateResult,
  replayed = result.replayed,
): GateCommandCreateResult {
  return result.ok
    ? { ...result, replayed, command: cloneCommand(result.command) }
    : { ...result, replayed }
}

function projectRole(
  principal: RequestPrincipal,
  projectId: string,
): Role | null {
  if (
    principal.authentication.kind !== 'desktop_bearer' &&
    principal.session.role === 'owner'
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

function hasProjectAccess(
  principal: RequestPrincipal,
  projectId: string,
): boolean {
  return projectRole(principal, projectId) !== null
}

function sameAcknowledgementInput(
  acknowledgement: GateCommandAcknowledgement,
  receiptId: string,
  input: CreateGateCommandAcknowledgementInput,
): boolean {
  return (
    acknowledgement.receiptId === receiptId &&
    acknowledgement.commandId === input.commandId &&
    acknowledgement.outcomeCode === input.outcomeCode &&
    acknowledgement.beforeRunVersion === input.beforeRunVersion &&
    acknowledgement.afterRunVersion === input.afterRunVersion &&
    acknowledgement.evaluatedAt === input.evaluatedAt
  )
}

export function createSeedGateCommandRepository(
  options: SeedGateCommandRepositoryOptions,
): SeedGateCommandRepository {
  const commands = new Map<string, GateCommand>()
  const receipts = new Map<string, InternalReceipt>()
  const acknowledgements = new Map<string, GateCommandAcknowledgement>()
  const createIdempotency = new Map<string, StoredCreateResult>()
  const now = options.now ?? (() => new Date())
  const nextId =
    options.id ??
    ((kind: 'gate-command' | 'gate-receipt' | 'gate-ack') =>
      `${kind}-${randomUUID()}`)

  function timestamp(): string {
    const value = now()
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isFinite(date.valueOf())) {
      throw new Error('Seed Gate Command clock returned an invalid date.')
    }
    return date.toISOString()
  }

  function findCommand(
    commandId: string,
    principal: RequestPrincipal,
  ): GateCommand | null {
    const command = commands.get(commandId)
    return command?.organizationId === principal.session.organizationId
      ? command
      : null
  }

  function idempotencyScope(
    input: CreateGateCommandInput,
    principal: RequestPrincipal,
  ): string {
    return JSON.stringify([
      principal.session.organizationId,
      input.projectId,
      principal.session.userId,
      'gate_command_create',
      input.idempotencyKey,
    ])
  }

  function activeTupleConflict(
    input: CreateGateCommandInput,
    principal: RequestPrincipal,
  ): boolean {
    return [...commands.values()].some(
      (command) =>
        command.organizationId === principal.session.organizationId &&
        command.projectId === input.projectId &&
        command.runId === input.runId &&
        command.nodeId === input.nodeId &&
        command.expectedRunVersion === input.expectedRunVersion &&
        (command.status === 'pending' || command.status === 'delivering'),
    )
  }

  function mutateTerminal(
    command: GateCommand,
    status: 'applied' | 'rejected' | 'expired',
    outcomeCode: NonNullable<GateCommand['outcomeCode']>,
    at: string,
  ): void {
    command.version += 1
    command.status = status
    command.outcomeCode = outcomeCode
    command.updatedAt = at
  }

  async function expireOrRevoke(command: GateCommand, at: string): Promise<void> {
    if (command.status === 'applied' || command.status === 'rejected' || command.status === 'expired') {
      return
    }
    if (Date.parse(at) >= Date.parse(command.expiresAt)) {
      mutateTerminal(command, 'expired', 'expired', at)
      return
    }
    if (!(await options.requesterStillAuthorized(cloneCommand(command)))) {
      mutateTerminal(command, 'rejected', 'requester_revoked', at)
    }
  }

  async function resolveClaim(command: GateCommand) {
    return options.resolveMaterializedWorkRequestClaim({
      organizationId: command.organizationId,
      projectId: command.projectId,
      runId: command.runId,
    })
  }

  async function claimantOwnsCommand(
    command: GateCommand,
    principal: RequestPrincipal,
  ): Promise<boolean> {
    if (
      principal.authentication.kind !== 'desktop_bearer' ||
      !principal.authentication.tokenRecordId ||
      !hasProjectAccess(principal, command.projectId)
    ) {
      return false
    }
    const claim = await resolveClaim(command)
    return Boolean(
      claim &&
        claim.workRequestId === command.workRequestId &&
        claim.claimedByTokenId === principal.authentication.tokenRecordId,
    )
  }

  async function listGateCommands(
    projectId: string,
    principal: RequestPrincipal,
  ): Promise<GateCommand[]> {
    if (
      principal.authentication.kind !== 'session_cookie' ||
      !hasProjectAccess(principal, projectId)
    ) {
      return []
    }
    const at = timestamp()
    const scoped = [...commands.values()].filter(
      (command) =>
        command.organizationId === principal.session.organizationId &&
        command.projectId === projectId,
    )
    for (const command of scoped) await expireOrRevoke(command, at)
    return scoped
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(cloneCommand)
  }

  async function createGateCommand(
    input: CreateGateCommandInput,
    principal: RequestPrincipal,
  ): Promise<GateCommandCreateResult> {
    if (principal.authentication.kind !== 'session_cookie') {
      return rejection('authentication_forbidden')
    }

    const scope = idempotencyScope(input, principal)
    const fingerprint = fingerprintGateCommandCreate(input)
    const stored = createIdempotency.get(scope)
    if (stored) {
      return stored.fingerprint === fingerprint
        ? cloneCreateResult(stored.result, true)
        : rejection('idempotency_conflict')
    }

    async function finish(
      result: GateCommandCreateResult,
    ): Promise<GateCommandCreateResult> {
      createIdempotency.set(scope, {
        fingerprint,
        result: cloneCreateResult(result, false),
      })
      return cloneCreateResult(result)
    }

    const claim = await options.resolveMaterializedWorkRequestClaim({
      organizationId: principal.session.organizationId,
      projectId: input.projectId,
      runId: input.runId,
    })
    if (!claim) return finish(rejection('not_found'))

    const preflight = await options.evaluatePreflight(input, principal)
    if (!preflight.ok) {
      const denied = rejection(preflight.outcomeCode)
      return preflight.outcomeCode === 'authoritative_state_unavailable'
        ? denied
        : finish(denied)
    }
    const at = timestamp()
    const matchingActiveCommands = [...commands.values()].filter(
      (command) =>
        command.organizationId === principal.session.organizationId &&
        command.projectId === input.projectId &&
        command.runId === input.runId &&
        command.nodeId === input.nodeId &&
        command.expectedRunVersion === input.expectedRunVersion &&
        (command.status === 'pending' || command.status === 'delivering'),
    )
    for (const command of matchingActiveCommands) {
      await expireOrRevoke(command, at)
    }
    if (activeTupleConflict(input, principal)) {
      return finish(rejection('active_command_conflict'))
    }

    const command = safeGateCommand({
      id: nextId('gate-command'),
      version: 1,
      organizationId: principal.session.organizationId,
      projectId: input.projectId,
      workRequestId: claim.workRequestId,
      runId: input.runId,
      nodeId: input.nodeId,
      action: input.action,
      workflowCommand: preflight.workflowCommand,
      reason: input.reason,
      requestedByUserId: principal.session.userId,
      requestedRole: preflight.requestedRole,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
      expectedRunVersion: input.expectedRunVersion,
      expectedPolicyVersion: input.expectedPolicyVersion,
      expectedBlockerIds: [...input.expectedBlockerIds],
      evaluationStatus: 'allowed',
      evaluationBlockerIds: [...preflight.evaluationBlockerIds],
      evaluatedAt: at,
      status: 'pending',
      outcomeCode: null,
      expiresAt: new Date(Date.parse(at) + GATE_COMMAND_MAX_TTL_MS).toISOString(),
      createdAt: at,
      updatedAt: at,
    })
    commands.set(command.id, command)
    return finish({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'created',
      replayed: false,
      command,
    })
  }

  async function listGateCommandInbox(
    projectId: string,
    principal: RequestPrincipal,
  ): Promise<GateCommand[]> {
    if (
      principal.authentication.kind !== 'desktop_bearer' ||
      !hasProjectAccess(principal, projectId)
    ) {
      return []
    }
    const at = timestamp()
    const deliverable: GateCommand[] = []
    for (const command of commands.values()) {
      if (
        command.organizationId !== principal.session.organizationId ||
        command.projectId !== projectId ||
        (command.status !== 'pending' && command.status !== 'delivering')
      ) {
        continue
      }
      await expireOrRevoke(command, at)
      if (
        (command.status === 'pending' || command.status === 'delivering') &&
        (await claimantOwnsCommand(command, principal))
      ) {
        deliverable.push(cloneCommand(command))
      }
    }
    return deliverable.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async function createGateCommandReceipt(
    commandId: string,
    principal: RequestPrincipal,
  ): Promise<GateCommandReceiptResult> {
    if (principal.authentication.kind !== 'desktop_bearer') {
      return rejection('authentication_forbidden')
    }
    const command = findCommand(commandId, principal)
    if (!command) return rejection('not_found')
    if (!(await claimantOwnsCommand(command, principal))) {
      return rejection('claimant_forbidden')
    }

    const at = timestamp()
    await expireOrRevoke(command, at)
    if (command.status === 'expired') return rejection('expired')
    if (command.status === 'applied' || command.status === 'rejected') {
      return rejection('receipt_conflict')
    }

    const commandReceipts = [...receipts.values()]
      .filter((receipt) => receipt.commandId === command.id)
      .sort((left, right) => right.attempt - left.attempt)
    const current = commandReceipts[0]
    if (
      current &&
      current.acknowledgedAt === null &&
      current.leasedToTokenId === principal.authentication.tokenRecordId &&
      Date.parse(current.leaseExpiresAt) > Date.parse(at)
    ) {
      return {
        ok: true,
        responseStatus: 201,
        outcomeCode: 'receipt_created',
        replayed: true,
        command: cloneCommand(command),
        receipt: cloneReceipt(current),
      }
    }

    const leaseExpiresAt = new Date(
      Math.min(
        Date.parse(at) + GATE_COMMAND_RECEIPT_MAX_LEASE_MS,
        Date.parse(command.expiresAt),
      ),
    ).toISOString()
    const receipt: InternalReceipt = {
      id: nextId('gate-receipt'),
      commandId: command.id,
      attempt: (current?.attempt ?? 0) + 1,
      leasedToTokenId: principal.authentication.tokenRecordId,
      leasedAt: at,
      leaseExpiresAt,
      acknowledgedAt: null,
    }
    cloneReceipt(receipt)
    receipts.set(receipt.id, receipt)
    if (command.status === 'pending') {
      command.version += 1
      command.status = 'delivering'
      command.updatedAt = at
    }
    return {
      ok: true,
      responseStatus: 201,
      outcomeCode: 'receipt_created',
      replayed: false,
      command: cloneCommand(command),
      receipt: cloneReceipt(receipt),
    }
  }

  async function acknowledgeGateCommand(
    receiptId: string,
    rawInput: CreateGateCommandAcknowledgementInput,
    principal: RequestPrincipal,
  ): Promise<GateCommandAcknowledgementResult> {
    if (principal.authentication.kind !== 'desktop_bearer') {
      return rejection('authentication_forbidden')
    }
    const input = parseGateCommandAcknowledgementCreate(rawInput)
    const receipt = receipts.get(receiptId)
    const command = receipt ? findCommand(receipt.commandId, principal) : null
    if (!receipt || !command) return rejection('not_found')
    if (
      input.commandId !== command.id ||
      receipt.leasedToTokenId !== principal.authentication.tokenRecordId ||
      !(await claimantOwnsCommand(command, principal))
    ) {
      return rejection('claimant_forbidden')
    }

    const existing = [...acknowledgements.values()].find(
      (candidate) => candidate.commandId === command.id,
    )
    if (existing) {
      if (!sameAcknowledgementInput(existing, receiptId, input)) {
        return rejection('acknowledgement_conflict')
      }
      return {
        ok: true,
        responseStatus: 201,
        outcomeCode: 'acknowledged',
        replayed: true,
        command: cloneCommand(command),
        receipt: cloneReceipt(receipt),
        acknowledgement: cloneAcknowledgement(existing),
      }
    }

    const evaluatedAt = Date.parse(input.evaluatedAt)
    const commandExpiry = Date.parse(command.expiresAt)
    const leaseStart = Date.parse(receipt.leasedAt)
    const leaseExpiry = Date.parse(receipt.leaseExpiresAt)
    const at = timestamp()
    const serverNow = Date.parse(at)
    const maximumFutureEvaluation =
      serverNow +
      Math.min(
        GATE_COMMAND_RECEIPT_MAX_LEASE_MS,
        Math.max(0, leaseExpiry - leaseStart),
      )
    const runVersionsMatch =
      input.outcomeCode === 'stale_run'
        ? input.beforeRunVersion !== command.expectedRunVersion
        : input.beforeRunVersion === command.expectedRunVersion
    if (
      evaluatedAt < leaseStart ||
      (input.outcomeCode === 'expired'
        ? serverNow < evaluatedAt
        : maximumFutureEvaluation < evaluatedAt) ||
      !runVersionsMatch ||
      (input.outcomeCode === 'expired'
        ? evaluatedAt < commandExpiry
        : evaluatedAt >= commandExpiry || evaluatedAt >= leaseExpiry) ||
      (input.outcomeCode === 'applied' && command.action !== 'approve') ||
      (input.outcomeCode === 'human_rejected' && command.action !== 'reject')
    ) {
      return rejection('acknowledgement_conflict')
    }

    const acknowledgement = safeGateCommandAcknowledgement({
      id: nextId('gate-ack'),
      commandId: command.id,
      receiptId: receipt.id,
      outcomeCode: input.outcomeCode,
      beforeRunVersion: input.beforeRunVersion,
      afterRunVersion: input.afterRunVersion,
      evaluatedAt: input.evaluatedAt,
      createdAt: at,
    })
    acknowledgements.set(acknowledgement.id, acknowledgement)
    receipt.acknowledgedAt = at
    const terminalStatus =
      input.outcomeCode === 'applied' || input.outcomeCode === 'human_rejected'
        ? 'applied'
        : input.outcomeCode === 'expired'
          ? 'expired'
          : 'rejected'
    mutateTerminal(command, terminalStatus, input.outcomeCode, at)
    return {
      ok: true,
      responseStatus: 201,
      outcomeCode: 'acknowledged',
      replayed: false,
      command: cloneCommand(command),
      receipt: cloneReceipt(receipt),
      acknowledgement,
    }
  }

  return {
    listGateCommands,
    createGateCommand,
    listGateCommandInbox,
    createGateCommandReceipt,
    acknowledgeGateCommand,
    inspectForTests() {
      return {
        commands: [...commands.values()].map(cloneCommand),
        receipts: [...receipts.values()].map((receipt) => ({ ...receipt })),
        acknowledgements: [...acknowledgements.values()].map(
          cloneAcknowledgement,
        ),
        idempotencyRecordCount: createIdempotency.size,
      }
    },
  }
}
