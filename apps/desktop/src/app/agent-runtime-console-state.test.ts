import { describe, expect, it } from 'vitest'
import {
  createAgentRuntime,
  createAgentRuntimeRendererSnapshot,
  resumeAgentRuntime,
} from '@ai-devflow/shared'
import {
  createAgentRuntimeConsoleState,
  mergeAgentRuntimeConsoleSnapshot,
} from './agent-runtime-console-state'

const digest = (character: string) => character.repeat(64)

function startedRuntime(input: {
  runtimeId: string
  runId: string
  localProjectId: string
}) {
  return createAgentRuntime({
    stateVersion: 1,
    id: input.runtimeId,
    scope: {
      kind: 'local',
      organizationId: null,
      projectId: null,
      userId: 'user-1',
      sessionId: `session-${input.runtimeId}`,
      localProjectId: input.localProjectId,
    },
    authority: {
      runId: input.runId,
      nodeId: `${input.runId}-build`,
      runVersion: 1,
      policyVersion: 1,
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
}

describe('Agent Runtime console state', () => {
  it('ignores out-of-order, duplicate, and cross-project snapshots', () => {
    const started = startedRuntime({
      runtimeId: 'agent-runtime-1',
      runId: 'run-1',
      localProjectId: 'project-1',
    })
    const resumed = resumeAgentRuntime({
      runtime: started.runtime,
      expectedCheckpointVersion: started.runtime.checkpointVersion,
      authority: started.runtime.authority,
      contextDigest: started.runtime.contextDigest,
      capabilitySetDigest: started.runtime.capabilitySetDigest,
      now: '2026-08-12T20:00:01.000Z',
    })
    const current = createAgentRuntimeRendererSnapshot({
      runtime: resumed.runtime,
      events: [...started.events, ...resumed.events],
      terminalSummary: null,
    })
    const stale = createAgentRuntimeRendererSnapshot({
      runtime: started.runtime,
      events: started.events,
      terminalSummary: null,
    })
    const state = createAgentRuntimeConsoleState({
      selection: { runId: 'run-1', localProjectId: 'project-1' },
      list: [{
        projectionVersion: 1,
        runtime: current.runtime,
        terminalSummary: current.terminalSummary,
        redacted: true,
      }],
      detail: current,
    })

    expect(mergeAgentRuntimeConsoleSnapshot({ state, snapshot: stale })).toEqual({
      state,
      accepted: false,
      reason: 'out_of_order',
    })
    expect(mergeAgentRuntimeConsoleSnapshot({ state, snapshot: current })).toEqual({
      state,
      accepted: false,
      reason: 'duplicate',
    })

    const foreign = startedRuntime({
      runtimeId: 'agent-runtime-foreign',
      runId: 'run-2',
      localProjectId: 'project-2',
    })
    const foreignSnapshot = createAgentRuntimeRendererSnapshot({
      runtime: foreign.runtime,
      events: foreign.events,
      terminalSummary: null,
    })
    expect(mergeAgentRuntimeConsoleSnapshot({ state, snapshot: foreignSnapshot })).toEqual({
      state,
      accepted: false,
      reason: 'out_of_scope',
    })
  })
})
