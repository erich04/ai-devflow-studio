import { createHash } from 'node:crypto'
import {
  parseGateCommandAcknowledgementRecord,
  parseGateCommandCreate,
  parseGateCommandReceiptRecord,
  parseGateCommandRecord,
  type CreateGateCommandInput,
  type CreateGateCommandAcknowledgementInput,
  type GateCommand,
  type GateCommandAcknowledgement,
  type GateCommandReceipt,
} from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'

export class GateCommandAuthoritativeStateUnavailableError extends Error {
  constructor() {
    super('Authoritative Gate Command state is unavailable.')
    this.name = 'GateCommandAuthoritativeStateUnavailableError'
  }
}

export type GateCommandRejectionCode =
  | 'authentication_forbidden'
  | 'project_forbidden'
  | 'role_forbidden'
  | 'separation_of_duties'
  | 'requester_revoked'
  | 'claimant_forbidden'
  | 'not_found'
  | 'idempotency_conflict'
  | 'active_command_conflict'
  | 'stale_run'
  | 'stale_policy'
  | 'blockers_changed'
  | 'node_not_current'
  | 'preflight_blocked'
  | 'receipt_conflict'
  | 'acknowledgement_conflict'
  | 'expired'
  | 'authoritative_state_unavailable'

export type GateCommandSuccessCode =
  | 'created'
  | 'receipt_created'
  | 'acknowledged'

export type GateCommandRejectionResult = {
  ok: false
  responseStatus: 403 | 404 | 409 | 410 | 503
  outcomeCode: GateCommandRejectionCode
  replayed: boolean
}

export type GateCommandCreateResult =
  | {
      ok: true
      responseStatus: 201
      outcomeCode: 'created'
      replayed: boolean
      command: GateCommand
    }
  | GateCommandRejectionResult

export type GateCommandReceiptResult =
  | {
      ok: true
      responseStatus: 201
      outcomeCode: 'receipt_created'
      replayed: boolean
      command: GateCommand
      receipt: GateCommandReceipt
    }
  | GateCommandRejectionResult

export type GateCommandAcknowledgementResult =
  | {
      ok: true
      responseStatus: 201
      outcomeCode: 'acknowledged'
      replayed: boolean
      command: GateCommand
      receipt: GateCommandReceipt
      acknowledgement: GateCommandAcknowledgement
    }
  | GateCommandRejectionResult

export type GateCommandRepository = {
  listGateCommands(
    projectId: string,
    principal: RequestPrincipal,
  ): Promise<GateCommand[]>
  createGateCommand(
    input: CreateGateCommandInput,
    principal: RequestPrincipal,
  ): Promise<GateCommandCreateResult>
  listGateCommandInbox(
    projectId: string,
    principal: RequestPrincipal,
  ): Promise<GateCommand[]>
  createGateCommandReceipt(
    commandId: string,
    principal: RequestPrincipal,
  ): Promise<GateCommandReceiptResult>
  acknowledgeGateCommand(
    receiptId: string,
    input: CreateGateCommandAcknowledgementInput,
    principal: RequestPrincipal,
  ): Promise<GateCommandAcknowledgementResult>
}

export function fingerprintGateCommandCreate(
  input: CreateGateCommandInput,
): string {
  const parsed = parseGateCommandCreate(input)
  return createHash('sha256')
    .update(JSON.stringify(['gate_command_create', parsed]), 'utf8')
    .digest('hex')
}

export function safeGateCommand(value: unknown): GateCommand {
  return parseGateCommandRecord(value)
}

export function safeGateCommandReceipt(value: unknown): GateCommandReceipt {
  return parseGateCommandReceiptRecord(value)
}

export function safeGateCommandAcknowledgement(
  value: unknown,
): GateCommandAcknowledgement {
  return parseGateCommandAcknowledgementRecord(value)
}

export function gateCommandRejectionMessage(
  code: GateCommandRejectionCode,
): string {
  switch (code) {
    case 'authentication_forbidden':
      return 'This authentication method cannot perform that Gate Command operation.'
    case 'project_forbidden':
    case 'claimant_forbidden':
      return 'Project access required.'
    case 'role_forbidden':
      return 'Lead or owner authority is required.'
    case 'separation_of_duties':
      return 'This Gate requires an independent approver.'
    case 'requester_revoked':
      return 'The requesting user is no longer authorized for this project.'
    case 'not_found':
      return 'Gate Command not found.'
    case 'idempotency_conflict':
      return 'Idempotency key was already used for a different request.'
    case 'active_command_conflict':
      return 'Another Gate Command is already active for this Run version.'
    case 'stale_run':
      return 'The Team Run projection changed; refresh before submitting another command.'
    case 'stale_policy':
      return 'The enforcement policy changed; refresh before submitting another command.'
    case 'blockers_changed':
      return 'The enforcement blockers changed; refresh before submitting another command.'
    case 'node_not_current':
      return 'Only the current Gate or acceptance node can receive a command.'
    case 'preflight_blocked':
      return 'Current enforcement checks do not allow this command.'
    case 'receipt_conflict':
      return 'Gate Command delivery is already leased or completed.'
    case 'acknowledgement_conflict':
      return 'The receipt already has a different terminal acknowledgement.'
    case 'expired':
      return 'Gate Command expired before the requested operation.'
    case 'authoritative_state_unavailable':
      return 'Authoritative project or policy state is temporarily unavailable.'
  }
}
