import { randomUUID } from 'node:crypto'
import {
  assembleAgentRuntimeContext,
  createAgentRuntime,
  type AgentHandoff,
  type AgentRuntimeState,
  type AgentRuntimeTransition,
  type CoordinationResourceLease,
  type CoordinationSessionState,
  type SpecialistAllocationRequest,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'
import type { SpecialistRuntimeHandoffDraft } from './local-store.js'
import {
  digestSpecialistCapabilitySet,
  deriveSpecialistRecoveryEntityId,
  SPECIALIST_RUNTIME_MAX_CHECKPOINT_BYTES,
  SPECIALIST_RUNTIME_MAX_COST_USD,
  SPECIALIST_RUNTIME_MAX_STEPS,
  SPECIALIST_RUNTIME_MAX_TOKENS,
  SPECIALIST_RUNTIME_MAX_TOOL_CALLS,
  SPECIALIST_RUNTIME_MAX_TOOL_RESULT_BYTES,
  SPECIALIST_RUNTIME_MAX_TRAJECTORY_METADATA_BYTES,
  SPECIALIST_RUNTIME_MAX_WALL_TIME_MS,
} from './specialist-runtime-registry.js'
import type { SpecialistTaskAuthorityBroker } from './specialist-task-authority.js'

export type SpecialistRuntimeCoordinator = {
  resume(input: {
    coordinationId: string
    expectedSessionVersion: number
    now?: string
  }): Promise<{
    coordination: CoordinationSessionState
    runtimes: AgentRuntimeState[]
    readyTaskIds: string[]
  }>
  start(input: {
    coordinationId: string
    expectedSessionVersion: number
    taskId: string
    expectedTaskVersion: number
  }): Promise<{
    runtime: AgentRuntimeState
    coordination: CoordinationSessionState
  }>
  complete(input: {
    coordinationId: string
    expectedSessionVersion: number
    taskId: string
    expectedTaskVersion: number
    expectedRuntimeVersion: number
    transition: AgentRuntimeTransition
    evidenceDigests: string[]
    resourceLeaseOutcome: 'not_required' | 'released'
    handoffs: SpecialistRuntimeHandoffDraft[]
  }): Promise<{
    runtime: AgentRuntimeState
    coordination: CoordinationSessionState
    handoffs: AgentHandoff[]
  }>
  recover(input: {
    recoveryId: string
    coordinationId: string
    expectedSessionVersion: number
    taskId: string
    expectedTaskVersion: number
    expectedRuntimeVersion: number
    transition: AgentRuntimeTransition
  }): Promise<{
    failedRuntime: AgentRuntimeState
    runtime: AgentRuntimeState
    coordination: CoordinationSessionState
  }>
  cancel(input: {
    coordinationId: string
    expectedSessionVersion: number
    now?: string
  }): Promise<{
    coordination: CoordinationSessionState
    runtimes: AgentRuntimeState[]
    leases: CoordinationResourceLease[]
  }>
}

export type CreateSpecialistRuntimeCoordinatorInput = {
  store: Pick<LocalStore,
    | 'commitSpecialistRuntimeStart'
    | 'commitSpecialistRuntimeCompletion'
    | 'commitSpecialistRuntimeRecovery'
    | 'commitCoordinationSessionCancellation'
    | 'authorizeCoordinationSessionRecovery'
  >
  authorityBroker: SpecialistTaskAuthorityBroker
  cancelRuntimeEffects?: (runtimeIds: string[]) => Promise<void> | void
  clock?: () => string
  createId?: (kind: 'allocation' | 'agent' | 'runtime' | 'context') => string
}

function canonicalNow(clock: () => string): string {
  const now = clock()
  const parsed = Date.parse(now)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== now) {
    throw new Error('specialist_runtime_start_failed')
  }
  return now
}

