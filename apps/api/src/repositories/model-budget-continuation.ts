import { createHash } from 'node:crypto'
import { modelExecutionRollout, canonicalFinancialValue, verifiedModelCallBound, type ModelCallQuote, type ModelBudgetContinuation, type ConfirmModelBudgetContinuation, type ModelCallAttempt, type TeamSession } from '@ai-devflow/shared'
import type { TeamRepository, TeamRepositorySyncContext } from './team-repository'
import { canSyncProject } from '../auth/session'

type Repo = Pick<TeamRepository, 'getTeamOverview' | 'getRuntimeBudgetPolicy'>
const hash = (value: unknown) => createHash('sha256').update(canonicalFinancialValue(value)).digest('hex')

export async function prepareModelBudgetContinuation(repo: Repo, quote: ModelCallQuote, session: TeamSession,
  read: (id: string) => Promise<ModelBudgetContinuation | null>, write: (value: ModelBudgetContinuation) => Promise<void>): Promise<ModelBudgetContinuation> {
  if (!modelExecutionRollout().pendingBudget) throw new Error('费用待核对时继续执行已由部署配置暂停；已有费用记录和结算仍保留。')
  if (!quote.operation || !canSyncProject(session, quote.projectId, 'member')) throw new Error('缺少本次操作范围或项目权限。')
  const now = new Date().toISOString()
  const bound = verifiedModelCallBound({ ...quote, createdAt: now })
  if (!bound) throw new Error('本次请求缺少可核验的模型额度或定价依据，无法准备继续授权；历史费用保持未知。')
  const [overview, policy] = await Promise.all([repo.getTeamOverview(session), repo.getRuntimeBudgetPolicy(quote.projectId, session)])
  if (!policy?.enabled || !overview.projects.some(project => project.id === quote.projectId)) throw new Error('预算规则或项目范围已更新，请重新操作。')
  const pending = overview.modelCostRecovery?.find(row => row.projectId === quote.projectId)?.records.filter(row => row.affectsCurrentBudget && row.budgetCostUsd === null) ?? []
  if (pending.some(row => row.status === 'conflict' || row.unresolvedConflictIds.length)) throw new Error('存在相互冲突的真实费用证据，需要先核对冲突，不能用继续授权覆盖。')
  const records = pending.map(row => ({ sourceKind: row.sourceKind, sourceId: row.sourceId, version: row.version,
    model: row.model, createdAt: row.createdAt, status: row.status, originalState: row.originalState, estimatedCostUsd: row.verifiedHoldUsd ?? null })).sort((a, b) => a.sourceId.localeCompare(b.sourceId))
  const policyVersion = hash(policy)
  const version = hash([session.organizationId, session.userId, quote.projectId, quote.providerId, quote.model, quote.operation, policyVersion, records, bound, now.slice(0, 7)])
  // Same card until expiry; after expiry a new card still requires a new explicit confirmation.
  const id = `continue-${hash(version)}`
  const existing = await read(id)
  if (existing) {
    if (Date.parse(existing.expiresAt) <= Date.parse(now)) throw new Error('本次操作的授权已过期，请手动继续或重试以发起新操作。')
    return existing
  }
  const currentSpendUsd = (overview.budgetProjectCost ?? overview.projectCost).find(row => row.key === quote.projectId)?.costUsd ?? 0
  const recovery = overview.modelCostRecovery?.find(row => row.projectId === quote.projectId)
  const maxCalls = 36
  const maxCostUsd = bound.costUsd * maxCalls
  const card: ModelBudgetContinuation = { id, projectId: quote.projectId, actorId: session.userId, organizationId: session.organizationId,
    providerId: quote.providerId, model: quote.model, operation: quote.operation, version, policyVersion, month: now.slice(0, 7),
    createdAt: now, expiresAt: new Date(Date.parse(now) + 900_000).toISOString(), maxCalls, maxCostUsd, nextCallBoundUsd: bound.costUsd,
    ...(recovery ? { costs: { actualUsd: recovery.actualCostUsd, executingUsd: recovery.reservedCostUsd, pendingBoundedUsd: recovery.pendingBoundedCostUsd ?? 0, unknownCount: recovery.actualUnknownCount + recovery.reservedUnknownCount } } : {}),
    currentSpendUsd, limitUsd: policy.monthlyLimitUsd, possibleExcessUsd: Math.max(0, currentSpendUsd + maxCostUsd - policy.monthlyLimitUsd), records }
  await write(card)
  return card
}

