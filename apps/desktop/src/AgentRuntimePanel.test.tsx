import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  acceptAgentActionResult,
  createAgentRuntime,
  createAgentRuntimeRendererSnapshot,
  requestAgentAction,
  resumeAgentRuntime,
} from '@ai-devflow/shared'
import { AgentRuntimePanel } from './AgentRuntimePanel'
import type { DevFlowDesktopApi } from './desktop-api'

const digest = (character: string) => character.repeat(64)

function runtimeProjection() {
  const started = createAgentRuntime({
    stateVersion: 1,
    id: 'agent-runtime-panel-1',
    scope: {
      kind: 'local',
      organizationId: null,
      projectId: null,
      userId: 'user-1',
      sessionId: 'session-private',
      localProjectId: 'project-1',
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
  const contextMetadata = {
    attachmentId: 'runtime-context-panel-1',
    contextDigest: started.runtime.contextDigest,
    knowledgeCitationCount: 2,
    memoryRevisionCount: 1,
    knowledgeIdentityDigest: digest('e'),
    memoryIdentityDigest: digest('f'),
  }
  const startedSnapshot = createAgentRuntimeRendererSnapshot({
    runtime: started.runtime,
    events: started.events,
    terminalSummary: null,
    contextMetadata,
  })
  const resumed = resumeAgentRuntime({
    runtime: started.runtime,
    expectedCheckpointVersion: started.runtime.checkpointVersion,
    authority: started.runtime.authority,
    contextDigest: started.runtime.contextDigest,
    capabilitySetDigest: started.runtime.capabilitySetDigest,
    now: '2026-08-12T20:00:01.000Z',
  })
  const resumedSnapshot = createAgentRuntimeRendererSnapshot({
    runtime: resumed.runtime,
    events: [...started.events, ...resumed.events],
    terminalSummary: null,
    contextMetadata,
  })
  const requested = requestAgentAction({
    runtime: resumed.runtime,
    expectedCheckpointVersion: resumed.runtime.checkpointVersion,
    action: {
      id: 'action-1',
      kind: 'coding_executor',
      capabilityId: 'coding.native',
      capabilityVersion: 1,
      requestDigest: digest('c'),
      requiresPermission: false,
    },
    now: '2026-08-12T20:00:02.000Z',
  })
  const evaluated = acceptAgentActionResult({
    runtime: requested.runtime,
    expectedCheckpointVersion: requested.runtime.checkpointVersion,
    actionId: 'action-1',
    requestDigest: digest('c'),
    result: {
      outcome: 'success',
      resultDigest: digest('d'),
      resultBytes: 32,
      tokens: 4,
      costUsd: 0,
      evaluation: 'continue',
      evaluationSummary: 'One bounded repair step remains.',
    },
    now: '2026-08-12T20:00:03.000Z',
  })
  const evaluatedSnapshot = createAgentRuntimeRendererSnapshot({
    runtime: evaluated.runtime,
    events: [...started.events, ...resumed.events, ...requested.events, ...evaluated.events],
    terminalSummary: null,
    contextMetadata,
  })
  return { startedSnapshot, resumedSnapshot, evaluatedSnapshot }
}

describe('AgentRuntimePanel', () => {
  it('starts one standalone Runtime for the exact selected Run and node', async () => {
    const { startedSnapshot } = runtimeProjection()
    const startAgentRuntime = vi.fn().mockResolvedValue(startedSnapshot)
    const api = {
      listAgentRuntimes: vi.fn().mockResolvedValue([]),
      getAgentRuntime: vi.fn(),
      startAgentRuntime,
      advanceAgentRuntime: vi.fn(),
      cancelAgentRuntime: vi.fn(),
      onAgentRuntimeUpdated: vi.fn(() => () => undefined),
    } as unknown as DevFlowDesktopApi

    render(
      <AgentRuntimePanel
        desktopApi={api}
        runId="run-1"
        nodeId="run-1-build"
        localProjectId="project-1"
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: '创建独立 Runtime 验证实例（高级）' }))
    await waitFor(() => expect(startAgentRuntime).toHaveBeenCalledWith({
      runId: 'run-1',
      nodeId: 'run-1-build',
      localProjectId: 'project-1',
    }))
    expect(await screen.findAllByText('已保存检查点')).toHaveLength(1)
  })

  it('shows metadata-only Knowledge and Durable Memory provenance', async () => {
    const { startedSnapshot } = runtimeProjection()
    const api = {
      listAgentRuntimes: vi.fn().mockResolvedValue([{
        projectionVersion: 2,
        runtime: startedSnapshot.runtime,
        terminalSummary: null,
        redacted: true,
      }]),
      getAgentRuntime: vi.fn().mockResolvedValue(startedSnapshot),
      advanceAgentRuntime: vi.fn(),
      cancelAgentRuntime: vi.fn(),
      onAgentRuntimeUpdated: vi.fn(() => () => undefined),
    } as unknown as DevFlowDesktopApi

    render(
      <AgentRuntimePanel
        desktopApi={api}
        runId="run-1"
        nodeId="run-1-build"
        localProjectId="project-1"
      />,
    )

    expect(await screen.findByText('Runtime 上下文')).toBeInTheDocument()
    expect(screen.getByText('2 条知识引用')).toBeInTheDocument()
    expect(screen.getByText('1 个持久记忆版本')).toBeInTheDocument()
    expect(screen.getByText('runtime-context-panel-1')).toBeInTheDocument()
    expect(screen.getByText(digest('e'))).toBeInTheDocument()
    expect(screen.getByText(digest('f'))).toBeInTheDocument()
    expect(screen.queryByText(/sourcePath|headingPath|memory content|\/Users\//i))
      .not.toBeInTheDocument()
  })

  it('shows bounded trajectory evidence and resumes with an exact current CAS', async () => {
    const { startedSnapshot, resumedSnapshot } = runtimeProjection()
    const listAgentRuntimes = vi.fn().mockResolvedValue([
      {
        projectionVersion: 2,
        runtime: startedSnapshot.runtime,
        terminalSummary: null,
        redacted: true,
      },
    ])
    const getAgentRuntime = vi.fn().mockResolvedValue(startedSnapshot)
    const advanceAgentRuntime = vi.fn().mockResolvedValue(resumedSnapshot)
    const listeners: Array<(snapshot: unknown) => void> = []
    const api = {
      listAgentRuntimes,
      getAgentRuntime,
      advanceAgentRuntime,
      cancelAgentRuntime: vi.fn(),
      onAgentRuntimeUpdated: vi.fn((listener) => {
        listeners.push(listener)
        return () => undefined
      }),
    } as unknown as DevFlowDesktopApi

    render(
      <AgentRuntimePanel
        desktopApi={api}
        runId="run-1"
        nodeId="run-1-build"
        localProjectId="project-1"
      />,
    )

    expect(await screen.findAllByText('已保存检查点')).toHaveLength(1)
    expect(screen.getByText('3 条事件')).toBeInTheDocument()
    expect(screen.getByText('0 / 4')).toBeInTheDocument()
    expect(screen.getAllByText(digest('a'))).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: '从检查点恢复 Runtime' }))
    await waitFor(() => expect(advanceAgentRuntime).toHaveBeenCalledWith({
      runtimeId: 'agent-runtime-panel-1',
      runId: 'run-1',
      localProjectId: 'project-1',
      expectedVersion: 1,
      expectedCheckpointVersion: 1,
    }))
    expect(await screen.findByText('运行中')).toBeInTheDocument()
    expect(screen.getByText('5 条事件')).toBeInTheDocument()
  })

  it('shows the latest redacted evaluation without exposing raw event metadata', async () => {
    const { evaluatedSnapshot } = runtimeProjection()
    const api = {
      listAgentRuntimes: vi.fn().mockResolvedValue([{
        projectionVersion: 2,
        runtime: evaluatedSnapshot.runtime,
        terminalSummary: null,
        redacted: true,
      }]),
      getAgentRuntime: vi.fn().mockResolvedValue(evaluatedSnapshot),
      advanceAgentRuntime: vi.fn(),
      cancelAgentRuntime: vi.fn(),
      onAgentRuntimeUpdated: vi.fn(() => () => undefined),
    } as unknown as DevFlowDesktopApi

    render(
      <AgentRuntimePanel
        desktopApi={api}
        runId="run-1"
        nodeId="run-1-build"
        localProjectId="project-1"
      />,
    )

    expect(await screen.findByText('最近评估')).toBeInTheDocument()
    expect(screen.getByText('continue')).toBeInTheDocument()
    expect(screen.getByText('One bounded repair step remains.')).toBeInTheDocument()
    expect(screen.queryByText(/resultBytes|metadata|rawOutput/)).not.toBeInTheDocument()
  })
})
