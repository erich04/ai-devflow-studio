import { createHash } from 'node:crypto'
import {
  CODING_EXECUTOR_CONTRACT_VERSION,
  parseCodingExecutorDescriptor,
  parseCodingExecutorTurn,
  type CodingExecutorDescriptor,
  type CodingExecutorPermissionTurn,
  type CodingExecutorRequest,
  type CodingExecutorTerminalTurn,
  type TestEvidence,
  type AgentProviderUsage,
} from '@ai-devflow/shared'
import type {
  CodingEngineAdapter,
  CodingEngineApprovePermissionCompletedResult,
  CodingEngineApprovePermissionContinuedResult,
  CodingEngineApprovePermissionInput,
  CodingEngineCancelInput,
  CodingEngineEnsureInput,
  CodingEngineEnsureResult,
  CodingEngineStartInput,
} from './coding-engine.js'

export type CodingExecutorWaitingPermissionResult =
  CodingEngineApprovePermissionContinuedResult & {
    kind: 'waiting_permission'
    turn: CodingExecutorPermissionTurn
  }

export type CodingExecutorCompletedResult =
  CodingEngineApprovePermissionCompletedResult & {
    kind: 'engine_completed'
    turn?: CodingExecutorTerminalTurn
    testEvidence?: TestEvidence
  }

export type CodingExecutorStartResult =
  | CodingExecutorWaitingPermissionResult
  | CodingExecutorCompletedResult

export type CodingExecutorStartInput = {
  request: CodingExecutorRequest
  runtimeContext: CodingEngineStartInput
}

export type CodingExecutorContinuePermissionInput = {
  requestId: string
  previousCheckpointVersion: number
  previousSequence: number
  settledPermissionRequestIds: string[]
  runtimeContext: CodingEngineApprovePermissionInput
}

export type CodingExecutor = {
  descriptor: CodingExecutorDescriptor
  engine: CodingEngineAdapter['engine']
  providerId: string
  modelId?: string
  billingProvider?: AgentProviderUsage['billingProvider']
  billing?: 'no_cost' | 'metered' | 'opaque' | 'subscription'
  ensure(input: CodingEngineEnsureInput): Promise<CodingEngineEnsureResult>
  start(input: CodingExecutorStartInput): Promise<CodingExecutorStartResult>
  continuePermission(
    input: CodingExecutorContinuePermissionInput,
  ): Promise<CodingExecutorStartResult>
  cancel(input: CodingEngineCancelInput): Promise<void>
}

function descriptorFor(engine: CodingEngineAdapter): CodingExecutorDescriptor {
  const configured = engine.engine !== 'not-configured'
  return parseCodingExecutorDescriptor({
    stateVersion: 1,
    id:
      engine.engine === 'fake'
        ? 'coding-executor-native-fixture'
        : engine.engine === 'not-configured'
          ? 'coding-executor-opencode-unconfigured'
          : `coding-executor-${engine.engine}`,
    version: 1,
    kind: engine.engine === 'fake' ? 'native' : 'opencode',
    availability: configured
      ? { status: 'available', reasonCode: null }
      : { status: 'unavailable', reasonCode: 'not_configured' },
    capabilities: configured
      ? [
          'approved_command',
          'cancellation',
          'permission_relay',
          'structured_diff',
          'workspace_edit',
          'workspace_read',
        ]
      : [],
  })
}

function permissionCapability(
  permission: CodingEngineApprovePermissionContinuedResult['permissionRequest']['permission'],
): 'approved_command' | 'workspace_edit' {
  return permission === 'edit' || permission === 'write' || permission === 'patch'
    ? 'workspace_edit'
    : 'approved_command'
}