export async function confirmModelBudgetContinuation(repo: Repo, input: ConfirmModelBudgetContinuation, session: TeamSession,
  read: (id: string) => Promise<ModelBudgetContinuation | null>, write: (value: ModelBudgetContinuation) => Promise<void>): Promise<ModelBudgetContinuation> {
  if (!modelExecutionRollout().pendingBudget) throw new Error('费用待核对时继续执行已由部署配置暂停；已有费用记录和结算仍保留。')
  if (!canSyncProject(session, input.projectId, 'lead')) throw new Error('确认继续需要项目 Lead 或 Owner 权限。')
  const card = await read(input.id)
  if (!card || card.projectId !== input.projectId || card.organizationId !== session.organizationId || card.actorId !== session.userId || card.version !== input.expectedVersion) throw new Error('继续授权范围已变化，请重新查看确认卡。')
  const now = new Date().toISOString()
  const [overview, policy] = await Promise.all([repo.getTeamOverview(session), repo.getRuntimeBudgetPolicy(input.projectId, session)])
  if (Date.parse(card.expiresAt) <= Date.parse(now) || card.month !== now.slice(0, 7) || hash(policy) !== card.policyVersion) throw new Error('确认卡或预算规则已过期，请重新准备。')
  const records = overview.modelCostRecovery?.find(row => row.projectId === input.projectId)?.records ?? []
  if (card.records.some(ref => !records.some(row => row.sourceId === ref.sourceId && row.sourceKind === ref.sourceKind && row.version === ref.version)) ||
    records.some(row => row.affectsCurrentBudget && row.budgetCostUsd === null && !card.records.some(ref => ref.sourceId === row.sourceId && ref.sourceKind === row.sourceKind && ref.version === row.version))) throw new Error('费用记录已变化，请查看更新后的确认卡。')
  if (card.confirmedAt) return card
  const confirmed = { ...card, confirmedAt: now }
  await write(confirmed)
  return confirmed
}

export function validModelBudgetContinuation(card: ModelBudgetContinuation | undefined, quote: ModelCallQuote, session: TeamRepositorySyncContext,
  policy: unknown, records: Array<{ sourceId: string; sourceKind: string; version: string; budgetCostUsd: number | null; affectsCurrentBudget: boolean }>, attempts: ModelCallAttempt[], now: string, cost: number | null): boolean {
  if (!modelExecutionRollout().pendingBudget || !card?.confirmedAt || !quote.operation || cost === null || cost > card.nextCallBoundUsd + 1e-9 || card.organizationId !== session.organizationId || card.actorId !== session.userId ||
    card.projectId !== quote.projectId || card.providerId !== quote.providerId || card.model !== quote.model || card.policyVersion !== hash(policy) ||
    canonicalFinancialValue(card.operation) !== canonicalFinancialValue(quote.operation) || card.month !== now.slice(0, 7) || Date.parse(card.expiresAt) <= Date.parse(now)) return false
  if (records.some(row => row.affectsCurrentBudget && row.budgetCostUsd === null && !card.records.some(ref => ref.sourceId === row.sourceId && ref.sourceKind === row.sourceKind && ref.version === row.version))) return false
  const used = attempts.filter(row => row.continuationId === card.id && row.projectId === quote.projectId && row.userId === session.userId)
  const usedCost = used.reduce((sum, call) => sum + (call.costUsd ?? call.verifiedBound?.costUsd ?? Infinity), 0)
  return used.length < card.maxCalls && usedCost + cost <= card.maxCostUsd + 1e-9
}
