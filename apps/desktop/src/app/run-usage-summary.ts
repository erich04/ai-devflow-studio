import {
  annotateUnknownRuntimeCosts, formatCostRollup, rollupTokenUsage, runtimeCostSummaryToTokenUsage,
  type AgentTokenUsage, type AgentTrace, type CodingAgentRun, type TokenUsage,
} from '@ai-devflow/shared'

export function buildRunUsageSummary(runId: string | undefined, usage: AgentTokenUsage[], codingRuns: CodingAgentRun[], traces: AgentTrace[]) {
  const rows = usage.filter((row) => row.runId === runId)
  const costs = codingRuns.filter((run) => run.runId === runId).flatMap((run) => run.runtimeCostSummary ? [run.runtimeCostSummary] : [])
  const codingUsage = costs.map(runtimeCostSummaryToTokenUsage).filter((row): row is TokenUsage => row !== null)
  const rollups = annotateUnknownRuntimeCosts(rollupTokenUsage([...rows, ...codingUsage], 'projectId'), costs, 'projectId')
  const unrecorded = traces.filter((trace) => trace.runId === runId &&
    (trace.executorProvenance?.kind === 'local-agent' || (trace.reviewId.startsWith('stage-agent-failure-') && trace.steps.some((step) => step.label === 'Run local-agent'))) &&
    !rows.some((row) => row.id === `agent-token-usage-${trace.reviewId}`)).length
  if (unrecorded) rollups.push({ key: 'unrecorded', costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0, unknownCostCount: unrecorded })
  const unknown = rollups.reduce((sum, row) => sum + (row.unknownCostCount ?? 0), 0)
  const unknownTokens = unrecorded + rows.filter((row) => row.usageStatus === 'unknown' || row.usageStatus === 'partial').length
  const totalTokens = rollups.reduce((sum, row) => sum + row.totalTokens, 0)
  return {
    costLabel: rollups.length ? formatCostRollup(rollups) : '暂无用量记录', unknownCostCount: unknown,
    tokenLabel: `${totalTokens.toLocaleString()}${unknownTokens ? ` + ${unknownTokens} 项用量不完整` : ''}`,
  }
}
