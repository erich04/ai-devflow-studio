import { useEffect, useState } from 'react'
import { BrainCircuit, CheckCircle2, ShieldAlert } from 'lucide-react'
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
  const [isLoading, setIsLoading] = useState(false)
  const [hasRuntimeScope, setHasRuntimeScope] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!desktopApi || !runId || !localProjectId) {
      setSnapshot(null)
      setIsLoading(false)
      setHasRuntimeScope(true)
      setError(null)
      return
    }
    let disposed = false
    setSnapshot(null)
    setIsLoading(true)
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
        if (!disposed) setSnapshot(parsed)
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
