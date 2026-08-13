import { useEffect, useMemo, useState } from 'react'
import { Activity, Ban, CheckCircle2, RotateCcw } from 'lucide-react'
import {
  type AgentRuntimeRendererSnapshot,
} from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from './desktop-api'
import {
  createAgentRuntimeConsoleState,
  mergeAgentRuntimeConsoleSnapshot,
  type AgentRuntimeConsoleState,
} from './app/agent-runtime-console-state'

type AgentRuntimePanelProps = {
  desktopApi: DevFlowDesktopApi | null
  runId: string | undefined
  localProjectId: string | undefined
}

function commandFor(snapshot: AgentRuntimeRendererSnapshot) {
  return {
    runtimeId: snapshot.runtime.runtimeId,
    runId: snapshot.runtime.runId,
    localProjectId: snapshot.runtime.localProjectId,
    expectedVersion: snapshot.runtime.version,
    expectedCheckpointVersion: snapshot.runtime.checkpointVersion,
  }
}

function mergeSnapshot(
  current: AgentRuntimeConsoleState,
  snapshot: unknown,
): AgentRuntimeConsoleState {
  return mergeAgentRuntimeConsoleSnapshot({ state: current, snapshot }).state
}

export function AgentRuntimePanel({
  desktopApi,
  runId,
  localProjectId,
}: AgentRuntimePanelProps) {
  const [state, setState] = useState<AgentRuntimeConsoleState | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isActing, setIsActing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!desktopApi || !runId || !localProjectId) {
      setState(null)
      setIsLoading(false)
      setError(null)
      return
    }

    let disposed = false
    let loaded = false
    const queuedSnapshots: unknown[] = []
    const selection = { runId, localProjectId }
    setState(null)
    setIsLoading(true)
    setError(null)

    const unsubscribe = desktopApi.onAgentRuntimeUpdated((snapshot) => {
      if (!loaded) {
        queuedSnapshots.push(snapshot)
        return
      }
      setState((current) => {
        if (!current) return current
        try {
          return mergeSnapshot(current, snapshot)
        } catch {
          setError('Agent Runtime update was rejected by the renderer contract.')
          return current
        }
      })
    })

    void desktopApi.listAgentRuntimes(selection)
      .then(async (list) => {
        if (disposed) return
        let next = createAgentRuntimeConsoleState({ selection, list, detail: null })
        const runtimeId = next.selectedRuntimeId
        if (runtimeId) {
          const detail = await desktopApi.getAgentRuntime({ runtimeId, ...selection })
          if (disposed) return
          next = mergeSnapshot(next, detail)
        }
        for (const queued of queuedSnapshots) {
          next = mergeSnapshot(next, queued)
        }
        loaded = true
        setState(next)
      })
      .catch(() => {
        if (!disposed) {
          setError('Agent Runtime state could not be loaded safely.')
        }
      })
      .finally(() => {
        if (!disposed) setIsLoading(false)
      })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [desktopApi, localProjectId, runId])

  const detail = state?.detail ?? null
  const canAdvance = Boolean(
    detail &&
    detail.runtime.status !== 'terminal' &&
    detail.runtime.status !== 'waiting_permission',
  )
  const canCancel = Boolean(detail && detail.runtime.status !== 'terminal')
  const actionLabel = detail?.runtime.status === 'checkpointed'
    ? 'Resume Runtime'
    : 'Continue Runtime'
  const runtimeEvents = detail?.events ?? []
  const activeAction = detail?.runtime.activeAction ?? null
  const selectedItem = useMemo(
    () => state?.items.find((item) => item.runtime.runtimeId === state.selectedRuntimeId) ?? null,
    [state],
  )

  async function selectRuntime(runtimeId: string) {
    if (!desktopApi || !state || !runId || !localProjectId) return
    if (runtimeId === state.selectedRuntimeId && state.detail) return
    setError(null)
    setIsLoading(true)
    setState({ ...state, selectedRuntimeId: runtimeId, detail: null })
    try {
      const snapshot = await desktopApi.getAgentRuntime({ runtimeId, runId, localProjectId })
      setState((current) => current ? mergeSnapshot(current, snapshot) : current)
    } catch {
      setError('Agent Runtime detail could not be loaded safely.')
    } finally {
      setIsLoading(false)
    }
  }

  async function executeAction(kind: 'advance' | 'cancel') {
    if (!desktopApi || !detail || isActing) return
    setIsActing(true)
    setError(null)
    try {
      const snapshot = kind === 'advance'
        ? await desktopApi.advanceAgentRuntime(commandFor(detail))
        : await desktopApi.cancelAgentRuntime(commandFor(detail))
      setState((current) => current ? mergeSnapshot(current, snapshot) : current)
    } catch {
      setError('Agent Runtime command was rejected or became stale. Reload the current Runtime.')
    } finally {
      setIsActing(false)
    }
  }

  return (
    <section className="agent-console-section" aria-label="Agent Runtime observability">
      <div className="section-heading section-heading--inline">
        <span>Agent Runtime</span>
        <strong>Bounded execution and recovery</strong>
      </div>

      {!desktopApi || !runId || !localProjectId ? (
        <article className="agent-evidence-card">
          <p className="empty-note">Select a local project and Run to inspect Agent Runtime state.</p>
        </article>
      ) : null}

      {isLoading && !state ? <p className="empty-note">Loading Agent Runtime state…</p> : null}
      {error ? <p className="error-note" role="alert">{error}</p> : null}

      {state && state.items.length === 0 ? (
        <article className="agent-evidence-card">
          <p className="empty-note">No Agent Runtime has been recorded for this Run.</p>
        </article>
      ) : null}

      {state && state.items.length > 0 ? (
        <div className="agent-path-grid">
          <article className="agent-evidence-card">
            <div className="section-heading">
              <span>Runtime list</span>
              <strong>{state.items.length}</strong>
            </div>
            <div className="trace-list">
              {state.items.map((item) => (
                <button
                  className="ghost-button"
                  type="button"
                  aria-pressed={item.runtime.runtimeId === state.selectedRuntimeId}
                  key={item.runtime.runtimeId}
                  onClick={() => void selectRuntime(item.runtime.runtimeId)}
                >
                  <Activity size={15} />
                  {item.runtime.runtimeId} · {item.runtime.status}
                </button>
              ))}
            </div>
          </article>

          <article className="agent-evidence-card">
            <div className="section-heading">
              <span>Current state</span>
              <strong>{detail?.runtime.status ?? selectedItem?.runtime.status ?? 'loading'}</strong>
            </div>
            {detail ? (
              <>
                <div className="agent-fact-grid agent-fact-grid--three">
                  <div className="compact-row">
                    <span>Steps</span>
                    <strong>{detail.runtime.counters.steps} / {detail.runtime.bounds.maxSteps} steps</strong>
                  </div>
                  <div className="compact-row">
                    <span>Tool calls</span>
                    <strong>{detail.runtime.counters.toolCalls} / {detail.runtime.bounds.maxToolCalls}</strong>
                  </div>
                  <div className="compact-row">
                    <span>Tokens</span>
                    <strong>{detail.runtime.counters.tokens} / {detail.runtime.bounds.maxTokens}</strong>
                  </div>
                  <div className="compact-row">
                    <span>Cost</span>
                    <strong>${detail.runtime.counters.costUsd.toFixed(4)} / ${detail.runtime.bounds.maxCostUsd.toFixed(2)}</strong>
                  </div>
                  <div className="compact-row">
                    <span>Checkpoint</span>
                    <strong>v{detail.runtime.checkpointVersion}</strong>
                  </div>
                  <div className="compact-row">
                    <span>Accepted actions</span>
                    <strong>{detail.runtime.acceptedActionCount}</strong>
                  </div>
                  <div className="compact-row">
                    <span>Trajectory</span>
                    <strong>{runtimeEvents.length} trajectory events</strong>
                  </div>
                  <div className="compact-row">
                    <span>Stop reason</span>
                    <strong>{detail.runtime.stopReason ?? 'none'}</strong>
                  </div>
                </div>

                {activeAction ? (
                  <div className="agent-advisory">
                    <span>Active capability</span>
                    <strong>{activeAction.kind} · {activeAction.capabilityId} v{activeAction.capabilityVersion}</strong>
                    <p>Request digest {activeAction.requestDigest}</p>
                  </div>
                ) : null}

                {detail.runtime.status === 'waiting_permission' || activeAction?.requiresPermission ? (
                  <div className="agent-advisory agent-advisory--warn">
                    <span>Permission</span>
                    <strong>Waiting for an existing permission authority</strong>
                    <p>This view cannot issue a capability or inject a Tool result.</p>
                  </div>
                ) : null}

                <div className="inspector-actions">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!canAdvance || isActing}
                    onClick={() => void executeAction('advance')}
                  >
                    <RotateCcw size={15} />
                    {actionLabel}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={!canCancel || isActing}
                    onClick={() => void executeAction('cancel')}
                  >
                    <Ban size={15} />
                    Cancel Runtime
                  </button>
                </div>
              </>
            ) : <p className="empty-note">Loading the selected Runtime detail…</p>}
          </article>
        </div>
      ) : null}

      {detail ? (
        <div className="agent-path-grid">
          <article className="agent-evidence-card">
            <div className="section-heading">
              <span>Trajectory</span>
              <strong>{runtimeEvents.length}</strong>
            </div>
            <div className="trace-list">
              {runtimeEvents.map((event) => (
                <div className="trace-step" key={`${event.runtimeId}-${event.sequence}`}>
                  <span>#{event.sequence} · checkpoint {event.checkpointVersion}</span>
                  <strong>{event.type}</strong>
                  <p>{event.createdAt}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="agent-evidence-card">
            <div className="section-heading">
              <span>Runtime Evidence</span>
              <strong><CheckCircle2 size={15} /> redacted</strong>
            </div>
            <div className="compact-row">
              <span>Context digest</span>
              <code>{detail.runtime.contextDigest}</code>
            </div>
            <div className="compact-row">
              <span>Capability set digest</span>
              <code>{detail.runtime.capabilitySetDigest}</code>
            </div>
            <div className="compact-row">
              <span>Last observation</span>
              <code>{detail.runtime.lastObservationDigest}</code>
            </div>
            <div className="compact-row">
              <span>Last result</span>
              <code>{detail.runtime.lastResultDigest ?? 'none'}</code>
            </div>
            {detail.latestEvaluation ? (
              <div className="agent-advisory">
                <span>Latest evaluation</span>
                <strong>{detail.latestEvaluation.evaluation}</strong>
                <p>{detail.latestEvaluation.summary}</p>
              </div>
            ) : null}
            <p className="empty-note">
              Source, local paths, raw Tool output, scope sessions, and complete checkpoints remain in Electron main.
            </p>
          </article>
        </div>
      ) : null}
    </section>
  )
}
