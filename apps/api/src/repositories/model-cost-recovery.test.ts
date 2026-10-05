import { afterEach, describe, expect, it, vi } from 'vitest'
import { settledModelCallCost, type ModelCallQuote, type ModelCostReconciliationInput, type TeamSession } from '@ai-devflow/shared'
import { createSeedTeamRepository, type TeamRepository } from './team-repository'
import { resolveTeamRoute } from '../routes/team-routes'

const now = '2026-10-04T12:00:00.000Z', projectId = 'p-payments'
const caller: TeamSession = { source: 'demo', organizationId: 'org-demo', userId: 'u-yu', role: 'member', projectMemberships: [{ projectId, userId: 'u-yu', role: 'member' }] }
const lead: TeamSession = { ...caller, userId: 'u-ling', role: 'lead', projectMemberships: [{ projectId, userId: 'u-ling', role: 'lead' }] }
const quote = (id: string): ModelCallQuote => ({ id, projectId, providerId: 'deepseek', model: 'deepseek-flash', createdAt: now, billingProvider: 'deepseek', inputTokens: 100, maxOutputTokens: 100 })
async function setup() {
  vi.useFakeTimers(); vi.setSystemTime(now)
  const repo = createSeedTeamRepository()
  await repo.saveRuntimeBudgetPolicy({ projectId, enabled: false, monthlyLimitUsd: 2, warningThresholdUsd: 1, currency: 'USD', updatedAt: now }, caller)
  return repo
}
async function records(repo: TeamRepository) { return (await repo.getTeamOverview(caller)).modelCostRecovery!.find(row => row.projectId === projectId)!.records }
async function command(repo: TeamRepository, id: string, extra: Partial<ModelCostReconciliationInput> = {}): Promise<ModelCostReconciliationInput> {
  const row = (await records(repo)).find(row => row.sourceId === id)!
  return { projectId, sourceKind: row.sourceKind, sourceId: id, expectedVersion: row.version, idempotencyKey: `review-${id}`, costUsd: 0.25,
    reason: '提供方账单核对完成', evidence: '账单 INV-123 对应此调用', evidenceKind: 'provider_bill', executionStatus: 'ended', ...extra }
}
afterEach(() => vi.useRealTimers())

