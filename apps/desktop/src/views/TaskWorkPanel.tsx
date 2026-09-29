import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, RotateCcw, Trash2 } from 'lucide-react'
import {
  formatUsd,
  type AgentReviewResult,
  type CodingAgentRun,
  type CodingPermissionDecision,
  type ManagedCodingWorkspace,
} from '@ai-devflow/shared'
import type { CodingRuntimeActionProjection } from '../app/coding-runtime-action-projection'
import type { CodingReadinessDisplay } from '../app/coding-runtime-readiness-view-model'
import { formatLocalTime } from '../app/desktop-view-model'
import type { TestRunReadiness } from '../app/test-run-readiness'
import { CodingChangeSetReview } from './CodingChangeSetReview'
import { ReviewRerunDialog } from './ReviewRerunDialog'

/*
 * In-task execution (plan §7.2 W2–W4). These panels call the existing write paths through the
 * callbacks they receive; they add no new IPC and never navigate away from the task.
 */

const codingPhaseCopy: Partial<Record<CodingRuntimeActionProjection['phase'], string>> = {
  starting: '正在启动',
  queued: '排队中',
  preparing: '正在准备工作区',
  bootstrapping: '正在安装依赖',
  running: '正在编码',
  waiting_permission: '等待权限',
  applying: '正在应用改动',
  testing: '正在运行检查',
  completed: '已完成',
  failed: '失败',
  timed_out: '超时',
  interrupted: '已中断',
  cancelled: '已取消',
}

export function formatCodingRunCost(summary: CodingAgentRun['runtimeCostSummary'] | undefined): string {
  if (summary?.phase === 'preflight_estimate') return `预估 ${formatUsd(summary.costUsd)} · 实际金额待确认`
  if (
    !summary ||
    !summary.usageStatus ||
    summary.usageStatus === 'legacy_unknown' ||
    !summary.costStatus ||
    summary.costStatus === 'legacy_unverified' ||
    typeof summary.costUsd !== 'number'
  ) {
    return '未知'
  }
  return formatUsd(summary.costUsd)
}

/** Gate Review in the task: failure reason with retry, and a confirmed re-run (plan W2). */
export function GateReviewRunPanel({
  latestReview,
  failure,
  isRunning,
  providerLabel,
  blockedReason,
  isWriteLocked,
  target,
  onRun,
}: {
  latestReview: AgentReviewResult | undefined
  failure: string | undefined
  isRunning: boolean
  providerLabel: string | undefined
  blockedReason: string | undefined
  isWriteLocked: boolean
  target: string
  onRun: (previousReviewId?: string) => void
}) {
  const [confirmingReviewId, setConfirmingReviewId] = useState<string | null>(null)
  useEffect(() => setConfirmingReviewId(null), [latestReview?.id, providerLabel])
  if (!isRunning && !failure && !latestReview) return null
  const disabled = isRunning || isWriteLocked || Boolean(blockedReason)
  // A retry after an earlier review is a re-run: it keeps the old result and needs confirmation.
  const start = () => (latestReview ? setConfirmingReviewId(latestReview.id) : onRun())
  return (
    <section className="task-work-panel task-review-run" aria-label="门禁审查" data-testid="task-review-run">
      <span className="panel-label">门禁审查</span>
      {isRunning ? (
        <p role="status">正在运行门禁审查{providerLabel ? `（${providerLabel}）` : ''}；需要中止时可以在状态行停止。</p>
      ) : failure ? (
        <div className="conversation-error" role="alert">
          <p>上次门禁审查未完成：{failure.split(' {')[0]}</p>
          <details><summary>诊断详情</summary><code>{failure}</code></details>
        </div>
      ) : latestReview ? (
        <p>上次审查：{formatLocalTime(latestReview.createdAt)} · {latestReview.model}。内容变化后可以重新审查，旧结果保留在历史中。</p>
      ) : null}
      {!isRunning ? (
        <div className="inspector-actions">
          <button className="ghost-button" type="button" disabled={disabled} title={blockedReason} onClick={start}>
            <RotateCcw size={16} />
            {failure ? '重试门禁审查' : '重新审查'}
          </button>
          <span className="meta">{blockedReason ?? (providerLabel ? `将使用 ${providerLabel}，可能产生费用。` : '')}</span>
        </div>
      ) : null}
      {confirmingReviewId && latestReview?.id === confirmingReviewId ? (
        <ReviewRerunDialog
          target={target}
          provider={providerLabel ?? '未选择模型'}
          reviewedAt={latestReview.createdAt}
          onCancel={() => setConfirmingReviewId(null)}
          onConfirm={() => {
            setConfirmingReviewId(null)
            onRun(confirmingReviewId)
          }}
        />
      ) : null}
    </section>
  )
}

