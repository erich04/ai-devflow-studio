import { createHash } from 'node:crypto'
import {
  assembleAgentRuntimeContext,
  canRunAgentRuntimeOnNode,
  createAgentRuntime,
  type AgentRuntimeBounds,
  type AgentRuntimeState,
  type AgentTaskGraph,
  type CoordinationBounds,
  type CoordinationSessionRequest,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'

export const BOUNDED_AGENT_COORDINATION_PLAN_ID = 'bounded-repair-v1' as const

export type StartBoundedAgentCoordinationPlanInput = {
  planId: typeof BOUNDED_AGENT_COORDINATION_PLAN_ID
  runId: string
  nodeId: string
  localProjectId: string
  expectedRunVersion: number
}

export type BoundedAgentCoordinationPlan = {
  start(input: StartBoundedAgentCoordinationPlanInput): Promise<{
    coordinationId: string
    replayed: boolean
  }>
}

type PlanStore = Pick<LocalStore,
  | 'getRun'
  | 'listProjects'
  | 'getDesktopPairingCredential'
  | 'getPolicySnapshot'
  | 'getAgentRuntime'
  | 'isAgentRuntimeContextCurrent'
  | 'commitAgentRuntimeTransition'
  | 'createCoordinationSession'
>

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const SUPERVISOR_MAX_WALL_TIME_MS = 6 * 60_000
const supervisorBounds: AgentRuntimeBounds = {
  maxSteps: 6,
  maxWallTimeMs: SUPERVISOR_MAX_WALL_TIME_MS,
  maxToolCalls: 6,
  maxToolResultBytes: 64 * 1_024,
  maxTrajectoryMetadataBytes: 16 * 1_024,
  maxCheckpointBytes: 128 * 1_024,
  maxTokens: 15_000,
  maxCostUsd: 1.5,
}
const coordinationBounds: CoordinationBounds = {
  maxSpecialists: 3,
  maxTaskNodes: 3,
  maxDependencyEdges: 2,
  maxDelegationDepth: 1,
  maxParallelSpecialists: 2,
  maxAcceptedHandoffs: 4,
  maxSpecialistRetries: 1,
  maxHandoffSummaryBytes: 4_096,
  maxSteps: supervisorBounds.maxSteps,
  maxWallTimeMs: supervisorBounds.maxWallTimeMs,
  maxToolCalls: supervisorBounds.maxToolCalls,
  maxTokens: supervisorBounds.maxTokens,
  maxCostUsd: supervisorBounds.maxCostUsd,
}
const supervisorCapabilityIds = [
  'deterministic_evaluation',
  'managed_workspace_edit',
  'repository_read',
  'saved_test',
] as const

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function canonicalNow(clock: () => string): string {
  const value = clock()
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error('agent_coordination_plan_start_failed')
  }
  return value
}

function entityIds(input: StartBoundedAgentCoordinationPlanInput) {
  const suffix = digest({
    stateVersion: 1,
    planId: input.planId,
    runId: input.runId,
    nodeId: input.nodeId,
    localProjectId: input.localProjectId,
    runVersion: input.expectedRunVersion,
  }).slice(0, 32)
  return {
    runtimeId: `coordination-supervisor-${suffix}`,
    contextId: `coordination-context-${suffix}`,
    coordinationId: `coordination-${suffix}`,
    graphId: `coordination-graph-${suffix}`,
  }
}