describe('auditable model cost recovery', () => {
  it('preserves original caller and settlement, replays idempotently, and restores admission only after recalculation', async () => {
    const repo = await setup(); await repo.reserveModelCall(quote('unknown'), caller)
    await repo.settleModelCall({ id: 'unknown', projectId, state: 'failed' }, caller)
    await repo.saveRuntimeBudgetPolicy({ projectId, enabled: true, monthlyLimitUsd: 2, warningThresholdUsd: 1, currency: 'USD', updatedAt: now }, lead)
    expect((await repo.reserveModelCall(quote('blocked'), caller)).accepted).toBe(false)
    const input = await command(repo, 'unknown')
    const first = await repo.reconcileModelCost(input, lead)
    expect(first).toMatchObject({ originalCostUsd: null, costUsd: 0.25, originalUserId: caller.userId, usageKnown: false })
    await repo.reconcileModelCost(input, lead)
    const row = (await records(repo)).find(row => row.sourceId === 'unknown')!
    expect(row.events).toHaveLength(1)
    expect(row.events[0]).toMatchObject({ actorId: lead.userId, originalUserId: caller.userId, reason: input.reason })
    expect((await repo.reserveModelCall(quote('allowed'), caller)).accepted).toBe(true)
    await expect(repo.reconcileModelCost({ ...input, costUsd: 1 }, lead)).rejects.toThrow(/idempotency/i)
  })

  it('rejects members, another organization, arbitrary caller identity and stale/concurrent versions', async () => {
    const repo = await setup(); await repo.reserveModelCall(quote('one'), caller); await repo.settleModelCall({ id: 'one', projectId, state: 'failed' }, caller)
    const input = await command(repo, 'one')
    await expect(repo.reconcileModelCost(input, caller)).rejects.toThrow(/lead/i)
    await expect(repo.reconcileModelCost(input, { ...lead, organizationId: 'other' })).rejects.toThrow(/scope/i)
    const results = await Promise.allSettled([repo.reconcileModelCost(input, lead), repo.reconcileModelCost({ ...input, idempotencyKey: 'concurrent' }, lead)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const response = await resolveTeamRoute('POST', '/api/runtime/model-costs/reconcile', repo, { session: lead, body: { ...input, userId: caller.userId } })
    expect(response?.status).toBe(400)
  })

  it('never treats elapsed reservation time alone as proof of zero cost', async () => {
    const repo = await setup(); await repo.reserveModelCall(quote('active'), caller)
    await expect(repo.reconcileModelCost(await command(repo, 'active'), lead)).rejects.toThrow(/running|运行/)
    vi.setSystemTime('2026-10-04T12:11:00Z')
    const input = await command(repo, 'active', { costUsd: 0, evidenceKind: 'not_sent', executionStatus: 'not_sent', evidence: '执行日志确认未发送请求' })
    await expect(repo.reconcileModelCost({ ...input, executionStatus: 'unknown' } as unknown as ModelCostReconciliationInput, lead)).rejects.toThrow()
    expect(await repo.reconcileModelCost(input, lead)).toMatchObject({ costUsd: 0, isReservation: false })
  })

  it('durably acknowledges late conflicts once and requires a fresh correction; original settle identity stays enforced', async () => {
    const repo = await setup(); await repo.reserveModelCall(quote('late'), caller)
    await repo.settleModelCall({ id: 'late', projectId, state: 'failed' }, caller)
    await repo.reconcileModelCost(await command(repo, 'late'), lead)
    const late = { id: 'late', projectId, state: 'completed' as const, usage: { inputTokens: 50, outputTokens: 5, cacheReadTokens: 0, cacheMissTokens: 50, cacheStatus: 'complete' as const } }
    await expect(repo.settleModelCall(late, lead)).rejects.toThrow(/scope/)
    const receipt = await repo.settleModelCall(late, caller)
    expect(receipt).toMatchObject({ status: 'conflict_recorded', id: 'late' })
    expect(await repo.settleModelCall(late, caller)).toEqual(receipt)
    let row = (await records(repo)).find(row => row.sourceId === 'late')!
    expect(row).toMatchObject({ status: 'conflict', originalState: 'failed', costUsd: null })
    expect(row.events).toHaveLength(2)
    await repo.reconcileModelCost(await command(repo, 'late', { idempotencyKey: 'resolve-late', costUsd: 0.3, usage: late.usage }), lead)
    expect(await repo.settleModelCall(late, caller)).toEqual(receipt)
    row = (await records(repo)).find(row => row.sourceId === 'late')!
    expect(row).toMatchObject({ status: 'settled', costUsd: 0.3, usageKnown: true })
    expect(row.events).toHaveLength(3)
  })

  it('retries only stored final results of the authenticated caller without dispatching models', async () => {
    const repo = await setup(); await repo.reserveModelCall(quote('queue'), caller)
    await repo.persistModelCallSettlement({ id: 'queue', projectId, state: 'failed' }, caller)
    const retry = () => resolveTeamRoute('POST', '/api/runtime/model-costs/retry', repo, { session: caller, body: { projectId } })
    expect((await retry())?.body).toMatchObject({ receipts: [] })
    await repo.persistModelCallSettlement({ id: 'queue', projectId, state: 'failed' }, caller, true)
    expect(await repo.listPendingModelCallSettlements(projectId, lead)).toEqual([])
    expect((await retry())?.body).toMatchObject({ receipts: [{ status: 'settled', id: 'queue' }] })
    expect((await retry())?.body).toMatchObject({ receipts: [] })
  })

  it('consumes reconciled amounts from the existing approval instead of the immutable unknown value', async () => {
    const repo = await setup()
    await repo.saveRuntimeBudgetPolicy({ projectId, enabled: true, monthlyLimitUsd: 0, warningThresholdUsd: 0, currency: 'USD', updatedAt: now }, lead)
    await repo.saveRuntimeBudgetApproval({ id: 'approval', projectId, providerId: 'deepseek', requestedBy: caller.userId, approvedBy: lead.userId, role: 'lead', maxAdditionalCostUsd: 0.5, reason: 'test', status: 'approved', createdAt: now, expiresAt: '2026-10-05T00:00:00Z' }, lead)
    expect((await repo.reserveModelCall({ ...quote('approved'), approvalId: 'approval' }, caller)).accepted).toBe(true)
    await repo.settleModelCall({ id: 'approved', projectId, state: 'failed' }, caller)
    await repo.reconcileModelCost(await command(repo, 'approved'), lead)
    expect((await repo.reserveModelCall({ ...quote('remaining'), approvalId: 'approval' }, caller)).accepted).toBe(true)
    await repo.settleModelCall({ id: 'remaining', projectId, state: 'failed' }, caller)
    await repo.reconcileModelCost(await command(repo, 'remaining', { costUsd: 0.3 }), lead)
    expect((await repo.reserveModelCall({ ...quote('exhausted'), approvalId: 'approval' }, caller)).accepted).toBe(false)
  })

  it.each([true, false])('appends matching late evidence without reopening a resolved expense (explicit Tokens: %s)', async (withUsage) => {
    const repo = await setup(); await repo.reserveModelCall(quote('matching'), caller)
    await repo.settleModelCall({ id: 'matching', projectId, state: 'failed' }, caller)
    const late = { id: 'matching', projectId, state: 'completed' as const, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheMissTokens: 100, cacheStatus: 'complete' as const } }
    const costUsd = settledModelCallCost(quote('matching'), late)!
    await repo.reconcileModelCost(await command(repo, 'matching', { costUsd, ...(withUsage ? { usage: late.usage } : {}) }), lead)
    const receipt = await repo.settleModelCall(late, caller)
    expect(receipt).toMatchObject({ status: 'confirmed' })
    expect(await repo.settleModelCall(late, caller)).toEqual(receipt)
    const row = (await records(repo)).find(row => row.sourceId === 'matching')!
    expect(row).toMatchObject({ status: 'settled', costUsd, originalState: 'failed', originalCostUsd: null, usageKnown: true })
    expect(row.events).toHaveLength(2)
    expect(row.events[1]).toMatchObject({ kind: 'settlement_confirmation', settlement: late })
  })

  it('requires a bill or explicit unsent proof for zero instead of an unpriced usage reference', async () => {
    const repo = await setup(); await repo.reserveModelCall(quote('zero'), caller)
    await repo.settleModelCall({ id: 'zero', projectId, state: 'failed' }, caller)
    await expect(repo.reconcileModelCost(await command(repo, 'zero', { costUsd: 0, evidenceKind: 'provider_usage' }), lead)).rejects.toThrow()
    expect((await records(repo)).find(row => row.sourceId === 'zero')?.costUsd).toBeNull()
  })
})
