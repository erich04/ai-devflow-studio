/** Explicitly invoked live acceptance utilities. Never loaded by the application. */
import { createHash } from 'node:crypto'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parseModelCallQuote, parseModelCallSettlement, verifiedModelCallBound, projectedModelCallCost, settledModelCallCost, type ModelCallGovernance, type ModelCallQuote, type ModelCallSettlement } from '../packages/shared/src/index.ts'

export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export async function saveJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(`${file}.tmp`, file)
}
type LedgerRow = { quote: ModelCallQuote; boundUsd: number; settlement?: ModelCallSettlement; final?: boolean; settled?: boolean; costUsd: number | null }
/** Same governed Provider/relay protocol as Main, with an isolated durable admission ledger. */
export async function createEvaluationLedger(input: { file: string; projectId: string; maxCalls: number; maxCostUsd: number; roundRoot?: string; scopeId?: string }) {
  const root = input.roundRoot ?? process.env.DEVFLOW_NATIVE_EVALUATION_ROUND
  if (root || input.scopeId) {
    if (!root || !input.scopeId) throw new Error('A shared evaluation requires its frozen round and scope; no private ledger fallback')
    const { openInteractiveRound } = await import('./native-coding-round-budget.ts')
    const ledger = await openInteractiveRound(root, input.scopeId)
    const policy = ledger.limits.cny?.scopes[input.scopeId]
    if (!policy || policy.projectId !== input.projectId) { ledger.close(); throw new Error('Evaluation scope project differs from its authorization') }
    return ledger
  }
  let rows: LedgerRow[] = []
  try {
    const saved = JSON.parse(await readFile(input.file, 'utf8'))
    if (saved.projectId !== input.projectId || saved.maxCalls !== input.maxCalls || saved.maxCostUsd !== input.maxCostUsd) throw new Error('Evaluation ledger identity changed')
    rows = saved.rows
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  let queue = Promise.resolve()
  const mutate = <T>(action: () => T): Promise<T> => {
    const next = queue.then(async () => {
      const before = structuredClone(rows)
      try { const result = action(); await saveJson(input.file, { schemaVersion: 1, ...input, file: undefined, rows }); return result }
      catch (error) { rows = before; throw error }
    })
    queue = next.then(() => undefined, () => undefined)
    return next
  }
  const governance: ModelCallGovernance = {
    reserve: async value => mutate(() => {
      const quote = parseModelCallQuote(value)
      const bound = verifiedModelCallBound(quote)?.costUsd ?? projectedModelCallCost(quote)
      const spent = rows.reduce((sum, row) => sum + (row.costUsd ?? row.boundUsd), 0)
      const accepted = quote.projectId === input.projectId && bound !== null && rows.length < input.maxCalls && spent + bound <= input.maxCostUsd && !rows.some(row => row.quote.id === quote.id)
      if (accepted) rows.push({ quote, boundUsd: bound!, costUsd: null })
      return { accepted, decision: { status: accepted ? 'allowed' : 'unavailable', blocksRun: !accepted, currentSpendUsd: spent, projectedCostUsd: bound ?? 0, limitUsd: input.maxCostUsd, reason: 'Frozen isolated evaluation limits; unknown calls retain the full request reservation.' } }
    }),
    persist: async (value, meta) => mutate(() => {
      const settlement = parseModelCallSettlement(value), row = rows.find(row => row.quote.id === settlement.id && row.quote.projectId === settlement.projectId)
      if (!row) throw new Error('Unknown evaluation attempt')
      if (row.final && JSON.stringify(row.settlement) !== JSON.stringify(settlement)) throw new Error('Final evaluation settlement is immutable')
      row.settlement = settlement; row.final = meta?.final === true
    }),
    settle: async value => mutate(() => {
      const settlement = parseModelCallSettlement(value), row = rows.find(row => row.quote.id === settlement.id && row.quote.projectId === settlement.projectId)
      if (!row || !row.final || JSON.stringify(row.settlement) !== JSON.stringify(settlement)) throw new Error('Settlement must first be persisted as final')
      row.costUsd = settledModelCallCost(row.quote, settlement); row.settled = true
    }),
    pending: async projectId => rows.flatMap(row => row.quote.projectId === projectId && row.final && !row.settled && row.settlement ? [structuredClone(row.settlement)] : []),
  }
  return { ...governance, records: () => structuredClone(rows), close: () => {} }
}

export function evaluationUsage(rows: LedgerRow[]) {
  const sum = (key: 'inputTokens' | 'outputTokens') => rows.every(row => row.settlement?.usage?.[key] !== undefined) ? rows.reduce((sum, row) => sum + row.settlement!.usage![key]!, 0) : null
  return { costUsd: rows.every(row => row.costUsd !== null) ? rows.reduce((sum, row) => sum + row.costUsd!, 0) : null,
    knownCostUsd: rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0), unknownCosts: rows.filter(row => row.costUsd === null).length,
    inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), peakContextTokens: rows.length && rows.every(row => row.settlement?.usage?.inputTokens !== undefined) ? Math.max(...rows.map(row => row.settlement!.usage!.inputTokens!)) : null }
}
