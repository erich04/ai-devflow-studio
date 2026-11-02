import type { CodingActionCosts } from './build-test-contract.js'
import type { CodingExecutor } from './coding-executor.js'
import type { CodingRuntimeBudgetGuard } from './coding-runtime.js'
import type { LocalStore } from './local-store.js'
import { estimateNativeCodingWorstCaseCost } from './coding-runtime-configuration.js'

export async function getCodingActionCosts(input: { projectId: string; store: LocalStore; executor: CodingExecutor | null; guard: CodingRuntimeBudgetGuard }): Promise<CodingActionCosts> {
  const executor = input.executor
  const native = executor?.descriptor.kind === 'native'
  const billing = executor?.billing === 'no_cost' ? 'no_cost' : executor?.billing === 'metered' && native ? 'metered' : 'opaque'
  const result: CodingActionCosts = { executor: !executor ? 'unconfigured' : native ? 'native' : executor.engine === 'opencode-http' ? 'opencode' : 'compatibility', executorLabel: !executor ? '未配置' : native ? 'DevFlow Native' : executor.engine === 'opencode-http' ? 'OpenCode' : '本地执行器', ...(executor?.modelId ? { modelLabel: executor.modelId } : {}), billing, start: null, revise: null, selfCheck: null, repair: null, repairRevise: null, budget: { revise: null, selfCheck: null, repairRevise: null } }
  if (!executor) return result
  if (billing === 'no_cost') return { ...result, start: 0, revise: 0, selfCheck: 0, repair: 0, repairRevise: 0 }
  if (billing !== 'metered' || !native) return result
  const estimate = (calls: number) => estimateNativeCodingWorstCaseCost({ runId: 'estimate', nodeId: 'estimate', projectId: input.projectId, requestedBy: 'estimate', providerId: executor.providerId, model: executor.modelId ?? executor.providerId, timestamp: new Date().toISOString(), providerCallLimit: calls, ...(executor.billingProvider ? { billingProvider: executor.billingProvider } : {}) })
  for (const [key, calls] of [['start', 4], ['revise', 2], ['selfCheck', 1], ['repair', 1], ['repairRevise', 1]] as const) {
    const cost = estimate(calls)
    result[key] = cost.pricingSnapshot ? cost.costUsd : null
  }
  const coding = (await input.store.listCodingAgentRuns()).filter(r => r.projectId === input.projectId).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1)
  const run = coding ? await input.store.getRun(coding.runId) : null
  const node = run?.nodes.find(n => n.id === coding?.nodeId)
  const project = (await input.store.listProjects()).find(p => p.id === input.projectId)
  if (coding && run && node && project) for (const [key, calls] of [['revise', 2], ['selfCheck', 1], ['repairRevise', 1]] as const) {
    const decision = await input.guard({ codingRunId: coding.id, engine: 'native', providerId: executor.providerId, model: executor.modelId ?? executor.providerId, project, run, node, requestedBy: coding.requestedBy, estimatedCost: estimate(calls), metered: true })
    result.budget[key] = { blocks: decision.blocksRun, status: decision.status, ...(decision.reason ? { reason: decision.reason } : {}) }
  }
  return result
}
