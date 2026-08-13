import { describe, expect, it } from 'vitest'
import {
  acceptAgentHandoff,
  acceptCoordinationResourceLease,
  applyCoordinationHandoff,
  cancelCoordinationSession,
  COORDINATION_CONTRACT_VERSION,
  createCoordinationSessionState,
  parseAgentTaskGraph,
  parseCoordinationSessionRequest,
  parseCoordinationSessionState,
  parseSpecialistAllocationRequest,
  recordCoordinationTaskResult,
  retryCoordinationTask,
  settleCoordinationResourceLease,
  startCoordinationTask,
  type AgentTaskGraph,
  type AgentHandoff,
  type AgentHandoffAcceptOptions,
  type CoordinationSessionRequest,
  type CoordinationResourceLease,
  type SpecialistAllocationRequest,
} from './agent-coordination'

const digestA = 'a'.repeat(64)
const digestB = 'b'.repeat(64)

const request: CoordinationSessionRequest = {
  stateVersion: 1,
  id: 'coordination-1',
  scope: {
    organizationId: 'org-1',
    projectId: 'project-1',
    userId: 'user-1',
    sessionId: 'session-1',
    localProjectId: 'local-project-1',
  },
  authority: {
    runId: 'run-1',
    nodeId: 'node-1',
    runVersion: 7,
    policyVersion: 3,
    supervisorRuntimeId: 'agent-runtime-1',
    supervisorRuntimeVersion: 5,
  },
  contextDigest: digestA,
  capabilitySetDigest: digestB,
  bounds: {
    maxSpecialists: 4,
    maxTaskNodes: 12,
    maxDependencyEdges: 24,
    maxDelegationDepth: 1,
    maxParallelSpecialists: 3,
    maxAcceptedHandoffs: 16,
    maxSpecialistRetries: 1,
    maxHandoffSummaryBytes: 16_384,
    maxSteps: 12,
    maxWallTimeMs: 600_000,
    maxToolCalls: 16,
    maxTokens: 50_000,
    maxCostUsd: 5,
  },
  requestedAt: '2026-08-13T15:00:00.000Z',
  deadline: '2026-08-13T15:10:00.000Z',
}

const taskGraph: AgentTaskGraph = {
  stateVersion: 1,
  id: 'task-graph-1',
  coordinationId: request.id,
  version: 1,
  entryTaskIds: ['task-b', 'task-a'],
  nodes: [
    {
      id: 'task-c',
      roleId: 'integration-analyst',
      contextDigest: 'c'.repeat(64),
      capabilityIds: ['repository_read'],
      resourceRequirements: [],
    },
    {
      id: 'task-b',
      roleId: 'test-analyst',
      contextDigest: 'd'.repeat(64),
      capabilityIds: ['repository_read', 'saved_test'],
      resourceRequirements: [],
    },
    {
      id: 'task-a',
      roleId: 'contract-analyst',
      contextDigest: 'e'.repeat(64),
      capabilityIds: ['repository_read'],
      resourceRequirements: [],
    },
  ],
  edges: [
    { id: 'edge-a-c', sourceTaskId: 'task-a', targetTaskId: 'task-c' },
    { id: 'edge-b-c', sourceTaskId: 'task-b', targetTaskId: 'task-c' },
  ],
}

const specialistAllocation: SpecialistAllocationRequest = {
  stateVersion: 1,
  id: 'specialist-allocation-1',
  coordinationId: request.id,
  taskGraphId: taskGraph.id,
  taskGraphVersion: taskGraph.version,
  taskId: 'task-a',
  roleId: 'contract-analyst',
  agentId: 'specialist-1',
  delegationDepth: 1,
  scope: request.scope,
  authority: request.authority,
  contextDigest: 'e'.repeat(64),
  capabilityIds: ['repository_read'],
  resourceRequirements: [],
  budget: {
    maxSteps: 4,
    maxWallTimeMs: 300_000,
    maxToolCalls: 4,
    maxTokens: 10_000,
    maxCostUsd: 1,
  },
  requestedAt: '2026-08-13T15:00:01.000Z',
  deadline: '2026-08-13T15:05:01.000Z',
}

const agentHandoff: AgentHandoff = {
  stateVersion: 1,
  id: 'handoff-task-a-task-c-1',
  coordinationId: request.id,
  sequence: 1,
  scope: request.scope,
  sourceTaskId: 'task-a',
  sourceTaskVersion: 2,
  sourceRuntimeId: 'specialist-runtime-1',
  sourceRuntimeVersion: 4,
  targetTaskId: 'task-c',
  targetTaskVersion: 1,
  resultDigest: '1'.repeat(64),
  evidenceDigests: ['2'.repeat(64), '3'.repeat(64)],
  contextDigest: 'e'.repeat(64),
  resourceLeaseOutcome: 'not_required',
  summary: 'Contract analysis completed with bounded evidence references.',
  createdAt: '2026-08-13T15:04:00.000Z',
}

const handoffAcceptOptions = (
  overrides: Partial<AgentHandoffAcceptOptions> = {},
): AgentHandoffAcceptOptions => ({
  coordination: request,
  graph: taskGraph,
  sourceResult: {
    taskId: 'task-a',
    taskVersion: 2,
    runtimeId: 'specialist-runtime-1',
    runtimeVersion: 4,
    status: 'succeeded',
    resultDigest: '1'.repeat(64),
    evidenceDigests: ['2'.repeat(64), '3'.repeat(64)],
    contextDigest: 'e'.repeat(64),
    resourceLeaseOutcome: 'not_required',
  },
  targetTaskVersion: 1,
  expectedSequence: 1,
  maxSummaryBytes: request.bounds.maxHandoffSummaryBytes,
  existingHandoff: null,
  ...overrides,
})

