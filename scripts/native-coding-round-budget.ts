/** Explicit, local-only acceptance budget. Never imported by the desktop application. */
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseModelCallQuote, parseModelCallSettlement, settledModelCallCost, verifiedModelCallBound,
  type ModelCallQuote, type ModelCallSettlement } from '../packages/shared/src/model-call-budget.ts'
import type { ModelCallGovernance } from '../packages/shared/src/governed-provider.ts'
import { resolveDeepSeekPricingSnapshot } from '../packages/shared/src/cost.ts'
import { evaluationUsage } from './native-coding-live-support.ts'

const SCALE = 1_000_000_000
const CNY_RATIO = 0.15 // Ratio of the two published token-price tables, NOT a currency exchange rate.
export type EvaluationScope = { projectId: string; providerId: string; maxCalls: number }
type CnyAuthorization = { maxCostCny: number; ratio: 0.15; priceSource: string; expiresAt: string; scopes: Record<string, EvaluationScope> }
type Round = {
  schemaVersion: 1; roundId: string; createdAt: string; projectId: 'interactive';
  providerId: 'deepseek-interactive'; model: 'deepseek-flash'; maxOutputTokens: number;
  priceVersion: string; maxCalls: number; maxCostUsd: number;
  cny?: CnyAuthorization;
}
type Row = { scopeId: string; quote: ModelCallQuote; boundUsd: number; costUsd: number | null;
  settlement?: ModelCallSettlement; final?: boolean; settled?: boolean }

function checkLimits(input: { maxCalls: number; maxCostUsd: number }) {
  if (!Number.isSafeInteger(input.maxCalls) || input.maxCalls < 1 || input.maxCalls > 10000 ||
      !Number.isFinite(input.maxCostUsd) || input.maxCostUsd <= 0 || input.maxCostUsd > 10000 ||
      Math.floor(input.maxCostUsd * SCALE) < 1) throw new Error('Explicit positive round limits are required (at most 10000 calls / USD)')
}
function parseRound(value: unknown): Round {
  const v = value as Round
  if (!v || v.schemaVersion !== 1 || typeof v.roundId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(v.roundId) ||
      typeof v.createdAt !== 'string' || !Number.isFinite(Date.parse(v.createdAt)) ||
      v.projectId !== 'interactive' || v.providerId !== 'deepseek-interactive' || v.model !== 'deepseek-flash' ||
      !Number.isSafeInteger(v.maxOutputTokens) || v.maxOutputTokens < 1 || v.maxOutputTokens > 65536 ||
      (!v.cny && v.maxOutputTokens !== 65536) || typeof v.priceVersion !== 'string' || !v.priceVersion) throw new Error('Invalid round budget identity')
  checkLimits(v)
  if (v.cny) {
    const c = v.cny
    if (!Number.isFinite(c.maxCostCny) || c.maxCostCny <= 0 || c.maxCostCny > 10 || c.ratio !== CNY_RATIO ||
        v.maxCostUsd !== c.maxCostCny * CNY_RATIO || c.priceSource !== 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/' ||
        !Number.isFinite(Date.parse(c.expiresAt)) || !c.scopes || typeof c.scopes !== 'object' || Array.isArray(c.scopes) || !Object.keys(c.scopes).length) throw new Error('Invalid CNY authorization')
    for (const [scope, policy] of Object.entries(c.scopes)) {
      validScope(scope)
      if (!policy || !/^[a-zA-Z0-9_-]{1,100}$/.test(policy.projectId) ||
          !['deepseek-interactive', 'deepseek-evaluation'].includes(policy.providerId) ||
          !Number.isSafeInteger(policy.maxCalls) || policy.maxCalls < 0 || policy.maxCalls > v.maxCalls) throw new Error('Invalid frozen scope policy')
    }
  }
  return { schemaVersion: 1, roundId: v.roundId, createdAt: v.createdAt, projectId: v.projectId,
    providerId: v.providerId, model: v.model, maxOutputTokens: v.maxOutputTokens,
    priceVersion: v.priceVersion, maxCalls: v.maxCalls, maxCostUsd: v.maxCostUsd,
    ...(v.cny ? { cny: structuredClone(v.cny) } : {}) }
}
function quoteFor(round: Omit<Round, 'priceVersion'>): ModelCallQuote {
  return { id: 'round-bound', projectId: round.projectId, providerId: round.providerId, model: round.model,
    createdAt: round.createdAt, inputTokens: 1048576, maxOutputTokens: round.maxOutputTokens,
    billingProvider: 'deepseek', boundBasis: 'deepseek-context-v1' }
}
function units(value: number) {
  const result = Math.ceil(value * SCALE)
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid round accounting value')
  return result
}
const cny = (usd: number) => Math.ceil(units(usd) * 20 / 3) / SCALE
function checkPrice(round: Round) {
  if (verifiedModelCallBound(quoteFor(round))?.priceVersion !== round.priceVersion) throw new Error('Round budget price identity changed')
  if (!round.cny) return
  const price = resolveDeepSeekPricingSnapshot({ providerId: round.providerId, model: round.model, timestamp: round.createdAt, worstCase: true })
  if (!price || price.cacheHitInputUsdPerMillion !== 0.006 || price.cacheMissInputUsdPerMillion !== 0.3 || price.outputUsdPerMillion !== 1.2) throw new Error('CNY and USD official price tables no longer match the frozen ratio')
}
function validScope(scope: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}\/[a-zA-Z0-9_-]{1,100}$/.test(scope)) throw new Error('Expected attempt/scenario budget scope')
  return scope
}

