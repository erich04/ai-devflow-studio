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
    ? `team ${scope.organizationId}/${scope.projectId} · user ${scope.userId}`
    : `local ${scope.localProjectId} · user ${scope.userId}`
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
        if (!disposed) setError('Agent Memory lifecycle could not be loaded safely.')
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
        setError('Agent Memory promotion was rejected safely. Refresh and review the Candidate again.')
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
        setError('Agent Memory revision was rejected safely. Refresh and review the current version again.')
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
        setError('Agent Memory deletion or purge was rejected safely. Refresh and review the current version again.')
      }
    } finally {
      if (operationVersion === selectionVersion.current) setIsDeleting(false)
    }
  }

  return (
    <section className="agent-console-section" aria-label="Agent Memory lifecycle">
      <div className="section-heading section-heading--inline">
        <span>Agent Memory</span>
        <strong><BrainCircuit size={15} /> scoped lifecycle</strong>
      </div>

      {!desktopApi || !runId || !localProjectId ? (
        <article className="agent-evidence-card">
          <p className="empty-note">Select a Local Project and Run to inspect Agent Memory.</p>
        </article>
      ) : null}
      {isLoading ? <p className="empty-note">Loading Agent Memory lifecycle…</p> : null}
      {error ? <p className="error-note" role="alert">{error}</p> : null}
      {!isLoading && !error && !hasRuntimeScope ? (
        <article className="agent-evidence-card">
          <p className="empty-note">No exact Agent Runtime is available for Memory scope.</p>
        </article>
      ) : null}

      {snapshot ? (
        <>
          <div className="agent-fact-grid agent-fact-grid--three">
            <div className="compact-row">
              <span>Working Memory</span>
              <strong>Runtime checkpoint only</strong>
            </div>
            <div className="compact-row">
              <span>Candidate</span>
              <strong>
                {snapshot.candidateCount} Memory Candidate
                {snapshot.candidateCount === 1 ? '' : 's'}
              </strong>
            </div>
            <div className="compact-row">
              <span>Durable Memory</span>
              <strong>
                {snapshot.memoryCount} Durable {snapshot.memoryCount === 1 ? 'Memory' : 'Memories'}
              </strong>
            </div>
          </div>

          {snapshot.truncated ? (
            <div className="agent-advisory agent-advisory--warn">
              <span>Bounded projection</span>
              <strong><ShieldAlert size={15} /> Additional lifecycle rows remain main-only</strong>
            </div>
          ) : null}

          {snapshot.candidates.length > 0 ? (
            <div className="agent-evidence-grid">
              {snapshot.candidates.map((candidate) => (
                <article className="agent-evidence-card" key={candidate.id}>
                  <div className="section-heading">
                    <span>Memory Candidate</span>
                    <strong>{candidate.lifecycleStatus}</strong>
                  </div>
                  <p>{candidate.statement}</p>
                  <div className="compact-row">
                    <span>Candidate ID</span>
                    <code>{candidate.id}</code>
                  </div>
                  <div className="compact-row">
                    <span>Provenance</span>
                    <strong>
                      {candidate.provenance.runtimeId} · checkpoint v
                      {candidate.provenance.checkpointVersion} · sequence {candidate.provenance.sequence}
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
                      {isPromoting ? 'Promoting Memory…' : 'Promote private user-project Memory'}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <article className="agent-evidence-card">
              <p className="empty-note">No inert Memory Candidate is available for this project.</p>
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
                    <span>Durable Memory</span>
                    <strong>{memory.lifecycleStatus}</strong>
                  </div>
                  <p>{memory.statement ?? 'Content unavailable after deletion.'}</p>
                  <div className="compact-row">
                    <span>Version</span>
                    <strong>revision {memory.currentRevision} · head v{memory.headVersion}</strong>
                  </div>
                  <div className="compact-row">
                    <span>Authority</span>
                    <strong>
                      {memory.visibility} · {memory.sensitivity} · {memory.retentionClass}
                    </strong>
                  </div>
                  <div className="compact-row">
                    <span>Expiry</span>
                    <strong>{memory.expiresAt ?? 'until deleted'}</strong>
                  </div>
                  <div className="compact-row">
                    <span>Source Candidate</span>
                    <code>{memory.sourceCandidateId}</code>
                  </div>
                  {memory.tombstone ? (
                    <div className="agent-advisory">
                      <span>Deletion</span>
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
                          Revised Memory statement
                          <textarea
                            aria-label={`Revised Memory statement for ${memory.memoryId}`}
                            value={revisionStatement}
                            disabled={isRevising}
                            onChange={(event) => setRevisionStatement(event.target.value)}
                          />
                        </label>
                        <div className="button-row">
                          <button
                            type="button"
                            className="primary-button"
                            disabled={
                              isRevising ||
                              revisionStatement.length === 0 ||
                              revisionStatement.trim() !== revisionStatement ||
                              revisionStatement === memory.statement
                            }
                            onClick={() => { void reviseMemory(memory) }}
                          >
                            {isRevising ? 'Saving exact revision…' : 'Save exact revision'}
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
                            Cancel
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
                        Revise exact Memory
                      </button>
                    )
                  ) : null}
                  {memory.lifecycleStatus === 'active' &&
                  memory.revisionStatus === 'active' ? (
                    deletingMemoryId === memory.memoryId ? (
                      <div className="agent-advisory">
                        <span>This tombstones the exact current Memory before derived-state purge.</span>
                        <div className="button-row">
                          <button
                            type="button"
                            className="primary-button"
                            disabled={isDeleting}
                            onClick={() => { void deleteMemory(memory) }}
                          >
                            {isDeleting ? 'Deleting exact Memory…' : 'Confirm exact deletion'}
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={isDeleting}
                            onClick={() => setDeletingMemoryId(null)}
                          >
                            Cancel deletion
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
                        Delete exact Memory
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
                      className="primary-button"
                      disabled={isDeleting}
                      onClick={() => { void deleteMemory(memory) }}
                    >
                      {isDeleting ? 'Completing exact purge…' : 'Complete exact purge'}
                    </button>
                  ) : null}
                  <p className="empty-note">{scopeLabel(memory.scope)}</p>
                </article>
              ))}
            </div>
          ) : (
            <article className="agent-evidence-card">
              <p className="empty-note">No Durable Memory revision exists for this project.</p>
            </article>
          )}
          <p className="empty-note">
            Scope sessions, authority digests, opaque capabilities, raw Tool output, and local paths remain in Electron main.
          </p>
        </>
      ) : null}
    </section>
  )
}
