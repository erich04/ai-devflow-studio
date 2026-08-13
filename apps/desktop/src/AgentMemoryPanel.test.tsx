import { render, screen } from '@testing-library/react'
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

    expect(await screen.findByText('Agent Memory')).toBeInTheDocument()
    expect(screen.getByText('Working Memory')).toBeInTheDocument()
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
})