function createFrozenGraph(input: {
  planId: typeof BOUNDED_AGENT_COORDINATION_PLAN_ID
  coordinationId: string
  graphId: string
  supervisorContextDigest: string
  localProjectId: string
  resourceDigest: string
}): AgentTaskGraph {
  const taskContext = (taskId: string, roleId: string) => digest({
    stateVersion: 1,
    planId: input.planId,
    supervisorContextDigest: input.supervisorContextDigest,
    taskId,
    roleId,
  })
  return {
    stateVersion: 1,
    id: input.graphId,
    coordinationId: input.coordinationId,
    version: 1,
    entryTaskIds: ['inspect-contract', 'inspect-tests'],
    nodes: [{
      id: 'inspect-contract',
      roleId: 'contract-analyst',
      contextDigest: taskContext('inspect-contract', 'contract-analyst'),
      capabilityIds: ['repository_read'],
      resourceRequirements: [{
        resourceId: input.localProjectId,
        resourceDigest: input.resourceDigest,
        mode: 'read',
      }],
    }, {
      id: 'inspect-tests',
      roleId: 'test-analyst',
      contextDigest: taskContext('inspect-tests', 'test-analyst'),
      capabilityIds: ['repository_read', 'saved_test'],
      resourceRequirements: [{
        resourceId: input.localProjectId,
        resourceDigest: input.resourceDigest,
        mode: 'read',
      }],
    }, {
      id: 'implement-repair',
      roleId: 'bounded-implementer',
      contextDigest: taskContext('implement-repair', 'bounded-implementer'),
      capabilityIds: [...supervisorCapabilityIds],
      resourceRequirements: [{
        resourceId: input.localProjectId,
        resourceDigest: input.resourceDigest,
        mode: 'write',
      }],
    }],
    edges: [{
      id: 'contract-to-repair',
      sourceTaskId: 'inspect-contract',
      targetTaskId: 'implement-repair',
    }, {
      id: 'tests-to-repair',
      sourceTaskId: 'inspect-tests',
      targetTaskId: 'implement-repair',
    }],
  }
}

function exactSupervisor(input: {
  runtime: AgentRuntimeState
  runtimeId: string
  scope: AgentRuntimeState['scope']
  authority: AgentRuntimeState['authority']
  capabilitySetDigest: string
}): boolean {
  return (
    input.runtime.id === input.runtimeId &&
    input.runtime.version === 1 &&
    input.runtime.checkpointVersion === 1 &&
    input.runtime.status === 'checkpointed' &&
    input.runtime.stopReason === null &&
    sameJson(input.runtime.scope, input.scope) &&
    sameJson(input.runtime.authority, input.authority) &&
    input.runtime.capabilitySetDigest === input.capabilitySetDigest &&
    sameJson(input.runtime.bounds, supervisorBounds) &&
    Date.parse(input.runtime.deadline) - Date.parse(input.runtime.requestedAt) ===
      SUPERVISOR_MAX_WALL_TIME_MS
  )
}

