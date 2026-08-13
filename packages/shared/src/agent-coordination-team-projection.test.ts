import { describe, expect, it } from 'vitest'
import {
  createRemoteAgentCoordinationSummary,
  parseRemoteAgentCoordinationSummary,
  type RemoteAgentCoordinationSummary,
} from './agent-coordination-team-projection'
import type { CoordinationRendererSnapshot } from './agent-coordination-projection'

const summary: RemoteAgentCoordinationSummary = {
  stateVersion: 1,
  projectionVersion: 1,
  coordinationId: 'coordination-team-1',
  projectId: 'project-team-1',
  runId: 'run-team-1',
  nodeId: 'run-team-1-build',
  coordinationVersion: 7,
  graphVersion: 1,
  status: 'terminal',
  stopReason: 'success',
  roleCounts: [
    { roleId: 'contract-reviewer', count: 1 },
    { roleId: 'test-reviewer', count: 2 },
  ],
  taskStatusCounts: {
    pending: 0,
    ready: 0,
    running: 0,
    succeeded: 3,
    failed: 0,
    cancelled: 0,
    blocked: 0,
  },
  failureCategoryCounts: {
    timeout: 0,
    budget_exhausted: 0,
    policy_denied: 0,
    tool_error: 0,
    coding_executor_error: 0,
    invalid_result: 0,
    dependency_failed: 0,
  },
  taskCount: 3,
  edgeCount: 2,
  specialistStarts: 3,
  acceptedHandoffCount: 2,
  retryCount: 0,
  stepCount: 6,
  toolCallCount: 2,
  tokenCount: 0,
  costUsd: 0,
  singleAgentQuality: 0.5,
  coordinationQuality: 0.8,
  latencyMs: 1_500,
  humanInterventionCount: 0,
  authorityViolationCount: 0,
  isolationViolationCount: 0,
  terminationViolationCount: 0,
  replayViolationCount: 0,
  redactionViolationCount: 0,
  updatedAt: '2026-08-13T21:00:00.000Z',
  isolated: true,
  redacted: true,
}