function permissionTurn(input: {
  descriptor: CodingExecutorDescriptor
  requestId: string
  startedAt?: string
  previousCheckpointVersion: number
  previousSequence: number
  settledPermissionRequestIds: string[]
  result: CodingEngineApprovePermissionContinuedResult
}): CodingExecutorPermissionTurn {
  const permissionRequest = input.result.permissionRequest
  const requestDigest = createHash('sha256')
    .update(
      JSON.stringify({
        id: permissionRequest.id,
        permission: permissionRequest.permission,
        risk: permissionRequest.risk,
        requestedAt: permissionRequest.requestedAt,
        expiresAt: permissionRequest.expiresAt,
      }),
      'utf8',
    )
    .digest('hex')
  const startedAt = input.startedAt && input.startedAt <= permissionRequest.requestedAt
    ? input.startedAt
    : permissionRequest.requestedAt
  const checkpointVersion = input.previousCheckpointVersion + 1
  const events = [
    ...(input.previousSequence === 0
      ? [
          {
            stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
            requestId: input.requestId,
            sequence: 1,
            checkpointVersion: 0,
            type: 'started' as const,
            createdAt: startedAt,
            metadata: {
              executorId: input.descriptor.id,
              executorVersion: input.descriptor.version,
            },
          },
        ]
      : []),
    {
      stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
      requestId: input.requestId,
      sequence: input.previousSequence + (input.previousSequence === 0 ? 2 : 1),
      checkpointVersion,
      type: 'permission_request' as const,
      createdAt: permissionRequest.requestedAt,
      metadata: { permissionRequestId: permissionRequest.id },
    },
  ]
  const turn = parseCodingExecutorTurn(
    {
      stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
      requestId: input.requestId,
      status: 'waiting_permission',
      checkpointVersion,
      events,
      permissionRequest: {
        stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
        requestId: input.requestId,
        id: permissionRequest.id,
        capability: permissionCapability(permissionRequest.permission),
        requestDigest,
        requestedAt: permissionRequest.requestedAt,
        expiresAt: permissionRequest.expiresAt,
      },
    },
    {
      expectedRequestId: input.requestId,
      previousCheckpointVersion: input.previousCheckpointVersion,
      previousSequence: input.previousSequence,
      settledPermissionRequestIds: input.settledPermissionRequestIds,
    },
  )
  if (turn.status !== 'waiting_permission') {
    throw new Error('Coding Executor permission mapping did not produce a permission turn.')
  }
  return turn
}

export function createCodingExecutorCompatibilityAdapter(
  engine: CodingEngineAdapter,
): CodingExecutor {
  const descriptor = descriptorFor(engine)
  return {
    descriptor,
    engine: engine.engine,
    providerId: engine.providerId,
    billing:
      engine.engine === 'fake'
        ? 'no_cost'
        : engine.engine === 'opencode-http'
          ? 'opaque'
          : 'metered',
    ...(engine.modelId ? { modelId: engine.modelId } : {}),
    ensure: (input) => engine.ensure(input),
    async start(input) {
      const result = await engine.start(input.runtimeContext)
      return 'permissionRequest' in result
        ? {
            kind: 'waiting_permission',
            ...result,
            turn: permissionTurn({
              descriptor,
              requestId: input.request.id,
              startedAt: input.request.requestedAt,
              previousCheckpointVersion: 0,
              previousSequence: 0,
              settledPermissionRequestIds: [],
              result,
            }),
          }
        : { kind: 'engine_completed', ...result }
    },
    async continuePermission(input) {
      const result = await engine.approvePermission(input.runtimeContext)
      return 'permissionRequest' in result
        ? {
            kind: 'waiting_permission',
            ...result,
            turn: permissionTurn({
              descriptor,
              requestId: input.requestId,
              previousCheckpointVersion: input.previousCheckpointVersion,
              previousSequence: input.previousSequence,
              settledPermissionRequestIds: input.settledPermissionRequestIds,
              result,
            }),
          }
        : { kind: 'engine_completed', ...result }
    },
    cancel: (input) => engine.cancel(input),
  }
}