/** Coding in the task: exact diff review, other permission requests, progress and blockers (W3). */
export function CodingWorkPanel({
  projection,
  readinessDisplay,
  readinessError,
  latestCodingRun,
  workspace,
  isReplying,
  onDecision,
  focusRef,
}: {
  projection: CodingRuntimeActionProjection | undefined
  readinessDisplay: CodingReadinessDisplay | null
  readinessError: string
  latestCodingRun: CodingAgentRun | undefined
  workspace: ManagedCodingWorkspace | undefined
  isReplying: boolean
  onDecision: (decision: CodingPermissionDecision['decision']) => void
  focusRef: RefObject<HTMLDivElement | null>
}) {
  if (!projection) return null
  const permission = projection.action.id === 'review-permission' ? projection.permission : undefined
  const phase = codingPhaseCopy[projection.phase]
  if (permission && (permission.kind === 'change-set' || permission.kind === 'change-acceptance') && latestCodingRun) {
    return (
      <div className="task-work-panel task-coding-review" ref={focusRef} tabIndex={-1} data-testid="task-coding-change-set">
        <CodingChangeSetReview
          permission={permission}
          run={latestCodingRun}
          workspace={workspace}
          isReplying={isReplying}
          onDecision={onDecision}
        />
      </div>
    )
  }
  if (permission) {
    return (
      <div className="task-work-panel coding-permission-summary" ref={focusRef} tabIndex={-1} data-testid="workbench-coding-permission-summary">
        <span className="panel-label">权限请求 · 批准与拒绝在状态行</span>
        <strong>{permission.request.title}</strong>
        <p>{permission.request.reasons.join(' ')}</p>
        <div className="knowledge-reference-meta">
          <span>{permission.request.permission}</span>
          <span>风险 {permission.request.risk}</span>
          {permission.request.filePath ? <code>{permission.request.filePath}</code> : null}
          <span>{permission.changedPaths.length} 个文件</span>
          {permission.changeSetDigest ? <code>{permission.changeSetDigest}</code> : null}
          <span>{permission.expired ? '已过期' : `剩余 ${Math.ceil(permission.remainingMs / 1_000)} 秒`}</span>
        </div>
        {permission.staleReason ? <p role="alert">{permission.staleReason}</p> : null}
      </div>
    )
  }
  if (projection.action.id === 'configure') {
    const blocked = readinessDisplay?.items.filter((item) => item.state === 'blocked') ?? []
    return (
      <div className="task-work-panel coding-readiness-summary" data-testid="workbench-coding-readiness">
        <strong>开发前需要处理</strong>
        {blocked.length ? (
          <ul>{blocked.map((item) => <li key={item.label}><strong>{item.label}</strong>：{item.detail}{item.remediation ? ` ${item.remediation}` : ''}</li>)}</ul>
        ) : (
          <p>{readinessError || projection.action.disabledReason || projection.action.summary}</p>
        )}
        <p className="meta">处理完成前不会创建工作树或修改代码。设置保存后可以回到这里继续。</p>
      </div>
    )
  }
  if (projection.activeRun || projection.phase === 'starting') {
    return (
      <div className="task-work-panel workbench-coding-progress" data-testid="workbench-coding-progress" ref={focusRef} tabIndex={-1}>
        <strong>开发执行：{phase ?? '进行中'}</strong>
        <p>{projection.action.summary}</p>
        {latestCodingRun ? <p className="meta">变更文件 {latestCodingRun.changedPaths.length} · 分支 {latestCodingRun.branchName}</p> : null}
      </div>
    )
  }
  if (projection.terminal) {
    return (
      <section className="task-work-panel workbench-coding-terminal" data-testid="workbench-coding-terminal">
        <strong>开发执行：{phase ?? projection.phase}</strong>
        <p>{projection.terminal.reason}</p>
        <p>变更文件 {projection.terminal.changedPaths.length} · 测试 {projection.terminal.testStatus ?? '尚未记录'}</p>
      </section>
    )
  }
  return null
}

