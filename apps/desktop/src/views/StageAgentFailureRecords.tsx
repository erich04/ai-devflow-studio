import { describeStageAgentFailure, sanitizeStageAgentFailureDetails, type AgentTrace, type StageAgentFailureSource } from '@ai-devflow/shared'
import { formatLocalTime } from '../app/desktop-view-model'

const sources: Record<StageAgentFailureSource, string> = {
  budget_relay: '项目预算与结算', provider: '模型服务', opencode_http: '本机 OpenCode 接口',
  opencode_runtime: 'OpenCode 运行时', stage_validation: '阶段校验', executor: '执行器', lifecycle: '资源清理',
}

export function StageAgentFailureRecords({ traces, runId, nodeId, onViewCosts }: { traces: AgentTrace[]; runId?: string; nodeId?: string; onViewCosts?: () => void }) {
  const failures = traces.filter((trace) => trace.runId === runId && trace.nodeId === nodeId)
    .flatMap((trace) => {
      const details = sanitizeStageAgentFailureDetails(trace.failureDetails)
      return details ? [{ trace, details }] : []
    }).sort((a, b) => b.trace.createdAt.localeCompare(a.trace.createdAt)).slice(0, 5)
  if (!failures.length) return null
  return <section aria-label="阶段失败记录" data-testid="stage-agent-failure-records">
    <h3>最近失败记录</h3>
    {failures.map(({ trace, details }) => <article key={trace.id}>
      <p className="meta">{formatLocalTime(trace.createdAt)} · {sources[details.source]}</p>
      <p>{describeStageAgentFailure(details)}</p>
      {onViewCosts && ['budget_denied', 'accounting_unavailable', 'settlement_sync_failed'].includes(details.code) && <button onClick={onViewCosts}>查看项目费用与恢复</button>}
    </article>)}
  </section>
}
