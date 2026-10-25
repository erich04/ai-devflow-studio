// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { governedModelCall } from '../packages/shared/src/governed-provider'
import type { ModelCallQuote } from '../packages/shared/src/model-call-budget'
import { createCnyEvaluationRound, openInteractiveRound } from './native-coding-round-budget'
import { createEvaluationLedger } from './native-coding-live-support'

const roots: string[] = [], ledgers: Array<{ close(): void }> = []
const scopes = {
  'first/children': { projectId: 'interactive', providerId: 'deepseek-interactive', maxCalls: 20 },
  'trial/recovery': { projectId: 'evaluation-project', providerId: 'deepseek-evaluation', maxCalls: 2 },
  'retry/children': { projectId: 'interactive', providerId: 'deepseek-interactive', maxCalls: 2 },
}
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const ledger of ledgers.splice(0)) ledger.close()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 5 })))
})
async function round() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'native-cny-')); roots.push(parent)
  const root = path.join(parent, 'round')
  await createCnyEvaluationRound(root, { maxCostCny: 10, maxCalls: 200, maxOutputTokens: 65536, scopes })
  return root
}
const quote = (id: string, binding = scopes['first/children']): ModelCallQuote => ({ id, projectId: binding.projectId,
  providerId: binding.providerId, model: 'deepseek-flash', createdAt: new Date().toISOString(), inputTokens: 10,
  maxOutputTokens: 65536, billingProvider: 'deepseek', boundBasis: 'deepseek-context-v1' })
async function open(root: string, scope = 'first/children') {
  const ledger = await openInteractiveRound(root, scope); ledgers.push(ledger); return ledger
}

it('maps CNY 10 to 1.5 official-price ledger units and retains the full context bound', async () => {
  const ledger = await open(await round())
  expect(ledger.limits.maxCostUsd).toBe(1.5)
  expect(ledger.summary()).toMatchObject({ maxCostCny: 10, remainingCny: 10, accountedCny: 0 })
  for (const id of ['one', 'two', 'three']) expect((await ledger.reserve(quote(id))).accepted).toBe(true)
  expect(ledger.summary()).toMatchObject({ calls: 3, reservedUsd: 1.179648, reservedCny: 7.86432 })
  expect((await ledger.reserve(quote('four'))).accepted).toBe(false)
  expect(ledger.records()[0]!.boundUsd).toBe(0.393216)
})

it('shares interactive, coding, restart and retries without creating a private trial ledger', async () => {
  const root = await round(), interactive = await open(root)
  await interactive.reserve(quote('parent'))
  const trialFile = path.join(root, 'private-trial-ledger.json')
  const trial = await createEvaluationLedger({ file: trialFile, projectId: 'evaluation-project', maxCalls: 200, maxCostUsd: 100,
    roundRoot: root, scopeId: 'trial/recovery' }); ledgers.push(trial)
  await trial.reserve(quote('coding', scopes['trial/recovery']))
  interactive.close(); trial.close()
  const retry = await open(root, 'retry/children')
  expect(retry.summary()).toMatchObject({ calls: 2, unknownCosts: 2 })
  expect((await retry.reserve(quote('explicit-retry'))).accepted).toBe(true)
  expect((await retry.reserve(quote('another'))).accepted).toBe(false)
  expect(await readdir(root)).not.toContain(path.basename(trialFile))
})

it('refuses unknown scopes, wrong identity, scope call exhaustion and another ledger in guarded mode', async () => {
  const root = await round()
  await expect(open(root, 'unplanned/task')).rejects.toThrow(/scope/i)
  const trial = await open(root, 'trial/recovery')
  expect((await trial.reserve(quote('wrong-project'))).accepted).toBe(false)
  for (const id of ['one', 'two']) {
    await trial.reserve(quote(id, scopes['trial/recovery']))
    const settlement = { id, projectId: 'evaluation-project', state: 'not_sent' as const }
    await trial.persist(settlement, { final: true }); await trial.settle(settlement)
  }
  expect((await trial.reserve(quote('three', scopes['trial/recovery']))).accepted).toBe(false)
  vi.stubEnv('DEVFLOW_NATIVE_EVALUATION_ROUND', root)
  await expect(createEvaluationLedger({ file: path.join(root, 'bypass.json'), projectId: 'evaluation-project', maxCalls: 200, maxCostUsd: 100 })).rejects.toThrow(/scope/i)
  await expect(open(path.join(root, 'different'))).rejects.toThrow(/round/i)
})

it('blocks dispatch, not merely bookkeeping, when the last affordable reservations are used', async () => {
  const ledger = await open(await round()), action = vi.fn(async () => ({}))
  for (let i = 0; i < 4; i++) {
    const call = governedModelCall({ governance: ledger, projectId: 'interactive',
      provider: { id: 'deepseek-interactive', model: 'deepseek-flash', billingProvider: 'deepseek' },
      prompt: 'Small local fixture; input length is not a proven token bound.', maxOutputTokens: 65536,
      boundBasis: 'deepseek-context-v1', action })
    if (i < 3) await call; else await expect(call).rejects.toThrow()
  }
  expect(action).toHaveBeenCalledTimes(3)
})

it('releases only proven usage at the published CNY prices and expires without losing the ledger', async () => {
  const root = await round(), ledger = await open(root)
  const request = { ...quote('known'), createdAt: '2026-10-23T02:00:00.000Z' } // Friday peak, no exchange-rate approximation.
  await ledger.reserve(request)
  const settlement = { id: 'known', projectId: 'interactive', state: 'completed' as const,
    usage: { inputTokens: 100000, outputTokens: 10000, cacheReadTokens: 50000, cacheMissTokens: 50000, cacheStatus: 'complete' as const, usageCompleteness: 'final' as const } }
  await ledger.persist(settlement, { final: true }); await ledger.settle(settlement)
  expect(ledger.summary().knownCostCny).toBeCloseTo(0.182, 7)
  expect(ledger.summary().reservedCny).toBe(0)
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 86_400_001)
  try {
    expect((await ledger.reserve(quote('expired'))).accepted).toBe(false)
    expect(ledger.summary()).toMatchObject({ calls: 1, canStartCall: false })
  } finally { vi.restoreAllMocks() }
})

it('preserves unknowns after closure and refuses changed currency authorization', async () => {
  const root = await round(), ledger = await open(root)
  await ledger.reserve(quote('in-flight'))
  await ledger.seal()
  expect((await ledger.reserve(quote('later'))).accepted).toBe(false)
  ledger.close()
  const reopened = await open(root)
  expect(reopened.summary()).toMatchObject({ closed: true, unknownCosts: 1, reservedCny: 2.62144 })
  const file = path.join(root, 'round.json'), manifest = JSON.parse(await readFile(file, 'utf8'))
  await writeFile(file, JSON.stringify({ ...manifest, cny: { ...manifest.cny, maxCostCny: 11 } }))
  await expect(open(root)).rejects.toThrow()
})

it.each(['native-coding-batch-live.mjs', 'native-coding-deep-live.mts', 'native-coding-endpoint-live.mts', 'native-conversation-live.mjs'])('blocks the unused %s entry before reading credentials or creating an independent budget', async script => {
  const root = await round()
  await expect(promisify(execFile)(process.execPath, ['--import', 'tsx', `scripts/${script}`, 'absent-key', 'absent-output'], {
    env: { ...process.env, DEVFLOW_NATIVE_EVALUATION_ROUND: root }, timeout: 20000,
  })).rejects.toThrow(/guarded CNY round/)
  expect((await open(root)).summary().calls).toBe(0)
}, 30000)
