// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifiedModelCallBound, type ModelCallQuote, type TeamSession } from '../packages/shared/src/index'
import { createPostgresPoolClient } from '../apps/api/src/db/postgres-client'
import { readTeamMigrationCatalog, runTeamMigrations } from '../apps/api/src/db/migrate'
import { seedDemoTeamData } from '../apps/api/src/db/seed-demo'
import { createPostgresTeamRepository } from '../apps/api/src/repositories/postgres-team-repository'
import type { TeamDbPoolClient } from '../apps/api/src/db/client'

const databaseUrl = process.env['DEVFLOW_BUDGET_TEST_DATABASE_URL']
const schema = `budget_${randomUUID().replaceAll('-', '')}`
const config = (connectionString: string) => ({ connectionString, applicationName: 'devflow-budget-integration', statementTimeoutMs: 15_000 })
const actor: TeamSession = { source: 'demo', organizationId: 'org-demo', userId: 'u-ling', role: 'lead', projectMemberships: [{ projectId: 'p-payments', userId: 'u-ling', role: 'lead' }] }

describe.skipIf(!databaseUrl)('per-call budget and continuation with real Postgres', () => {
  let admin: TeamDbPoolClient
  let db: TeamDbPoolClient
  let scopedUrl: string
  beforeAll(async () => {
    admin = createPostgresPoolClient(config(databaseUrl!))
    await admin.query(`CREATE SCHEMA ${schema}`)
    const url = new URL(databaseUrl!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    scopedUrl = url.toString()
    db = createPostgresPoolClient(config(scopedUrl))
    await runTeamMigrations(db, await readTeamMigrationCatalog())
    await seedDemoTeamData(db)
  }, 60_000)
  afterAll(async () => {
    await db?.close()
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
      await admin.close()
    }
  })

  it('serializes reservations and confirmation, survives restart, and settles late usage without fabricating history', async () => {
    let repo = createPostgresTeamRepository(db)
    const now = new Date().toISOString()
    const quote = (id: string): ModelCallQuote => ({ id, projectId: 'p-payments', providerId: 'deepseek', billingProvider: 'deepseek', model: 'deepseek-flash', inputTokens: 1000, maxOutputTokens: 65536, boundBasis: 'deepseek-context-v1', createdAt: now, operation: { id: 'budget-integration-operation', version: 'a'.repeat(64), purpose: 'conversation' } })
    const policy = (enabled: boolean, limit: number) => repo.saveRuntimeBudgetPolicy({ projectId: 'p-payments', enabled, monthlyLimitUsd: limit, warningThresholdUsd: 0, currency: 'USD', updatedAt: now }, actor)
    const overview = await repo.getTeamOverview(actor)
    const spend = (overview.budgetProjectCost ?? overview.projectCost).find(row => row.key === 'p-payments')?.costUsd ?? 0
    const bound = verifiedModelCallBound(quote('bound'))!
    await policy(true, spend + bound.costUsd * 1.5)
    const reservations = await Promise.all(['bounded-a', 'bounded-b'].map(id => repo.reserveModelCall(quote(id), actor)))
    expect(reservations.filter(row => row.accepted)).toHaveLength(1)

    await policy(false, 100)
    const { boundBasis: ignored, ...legacy } = quote('legacy-unknown')
    expect(ignored).toBe('deepseek-context-v1')
    expect((await repo.reserveModelCall(legacy, actor)).accepted).toBe(true)
    await repo.settleModelCall({ id: legacy.id, projectId: legacy.projectId, state: 'failed' }, actor)
    await policy(true, 100)
    const next = quote('after-confirmation')
    expect((await repo.reserveModelCall(next, actor)).accepted).toBe(false)
    const [card, sameCard] = await Promise.all([repo.prepareModelBudgetContinuation(next, actor), repo.prepareModelBudgetContinuation(next, actor)])
    expect(card).toEqual(sameCard)
    expect(card.records.some(row => row.sourceId === legacy.id)).toBe(true)
    expect((await repo.reserveModelCall({ ...next, continuationId: card.id }, actor)).accepted).toBe(false)
    const command = { id: card.id, projectId: card.projectId, expectedVersion: card.version }
    const confirmations = await Promise.all([repo.confirmModelBudgetContinuation(command, actor), repo.confirmModelBudgetContinuation(command, actor)])
    expect(confirmations[0]).toEqual(confirmations[1])

    await db.close()
    db = createPostgresPoolClient(config(scopedUrl))
    repo = createPostgresTeamRepository(db)
    expect(await repo.confirmModelBudgetContinuation(command, actor)).toEqual(confirmations[0])
    expect((await repo.reserveModelCall({ ...quote('wrong-operation'), continuationId: card.id, operation: { ...next.operation!, version: 'b'.repeat(64) } }, actor)).accepted).toBe(false)
    const calls = await Promise.all(Array.from({ length: card.maxCalls + 4 }, (_, index) => repo.reserveModelCall({ ...quote(`continuation-${index}`), continuationId: card.id }, actor)))
    expect(calls.filter(row => row.accepted)).toHaveLength(card.maxCalls)
    const unknown = (await repo.getTeamOverview(actor)).modelCostRecovery!.find(row => row.projectId === legacy.projectId)!.records.find(row => row.sourceId === legacy.id)!
    expect(unknown.costUsd).toBeNull()
    expect(unknown.usageKnown).toBe(false)
    expect(unknown.events).toEqual([])

    await repo.settleModelCall({ id: legacy.id, projectId: legacy.projectId, state: 'failed', usage: { inputTokens: 300, outputTokens: 100, cacheReadTokens: 0, cacheMissTokens: 300, cacheStatus: 'complete' } }, actor)
    const recovered = (await repo.getTeamOverview(actor)).modelCostRecovery!.find(row => row.projectId === legacy.projectId)!.records.find(row => row.sourceId === legacy.id)!
    expect(recovered.usageKnown).toBe(true)
    expect(recovered.costUsd).toBeGreaterThan(0)
    expect(recovered.events.some(event => event.kind === 'settlement_confirmation')).toBe(true)
    const rows = await db.query<{ json: { costUsd: number | null } }>('SELECT json FROM model_call_attempts WHERE id=$1', [legacy.id])
    expect(rows[0]!.json.costUsd).toBeNull()
    await expect(repo.confirmModelBudgetContinuation(command, actor)).rejects.toThrow(/费用记录已变化/)
  }, 120_000)
})