export function createBoundedAgentCoordinationPlan(input: {
  store: PlanStore
  clock?: () => string
}): BoundedAgentCoordinationPlan {
  const clock = input.clock ?? (() => new Date().toISOString())

  return {
    async start(request) {
      try {
        if (
          request.planId !== BOUNDED_AGENT_COORDINATION_PLAN_ID ||
          !identifierPattern.test(request.runId) ||
          !identifierPattern.test(request.nodeId) ||
          !identifierPattern.test(request.localProjectId) ||
          !Number.isInteger(request.expectedRunVersion) ||
          request.expectedRunVersion < 1
        ) throw new Error('invalid_request')

        const [run, projects, pairing, policy] = await Promise.all([
          input.store.getRun(request.runId),
          input.store.listProjects(),
          input.store.getDesktopPairingCredential(),
          input.store.getPolicySnapshot(request.localProjectId),
        ])
        const project = projects.find((candidate) => candidate.id === request.localProjectId)
        const node = run?.nodes.find((candidate) => candidate.id === request.nodeId)
        if (
          run === null ||
          project === undefined ||
          run.projectId !== project.id ||
          run.version !== request.expectedRunVersion ||
          run.currentNodeId !== request.nodeId ||
          node === undefined ||
          !canRunAgentRuntimeOnNode(node) ||
          pairing === null ||
          pairing.localProjectId !== project.id
        ) throw new Error('stale_authority')

        const ids = entityIds(request)
        const scope = {
          kind: 'team' as const,
          organizationId: pairing.organizationId,
          projectId: pairing.projectId,
          userId: pairing.userId,
          sessionId: pairing.tokenId,
          localProjectId: project.id,
        }
        const authority = {
          runId: run.id,
          nodeId: node.id,
          runVersion: run.version,
          policyVersion: policy?.version ?? 1,
        }
        const capabilitySetDigest = digest({
          stateVersion: 1,
          planId: request.planId,
          capabilityIds: supervisorCapabilityIds,
        })

        let supervisor = await input.store.getAgentRuntime(ids.runtimeId)
        if (supervisor === null) {
          const requestedAt = canonicalNow(clock)
          const contextAttachment = await assembleAgentRuntimeContext({
            id: ids.contextId,
            runtimeId: ids.runtimeId,
            checkpointVersion: 1,
            scope,
            authority,
            citationSources: [],
            memorySources: [],
            attachedAt: requestedAt,
          })
          const transition = createAgentRuntime({
            stateVersion: 1,
            id: ids.runtimeId,
            scope,
            authority,
            contextDigest: contextAttachment.contextDigest,
            capabilitySetDigest,
            bounds: supervisorBounds,
            requestedAt,
            deadline: new Date(
              Date.parse(requestedAt) + SUPERVISOR_MAX_WALL_TIME_MS,
            ).toISOString(),
          })
          const committed = await input.store.commitAgentRuntimeTransition({
            expectedRuntime: null,
            transition,
            contextAttachment,
          })
          if (!committed.committed) {
            if (committed.reason !== 'runtime_exists') throw new Error(committed.reason)
            supervisor = await input.store.getAgentRuntime(ids.runtimeId)
          } else {
            supervisor = committed.runtime
          }
        }
        if (
          supervisor === null ||
          !exactSupervisor({
            runtime: supervisor,
            runtimeId: ids.runtimeId,
            scope,
            authority,
            capabilitySetDigest,
          })
        ) throw new Error('conflicting_supervisor')

        const expectedContext = await assembleAgentRuntimeContext({
          id: ids.contextId,
          runtimeId: ids.runtimeId,
          checkpointVersion: 1,
          scope,
          authority,
          citationSources: [],
          memorySources: [],
          attachedAt: supervisor.requestedAt,
        })
        if (supervisor.contextDigest !== expectedContext.contextDigest) {
          throw new Error('conflicting_context')
        }
        if (!await input.store.isAgentRuntimeContextCurrent(supervisor.id, supervisor.requestedAt)) {
          throw new Error('stale_context')
        }

        const coordination: CoordinationSessionRequest = {
          stateVersion: 1,
          id: ids.coordinationId,
          scope: {
            organizationId: pairing.organizationId,
            projectId: pairing.projectId,
            userId: pairing.userId,
            sessionId: pairing.tokenId,
            localProjectId: project.id,
          },
          authority: {
            ...authority,
            supervisorRuntimeId: supervisor.id,
            supervisorRuntimeVersion: supervisor.version,
          },
          contextDigest: supervisor.contextDigest,
          capabilitySetDigest: supervisor.capabilitySetDigest,
          bounds: coordinationBounds,
          requestedAt: supervisor.requestedAt,
          deadline: supervisor.deadline,
        }
        const graph = createFrozenGraph({
          planId: request.planId,
          coordinationId: coordination.id,
          graphId: ids.graphId,
          supervisorContextDigest: supervisor.contextDigest,
          localProjectId: project.id,
          resourceDigest: digest({
            stateVersion: 1,
            organizationId: pairing.organizationId,
            projectId: pairing.projectId,
            localProjectId: project.id,
          }),
        })
        const result = await input.store.createCoordinationSession({
          coordination,
          graph,
          startedAt: supervisor.requestedAt,
        })
        if (!result.committed) throw new Error(result.reason)
        return { coordinationId: coordination.id, replayed: result.replayed }
      } catch {
        throw new Error('agent_coordination_plan_start_failed')
      }
    },
  }
}
