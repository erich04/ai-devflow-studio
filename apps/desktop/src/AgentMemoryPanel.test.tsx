import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  createAgentRuntime,
  createAgentRuntimeRendererListItem,
  type AgentMemoryRendererSnapshot,
} from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from './desktop-api'
import { AgentMemoryPanel } from './AgentMemoryPanel'

const digest = (character: string) => character.repeat(64)
const scope = {
  kind: 'local' as const,
  organizationId: null,
  projectId: null,
  userId: 'user-1',
  localProjectId: 'local-project-1',
}

const snapshot: AgentMemoryRendererSnapshot = {
  projectionVersion: 1,
  localProjectId: 'local-project-1',
  observedAt: '2026-08-13T12:00:00.000Z',
  candidateCount: 2,
  memoryCount: 3,
  truncated: false,
  candidates: [
    {
      id: 'candidate-pending',
      lifecycleStatus: 'pending',
      scope,
      statement: 'Pending memory statement for explicit human review.',
      contentDigest: digest('a'),
      provenance: {
        kind: 'agent_observation',
        runtimeId: 'runtime-1',
        actionId: 'action-1',
        checkpointVersion: 2,
        sequence: 7,
        resultDigest: digest('b'),
      },
      provenanceDigest: digest('c'),
      createdAt: '2026-08-13T10:00:00.000Z',
      redacted: true,
    },
    {
      id: 'candidate-promoted',
      lifecycleStatus: 'promoted',
      scope,
      statement: 'Promoted memory statement remains traceable to its candidate.',
      contentDigest: digest('d'),
      provenance: {
        kind: 'agent_observation',
        runtimeId: 'runtime-2',
        actionId: 'action-2',
        checkpointVersion: 3,
        sequence: 9,
        resultDigest: digest('e'),
      },
      provenanceDigest: digest('f'),
      createdAt: '2026-08-13T10:05:00.000Z',
      redacted: true,
    },
  ],
  memories: [
    {
      memoryId: 'memory-conflict',
      headVersion: 4,
      currentRevision: 2,
      lifecycleStatus: 'conflict',
      revisionStatus: 'conflict',
      scope,
      visibility: 'user_project',
      statement: 'Conflicting memory needs an explicit authoritative revision.',
      contentDigest: digest('1'),
      provenanceDigest: digest('2'),
      sourceCandidateId: 'candidate-promoted',
      sensitivity: 'private',
      retentionClass: 'until_deleted',
      expiresAt: null,
      promotionPolicyId: 'memory-policy',
      promotionPolicyVersion: 2,
      createdAt: '2026-08-13T10:10:00.000Z',
      updatedAt: '2026-08-13T10:11:00.000Z',
      tombstone: null,
      redacted: true,
    },
    {
      memoryId: 'memory-expired',
      headVersion: 2,
      currentRevision: 1,
      lifecycleStatus: 'expired',
      revisionStatus: 'active',
      scope,
      visibility: 'runtime',
      statement: 'Expired memory stays unavailable after its retention boundary.',
      contentDigest: digest('3'),
      provenanceDigest: digest('4'),
      sourceCandidateId: 'candidate-expired',
      sensitivity: 'private',
      retentionClass: 'session',
      expiresAt: '2026-08-13T11:00:00.000Z',
      promotionPolicyId: 'memory-policy',
      promotionPolicyVersion: 2,
      createdAt: '2026-08-13T10:20:00.000Z',
      updatedAt: '2026-08-13T11:00:00.000Z',
      tombstone: null,
      redacted: true,
    },
    {
      memoryId: 'memory-deleted',
      headVersion: 4,
      currentRevision: 1,
      lifecycleStatus: 'deleted',
      revisionStatus: 'active',
      scope,
      visibility: 'user_project',
      statement: null,
      contentDigest: digest('5'),
      provenanceDigest: digest('6'),
      sourceCandidateId: 'candidate-deleted',
      sensitivity: 'private',
      retentionClass: 'until_deleted',
      expiresAt: null,
      promotionPolicyId: 'memory-policy',
      promotionPolicyVersion: 2,
      createdAt: '2026-08-13T10:30:00.000Z',
      updatedAt: '2026-08-13T11:31:00.000Z',
      tombstone: {
        deletionVersion: 3,
        lastRevision: 1,
        purgeStatus: 'completed',
        deletedAt: '2026-08-13T11:30:00.000Z',
        purgedAt: '2026-08-13T11:31:00.000Z',
      },
      redacted: true,
    },
  ],
  redacted: true,
}

