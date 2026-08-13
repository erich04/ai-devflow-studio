import { describe, expect, it, vi } from 'vitest'
import type { CoordinationRecoverySnapshot } from './local-store'
import { createAgentCoordinationRendererAccess } from './agent-coordination-renderer-access'

const digest = (value: string) => value.repeat(64)

function recoveryFixture(input: {
  coordinationId: string
  runId: string
  localProjectId: string
  updatedAt: string
}): CoordinationRecoverySnapshot {
  const bounds = {
    maxSpecialists: 1,
    maxTaskNodes: 1,
    maxDependencyEdges: 1,
    maxDelegationDepth: 1,
    maxParallelSpecialists: 1,
    maxAcceptedHandoffs: 1,
    maxSpecialistRetries: 1,
    maxHandoffSummaryBytes: 4_096,
    maxSteps: 2,
    maxWallTimeMs: 120_000,
    maxToolCalls: 2,
    maxTokens: 2_000,
    maxCostUsd: 1,
  }
  const scope = {
    organizationId: `secret-org-${input.coordinationId}`,
    projectId: `team-project-${input.coordinationId}`,
    userId: `secret-user-${input.coordinationId}`,
    sessionId: `secret-session-${input.coordinationId}`,
    localProjectId: input.localProjectId,
  }
  const authority = {
    runId: input.runId,
    nodeId: `${input.runId}-build`,
    runVersion: 1,
    policyVersion: 1,
    supervisorRuntimeId: `secret-supervisor-${input.coordinationId}`,
    supervisorRuntimeVersion: 1,
  }
  const coordination = {
    stateVersion: 1 as const,
    id: input.coordinationId,
    scope,
    authority,
    contextDigest: digest('a'),
    capabilitySetDigest: digest('b'),
    bounds,
    requestedAt: '2026-08-13T15:00:00.000Z',
    deadline: '2026-08-13T15:02:00.000Z',
  }
  const graph = {
    stateVersion: 1 as const,
    id: `graph-${input.coordinationId}`,
    coordinationId: input.coordinationId,
    version: 1,
    entryTaskIds: ['task-1'],
    nodes: [{
      id: 'task-1',
      roleId: 'contract-analyst',
      contextDigest: digest('c'),
      capabilityIds: ['repository_read'],
      resourceRequirements: [{
        resourceId: input.localProjectId,
        resourceDigest: digest('d'),
        mode: 'read' as const,
      }],
    }],
    edges: [],
  }
  const state = {
    stateVersion: 1 as const,
    id: input.coordinationId,
    version: 1,
    graphId: graph.id,
    graphVersion: 1,
    scope,
    authority,
    contextDigest: coordination.contextDigest,
    capabilitySetDigest: coordination.capabilitySetDigest,
    bounds,
    status: 'running' as const,
    stopReason: null,
    tasks: [{
      id: 'task-1',
      version: 1,
      status: 'ready' as const,
      agentId: null,
      runtimeId: null,
      runtimeVersion: null,
      resultDigest: null,
      failure: null,
      attemptFailures: [],
      acceptedDependencyHandoffIds: [],
    }],
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
    requestedAt: coordination.requestedAt,
    startedAt: coordination.requestedAt,
    updatedAt: input.updatedAt,
    deadline: coordination.deadline,
  }
  return { coordination, graph, state, handoffs: [], leases: [], audits: [], checkpoints: [] }
}

describe('Agent Coordination renderer access', () => {
  it('lists and reads only metadata for the exact selected Run and local project', async () => {
    const selected = recoveryFixture({
      coordinationId: 'coordination-selected',
      runId: 'run-selected',
      localProjectId: 'project-selected',
      updatedAt: '2026-08-13T15:00:01.000Z',
    })
    const other = recoveryFixture({
      coordinationId: 'coordination-other',
      runId: 'run-other',
      localProjectId: 'project-other',
      updatedAt: '2026-08-13T15:00:02.000Z',
    })
    const store = {
      listCoordinationRecoverySnapshots: vi.fn(async () => [other, selected]),
      getCoordinationRecoverySnapshot: vi.fn(async (coordinationId: string) =>
        [selected, other].find((snapshot) => snapshot.coordination.id === coordinationId) ?? null),
    }
    const access = createAgentCoordinationRendererAccess(store)

    await expect(access.list({
      runId: 'run-selected',
      localProjectId: 'project-selected',
    })).resolves.toEqual([expect.objectContaining({
      session: expect.objectContaining({
        coordinationId: 'coordination-selected',
        runId: 'run-selected',
        localProjectId: 'project-selected',
      }),
      redacted: true,
    })])
    await expect(access.get({
      coordinationId: 'coordination-other',
      runId: 'run-selected',
      localProjectId: 'project-selected',
    })).rejects.toThrowError('Agent Coordination renderer selection is stale')

    const detail = await access.get({
      coordinationId: 'coordination-selected',
      runId: 'run-selected',
      localProjectId: 'project-selected',
    })
    expect(detail.tasks).toHaveLength(1)
    expect(JSON.stringify(detail)).not.toMatch(
      /secret-org|secret-user|secret-session|secret-supervisor|scope|summary|\/Users\//,
    )
  })
})
