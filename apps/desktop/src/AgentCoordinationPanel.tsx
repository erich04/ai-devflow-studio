import { useEffect, useState } from 'react'
import { Activity, GitBranch, Network, ShieldCheck } from 'lucide-react'
import {
  parseCoordinationRendererSnapshot,
  type CoordinationRendererSnapshot,
} from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from './desktop-api'

type AgentCoordinationPanelProps = {
  desktopApi: DevFlowDesktopApi | null
  runId: string | undefined
  nodeId?: string | undefined
  expectedRunVersion?: number | undefined
  localProjectId: string | undefined
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

function parseSelectedSnapshot(
  value: unknown,
  selection: { runId: string; localProjectId: string },
): CoordinationRendererSnapshot {
  const snapshot = parseCoordinationRendererSnapshot(value)
  if (
    snapshot.session.runId !== selection.runId ||
    snapshot.session.localProjectId !== selection.localProjectId
  ) {
    throw new Error('Agent Coordination renderer selection is stale')
  }
  return snapshot
}

export function AgentCoordinationPanel({
  desktopApi,
  runId,
  nodeId,
  expectedRunVersion,
  localProjectId,
}: AgentCoordinationPanelProps) {
  const [sessions, setSessions] = useState<CoordinationRendererSnapshot[]>([])
  const [detail, setDetail] = useState<CoordinationRendererSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isActing, setIsActing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!desktopApi || !runId || !localProjectId) {
      setSessions([])
      setDetail(null)
      setIsLoading(false)
      setIsActing(false)
      setError(null)
      return
    }

    let disposed = false
    const selection = { runId, localProjectId }
    setSessions([])
    setDetail(null)
    setIsLoading(true)
    setError(null)

    void desktopApi.listCoordinationSessions(selection)
      .then((values) => {
        const parsed = values
          .map((value) => parseSelectedSnapshot(value, selection))
          .sort((left, right) =>
            right.session.updatedAt.localeCompare(left.session.updatedAt) ||
            left.session.coordinationId.localeCompare(right.session.coordinationId),
          )
        if (!disposed) {
          setSessions(parsed)
          setDetail(parsed[0] ?? null)
        }
      })
      .catch(() => {
        if (!disposed) {
          setSessions([])
          setDetail(null)
          setError('Multi-Agent Coordination state could not be loaded safely.')
        }
      })
      .finally(() => {
        if (!disposed) setIsLoading(false)
      })

    return () => {
      disposed = true
    }
  }, [desktopApi, localProjectId, runId])

  async function selectSession(coordinationId: string) {
    if (!desktopApi || !runId || !localProjectId || isLoading || isActing) return
    if (detail?.session.coordinationId === coordinationId) return
    const selection = { runId, localProjectId }
    setIsLoading(true)
    setError(null)
    try {
      const value = await desktopApi.getCoordinationSession({ coordinationId, ...selection })
      const parsed = parseSelectedSnapshot(value, selection)
      setDetail(parsed)
      setSessions((current) => current.map((snapshot) =>
        snapshot.session.coordinationId === coordinationId ? parsed : snapshot))
    } catch {
      setError('Multi-Agent Coordination detail could not be loaded safely.')
    } finally {
      setIsLoading(false)
    }
  }

  async function startPlan() {
    if (
      !desktopApi ||
      !runId ||
      !nodeId ||
      !localProjectId ||
      expectedRunVersion === undefined ||
      isLoading ||
      isActing
    ) return
    const selection = { runId, localProjectId }
    setIsActing(true)
    setError(null)
    try {
      const parsed = parseSelectedSnapshot(await desktopApi.startCoordinationPlan({
        planId: 'bounded-repair-v1',
        runId,
        nodeId,
        localProjectId,
        expectedRunVersion,
      }), selection)
      setDetail(parsed)
      setSessions([parsed])
    } catch {
      setError('Multi-Agent Coordination plan start was rejected safely.')
    } finally {
      setIsActing(false)
    }
  }

  function applyCommandSnapshot(
    value: unknown,
    selection: { runId: string; localProjectId: string },
  ) {
    const parsed = parseSelectedSnapshot(value, selection)
    setDetail(parsed)
    setSessions((current) => current.map((snapshot) =>
      snapshot.session.coordinationId === parsed.session.coordinationId ? parsed : snapshot))
  }

  async function resumeSession() {
    if (!desktopApi || !runId || !localProjectId || !detail || isActing) return
    const selection = { runId, localProjectId }
    setIsActing(true)
    setError(null)
    try {
      applyCommandSnapshot(await desktopApi.resumeCoordinationSession({
        coordinationId: detail.session.coordinationId,
        ...selection,
        expectedSessionVersion: detail.session.version,
      }), selection)
    } catch {
      setError('Multi-Agent Coordination resume was rejected safely.')
    } finally {
      setIsActing(false)
    }
  }

  async function startTask(taskId: string, expectedTaskVersion: number) {
    if (!desktopApi || !runId || !localProjectId || !detail || isActing) return
    const selection = { runId, localProjectId }
    setIsActing(true)
    setError(null)
    try {
      applyCommandSnapshot(await desktopApi.startCoordinationTask({
        coordinationId: detail.session.coordinationId,
        ...selection,
        expectedSessionVersion: detail.session.version,
        taskId,
        expectedTaskVersion,
      }), selection)
    } catch {
      setError('Specialist start was rejected safely.')
    } finally {
      setIsActing(false)
    }
  }

  async function cancelSession() {
    if (!desktopApi || !runId || !localProjectId || !detail || isActing) return
    if (!window.confirm('Cancel this bounded Multi-Agent Coordination session?')) return
    const selection = { runId, localProjectId }
    setIsActing(true)
    setError(null)
    try {
      applyCommandSnapshot(await desktopApi.cancelCoordinationSession({
        coordinationId: detail.session.coordinationId,
        ...selection,
        expectedSessionVersion: detail.session.version,
        confirmation: 'cancel-coordination',
      }), selection)
    } catch {
      setError('Multi-Agent Coordination cancellation was rejected safely.')
    } finally {
      setIsActing(false)
    }
  }

  const session = detail?.session

  return (
    <section className="agent-console-section" aria-label="Multi-Agent Coordination">
      <div className="section-heading section-heading--inline">
        <span>Multi-Agent Coordination</span>
        <strong>Bounded graph and execution tenancy</strong>
      </div>

      {!desktopApi || !runId || !localProjectId ? (
        <article className="agent-evidence-card">
          <p className="empty-note">
            Select a local project and Run to inspect Multi-Agent Coordination.
          </p>
        </article>
      ) : null}

      {isLoading && sessions.length === 0 ? (
        <p className="empty-note">Loading Multi-Agent Coordination…</p>
      ) : null}
      {error ? <p className="error-note" role="alert">{error}</p> : null}

      {!isLoading && !error && desktopApi && runId && localProjectId && sessions.length === 0 ? (
        <article className="agent-evidence-card">
          <p className="empty-note">
            No Multi-Agent Coordination has been recorded for this Run.
          </p>
          {nodeId && expectedRunVersion !== undefined ? (
            <button
              className="primary-button"
              type="button"
              aria-label="Start bounded coordination"
              disabled={isActing}
              onClick={() => void startPlan()}
            >
              Start bounded coordination
            </button>
          ) : null}
        </article>
      ) : null}

      {sessions.length > 0 && detail && session ? (
        <>
          <div className="agent-path-grid">
            <article className="agent-evidence-card">
              <div className="section-heading">
                <span>Coordination sessions</span>
                <strong>{sessions.length}</strong>
              </div>
              <div className="trace-list">
                {sessions.map((snapshot) => (
                  <button
                    className="ghost-button"
                    type="button"
                    aria-pressed={snapshot.session.coordinationId === session.coordinationId}
                    key={snapshot.session.coordinationId}
                    onClick={() => void selectSession(snapshot.session.coordinationId)}
                  >
                    <Network size={15} />
                    {snapshot.session.coordinationId} · {snapshot.session.status}
                  </button>
                ))}
              </div>
            </article>

            <article className="agent-evidence-card">
              <div className="section-heading">
                <span>Current coordination</span>
                <strong>{session.coordinationId}</strong>
              </div>
              <div className="agent-fact-grid agent-fact-grid--three">
                <div className="compact-row">
                  <span>Status</span>
                  <strong>{session.status}</strong>
                </div>
                <div className="compact-row">
                  <span>Graph</span>
                  <strong>
                    {plural(session.taskCount, 'task')} · {plural(session.edgeCount, 'dependency', 'dependencies')}
                  </strong>
                </div>
                <div className="compact-row">
                  <span>Ready</span>
                  <strong>{detail.readyTaskIds.length}</strong>
                </div>
                <div className="compact-row">
                  <span>Specialists</span>
                  <strong>
                    {session.counters.activeSpecialists} active · {session.counters.specialistStarts} started
                  </strong>
                </div>
                <div className="compact-row">
                  <span>Steps</span>
                  <strong>{session.counters.steps} / {session.bounds.maxSteps} steps</strong>
                </div>
                <div className="compact-row">
                  <span>Tool calls</span>
                  <strong>{session.counters.toolCalls} / {session.bounds.maxToolCalls}</strong>
                </div>
                <div className="compact-row">
                  <span>Tokens</span>
                  <strong>{session.counters.tokens} / {session.bounds.maxTokens} tokens</strong>
                </div>
                <div className="compact-row">
                  <span>Cost</span>
                  <strong>
                    ${session.counters.costUsd.toFixed(4)} / ${session.bounds.maxCostUsd.toFixed(2)}
                  </strong>
                </div>
                <div className="compact-row">
                  <span>Handoffs</span>
                  <strong>
                    {session.acceptedHandoffCount} / {session.bounds.maxAcceptedHandoffs}
                  </strong>
                </div>
                <div className="compact-row">
                  <span>Retries</span>
                  <strong>{session.counters.retries} / {session.bounds.maxSpecialistRetries}</strong>
                </div>
                <div className="compact-row">
                  <span>Session version</span>
                  <strong>v{session.version}</strong>
                </div>
                <div className="compact-row">
                  <span>Stop reason</span>
                  <strong>{session.stopReason ?? 'none'}</strong>
                </div>
              </div>
              {session.status === 'running' ? (
                <div className="agent-action-row">
                  <button
                    className="ghost-button"
                    type="button"
                    aria-label={`Resume ${session.coordinationId}`}
                    disabled={isActing || isLoading}
                    onClick={() => void resumeSession()}
                  >
                    Resume
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    aria-label={`Cancel ${session.coordinationId}`}
                    disabled={isActing || isLoading}
                    onClick={() => void cancelSession()}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </article>
          </div>

          <div className="section-heading section-heading--inline">
            <span>Specialist task graph</span>
            <strong>{plural(detail.tasks.length, 'task')}</strong>
          </div>
          <div className="agent-evidence-grid">
            {detail.tasks.map((task) => (
              <article className="agent-evidence-card" key={task.taskId}>
                <div className="section-heading">
                  <span>{task.status}</span>
                  <strong>{task.taskId} · {task.roleId}</strong>
                </div>
                {detail.readyTaskIds.includes(task.taskId) ? (
                  <>
                    <div className="agent-advisory">
                      <span>Dependency readiness</span>
                      <strong>Ready now</strong>
                    </div>
                    <button
                      className="primary-button"
                      type="button"
                      aria-label={`Start ${task.taskId}`}
                      disabled={isActing || isLoading || session.status !== 'running'}
                      onClick={() => void startTask(task.taskId, task.version)}
                    >
                      Start specialist
                    </button>
                  </>
                ) : null}
                <div className="knowledge-reference-meta">
                  <span>
                    {task.dependencyTaskIds.length === 0
                      ? 'no dependencies'
                      : `depends on ${task.dependencyTaskIds.join(', ')}`}
                  </span>
                  <span>{task.capabilityIds.join(', ')}</span>
                  <span>task v{task.version}</span>
                </div>
                <p className="empty-note">Context digest {task.contextDigest}</p>
                {task.resources.map((resource) => (
                  <p className="empty-note" key={`${task.taskId}-${resource.resourceId}-${resource.mode}`}>
                    Resource {resource.resourceId} · {resource.mode} · {resource.resourceDigest}
                  </p>
                ))}
                {task.failure ? (
                  <div className="agent-advisory agent-advisory--warn">
                    <span>Failure attribution</span>
                    <strong>{task.failure.category} · {task.failure.code}</strong>
                  </div>
                ) : null}
                {task.attemptFailures.map((failure, index) => (
                  <div className="agent-advisory agent-advisory--warn" key={`${task.taskId}-attempt-${index}`}>
                    <span>Recovered attempt</span>
                    <strong>{failure.category} · {failure.code}</strong>
                  </div>
                ))}
              </article>
            ))}
          </div>

          <div className="agent-path-grid">
            <article className="agent-evidence-card">
              <div className="section-heading">
                <span>Accepted handoffs</span>
                <strong>{detail.handoffs.length}</strong>
              </div>
              {detail.handoffs.length === 0 ? (
                <p className="empty-note">No accepted handoffs.</p>
              ) : (
                <div className="trace-list">
                  {detail.handoffs.map((handoff) => (
                    <div className="compact-row" key={handoff.handoffId}>
                      <GitBranch size={15} />
                      <span>{handoff.sourceTaskId} → {handoff.targetTaskId}</span>
                      <strong>{handoff.resourceLeaseOutcome}</strong>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="agent-evidence-card">
              <div className="section-heading">
                <span>Resource leases</span>
                <strong>{detail.leases.length}</strong>
              </div>
              {detail.leases.length === 0 ? (
                <p className="empty-note">No resource leases.</p>
              ) : (
                <div className="trace-list">
                  {detail.leases.map((lease) => (
                    <div className="compact-row" key={lease.leaseId}>
                      <ShieldCheck size={15} />
                      <span>{lease.resourceId} · {lease.mode} · {lease.status}</span>
                      <strong>{lease.taskId}</strong>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>

          {isLoading ? (
            <p className="empty-note"><Activity size={14} /> Loading exact coordination detail…</p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
