import { describe, expect, it } from 'vitest'
import {
  AGENT_RUNTIME_MAX_COST_USD,
  AGENT_RUNTIME_MAX_STEPS,
  AGENT_RUNTIME_MAX_TOKENS,
  AGENT_RUNTIME_MAX_TOOL_CALLS,
  createAgentRuntime,
  resumeAgentRuntime,
} from './agent-runtime'
import {
  createRemoteAgentRuntimeSummary,
  parseRemoteAgentRuntimeSummary,
} from './agent-runtime-team-projection'

const digest = (character: string) => character.repeat(64)

function teamRuntime() {
  const created = createAgentRuntime({
    stateVersion: 1,
    id: 'agent-runtime-team-1',
    scope: {
      kind: 'team',
      organizationId: 'org-1',
      projectId: 'team-project-1',
      userId: 'user-private',
      sessionId: 'desktop-token-private',
      localProjectId: 'local-project-private',
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
      maxSteps: 4,
      maxWallTimeMs: 120_000,
      maxToolCalls: 2,
      maxToolResultBytes: 8_192,
      maxTrajectoryMetadataBytes: 4_096,
      maxCheckpointBytes: 16_384,
      maxTokens: 1_024,
      maxCostUsd: 1,
    },
    requestedAt: '2026-08-12T20:00:00.000Z',
    deadline: '2026-08-12T20:02:00.000Z',
  })
  return resumeAgentRuntime({
    runtime: created.runtime,
    expectedCheckpointVersion: created.runtime.checkpointVersion,
    authority: created.runtime.authority,
    contextDigest: created.runtime.contextDigest,
    capabilitySetDigest: created.runtime.capabilitySetDigest,
    now: '2026-08-12T20:00:01.000Z',
  }).runtime
}

describe('Agent Runtime Team projection', () => {
  it('projects only stable Team identity, counts, status, digests, and timestamps', () => {
    const summary = createRemoteAgentRuntimeSummary(teamRuntime())

    expect(summary).toEqual({
      stateVersion: 1,
      projectionVersion: 1,
      runtimeId: 'agent-runtime-team-1',
      projectId: 'team-project-1',
      runId: 'run-1',
      nodeId: 'run-1-build',
      runtimeVersion: 2,
      checkpointVersion: 2,
      status: 'running',
      stopReason: null,
      counters: { steps: 0, toolCalls: 0, tokens: 0, costUsd: 0 },
      acceptedActionCount: 0,
      contextDigest: digest('a'),
      capabilitySetDigest: digest('b'),
      lastObservationDigest: digest('a'),
      lastResultDigest: null,
      startedAt: '2026-08-12T20:00:00.000Z',
      updatedAt: '2026-08-12T20:00:01.000Z',
      redacted: true,
    })
    expect(JSON.stringify(summary)).not.toMatch(
      /local-project-private|user-private|desktop-token-private|scope|source|path|output|checkpointData/i,
    )
    expect(parseRemoteAgentRuntimeSummary(summary)).toEqual(summary)
  })

  it('refuses local-only authority and fails closed on non-exact or incoherent summaries', () => {
    const runtime = teamRuntime()
    expect(() => createRemoteAgentRuntimeSummary({
      ...runtime,
      scope: {
        ...runtime.scope,
        kind: 'local',
        organizationId: null,
        projectId: null,
      },
    })).toThrow('agent_runtime_team_projection_invalid')

    const summary = createRemoteAgentRuntimeSummary(runtime)
    for (const forged of [
      { ...summary, rawOutput: 'secret' },
      { ...summary, runtimeVersion: 1 },
      { ...summary, status: 'terminal', stopReason: null },
      { ...summary, acceptedActionCount: 1 },
      { ...summary, updatedAt: '2026-08-12 20:00:01Z' },
      { ...summary, contextDigest: 'A'.repeat(64) },
    ]) {
      expect(() => parseRemoteAgentRuntimeSummary(forged)).toThrow(
        'agent_runtime_team_projection_invalid',
      )
    }
  })

  it('rejects counters outside the bounded runtime contract or exact database precision', () => {
    const summary = createRemoteAgentRuntimeSummary(teamRuntime())
    for (const forgedCounters of [
      { ...summary.counters, steps: AGENT_RUNTIME_MAX_STEPS + 1 },
      { ...summary.counters, toolCalls: AGENT_RUNTIME_MAX_TOOL_CALLS + 1 },
      { ...summary.counters, tokens: AGENT_RUNTIME_MAX_TOKENS + 1 },
      { ...summary.counters, costUsd: AGENT_RUNTIME_MAX_COST_USD + 0.000001 },
      { ...summary.counters, costUsd: 0.1234567 },
    ]) {
      expect(() =>
        parseRemoteAgentRuntimeSummary({
          ...summary,
          counters: forgedCounters,
        }),
      ).toThrow('agent_runtime_team_projection_invalid')
    }
  })
})
