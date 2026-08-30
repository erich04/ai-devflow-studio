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
  nodeId: string | undefined
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

function runtimeStatusLabel(status: string) {
  return {
    requested: '已创建',
    checkpointed: '已保存检查点',
    running: '运行中',
    waiting_permission: '等待权限',
    terminal: '已结束',
  }[status] ?? '未知状态'
}

export function AgentRuntimePanel({
  desktopApi,
  runId,
  nodeId,
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
          setError('独立 Runtime 更新未通过安全校验，已保留上一次可信状态。')
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
          setError('无法安全读取独立 Runtime 状态。')
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
    ? '从检查点恢复 Runtime'
    : '继续 Runtime 验证'
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
      setError('无法安全读取所选 Runtime 详情。')
    } finally {
      setIsLoading(false)
    }
  }

  async function startRuntime() {
    if (!desktopApi || !state || !runId || !nodeId || !localProjectId || isActing) return
    setIsActing(true)
    setError(null)
    try {
      const snapshot = await desktopApi.startAgentRuntime({ runId, nodeId, localProjectId })
      setState((current) => current ? mergeSnapshot(current, snapshot) : current)
    } catch {
      setError('独立 Runtime 创建请求已被安全拒绝或当前 Run 已变化，请重新加载后再试。')
    } finally {
      setIsActing(false)
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
      setError('Runtime 操作已被安全拒绝或状态已变化，请重新加载当前 Runtime。')
    } finally {
      setIsActing(false)
    }
  }

  return (
    <section className="agent-console-section" aria-label="独立 Runtime 验收与诊断">
      <div className="section-heading section-heading--inline">
        <span title="Runtime：独立于当前 Workflow 的有界执行状态机。">独立 Runtime 验收与诊断</span>
        <strong>有界执行、检查点恢复与审计</strong>
      </div>

      <article className="advanced-operation-boundary" id="standalone-runtime-boundary">
        <p>
          面向当前 Run / 节点创建独立验证实例，固定执行无业务副作用的内部场景 <code>scenario.evaluate</code>，
          结果是检查点、执行轨迹、评估和可选 Memory 候选。
        </p>
        <div className="advanced-boundary-grid">
          <span>用途</span><strong>为当前 Run / 节点验证 Runtime 状态机，不执行当前业务任务</strong>
          <span>结果</span><strong>保存检查点、执行轨迹、评估与可选 Memory 候选</strong>
          <span>前置条件</span><strong>已选择 Local Project（本地项目）和 Run；无需 Team 配对</strong>
          <span>Provider / 费用</span><strong>不调用当前 Stage Provider，不产生模型 token 费用</strong>
          <span>仓库</span><strong>不读取或修改仓库文件</strong>
          <span>Workflow</span><strong>不生成阶段 Artifact、不推进工作流、不审批 Gate</strong>
        </div>
      </article>

      {!desktopApi || !runId || !localProjectId ? (
        <article className="agent-evidence-card">
          <p className="empty-note">请先选择本地项目和 Run，再查看独立 Runtime 状态。</p>
        </article>
      ) : null}

      {isLoading && !state ? <p className="empty-note">正在读取独立 Runtime 状态…</p> : null}
      {error ? <p className="error-note" role="alert">{error}</p> : null}

      {state && state.items.length === 0 ? (
        <article className="agent-evidence-card">
          <p className="empty-note">当前 Run 尚未创建独立 Runtime；这不是完成当前 Workflow 的必需步骤。</p>
          <div className="inspector-actions">
            <button
              className="ghost-button"
              type="button"
              aria-describedby="standalone-runtime-boundary"
              disabled={!nodeId || isActing}
              onClick={() => void startRuntime()}
            >
              <Activity size={15} />
              创建独立 Runtime 验证实例（高级）
            </button>
          </div>
        </article>
      ) : null}

      {state && state.items.length > 0 ? (
        <div className="agent-path-grid">
          <article className="agent-evidence-card">
            <div className="section-heading">
              <span>Runtime 记录</span>
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
                  {item.runtime.runtimeId} · {runtimeStatusLabel(item.runtime.status)}
                </button>
              ))}
            </div>
          </article>

          <article className="agent-evidence-card">
            <div className="section-heading">
              <span>当前状态</span>
              <strong>{detail?.runtime.status
                ? runtimeStatusLabel(detail.runtime.status)
                : selectedItem?.runtime.status
                  ? runtimeStatusLabel(selectedItem.runtime.status)
                  : '读取中'}</strong>
            </div>
            {detail ? (
              <>
                <div className="agent-fact-grid agent-fact-grid--three">
                  <div className="compact-row">
                    <span>步骤</span>
                    <strong>{detail.runtime.counters.steps} / {detail.runtime.bounds.maxSteps}</strong>
                  </div>
                  <div className="compact-row">
                    <span>工具调用</span>
                    <strong>{detail.runtime.counters.toolCalls} / {detail.runtime.bounds.maxToolCalls}</strong>
                  </div>
                  <div className="compact-row">
                    <span title="Token：模型用量计数；此固定场景不会调用当前 Provider。">Token 用量</span>
                    <strong>{detail.runtime.counters.tokens} / {detail.runtime.bounds.maxTokens}</strong>
                  </div>
                  <div className="compact-row">
                    <span>费用</span>
                    <strong>${detail.runtime.counters.costUsd.toFixed(4)} / ${detail.runtime.bounds.maxCostUsd.toFixed(2)}</strong>
                  </div>
                  <div className="compact-row">
                    <span title="Checkpoint：可恢复的执行检查点。">检查点</span>
                    <strong>v{detail.runtime.checkpointVersion}</strong>
                  </div>
                  <div className="compact-row">
                    <span>已接受操作</span>
                    <strong>{detail.runtime.acceptedActionCount}</strong>
                  </div>
                  <div className="compact-row">
                    <span title="Trajectory：Runtime 的可审计执行轨迹。">执行轨迹</span>
                    <strong>{runtimeEvents.length} 条事件</strong>
                  </div>
                  <div className="compact-row">
                    <span>结束原因</span>
                    <strong>{detail.runtime.stopReason ?? '尚未结束'}</strong>
                  </div>
                </div>

                {activeAction ? (
                  <div className="agent-advisory">
                    <span>当前能力</span>
                    <strong>{activeAction.kind} · {activeAction.capabilityId} v{activeAction.capabilityVersion}</strong>
                    <p>请求摘要 {activeAction.requestDigest}</p>
                  </div>
                ) : null}

                {detail.runtime.status === 'waiting_permission' || activeAction?.requiresPermission ? (
                  <div className="agent-advisory agent-advisory--warn">
                    <span>权限</span>
                    <strong>等待已有权限授权方处理</strong>
                    <p>此视图不能签发能力，也不能注入工具结果。</p>
                  </div>
                ) : null}

                <div className="inspector-actions">
                  <button
                    className="ghost-button"
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
                    取消 Runtime
                  </button>
                </div>
              </>
            ) : <p className="empty-note">正在读取所选 Runtime 详情…</p>}
          </article>
        </div>
      ) : null}

      {detail ? (
        <div className="agent-path-grid">
          <article className="agent-evidence-card">
            <div className="section-heading">
              <span>执行轨迹</span>
              <strong>{runtimeEvents.length}</strong>
            </div>
            <div className="trace-list">
              {runtimeEvents.map((event) => (
                <div className="trace-step" key={`${event.runtimeId}-${event.sequence}`}>
                  <span>#{event.sequence} · 检查点 {event.checkpointVersion}</span>
                  <strong>{event.type}</strong>
                  <p>{event.createdAt}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="agent-evidence-card">
            <div className="section-heading">
              <span>Runtime 证据</span>
              <strong><CheckCircle2 size={15} /> 已脱敏</strong>
            </div>
            <div className="compact-row">
              <span>上下文摘要</span>
              <code>{detail.runtime.contextDigest}</code>
            </div>
            <div className="compact-row">
              <span>能力集合摘要</span>
              <code>{detail.runtime.capabilitySetDigest}</code>
            </div>
            <div className="compact-row">
              <span>最近观察摘要</span>
              <code>{detail.runtime.lastObservationDigest}</code>
            </div>
            <div className="compact-row">
              <span>最近结果摘要</span>
              <code>{detail.runtime.lastResultDigest ?? '暂无'}</code>
            </div>
            {detail.latestEvaluation ? (
              <div className="agent-advisory">
                <span>最近评估</span>
                <strong>{detail.latestEvaluation.evaluation}</strong>
                <p>{detail.latestEvaluation.summary}</p>
              </div>
            ) : null}
            <p className="empty-note">
              源内容、本地路径、工具原始输出、作用域会话和完整检查点仅保留在 Electron Main。
            </p>
          </article>

          <article className="agent-evidence-card">
            <div className="section-heading">
              <span>Runtime 上下文</span>
              <strong><CheckCircle2 size={15} /> 已脱敏来源</strong>
            </div>
            {detail.context ? (
              <>
                <div className="compact-row">
                  <span title="Knowledge：当前项目已索引的知识来源。">Knowledge（知识）</span>
                  <strong>
                    {detail.context.knowledgeCitationCount} 条知识引用
                  </strong>
                </div>
                <div className="compact-row">
                  <span>持久 Memory</span>
                  <strong>
                    {detail.context.memoryRevisionCount} 个持久记忆版本
                  </strong>
                </div>
                <div className="compact-row">
                  <span>附件 ID</span>
                  <code>{detail.context.attachmentId}</code>
                </div>
                <div className="compact-row">
                  <span>Knowledge 身份摘要</span>
                  <code>{detail.context.knowledgeIdentityDigest}</code>
                </div>
                <div className="compact-row">
                  <span>Memory 身份摘要</span>
                  <code>{detail.context.memoryIdentityDigest}</code>
                </div>
                <p className="empty-note">
                  引用和 Memory 正文仅在 Electron Main 中可用。
                </p>
              </>
            ) : (
              <p className="empty-note">
                这条历史 Runtime 早于持久上下文附件元数据，无法补造来源信息。
              </p>
            )}
          </article>
        </div>
      ) : null}
    </section>
  )
}
