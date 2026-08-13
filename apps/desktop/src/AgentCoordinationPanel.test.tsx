import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CoordinationRendererSnapshot } from '@ai-devflow/shared'
import { AgentCoordinationPanel } from './AgentCoordinationPanel'
import type { DevFlowDesktopApi } from './desktop-api'

const digest = (character: string) => character.repeat(64)

function coordinationSnapshot(
  coordinationId = 'coordination-ui-1',
  updatedAt = '2026-08-13T15:00:03.000Z',
): CoordinationRendererSnapshot {
  return {
    projectionVersion: 1,
    session: {
      projectionVersion: 1,
      coordinationId,
      graphId: `graph-${coordinationId}`,
      graphVersion: 1,
      runId: 'run-1',
      nodeId: 'run-1-build',
      localProjectId: 'project-1',
      runVersion: 3,
      policyVersion: 2,
      version: 4,
      status: 'running',
      stopReason: null,
      bounds: {
        maxSpecialists: 2,
        maxTaskNodes: 4,
        maxDependencyEdges: 4,
        maxDelegationDepth: 1,
        maxParallelSpecialists: 2,
        maxAcceptedHandoffs: 4,
        maxSpecialistRetries: 1,
        maxHandoffSummaryBytes: 4_096,
        maxSteps: 8,
        maxWallTimeMs: 120_000,
        maxToolCalls: 4,
        maxTokens: 4_000,
        maxCostUsd: 2,
      },
      counters: {
        specialistStarts: 1,
        activeSpecialists: 0,
        acceptedHandoffs: 1,
        retries: 0,
        steps: 2,
        toolCalls: 1,
        tokens: 320,
        costUsd: 0.12,
      },
      taskCount: 2,
      edgeCount: 1,
      acceptedHandoffCount: 1,
      requestedAt: '2026-08-13T15:00:00.000Z',
      startedAt: '2026-08-13T15:00:00.000Z',
      updatedAt,
      deadline: '2026-08-13T15:02:00.000Z',
      redacted: true,
    },
    tasks: [{
      projectionVersion: 1,
      taskId: 'task-contract',
      version: 3,
      roleId: 'contract-analyst',
      dependencyTaskIds: [],
      capabilityIds: ['repository_read'],
      contextDigest: digest('a'),
      resources: [{ resourceId: 'project-1', resourceDigest: digest('b'), mode: 'read' }],
      status: 'succeeded',
      agentId: 'specialist-contract',
      runtimeId: 'runtime-contract',
      runtimeVersion: 3,
      resultDigest: digest('c'),
      failure: null,
      attemptFailures: [{
        category: 'tool_error',
        code: 'repository_read_failed',
        sourceTaskId: 'task-contract',
      }],
      acceptedDependencyHandoffIds: [],
      redacted: true,
    }, {
      projectionVersion: 1,
      taskId: 'task-test',
      version: 2,
      roleId: 'test-analyst',
      dependencyTaskIds: ['task-contract'],
      capabilityIds: ['repository_read'],
      contextDigest: digest('d'),
      resources: [{ resourceId: 'project-1', resourceDigest: digest('b'), mode: 'read' }],
      status: 'ready',
      agentId: null,
      runtimeId: null,
      runtimeVersion: null,
      resultDigest: null,
      failure: null,
      attemptFailures: [],
      acceptedDependencyHandoffIds: ['handoff-contract-test'],
      redacted: true,
    }],
    handoffs: [{
      projectionVersion: 1,
      handoffId: 'handoff-contract-test',
      sequence: 1,
      sourceTaskId: 'task-contract',
      sourceTaskVersion: 3,
      sourceRuntimeId: 'runtime-contract',
      sourceRuntimeVersion: 3,
      targetTaskId: 'task-test',
      targetTaskVersion: 2,
      resultDigest: digest('c'),
      evidenceDigests: [digest('e')],
      contextDigest: digest('a'),
      resourceLeaseOutcome: 'released',
      createdAt: '2026-08-13T15:00:02.000Z',
      redacted: true,
    }],
    leases: [{
      projectionVersion: 1,
      leaseId: 'lease-contract-read',
      taskId: 'task-contract',
      taskVersion: 3,
      runtimeId: 'runtime-contract',
      runtimeVersion: 3,
      capabilityId: 'repository_read',
      capabilityVersion: 1,
      resourceId: 'project-1',
      resourceDigest: digest('b'),
      mode: 'read',
      status: 'released',
      version: 2,
      acquiredAt: '2026-08-13T15:00:00.000Z',
      expiresAt: '2026-08-13T15:01:00.000Z',
      releasedAt: '2026-08-13T15:00:02.000Z',
      redacted: true,
    }],
    readyTaskIds: ['task-test'],
    redacted: true,
  }
}

function apiWith(snapshots: unknown[]) {
  return {
    listCoordinationSessions: vi.fn().mockResolvedValue(snapshots),
    getCoordinationSession: vi.fn(async ({ coordinationId }) => {
      const match = snapshots.find((value) =>
        (value as CoordinationRendererSnapshot).session?.coordinationId === coordinationId)
      if (!match) throw new Error('missing')
      return match
    }),
    startCoordinationPlan: vi.fn().mockResolvedValue(snapshots[0]),
    resumeCoordinationSession: vi.fn().mockResolvedValue(snapshots[0]),
    startCoordinationTask: vi.fn().mockResolvedValue(snapshots[0]),
    cancelCoordinationSession: vi.fn().mockResolvedValue(snapshots[0]),
  } as unknown as DevFlowDesktopApi
}

