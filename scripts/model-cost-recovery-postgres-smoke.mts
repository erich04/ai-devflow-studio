import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createPostgresPoolClient } from '../apps/api/src/db/postgres-client'
import { createPostgresTeamRepository } from '../apps/api/src/repositories/postgres-team-repository'
import { resolveTeamRoute } from '../apps/api/src/routes/team-routes'
import { settledModelCallCost, type ModelCallQuote, type ModelCostReconciliationInput, type TeamSession } from '../packages/shared/src/index'

// This command intentionally refuses the application/default DB or the historical shared QA DB.
const connectionString = process.env.DEVFLOW_COST_RECOVERY_DATABASE_URL
if (!connectionString || !new URL(connectionString).pathname.startsWith('/devflow_opencode_cost')) throw new Error('Use a dedicated devflow_opencode_cost database through DEVFLOW_COST_RECOVERY_DATABASE_URL.')
const db = createPostgresPoolClient({ connectionString, applicationName: 'opencode-cost-recovery-isolated', statementTimeoutMs: 10000 })
const projectId = `p-cost-${randomUUID()}`
const caller: TeamSession = { source: 'demo', organizationId: 'org-demo', userId: 'u-yu', role: 'member', projectMemberships: [{ projectId, userId: 'u-yu', role: 'member' }] }
const lead: TeamSession = { ...caller, userId: 'u-ling', role: 'lead', projectMemberships: [{ projectId, userId: 'u-ling', role: 'lead' }] }
try {
  await db.query(`INSERT INTO projects (id,organization_id,name,slug,description,repository,default_branch,health,knowledge_base_path,test_command)
    VALUES ($1,'org-demo','Cost recovery fixture',$1,'isolated test','example/fixture','main','on_track','docs','npm test')`, [projectId])
  const repo = createPostgresTeamRepository(db)
  const now = new Date().toISOString()
  const quote = (id: string): ModelCallQuote => ({ id, projectId, providerId: 'deepseek', model: 'deepseek-flash', inputTokens: 1000, maxOutputTokens: 1000, billingProvider: 'deepseek', createdAt: now })
  const view = async () => (await repo.getTeamOverview(caller)).modelCostRecovery!.find(row => row.projectId === projectId)!
  const command = async (id: string, key = randomUUID()): Promise<ModelCostReconciliationInput> => ({
    projectId, sourceKind: 'model_call', sourceId: id, expectedVersion: (await view()).records.find(row => row.sourceId === id)!.version,
    idempotencyKey: key, costUsd: 0.25, reason: '提供方账单已核对', evidence: 'Invoice TEST-123', evidenceKind: 'provider_bill', executionStatus: 'ended',
  })
  await repo.saveRuntimeBudgetPolicy({ projectId, enabled: true, monthlyLimitUsd: 1, warningThresholdUsd: 0.8, currency: 'USD', updatedAt: now }, lead)
  const id = randomUUID()
  assert((await repo.reserveModelCall(quote(id), caller)).accepted)
  await repo.settleModelCall({ id, projectId, state: 'failed' }, caller)
  assert.equal((await repo.reserveModelCall(quote(randomUUID()), caller)).accepted, false)
  const input = await command(id)
  await assert.rejects(repo.reconcileModelCost(input, caller), /lead/)
  const concurrent = await Promise.allSettled([repo.reconcileModelCost(input, lead), repo.reconcileModelCost({ ...input, idempotencyKey: randomUUID() }, lead)])
  assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1, 'Stale concurrent correction was accepted')
  // Determine the committed command independent of transaction arrival order.
  const correction = (await view()).records.find(row => row.sourceId === id)!.events[0]!
  assert.equal(correction.kind, 'reconciliation')
  if (correction.kind !== 'reconciliation') throw new Error('Missing correction')
  await repo.reconcileModelCost({ ...input, idempotencyKey: correction.idempotencyKey }, lead)
  assert.equal((await view()).records.find(row => row.sourceId === id)!.events.length, 1)
  assert.equal((await view()).actualCostUsd, 0.25)
  const raw = (await db.query<{json: {costUsd: number | null; state: string}}>('SELECT json FROM model_call_attempts WHERE id=$1', [id]))[0]!.json
  assert.deepEqual({ costUsd: raw.costUsd, state: raw.state }, { costUsd: null, state: 'failed' })

  const late = { id, projectId, state: 'completed' as const, usage: { inputTokens: 50, outputTokens: 2, cacheReadTokens: 0, cacheMissTokens: 50, cacheStatus: 'complete' as const } }
  await assert.rejects(repo.settleModelCall(late, lead), /scope/)
  const receipts = await Promise.all([repo.settleModelCall(late, caller), repo.settleModelCall(late, caller)])
  assert.deepEqual(receipts[0], receipts[1]); assert.equal(receipts[0]!.status, 'conflict_recorded')
  assert.equal((await view()).records.find(row => row.sourceId === id)!.status, 'conflict')
  assert.equal((await repo.reserveModelCall(quote(randomUUID()), caller)).accepted, false)
  const restarted = createPostgresTeamRepository(db)
  assert.equal((await restarted.getTeamOverview(caller)).modelCostRecovery!.find(row => row.projectId === projectId)!.records.find(row => row.sourceId === id)!.events.length, 2)
  await restarted.reconcileModelCost({ ...await command(id), costUsd: 0.3, usage: late.usage }, lead)
  assert.deepEqual(await restarted.settleModelCall(late, caller), receipts[0])
  assert.equal((await view()).actualCostUsd, 0.3)

  const activeId = randomUUID()
  assert((await repo.reserveModelCall(quote(activeId), caller)).accepted)
  // Before final markers existed, the server stored this before dispatch too.
  await db.query("UPDATE model_call_attempts SET json=jsonb_set(json,'{pendingSettlement}',$2::jsonb) WHERE id=$1", [activeId, JSON.stringify({ id: activeId, projectId, state: 'failed' })])
  assert.equal((await repo.listPendingModelCallSettlements(projectId, caller)).length, 0, 'Ambiguous historical dispatch marker was considered final')
  assert.equal((await view()).records.find(row => row.sourceId === activeId)!.status, 'running')
  await assert.rejects(repo.reconcileModelCost(await command(activeId), lead), /运行/)
  const staleAt = new Date(Date.now() - 11 * 60_000).toISOString()
  await db.query("UPDATE model_call_attempts SET created_at=$2::text::timestamptz, json=jsonb_set(json,'{createdAt}',to_jsonb($2::text)) WHERE id=$1", [activeId, staleAt])
  await repo.reconcileModelCost({ ...await command(activeId), costUsd: 0, evidenceKind: 'not_sent', executionStatus: 'not_sent', evidence: '执行日志确认请求未发送' }, lead)
  const pendingId = randomUUID()
  assert((await repo.reserveModelCall(quote(pendingId), caller)).accepted)
  await db.query("UPDATE model_call_attempts SET json=jsonb_set(json,'{pendingSettlement}',$2::jsonb) WHERE id=$1", [pendingId, JSON.stringify({ id: pendingId, projectId, state: 'failed' })])
  await repo.persistModelCallSettlement({ id: pendingId, projectId, state: 'failed' }, caller)
  assert.equal((await repo.listPendingModelCallSettlements(projectId, caller)).length, 0)
  await repo.persistModelCallSettlement({ id: pendingId, projectId, state: 'not_sent' }, caller, true)
  const retried = await resolveTeamRoute('POST', '/api/runtime/model-costs/retry', repo, { session: caller, body: { projectId } })
  assert.equal(retried?.status, 200)
  assert.equal((await repo.listPendingModelCallSettlements(projectId, caller)).length, 0)
  const forbidden = await resolveTeamRoute('POST', '/api/runtime/model-costs/reconcile', repo, { session: caller, body: await command(id) })
  assert.equal(forbidden?.status, 403)

  // A prior-month unknown remains visible but must not enter this month's admission.
  const oldId = `legacy-chat-${randomUUID()}`
  const monthStart = new Date(now); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0)
  const oldTimestamp = new Date(monthStart.getTime() - 1000).toISOString()
  await repo.importHistoricalModelCall({ quote: { ...quote(oldId), createdAt: oldTimestamp }, settlement: { id: oldId, projectId, state: 'failed' } }, caller)
  assert.equal((await view()).records.find(row => row.sourceId === oldId)!.affectsCurrentBudget, false)
  const oldQuote = { ...quote(oldId), createdAt: oldTimestamp }, oldFinal = { ...late, id: oldId }
  const oldCost = settledModelCallCost(oldQuote, oldFinal)!
  assert.notEqual(oldCost, null)
  await repo.reconcileModelCost({ ...await command(oldId), costUsd: oldCost }, lead)
  const confirmation = await repo.importHistoricalModelCall({ quote: oldQuote, settlement: oldFinal }, caller)
  assert.equal(confirmation.status, 'confirmed')
  assert.deepEqual(await repo.importHistoricalModelCall({ quote: oldQuote, settlement: oldFinal }, caller), confirmation)
  const oldRecord = (await view()).records.find(row => row.sourceId === oldId)!
  assert.equal(oldRecord.originalState, 'failed'); assert.equal(oldRecord.originalCostUsd, null)
  assert.equal(oldRecord.usageKnown, true); assert.equal(oldRecord.status, 'settled')
  assert.equal(oldRecord.events[1]!.kind, 'settlement_confirmation')
  // Race admission with a correction: either ordering must leave conservative accounting.
  await Promise.all([repo.reconcileModelCost({ ...await command(id), costUsd: 2 }, lead), repo.reserveModelCall(quote(randomUUID()), caller)])
  assert.equal((await repo.reserveModelCall(quote(randomUUID()), caller)).accepted, false)
  assert.equal((await view()).actualCostUsd, 2)
  console.log(JSON.stringify({ passed: true, concurrentReconciliation: true, appendOnlyOriginal: true, durableLateConflicts: true, matchingLateConfirmation: true, idempotentReceipts: true, roleAndIdentityChecks: true, scopedFinalRetry: true, monthlyBoundary: true, reserveReconcileRace: true }))
} finally { await db.close() }
