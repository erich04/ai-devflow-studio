import { describe, expect, it } from 'vitest'
import {
  createCoordinationRendererSnapshot,
  parseCoordinationRendererSnapshot,
} from './agent-coordination-projection'
import type {
  AgentHandoff,
  AgentTaskGraph,
  CoordinationResourceLease,
  CoordinationSessionRequest,
  CoordinationSessionState,
} from './agent-coordination'

const now = '2026-08-13T15:00:00.000Z'
const deadline = '2026-08-13T15:10:00.000Z'
const digest = (value: string) => value.repeat(64)

function projectionFixture() {
  const bounds = {
    maxSpecialists: 2,
    maxTaskNodes: 2,
    maxDependencyEdges: 1,
    maxDelegationDepth: 1,
    maxParallelSpecialists: 2,
    maxAcceptedHandoffs: 1,
    maxSpecialistRetries: 1,
    maxHandoffSummaryBytes: 4_096,
    maxSteps: 4,
    maxWallTimeMs: 600_000,
    maxToolCalls: 4,
    maxTokens: 10_000,
    maxCostUsd: 1,
  }
  const coordination: CoordinationSessionRequest = {
    stateVersion: 1,
    id: 'coordination-projection-1',
    scope: {
      organizationId: 'secret-organization',
      projectId: 'team-project-1',
      userId: 'secret-user',
      sessionId: 'secret-session',
      localProjectId: 'local-project-1',
    },
    authority: {
      runId: 'run-projection-1',
      nodeId: 'run-projection-1-build',
      runVersion: 7,
      policyVersion: 3,
      supervisorRuntimeId: 'supervisor-runtime-secret',
      supervisorRuntimeVersion: 5,
    },
    contextDigest: digest('a'),
    capabilitySetDigest: digest('b'),
    bounds,
    requestedAt: now,
    deadline,
  }
  const graph: AgentTaskGraph = {
    stateVersion: 1,
    id: 'coordination-graph-projection-1',
    coordinationId: coordination.id,
    version: 1,
    entryTaskIds: ['task-contract'],
    nodes: [
      {
        id: 'task-contract',
        roleId: 'contract-analyst',
        contextDigest: digest('c'),
        capabilityIds: ['repository_read'],
        resourceRequirements: [{
          resourceId: 'local-project-1',
          resourceDigest: digest('d'),
          mode: 'read',
        }],
      },
      {
        id: 'task-test',
        roleId: 'test-analyst',
        contextDigest: digest('e'),
        capabilityIds: ['repository_read'],
        resourceRequirements: [{
          resourceId: 'local-project-1',
          resourceDigest: digest('d'),
          mode: 'read',
        }],
      },
    ],
    edges: [{ id: 'edge-contract-test', sourceTaskId: 'task-contract', targetTaskId: 'task-test' }],
  }
  const state: CoordinationSessionState = {
    stateVersion: 1,
    id: coordination.id,
    version: 4,
    graphId: graph.id,
    graphVersion: graph.version,
    scope: coordination.scope,
    authority: coordination.authority,
    contextDigest: coordination.contextDigest,
    capabilitySetDigest: coordination.capabilitySetDigest,
    bounds,
    status: 'running',
    stopReason: null,
    tasks: [
      {
        id: 'task-contract',
        version: 3,
        status: 'succeeded',
        agentId: 'specialist-agent-contract',
        runtimeId: 'specialist-runtime-contract',
        runtimeVersion: 4,
        resultDigest: digest('f'),
        failure: null,
        attemptFailures: [],
        acceptedDependencyHandoffIds: [],
      },
      {
        id: 'task-test',
        version: 2,
        status: 'ready',
        agentId: null,
        runtimeId: null,
        runtimeVersion: null,
        resultDigest: null,
        failure: null,
        attemptFailures: [],
        acceptedDependencyHandoffIds: ['handoff-contract-test'],
      },
    ],
    counters: {
      specialistStarts: 1,
      activeSpecialists: 0,
      acceptedHandoffs: 1,
      retries: 0,
      steps: 1,
      toolCalls: 1,
      tokens: 200,
      costUsd: 0.1,
    },
    acceptedHandoffIds: ['handoff-contract-test'],
    requestedAt: now,
    startedAt: now,
    updatedAt: '2026-08-13T15:00:04.000Z',
    deadline,
  }
  const handoffs: AgentHandoff[] = [{
    stateVersion: 1,
    id: 'handoff-contract-test',
    coordinationId: coordination.id,
    sequence: 1,
    scope: coordination.scope,
    sourceTaskId: 'task-contract',
    sourceTaskVersion: 3,
    sourceRuntimeId: 'specialist-runtime-contract',
    sourceRuntimeVersion: 4,
    targetTaskId: 'task-test',
    targetTaskVersion: 2,
    resultDigest: digest('f'),
    evidenceDigests: [digest('1')],
    contextDigest: digest('c'),
    resourceLeaseOutcome: 'released',
    summary: 'secret summary /Users/erich/worktree token=ghp_secret',
    createdAt: '2026-08-13T15:00:04.000Z',
  }]
  const leases: CoordinationResourceLease[] = [{
    stateVersion: 1,
    id: 'lease-contract-read',
    coordinationId: coordination.id,
    taskId: 'task-contract',
    taskVersion: 2,
    runtimeId: 'specialist-runtime-contract',
    runtimeVersion: 1,
    scope: coordination.scope,
    capabilityId: 'repository_read',
    capabilityVersion: 1,
    resourceId: 'local-project-1',
    resourceDigest: digest('d'),
    mode: 'read',
    status: 'released',
    version: 2,
    acquiredAt: '2026-08-13T15:00:01.000Z',
    expiresAt: '2026-08-13T15:01:01.000Z',
    releasedAt: '2026-08-13T15:00:03.000Z',
  }]
  return { coordination, graph, state, handoffs, leases }
}

