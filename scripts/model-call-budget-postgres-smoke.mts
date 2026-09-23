import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createPostgresPoolClient } from '../apps/api/src/db/postgres-client'
import { createPostgresTeamRepository } from '../apps/api/src/repositories/postgres-team-repository'
import { projectedModelCallCost } from '../packages/shared/src/index'

const connectionString = process.env.DEVFLOW_DATABASE_URL
if (!connectionString || !/devflow_gate_qa$/.test(connectionString)) throw new Error('Use the isolated devflow_gate_qa database.')
const db = createPostgresPoolClient({ connectionString, applicationName: 'gate-budget-isolated-smoke', statementTimeoutMs: 5000 })
const context = { organizationId: 'org-demo', userId: 'u-erich' }
const projectId = `p-budget-${randomUUID()}`
try {
  await db.query(`INSERT INTO projects (id,organization_id,name,slug,description,repository,default_branch,health,knowledge_base_path,test_command)
    VALUES ($1,'org-demo','Isolated budget verification',$1,'test only','example/fixture','main','on_track','docs','npm test')`, [projectId])
  const repo = createPostgresTeamRepository(db)
  const now = new Date().toISOString()
  const quote = (id: string) => ({ id, projectId, providerId: 'deepseek', model: 'deepseek-flash', inputTokens: 1000, maxOutputTokens: 1000, billingProvider: 'deepseek' as const, createdAt: now })
  const cost = projectedModelCallCost(quote('estimate'))!
  await repo.saveRuntimeBudgetPolicy({ projectId, enabled: true, monthlyLimitUsd: cost * 1.5, warningThresholdUsd: cost, currency: 'USD', updatedAt: now }, context)
  const ids = [randomUUID(), randomUUID()]
  const decisions = await Promise.all(ids.map((id) => repo.reserveModelCall(quote(id), context)))
  assert.equal(decisions.filter((d) => d.accepted).length, 1, 'Concurrent requests over-reserved the budget')
  const id = ids[decisions.findIndex((d) => d.accepted)]!
  const settlement = { id, projectId, state: 'failed' as const, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheMissTokens: 100, cacheStatus: 'complete' as const } }
  await repo.persistModelCallSettlement(settlement, context)
  const restarted = createPostgresTeamRepository(db)
  const pending = await restarted.listPendingModelCallSettlements(projectId, context)
  assert.equal(pending.length, 1, 'Known usage was not durable before settlement')
  await restarted.settleModelCall(pending[0]!, context)
  assert.equal((await repo.listPendingModelCallSettlements(projectId, context)).length, 0)
  await repo.settleModelCall({ ...settlement, usage: { outputTokens: 20, inputTokens: 100, cacheMissTokens: 100, cacheReadTokens: 0, cacheStatus: 'complete' } }, context)
  await assert.rejects(repo.settleModelCall({ ...settlement, state: 'not_sent' }, context), /immutable/)
  const overview = await repo.getTeamOverview(context)
  assert.equal(overview.budgetProjectCost?.find((r) => r.key === projectId)?.totalTokens, 120)
  assert.equal(overview.projectCost.find((r) => r.key === projectId)?.totalTokens, 120)
  const unknownId = randomUUID()
  assert((await repo.reserveModelCall(quote(unknownId), context)).accepted)
  await repo.settleModelCall({ id: unknownId, projectId, state: 'cancelled' }, context)
  assert.equal((await repo.reserveModelCall(quote(randomUUID()), context)).accepted, false)
  await repo.saveRuntimeBudgetPolicy({ projectId, enabled: false, monthlyLimitUsd: 50, warningThresholdUsd: 40, currency: 'USD', updatedAt: now }, context)
  assert.equal((await repo.reserveModelCall(quote(randomUUID()), context)).decision.status, 'disabled')
  console.log(JSON.stringify({ passed: true, projectId, concurrentReservation: 'one admitted', durableSettlementRecovery: true, immutableSettlement: true, failedUsageRecorded: true, actualReportTokens: 120, unknownCostBlocked: true, freshDisabledPolicyApplied: true }))
} finally { await db.close() }