export function createSpecialistRuntimeCoordinator(
  input: CreateSpecialistRuntimeCoordinatorInput,
): SpecialistRuntimeCoordinator {
  const clock = input.clock ?? (() => new Date().toISOString())
  const createId = input.createId ?? ((kind) => `specialist-${kind}-${randomUUID()}`)

  return {
    async resume(request) {
      try {
        const authorized = await input.store.authorizeCoordinationSessionRecovery({
          coordinationId: request.coordinationId,
          expectedSessionVersion: request.expectedSessionVersion,
          now: request.now ?? canonicalNow(clock),
        })
        if (!authorized.authorized) throw new Error(authorized.reason)
        return {
          coordination: authorized.snapshot.state,
          runtimes: authorized.runtimes,
          readyTaskIds: authorized.readyTaskIds,
        }
      } catch {
        throw new Error('specialist_runtime_resume_failed')
      }
    },

    async start(request) {
      try {
        const now = canonicalNow(clock)
        const authorization = await input.authorityBroker.authorize({ ...request, now })
        const task = authorization.task
        const budget = {
          maxSteps: Math.min(SPECIALIST_RUNTIME_MAX_STEPS, task.remainingBudget.maxSteps),
          maxWallTimeMs: Math.min(
            SPECIALIST_RUNTIME_MAX_WALL_TIME_MS,
            task.remainingBudget.maxWallTimeMs,
            Date.parse(task.deadline) - Date.parse(now),
          ),
          maxToolCalls: Math.min(
            SPECIALIST_RUNTIME_MAX_TOOL_CALLS,
            task.remainingBudget.maxToolCalls,
          ),
          maxTokens: Math.min(SPECIALIST_RUNTIME_MAX_TOKENS, task.remainingBudget.maxTokens),
          maxCostUsd: Math.min(
            SPECIALIST_RUNTIME_MAX_COST_USD,
            task.remainingBudget.maxCostUsd,
          ),
        }
        if (Object.values(budget).some((value) => value <= 0)) {
          throw new Error('invalid_specialist_budget')
        }
        const deadline = new Date(
          Math.min(
            Date.parse(task.deadline),
            Date.parse(now) + budget.maxWallTimeMs,
          ),
        ).toISOString()
        const allocation: SpecialistAllocationRequest = {
          stateVersion: 1,
          id: createId('allocation'),
          coordinationId: task.coordinationId,
          taskGraphId: task.graphId,
          taskGraphVersion: task.graphVersion,
          taskId: task.taskId,
          roleId: task.roleId,
          agentId: createId('agent'),
          delegationDepth: 1,
          scope: { ...task.scope },
          authority: { ...task.authority },
          contextDigest: task.contextDigest,
          capabilityIds: [...task.capabilityIds],
          resourceRequirements: task.resourceRequirements.map((resource) => ({ ...resource })),
          budget,
          requestedAt: now,
          deadline,
        }
        const runtimeId = createId('runtime')
        const runtimeScope = {
          kind: 'team' as const,
          organizationId: task.scope.organizationId,
          projectId: task.scope.projectId,
          userId: task.scope.userId,
          sessionId: task.scope.sessionId,
          localProjectId: task.scope.localProjectId,
        }
        const runtimeAuthority = {
          runId: task.authority.runId,
          nodeId: task.authority.nodeId,
          runVersion: task.authority.runVersion,
          policyVersion: task.authority.policyVersion,
        }
        const contextAttachment = await assembleAgentRuntimeContext({
          id: createId('context'),
          runtimeId,
          checkpointVersion: 1,
          scope: runtimeScope,
          authority: runtimeAuthority,
          citationSources: [],
          memorySources: [],
          attachedAt: now,
        })
        const transition = createAgentRuntime({
          stateVersion: 1,
          id: runtimeId,
          scope: runtimeScope,
          authority: runtimeAuthority,
          contextDigest: contextAttachment.contextDigest,
          capabilitySetDigest: digestSpecialistCapabilitySet({
            roleId: task.roleId,
            roleVersion: task.roleVersion,
            taskContextDigest: task.contextDigest,
            capabilityIds: task.capabilityIds,
          }),
          bounds: {
            ...budget,
            maxToolResultBytes: SPECIALIST_RUNTIME_MAX_TOOL_RESULT_BYTES,
            maxTrajectoryMetadataBytes: SPECIALIST_RUNTIME_MAX_TRAJECTORY_METADATA_BYTES,
            maxCheckpointBytes: SPECIALIST_RUNTIME_MAX_CHECKPOINT_BYTES,
          },
          requestedAt: now,
          deadline,
        })
        const committed = await input.store.commitSpecialistRuntimeStart({
          authorityCapability: authorization.capability,
          allocation,
          transition,
          contextAttachment,
          now,
        })
        if (!committed.committed) throw new Error(committed.reason)
        return { runtime: committed.runtime, coordination: committed.state }
      } catch {
        throw new Error('specialist_runtime_start_failed')
      }
    },

    async complete(request) {
      try {
        const committed = await input.store.commitSpecialistRuntimeCompletion(request)
        if (!committed.committed) throw new Error(committed.reason)
        return {
          runtime: committed.runtime,
          coordination: committed.state,
          handoffs: committed.handoffs,
        }
      } catch {
        throw new Error('specialist_runtime_completion_failed')
      }
    },

    async recover(request) {
      try {
        const failedRuntime = request.transition.runtime
        const now = failedRuntime.updatedAt
        const remainingBounds = {
          maxSteps: failedRuntime.bounds.maxSteps - failedRuntime.counters.steps,
          maxWallTimeMs: Date.parse(failedRuntime.deadline) - Date.parse(now),
          maxToolCalls: failedRuntime.bounds.maxToolCalls - failedRuntime.counters.toolCalls,
          maxToolResultBytes: failedRuntime.bounds.maxToolResultBytes,
          maxTrajectoryMetadataBytes: failedRuntime.bounds.maxTrajectoryMetadataBytes,
          maxCheckpointBytes: failedRuntime.bounds.maxCheckpointBytes,
          maxTokens: failedRuntime.bounds.maxTokens - failedRuntime.counters.tokens,
          maxCostUsd: failedRuntime.bounds.maxCostUsd - failedRuntime.counters.costUsd,
        }
        if (Object.values(remainingBounds).some((value) => value <= 0)) {
          throw new Error('specialist_recovery_budget_exhausted')
        }
        const runtimeId = deriveSpecialistRecoveryEntityId(
          'runtime',
          request.recoveryId,
          failedRuntime.id,
        )
        const contextAttachment = await assembleAgentRuntimeContext({
          id: deriveSpecialistRecoveryEntityId(
            'context',
            request.recoveryId,
            failedRuntime.id,
          ),
          runtimeId,
          checkpointVersion: 1,
          scope: failedRuntime.scope,
          authority: failedRuntime.authority,
          citationSources: [],
          memorySources: [],
          attachedAt: now,
        })
        const replacementTransition = createAgentRuntime({
          stateVersion: 1,
          id: runtimeId,
          scope: failedRuntime.scope,
          authority: failedRuntime.authority,
          contextDigest: contextAttachment.contextDigest,
          capabilitySetDigest: failedRuntime.capabilitySetDigest,
          bounds: remainingBounds,
          requestedAt: now,
          deadline: failedRuntime.deadline,
        })
        const committed = await input.store.commitSpecialistRuntimeRecovery({
          recoveryId: request.recoveryId,
          coordinationId: request.coordinationId,
          expectedSessionVersion: request.expectedSessionVersion,
          taskId: request.taskId,
          expectedTaskVersion: request.expectedTaskVersion,
          expectedRuntimeVersion: request.expectedRuntimeVersion,
          failureTransition: request.transition,
          replacementTransition,
          contextAttachment,
        })
        if (!committed.committed) throw new Error(committed.reason)
        return {
          failedRuntime: committed.failedRuntime,
          runtime: committed.runtime,
          coordination: committed.state,
        }
      } catch {
        throw new Error('specialist_runtime_recovery_failed')
      }
    },

    async cancel(request) {
      try {
        const committed = await input.store.commitCoordinationSessionCancellation({
          coordinationId: request.coordinationId,
          expectedSessionVersion: request.expectedSessionVersion,
          now: request.now ?? canonicalNow(clock),
        })
        if (!committed.committed) throw new Error(committed.reason)
        await input.cancelRuntimeEffects?.(committed.runtimes.map((runtime) => runtime.id))
        return {
          coordination: committed.state,
          runtimes: committed.runtimes,
          leases: committed.leases,
        }
      } catch {
        throw new Error('specialist_runtime_cancellation_failed')
      }
    },
  }
}