describe('Agent Coordination renderer projection', () => {
  it('projects exact graph, role, dependency, bound, failure, handoff, and lease metadata only', () => {
    const snapshot = createCoordinationRendererSnapshot(projectionFixture())

    expect(snapshot).toMatchObject({
      projectionVersion: 1,
      session: {
        coordinationId: 'coordination-projection-1',
        runId: 'run-projection-1',
        localProjectId: 'local-project-1',
        version: 4,
        taskCount: 2,
        edgeCount: 1,
        acceptedHandoffCount: 1,
        status: 'running',
        redacted: true,
      },
      tasks: [
        {
          taskId: 'task-contract',
          roleId: 'contract-analyst',
          dependencyTaskIds: [],
          capabilityIds: ['repository_read'],
          status: 'succeeded',
          resultDigest: digest('f'),
          redacted: true,
        },
        {
          taskId: 'task-test',
          roleId: 'test-analyst',
          dependencyTaskIds: ['task-contract'],
          status: 'ready',
          acceptedDependencyHandoffIds: ['handoff-contract-test'],
          redacted: true,
        },
      ],
      handoffs: [{ handoffId: 'handoff-contract-test', sequence: 1, redacted: true }],
      leases: [{ leaseId: 'lease-contract-read', status: 'released', redacted: true }],
      readyTaskIds: ['task-test'],
      redacted: true,
    })
    expect(parseCoordinationRendererSnapshot(snapshot)).toEqual(snapshot)
    const serialized = JSON.stringify(snapshot)
    for (const forbidden of [
      'secret-organization',
      'secret-user',
      'secret-session',
      'supervisor-runtime-secret',
      'secret summary',
      '/Users/erich/worktree',
      'ghp_secret',
      'summary',
      'scope',
    ]) expect(serialized).not.toContain(forbidden)
  })

  it('rejects extra renderer fields instead of accepting hidden local content', () => {
    const snapshot = createCoordinationRendererSnapshot(projectionFixture())
    expect(() => parseCoordinationRendererSnapshot({
      ...snapshot,
      summary: 'hidden reasoning',
    })).toThrowError('invalid_coordination_renderer_snapshot')
    expect(() => parseCoordinationRendererSnapshot({
      ...snapshot,
      tasks: [{ ...snapshot.tasks[0], localPath: '/tmp/private' }, ...snapshot.tasks.slice(1)],
    })).toThrowError('invalid_coordination_renderer_snapshot')
  })
})
