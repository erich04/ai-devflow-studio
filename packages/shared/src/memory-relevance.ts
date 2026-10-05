/**
 * Deterministic lexical relevance for recalled Agent Memory (ADR 0024).
 *
 * Scores are BM25 over exact tokens. IDF is computed over the caller's recallable set,
 * so it measures how distinctive a term is among the memories in scope, not in language.
 * No embeddings, no provider calls: the same memories and query always rank the same way.
 */

/**
 * Largest statement any recall site can attach. The coding brief budget fits one such
 * item with its label; the smaller stage Agent and discussion budgets skip oversize items.
 */
export const AGENT_MEMORY_RECALLABLE_STATEMENT_MAX_BYTES = 3_800
/** Per-item reserve for the source title/label the caller wraps around each statement. */
export const AGENT_MEMORY_RECALL_LABEL_BYTES = 200

export type MemoryRecallBudget = { readonly maxItems: number; readonly maxBytes: number }

export const CODING_MEMORY_RECALL_BUDGET: MemoryRecallBudget = Object.freeze({ maxItems: 8, maxBytes: 4_000 })
export const STAGE_AGENT_MEMORY_RECALL_BUDGET: MemoryRecallBudget = Object.freeze({ maxItems: 6, maxBytes: 3_000 })
export const CONVERSATION_MEMORY_RECALL_BUDGET: MemoryRecallBudget = Object.freeze({ maxItems: 4, maxBytes: 2_000 })
const statementLimit = (budget: MemoryRecallBudget) => Math.min(AGENT_MEMORY_RECALLABLE_STATEMENT_MAX_BYTES, budget.maxBytes - AGENT_MEMORY_RECALL_LABEL_BYTES)
export const MEMORY_RECALL_STATEMENT_LIMITS = Object.freeze({
  coding: statementLimit(CODING_MEMORY_RECALL_BUDGET),
  stage: statementLimit(STAGE_AGENT_MEMORY_RECALL_BUDGET),
  conversation: statementLimit(CONVERSATION_MEMORY_RECALL_BUDGET),
})

const BM25_K1 = 1.2
const BM25_B = 0.75

// Generic English words that would otherwise make almost every memory "match" a request.
const ENGLISH_STOP_WORDS = new Set([
  'about', 'after', 'again', 'all', 'also', 'and', 'any', 'are', 'because', 'been', 'before',
  'being', 'but', 'can', 'could', 'did', 'does', 'doe', 'done', 'each', 'either', 'else',
  'ever', 'every', 'for', 'from', 'had', 'has', 'have', 'here', 'how', 'into', 'its', 'just',
  'like', 'make', 'many', 'may', 'might', 'more', 'most', 'must', 'new', 'not', 'now', 'off',
  'once', 'one', 'only', 'other', 'our', 'out', 'over', 'own', 'per', 'please', 'same',
  'shall', 'should', 'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'too', 'two', 'under', 'until', 'upon', 'use',
  'very', 'via', 'was', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'why',
  'will', 'with', 'within', 'without', 'would', 'yet', 'you', 'your',
])
// Chinese function characters; a bigram containing one carries little topical signal.
const HAN_STOP_CHARACTERS = new Set([...'的了是在和与或及把被对将就都也还而并等个这那其之以于为'])
// Common two-character words that appear in almost any requirement or instruction.
const HAN_STOP_BIGRAMS = new Set([
  '需要', '使用', '可以', '进行', '实现', '支持', '如果', '我们', '一个', '没有', '已经', '应该',
  '通过', '相关', '以及', '功能', '问题', '需求', '要求', '当前', '现在', '时候', '保持', '确保',
  '所有', '不要', '不能', '只有', '然后', '因为', '所以', '但是', '或者', '其他', '这些', '那些',
  '是否', '能够', '根据', '按照', '处理', '修改', '增加', '添加', '内容', '情况', '方式', '部分',
])
// Path and file-type segments shared by most repositories (`src/…`, `…/index.tsx`).
const STRUCTURAL_ASCII_TOKENS = new Set(['src', 'lib', 'dist', 'app', 'index', 'tsx', 'jsx', 'mjs', 'cjs'])

function stemAsciiWord(word: string): string {
  if (word.length > 4 && word.endsWith('sses')) return word.slice(0, -2)
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && /(?:x|z|ch|sh)es$/u.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !/(?:ss|us|is)$/u.test(word)) return word.slice(0, -1)
  return word
}

/**
 * Exact-match tokens: ASCII words split on camelCase and every non-alphanumeric character
 * (so paths such as `coding-context.ts` yield `coding` and `context`), lower-cased, with
 * stop words removed and a conservative plural fold; Han text yields overlapping bigrams.
 */
