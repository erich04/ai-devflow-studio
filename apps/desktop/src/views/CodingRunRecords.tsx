import { useEffect, useState } from 'react'
import {
  formatUsd,
  type AgentProviderConfig,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingPermissionRequest,
  type DependencyBootstrapEvidence,
  type TestEvidence,
} from '@ai-devflow/shared'
import { codingRuntimeLabel, codingTerminalLabel } from '../app/desktop-view-model'
import type { AgentEvidenceGroup } from '../app/agent-evidence-view-model'
import type { CodingRuntimeActionProjection } from '../app/coding-runtime-action-projection'

/**
 * Coding Run evidence in the build step's 执行记录 (plan Y3): costs and per-call settlements,
 * the budget decision, and the permissions and trace of every coding run of this task. The diff
 * and changed paths stay in 当前工作; nothing here runs, approves or retries anything.
 */
export function CodingRunRecords({
  latestCodingRun,
  codingRuns,
  codingEvents,
  permissionRequests,
  providers,
  bootstrapEvidence,
  testEvidence,
  codingActionProjection,
  runtimeBudgetApprovalId,
  onOpenModelSettings,
}: {
  latestCodingRun: CodingAgentRun
  /** Coding runs of this task, newest first. */
  codingRuns: CodingAgentRun[]
  /** All coding events and permission requests; filtered by the audited run. */
  codingEvents: CodingAgentEvent[]
  permissionRequests: CodingPermissionRequest[]
  providers: AgentProviderConfig[]
  bootstrapEvidence: DependencyBootstrapEvidence | undefined
  testEvidence: TestEvidence | undefined
  codingActionProjection?: CodingRuntimeActionProjection | undefined
  runtimeBudgetApprovalId: string
  onOpenModelSettings: () => void
}) {
  const [auditRunId, setAuditRunId] = useState(latestCodingRun.id)
  useEffect(() => setAuditRunId(latestCodingRun.id), [latestCodingRun.id])
  const providerName = (providerId: string) => providers.find((provider) => provider.id === providerId)?.name ?? '旧版 Provider'
  const auditRun = codingRuns.find((run) => run.id === auditRunId) ?? latestCodingRun
  const auditEvents = codingEvents
    .filter((event) => event.codingRunId === auditRun.id)
    .sort((left, right) => left.sequence - right.sequence)
  const auditPermissions = permissionRequests
    .filter((request) => request.codingRunId === auditRun.id)
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
  const terminal = codingActionProjection?.terminal
  const budgetDecision = latestCodingRun.budgetDecision

  return (
    <section className="agent-evidence-card coding-run-records" data-testid="coding-run-records" aria-label="开发执行证据">
      <div className="section-heading">
        <span>开发执行证据</span>
        <strong>{latestCodingRun.branchName}</strong>
      </div>
      <div className="agent-fact-grid agent-fact-grid--three">
        <div className="compact-row"><span>运行时</span><strong>{codingRuntimeLabel(latestCodingRun.engine)}</strong></div>
        <div className="compact-row"><span>终态</span><strong>{codingTerminalLabel(latestCodingRun.status)}</strong></div>
        <div className="compact-row"><span>模型提供方</span><strong>{providerName(latestCodingRun.providerId)}</strong></div>
        <div className="compact-row"><span>变更路径数</span><strong>{latestCodingRun.changedPaths.length}</strong></div>
        <div className="compact-row"><span>依赖准备</span><strong>{bootstrapEvidence?.status ?? '尚未记录'}</strong></div>
        <div className="compact-row"><span>测试证据</span><strong>{testEvidence?.status ?? '尚未记录'}</strong></div>
        {latestCodingRun.contextReceipt ? (
          <>
            <div className="compact-row"><span>本轮选用记忆</span><strong>{latestCodingRun.contextReceipt.memories.length} 条</strong></div>
            <div className="compact-row"><span>上下文压缩</span><strong>{latestCodingRun.contextReceipt.compaction.compacted ? '已压缩历史材料' : '无需压缩'}</strong></div>
            <div className="compact-row"><span>上下文大小</span><strong>{latestCodingRun.contextReceipt.compaction.inputBytes.toLocaleString()} → {latestCodingRun.contextReceipt.compaction.outputBytes.toLocaleString()} 字节</strong></div>
          </>
        ) : null}
      </div>
      {testEvidence ? <p className="empty-note">{testEvidence.summary}</p> : null}

      {terminal ? (
        <div className="coding-terminal-summary" data-testid="coding-terminal-summary">
          <h4>费用与结算</h4>
          <div className="agent-fact-grid agent-fact-grid--three">
            <div className="compact-row"><span>模型提供方</span><strong>{terminal.providerId}</strong></div>
            <div className="compact-row"><span>输入 / 输出 tokens</span><strong>{terminal.inputTokens ?? '未知'} / {terminal.outputTokens ?? '未知'}</strong></div>
            <div className="compact-row"><span>缓存命中 / 未命中</span><strong>{terminal.cacheReadTokens ?? '未知'} / {terminal.cacheMissTokens ?? '未知'}</strong></div>
            <div className="compact-row"><span>缓存命中率</span><strong>{typeof terminal.cacheHitRate === 'number' ? `${(terminal.cacheHitRate * 100).toFixed(1)}%` : '未知'}</strong></div>
            <div className="compact-row"><span>总 tokens</span><strong>{terminal.totalTokens ?? '未知'}</strong></div>
            <div className="compact-row"><span>费用阶段</span><strong>{runtimeCostPhaseLabel(terminal.costPhase)}</strong></div>
            <div className="compact-row"><span>{terminal.costStatus === 'settled' ? '结算费用' : terminal.costPhase === 'preflight_estimate' ? '预估费用' : '费用'}</span><strong>{typeof terminal.costUsd === 'number' ? formatRuntimeUsd(terminal.costUsd) : '未知'}</strong></div>
            <div className="compact-row"><span>费用状态</span><strong>{terminal.costStatus ?? 'legacy_unverified'}</strong></div>
            <div className="compact-row"><span>计价档位</span><strong>{terminal.pricingTier ?? '未知'}</strong></div>
            <div className="compact-row"><span>测试</span><strong>{terminal.testStatus ?? '未归档'}</strong></div>
            <div className="compact-row"><span>工作区</span><strong>{terminal.workspaceCleanupStatus}</strong></div>
          </div>
          {terminal.costBreakdown ? (
            <p>
              <strong>费用拆分：</strong>
              缓存命中 {formatRuntimeUsd(terminal.costBreakdown.cacheHitInputUsd)} · 未命中 {formatRuntimeUsd(terminal.costBreakdown.cacheMissInputUsd)} · 输出 {formatRuntimeUsd(terminal.costBreakdown.outputUsd)} · 合计 {formatRuntimeUsd(terminal.costBreakdown.totalUsd)}
            </p>
          ) : (
            <p><strong>费用拆分：</strong>用量或价格不完整，无法拆分。</p>
          )}
          {terminal.pricingSnapshot ? (
            <p>
              <strong>单价：</strong>
              缓存命中 {formatRuntimeUsd(terminal.pricingSnapshot.cacheHitInputUsdPerMillion)} / 1M · 未命中 {formatRuntimeUsd(terminal.pricingSnapshot.cacheMissInputUsdPerMillion)} / 1M · 输出 {formatRuntimeUsd(terminal.pricingSnapshot.outputUsdPerMillion)} / 1M
            </p>
          ) : (
            <p><strong>单价：</strong>见下方逐次结算；旧记录没有单价。</p>
          )}
          {terminal.providerCallSettlements?.length ? (
            <div className="trace-list" data-testid="coding-provider-call-settlements">
              {terminal.providerCallSettlements.map((settlement) => (
                <div className="trace-step" key={`${settlement.requestPhase}-${settlement.timestamp}`}>
                  <span>{settlement.requestPhase} · {settlement.pricingSnapshot?.tier ?? '未知档位'}</span>
                  <strong>输入 {settlement.inputTokens} · 缓存命中 {settlement.cacheReadTokens ?? '未知'} · 未命中 {settlement.cacheMissTokens ?? '未知'} · 输出 {settlement.outputTokens}</strong>
                  <p>
                    命中率 {typeof settlement.cacheHitRate === 'number' ? `${(settlement.cacheHitRate * 100).toFixed(1)}%` : '未知'} · 合计 {settlement.costUsd === null ? '未知' : formatRuntimeUsd(settlement.costUsd)}
                  </p>
                  {settlement.pricingSnapshot ? (
                    <p>
                      单价：缓存命中 {formatRuntimeUsd(settlement.pricingSnapshot.cacheHitInputUsdPerMillion)} / 1M · 未命中 {formatRuntimeUsd(settlement.pricingSnapshot.cacheMissInputUsdPerMillion)} / 1M · 输出 {formatRuntimeUsd(settlement.pricingSnapshot.outputUsdPerMillion)} / 1M
                    </p>
                  ) : null}
                  {settlement.breakdown ? (
                    <p>
                      拆分：缓存命中 {formatRuntimeUsd(settlement.breakdown.cacheHitInputUsd)} · 未命中 {formatRuntimeUsd(settlement.breakdown.cacheMissInputUsd)} · 输出 {formatRuntimeUsd(settlement.breakdown.outputUsd)} · 合计 {formatRuntimeUsd(settlement.breakdown.totalUsd)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {terminal.pricingSourceVersion ? <code>{terminal.pricingSourceVersion}</code> : null}
          <p><strong>结束原因：</strong>{terminal.reason}</p>
          {terminal.testCommand ? <code>{terminal.testCommand}</code> : null}
          {terminal.testSummary ? <p>{terminal.testSummary}</p> : null}
        </div>
      ) : null}

      {budgetDecision ? (
        <div className="agent-advisory agent-advisory--warn" data-testid="coding-budget-decision">
          <span>预算评估</span>
          <strong>{budgetDecision.status}</strong>
          <p>{budgetDecision.reason}</p>
          <div className="knowledge-reference-meta">
            <span>预计 {formatUsd(budgetDecision.projectedCostUsd)}</span>
            <span>已用 {formatUsd(budgetDecision.currentSpendUsd)}</span>
            {typeof budgetDecision.limitUsd === 'number' ? <span>上限 {formatUsd(budgetDecision.limitUsd)}</span> : null}
            {budgetDecision.approvalId ? <code>{budgetDecision.approvalId}</code> : null}
          </div>
          {budgetDecision.status === 'requires_lead_approval' ? (
            <p>
              {runtimeBudgetApprovalId.trim()
                ? `重新运行时将使用预算批准编号 ${runtimeBudgetApprovalId.trim()}，在当前工作中确认。`
                : '需要 Owner 或 Lead 的一次性预算批准。批准编号在设置中填写，重新运行在当前工作中确认。'}
              <button type="button" className="text-button" onClick={onOpenModelSettings}>打开模型与执行方式设置</button>
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="coding-run-audit" data-testid="coding-run-audit" aria-label="开发执行历史">
        <h4>执行历史</h4>
        {codingRuns.length > 1 ? (
          <label className="coding-run-history-picker">
            查看的执行
            <select aria-label="Coding Run history" value={auditRun.id} onChange={(event) => setAuditRunId(event.target.value)}>
              {codingRuns.map((run) => <option key={run.id} value={run.id}>{run.id} · {run.status} · {run.startedAt}</option>)}
            </select>
          </label>
        ) : null}
        <div className="compact-row"><span>执行标识</span><code>{auditRun.id}</code></div>
        <div className="compact-row"><span>状态 / 模型提供方</span><strong>{auditRun.status} · {auditRun.providerId}</strong></div>
        <div className="compact-row"><span>Tokens / 费用</span><strong>{auditRun.runtimeCostSummary?.totalTokens ?? (auditRun.runtimeCostSummary ? auditRun.runtimeCostSummary.inputTokens + auditRun.runtimeCostSummary.outputTokens : 'unknown')} · {displayRuntimeCost(auditRun.runtimeCostSummary)}</strong></div>
        <p>{auditRun.summary}</p>
        {auditPermissions.length > 0 ? (
          <ul aria-label="Coding Run permission history">
            {auditPermissions.map((request) => <li key={request.id}><code>{request.id}</code> · {request.status} · {request.title}</li>)}
          </ul>
        ) : <p className="empty-note">这次执行没有权限请求记录。</p>}
        {auditEvents.length > 0 ? (
          <ol aria-label="Coding Run trace history">
            {auditEvents.map((event) => <li key={event.id}><span>{event.kind}</span> · {event.message}</li>)}
          </ol>
        ) : <p className="empty-note">这次执行没有轨迹记录。</p>}
      </section>
    </section>
  )
}

/** Remaining evidence groups, folded (plan Y3); groups shown elsewhere in the task are dropped by the caller. */
export function AgentEvidenceGroups({ groups }: { groups: AgentEvidenceGroup[] }) {
  if (!groups.length) return null
  return (
    <details className="agent-evidence-groups" data-testid="agent-evidence-groups">
      <summary>更多执行证据 · {groups.length} 组</summary>
      <div className="agent-evidence-grid">
        {groups.map((group) => (
          <article className={`agent-evidence-card agent-evidence-card--${group.tone}`} key={group.id} data-testid={`agent-evidence-${group.id}`}>
            <div className="section-heading">
              <span>{group.title}</span>
              <strong>{group.items.length}</strong>
            </div>
            <p>{group.summary}</p>
            <div className="trace-list">
              {group.items.map((item) => (
                <div className="trace-step" key={item.id}>
                  <span>{item.eyebrow}</span>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  {item.meta.length > 0 ? (
                    <div className="knowledge-reference-meta">
                      {item.meta.map((meta) => <span key={meta}>{meta}</span>)}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </details>
  )
}

function displayRuntimeCost(summary: CodingAgentRun['runtimeCostSummary'] | undefined): string {
  if (summary?.phase === 'preflight_estimate') return `预估 ${formatUsd(summary.costUsd)} · 实际金额待确认`
  if (
    !summary ||
    !summary.usageStatus ||
    summary.usageStatus === 'legacy_unknown' ||
    !summary.costStatus ||
    summary.costStatus === 'legacy_unverified' ||
    typeof summary.costUsd !== 'number'
  ) {
    return 'unknown'
  }
  return formatUsd(summary.costUsd)
}

function runtimeCostPhaseLabel(phase: NonNullable<CodingAgentRun['runtimeCostSummary']>['phase']): string {
  if (phase === 'preflight_estimate') return '执行前最坏情况预估'
  if (phase === 'provider_settlement') return '提供方实际结算'
  return '旧记录，费用未核实'
}

function formatRuntimeUsd(value: number): string {
  return `$${value.toFixed(9).replace(/\.?0+$/u, '')}`
}
