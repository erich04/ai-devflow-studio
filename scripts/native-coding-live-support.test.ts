// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createEvaluationLedger, evaluationUsage } from './native-coding-live-support'

it('persists unknown reservations, rejects duplicate attempts after restart, and does not invent usage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eval-ledger-'))
  try {
    const input = { file: path.join(root, 'ledger.json'), projectId: 'p', maxCalls: 2, maxCostUsd: 10 }
    const quote = { id: 'attempt-1', projectId: 'p', providerId: 'deepseek', model: 'deepseek-flash', createdAt: '2026-10-11T12:00:00.000Z', inputTokens: 1048576, maxOutputTokens: 8192, boundBasis: 'deepseek-context-v1' as const, billingProvider: 'deepseek' as const }
    const first = await createEvaluationLedger(input)
    expect((await first.reserve(quote)).accepted).toBe(true)
    const restarted = await createEvaluationLedger(input)
    expect((await restarted.reserve(quote)).accepted).toBe(false)
    expect(evaluationUsage(restarted.records())).toMatchObject({ costUsd: null, inputTokens: null, unknownCosts: 1 })
    const settlement = { id: quote.id, projectId: 'p', state: 'not_sent' as const }
    await restarted.persist(settlement, { final: true }); await restarted.settle(settlement)
    expect(evaluationUsage(restarted.records()).costUsd).toBe(0)
    await expect(restarted.persist({ ...settlement, state: 'completed' }, { final: true })).rejects.toThrow('immutable')
  } finally { await rm(root, { recursive: true, force: true }) }
})
