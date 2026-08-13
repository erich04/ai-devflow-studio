import { describe, expect, it } from 'vitest'
import {
  acceptAgentActionResult,
  cancelAgentRuntime,
  createAgentRuntime,
  requestAgentAction,
  resumeAgentRuntime,
} from './agent-runtime'
import {
  createAgentRuntimeRendererSnapshot,
  createAgentRuntimeRendererListItem,
  parseAgentRuntimeRendererListItem,
  parseAgentRuntimeRendererSnapshot,
} from './agent-runtime-projection'

const digest = (character: string) => character.repeat(64)

describe('Agent Runtime renderer projection', () => {
  it('exposes a strict redacted snapshot without scope or trajectory metadata', () => {
    const transition = createAgentRuntime({
      stateVersion: 1,
      id: 'agent-runtime-1',
      scope: {
        kind: 'team',
        organizationId: 'org-1',
        projectId: 'team-project-1',
        userId: 'user-1',
        sessionId: 'session-secret-boundary',
        localProjectId: 'local-project-1',
      },
      authority: {
        runId: 'run-1',
        nodeId: 'run-1-build',
        runVersion: 3,
        policyVersion: 2,
      },
      contextDigest: digest('a'),
      capabilitySetDigest: digest('b'),
      bounds: {
        maxSteps: 8,
        maxWallTimeMs: 120_000,
        maxToolCalls: 4,
        maxToolResultBytes: 8_192,
        maxTrajectoryMetadataBytes: 4_096,
        maxCheckpointBytes: 16_384,
        maxTokens: 2_048,
        maxCostUsd: 2,
      },
      requestedAt: '2026-08-12T20:00:00.000Z',
      deadline: '2026-08-12T20:02:00.000Z',
    })

    const snapshot = createAgentRuntimeRendererSnapshot({
      runtime: transition.runtime,
      events: transition.events,
      terminalSummary: null,
      contextMetadata: {
        attachmentId: 'runtime-context-1',
        contextDigest: transition.runtime.contextDigest,
        knowledgeCitationCount: 2,
        memoryRevisionCount: 1,
        knowledgeIdentityDigest: digest('c'),
        memoryIdentityDigest: digest('d'),
      },
    })

    expect(snapshot.runtime).toMatchObject({
      runtimeId: 'agent-runtime-1',
      runId: 'run-1',
      nodeId: 'run-1-build',
      localProjectId: 'local-project-1',
      version: 1,
      checkpointVersion: 1,
      acceptedActionCount: 0,
      redacted: true,
    })
    expect(snapshot.events).toEqual([
      {
        projectionVersion: 2,
        runtimeId: 'agent-runtime-1',
        sequence: 1,
        checkpointVersion: 1,
        type: 'runtime_started',
        createdAt: '2026-08-12T20:00:00.000Z',
        redacted: true,
      },
      {
        projectionVersion: 2,
        runtimeId: 'agent-runtime-1',
        sequence: 2,
        checkpointVersion: 1,
        type: 'context_attached',
        createdAt: '2026-08-12T20:00:00.000Z',
        redacted: true,
      },
      {
        projectionVersion: 2,
        runtimeId: 'agent-runtime-1',
        sequence: 3,
        checkpointVersion: 1,
        type: 'checkpointed',
        createdAt: '2026-08-12T20:00:00.000Z',
        redacted: true,
      },
    ])
    expect(snapshot).toHaveProperty('context', {
      attachmentId: 'runtime-context-1',
      contextDigest: digest('a'),
      knowledgeCitationCount: 2,
      memoryRevisionCount: 1,
      knowledgeIdentityDigest: digest('c'),
      memoryIdentityDigest: digest('d'),
      redacted: true,
    })
    expect(JSON.stringify(snapshot)).not.toMatch(
      /session-secret-boundary|organizationId|team-project-1|metadata|source|rawOutput|\/Users\//,
    )
    expect(parseAgentRuntimeRendererSnapshot(snapshot)).toEqual(snapshot)

    for (const tampered of [
      { ...snapshot, rawOutput: 'provider output' },
      { ...snapshot, runtime: { ...snapshot.runtime, source: 'repository source' } },
      {
        ...snapshot,
        events: [{ ...snapshot.events[0], metadata: { path: '/Users/example/repo' } }],
      },
      {
        ...snapshot,
        events: snapshot.events.map((event, index) =>
          index === snapshot.events.length - 1 ? { ...event, sequence: 4 } : event,
        ),
      },
      { ...snapshot, context: { ...snapshot.context, sourcePath: '/Users/example/repo' } },
      { ...snapshot, context: { ...snapshot.context, contextDigest: digest('f') } },
      { ...snapshot, context: { ...snapshot.context, knowledgeCitationCount: 21 } },
      { ...snapshot, context: { ...snapshot.context, memoryRevisionCount: 33 } },
      { ...snapshot, events: [] },
    ]) {
      expect(() => parseAgentRuntimeRendererSnapshot(tampered)).toThrow(
        /invalid_agent_runtime_renderer_snapshot/,
      )
    }

    const cancelled = cancelAgentRuntime({
      runtime: transition.runtime,
      expectedCheckpointVersion: transition.runtime.checkpointVersion,
      now: '2026-08-12T20:00:01.000Z',
    })
    const terminalSnapshot = createAgentRuntimeRendererSnapshot({
      runtime: cancelled.runtime,
      events: [...transition.events, ...cancelled.events],
      contextMetadata: null,
      terminalSummary: {
        stateVersion: 1,
        runtimeId: cancelled.runtime.id,
        checkpointVersion: cancelled.runtime.checkpointVersion,
        stopReason: 'cancelled',
        counters: cancelled.runtime.counters,
        acceptedActionCount: cancelled.runtime.acceptedActionIds.length,
        lastObservationDigest: cancelled.runtime.lastObservationDigest,
        lastResultDigest: cancelled.runtime.lastResultDigest,
        completedAt: cancelled.runtime.updatedAt,
        redacted: true,
      },
    })
    expect(() => parseAgentRuntimeRendererSnapshot({
      ...terminalSnapshot,
      terminalSummary: {
        ...terminalSnapshot.terminalSummary,
        counters: { ...cancelled.runtime.counters, steps: 1 },
      },
    })).toThrow(/invalid_agent_runtime_renderer_snapshot/)
  })

  it('strictly parses a renderer list item without accepting hidden execution fields', () => {
    const transition = createAgentRuntime({
      stateVersion: 1,
      id: 'agent-runtime-list-1',
      scope: {
        kind: 'local',
        organizationId: null,
        projectId: null,
        userId: 'user-1',
        sessionId: 'session-private',
        localProjectId: 'local-project-1',
      },
      authority: { runId: 'run-1', nodeId: 'run-1-build', runVersion: 1, policyVersion: 1 },
      contextDigest: digest('c'),
      capabilitySetDigest: digest('d'),
      bounds: {
        maxSteps: 1,
        maxWallTimeMs: 60_000,
        maxToolCalls: 1,
        maxToolResultBytes: 8_192,
        maxTrajectoryMetadataBytes: 4_096,
        maxCheckpointBytes: 16_384,
        maxTokens: 1,
        maxCostUsd: Number.EPSILON,
      },
      requestedAt: '2026-08-12T20:00:00.000Z',
      deadline: '2026-08-12T20:01:00.000Z',
    })
    const item = createAgentRuntimeRendererListItem({
      runtime: transition.runtime,
      terminalSummary: null,
    })

    expect(parseAgentRuntimeRendererListItem(item)).toEqual(item)
    expect(() => parseAgentRuntimeRendererListItem({
      ...item,
      runtime: { ...item.runtime, rawOutput: 'hidden' },
    })).toThrow(/invalid_agent_runtime_renderer_snapshot/)
  })

  it('projects only the latest redacted evaluation summary without exposing event metadata', () => {
    const created = createAgentRuntime({
      stateVersion: 1,
      id: 'agent-runtime-evaluation-1',
      scope: {
        kind: 'local',
        organizationId: null,
        projectId: null,
        userId: 'user-1',
        sessionId: 'session-private',
        localProjectId: 'local-project-1',
      },
      authority: { runId: 'run-1', nodeId: 'run-1-build', runVersion: 1, policyVersion: 1 },
      contextDigest: digest('e'),
      capabilitySetDigest: digest('f'),
      bounds: {
        maxSteps: 2,
        maxWallTimeMs: 60_000,
        maxToolCalls: 2,
        maxToolResultBytes: 8_192,
        maxTrajectoryMetadataBytes: 4_096,
        maxCheckpointBytes: 16_384,
        maxTokens: 1_024,
        maxCostUsd: 1,
      },
      requestedAt: '2026-08-12T20:00:00.000Z',
      deadline: '2026-08-12T20:01:00.000Z',
    })
    const resumed = resumeAgentRuntime({
      runtime: created.runtime,
      expectedCheckpointVersion: created.runtime.checkpointVersion,
      authority: created.runtime.authority,
      contextDigest: created.runtime.contextDigest,
      capabilitySetDigest: created.runtime.capabilitySetDigest,
      now: '2026-08-12T20:00:01.000Z',
    })
    const requested = requestAgentAction({
      runtime: resumed.runtime,
      expectedCheckpointVersion: resumed.runtime.checkpointVersion,
      action: {
        id: 'action-1',
        kind: 'coding_executor',
        capabilityId: 'coding.native',
        capabilityVersion: 1,
        requestDigest: digest('a'),
        requiresPermission: false,
      },
      now: '2026-08-12T20:00:02.000Z',
    })
    const accepted = acceptAgentActionResult({
      runtime: requested.runtime,
      expectedCheckpointVersion: requested.runtime.checkpointVersion,
      actionId: 'action-1',
      requestDigest: digest('a'),
      result: {
        outcome: 'success',
        resultDigest: digest('b'),
        resultBytes: 64,
        tokens: 8,
        costUsd: 0,
        evaluation: 'continue',
        evaluationSummary: 'One bounded repair step remains.',
      },
      now: '2026-08-12T20:00:03.000Z',
    })
    const snapshot = createAgentRuntimeRendererSnapshot({
      runtime: accepted.runtime,
      events: [...created.events, ...resumed.events, ...requested.events, ...accepted.events],
      terminalSummary: null,
      contextMetadata: null,
    })

    expect(snapshot).toHaveProperty('latestEvaluation', {
      sequence: accepted.events.find((event) => event.type === 'evaluation_recorded')!.sequence,
      checkpointVersion: accepted.runtime.checkpointVersion,
      evaluation: 'continue',
      summary: 'One bounded repair step remains.',
      createdAt: accepted.runtime.updatedAt,
      redacted: true,
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/metadata|resultBytes|rawOutput|source/)
  })
})