const runtime = createAgentRuntime({
  stateVersion: 1,
  id: 'agent-runtime-selected',
  scope: {
    kind: 'local',
    organizationId: null,
    projectId: null,
    userId: 'user-1',
    sessionId: 'runtime-session-private',
    localProjectId: 'local-project-1',
  },
  authority: {
    runId: 'run-selected',
    nodeId: 'node-selected',
    runVersion: 1,
    policyVersion: 1,
  },
  contextDigest: digest('7'),
  capabilitySetDigest: digest('8'),
  bounds: {
    maxSteps: 1,
    maxWallTimeMs: 60_000,
    maxToolCalls: 1,
    maxToolResultBytes: 8_192,
    maxTrajectoryMetadataBytes: 4_096,
    maxCheckpointBytes: 16_384,
    maxTokens: 1,
    maxCostUsd: 1,
  },
  requestedAt: '2026-08-13T11:00:00.000Z',
  deadline: '2026-08-13T11:01:00.000Z',
}).runtime

const runtimeListItem = createAgentRuntimeRendererListItem({
  runtime,
  terminalSummary: null,
})

describe('AgentMemoryPanel', () => {
  it('distinguishes Working, Candidate, Durable, conflict, expiry, and deletion state', async () => {
    const listAgentMemoryLifecycle = vi.fn().mockResolvedValue(snapshot)
    const api = {
      listAgentRuntimes: vi.fn().mockResolvedValue([runtimeListItem]),
      listAgentMemoryLifecycle,
    } as unknown as DevFlowDesktopApi

    render(<AgentMemoryPanel
      desktopApi={api}
      runId="run-selected"
      localProjectId="local-project-1"
    />)

    expect(await screen.findByText('Working Memory')).toBeInTheDocument()
    expect(screen.getByText('Agent Memory')).toBeInTheDocument()
    expect(screen.getByText('Runtime checkpoint only')).toBeInTheDocument()
    expect(screen.getByText('2 Memory Candidates')).toBeInTheDocument()
    expect(screen.getByText('3 Durable Memories')).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.getByText('promoted')).toBeInTheDocument()
    expect(screen.getByText('conflict')).toBeInTheDocument()
    expect(screen.getByText('expired')).toBeInTheDocument()
    expect(screen.getByText('deleted')).toBeInTheDocument()
    expect(screen.getByText('revision 2 · head v4')).toBeInTheDocument()
    expect(screen.getByText('purge completed · deletion v3')).toBeInTheDocument()
    expect(screen.getByText(snapshot.candidates[0]!.statement)).toBeInTheDocument()
    expect(screen.getByText(snapshot.memories[0]!.statement!)).toBeInTheDocument()
    expect(listAgentMemoryLifecycle).toHaveBeenCalledWith({
      runtimeId: runtime.id,
      runId: runtime.authority.runId,
      localProjectId: runtime.scope.localProjectId,
    })
    expect(JSON.stringify(listAgentMemoryLifecycle.mock.calls)).not.toMatch(
      /sessionId|capability|statement|memoryId|candidateId/,
    )
  })

  it('rejects a broadened lifecycle snapshot in the renderer', async () => {
    const api = {
      listAgentRuntimes: vi.fn().mockResolvedValue([runtimeListItem]),
      listAgentMemoryLifecycle: vi.fn().mockResolvedValue({
        ...snapshot,
        sessionId: 'pairing-token-secret',
      }),
    } as unknown as DevFlowDesktopApi

    render(<AgentMemoryPanel
      desktopApi={api}
      runId="run-selected"
      localProjectId="local-project-1"
    />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Agent Memory lifecycle could not be loaded safely.',
    )
    expect(screen.queryByText(snapshot.candidates[0]!.statement)).not.toBeInTheDocument()
  })

  it('does not enumerate Memory without an exact Runtime in the selected Run', async () => {
    const listAgentMemoryLifecycle = vi.fn()
    const api = {
      listAgentRuntimes: vi.fn().mockResolvedValue([]),
      listAgentMemoryLifecycle,
    } as unknown as DevFlowDesktopApi

    render(<AgentMemoryPanel
      desktopApi={api}
      runId="run-selected"
      localProjectId="local-project-1"
    />)

    expect(await screen.findByText('No exact Agent Runtime is available for Memory scope.'))
      .toBeInTheDocument()
    expect(listAgentMemoryLifecycle).not.toHaveBeenCalled()
  })

  it('promotes only a pending Candidate with exact renderer-observed digests', async () => {
    const promotedSnapshot: AgentMemoryRendererSnapshot = {
      ...snapshot,
      candidates: snapshot.candidates.map((entry) => entry.id === 'candidate-pending'
        ? { ...entry, lifecycleStatus: 'promoted' as const }
        : entry),
    }
    const promoteAgentMemoryCandidate = vi.fn().mockResolvedValue(promotedSnapshot)
    const api = {
      listAgentRuntimes: vi.fn().mockResolvedValue([runtimeListItem]),
      listAgentMemoryLifecycle: vi.fn().mockResolvedValue(snapshot),
      promoteAgentMemoryCandidate,
    } as unknown as DevFlowDesktopApi

    render(<AgentMemoryPanel
      desktopApi={api}
      runId="run-selected"
      localProjectId="local-project-1"
    />)

    const button = await screen.findByRole('button', {
      name: 'Promote private user-project Memory',
    })
    fireEvent.click(button)

    await waitFor(() => expect(promoteAgentMemoryCandidate).toHaveBeenCalledWith({
      runtimeId: runtime.id,
      runId: runtime.authority.runId,
      localProjectId: runtime.scope.localProjectId,
      candidateId: snapshot.candidates[0]!.id,
      expectedContentDigest: snapshot.candidates[0]!.contentDigest,
      expectedProvenanceDigest: snapshot.candidates[0]!.provenanceDigest,
    }))
    await waitFor(() => expect(screen.queryByRole('button', {
      name: 'Promote private user-project Memory',
    })).not.toBeInTheDocument())
    expect(JSON.stringify(promoteAgentMemoryCandidate.mock.calls)).not.toMatch(
      /authority|policy|actor|memoryId|sessionId|capability|statement/,
    )
  })

  it('revises only one active Memory with exact renderer-observed versions and digests', async () => {
    const activeMemory = {
      ...snapshot.memories[0]!,
      lifecycleStatus: 'active' as const,
      revisionStatus: 'active' as const,
    }
    const initialSnapshot: AgentMemoryRendererSnapshot = {
      ...snapshot,
      memories: [activeMemory, ...snapshot.memories.slice(1)],
    }
    const revisedStatement = 'Use the newly reviewed bounded conflict policy.'
    const revisedSnapshot: AgentMemoryRendererSnapshot = {
      ...initialSnapshot,
      memories: initialSnapshot.memories.map((entry) => entry.memoryId === activeMemory.memoryId
        ? {
            ...entry,
            currentRevision: entry.currentRevision + 1,
            headVersion: entry.headVersion + 1,
            statement: revisedStatement,
            contentDigest: digest('9'),
            updatedAt: '2026-08-13T12:00:01.000Z',
          }
        : entry),
    }
    const reviseAgentMemory = vi.fn().mockResolvedValue(revisedSnapshot)
    const api = {
      listAgentRuntimes: vi.fn().mockResolvedValue([runtimeListItem]),
      listAgentMemoryLifecycle: vi.fn().mockResolvedValue(initialSnapshot),
      reviseAgentMemory,
    } as unknown as DevFlowDesktopApi

    render(<AgentMemoryPanel
      desktopApi={api}
      runId="run-selected"
      localProjectId="local-project-1"
    />)

    fireEvent.click(await screen.findByRole('button', { name: 'Revise exact Memory' }))
    fireEvent.change(screen.getByLabelText(
      `Revised Memory statement for ${activeMemory.memoryId}`,
    ), { target: { value: revisedStatement } })
    fireEvent.click(screen.getByRole('button', { name: 'Save exact revision' }))

    await waitFor(() => expect(reviseAgentMemory).toHaveBeenCalledWith({
      runtimeId: runtime.id,
      runId: runtime.authority.runId,
      localProjectId: runtime.scope.localProjectId,
      memoryId: activeMemory.memoryId,
      expectedRevision: activeMemory.currentRevision,
      expectedHeadVersion: activeMemory.headVersion,
      expectedContentDigest: activeMemory.contentDigest,
      expectedProvenanceDigest: activeMemory.provenanceDigest,
      statement: revisedStatement,
    }))
    expect(await screen.findByText(revisedStatement)).toBeInTheDocument()
    expect(screen.getByText('revision 3 · head v5')).toBeInTheDocument()
    expect(JSON.stringify(reviseAgentMemory.mock.calls)).not.toMatch(
      /"(?:authorityDigest|policyId|policyVersion|actorId|actorKind|sessionId|capability|retentionClass|sensitivity|visibility)"/,
    )
  })

  it('requires explicit confirmation before deleting one exact active Memory', async () => {
    const activeMemory = {
      ...snapshot.memories[0]!,
      lifecycleStatus: 'active' as const,
      revisionStatus: 'active' as const,
    }
    const initialSnapshot: AgentMemoryRendererSnapshot = {
      ...snapshot,
      memories: [activeMemory, ...snapshot.memories.slice(1)],
    }
    const deletedSnapshot: AgentMemoryRendererSnapshot = {
      ...initialSnapshot,
      memories: initialSnapshot.memories.map((entry) => entry.memoryId === activeMemory.memoryId
        ? {
            ...entry,
            headVersion: 6,
            lifecycleStatus: 'deleted' as const,
            statement: null,
            updatedAt: '2026-08-13T12:00:02.000Z',
            tombstone: {
              deletionVersion: 5,
              lastRevision: entry.currentRevision,
              purgeStatus: 'completed' as const,
              deletedAt: '2026-08-13T12:00:01.000Z',
              purgedAt: '2026-08-13T12:00:02.000Z',
            },
          }
        : entry),
    }
    const deleteAgentMemory = vi.fn().mockResolvedValue(deletedSnapshot)
    const api = {
      listAgentRuntimes: vi.fn().mockResolvedValue([runtimeListItem]),
      listAgentMemoryLifecycle: vi.fn().mockResolvedValue(initialSnapshot),
      deleteAgentMemory,
    } as unknown as DevFlowDesktopApi

    render(<AgentMemoryPanel
      desktopApi={api}
      runId="run-selected"
      localProjectId="local-project-1"
    />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete exact Memory' }))
    expect(deleteAgentMemory).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm exact deletion' }))

    await waitFor(() => expect(deleteAgentMemory).toHaveBeenCalledWith({
      runtimeId: runtime.id,
      runId: runtime.authority.runId,
      localProjectId: runtime.scope.localProjectId,
      memoryId: activeMemory.memoryId,
      expectedRevision: activeMemory.currentRevision,
      expectedHeadVersion: activeMemory.headVersion,
      expectedContentDigest: activeMemory.contentDigest,
      expectedProvenanceDigest: activeMemory.provenanceDigest,
    }))
    expect(await screen.findAllByText('Content unavailable after deletion.')).toHaveLength(2)
    expect(screen.getByText('purge completed · deletion v5')).toBeInTheDocument()
    expect(JSON.stringify(deleteAgentMemory.mock.calls)).not.toMatch(
      /"(?:authorityDigest|policyId|policyVersion|actorId|actorKind|sessionId|capability|purgedAt)"/,
    )
  })

  it('resumes one exact pending Memory purge without asking for deletion authority again', async () => {
    const pendingMemory = {
      ...snapshot.memories[0]!,
      headVersion: 5,
      lifecycleStatus: 'purge_pending' as const,
      revisionStatus: 'active' as const,
      tombstone: {
        deletionVersion: 5,
        lastRevision: snapshot.memories[0]!.currentRevision,
        purgeStatus: 'pending' as const,
        deletedAt: '2026-08-13T12:00:01.000Z',
        purgedAt: null,
      },
    }
    const initialSnapshot: AgentMemoryRendererSnapshot = {
      ...snapshot,
      memories: [pendingMemory, ...snapshot.memories.slice(1)],
    }
    const deletedSnapshot: AgentMemoryRendererSnapshot = {
      ...initialSnapshot,
      memories: initialSnapshot.memories.map((entry) => entry.memoryId === pendingMemory.memoryId
        ? {
            ...entry,
            headVersion: 6,
            lifecycleStatus: 'deleted' as const,
            statement: null,
            updatedAt: '2026-08-13T12:00:02.000Z',
            tombstone: {
              ...pendingMemory.tombstone,
              purgeStatus: 'completed' as const,
              purgedAt: '2026-08-13T12:00:02.000Z',
            },
          }
        : entry),
    }
    const deleteAgentMemory = vi.fn().mockResolvedValue(deletedSnapshot)
    const api = {
      listAgentRuntimes: vi.fn().mockResolvedValue([runtimeListItem]),
      listAgentMemoryLifecycle: vi.fn().mockResolvedValue(initialSnapshot),
      deleteAgentMemory,
    } as unknown as DevFlowDesktopApi

    render(<AgentMemoryPanel
      desktopApi={api}
      runId="run-selected"
      localProjectId="local-project-1"
    />)

    fireEvent.click(await screen.findByRole('button', { name: 'Complete exact purge' }))

    await waitFor(() => expect(deleteAgentMemory).toHaveBeenCalledWith({
      runtimeId: runtime.id,
      runId: runtime.authority.runId,
      localProjectId: runtime.scope.localProjectId,
      memoryId: pendingMemory.memoryId,
      expectedRevision: pendingMemory.currentRevision,
      expectedHeadVersion: pendingMemory.headVersion,
      expectedContentDigest: pendingMemory.contentDigest,
      expectedProvenanceDigest: pendingMemory.provenanceDigest,
    }))
    expect(screen.getByText('purge completed · deletion v5')).toBeInTheDocument()
  })
})
