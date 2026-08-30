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
  isTeamPaired: boolean
}

function countLabel(count: number, label: string) {
  return `${count} 个${label}`
}

function coordinationStatusLabel(status: string) {
  return {
    requested: '已创建',
    running: '运行中',
    checkpointed: '已保存检查点',
    waiting_permission: '等待权限',
    terminal: '已结束',
    cancelled: '已取消',
    failed: '失败',
    succeeded: '已完成',
    ready: '可启动',
  }[status] ?? '未知状态'
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
  isTeamPaired,
}: AgentCoordinationPanelProps) {
  const [sessions, setSessions] = useState<CoordinationRendererSnapshot[]>([])
  const [detail, setDetail] = useState<CoordinationRendererSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isActing, setIsActing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!desktopApi || !runId || !localProjectId || !isTeamPaired) {
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
          setError('无法安全读取多 Agent 验收会话状态。')
        }
      })
      .finally(() => {
        if (!disposed) setIsLoading(false)
      })

    return () => {
      disposed = true
    }
  }, [desktopApi, isTeamPaired, localProjectId, runId])

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
      setError('无法安全读取所选多 Agent 会话详情。')
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
      !isTeamPaired ||
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
      setError('固定多 Agent 验收会话创建请求已被安全拒绝。')
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
      setError('多 Agent 会话恢复请求已被安全拒绝。')
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
      setError('Specialist（专用 Agent）启动请求已被安全拒绝。')
    } finally {
      setIsActing(false)
    }
  }

  async function cancelSession() {
    if (!desktopApi || !runId || !localProjectId || !detail || isActing) return
    if (!window.confirm('取消当前有界多 Agent 验收会话？')) return
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
      setError('多 Agent 会话取消请求已被安全拒绝。')
    } finally {
      setIsActing(false)
    }
  }

  const session = detail?.session

  return (
    <section className="agent-console-section" aria-label="固定多 Agent 验收会话">
      <div className="section-heading section-heading--inline">
        <span title="Multi-Agent Coordination：多个受限 Specialist 按固定依赖图协作。">固定多 Agent 验收会话</span>
        <strong>固定任务图、权限边界与资源租约</strong>
      </div>

      <article className="advanced-operation-boundary" id="coordination-boundary">
        <p>
          面向当前 Run / 节点创建固定 <code>bounded-repair-v1</code> 验收图，不会根据当前设计任务动态规划。
          首次创建只保存 Supervisor、任务图和检查点；之后需手动启动 Specialist（专用 Agent）。
        </p>
        <div className="advanced-boundary-grid">
          <span>用途</span><strong>验证固定有界任务图、交接与资源租约，不替代当前业务 Agent</strong>
          <span>结果</span><strong>首次保存 Supervisor、任务图和检查点；Specialist 需人工逐项启动</strong>
          <span>前置条件</span><strong>{isTeamPaired ? '当前 Local Project 已配对 Team' : '必须先将当前 Local Project 配对到 Team Project'}</strong>
          <span>Provider / 费用</span><strong>首次创建不调用当前 Stage Provider；后续 Specialist 可能在上限内消耗 token 和费用</strong>
          <span>仓库</span><strong>分析角色只读；后续 bounded-implementer 可能只在受管工作区写入</strong>
          <span>Workflow</span><strong>不生成当前设计 Artifact、不推进工作流、不审批 Gate</strong>
        </div>
      </article>

      {!desktopApi || !runId || !localProjectId ? (
        <article className="agent-evidence-card">
          <p className="empty-note">
            请先选择本地项目和 Run，再查看多 Agent 验收会话。
          </p>
        </article>
      ) : null}

      {isLoading && sessions.length === 0 ? (
        <p className="empty-note">正在读取多 Agent 验收会话…</p>
      ) : null}
      {error ? <p className="error-note" role="alert">{error}</p> : null}

      {!isLoading && !error && desktopApi && runId && localProjectId && sessions.length === 0 ? (
        <article className="agent-evidence-card">
          <p className="empty-note">
            当前 Run 尚未创建多 Agent 验收会话；这是可选高级功能。
          </p>
          {nodeId && expectedRunVersion !== undefined ? (
            <>
              {!isTeamPaired ? <p className="error-note" id="coordination-pairing-required">不可用：请先在页面顶部绑定当前 Local Project 与 Team Project。</p> : null}
              <button
                className="ghost-button"
                type="button"
                aria-describedby={isTeamPaired ? 'coordination-boundary' : 'coordination-pairing-required coordination-boundary'}
                disabled={isActing || !isTeamPaired}
                onClick={() => void startPlan()}
              >
                {isTeamPaired
                  ? '创建固定多 Agent 验收会话（高级）'
                  : '创建固定多 Agent 验收会话（需先配对 Team）'}
              </button>
            </>
          ) : null}
        </article>
      ) : null}

      {sessions.length > 0 && detail && session ? (
        <>
          <div className="agent-path-grid">
            <article className="agent-evidence-card">
              <div className="section-heading">
                <span>多 Agent 会话记录</span>
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
                    {snapshot.session.coordinationId} · {coordinationStatusLabel(snapshot.session.status)}
                  </button>
                ))}
              </div>
            </article>

            <article className="agent-evidence-card">
              <div className="section-heading">
                <span>当前会话</span>
                <strong>{session.coordinationId}</strong>
              </div>
              <div className="agent-fact-grid agent-fact-grid--three">
                <div className="compact-row">
                  <span>状态</span>
                  <strong>{coordinationStatusLabel(session.status)}</strong>
                </div>
                <div className="compact-row">
                  <span>任务图</span>
                  <strong>
                    {countLabel(session.taskCount, '任务')} · {countLabel(session.edgeCount, '依赖')}
                  </strong>
                </div>
                <div className="compact-row">
                  <span>可启动任务</span>
                  <strong>{detail.readyTaskIds.length}</strong>
                </div>
                <div className="compact-row">
                  <span>Specialist</span>
                  <strong>
                    {session.counters.activeSpecialists} 个运行中 · 累计启动 {session.counters.specialistStarts} 次
                  </strong>
                </div>
                <div className="compact-row">
                  <span>步骤</span>
                  <strong>{session.counters.steps} / {session.bounds.maxSteps}</strong>
                </div>
                <div className="compact-row">
                  <span>工具调用</span>
                  <strong>{session.counters.toolCalls} / {session.bounds.maxToolCalls}</strong>
                </div>
                <div className="compact-row">
                  <span>Token 用量</span>
                  <strong>{session.counters.tokens} / {session.bounds.maxTokens}</strong>
                </div>
                <div className="compact-row">
                  <span>费用</span>
                  <strong>
                    ${session.counters.costUsd.toFixed(4)} / ${session.bounds.maxCostUsd.toFixed(2)}
                  </strong>
                </div>
                <div className="compact-row">
                  <span>交接</span>
                  <strong>
                    {session.acceptedHandoffCount} / {session.bounds.maxAcceptedHandoffs}
                  </strong>
                </div>
                <div className="compact-row">
                  <span>重试</span>
                  <strong>{session.counters.retries} / {session.bounds.maxSpecialistRetries}</strong>
                </div>
                <div className="compact-row">
                  <span>会话版本</span>
                  <strong>v{session.version}</strong>
                </div>
                <div className="compact-row">
                  <span>结束原因</span>
                  <strong>{session.stopReason ?? '尚未结束'}</strong>
                </div>
              </div>
              {session.status === 'running' ? (
                <div className="agent-action-row">
                  <button
                    className="ghost-button"
                    type="button"
                    aria-label={`恢复多 Agent 会话 ${session.coordinationId}`}
                    disabled={isActing || isLoading}
                    onClick={() => void resumeSession()}
                  >
                    恢复会话
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    aria-label={`取消多 Agent 会话 ${session.coordinationId}`}
                    disabled={isActing || isLoading}
                    onClick={() => void cancelSession()}
                  >
                    取消会话
                  </button>
                </div>
              ) : null}
            </article>
          </div>

          <div className="section-heading section-heading--inline">
            <span>Specialist 任务图</span>
            <strong>{countLabel(detail.tasks.length, '任务')}</strong>
          </div>
          <div className="agent-evidence-grid">
            {detail.tasks.map((task) => (
              <article className="agent-evidence-card" key={task.taskId}>
                <div className="section-heading">
                  <span>{coordinationStatusLabel(task.status)}</span>
                  <strong>{task.taskId} · {task.roleId}</strong>
                </div>
                {detail.readyTaskIds.includes(task.taskId) ? (
                  <>
                    <div className="agent-advisory">
                      <span>依赖状态</span>
                      <strong>现在可启动</strong>
                    </div>
                    <button
                      className="ghost-button"
                      type="button"
                      aria-label={`启动 Specialist 任务 ${task.taskId}`}
                      disabled={isActing || isLoading || session.status !== 'running'}
                      onClick={() => void startTask(task.taskId, task.version)}
                    >
                      启动 Specialist
                    </button>
                  </>
                ) : null}
                <div className="knowledge-reference-meta">
                  <span>
                    {task.dependencyTaskIds.length === 0
                      ? '无依赖'
                      : `依赖 ${task.dependencyTaskIds.join(', ')}`}
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
                  <span>已接受交接</span>
                <strong>{detail.handoffs.length}</strong>
              </div>
              {detail.handoffs.length === 0 ? (
                <p className="empty-note">暂无已接受交接。</p>
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
                  <span>资源租约</span>
                <strong>{detail.leases.length}</strong>
              </div>
              {detail.leases.length === 0 ? (
                <p className="empty-note">暂无资源租约。</p>
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
            <p className="empty-note"><Activity size={14} /> 正在读取精确会话详情…</p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