/** The existing retry confirmation, now in the task: new Run, cost and extra attempt (W3). */
export function CodingRetryDialog({
  additionalAttemptAfterCount,
  providerName,
  lastRun,
  runtimeBudgetApprovalId,
  disabled,
  onConfirm,
  onCancel,
}: {
  additionalAttemptAfterCount: number | undefined
  providerName: string | undefined
  lastRun: CodingAgentRun | undefined
  runtimeBudgetApprovalId: string
  disabled: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previousFocus = document.activeElement
    cancelRef.current?.focus()
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])
  const summary = lastRun?.runtimeCostSummary
  const lastTokens = summary?.totalTokens ?? (summary ? summary.inputTokens + summary.outputTokens : undefined)
  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal coding-retry-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="coding-retry-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      >
        <span className="panel-label">明确重试</span>
        <h2 id="coding-retry-title">{additionalAttemptAfterCount === undefined ? '新建 Coding Run 重试？' : '授权追加一次尝试？'}</h2>
        <p>这不会恢复或复用上一次 Run。它会创建新的 Run ID，并可能再次调用 Provider、消耗 token 和产生费用。</p>
        {additionalAttemptAfterCount === undefined ? null : (
          <p>本需求的开发节点已尝试 {additionalAttemptAfterCount} 次。这次授权只允许第 {additionalAttemptAfterCount + 1} 次，保留全部失败记录；命令审批、预算和执行时限继续适用。</p>
        )}
        <dl className="change-set-review__facts">
          <div><dt>Provider</dt><dd>{providerName ?? '未配置'}</dd></div>
          <div><dt>上次 Token</dt><dd>{lastTokens ?? '未知'}</dd></div>
          <div><dt>上次费用</dt><dd>{formatCodingRunCost(summary)}</dd></div>
          <div><dt>新 Run 计费</dt><dd>新的 token 与费用单独结算</dd></div>
          <div className="change-set-review__fact-wide"><dt>预算批准</dt><dd>{runtimeBudgetApprovalId ? <code>{runtimeBudgetApprovalId}</code> : '未使用一次性预算批准'}</dd></div>
        </dl>
        <div className="modal-actions">
          <button ref={cancelRef} className="ghost-button" type="button" onClick={onCancel}>取消</button>
          <button className="primary-button" type="button" disabled={disabled} onClick={onConfirm}>
            {additionalAttemptAfterCount === undefined ? '新建 Run 并重试' : '授权追加一次尝试'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}

/** Test step in the task: what will run, or why it cannot run yet (W4). */
export function TestRunPanel({
  readiness,
  isRunning,
  onOpenTestSettings,
}: {
  readiness: TestRunReadiness
  isRunning: boolean
  onOpenTestSettings: (() => void) | undefined
}) {
  return (
    <section className="task-work-panel task-test-run" aria-label="运行检查" data-testid="task-test-run">
      {isRunning ? (
        <p role="status">正在运行 <code>{readiness.savedCommand}</code>；完成后结果显示在下方。</p>
      ) : readiness.needsCommand ? (
        <div className="inspector-actions">
          <p>当前项目还没有保存测试命令，保存后才能运行检查。</p>
          {onOpenTestSettings ? <button className="ghost-button" type="button" onClick={onOpenTestSettings}>设置测试命令</button> : null}
        </div>
      ) : readiness.blockedReason ? (
        <p className="meta" data-testid="task-test-run-blocked">{readiness.blockedReason}</p>
      ) : (
        <p className="meta">将在本机运行 <code>{readiness.savedCommand}</code>，不调用模型；结果保存为测试证据。</p>
      )}
    </section>
  )
}

/** Managed worktree in 执行记录: open, or delete after an explicit confirmation (W3). */
export function CodingWorkspaceRecords({
  workspace,
  canOpen,
  onOpen,
  onDelete,
}: {
  workspace: ManagedCodingWorkspace | undefined
  canOpen: boolean
  onOpen: (() => void) | undefined
  onDelete: (() => void) | undefined
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  useEffect(() => setConfirmingDelete(false), [workspace?.id])
  if (!workspace) {
    return <section className="task-work-panel" data-testid="coding-workspace-records"><span className="panel-label">受管工作树</span><p className="empty-note">当前步骤没有受管工作树。</p></section>
  }
  const deleted = Boolean(workspace.deletedAt) || workspace.cleanupStatus === 'deleted'
  return (
    <section className="task-work-panel" aria-label="受管工作树" data-testid="coding-workspace-records">
      <span className="panel-label">受管工作树</span>
      <p><code>{workspace.worktreePath}</code></p>
      <p className="meta">
        {deleted ? '工作树已删除；执行记录与代码差异仍保留。' : workspace.cleanupStatus === 'cleanup_failed' ? `清理失败：${workspace.cleanupError ?? '需要手动清理。'}` : '工作树仍保留，可用于核对改动。'}
      </p>
      {confirmingDelete ? (
        <div className="inspector-actions" role="alert">
          <p>删除后这个工作树中的文件会从本机移除，执行记录与代码差异保留。确认删除？</p>
          <button className="ghost-button" type="button" onClick={() => { setConfirmingDelete(false); onDelete?.() }}>确认删除</button>
          <button className="text-button" type="button" onClick={() => setConfirmingDelete(false)}>取消</button>
        </div>
      ) : (
        <div className="inspector-actions">
          {canOpen && onOpen ? <button className="ghost-button" type="button" onClick={onOpen}><FolderOpen size={16} />打开受管工作树</button> : null}
          {onDelete ? <button className="ghost-button" type="button" disabled={deleted} onClick={() => setConfirmingDelete(true)}><Trash2 size={16} />删除受管工作树</button> : null}
        </div>
      )}
    </section>
  )
}