export function tokenizeMemoryText(text: string): string[] {
  const normalized = text.normalize('NFKC')
  const tokens: string[] = []
  const ascii = normalized.replace(/([a-z0-9])([A-Z])/gu, '$1 $2').toLowerCase()
  for (const match of ascii.matchAll(/[a-z0-9]+/gu)) {
    const word = match[0] ?? ''
    if (word.length < 3 || ENGLISH_STOP_WORDS.has(word) || STRUCTURAL_ASCII_TOKENS.has(word)) continue
    const stemmed = stemAsciiWord(word)
    if (!ENGLISH_STOP_WORDS.has(stemmed) && !STRUCTURAL_ASCII_TOKENS.has(stemmed)) tokens.push(stemmed)
  }
  for (const match of normalized.matchAll(/\p{Script=Han}+/gu)) {
    const run = [...(match[0] ?? '')]
    if (run.length === 1) {
      if (!HAN_STOP_CHARACTERS.has(run[0]!)) tokens.push(run[0]!)
      continue
    }
    for (let index = 0; index + 1 < run.length; index += 1) {
      const left = run[index]!
      const right = run[index + 1]!
      const bigram = left + right
      if (!HAN_STOP_CHARACTERS.has(left) && !HAN_STOP_CHARACTERS.has(right) && !HAN_STOP_BIGRAMS.has(bigram)) tokens.push(bigram)
    }
  }
  return tokens
}

export type RankedMemory<T> = {
  item: T
  score: number
  /** Distinct query tokens found in the item. */
  matchedTerms: number
}

/**
 * Ranks items by BM25 relevance to `query` and drops items below the minimum relevance:
 * at least `minMatchedTerms` distinct non-stop-word query tokens (default 1). Ties keep
 * the input order, so callers decide the tie-break (for example newest first).
 */
export function rankMemoryByRelevance<T>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => string,
  options: { minMatchedTerms?: number } = {},
): RankedMemory<T>[] {
  const minMatchedTerms = Math.max(1, options.minMatchedTerms ?? 1)
  const queryTerms = [...new Set(tokenizeMemoryText(query))]
  if (queryTerms.length === 0 || items.length === 0) return []
  const documents = items.map((item) => {
    const frequencies = new Map<string, number>()
    const tokens = tokenizeMemoryText(textOf(item))
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
    return { item, frequencies, length: tokens.length }
  })
  const averageLength = Math.max(1, documents.reduce((sum, document) => sum + document.length, 0) / documents.length)
  const inverseFrequency = new Map(queryTerms.map((term) => {
    const documentFrequency = documents.filter((document) => document.frequencies.has(term)).length
    return [term, Math.log(1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5))] as const
  }))
  const ranked: Array<RankedMemory<T> & { order: number }> = []
  documents.forEach((document, order) => {
    let score = 0
    let matchedTerms = 0
    for (const term of queryTerms) {
      const frequency = document.frequencies.get(term) ?? 0
      if (frequency === 0) continue
      matchedTerms += 1
      const lengthNorm = 1 - BM25_B + BM25_B * (document.length / averageLength)
      score += inverseFrequency.get(term)! * (frequency * (BM25_K1 + 1)) / (frequency + BM25_K1 * lengthNorm)
    }
    if (matchedTerms >= minMatchedTerms) ranked.push({ item: document.item, score, matchedTerms, order })
  })
  ranked.sort((left, right) => right.score - left.score || left.order - right.order)
  return ranked.map(({ item, score, matchedTerms }) => ({ item, score, matchedTerms }))
}

export function memoryStatementBytes(statement: string): number {
  return new TextEncoder().encode(statement).byteLength
}

/** Size eligibility only: scope, lifecycle, relevance and remaining budget still apply. */
export function memoryRecallAvailability(statement: string) {
  const bytes = memoryStatementBytes(statement)
  return { bytes, coding: bytes <= MEMORY_RECALL_STATEMENT_LIMITS.coding, stage: bytes <= MEMORY_RECALL_STATEMENT_LIMITS.stage, conversation: bytes <= MEMORY_RECALL_STATEMENT_LIMITS.conversation }
}

/**
 * Greedy selection in rank order under an item and byte budget. Oversized statements are
 * skipped, never truncated: Memory is indivisible (ADR 0021).
 */
export function selectMemoryWithinBudget<T>(
  ranked: readonly T[],
  statementOf: (item: T) => string,
  budget: MemoryRecallBudget,
): T[] {
  const selected: T[] = []
  let usedBytes = 0
  for (const item of ranked) {
    if (selected.length >= budget.maxItems) break
    const statementBytes = memoryStatementBytes(statementOf(item))
    if (statementBytes > AGENT_MEMORY_RECALLABLE_STATEMENT_MAX_BYTES) continue
    const size = statementBytes + AGENT_MEMORY_RECALL_LABEL_BYTES
    if (usedBytes + size > budget.maxBytes) continue
    selected.push(item)
    usedBytes += size
  }
  return selected
}
