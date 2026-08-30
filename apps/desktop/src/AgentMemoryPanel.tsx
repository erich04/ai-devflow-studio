import { useEffect, useRef, useState } from 'react'
import { BrainCircuit, ShieldAlert } from 'lucide-react'
import {
  parseAgentRuntimeRendererListItem,
  parseAgentMemoryRendererSnapshot,
  type AgentMemoryRendererSnapshot,
  type AgentMemoryRendererScope,
} from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from './desktop-api'

type AgentMemoryPanelProps = {
  desktopApi: DevFlowDesktopApi | null
  runId: string | undefined
  localProjectId: string | undefined
}

function scopeLabel(scope: AgentMemoryRendererScope) {
  return scope.kind === 'team'
    ? `Team ${scope.organizationId}/${scope.projectId} · 用户 ${scope.userId}`
    : `本地 ${scope.localProjectId} · 用户 ${scope.userId}`
}

function memoryStatusLabel(status: string) {
  return {
    pending: '待确认',
    promoted: '已提升',
    rejected: '已拒绝',
    active: '有效',
    conflict: '冲突',
    purge_pending: '等待清除',
    deleted: '已删除',
    expired: '已过期',
  }[status] ?? status
}

export function AgentMemoryPanel({ desktopApi, runId, localProjectId }: AgentMemoryPanelProps) {
  const [snapshot, setSnapshot] = useState<AgentMemoryRendererSnapshot | null>(null)
  const [runtimeSelection, setRuntimeSelection] = useState<{
    runtimeId: string
    runId: string
    localProjectId: string
  } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isPromoting, setIsPromoting] = useState(false)
  const [isRevising, setIsRevising] = useState(false)
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)
  const [revisionStatement, setRevisionStatement] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [deletingMemoryId, setDeletingMemoryId] = useState<string | null>(null)
  const [hasRuntimeScope, setHasRuntimeScope] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const selectionVersion = useRef(0)

  useEffect(() => {
    selectionVersion.current += 1
    if (!desktopApi || !runId || !localProjectId) {
      setSnapshot(null)
      setRuntimeSelection(null)
      setIsLoading(false)
      setIsPromoting(false)
      setIsRevising(false)
      setEditingMemoryId(null)
      setRevisionStatement('')
      setIsDeleting(false)
      setDeletingMemoryId(null)
      setHasRuntimeScope(true)
      setError(null)
      return
    }
    let disposed = false
    setSnapshot(null)
    setRuntimeSelection(null)
    setIsLoading(true)
    setIsPromoting(false)
    setIsRevising(false)
    setEditingMemoryId(null)
    setRevisionStatement('')
    setIsDeleting(false)
    setDeletingMemoryId(null)
    setHasRuntimeScope(true)
    setError(null)
    void (async () => {
      const selection = { runId, localProjectId }
      const runtimes = (await desktopApi.listAgentRuntimes(selection))
        .map(parseAgentRuntimeRendererListItem)
      if (runtimes.some((item) =>
        item.runtime.runId !== runId || item.runtime.localProjectId !== localProjectId)) {
        throw new Error('Agent Memory Runtime selection is invalid')
      }
      if (disposed) return
      const selected = [...runtimes].sort((left, right) =>
        right.runtime.updatedAt.localeCompare(left.runtime.updatedAt) ||
        left.runtime.runtimeId.localeCompare(right.runtime.runtimeId))[0]
      if (!selected) {
        if (!disposed) setHasRuntimeScope(false)
        return
      }
      const value = await desktopApi.listAgentMemoryLifecycle({
        runtimeId: selected.runtime.runtimeId,
        ...selection,
      })
      const parsed = parseAgentMemoryRendererSnapshot(value)
      if (parsed.localProjectId !== localProjectId) {
        throw new Error('Agent Memory renderer selection is stale')
      }
      if (!disposed) {
        setRuntimeSelection({
          runtimeId: selected.runtime.runtimeId,
          ...selection,
        })
        setSnapshot(parsed)
      }
    })()
      .catch(() => {
        if (!disposed) setError('无法安全读取 Agent Memory 生命周期。')
      })
      .finally(() => {
        if (!disposed) setIsLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [desktopApi, localProjectId, runId])

  async function promoteCandidate(candidate: AgentMemoryRendererSnapshot['candidates'][number]) {
    if (
      !desktopApi ||
      runtimeSelection === null ||
      runtimeSelection.runId !== runId ||
      runtimeSelection.localProjectId !== localProjectId ||
      candidate.lifecycleStatus !== 'pending'
    ) return
    const operationVersion = selectionVersion.current
    setIsPromoting(true)
    setError(null)
    try {
      const value = await desktopApi.promoteAgentMemoryCandidate({
        ...runtimeSelection,
        candidateId: candidate.id,
        expectedContentDigest: candidate.contentDigest,
        expectedProvenanceDigest: candidate.provenanceDigest,
      })
      const parsed = parseAgentMemoryRendererSnapshot(value)
      if (
        parsed.localProjectId !== runtimeSelection.localProjectId ||
        operationVersion !== selectionVersion.current
      ) throw new Error('Agent Memory promotion result is stale')
      setSnapshot(parsed)
    } catch {
      if (operationVersion === selectionVersion.current) {
        setError('Agent Memory 候选提升请求已被安全拒绝；请刷新后重新检查。')
      }
    } finally {
      if (operationVersion === selectionVersion.current) setIsPromoting(false)
    }
  }

  async function reviseMemory(memory: AgentMemoryRendererSnapshot['memories'][number]) {
    if (
      !desktopApi ||
      runtimeSelection === null ||
      runtimeSelection.runId !== runId ||
      runtimeSelection.localProjectId !== localProjectId ||
      memory.lifecycleStatus !== 'active' ||
      memory.revisionStatus !== 'active' ||
      memory.statement === null ||
      revisionStatement.length === 0 ||
      revisionStatement.trim() !== revisionStatement ||
      revisionStatement === memory.statement
    ) return
    const operationVersion = selectionVersion.current
    setIsRevising(true)
    setError(null)
    try {
      const value = await desktopApi.reviseAgentMemory({
        ...runtimeSelection,
        memoryId: memory.memoryId,
        expectedRevision: memory.currentRevision,
        expectedHeadVersion: memory.headVersion,
        expectedContentDigest: memory.contentDigest,
        expectedProvenanceDigest: memory.provenanceDigest,
        statement: revisionStatement,
      })
      const parsed = parseAgentMemoryRendererSnapshot(value)
      if (
        parsed.localProjectId !== runtimeSelection.localProjectId ||
        operationVersion !== selectionVersion.current
      ) throw new Error('Agent Memory revision result is stale')
      setSnapshot(parsed)
      setEditingMemoryId(null)
      setRevisionStatement('')
    } catch {
      if (operationVersion === selectionVersion.current) {
        setError('Agent Memory 修订请求已被安全拒绝；请刷新后重新检查当前版本。')
      }
    } finally {
      if (operationVersion === selectionVersion.current) setIsRevising(false)
    }
  }

  async function deleteMemory(memory: AgentMemoryRendererSnapshot['memories'][number]) {
    if (
      !desktopApi ||
      runtimeSelection === null ||
      runtimeSelection.runId !== runId ||
      runtimeSelection.localProjectId !== localProjectId ||
      memory.revisionStatus !== 'active' ||
      !(
        memory.lifecycleStatus === 'active' ||
        (
          memory.lifecycleStatus === 'purge_pending' &&
          memory.tombstone?.purgeStatus === 'pending' &&
          memory.tombstone.deletionVersion === memory.headVersion &&
          memory.tombstone.lastRevision === memory.currentRevision
        )
      )
    ) return
    const operationVersion = selectionVersion.current
    setIsDeleting(true)
    setError(null)
    try {
      const value = await desktopApi.deleteAgentMemory({
        ...runtimeSelection,
        memoryId: memory.memoryId,
        expectedRevision: memory.currentRevision,
        expectedHeadVersion: memory.headVersion,
        expectedContentDigest: memory.contentDigest,
        expectedProvenanceDigest: memory.provenanceDigest,
      })
      const parsed = parseAgentMemoryRendererSnapshot(value)
      if (
        parsed.localProjectId !== runtimeSelection.localProjectId ||
        operationVersion !== selectionVersion.current
      ) throw new Error('Agent Memory deletion result is stale')
      setSnapshot(parsed)
      setDeletingMemoryId(null)
    } catch {
      if (operationVersion === selectionVersion.current) {
        setError('Agent Memory 删除或清除请求已被安全拒绝；请刷新后重新检查当前版本。')
      }
    } finally {
      if (operationVersion === selectionVersion.current) setIsDeleting(false)
    }
  }

  return (
    <section className="agent-console-section" aria-label="Agent Memory 生命周期">
      <div className="section-heading section-heading--inline">
        <span title="Memory：独立 Runtime 生成、经人工提升后持久保存的记忆。">Agent Memory（记忆）</span>
        <strong><BrainCircuit size={15} /> 按作用域管理生命周期</strong>
      </div>

      {!desktopApi || !runId || !localProjectId ? (
        <article className="agent-evidence-card">
          <p className="empty-note">请先选择 Local Project（本地项目）和 Run，再检查 Agent Memory。</p>
        </article>
      ) : null}
      {isLoading ? <p className="empty-note">正在读取 Agent Memory 生命周期…</p> : null}
      {error ? <p className="error-note" role="alert">{error}</p> : null}
      {!isLoading && !error && !hasRuntimeScope ? (
        <article className="agent-evidence-card">
          <p className="empty-note">当前 Run 尚无可用于 Memory 作用域的精确独立 Runtime。</p>
        </article>
      ) : null}

      {snapshot ? (
        <>
          <div className="agent-fact-grid agent-fact-grid--three">
            <div className="compact-row">
              <span>工作记忆</span>
              <strong>仅保存在 Runtime 检查点</strong>
            </div>
            <div className="compact-row">
              <span>记忆候选</span>
              <strong>
                {snapshot.candidateCount} 个 Memory Candidate（记忆候选）
              </strong>
            </div>
            <div className="compact-row">
              <span>持久记忆</span>
              <strong>
                {snapshot.memoryCount} 个 Durable Memory（持久记忆）
              </strong>
            </div>
          </div>

          {snapshot.truncated ? (
            <div className="agent-advisory agent-advisory--warn">
              <span>有界投影</span>
              <strong><ShieldAlert size={15} /> 其余生命周期记录仅保留在 Electron Main</strong>
            </div>
          ) : null}

          {snapshot.candidates.length > 0 ? (
            <div className="agent-evidence-grid">
              {snapshot.candidates.map((candidate) => (
                <article className="agent-evidence-card" key={candidate.id}>
                  <div className="section-heading">
                    <span>Memory Candidate（记忆候选）</span>
                    <strong>{memoryStatusLabel(candidate.lifecycleStatus)}</strong>
                  </div>
                  <p>{candidate.statement}</p>
                  <div className="compact-row">
                    <span>候选 ID</span>
                    <code>{candidate.id}</code>
                  </div>
                  <div className="compact-row">
                    <span>来源</span>
                    <strong>
                      {candidate.provenance.runtimeId} · 检查点 v
                      {candidate.provenance.checkpointVersion} · 序号 {candidate.provenance.sequence}
                    </strong>
                  </div>
                  <p className="empty-note">{scopeLabel(candidate.scope)}</p>
                  {candidate.lifecycleStatus === 'pending' ? (
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={isPromoting}
                      onClick={() => { void promoteCandidate(candidate) }}
                    >
                      {isPromoting ? '正在提升 Memory…' : '提升为用户项目私有 Memory'}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <article className="agent-evidence-card">
              <p className="empty-note">当前项目暂无待人工确认的 Memory Candidate；这是可选高级信息。</p>
            </article>
          )}

          {snapshot.memories.length > 0 ? (
            <div className="agent-evidence-grid">
              {snapshot.memories.map((memory) => (
                <article
                  className={`agent-evidence-card${
                    memory.lifecycleStatus === 'conflict' || memory.lifecycleStatus === 'purge_pending'
                      ? ' agent-evidence-card--warn'
                      : memory.lifecycleStatus === 'deleted' || memory.lifecycleStatus === 'expired'
                        ? ' agent-evidence-card--bad'
                        : ' agent-evidence-card--good'
                  }`}
                  key={memory.memoryId}
                >
                  <div className="section-heading">
                    <span>Durable Memory（持久记忆）</span>
                    <strong>{memoryStatusLabel(memory.lifecycleStatus)}</strong>
                  </div>
                  <p>{memory.statement ?? '删除后内容不可用。'}</p>
                  <div className="compact-row">
                    <span>版本</span>
                    <strong>修订 {memory.currentRevision} · 当前头版本 v{memory.headVersion}</strong>
                  </div>
                  <div className="compact-row">
                    <span>权限边界</span>
                    <strong>
                      {memory.visibility} · {memory.sensitivity} · {memory.retentionClass}
                    </strong>
                  </div>
                  <div className="compact-row">
                    <span>过期时间</span>
                    <strong>{memory.expiresAt ?? '直至删除'}</strong>
                  </div>
                  <div className="compact-row">
                    <span>来源候选</span>
                    <code>{memory.sourceCandidateId}</code>
                  </div>
                  {memory.tombstone ? (
                    <div className="agent-advisory">
                      <span>删除状态</span>
                      <strong>
                        purge {memory.tombstone.purgeStatus} · deletion v
                        {memory.tombstone.deletionVersion}
                      </strong>
                    </div>
                  ) : null}
                  {memory.lifecycleStatus === 'active' &&
                  memory.revisionStatus === 'active' &&
                  memory.statement !== null ? (
                    editingMemoryId === memory.memoryId ? (
                      <div className="form-stack">
                        <label>
                          修订后的 Memory 内容
                          <textarea
                            aria-label={`修订 Memory 内容 ${memory.memoryId}`}
                            value={revisionStatement}
                            disabled={isRevising}
                            onChange={(event) => setRevisionStatement(event.target.value)}
                          />
                        </label>
                        <div className="button-row">
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={
                              isRevising ||
                              revisionStatement.length === 0 ||
                              revisionStatement.trim() !== revisionStatement ||
                              revisionStatement === memory.statement
                            }
                            onClick={() => { void reviseMemory(memory) }}
                          >
                            {isRevising ? '正在保存精确修订…' : '保存精确修订'}
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={isRevising}
                            onClick={() => {
                              setEditingMemoryId(null)
                              setRevisionStatement('')
                            }}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={isPromoting || isRevising}
                        onClick={() => {
                          setEditingMemoryId(memory.memoryId)
                          setRevisionStatement(memory.statement ?? '')
                        }}
                      >
                        修订此 Memory
                      </button>
                    )
                  ) : null}
                  {memory.lifecycleStatus === 'active' &&
                  memory.revisionStatus === 'active' ? (
                    deletingMemoryId === memory.memoryId ? (
                      <div className="agent-advisory">
                        <span>确认后会先为当前精确 Memory 写入墓碑，再清除派生状态。</span>
                        <div className="button-row">
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={isDeleting}
                            onClick={() => { void deleteMemory(memory) }}
                          >
                            {isDeleting ? '正在删除精确 Memory…' : '确认删除此 Memory'}
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={isDeleting}
                            onClick={() => setDeletingMemoryId(null)}
                          >
                            取消删除
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={isPromoting || isRevising || isDeleting || editingMemoryId !== null}
                        onClick={() => setDeletingMemoryId(memory.memoryId)}
                      >
                        删除此 Memory
                      </button>
                    )
                  ) : null}
                  {memory.lifecycleStatus === 'purge_pending' &&
                  memory.revisionStatus === 'active' &&
                  memory.tombstone?.purgeStatus === 'pending' &&
                  memory.tombstone.deletionVersion === memory.headVersion &&
                  memory.tombstone.lastRevision === memory.currentRevision ? (
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={isDeleting}
                      onClick={() => { void deleteMemory(memory) }}
                    >
                      {isDeleting ? '正在完成精确清除…' : '完成精确清除'}
                    </button>
                  ) : null}
                  <p className="empty-note">{scopeLabel(memory.scope)}</p>
                </article>
              ))}
            </div>
          ) : (
            <article className="agent-evidence-card">
              <p className="empty-note">当前项目暂无 Durable Memory（持久记忆）修订。</p>
            </article>
          )}
          <p className="empty-note">
            作用域会话、权限摘要、不透明能力、Tool 原始输出和本地路径仅保留在 Electron Main。
          </p>
        </>
      ) : null}
    </section>
  )
}
