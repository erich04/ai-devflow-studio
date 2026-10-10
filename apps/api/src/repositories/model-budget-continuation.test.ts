import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSeedTeamRepository } from './team-repository'
import { verifiedModelCallBound, type ModelCallQuote, type TeamSession } from '@ai-devflow/shared'

const projectId = 'p-payments', now = '2026-10-10T12:00:00.000Z'
const actor: TeamSession = { source: 'demo', organizationId: 'org-demo', userId: 'u-ling', role: 'lead', projectMemberships: [{ projectId, userId: 'u-ling', role: 'lead' }] }
const quote = (id: string): ModelCallQuote => ({ id, projectId, providerId: 'deepseek', billingProvider: 'deepseek', model: 'deepseek-flash', createdAt: now, inputTokens: 1000, maxOutputTokens: 65536, boundBasis: 'deepseek-context-v1', operation: { id: 'operation-1', version: 'a'.repeat(64), purpose: 'conversation' } })
async function setup() {
  vi.useFakeTimers(); vi.setSystemTime(now)
  const repo = createSeedTeamRepository()
  await repo.saveRuntimeBudgetPolicy({ projectId, enabled: false, monthlyLimitUsd: 10, warningThresholdUsd: 5, currency: 'USD', updatedAt: now }, actor)
  const { boundBasis: _, ...legacy } = quote('legacy')
  await repo.reserveModelCall(legacy, actor)
  await repo.settleModelCall({ id: 'legacy', projectId, state: 'failed' }, actor)
  await repo.saveRuntimeBudgetPolicy({ projectId, enabled: true, monthlyLimitUsd: 10, warningThresholdUsd: 5, currency: 'USD', updatedAt: now }, actor)
  return repo
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
describe('operation-scoped continuation without fabricated expenses', () => {
  it('can stop new continuation admissions while retaining existing holds and accepting late settlement', async () => {
    const repo = await setup(), request = quote('before-stop')
    const card = await repo.prepareModelBudgetContinuation(request, actor)
    await repo.confirmModelBudgetContinuation({ id: card.id, projectId, expectedVersion: card.version }, actor)
    expect((await repo.reserveModelCall({ ...request, continuationId: card.id }, actor)).accepted).toBe(true)
    const before = (await repo.getTeamOverview(actor)).modelCostRecovery!.find(row => row.projectId === projectId)!
    vi.stubEnv('DEVFLOW_BUDGET_PENDING_HOLDS_ENABLED', '0')
    const rejected = await repo.reserveModelCall({ ...quote('after-stop'), continuationId: card.id }, actor)
    expect(rejected).toMatchObject({ accepted: false, decision: { blocksRun: true } })
    expect(rejected.decision.continuationEligible).not.toBe(true)
    await expect(repo.prepareModelBudgetContinuation(quote('disabled-card'), actor)).rejects.toThrow('部署配置暂停')
    await expect(repo.confirmModelBudgetContinuation({ id: card.id, projectId, expectedVersion: card.version }, actor)).rejects.toThrow('部署配置暂停')
    const stopped = (await repo.getTeamOverview(actor)).modelCostRecovery!.find(row => row.projectId === projectId)!
    expect(stopped.reservedCostUsd).toBe(before.reservedCostUsd)
    expect(stopped.records.find(row => row.sourceId === 'legacy')?.costUsd).toBeNull()
    await repo.settleModelCall({ id: request.id, projectId, state: 'completed', usage: { inputTokens: 10, outputTokens: 5, usageCompleteness: 'final', billingProvider: 'deepseek', cacheReadTokens: 0, cacheStatus: 'complete' } }, actor)
    const ended = (await repo.getTeamOverview(actor)).modelCostRecovery!.find(row => row.projectId === projectId)!
    expect(ended.records.find(row => row.sourceId === request.id)?.costUsd).not.toBeNull()
    expect(ended.reservedCostUsd).toBeLessThan(before.reservedCostUsd)
  })
  it('requires an explicit confirmation, handles concurrent confirmation once, and keeps old costs unknown', async () => {
    const repo = await setup(), request = quote('new')
    expect((await repo.reserveModelCall(request, actor)).accepted).toBe(false)
    const card = await repo.prepareModelBudgetContinuation(request, actor)
    expect(card.records.map(row => row.sourceId)).toContain('legacy')
    expect(card.confirmedAt).toBeUndefined()
    expect((await repo.reserveModelCall({ ...request, continuationId: card.id }, actor)).accepted).toBe(false)
    const command = { id: card.id, projectId, expectedVersion: card.version }
    const confirmations = await Promise.all([repo.confirmModelBudgetContinuation(command, actor), repo.confirmModelBudgetContinuation(command, actor)])
    expect(confirmations[0]).toEqual(confirmations[1])
    expect((await repo.reserveModelCall({ ...request, continuationId: card.id }, actor)).accepted).toBe(true)
    const record = (await repo.getTeamOverview(actor)).modelCostRecovery!.find(row => row.projectId === projectId)!.records.find(row => row.sourceId === 'legacy')!
    expect(record.costUsd).toBeNull(); expect(record.usageKnown).toBe(false); expect(record.events).toEqual([])
    await expect(repo.reserveModelCall({ ...request, continuationId: card.id }, actor)).rejects.toThrow(/重复/)
  })
  it('rejects changed operation, actor, evidence, policy and expired authority', async () => {
    const repo = await setup(), card = await repo.prepareModelBudgetContinuation(quote('new'), actor)
    const command = { id: card.id, projectId, expectedVersion: card.version }
    await expect(repo.confirmModelBudgetContinuation(command, { ...actor, role: 'member', projectMemberships: [{ projectId, userId: actor.userId, role: 'member' }] })).rejects.toThrow(/Lead/)
    await repo.confirmModelBudgetContinuation(command, actor)
    expect((await repo.reserveModelCall({ ...quote('changed'), continuationId: card.id, operation: { ...quote('x').operation!, version: 'b'.repeat(64) } }, actor)).accepted).toBe(false)
    expect((await repo.reserveModelCall({ ...quote('another'), continuationId: card.id }, { ...actor, userId: 'u-yu' })).accepted).toBe(false)
    vi.setSystemTime('2026-10-10T12:16:00Z')
    expect((await repo.reserveModelCall({ ...quote('expired'), continuationId: card.id }, actor)).accepted).toBe(false)
    await expect(repo.confirmModelBudgetContinuation(command, actor)).rejects.toThrow(/过期/)
  })
  it('reserves known bounds automatically and counts them atomically, without releasing on a timer', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const repo = createSeedTeamRepository(), bound = verifiedModelCallBound(quote('x'))!
    await repo.saveRuntimeBudgetPolicy({ projectId, enabled: true, monthlyLimitUsd: bound.costUsd * 1.5, warningThresholdUsd: 0, currency: 'USD', updatedAt: now }, actor)
    const results = await Promise.all([repo.reserveModelCall(quote('a'), actor), repo.reserveModelCall(quote('b'), actor)])
    expect(results.filter(row => row.accepted)).toHaveLength(1)
    vi.setSystemTime('2026-10-10T12:11:00Z')
    expect((await repo.reserveModelCall(quote('c'), actor)).accepted).toBe(false)
  })
})
