import { describe, expect, it, vi } from 'vitest'
import { createAgentRuntime } from '@ai-devflow/shared'
import { createAgentRuntimeRendererAccess } from './agent-runtime-renderer-access'

const digest = (character: string) => character.repeat(64)

function runtimeFixture(input: {
  runtimeId: string
  runId: string
  localProjectId: string
  requestedAt: string
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
    requestedAt: input.requestedAt,
    deadline: new Date(Date.parse(input.requestedAt) + 120_000).toISOString(),
  })
}

describe('Agent Runtime renderer access', () => {
  it('lists and reads only the exact selected Run and local project', async () => {
    const selected = runtimeFixture({
      runtimeId: 'agent-runtime-selected',
      runId: 'run-selected',
      localProjectId: 'project-selected',
      requestedAt: '2026-08-12T20:00:00.000Z',
    })
    const other = runtimeFixture({
      runtimeId: 'agent-runtime-other',
      runId: 'run-other',
      localProjectId: 'project-other',
      requestedAt: '2026-08-12T20:01:00.000Z',
    })
    const store = {
      listAgentRuntimes: vi.fn(async () => [selected.runtime, other.runtime]),
      getAgentRuntime: vi.fn(async (runtimeId: string) =>
        [selected.runtime, other.runtime].find((runtime) => runtime.id === runtimeId) ?? null),
      listAgentRuntimeEvents: vi.fn(async (runtimeId: string) =>
        runtimeId === selected.runtime.id ? selected.events : other.events),
      getAgentRuntimeTerminalSummary: vi.fn(async () => null),
      getAgentRuntimeContextAttachment: vi.fn(async (runtimeId: string) =>
        runtimeId === selected.runtime.id
          ? {
              stateVersion: 1 as const,
              id: 'runtime-context-selected',
              runtimeId: selected.runtime.id,
              checkpointVersion: 1,
              scope: selected.runtime.scope,
              authority: selected.runtime.authority,
              knowledgeCitations: [],
              memoryRevisions: [],
              memoryRevisionIdentities: [],
              knowledgeIdentityDigest: digest('c'),
              memoryIdentityDigest: digest('d'),
              contextDigest: selected.runtime.contextDigest,
              attachedAt: selected.runtime.requestedAt,
            }
          : null),
    }
    const access = createAgentRuntimeRendererAccess(store)

    const listed = await access.list({
      runId: 'run-selected',
      localProjectId: 'project-selected',
    })
    expect(listed).toHaveLength(1)
    expect(listed[0]?.runtime).toMatchObject({
      runtimeId: 'agent-runtime-selected',
      runId: 'run-selected',
      localProjectId: 'project-selected',
      redacted: true,
    })
    expect(JSON.stringify(listed)).not.toMatch(/session-agent-runtime-selected|scope|metadata/)

    await expect(access.get({
      runtimeId: 'agent-runtime-other',
      runId: 'run-selected',
      localProjectId: 'project-selected',
    })).rejects.toThrow('Agent Runtime renderer selection is stale')
    expect(store.listAgentRuntimeEvents).not.toHaveBeenCalled()

    const detail = await access.get({
      runtimeId: 'agent-runtime-selected',
      runId: 'run-selected',
      localProjectId: 'project-selected',
    })
    expect(detail.events).toHaveLength(3)
    expect(detail.context).toEqual({
      attachmentId: 'runtime-context-selected',
      contextDigest: selected.runtime.contextDigest,
      knowledgeCitationCount: 0,
      memoryRevisionCount: 0,
      knowledgeIdentityDigest: digest('c'),
      memoryIdentityDigest: digest('d'),
      redacted: true,
    })
    expect(JSON.stringify(detail)).not.toMatch(
      /session-agent-runtime-selected|scope|metadata|sourcePath|headingPath|content|\/Users\//,
    )
  })
})
