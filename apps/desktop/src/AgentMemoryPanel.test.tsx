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
      duplicateOf: null,
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
      duplicateOf: null,
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
  it('explains why a legacy large memory cannot fit a recall entry', async () => {
    const large = { ...snapshot, candidateCount: 1, candidates: [{ ...snapshot.candidates[0]!, statement: '中'.repeat(1000) }] }
    const api = { listAgentMemoryLifecycle: vi.fn().mockResolvedValue(large) } as unknown as DevFlowDesktopApi
    render(<AgentMemoryPanel desktopApi={api} runId="run-selected" localProjectId="local-project-1" />)
    expect(await screen.findByText(/3000 UTF-8 字节/)).toHaveTextContent('超出阶段、讨论入口预算')
  })

  it('shows no text for the source candidate of a deleted Memory', async () => {
    const withDeletedSource: AgentMemoryRendererSnapshot = {
      ...snapshot,
      candidateCount: 3,
      candidates: [...snapshot.candidates, {
        ...snapshot.candidates[1]!,
        id: 'candidate-deleted',
        statement: null,
        contentDigest: digest('9'),
        createdAt: '2026-08-13T10:25:00.000Z',
      }],
    }
    const api = {
      listAgentRuntimes: vi.fn().mockResolvedValue([runtimeListItem]),
      listAgentMemoryLifecycle: vi.fn().mockResolvedValue(withDeletedSource),
    } as unknown as DevFlowDesktopApi

    render(<AgentMemoryPanel desktopApi={api} runId="run-selected" localProjectId="local-project-1" />)

    expect(await screen.findByText('对应的 Memory 已删除，内容不可用。')).toBeInTheDocument()
    expect(screen.getByText('删除后内容不可用。')).toBeInTheDocument()
    expect(screen.getAllByText('已提升')).toHaveLength(2)
  })

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

    expect(await screen.findByText('工作记忆')).toBeInTheDocument()
    expect(screen.getByText('Agent Memory（记忆）')).toBeInTheDocument()
    expect(screen.getByText('仅保存在 Runtime 检查点')).toBeInTheDocument()
    expect(screen.getByText('2 个 Memory Candidate（记忆候选）')).toBeInTheDocument()
    expect(screen.getByText('3 个 Durable Memory（持久记忆）')).toBeInTheDocument()
    expect(screen.getByText('待确认')).toBeInTheDocument()
    expect(screen.getByText('已提升')).toBeInTheDocument()
    expect(screen.getByText('冲突')).toBeInTheDocument()
    expect(screen.getByText('已过期')).toBeInTheDocument()
    expect(screen.getByText('已删除')).toBeInTheDocument()
    expect(screen.getByText('修订 2 · 当前头版本 v4')).toBeInTheDocument()
    expect(screen.getByText('purge completed · deletion v3')).toBeInTheDocument()
    expect(screen.getByText(snapshot.candidates[0]!.statement!)).toBeInTheDocument()
    expect(screen.getByText(snapshot.memories[0]!.statement!)).toBeInTheDocument()
    expect(listAgentMemoryLifecycle).toHaveBeenCalledWith({
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
      '无法安全读取 Agent Memory 生命周期。',
    )
    expect(screen.queryByText(snapshot.candidates[0]!.statement!)).not.toBeInTheDocument()
  })

  it('reads the project-wide view without an Agent Runtime and marks Coding Run duplicates (ADR 0024)', async () => {
    const policyMemory = {
      ...snapshot.memories[0]!, memoryId: 'agent-memory-coding-1', lifecycleStatus: 'active' as const,
      revisionStatus: 'active' as const, statement: 'Verified test command for this project: npm test.',
      promotionPolicyId: 'desktop-coding-run-memory-policy', retentionClass: 'thirty_days' as const,
      expiresAt: '2026-09-13T10:00:00.000Z', tombstone: null,
    }
    const codingSnapshot: AgentMemoryRendererSnapshot = {
      ...snapshot, candidateCount: 1, memoryCount: 1,
      memories: [policyMemory],
      candidates: [{
        ...snapshot.candidates[0]!, id: 'candidate-coding-duplicate',
        statement: 'Verified test command for this project: npm test.',
        provenance: {
          kind: 'coding_run', runId: 'run-selected', nodeId: 'node-build', codingRunId: 'coding-run-2',
          testEvidenceId: 'evidence-2', diffArtifactId: 'diff-2', statementKind: 'test_command',
        },
        duplicateOf: { memoryId: 'agent-memory-coding-1', kind: 'exact', similarity: 1 },
      }],
    }
    const listAgentMemoryLifecycle = vi.fn().mockResolvedValue(codingSnapshot)
    const listAgentRuntimes = vi.fn()
    const api = { listAgentRuntimes, listAgentMemoryLifecycle } as unknown as DevFlowDesktopApi

    render(<AgentMemoryPanel
      desktopApi={api}
      runId="run-selected"
      localProjectId="local-project-1"
    />)

    expect(await screen.findByText('开发任务 coding-run-2 · 已验证的测试命令')).toBeInTheDocument()
    expect(listAgentMemoryLifecycle).toHaveBeenCalledWith({ runId: 'run-selected', localProjectId: 'local-project-1' })
    expect(listAgentRuntimes).not.toHaveBeenCalled()
    expect(screen.getByText('与已有记忆相同')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提升为用户项目私有 Memory' })).toBeDisabled()
    expect(screen.getByText('开发任务测试通过后由策略自动保存，仅本人可见，30 天后过期；删除后不再召回')).toBeInTheDocument()
  })

  it('blocks a revision that would repeat another active Memory', async () => {
    const [first] = snapshot.memories
    const twoActive: AgentMemoryRendererSnapshot = {
      ...snapshot, memoryCount: 2,
      memories: [
        { ...first!, memoryId: 'agent-memory-a', lifecycleStatus: 'active', revisionStatus: 'active', statement: 'Keep the export name.', tombstone: null },
        { ...first!, memoryId: 'agent-memory-b', lifecycleStatus: 'active', revisionStatus: 'active', statement: 'Run npm test before review.', tombstone: null },
      ],
    }
    const reviseAgentMemory = vi.fn()
    const api = {
      listAgentMemoryLifecycle: vi.fn().mockResolvedValue(twoActive),
      reviseAgentMemory,
    } as unknown as DevFlowDesktopApi

    render(<AgentMemoryPanel desktopApi={api} runId="run-selected" localProjectId="local-project-1" />)

    fireEvent.click((await screen.findAllByRole('button', { name: '修订此 Memory' }))[0]!)
    fireEvent.change(screen.getByLabelText('修订 Memory 内容 agent-memory-a'), { target: { value: 'run npm test before review' } })
    expect(screen.getByRole('status')).toHaveTextContent('与持久记忆 agent-memory-b 相同')
    expect(screen.getByRole('button', { name: '保存精确修订' })).toBeDisabled()
    expect(reviseAgentMemory).not.toHaveBeenCalled()
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
      name: '提升为用户项目私有 Memory',
    })
    fireEvent.click(button)

    await waitFor(() => expect(promoteAgentMemoryCandidate).toHaveBeenCalledWith({
      runId: runtime.authority.runId,
      localProjectId: runtime.scope.localProjectId,
      candidateId: snapshot.candidates[0]!.id,
      expectedContentDigest: snapshot.candidates[0]!.contentDigest,
      expectedProvenanceDigest: snapshot.candidates[0]!.provenanceDigest,
    }))
    await waitFor(() => expect(screen.queryByRole('button', {
      name: '提升为用户项目私有 Memory',
    })).not.toBeInTheDocument())
    expect(JSON.stringify(promoteAgentMemoryCandidate.mock.calls)).not.toMatch(
      /authority|policy|actor|memoryId|sessionId|capability|statement/,
    )
  })

  it('dismisses a pending Candidate only after confirmation, with exact renderer-observed digests', async () => {
    const dismissedSnapshot: AgentMemoryRendererSnapshot = {
      ...snapshot,
      candidateCount: 1,
      candidates: snapshot.candidates.filter((entry) => entry.id !== 'candidate-pending'),
    }
    const dismissAgentMemoryCandidate = vi.fn().mockResolvedValue(dismissedSnapshot)
    const promoteAgentMemoryCandidate = vi.fn()
    const api = {
      listAgentRuntimes: vi.fn().mockResolvedValue([runtimeListItem]),
      listAgentMemoryLifecycle: vi.fn().mockResolvedValue(snapshot),
      promoteAgentMemoryCandidate,
      dismissAgentMemoryCandidate,
    } as unknown as DevFlowDesktopApi

    render(<AgentMemoryPanel desktopApi={api} runId="run-selected" localProjectId="local-project-1" />)

    fireEvent.click(await screen.findByRole('button', { name: '忽略此候选' }))
    expect(dismissAgentMemoryCandidate).not.toHaveBeenCalled()
    expect(screen.getByText('忽略后移除这条候选，同一来源不会再次提出；已保存的记忆不受影响。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消忽略' }))
    expect(screen.queryByRole('button', { name: '确认忽略此候选' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '忽略此候选' }))
    fireEvent.click(screen.getByRole('button', { name: '确认忽略此候选' }))
    await waitFor(() => expect(dismissAgentMemoryCandidate).toHaveBeenCalledWith({
      runId: runtime.authority.runId,
      localProjectId: runtime.scope.localProjectId,
      candidateId: 'candidate-pending',
      expectedContentDigest: snapshot.candidates[0]!.contentDigest,
      expectedProvenanceDigest: snapshot.candidates[0]!.provenanceDigest,
    }))
    await waitFor(() => expect(screen.queryByText('Pending memory statement for explicit human review.')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '忽略此候选' })).not.toBeInTheDocument()
    expect(promoteAgentMemoryCandidate).not.toHaveBeenCalled()
    expect(JSON.stringify(dismissAgentMemoryCandidate.mock.calls)).not.toMatch(
      /authority|policy|actor|memoryId|sessionId|capability|statement|dismissedAt/,
    )
  })

  it('reports a rejected dismissal and keeps the Candidate listed', async () => {
    const api = {
      listAgentRuntimes: vi.fn().mockResolvedValue([runtimeListItem]),
      listAgentMemoryLifecycle: vi.fn().mockResolvedValue(snapshot),
      dismissAgentMemoryCandidate: vi.fn().mockRejectedValue(new Error('rejected')),
    } as unknown as DevFlowDesktopApi

    render(<AgentMemoryPanel desktopApi={api} runId="run-selected" localProjectId="local-project-1" />)

    fireEvent.click(await screen.findByRole('button', { name: '忽略此候选' }))
    fireEvent.click(screen.getByRole('button', { name: '确认忽略此候选' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('忽略 Memory 候选的请求已被安全拒绝')
    expect(screen.getByText('Pending memory statement for explicit human review.')).toBeInTheDocument()
  })

  it('reloads the stored state when a dismissal committed but its reply failed', async () => {
    const dismissedSnapshot: AgentMemoryRendererSnapshot = {
      ...snapshot,
      candidateCount: 1,
      candidates: snapshot.candidates.filter((entry) => entry.id !== 'candidate-pending'),
    }
    const api = {
      listAgentRuntimes: vi.fn().mockResolvedValue([runtimeListItem]),
      listAgentMemoryLifecycle: vi.fn()
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValueOnce(dismissedSnapshot),
      dismissAgentMemoryCandidate: vi.fn().mockRejectedValue(new Error('reply lost')),
    } as unknown as DevFlowDesktopApi

    render(<AgentMemoryPanel desktopApi={api} runId="run-selected" localProjectId="local-project-1" />)

    fireEvent.click(await screen.findByRole('button', { name: '忽略此候选' }))
    fireEvent.click(screen.getByRole('button', { name: '确认忽略此候选' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('忽略 Memory 候选的请求已被安全拒绝')
    await waitFor(() => expect(screen.queryByText('Pending memory statement for explicit human review.')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '确认忽略此候选' })).not.toBeInTheDocument()
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

    fireEvent.click(await screen.findByRole('button', { name: '修订此 Memory' }))
    fireEvent.change(screen.getByLabelText(
      `修订 Memory 内容 ${activeMemory.memoryId}`,
    ), { target: { value: revisedStatement } })
    fireEvent.click(screen.getByRole('button', { name: '保存精确修订' }))

    await waitFor(() => expect(reviseAgentMemory).toHaveBeenCalledWith({
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
    expect(screen.getByText('修订 3 · 当前头版本 v5')).toBeInTheDocument()
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

    fireEvent.click(await screen.findByRole('button', { name: '删除此 Memory' }))
    expect(deleteAgentMemory).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认删除此 Memory' }))

    await waitFor(() => expect(deleteAgentMemory).toHaveBeenCalledWith({
      runId: runtime.authority.runId,
      localProjectId: runtime.scope.localProjectId,
      memoryId: activeMemory.memoryId,
      expectedRevision: activeMemory.currentRevision,
      expectedHeadVersion: activeMemory.headVersion,
      expectedContentDigest: activeMemory.contentDigest,
      expectedProvenanceDigest: activeMemory.provenanceDigest,
    }))
    expect(await screen.findAllByText('删除后内容不可用。')).toHaveLength(2)
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

    fireEvent.click(await screen.findByRole('button', { name: '完成精确清除' }))

    await waitFor(() => expect(deleteAgentMemory).toHaveBeenCalledWith({
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