describe('Coordination Session request contract', () => {
  it('parses one exact canonical Team-scoped request within its Supervisor bounds', () => {
    expect(parseCoordinationSessionRequest(request, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toEqual(request)
    expect(COORDINATION_CONTRACT_VERSION).toBe(1)
  })

  it('rejects an unknown request field instead of widening coordination authority', () => {
    expect(() => parseCoordinationSessionRequest({ ...request, unknown: true }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a noncanonical Coordination Session identity', () => {
    expect(() => parseCoordinationSessionRequest({ ...request, id: '../coordination-1' }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a mixed or incomplete execution-tenancy scope', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      scope: { ...request.scope, projectId: null },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects stale or nonpositive Supervisor authority versions', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      authority: { ...request.authority, supervisorRuntimeVersion: 0 },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a noncanonical capability-set digest', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      capabilitySetDigest: digestB.toUpperCase(),
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a noncanonical request timestamp', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      requestedAt: '2026-08-13T15:00:00Z',
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a shared step budget wider than the authoritative Supervisor budget', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, maxSteps: 13 },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a shared step budget above the V2.0 Runtime hard maximum', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, maxSteps: 33 },
    }, {
      maxSteps: 33,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it.each([
    ['wall time', 'maxWallTimeMs', 1_800_001],
    ['Tool calls', 'maxToolCalls', 65],
    ['tokens', 'maxTokens', 10_000_001],
    ['cost', 'maxCostUsd', 1_000_000.01],
  ] as const)('rejects %s above the V2.0 Runtime hard maximum', (_label, key, value) => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, [key]: value },
    }, {
      maxSteps: 12,
      maxWallTimeMs: key === 'maxWallTimeMs' ? value : 600_000,
      maxToolCalls: key === 'maxToolCalls' ? value : 16,
      maxTokens: key === 'maxTokens' ? value : 50_000,
      maxCostUsd: key === 'maxCostUsd' ? value : 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects more than four Specialist Agents', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, maxSpecialists: 5 },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects an unknown shared-bound field', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, maxHiddenWork: 1 },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a deadline outside the shared wall-time bound', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      deadline: '2026-08-13T15:10:00.001Z',
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a Tool-call allocation wider than the Supervisor budget', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, maxToolCalls: 17 },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a cost allocation wider than the Supervisor budget', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, maxCostUsd: 5.01 },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a token allocation wider than the Supervisor budget', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, maxTokens: 50_001 },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it.each([
    ['task nodes', 'maxTaskNodes', 13],
    ['dependency edges', 'maxDependencyEdges', 25],
    ['delegation depth', 'maxDelegationDepth', 2],
    ['parallel Specialists', 'maxParallelSpecialists', 4],
    ['accepted handoffs', 'maxAcceptedHandoffs', 17],
    ['Specialist retries', 'maxSpecialistRetries', 2],
    ['handoff summary bytes', 'maxHandoffSummaryBytes', 16_385],
  ] as const)('rejects %s above the frozen hard maximum', (_label, key, value) => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, [key]: value },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })
})

describe('Agent Task Graph contract', () => {
  it('accepts one bounded DAG and returns deterministic initial ready order', () => {
    expect(parseAgentTaskGraph(taskGraph, {
      coordinationId: request.id,
      acceptedRoleIds: ['contract-analyst', 'integration-analyst', 'test-analyst'],
      maxTaskNodes: request.bounds.maxTaskNodes,
      maxDependencyEdges: request.bounds.maxDependencyEdges,
    })).toEqual({
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
    })
  })

  it('rejects duplicate task identities before any task becomes ready', () => {
    expect(() => parseAgentTaskGraph({
      ...taskGraph,
      nodes: taskGraph.nodes.map((node, index) =>
        index === 0 ? { ...node, id: 'task-a' } : node),
    }, {
      coordinationId: request.id,
      acceptedRoleIds: ['contract-analyst', 'integration-analyst', 'test-analyst'],
      maxTaskNodes: request.bounds.maxTaskNodes,
      maxDependencyEdges: request.bounds.maxDependencyEdges,
    })).toThrowError('invalid_agent_task_graph')
  })

  it('rejects a dependency whose target is outside the graph', () => {
    expect(() => parseAgentTaskGraph({
      ...taskGraph,
      edges: taskGraph.edges.map((edge, index) =>
        index === 0 ? { ...edge, targetTaskId: 'missing-task' } : edge),
    }, {
      coordinationId: request.id,
      acceptedRoleIds: ['contract-analyst', 'integration-analyst', 'test-analyst'],
      maxTaskNodes: request.bounds.maxTaskNodes,
      maxDependencyEdges: request.bounds.maxDependencyEdges,
    })).toThrowError('invalid_agent_task_graph')
  })

  it('rejects duplicate dependency relations hidden behind distinct edge identities', () => {
    expect(() => parseAgentTaskGraph({
      ...taskGraph,
      edges: [
        ...taskGraph.edges,
        { id: 'edge-a-c-duplicate', sourceTaskId: 'task-a', targetTaskId: 'task-c' },
      ],
    }, {
      coordinationId: request.id,
      acceptedRoleIds: ['contract-analyst', 'integration-analyst', 'test-analyst'],
      maxTaskNodes: request.bounds.maxTaskNodes,
      maxDependencyEdges: request.bounds.maxDependencyEdges,
    })).toThrowError('invalid_agent_task_graph')
  })

  it('rejects a cycle before allocating any Specialist', () => {
    expect(() => parseAgentTaskGraph({
      ...taskGraph,
      edges: [
        ...taskGraph.edges,
        { id: 'edge-c-a', sourceTaskId: 'task-c', targetTaskId: 'task-a' },
      ],
    }, {
      coordinationId: request.id,
      acceptedRoleIds: ['contract-analyst', 'integration-analyst', 'test-analyst'],
      maxTaskNodes: request.bounds.maxTaskNodes,
      maxDependencyEdges: request.bounds.maxDependencyEdges,
    })).toThrowError('invalid_agent_task_graph')
  })

  it('rejects disconnected hidden work not declared as an entry task', () => {
    expect(() => parseAgentTaskGraph({
      ...taskGraph,
      nodes: [
        ...taskGraph.nodes,
        {
          id: 'task-hidden',
          roleId: 'test-analyst',
          contextDigest: 'f'.repeat(64),
          capabilityIds: ['repository_read'],
          resourceRequirements: [],
        },
      ],
    }, {
      coordinationId: request.id,
      acceptedRoleIds: ['contract-analyst', 'integration-analyst', 'test-analyst'],
      maxTaskNodes: request.bounds.maxTaskNodes,
      maxDependencyEdges: request.bounds.maxDependencyEdges,
    })).toThrowError('invalid_agent_task_graph')
  })

  it('rejects a model-created Specialist role outside the accepted registry', () => {
    expect(() => parseAgentTaskGraph({
      ...taskGraph,
      nodes: taskGraph.nodes.map((node, index) =>
        index === 0 ? { ...node, roleId: 'untrusted-role' } : node),
    }, {
      coordinationId: request.id,
      acceptedRoleIds: ['contract-analyst', 'integration-analyst', 'test-analyst'],
      maxTaskNodes: request.bounds.maxTaskNodes,
      maxDependencyEdges: request.bounds.maxDependencyEdges,
    })).toThrowError('invalid_agent_task_graph')
  })

  it('rejects a graph bound to another Coordination Session', () => {
    expect(() => parseAgentTaskGraph({ ...taskGraph, coordinationId: 'coordination-2' }, {
      coordinationId: request.id,
      acceptedRoleIds: ['contract-analyst', 'integration-analyst', 'test-analyst'],
      maxTaskNodes: request.bounds.maxTaskNodes,
      maxDependencyEdges: request.bounds.maxDependencyEdges,
    })).toThrowError('invalid_agent_task_graph')
  })

  it('rejects a task with a noncanonical Context digest', () => {
    expect(() => parseAgentTaskGraph({
      ...taskGraph,
      nodes: taskGraph.nodes.map((node, index) =>
        index === 0 ? { ...node, contextDigest: node.contextDigest.toUpperCase() } : node),
    }, {
      coordinationId: request.id,
      acceptedRoleIds: ['contract-analyst', 'integration-analyst', 'test-analyst'],
      maxTaskNodes: request.bounds.maxTaskNodes,
      maxDependencyEdges: request.bounds.maxDependencyEdges,
    })).toThrowError('invalid_agent_task_graph')
  })

  it('rejects duplicate task capability needs', () => {
    expect(() => parseAgentTaskGraph({
      ...taskGraph,
      nodes: taskGraph.nodes.map((node, index) =>
        index === 0
          ? { ...node, capabilityIds: ['repository_read', 'repository_read'] }
          : node),
    }, {
      coordinationId: request.id,
      acceptedRoleIds: ['contract-analyst', 'integration-analyst', 'test-analyst'],
      maxTaskNodes: request.bounds.maxTaskNodes,
      maxDependencyEdges: request.bounds.maxDependencyEdges,
    })).toThrowError('invalid_agent_task_graph')
  })

  it('rejects an unrecognized mutable-resource mode', () => {
    expect(() => parseAgentTaskGraph({
      ...taskGraph,
      nodes: taskGraph.nodes.map((node, index) => index === 0
        ? {
            ...node,
            resourceRequirements: [{
              resourceId: 'workspace-1',
              resourceDigest: 'f'.repeat(64),
              mode: 'admin',
            }],
          }
        : node),
    }, {
      coordinationId: request.id,
      acceptedRoleIds: ['contract-analyst', 'integration-analyst', 'test-analyst'],
      maxTaskNodes: request.bounds.maxTaskNodes,
      maxDependencyEdges: request.bounds.maxDependencyEdges,
    })).toThrowError('invalid_agent_task_graph')
  })

  it('rejects mutable dependency metadata outside the frozen edge contract', () => {
    expect(() => parseAgentTaskGraph({
      ...taskGraph,
      edges: taskGraph.edges.map((edge, index) =>
        index === 0 ? { ...edge, mutable: true } : edge),
    }, {
      coordinationId: request.id,
      acceptedRoleIds: ['contract-analyst', 'integration-analyst', 'test-analyst'],
      maxTaskNodes: request.bounds.maxTaskNodes,
      maxDependencyEdges: request.bounds.maxDependencyEdges,
    })).toThrowError('invalid_agent_task_graph')
  })
})

describe('Specialist allocation contract', () => {
  it('accepts one ready task with an exact attenuated Specialist authority', () => {
    expect(parseSpecialistAllocationRequest(specialistAllocation, {
      coordination: request,
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toEqual(specialistAllocation)
  })

  it('attenuates a Supervisor write resource to the ready task read requirement', () => {
    const readResource = {
      resourceId: 'workspace-1',
      resourceDigest: 'f'.repeat(64),
      mode: 'read' as const,
    }
    const graphWithResource: AgentTaskGraph = {
      ...taskGraph,
      nodes: taskGraph.nodes.map((node) => node.id === specialistAllocation.taskId
        ? { ...node, resourceRequirements: [readResource] }
        : node),
    }
    const allocationWithResource: SpecialistAllocationRequest = {
      ...specialistAllocation,
      resourceRequirements: [readResource],
    }

    expect(parseSpecialistAllocationRequest(allocationWithResource, {
      coordination: request,
      graph: graphWithResource,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [{ ...readResource, mode: 'write' }],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toEqual(allocationWithResource)
  })

  it('rejects escalation from a Supervisor read resource to Specialist write', () => {
    const writeResource = {
      resourceId: 'workspace-1',
      resourceDigest: 'f'.repeat(64),
      mode: 'write' as const,
    }
    const graphWithResource: AgentTaskGraph = {
      ...taskGraph,
      nodes: taskGraph.nodes.map((node) => node.id === specialistAllocation.taskId
        ? { ...node, resourceRequirements: [writeResource] }
        : node),
    }
    expect(() => parseSpecialistAllocationRequest({
      ...specialistAllocation,
      resourceRequirements: [writeResource],
    }, {
      coordination: request,
      graph: graphWithResource,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [{ ...writeResource, mode: 'read' }],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toThrowError('invalid_specialist_allocation_request')
  })

  it('rejects a task capability absent from the Supervisor grant', () => {
    expect(() => parseSpecialistAllocationRequest({
      ...specialistAllocation,
      taskId: 'task-b',
      roleId: 'test-analyst',
      contextDigest: 'd'.repeat(64),
      capabilityIds: ['repository_read', 'saved_test'],
    }, {
      coordination: request,
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read'],
      supervisorResourceRequirements: [],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toThrowError('invalid_specialist_allocation_request')
  })

  it('rejects allocation for a task whose dependencies are not ready', () => {
    expect(() => parseSpecialistAllocationRequest({
      ...specialistAllocation,
      taskId: 'task-c',
      roleId: 'integration-analyst',
      contextDigest: 'c'.repeat(64),
    }, {
      coordination: request,
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toThrowError('invalid_specialist_allocation_request')
  })

  it('rejects a Specialist role wider than the ready task declaration', () => {
    expect(() => parseSpecialistAllocationRequest({
      ...specialistAllocation,
      roleId: 'test-analyst',
    }, {
      coordination: request,
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toThrowError('invalid_specialist_allocation_request')
  })

  it('rejects Context outside the ready task declaration', () => {
    expect(() => parseSpecialistAllocationRequest({
      ...specialistAllocation,
      contextDigest: 'f'.repeat(64),
    }, {
      coordination: request,
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toThrowError('invalid_specialist_allocation_request')
  })

  it('rejects a Supervisor capability not requested by the ready task', () => {
    expect(() => parseSpecialistAllocationRequest({
      ...specialistAllocation,
      capabilityIds: ['repository_read', 'saved_test'],
    }, {
      coordination: request,
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toThrowError('invalid_specialist_allocation_request')
  })

  it('rejects a Specialist allocation crossing the project tenancy boundary', () => {
    expect(() => parseSpecialistAllocationRequest({
      ...specialistAllocation,
      scope: { ...specialistAllocation.scope, projectId: 'project-2' },
    }, {
      coordination: request,
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toThrowError('invalid_specialist_allocation_request')
  })

  it('rejects a stale parent Supervisor runtime version', () => {
    expect(() => parseSpecialistAllocationRequest({
      ...specialistAllocation,
      authority: {
        ...specialistAllocation.authority,
        supervisorRuntimeVersion: specialistAllocation.authority.supervisorRuntimeVersion - 1,
      },
    }, {
      coordination: request,
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toThrowError('invalid_specialist_allocation_request')
  })

  it('rejects recursive Specialist delegation', () => {
    expect(() => parseSpecialistAllocationRequest({
      ...specialistAllocation,
      delegationDepth: 2,
    }, {
      coordination: request,
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toThrowError('invalid_specialist_allocation_request')
  })

  it('rejects a Specialist sub-budget above the remaining shared budget', () => {
    expect(() => parseSpecialistAllocationRequest({
      ...specialistAllocation,
      budget: { ...specialistAllocation.budget, maxSteps: 13 },
    }, {
      coordination: request,
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toThrowError('invalid_specialist_allocation_request')
  })

  it.each([
    ['wall time', 'maxWallTimeMs', 600_001],
    ['Tool calls', 'maxToolCalls', 17],
    ['tokens', 'maxTokens', 50_001],
    ['cost', 'maxCostUsd', 5.01],
  ] as const)('rejects Specialist %s above the remaining shared budget', (_label, key, value) => {
    expect(() => parseSpecialistAllocationRequest({
      ...specialistAllocation,
      budget: { ...specialistAllocation.budget, [key]: value },
    }, {
      coordination: request,
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toThrowError('invalid_specialist_allocation_request')
  })

  it('rejects a Supervisor resource not requested by the ready task', () => {
    const resource = {
      resourceId: 'workspace-1',
      resourceDigest: 'f'.repeat(64),
      mode: 'read' as const,
    }
    expect(() => parseSpecialistAllocationRequest({
      ...specialistAllocation,
      resourceRequirements: [resource],
    }, {
      coordination: request,
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [resource],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toThrowError('invalid_specialist_allocation_request')
  })

  it('rejects an unknown Specialist allocation field', () => {
    expect(() => parseSpecialistAllocationRequest({
      ...specialistAllocation,
      canSpawnAgent: true,
    }, {
      coordination: request,
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toThrowError('invalid_specialist_allocation_request')
  })

  it('rejects a stale Agent Task Graph version', () => {
    expect(() => parseSpecialistAllocationRequest({
      ...specialistAllocation,
      taskGraphVersion: taskGraph.version + 1,
    }, {
      coordination: request,
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toThrowError('invalid_specialist_allocation_request')
  })

  it('rejects a Specialist deadline outside its attenuated wall-time budget', () => {
    expect(() => parseSpecialistAllocationRequest({
      ...specialistAllocation,
      deadline: '2026-08-13T15:05:01.001Z',
    }, {
      coordination: request,
      graph: taskGraph,
      readyTaskIds: ['task-a', 'task-b'],
      supervisorCapabilityIds: ['repository_read', 'saved_test'],
      supervisorResourceRequirements: [],
      remainingBudget: {
        maxSteps: 12,
        maxWallTimeMs: 600_000,
        maxToolCalls: 16,
        maxTokens: 50_000,
        maxCostUsd: 5,
      },
    })).toThrowError('invalid_specialist_allocation_request')
  })
})

describe('Agent Handoff contract', () => {
  it('accepts one exact immutable dependency handoff', () => {
    expect(acceptAgentHandoff(agentHandoff, handoffAcceptOptions())).toEqual({
      handoff: agentHandoff,
      replayed: false,
    })
  })

  it('rejects unknown handoff fields instead of widening the metadata boundary', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      hiddenReasoning: 'private scratchpad',
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects a handoff crossing the execution-tenancy boundary', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      scope: { ...agentHandoff.scope, projectId: 'project-2' },
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects a handoff whose source is not a dependency of its target', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      targetTaskId: 'task-b',
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects a handoff from a stale accepted source result', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      sourceTaskVersion: agentHandoff.sourceTaskVersion - 1,
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects a handoff to a stale target task version', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      targetTaskVersion: agentHandoff.targetTaskVersion + 1,
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects a handoff from a stale Specialist Runtime result', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      sourceRuntimeVersion: agentHandoff.sourceRuntimeVersion - 1,
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects a dependency result that was not accepted as succeeded', () => {
    const sourceResult = {
      ...handoffAcceptOptions().sourceResult,
      status: 'failed' as never,
    }
    expect(() => acceptAgentHandoff(
      agentHandoff,
      handoffAcceptOptions({ sourceResult }),
    )).toThrowError('invalid_agent_handoff')
  })

  it('rejects a handoff whose result digest was not accepted for the dependency', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      resultDigest: '4'.repeat(64),
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects a handoff whose Context digest is not the accepted source Context', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      contextDigest: '4'.repeat(64),
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects Evidence references not present in the accepted dependency result', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      evidenceDigests: ['2'.repeat(64), '4'.repeat(64)],
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects a resource-lease outcome not accepted with the dependency result', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      resourceLeaseOutcome: 'released',
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects a nonmonotonic handoff sequence', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      sequence: 2,
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects a handoff summary above the attenuated UTF-8 byte bound', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      summary: 'é'.repeat((request.bounds.maxHandoffSummaryBytes / 2) + 1),
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('fails closed when the authoritative summary bound is not finite', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      summary: 'a'.repeat(request.bounds.maxHandoffSummaryBytes + 1),
    }, handoffAcceptOptions({ maxSummaryBytes: Number.NaN }))).toThrowError(
      'invalid_agent_handoff',
    )
  })

  it('rejects a handoff summary containing non-allowlisted sensitive text', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      summary: 'Result is at /Users/Alice/private/repo with API_TOKEN=summary-secret.',
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects an empty or untrimmed handoff summary', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      summary: ' ',
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects control characters in the allowlisted handoff summary', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      summary: 'Safe prefix\u0000hidden suffix',
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects a noncanonical handoff timestamp', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      createdAt: '2026-08-13T15:04:00Z',
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects a handoff timestamp outside the Coordination Session lifetime', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      createdAt: '2026-08-13T15:10:00.001Z',
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('rejects a noncanonical handoff identity', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      id: '../handoff-1',
    }, handoffAcceptOptions())).toThrowError('invalid_agent_handoff')
  })

  it('accepts an exact duplicate handoff idempotently', () => {
    expect(acceptAgentHandoff(
      JSON.parse(JSON.stringify(agentHandoff)),
      handoffAcceptOptions({ expectedSequence: 2, existingHandoff: agentHandoff }),
    )).toEqual({ handoff: agentHandoff, replayed: true })
  })

  it('accepts an exact duplicate independently of object key insertion order', () => {
    const reordered = Object.fromEntries(Object.entries(agentHandoff).reverse())
    expect(acceptAgentHandoff(
      reordered,
      handoffAcceptOptions({ expectedSequence: 2, existingHandoff: agentHandoff }),
    )).toEqual({ handoff: agentHandoff, replayed: true })
  })

  it('accepts an exact duplicate after the target task version has advanced', () => {
    expect(acceptAgentHandoff(
      agentHandoff,
      handoffAcceptOptions({
        targetTaskVersion: agentHandoff.targetTaskVersion + 1,
        expectedSequence: 2,
        existingHandoff: agentHandoff,
      }),
    )).toEqual({ handoff: agentHandoff, replayed: true })
  })

  it('rejects a conflicting replay of an accepted handoff identity', () => {
    expect(() => acceptAgentHandoff({
      ...agentHandoff,
      summary: 'Conflicting replacement summary.',
    }, handoffAcceptOptions({
      expectedSequence: 2,
      existingHandoff: agentHandoff,
    }))).toThrowError('conflicting_agent_handoff_replay')
  })
})

describe('Coordination state transition contract', () => {
  it('creates one exact running session with deterministic ready tasks', () => {
    expect(createCoordinationSessionState({
      coordination: request,
      graph: taskGraph,
      startedAt: '2026-08-13T15:00:00.001Z',
    })).toEqual({
      stateVersion: 1,
      id: request.id,
      version: 1,
      graphId: taskGraph.id,
      graphVersion: taskGraph.version,
      scope: request.scope,
      authority: request.authority,
      contextDigest: request.contextDigest,
      capabilitySetDigest: request.capabilitySetDigest,
      bounds: request.bounds,
      status: 'running',
      stopReason: null,
      tasks: [
        {
          id: 'task-a',
          version: 1,
          status: 'ready',
          agentId: null,
          runtimeId: null,
          runtimeVersion: null,
          resultDigest: null,
          failure: null,
          attemptFailures: [],
          acceptedDependencyHandoffIds: [],
        },
        {
          id: 'task-b',
          version: 1,
          status: 'ready',
          agentId: null,
          runtimeId: null,
          runtimeVersion: null,
          resultDigest: null,
          failure: null,
          attemptFailures: [],
          acceptedDependencyHandoffIds: [],
        },
        {
          id: 'task-c',
          version: 1,
          status: 'pending',
          agentId: null,
          runtimeId: null,
          runtimeVersion: null,
          resultDigest: null,
          failure: null,
          attemptFailures: [],
          acceptedDependencyHandoffIds: [],
        },
      ],
      counters: {
        specialistStarts: 0,
        activeSpecialists: 0,
        acceptedHandoffs: 0,
        retries: 0,
        steps: 0,
        toolCalls: 0,
        tokens: 0,
        costUsd: 0,
      },
      acceptedHandoffIds: [],
      requestedAt: request.requestedAt,
      startedAt: '2026-08-13T15:00:00.001Z',
      updatedAt: '2026-08-13T15:00:00.001Z',
      deadline: request.deadline,
    })
  })

  it('round-trips one strict session state and rejects unknown persisted metadata', () => {
    const state = createCoordinationSessionState({
      coordination: request,
      graph: taskGraph,
      startedAt: '2026-08-13T15:00:00.001Z',
    })
    expect(parseCoordinationSessionState(JSON.parse(JSON.stringify(state)))).toEqual(state)
    expect(() => parseCoordinationSessionState({
      ...state,
      hiddenPrompt: 'do not persist me',
    })).toThrowError('invalid_coordination_session_state')
  })

  it('rejects counter, identity, and terminal-state corruption after serialization', () => {
    const state = createCoordinationSessionState({
      coordination: request,
      graph: taskGraph,
      startedAt: '2026-08-13T15:00:00.001Z',
    })
    const corrupted = [
      {
        ...state,
        counters: { ...state.counters, activeSpecialists: 1 },
      },
      {
        ...state,
        tasks: state.tasks.map((task, index) =>
          index === 1 ? { ...task, id: state.tasks[0]?.id ?? task.id } : task),
      },
      { ...state, status: 'terminal', stopReason: 'success' },
      {
        ...state,
        status: 'terminal',
        stopReason: 'success',
        tasks: state.tasks.map((task) => ({
          ...task,
          version: task.version + 1,
          status: 'cancelled' as const,
        })),
      },
      {
        ...state,
        counters: { ...state.counters, acceptedHandoffs: 1 },
      },
    ]
    for (const candidate of corrupted) {
      expect(() => parseCoordinationSessionState(candidate)).toThrowError(
        'invalid_coordination_session_state',
      )
    }
  })

  it('starts one ready task with exact session and task versions', () => {
    const state = createCoordinationSessionState({
      coordination: request,
      graph: taskGraph,
      startedAt: '2026-08-13T15:00:00.001Z',
    })

    const next = startCoordinationTask({
      state,
      allocation: specialistAllocation,
      expectedSessionVersion: 1,
      expectedTaskVersion: 1,
      runtimeId: 'specialist-runtime-1',
      runtimeVersion: 1,
      now: '2026-08-13T15:00:01.001Z',
    })

    expect(next.version).toBe(2)
    expect(next.updatedAt).toBe('2026-08-13T15:00:01.001Z')
    expect(next.tasks.find((task) => task.id === 'task-a')).toEqual({
      id: 'task-a',
      version: 2,
      status: 'running',
      agentId: specialistAllocation.agentId,
      runtimeId: 'specialist-runtime-1',
      runtimeVersion: 1,
      resultDigest: null,
      failure: null,
      attemptFailures: [],
      acceptedDependencyHandoffIds: [],
    })
    expect(next.counters).toEqual({
      ...state.counters,
      specialistStarts: 1,
      activeSpecialists: 1,
    })
    expect(parseCoordinationSessionState(next)).toEqual(next)
  })

  it('rejects stale, deadline, concurrency, and remaining-budget start boundaries without mutation', () => {
    const initial = createCoordinationSessionState({
      coordination: request,
      graph: taskGraph,
      startedAt: '2026-08-13T15:00:00.001Z',
    })
    const cases = [
      { state: initial, expectedSessionVersion: 0, expectedTaskVersion: 1, now: '2026-08-13T15:00:01.001Z' },
      { state: initial, expectedSessionVersion: 1, expectedTaskVersion: 2, now: '2026-08-13T15:00:01.001Z' },
      { state: initial, expectedSessionVersion: 1, expectedTaskVersion: 1, now: specialistAllocation.deadline },
      {
        state: {
          ...initial,
          counters: {
            ...initial.counters,
            activeSpecialists: request.bounds.maxParallelSpecialists,
          },
        },
        expectedSessionVersion: 1,
        expectedTaskVersion: 1,
        now: '2026-08-13T15:00:01.001Z',
      },
      {
        state: {
          ...initial,
          counters: {
            ...initial.counters,
            steps: request.bounds.maxSteps - specialistAllocation.budget.maxSteps + 1,
          },
        },
        expectedSessionVersion: 1,
        expectedTaskVersion: 1,
        now: '2026-08-13T15:00:01.001Z',
      },
    ]

    for (const candidate of cases) {
      const before = JSON.stringify(candidate.state)
      expect(() => startCoordinationTask({
        state: candidate.state,
        allocation: specialistAllocation,
        expectedSessionVersion: candidate.expectedSessionVersion,
        expectedTaskVersion: candidate.expectedTaskVersion,
        runtimeId: 'specialist-runtime-1',
        runtimeVersion: 1,
        now: candidate.now,
      })).toThrowError('invalid_coordination_transition')
      expect(JSON.stringify(candidate.state)).toBe(before)
    }
    expect(() => startCoordinationTask({
      state: initial,
      allocation: {
        ...specialistAllocation,
        budget: { ...specialistAllocation.budget, maxCostUsd: Number.NaN },
      },
      expectedSessionVersion: 1,
      expectedTaskVersion: 1,
      runtimeId: 'specialist-runtime-1',
      runtimeVersion: 1,
      now: '2026-08-13T15:00:01.001Z',
    })).toThrowError('invalid_coordination_transition')
  })

  it('records one exact succeeded result and releases its active Specialist slot', () => {
    const started = startCoordinationTask({
      state: createCoordinationSessionState({
        coordination: request,
        graph: taskGraph,
        startedAt: '2026-08-13T15:00:00.001Z',
      }),
      allocation: specialistAllocation,
      expectedSessionVersion: 1,
      expectedTaskVersion: 1,
      runtimeId: 'specialist-runtime-1',
      runtimeVersion: 1,
      now: '2026-08-13T15:00:01.001Z',
    })

    const next = recordCoordinationTaskResult({
      state: started,
      expectedSessionVersion: 2,
      taskId: 'task-a',
      expectedTaskVersion: 2,
      runtimeId: 'specialist-runtime-1',
      expectedRuntimeVersion: 1,
      runtimeVersion: 4,
      result: {
        status: 'succeeded',
        resultDigest: '1'.repeat(64),
        failure: null,
      },
      usage: {
        steps: 2,
        toolCalls: 1,
        tokens: 800,
        costUsd: 0.25,
      },
      now: '2026-08-13T15:03:00.000Z',
    })

    expect(next.version).toBe(3)
    expect(next.tasks.find((task) => task.id === 'task-a')).toEqual({
      id: 'task-a',
      version: 3,
      status: 'succeeded',
      agentId: specialistAllocation.agentId,
      runtimeId: 'specialist-runtime-1',
      runtimeVersion: 4,
      resultDigest: '1'.repeat(64),
      failure: null,
      attemptFailures: [],
      acceptedDependencyHandoffIds: [],
    })
    expect(next.counters).toEqual({
      specialistStarts: 1,
      activeSpecialists: 0,
      acceptedHandoffs: 0,
      retries: 0,
      steps: 2,
      toolCalls: 1,
      tokens: 800,
      costUsd: 0.25,
    })
    expect(parseCoordinationSessionState(next)).toEqual(next)
  })

  it('attributes one Specialist failure and terminates every remaining task fail-closed', () => {
    const started = startCoordinationTask({
      state: createCoordinationSessionState({
        coordination: request,
        graph: taskGraph,
        startedAt: '2026-08-13T15:00:00.001Z',
      }),
      allocation: specialistAllocation,
      expectedSessionVersion: 1,
      expectedTaskVersion: 1,
      runtimeId: 'specialist-runtime-1',
      runtimeVersion: 1,
      now: '2026-08-13T15:00:01.001Z',
    })

    const next = recordCoordinationTaskResult({
      state: started,
      expectedSessionVersion: 2,
      taskId: 'task-a',
      expectedTaskVersion: 2,
      runtimeId: 'specialist-runtime-1',
      expectedRuntimeVersion: 1,
      runtimeVersion: 1,
      result: {
        status: 'failed',
        resultDigest: null,
        failure: {
          category: 'tool_error',
          code: 'tool_execution_failed',
          sourceTaskId: 'task-a',
        },
      },
      usage: { steps: 1, toolCalls: 1, tokens: 200, costUsd: 0.1 },
      now: '2026-08-13T15:02:00.000Z',
    })

    expect(next.status).toBe('terminal')
    expect(next.stopReason).toBe('failure')
    expect(next.counters.activeSpecialists).toBe(0)
    expect(next.tasks.map((task) => ({
      id: task.id,
      version: task.version,
      status: task.status,
      failure: task.failure,
    }))).toEqual([
      {
        id: 'task-a',
        version: 3,
        status: 'failed',
        failure: {
          category: 'tool_error',
          code: 'tool_execution_failed',
          sourceTaskId: 'task-a',
        },
      },
      { id: 'task-b', version: 2, status: 'cancelled', failure: null },
      {
        id: 'task-c',
        version: 2,
        status: 'blocked',
        failure: {
          category: 'dependency_failed',
          code: 'dependency_task_failed',
          sourceTaskId: 'task-a',
        },
      },
    ])
    expect(parseCoordinationSessionState(next)).toEqual(next)
  })

  it('propagates parent cancellation to every active or waiting task and rejects a late result', () => {
    const initial = createCoordinationSessionState({
      coordination: request,
      graph: taskGraph,
      startedAt: '2026-08-13T15:00:00.001Z',
    })
    const left = startCoordinationTask({
      state: initial,
      allocation: specialistAllocation,
      expectedSessionVersion: 1,
      expectedTaskVersion: 1,
      runtimeId: 'specialist-runtime-1',
      runtimeVersion: 1,
      now: '2026-08-13T15:00:01.001Z',
    })
    const both = startCoordinationTask({
      state: left,
      allocation: {
        ...specialistAllocation,
        id: 'specialist-allocation-2',
        taskId: 'task-b',
        roleId: 'test-analyst',
        agentId: 'specialist-2',
        contextDigest: 'd'.repeat(64),
        capabilityIds: ['repository_read', 'saved_test'],
      },
      expectedSessionVersion: 2,
      expectedTaskVersion: 1,
      runtimeId: 'specialist-runtime-2',
      runtimeVersion: 1,
      now: '2026-08-13T15:00:02.001Z',
    })

    const cancelled = cancelCoordinationSession({
      state: both,
      expectedSessionVersion: 3,
      now: '2026-08-13T15:00:03.001Z',
    })

    expect(cancelled.status).toBe('terminal')
    expect(cancelled.stopReason).toBe('cancelled')
    expect(cancelled.counters.activeSpecialists).toBe(0)
    expect(cancelled.tasks.map((task) => [task.id, task.version, task.status])).toEqual([
      ['task-a', 3, 'cancelled'],
      ['task-b', 3, 'cancelled'],
      ['task-c', 2, 'cancelled'],
    ])
    expect(parseCoordinationSessionState(cancelled)).toEqual(cancelled)
    expect(() => recordCoordinationTaskResult({
      state: cancelled,
      expectedSessionVersion: 4,
      taskId: 'task-a',
      expectedTaskVersion: 3,
      runtimeId: 'specialist-runtime-1',
      expectedRuntimeVersion: 1,
      runtimeVersion: 1,
      result: { status: 'succeeded', resultDigest: '1'.repeat(64), failure: null },
      usage: { steps: 1, toolCalls: 0, tokens: 0, costUsd: 0 },
      now: '2026-08-13T15:00:04.001Z',
    })).toThrowError('invalid_coordination_transition')
  })

  it('makes a dependent task ready only after every distinct dependency handoff is accepted', () => {
    const initial = createCoordinationSessionState({
      coordination: request,
      graph: taskGraph,
      startedAt: '2026-08-13T15:00:00.001Z',
    })
    const startedA = startCoordinationTask({
      state: initial,
      allocation: specialistAllocation,
      expectedSessionVersion: 1,
      expectedTaskVersion: 1,
      runtimeId: 'specialist-runtime-1',
      runtimeVersion: 1,
      now: '2026-08-13T15:00:01.001Z',
    })
    const completedA = recordCoordinationTaskResult({
      state: startedA,
      expectedSessionVersion: 2,
      taskId: 'task-a',
      expectedTaskVersion: 2,
      runtimeId: 'specialist-runtime-1',
      expectedRuntimeVersion: 1,
      runtimeVersion: 1,
      result: { status: 'succeeded', resultDigest: '1'.repeat(64), failure: null },
      usage: { steps: 1, toolCalls: 0, tokens: 100, costUsd: 0.1 },
      now: '2026-08-13T15:03:00.000Z',
    })
    const handoffA: AgentHandoff = {
      ...agentHandoff,
      sourceTaskVersion: 3,
      sourceRuntimeVersion: 1,
      targetTaskVersion: 1,
    }
    const joinedA = applyCoordinationHandoff({
      state: completedA,
      coordination: request,
      graph: taskGraph,
      handoff: handoffA,
      sourceResult: {
        taskId: 'task-a',
        taskVersion: 3,
        runtimeId: 'specialist-runtime-1',
        runtimeVersion: 1,
        status: 'succeeded',
        resultDigest: '1'.repeat(64),
        evidenceDigests: ['2'.repeat(64), '3'.repeat(64)],
        contextDigest: 'e'.repeat(64),
        resourceLeaseOutcome: 'not_required',
      },
      expectedSessionVersion: 3,
      expectedTargetTaskVersion: 1,
      priorAcceptedHandoffs: [],
    })

    expect(joinedA.version).toBe(4)
    expect(joinedA.counters.acceptedHandoffs).toBe(1)
    expect(joinedA.tasks.find((task) => task.id === 'task-c')).toMatchObject({
      version: 2,
      status: 'pending',
      acceptedDependencyHandoffIds: [handoffA.id],
    })

    const allocationB: SpecialistAllocationRequest = {
      ...specialistAllocation,
      id: 'specialist-allocation-2',
      taskId: 'task-b',
      roleId: 'test-analyst',
      agentId: 'specialist-2',
      contextDigest: 'd'.repeat(64),
      capabilityIds: ['repository_read', 'saved_test'],
    }
    const startedB = startCoordinationTask({
      state: joinedA,
      allocation: allocationB,
      expectedSessionVersion: 4,
      expectedTaskVersion: 1,
      runtimeId: 'specialist-runtime-2',
      runtimeVersion: 1,
      now: '2026-08-13T15:04:10.000Z',
    })
    const completedB = recordCoordinationTaskResult({
      state: startedB,
      expectedSessionVersion: 5,
      taskId: 'task-b',
      expectedTaskVersion: 2,
      runtimeId: 'specialist-runtime-2',
      expectedRuntimeVersion: 1,
      runtimeVersion: 1,
      result: { status: 'succeeded', resultDigest: '4'.repeat(64), failure: null },
      usage: { steps: 1, toolCalls: 1, tokens: 100, costUsd: 0.1 },
      now: '2026-08-13T15:04:20.000Z',
    })
    const handoffB: AgentHandoff = {
      ...handoffA,
      id: 'handoff-task-b-task-c-2',
      sequence: 2,
      sourceTaskId: 'task-b',
      sourceTaskVersion: 3,
      sourceRuntimeId: 'specialist-runtime-2',
      targetTaskVersion: 2,
      resultDigest: '4'.repeat(64),
      evidenceDigests: ['5'.repeat(64)],
      contextDigest: 'd'.repeat(64),
      summary: 'Test analysis completed with one bounded Evidence reference.',
      createdAt: '2026-08-13T15:04:30.000Z',
    }
    const joinedB = applyCoordinationHandoff({
      state: completedB,
      coordination: request,
      graph: taskGraph,
      handoff: handoffB,
      sourceResult: {
        taskId: 'task-b',
        taskVersion: 3,
        runtimeId: 'specialist-runtime-2',
        runtimeVersion: 1,
        status: 'succeeded',
        resultDigest: '4'.repeat(64),
        evidenceDigests: ['5'.repeat(64)],
        contextDigest: 'd'.repeat(64),
        resourceLeaseOutcome: 'not_required',
      },
      expectedSessionVersion: 6,
      expectedTargetTaskVersion: 2,
      priorAcceptedHandoffs: [handoffA],
    })

    expect(joinedB.version).toBe(7)
    expect(joinedB.counters.acceptedHandoffs).toBe(2)
    expect(joinedB.tasks.find((task) => task.id === 'task-c')).toMatchObject({
      version: 3,
      status: 'ready',
      acceptedDependencyHandoffIds: [handoffA.id, handoffB.id],
    })
    expect(parseCoordinationSessionState(joinedB)).toEqual(joinedB)
    expect(applyCoordinationHandoff({
      state: joinedB,
      coordination: request,
      graph: taskGraph,
      handoff: handoffA,
      sourceResult: {
        taskId: 'task-a',
        taskVersion: 3,
        runtimeId: 'specialist-runtime-1',
        runtimeVersion: 1,
        status: 'succeeded',
        resultDigest: '1'.repeat(64),
        evidenceDigests: ['2'.repeat(64), '3'.repeat(64)],
        contextDigest: 'e'.repeat(64),
        resourceLeaseOutcome: 'not_required',
      },
      expectedSessionVersion: 7,
      expectedTargetTaskVersion: 3,
      priorAcceptedHandoffs: [handoffA, handoffB],
    })).toBe(joinedB)
  })

  it('stops at the exact shared budget boundary and rejects usage one unit beyond it', () => {
    const started = startCoordinationTask({
      state: createCoordinationSessionState({
        coordination: request,
        graph: taskGraph,
        startedAt: '2026-08-13T15:00:00.001Z',
      }),
      allocation: specialistAllocation,
      expectedSessionVersion: 1,
      expectedTaskVersion: 1,
      runtimeId: 'specialist-runtime-1',
      runtimeVersion: 1,
      now: '2026-08-13T15:00:01.001Z',
    })
    const atBoundary = recordCoordinationTaskResult({
      state: started,
      expectedSessionVersion: 2,
      taskId: 'task-a',
      expectedTaskVersion: 2,
      runtimeId: 'specialist-runtime-1',
      expectedRuntimeVersion: 1,
      runtimeVersion: 1,
      result: { status: 'succeeded', resultDigest: '1'.repeat(64), failure: null },
      usage: {
        steps: request.bounds.maxSteps,
        toolCalls: request.bounds.maxToolCalls,
        tokens: request.bounds.maxTokens,
        costUsd: request.bounds.maxCostUsd,
      },
      now: '2026-08-13T15:03:00.000Z',
    })

    expect(atBoundary.status).toBe('terminal')
    expect(atBoundary.stopReason).toBe('budget_exhausted')
    expect(atBoundary.counters).toMatchObject({
      activeSpecialists: 0,
      steps: request.bounds.maxSteps,
      toolCalls: request.bounds.maxToolCalls,
      tokens: request.bounds.maxTokens,
      costUsd: request.bounds.maxCostUsd,
    })
    expect(atBoundary.tasks.map((task) => task.status)).toEqual([
      'succeeded',
      'cancelled',
      'cancelled',
    ])
    expect(() => recordCoordinationTaskResult({
      state: started,
      expectedSessionVersion: 2,
      taskId: 'task-a',
      expectedTaskVersion: 2,
      runtimeId: 'specialist-runtime-1',
      expectedRuntimeVersion: 1,
      runtimeVersion: 1,
      result: { status: 'succeeded', resultDigest: '1'.repeat(64), failure: null },
      usage: {
        steps: request.bounds.maxSteps + 1,
        toolCalls: 0,
        tokens: 0,
        costUsd: 0,
      },
      now: '2026-08-13T15:03:00.000Z',
    })).toThrowError('invalid_coordination_transition')
  })

  it('records one explicit bounded Specialist retry without silently reassigning the task', () => {
    const started = startCoordinationTask({
      state: createCoordinationSessionState({
        coordination: request,
        graph: taskGraph,
        startedAt: '2026-08-13T15:00:00.001Z',
      }),
      allocation: specialistAllocation,
      expectedSessionVersion: 1,
      expectedTaskVersion: 1,
      runtimeId: 'specialist-runtime-1',
      runtimeVersion: 1,
      now: '2026-08-13T15:00:01.001Z',
    })
    const failure = {
      category: 'tool_error' as const,
      code: 'recoverable_tool_error',
      sourceTaskId: 'task-a',
    }
    const retried = retryCoordinationTask({
      state: started,
      expectedSessionVersion: 2,
      taskId: 'task-a',
      expectedTaskVersion: 2,
      runtimeId: 'specialist-runtime-1',
      expectedRuntimeVersion: 1,
      runtimeVersion: 1,
      failure,
      replacementRuntimeId: 'specialist-runtime-1-retry-1',
      replacementRuntimeVersion: 1,
      usage: { steps: 1, toolCalls: 1, tokens: 100, costUsd: 0.1 },
      now: '2026-08-13T15:01:00.000Z',
    })

    expect(retried.version).toBe(3)
    expect(retried.tasks.find((task) => task.id === 'task-a')).toMatchObject({
      version: 3,
      status: 'running',
      agentId: specialistAllocation.agentId,
      runtimeId: 'specialist-runtime-1-retry-1',
      runtimeVersion: 1,
      resultDigest: null,
      failure: null,
      attemptFailures: [failure],
    })
    expect(retried.counters).toMatchObject({
      specialistStarts: 2,
      activeSpecialists: 1,
      retries: 1,
      steps: 1,
      toolCalls: 1,
      tokens: 100,
      costUsd: 0.1,
    })
    expect(parseCoordinationSessionState(retried)).toEqual(retried)
    expect(() => retryCoordinationTask({
      state: retried,
      expectedSessionVersion: 3,
      taskId: 'task-a',
      expectedTaskVersion: 3,
      runtimeId: 'specialist-runtime-1-retry-1',
      expectedRuntimeVersion: 1,
      runtimeVersion: 1,
      failure,
      replacementRuntimeId: 'specialist-runtime-1-retry-2',
      replacementRuntimeVersion: 1,
      usage: { steps: 0, toolCalls: 0, tokens: 0, costUsd: 0 },
      now: '2026-08-13T15:02:00.000Z',
    })).toThrowError('invalid_coordination_transition')
  })
})

describe('Coordination resource lease contract', () => {
  const resourceDigest = 'f'.repeat(64)
  const leaseGraph: AgentTaskGraph = {
    stateVersion: 1,
    id: 'lease-graph-1',
    coordinationId: request.id,
    version: 1,
    entryTaskIds: ['lease-task-a', 'lease-task-b', 'lease-task-c'],
    nodes: [
      {
        id: 'lease-task-a',
        roleId: 'contract-analyst',
        contextDigest: '1'.repeat(64),
        capabilityIds: ['repository_read'],
        resourceRequirements: [{
          resourceId: 'repository-source-1',
          resourceDigest,
          mode: 'read',
        }],
      },
      {
        id: 'lease-task-b',
        roleId: 'test-analyst',
        contextDigest: '2'.repeat(64),
        capabilityIds: ['repository_read'],
        resourceRequirements: [{
          resourceId: 'repository-source-1',
          resourceDigest,
          mode: 'read',
        }],
      },
      {
        id: 'lease-task-c',
        roleId: 'bounded-implementer',
        contextDigest: '3'.repeat(64),
        capabilityIds: ['managed_workspace_edit'],
        resourceRequirements: [{
          resourceId: 'repository-source-1',
          resourceDigest,
          mode: 'write',
        }],
      },
    ],
    edges: [],
  }
  const allocation = (
    taskId: string,
    agentId: string,
    capabilityIds: string[],
    mode: 'read' | 'write',
  ): SpecialistAllocationRequest => ({
    ...specialistAllocation,
    id: `allocation-${taskId}`,
    taskGraphId: leaseGraph.id,
    taskId,
    roleId: leaseGraph.nodes.find((node) => node.id === taskId)!.roleId,
    agentId,
    contextDigest: leaseGraph.nodes.find((node) => node.id === taskId)!.contextDigest,
    capabilityIds,
    resourceRequirements: [{
      resourceId: 'repository-source-1',
      resourceDigest,
      mode,
    }],
  })
  const runningState = () => {
    const initial = createCoordinationSessionState({
      coordination: request,
      graph: leaseGraph,
      startedAt: '2026-08-13T15:00:00.001Z',
    })
    const first = startCoordinationTask({
      state: initial,
      allocation: allocation('lease-task-a', 'lease-agent-a', ['repository_read'], 'read'),
      expectedSessionVersion: 1,
      expectedTaskVersion: 1,
      runtimeId: 'lease-runtime-a',
      runtimeVersion: 1,
      now: '2026-08-13T15:00:01.000Z',
    })
    const second = startCoordinationTask({
      state: first,
      allocation: allocation('lease-task-b', 'lease-agent-b', ['repository_read'], 'read'),
      expectedSessionVersion: 2,
      expectedTaskVersion: 1,
      runtimeId: 'lease-runtime-b',
      runtimeVersion: 1,
      now: '2026-08-13T15:00:01.001Z',
    })
    return startCoordinationTask({
      state: second,
      allocation: allocation(
        'lease-task-c',
        'lease-agent-c',
        ['managed_workspace_edit'],
        'write',
      ),
      expectedSessionVersion: 3,
      expectedTaskVersion: 1,
      runtimeId: 'lease-runtime-c',
      runtimeVersion: 1,
      now: '2026-08-13T15:00:01.002Z',
    })
  }
  const lease = (
    id: string,
    taskId: string,
    runtimeId: string,
    capabilityId: string,
    mode: 'read' | 'write',
  ): CoordinationResourceLease => ({
    stateVersion: 1,
    id,
    coordinationId: request.id,
    taskId,
    taskVersion: 2,
    runtimeId,
    runtimeVersion: 1,
    scope: request.scope,
    capabilityId,
    capabilityVersion: 1,
    resourceId: 'repository-source-1',
    resourceDigest,
    mode,
    status: 'active',
    version: 1,
    acquiredAt: '2026-08-13T15:00:02.000Z',
    expiresAt: '2026-08-13T15:01:02.000Z',
    releasedAt: null,
  })

  it('accepts concurrent exact readers and rejects a writer while either reader is active', () => {
    const state = runningState()
    const readerA = lease(
      'lease-reader-a',
      'lease-task-a',
      'lease-runtime-a',
      'repository_read',
      'read',
    )
    const readerB = lease(
      'lease-reader-b',
      'lease-task-b',
      'lease-runtime-b',
      'repository_read',
      'read',
    )
    const writer = lease(
      'lease-writer-c',
      'lease-task-c',
      'lease-runtime-c',
      'managed_workspace_edit',
      'write',
    )

    expect(acceptCoordinationResourceLease(readerA, {
      coordination: request,
      graph: leaseGraph,
      state,
      existingLeases: [],
    })).toEqual({ lease: readerA, replayed: false })
    expect(acceptCoordinationResourceLease(readerB, {
      coordination: request,
      graph: leaseGraph,
      state,
      existingLeases: [readerA],
    })).toEqual({ lease: readerB, replayed: false })
    expect(acceptCoordinationResourceLease(writer, {
      coordination: request,
      graph: leaseGraph,
      state,
      existingLeases: [],
    })).toEqual({ lease: writer, replayed: false })
    expect(() => acceptCoordinationResourceLease(writer, {
      coordination: request,
      graph: leaseGraph,
      state,
      existingLeases: [readerA, readerB],
    })).toThrowError('coordination_resource_conflict')
  })

  it('replays one exact lease and rejects a conflicting reuse of its identity', () => {
    const state = runningState()
    const reader = lease(
      'lease-reader-a',
      'lease-task-a',
      'lease-runtime-a',
      'repository_read',
      'read',
    )
    expect(acceptCoordinationResourceLease(
      JSON.parse(JSON.stringify(reader)),
      {
        coordination: request,
        graph: leaseGraph,
        state,
        existingLeases: [reader],
      },
    )).toEqual({ lease: reader, replayed: true })
    expect(() => acceptCoordinationResourceLease({
      ...reader,
      expiresAt: '2026-08-13T15:01:01.000Z',
    }, {
      coordination: request,
      graph: leaseGraph,
      state,
      existingLeases: [reader],
    })).toThrowError('coordination_resource_conflict')
  })

  it('rejects a second active lease identity for the same task and resource', () => {
    const state = runningState()
    const reader = lease(
      'lease-reader-a',
      'lease-task-a',
      'lease-runtime-a',
      'repository_read',
      'read',
    )
    expect(() => acceptCoordinationResourceLease({
      ...reader,
      id: 'lease-reader-a-duplicate',
    }, {
      coordination: request,
      graph: leaseGraph,
      state,
      existingLeases: [reader],
    })).toThrowError('coordination_resource_conflict')
  })

  it('rejects a reader behind an active writer and keeps release ordering monotonic', () => {
    const state = runningState()
    const reader = lease(
      'lease-reader-a',
      'lease-task-a',
      'lease-runtime-a',
      'repository_read',
      'read',
    )
    const writer = lease(
      'lease-writer-c',
      'lease-task-c',
      'lease-runtime-c',
      'managed_workspace_edit',
      'write',
    )
    expect(() => acceptCoordinationResourceLease(reader, {
      coordination: request,
      graph: leaseGraph,
      state,
      existingLeases: [writer],
    })).toThrowError('coordination_resource_conflict')

    const releasedReader: CoordinationResourceLease = {
      ...reader,
      status: 'released',
      version: 2,
      releasedAt: '2026-08-13T15:00:03.000Z',
    }
    expect(() => acceptCoordinationResourceLease(writer, {
      coordination: request,
      graph: leaseGraph,
      state,
      existingLeases: [releasedReader],
    })).toThrowError('coordination_resource_conflict')
    const writerAfterRelease = {
      ...writer,
      acquiredAt: '2026-08-13T15:00:03.000Z',
      expiresAt: '2026-08-13T15:01:03.000Z',
    }
    expect(acceptCoordinationResourceLease(writerAfterRelease, {
      coordination: request,
      graph: leaseGraph,
      state,
      existingLeases: [releasedReader],
    })).toEqual({ lease: writerAfterRelease, replayed: false })
  })

  it('does not infer clearance from elapsed time while a lease remains active', () => {
    const state = runningState()
    const reader = lease(
      'lease-reader-a',
      'lease-task-a',
      'lease-runtime-a',
      'repository_read',
      'read',
    )
    const writer = {
      ...lease(
        'lease-writer-c',
        'lease-task-c',
        'lease-runtime-c',
        'managed_workspace_edit',
        'write',
      ),
      acquiredAt: reader.expiresAt,
      expiresAt: '2026-08-13T15:02:02.000Z',
    }
    expect(() => acceptCoordinationResourceLease(writer, {
      coordination: request,
      graph: leaseGraph,
      state,
      existingLeases: [reader],
    })).toThrowError('coordination_resource_conflict')
  })

  it.each([
    ['unknown field', { unexpected: true }],
    ['overlong duration', { expiresAt: '2026-08-13T15:01:02.001Z' }],
    ['pre-state acquisition', { acquiredAt: '2026-08-13T15:00:01.001Z' }],
  ])('rejects an invalid %s boundary', (_label, override) => {
    expect(() => acceptCoordinationResourceLease({
      ...lease(
        'lease-reader-a',
        'lease-task-a',
        'lease-runtime-a',
        'repository_read',
        'read',
      ),
      ...override,
    }, {
      coordination: request,
      graph: leaseGraph,
      state: runningState(),
      existingLeases: [],
    })).toThrowError('invalid_coordination_resource_lease')
  })

  it.each([
    ['task', { taskId: 'lease-task-b' }],
    ['runtime', { runtimeId: 'lease-runtime-b' }],
    ['capability', { capabilityId: 'managed_workspace_edit' }],
    ['resource', { resourceId: 'foreign-resource' }],
    ['digest', { resourceDigest: '0'.repeat(64) }],
    ['scope', { scope: { ...request.scope, projectId: 'foreign-project' } }],
  ])('rejects a lease with mismatched %s identity', (_label, override) => {
    const candidate = {
      ...lease(
        'lease-reader-a',
        'lease-task-a',
        'lease-runtime-a',
        'repository_read',
        'read',
      ),
      ...override,
    }
    expect(() => acceptCoordinationResourceLease(candidate, {
      coordination: request,
      graph: leaseGraph,
      state: runningState(),
      existingLeases: [],
    })).toThrowError('invalid_coordination_resource_lease')
  })

  it('releases and cancels an active lease through one monotonic version transition', () => {
    const reader = lease(
      'lease-reader-a',
      'lease-task-a',
      'lease-runtime-a',
      'repository_read',
      'read',
    )
    expect(settleCoordinationResourceLease({
      lease: reader,
      expectedVersion: 1,
      outcome: 'released',
      now: '2026-08-13T15:00:30.000Z',
    }, { coordination: request, graph: leaseGraph })).toEqual({
      ...reader,
      status: 'released',
      version: 2,
      releasedAt: '2026-08-13T15:00:30.000Z',
    })
    expect(settleCoordinationResourceLease({
      lease: reader,
      expectedVersion: 1,
      outcome: 'cancelled',
      now: '2026-08-13T15:00:30.000Z',
    }, { coordination: request, graph: leaseGraph })).toEqual({
      ...reader,
      status: 'cancelled',
      version: 2,
      releasedAt: '2026-08-13T15:00:30.000Z',
    })
  })

  it('expires a lease only at the exact durable expiry boundary', () => {
    const reader = lease(
      'lease-reader-a',
      'lease-task-a',
      'lease-runtime-a',
      'repository_read',
      'read',
    )
    expect(() => settleCoordinationResourceLease({
      lease: reader,
      expectedVersion: 1,
      outcome: 'expired',
      now: '2026-08-13T15:01:01.999Z',
    }, { coordination: request, graph: leaseGraph }))
      .toThrowError('invalid_coordination_resource_lease_transition')
    expect(settleCoordinationResourceLease({
      lease: reader,
      expectedVersion: 1,
      outcome: 'expired',
      now: reader.expiresAt,
    }, { coordination: request, graph: leaseGraph })).toEqual({
      ...reader,
      status: 'expired',
      version: 2,
      releasedAt: reader.expiresAt,
    })
  })

  it('rejects stale versions, late release, and terminal outcome rewrites', () => {
    const reader = lease(
      'lease-reader-a',
      'lease-task-a',
      'lease-runtime-a',
      'repository_read',
      'read',
    )
    const released = {
      ...reader,
      status: 'released' as const,
      version: 2,
      releasedAt: '2026-08-13T15:00:30.000Z',
    }
    for (const candidate of [
      { lease: reader, expectedVersion: 2, outcome: 'released' as const, now: released.releasedAt },
      { lease: reader, expectedVersion: 1, outcome: 'released' as const, now: reader.expiresAt },
      { lease: released, expectedVersion: 2, outcome: 'cancelled' as const, now: released.releasedAt },
    ]) {
      expect(() => settleCoordinationResourceLease(candidate, {
        coordination: request,
        graph: leaseGraph,
      })).toThrowError('invalid_coordination_resource_lease_transition')
    }
  })
})