describe('AgentCoordinationPanel', () => {
  it('starts the fixed bounded plan from the exact selected Run and current node', async () => {
    const created = coordinationSnapshot()
    const api = apiWith([])
    vi.mocked(api.startCoordinationPlan).mockResolvedValue(created)
    render(
      <AgentCoordinationPanel
        desktopApi={api}
        runId="run-1"
        nodeId="run-1-build"
        expectedRunVersion={3}
        localProjectId="project-1"
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Start bounded coordination' }))
    await waitFor(() => expect(api.startCoordinationPlan).toHaveBeenCalledWith({
      planId: 'bounded-repair-v1',
      runId: 'run-1',
      nodeId: 'run-1-build',
      localProjectId: 'project-1',
      expectedRunVersion: 3,
    }))
    expect(await screen.findByText('coordination-ui-1')).toBeInTheDocument()
  })

  it('preserves an unobtrusive empty state when the selected Run has no coordination session', async () => {
    const api = apiWith([])
    render(<AgentCoordinationPanel desktopApi={api} runId="run-1" localProjectId="project-1" />)

    expect(await screen.findByText('No Multi-Agent Coordination has been recorded for this Run.'))
      .toBeInTheDocument()
    expect(api.listCoordinationSessions).toHaveBeenCalledWith({
      runId: 'run-1',
      localProjectId: 'project-1',
    })
    expect(api.getCoordinationSession).not.toHaveBeenCalled()
  })

  it('shows bounded graph, roles, dependencies, failure attribution, handoffs, and leases', async () => {
    const api = apiWith([coordinationSnapshot()])
    render(<AgentCoordinationPanel desktopApi={api} runId="run-1" localProjectId="project-1" />)

    expect(await screen.findByText('coordination-ui-1')).toBeInTheDocument()
    expect(screen.getByText('2 tasks · 1 dependency')).toBeInTheDocument()
    expect(screen.getByText('2 / 8 steps')).toBeInTheDocument()
    expect(screen.getByText('320 / 4000 tokens')).toBeInTheDocument()
    expect(screen.getByText('task-contract · contract-analyst')).toBeInTheDocument()
    expect(screen.getByText('task-test · test-analyst')).toBeInTheDocument()
    expect(screen.getByText('Ready now')).toBeInTheDocument()
    expect(screen.getByText('depends on task-contract')).toBeInTheDocument()
    expect(screen.getByText('tool_error · repository_read_failed')).toBeInTheDocument()
    expect(screen.getByText('task-contract → task-test')).toBeInTheDocument()
    expect(screen.getByText('project-1 · read · released')).toBeInTheDocument()
    expect(screen.queryByText(/secret|summary|scope|\/Users\//i)).not.toBeInTheDocument()
  })

  it('switches sessions through exact selection and rejects an unsafe renderer projection', async () => {
    const first = coordinationSnapshot('coordination-ui-1', '2026-08-13T15:00:03.000Z')
    const second = coordinationSnapshot('coordination-ui-2', '2026-08-13T15:00:04.000Z')
    const api = apiWith([second, first])
    const { rerender } = render(
      <AgentCoordinationPanel desktopApi={api} runId="run-1" localProjectId="project-1" />,
    )

    expect(await screen.findByText('coordination-ui-2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /coordination-ui-1/ }))
    await waitFor(() => expect(api.getCoordinationSession).toHaveBeenCalledWith({
      coordinationId: 'coordination-ui-1',
      runId: 'run-1',
      localProjectId: 'project-1',
    }))
    expect(await screen.findByText('coordination-ui-1')).toBeInTheDocument()

    const unsafe = { ...coordinationSnapshot(), summary: 'secret reasoning' }
    const unsafeApi = apiWith([unsafe])
    rerender(
      <AgentCoordinationPanel desktopApi={unsafeApi} runId="run-2" localProjectId="project-2" />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Multi-Agent Coordination state could not be loaded safely.',
    )
    expect(screen.queryByText('secret reasoning')).not.toBeInTheDocument()
  })

  it('resumes and starts only the exact versioned session and ready task', async () => {
    const snapshot = coordinationSnapshot()
    const api = apiWith([snapshot])
    render(<AgentCoordinationPanel desktopApi={api} runId="run-1" localProjectId="project-1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Resume coordination-ui-1' }))
    await waitFor(() => expect(api.resumeCoordinationSession).toHaveBeenCalledWith({
      coordinationId: 'coordination-ui-1',
      runId: 'run-1',
      localProjectId: 'project-1',
      expectedSessionVersion: 4,
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Start task-test' }))
    await waitFor(() => expect(api.startCoordinationTask).toHaveBeenCalledWith({
      coordinationId: 'coordination-ui-1',
      runId: 'run-1',
      localProjectId: 'project-1',
      expectedSessionVersion: 4,
      taskId: 'task-test',
      expectedTaskVersion: 2,
    }))
  })

  it('requires explicit confirmation before cancelling the exact current session', async () => {
    const snapshot = coordinationSnapshot()
    const api = apiWith([snapshot])
    const confirm = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
    render(<AgentCoordinationPanel desktopApi={api} runId="run-1" localProjectId="project-1" />)

    const cancel = await screen.findByRole('button', { name: 'Cancel coordination-ui-1' })
    fireEvent.click(cancel)
    expect(api.cancelCoordinationSession).not.toHaveBeenCalled()

    fireEvent.click(cancel)
    await waitFor(() => expect(api.cancelCoordinationSession).toHaveBeenCalledWith({
      coordinationId: 'coordination-ui-1',
      runId: 'run-1',
      localProjectId: 'project-1',
      expectedSessionVersion: 4,
      confirmation: 'cancel-coordination',
    }))
    confirm.mockRestore()
  })
})
