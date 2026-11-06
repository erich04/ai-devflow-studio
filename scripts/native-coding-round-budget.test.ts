// @vitest-environment node
import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { verifiedModelCallBound, type ModelCallQuote, type ModelCallSettlement } from '../packages/shared/src/model-call-budget'
import { createInteractiveRound, openInteractiveRound } from './native-coding-round-budget'

const roots: string[] = []
const ledgers: Awaited<ReturnType<typeof openInteractiveRound>>[] = []
const workers: ChildProcess[] = []
const quote = (id: string): ModelCallQuote => ({ id, projectId: 'interactive', providerId: 'deepseek-interactive',
  model: 'deepseek-flash', billingProvider: 'deepseek', boundBasis: 'deepseek-context-v1',
  createdAt: '2026-10-16T12:00:00.000Z', inputTokens: 1048576, maxOutputTokens: 65536 })
const bound = verifiedModelCallBound(quote('example'))!.costUsd

afterEach(async () => {
  await Promise.all(workers.splice(0).map(child => new Promise<void>(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    child.once('close', () => resolve()); child.kill('SIGKILL')
  })))
  for (const ledger of ledgers.splice(0)) ledger.close()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 5 })))
})

async function round(maxCostUsd = 1, maxCalls = 10) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-round-budget-')); roots.push(root)
  const directory = path.join(root, 'round')
  await createInteractiveRound(directory, { maxCostUsd, maxCalls })
  return directory
}
async function open(root: string, scope = 'attempt-a/clarification') {
  const ledger = await openInteractiveRound(root, scope); ledgers.push(ledger); return ledger
}
async function finish(ledger: Awaited<ReturnType<typeof open>>, settlement: ModelCallSettlement) {
  await ledger.persist(settlement, { final: true }); await ledger.settle(settlement)
}
function worker(root: string, scope: string, hold = false) {
  const child = fork(fileURLToPath(new URL('./fixtures/native-coding-round-budget-worker.mts', import.meta.url)), [root, scope, hold ? 'hold' : ''],
    { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  workers.push(child)
  const events: Array<Record<string, unknown>> = []
  let output = ''
  child.stdout?.on('data', chunk => { output += chunk })
  child.stderr?.on('data', chunk => { output += chunk })
  child.on('message', message => events.push(message as Record<string, unknown>))
  const event = (name: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const previous = events.find(value => value.event === name)
    if (previous) return resolve(previous)
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Worker timeout ${name}: ${output}`)) }, 20000)
    const onMessage = (message: Record<string, unknown>) => { if (message.event === name) { cleanup(); resolve(message) } }
    const onClose = () => { cleanup(); reject(new Error(`Worker exited before ${name}: ${output}`)) }
    const cleanup = () => { clearTimeout(timer); child.off('message', onMessage); child.off('close', onClose) }
    child.on('message', onMessage); child.once('close', onClose)
  })
  return { child, event }
}

it('arbitrates the last affordable reservation across independent processes before calling the provider', async () => {
  const root = await round(bound * 1.5)
  const a = worker(root, 'first/children'), b = worker(root, 'retry/unknown')
  await Promise.all([a.event('ready'), b.event('ready')])
  const results = Promise.all([a.event('result'), b.event('result')])
  a.child.send('go'); b.child.send('go')
  expect((await results).sort((x, y) => Number(x.accepted) - Number(y.accepted))).toEqual([
    { event: 'result', accepted: false, providerCalls: 0 },
    { event: 'result', accepted: true, providerCalls: 1 },
  ])
  expect((await open(root)).summary()).toMatchObject({ calls: 1, unknownCosts: 1, knownCostUsd: 0, reservedUsd: bound, accountedUsd: bound })
}, 30000)

it('also arbitrates the last call when money remains', async () => {
  const root = await round(10, 1), a = worker(root, 'first/children'), b = worker(root, 'retry/children')
  await Promise.all([a.event('ready'), b.event('ready')])
  const results = Promise.all([a.event('result'), b.event('result')])
  a.child.send('go'); b.child.send('go')
  expect((await results).filter(row => row.accepted)).toHaveLength(1)
  expect((await open(root)).summary()).toMatchObject({ calls: 1, remainingCalls: 0, canStartCall: false })
}, 30000)

it('retains a killed worker reservation across restart and a fresh attempt scope', async () => {
  const root = await round(bound * 1.5), child = worker(root, 'first/unknown', true)
  await child.event('ready'); const dispatched = child.event('dispatched'); child.child.send('go'); await dispatched
  await new Promise<void>(resolve => { child.child.once('close', () => resolve()); child.child.kill('SIGKILL') })
  expect(child.child.signalCode).toBe('SIGKILL')
  const restarted = await open(root, 'second/unknown')
  expect((await restarted.reserve(quote('retry'))).accepted).toBe(false)
  expect(restarted.summary()).toMatchObject({ calls: 1, unknownCosts: 1, reservedUsd: bound })
  expect(restarted.records()).toHaveLength(0)
  expect(restarted.records('first/unknown')).toHaveLength(1)
}, 30000)

it('releases only confirmed cost and never refunds the call count', async () => {
  const root = await round(bound, 2), ledger = await open(root)
  expect((await ledger.reserve(quote('one'))).accepted).toBe(true)
  await finish(ledger, { id: 'one', projectId: 'interactive', state: 'not_sent' })
  expect(ledger.summary()).toMatchObject({ calls: 1, knownCostUsd: 0, reservedUsd: 0, unknownCosts: 0 })
  expect((await ledger.reserve(quote('two'))).accepted).toBe(true)
  await finish(ledger, { id: 'two', projectId: 'interactive', state: 'completed', usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheMissTokens: 100, cacheStatus: 'complete', usageCompleteness: 'final' } })
  expect(ledger.summary().knownCostUsd).toBeGreaterThan(0)
  expect(ledger.summary().accountedUsd).toBeLessThan(bound)
  expect((await ledger.reserve(quote('three'))).accepted).toBe(false)
  expect((await ledger.reserve(quote('one'))).accepted).toBe(false)
})

it.each(['cancelled', 'failed'] as const)('keeps %s and partial usage reserved after reopen', async state => {
  const root = await round(bound * 1.5), ledger = await open(root)
  await ledger.reserve(quote('one'))
  await finish(ledger, { id: 'one', projectId: 'interactive', state, usage: { inputTokens: 10, outputTokens: 2, usageCompleteness: 'partial' } })
  ledger.close()
  const next = await open(root, 'retry/clarification')
  expect(next.summary()).toMatchObject({ costUsd: null, calls: 1, reservedUsd: bound, knownCostUsd: 0, unknownCosts: 1 })
  expect((await next.reserve(quote('two'))).accepted).toBe(false)
})

it('keeps final settlements immutable and scoped to their original scenario', async () => {
  const root = await round(), a = await open(root, 'r1/children'), b = await open(root, 'r1/unknown')
  await a.reserve(quote('one'))
  const settled: ModelCallSettlement = { id: 'one', projectId: 'interactive', state: 'not_sent' }
  await expect(b.persist(settled, { final: true })).rejects.toThrow(/Unknown/)
  await a.persist(settled, { final: true })
  await a.persist(settled, { final: false }) // A duplicate cannot un-finalize a durable result.
  await a.settle(settled)
  await a.settle(settled)
  await expect(a.persist({ ...settled, state: 'cancelled' }, { final: true })).rejects.toThrow(/immutable/)
  expect(b.records()).toHaveLength(0)
  expect(b.summary()).toMatchObject({ calls: 1, costUsd: 0 })
})

it('recovers final accounting without another provider request or a new budget', async () => {
  const root = await round(), a = await open(root)
  await a.reserve(quote('one'))
  const settlement: ModelCallSettlement = { id: 'one', projectId: 'interactive', state: 'not_sent' }
  await a.persist(settlement, { final: true }); a.close()
  const b = await open(root)
  expect(await b.pending('interactive')).toEqual([settlement])
  await b.settle(settlement)
  expect(b.summary()).toMatchObject({ calls: 1, unknownCosts: 0, reservedUsd: 0 })
})

it.each([0, -1, NaN, Infinity])('refuses an invalid explicit dollar limit (%s)', async maxCostUsd => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'invalid-round-')); roots.push(root)
  await expect(createInteractiveRound(path.join(root, 'round'), { maxCostUsd, maxCalls: 2 })).rejects.toThrow(/limit/i)
})

it('refuses changing either frozen limit, missing ledgers, and creating an existing round', async () => {
  const root = await round(), manifestPath = path.join(root, 'round.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  for (const change of [{ maxCostUsd: 2 }, { maxCostUsd: 0.5 }, { maxCalls: 11 }, { maxCalls: 9 }, { roundId: 'changed' }]) {
    await writeFile(manifestPath, JSON.stringify({ ...manifest, ...change }))
    await expect(openInteractiveRound(root, 'retry/children')).rejects.toThrow(/identity/)
  }
  await writeFile(manifestPath, JSON.stringify(manifest))
  const restored = await open(root)
  expect(restored.summary()).toMatchObject({ maxCostUsd: 1, maxCalls: 10 })
  restored.close()
  await expect(createInteractiveRound(root, { maxCostUsd: 2, maxCalls: 20 })).rejects.toThrow()
  await rm(path.join(root, 'budget.sqlite'))
  await expect(openInteractiveRound(root, 'retry/children')).rejects.toThrow()
})

it('rejects quotes without a verified bound or with another provider, model or project', async () => {
  const ledger = await open(await round())
  for (const change of [{ boundBasis: undefined }, { providerId: 'other' }, { projectId: 'other' }, { model: 'deepseek-pro' }, { maxOutputTokens: 65537 }]) {
    expect((await ledger.reserve({ ...quote('one'), ...change })).accepted).toBe(false)
  }
  expect(ledger.summary().calls).toBe(0)
})
