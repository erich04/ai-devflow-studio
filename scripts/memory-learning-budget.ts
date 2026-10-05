import { readFile, rename, writeFile } from 'node:fs/promises'
import { parseModelCallQuote, parseModelCallSettlement, projectedModelCallCost, settledModelCallCost, type ModelCallGovernance, type ModelCallQuote, type ModelCallSettlement } from '../packages/shared/src/index.js'

type Record = { quote: ModelCallQuote; projectedCostUsd: number; costUsd: number | null; settlement?: ModelCallSettlement; final?: boolean; settled?: boolean }

/** Dedicated acceptance ledger, never a user's Team database. Unknown spend blocks dispatch. */
export async function createMemoryLearningBudget(input: { path: string; projectId: string; maxCostUsd: number; maxCalls: number }) {
  if (!Number.isFinite(input.maxCostUsd) || input.maxCostUsd <= 0 || !Number.isSafeInteger(input.maxCalls) || input.maxCalls < 1 || input.maxCalls > 32) throw new Error('Explicit bounded acceptance budget required')
  let records: Record[] = []
  try {
    const saved = JSON.parse(await readFile(input.path, 'utf8')) as { projectId: string; maxCostUsd: number; maxCalls: number; records: Record[] }
    if (saved.projectId !== input.projectId || saved.maxCostUsd !== input.maxCostUsd || saved.maxCalls !== input.maxCalls || !Array.isArray(saved.records)) throw new Error('Acceptance budget identity changed')
    records = saved.records.map((row) => ({ ...row, quote: parseModelCallQuote(row.quote), ...(row.settlement ? { settlement: parseModelCallSettlement(row.settlement) } : {}) }))
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  let queue = Promise.resolve()
  async function mutate<T>(action: () => T): Promise<T> {
    const operation = queue.then(async () => {
      const before = structuredClone(records)
      try {
        const result = action()
        await writeFile(`${input.path}.tmp`, JSON.stringify({ stateVersion: 1, projectId: input.projectId, maxCostUsd: input.maxCostUsd, maxCalls: input.maxCalls, records }, null, 2), { mode: 0o600 })
        await rename(`${input.path}.tmp`, input.path)
        return result
      } catch (error) { records = before; throw error }
    })
    queue = operation.then(() => undefined, () => undefined)
    return operation
  }
  const governance: ModelCallGovernance = {
    reserve: async (value) => mutate(() => {
      const quote = parseModelCallQuote(value)
      const projected = projectedModelCallCost(quote)
      const spend = records.reduce((sum, row) => sum + (row.costUsd ?? row.projectedCostUsd), 0)
      const accepted = quote.projectId === input.projectId && projected !== null && records.length < input.maxCalls &&
        !records.some((row) => row.quote.id === quote.id || row.costUsd === null) && spend + projected <= input.maxCostUsd
      if (accepted) records.push({ quote, projectedCostUsd: projected!, costUsd: null })
      return { accepted, decision: { status: accepted ? 'allowed' : 'unavailable', blocksRun: !accepted, currentSpendUsd: spend, projectedCostUsd: projected ?? 0, limitUsd: input.maxCostUsd,
        reason: accepted ? 'Within the explicit isolated acceptance budget.' : 'Acceptance budget unavailable, exhausted, unpriced or has an unsettled call.' } }
    }),
    persist: async (value, metadata) => mutate(() => {
      const settlement = parseModelCallSettlement(value)
      const row = records.find((record) => record.quote.id === settlement.id && record.quote.projectId === settlement.projectId)
      if (!row) throw new Error('Unknown acceptance call')
      if (row.final && JSON.stringify(row.settlement) !== JSON.stringify(settlement)) throw new Error('Final acceptance settlement is immutable')
      row.settlement = settlement; row.final = metadata?.final ?? true
    }),
    settle: async (value) => mutate(() => {
      const settlement = parseModelCallSettlement(value)
      const row = records.find((record) => record.quote.id === settlement.id && record.quote.projectId === settlement.projectId)
      if (!row || !row.final || JSON.stringify(row.settlement) !== JSON.stringify(settlement)) throw new Error('Acceptance settlement must be saved as final first')
      row.costUsd = settledModelCallCost(row.quote, settlement); row.settled = true
    }),
    pending: async (projectId) => records.flatMap((row) => row.quote.projectId === projectId && row.final && !row.settled && row.settlement ? [structuredClone(row.settlement)] : []),
  }
  return { ...governance, records: () => structuredClone(records) }
}