describe('Agent Coordination Team projection', () => {
  it('derives one metadata-only summary from the strict Desktop projection', () => {
    const snapshot: CoordinationRendererSnapshot = {
      projectionVersion: 1,
      session: {
        projectionVersion: 1,
        coordinationId: 'coordination-team-1',
        graphId: 'coordination-graph-team-1',
        graphVersion: 1,
        runId: 'run-team-1',
        nodeId: 'run-team-1-build',
        localProjectId: 'local-project-private',
        runVersion: 7,
        policyVersion: 3,
        version: 4,
        status: 'running',
        stopReason: null,
        bounds: {
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
        },
        counters: {
          specialistStarts: 1,
          activeSpecialists: 0,
          acceptedHandoffs: 0,
          retries: 0,
          steps: 1,
          toolCalls: 1,
          tokens: 200,
          costUsd: 0.1,
        },
        taskCount: 2,
        edgeCount: 1,
        acceptedHandoffCount: 0,
        requestedAt: '2026-08-13T15:00:00.000Z',
        startedAt: '2026-08-13T15:00:00.000Z',
        updatedAt: '2026-08-13T15:00:04.000Z',
        deadline: '2026-08-13T15:10:00.000Z',
        redacted: true,
      },
      tasks: [
        {
          projectionVersion: 1,
          taskId: 'task-contract',
          version: 3,
          roleId: 'contract-reviewer',
          dependencyTaskIds: [],
          capabilityIds: ['repository_read'],
          contextDigest: 'a'.repeat(64),
          resources: [],
          status: 'succeeded',
          agentId: 'specialist-contract',
          runtimeId: 'runtime-contract',
          runtimeVersion: 4,
          resultDigest: 'b'.repeat(64),
          failure: null,
          attemptFailures: [{
            category: 'tool_error',
            code: 'read_failed',
            sourceTaskId: 'task-contract',
          }],
          acceptedDependencyHandoffIds: [],
          redacted: true,
        },
        {
          projectionVersion: 1,
          taskId: 'task-test',
          version: 1,
          roleId: 'test-reviewer',
          dependencyTaskIds: ['task-contract'],
          capabilityIds: ['repository_read'],
          contextDigest: 'c'.repeat(64),
          resources: [],
          status: 'ready',
          agentId: null,
          runtimeId: null,
          runtimeVersion: null,
          resultDigest: null,
          failure: null,
          attemptFailures: [],
          acceptedDependencyHandoffIds: [],
          redacted: true,
        },
      ],
      handoffs: [],
      leases: [],
      readyTaskIds: ['task-test'],
      redacted: true,
    }

    const projected = createRemoteAgentCoordinationSummary(snapshot)

    expect(projected).toEqual({
      ...summary,
      projectId: 'local-project-private',
      coordinationVersion: 4,
      status: 'running',
      stopReason: null,
      roleCounts: [
        { roleId: 'contract-reviewer', count: 1 },
        { roleId: 'test-reviewer', count: 1 },
      ],
      taskStatusCounts: {
        pending: 0,
        ready: 1,
        running: 0,
        succeeded: 1,
        failed: 0,
        cancelled: 0,
        blocked: 0,
      },
      failureCategoryCounts: {
        timeout: 0,
        budget_exhausted: 0,
        policy_denied: 0,
        tool_error: 1,
        coding_executor_error: 0,
        invalid_result: 0,
        dependency_failed: 0,
      },
      taskCount: 2,
      edgeCount: 1,
      acceptedHandoffCount: 0,
      specialistStarts: 1,
      retryCount: 0,
      stepCount: 1,
      toolCallCount: 1,
      tokenCount: 200,
      costUsd: 0.1,
      singleAgentQuality: null,
      coordinationQuality: null,
      latencyMs: 4_000,
      updatedAt: '2026-08-13T15:00:04.000Z',
    })
    expect(JSON.stringify(projected)).not.toMatch(
      /capability|contextDigest|resource|agentId|runtimeId|graphId|policyVersion/iu,
    )
  })

  it('accepts one exact bounded metadata-only lifecycle and evaluation summary', () => {
    expect(parseRemoteAgentCoordinationSummary(summary)).toEqual(summary)
    expect(JSON.stringify(summary)).not.toMatch(
      /localProjectId|userId|sessionId|contextDigest|capability|resource|handoffSummary|source|path|prompt|output|patch/iu,
    )
  })

  it.each([
    ['localProjectId', 'local-project-private'],
    ['sessionId', 'desktop-session-private'],
    ['contextDigest', 'a'.repeat(64)],
    ['capabilityIds', ['repository_read']],
    ['rawOutput', 'secret output'],
  ])('rejects forbidden local/full-fidelity field %s', (key, value) => {
    expect(() => parseRemoteAgentCoordinationSummary({ ...summary, [key]: value })).toThrow(
      'agent_coordination_team_projection_invalid',
    )
  })

  it('rejects incoherent counts, lifecycle, quality pairs, role order, and timestamps', () => {
    for (const forged of [
      { ...summary, taskCount: 4 },
      { ...summary, status: 'running', stopReason: 'success' },
      { ...summary, singleAgentQuality: null },
      { ...summary, coordinationQuality: 1.000001 },
      { ...summary, roleCounts: [...summary.roleCounts].reverse() },
      { ...summary, updatedAt: '2026-08-13 21:00:00Z' },
      {
        ...summary,
        failureCategoryCounts: { ...summary.failureCategoryCounts, tool_error: 4 },
      },
    ]) {
      expect(() => parseRemoteAgentCoordinationSummary(forged)).toThrow(
        'agent_coordination_team_projection_invalid',
      )
    }
  })

  it('accepts a running lifecycle before comparative quality is available', () => {
    expect(parseRemoteAgentCoordinationSummary({
      ...summary,
      coordinationVersion: 2,
      status: 'running',
      stopReason: null,
      roleCounts: [{ roleId: 'contract-reviewer', count: 1 }],
      taskStatusCounts: {
        pending: 0,
        ready: 0,
        running: 1,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        blocked: 0,
      },
      taskCount: 1,
      edgeCount: 0,
      specialistStarts: 1,
      acceptedHandoffCount: 0,
      stepCount: 0,
      toolCallCount: 0,
      singleAgentQuality: null,
      coordinationQuality: null,
      latencyMs: 500,
    })).toMatchObject({
      status: 'running',
      stopReason: null,
      singleAgentQuality: null,
      coordinationQuality: null,
    })
  })
})
