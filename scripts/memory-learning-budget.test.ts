// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createMemoryLearningBudget } from './memory-learning-budget'

it('persists bounded reservations and unknown failures across restart without treating them as free', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'devflow-memory-budget-'))
  try {
    const input = { path: path.join(root, 'budget.json'), projectId: 'p', maxCostUsd: 0.5, maxCalls: 2 }
    let budget = await createMemoryLearningBudget(input)
    const quote = { id: 'call-1', projectId: 'p', providerId: 'deepseek', model: 'deepseek-v4-flash', createdAt: '2026-10-04T00:00:00Z', inputTokens: 1000, maxOutputTokens: 4000, billingProvider: 'deepseek' as const }
    expect((await budget.reserve(quote)).accepted).toBe(true)
    await budget.persist({ id: 'call-1', projectId: 'p', state: 'failed' }, { final: false })
    budget = await createMemoryLearningBudget(input)
    expect((await budget.reserve({ ...quote, id: 'call-2' })).accepted).toBe(false)
    await budget.persist({ id: 'call-1', projectId: 'p', state: 'failed', usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheMissTokens: 100, cacheStatus: 'complete' } }, { final: true })
    await budget.settle((await budget.pending('p'))[0]!)
    expect((await budget.reserve({ ...quote, id: 'call-2', maxOutputTokens: null })).accepted).toBe(false)
    expect((await budget.reserve({ ...quote, id: 'call-2' })).accepted).toBe(true)
    expect((await budget.reserve({ ...quote, id: 'call-3' })).accepted).toBe(false)
    expect(budget.records()[0]!.costUsd).toBeGreaterThan(0)
  } finally { await rm(root, { recursive: true, force: true }) }
})