/** Creating a new round is explicit; ordinary runs can only reopen an existing budget. */
export async function createInteractiveRound(root: string, input: { maxCalls: number; maxCostUsd: number }) {
  if (process.env.DEVFLOW_NATIVE_EVALUATION_ROUND) throw new Error('A guarded evaluation cannot initialize another round')
  return createRound(root, input)
}
export async function createCnyEvaluationRound(root: string, input: { maxCostCny: number; maxCalls: number; maxOutputTokens: number; scopes: Record<string, EvaluationScope> }) {
  if (process.env.DEVFLOW_NATIVE_EVALUATION_ROUND) throw new Error('A guarded evaluation cannot initialize another round')
  return createRound(root, { maxCalls: input.maxCalls, maxCostUsd: input.maxCostCny * CNY_RATIO }, input)
}
async function createRound(root: string, input: { maxCalls: number; maxCostUsd: number }, authorization?: { maxCostCny: number; maxOutputTokens: number; scopes: Record<string, EvaluationScope> }) {
  checkLimits(input)
  const draft = { schemaVersion: 1 as const, roundId: randomUUID(), createdAt: new Date().toISOString(),
    projectId: 'interactive' as const, providerId: 'deepseek-interactive' as const, model: 'deepseek-flash' as const,
    maxOutputTokens: authorization?.maxOutputTokens ?? 65536, maxCalls: input.maxCalls, maxCostUsd: input.maxCostUsd,
    ...(authorization ? { cny: { maxCostCny: authorization.maxCostCny, ratio: CNY_RATIO as 0.15,
      priceSource: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', expiresAt: new Date(Date.now() + 86_400_000).toISOString(), scopes: authorization.scopes } } : {}) }
  const bound = verifiedModelCallBound(quoteFor(draft))
  if (!bound) throw new Error('No verified price bound for this round')
  const round = parseRound({ ...draft, priceVersion: bound.priceVersion })
  checkPrice(round)
  await mkdir(path.dirname(path.resolve(root)), { recursive: true })
  await mkdir(root, { mode: 0o700 }) // Never reset an existing round, including one that failed during initialization.
  const file = path.join(root, 'budget.sqlite')
  await (await open(file, 'wx', 0o600)).close()
  const db = new DatabaseSync(file, { timeout: 5000 })
  try {
    db.exec('PRAGMA synchronous = FULL; BEGIN IMMEDIATE; CREATE TABLE identity (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL); CREATE TABLE calls (id TEXT PRIMARY KEY, scope TEXT NOT NULL, value TEXT NOT NULL);')
    if (round.cny) db.exec('CREATE TABLE control (id INTEGER PRIMARY KEY CHECK (id = 1), closed INTEGER NOT NULL); INSERT INTO control VALUES (1, 0);')
    db.prepare('INSERT INTO identity VALUES (1, ?)').run(JSON.stringify(round))
    db.exec('COMMIT')
  } finally { db.close() }
  await writeFile(path.join(root, 'round.json'), JSON.stringify(round, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return round
}

export async function openInteractiveRound(root: string, scopeId: string) {
  if (process.env.DEVFLOW_NATIVE_EVALUATION_ROUND && path.resolve(root) !== path.resolve(process.env.DEVFLOW_NATIVE_EVALUATION_ROUND)) throw new Error('A guarded evaluation must use its one authorized round')
  validScope(scopeId)
  const round = Object.freeze(parseRound(JSON.parse(await readFile(path.join(root, 'round.json'), 'utf8'))))
  if (round.cny && !Object.hasOwn(round.cny.scopes, scopeId)) throw new Error('Scope is not in the frozen CNY evaluation')
  const file = path.join(root, 'budget.sqlite')
  // DatabaseSync creates absent files by default. A deleted budget must never become a fresh budget.
  await (await open(file, 'r+')).close()
  const db = new DatabaseSync(file, { timeout: 5000 })
  try {
    db.exec('PRAGMA synchronous = FULL')
    const saved = db.prepare('SELECT value FROM identity WHERE id = 1').get()
    if (!saved || JSON.stringify(parseRound(JSON.parse(String(saved.value)))) !== JSON.stringify(round)) throw new Error('Round budget identity changed')
    checkPrice(round)
  } catch (error) { db.close(); throw error }

  const all = (): Row[] => db.prepare('SELECT value FROM calls ORDER BY rowid').all().map(row => JSON.parse(String(row.value)) as Row)
  const records = (scope = scopeId) => all().filter(row => row.scopeId === validScope(scope))
  const update = (row: Row) => db.prepare('UPDATE calls SET value = ? WHERE id = ? AND scope = ?').run(JSON.stringify(row), row.quote.id, scopeId)
  const transaction = <T>(action: () => T): T => {
    db.exec('BEGIN IMMEDIATE')
    try { const result = action(); db.exec('COMMIT'); return result }
    catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error }
  }
  const closed = () => round.cny ? db.prepare('SELECT closed FROM control WHERE id = 1').get()?.closed !== 0 : false
  const usage = (rows: Row[]) => {
    const known = rows.reduce((total, row) => total + (row.costUsd === null ? 0 : units(row.costUsd)), 0)
    const reserved = rows.reduce((total, row) => total + (row.costUsd === null ? units(row.boundUsd) : 0), 0)
    return { ...evaluationUsage(rows), calls: rows.length, knownCostUsd: known / SCALE,
      reservedUsd: reserved / SCALE, accountedUsd: (known + reserved) / SCALE,
      ...(round.cny ? { knownCostCny: cny(known / SCALE), reservedCny: cny(reserved / SCALE), accountedCny: cny((known + reserved) / SCALE) } : {}) }
  }
  const governance: ModelCallGovernance = {
    reserve: async (value, signal) => transaction(() => {
      signal?.throwIfAborted()
      checkPrice(round)
      const quote = parseModelCallQuote(value), bound = verifiedModelCallBound(quote), rows = all()
      const spent = rows.reduce((total, row) => total + units(row.costUsd ?? row.boundUsd), 0)
      const policy = round.cny?.scopes[scopeId] ?? { projectId: round.projectId, providerId: round.providerId, maxCalls: round.maxCalls }
      const accepted = !closed() && (!round.cny || Date.now() < Date.parse(round.cny.expiresAt)) &&
        records().length < policy.maxCalls && quote.projectId === policy.projectId && quote.providerId === policy.providerId && quote.model === round.model &&
        quote.maxOutputTokens !== null && quote.maxOutputTokens <= round.maxOutputTokens && bound !== null && bound.priceVersion === round.priceVersion &&
        rows.length < round.maxCalls && spent + units(bound.costUsd) <= Math.floor(round.maxCostUsd * SCALE) && !rows.some(row => row.quote.id === quote.id)
      if (accepted) {
        const row: Row = { scopeId, quote, boundUsd: units(bound!.costUsd) / SCALE, costUsd: null }
        db.prepare('INSERT INTO calls VALUES (?, ?, ?)').run(quote.id, scopeId, JSON.stringify(row))
      }
      return { accepted, decision: { status: accepted ? 'allowed' : 'unavailable', blocksRun: !accepted,
        currentSpendUsd: spent / SCALE, projectedCostUsd: bound?.costUsd ?? 0, limitUsd: round.maxCostUsd,
        reason: accepted ? 'Within the frozen shared round budget.' : 'Shared round budget exhausted, duplicate attempt, or unverified request bound; unknown calls retain their reservation.' } }
    }),
    persist: async (value, metadata) => transaction(() => {
      const settlement = parseModelCallSettlement(value)
      const row = records().find(row => row.quote.id === settlement.id && row.quote.projectId === settlement.projectId)
      if (!row) throw new Error('Unknown round attempt in this scenario')
      if (row.final) {
        if (JSON.stringify(row.settlement) !== JSON.stringify(settlement)) throw new Error('Final round settlement is immutable')
        return // Duplicate checkpoints cannot turn a final settlement back into a provisional one.
      }
      row.settlement = settlement; row.final = metadata?.final === true; update(row)
    }),
    settle: async value => transaction(() => {
      const settlement = parseModelCallSettlement(value)
      const row = records().find(row => row.quote.id === settlement.id && row.quote.projectId === settlement.projectId)
      if (!row || !row.final || JSON.stringify(row.settlement) !== JSON.stringify(settlement)) throw new Error('Settlement must first be persisted as final in its own scenario')
      const cost = settledModelCallCost(row.quote, settlement)
      row.costUsd = cost === null ? null : units(cost) / SCALE; row.settled = true; update(row)
      if (round.cny && cost !== null && cost > row.boundUsd) db.prepare('UPDATE control SET closed = 1 WHERE id = 1').run()
    }),
    pending: async projectId => records().flatMap(row => row.quote.projectId === projectId && row.final && !row.settled && row.settlement ? [row.settlement] : []),
  }
  return { ...governance, limits: round, records,
    scopeUsage: (scope = scopeId) => usage(records(scope)),
    summary: () => {
      const rows = all(), total = usage(rows)
      const remainingUsd = Math.max(0, (Math.floor(round.maxCostUsd * SCALE) - rows.reduce((sum, row) => sum + units(row.costUsd ?? row.boundUsd), 0)) / SCALE)
      return { ...total, roundId: round.roundId, maxCalls: round.maxCalls, maxCostUsd: round.maxCostUsd, closed: closed(),
        ...(round.cny ? { maxCostCny: round.cny.maxCostCny, remainingCny: Math.max(0, round.cny.maxCostCny - cny(total.accountedUsd)) } : {}),
        remainingCalls: Math.max(0, round.maxCalls - rows.length), remainingUsd,
        canStartCall: !closed() && (!round.cny || Date.now() < Date.parse(round.cny.expiresAt)) && rows.length < round.maxCalls && units(verifiedModelCallBound(quoteFor(round))!.costUsd) <= Math.floor(remainingUsd * SCALE),
        scopes: Object.fromEntries([...new Set(rows.map(row => row.scopeId))].map(scope => [scope, usage(rows.filter(row => row.scopeId === scope))])) }
    },
    seal: async () => { if (!round.cny) throw new Error('Only a CNY evaluation has an explicit closure'); transaction(() => db.prepare('UPDATE control SET closed = 1 WHERE id = 1').run()) },
    close: () => { if (db.isOpen) db.close() },
  }
}
