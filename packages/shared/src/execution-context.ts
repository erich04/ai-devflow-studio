import type { AgentRuntimeScope } from './agent-runtime'

/** A conservative, provider-independent working-context budget, in UTF-8 bytes. */
export const CODING_CONTEXT_MAX_BYTES = 12_000

export type ContextSource = {
  id: string
  title: string
  content: string
  summary: string
  priority: number
  /** Instructions and recalled Memory are indivisible; never truncate them. */
  required?: boolean
  /** A new optional reservation must not reduce this source below its existing representation. */
  preserveForReservation?: boolean
}

export type ContextCompactionReceipt = {
  stateVersion: 1
  strategy: 'extractive-v1'
  budgetBytes: number
  inputBytes: number
  outputBytes: number
  compacted: boolean
  sources: { id: string; representation: 'full' | 'summary' | 'omitted'; inputBytes: number; outputBytes: number }[]
}

/** Local-only, immutable provenance for the exact brief consumed by an executor. */
export type CodingContextReceipt = {
  stateVersion: 1
  runId: string
  nodeId: string
  runVersion: number
  runtimeId: string
  scope: AgentRuntimeScope
  promptDigest: string
  memories: { id: string; revision: number; headVersion: number; contentDigest: string }[]
  omittedMemoryCount: number
  compaction: ContextCompactionReceipt
  /**
   * Resident project instructions/standards remain background (ADR 0025 §5). Optional retrieved
   * knowledge is an exact source receipt and must be revalidated before execution/continuation.
   * Absent on older receipts.
   */
  knowledgeContext?: import('./domain').KnowledgeContextManifest
}

export function contextBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

// Extractive compaction never invents facts. Recognizable constraints are kept verbatim;
// when they alone exceed the budget, stop instead of silently losing them.
const constraintLine = /\b(must|shall|required|never|do not|cannot|acceptance|constraint|non.?goal|only|preserve|test command)\b|必须|不得|禁止|不能|不要|验收|约束|非目标|仅限|保留|测试命令/iu

function explicitConstraints(content: string, preserveBlocks: boolean): string[] {
  const lines = content.split('\n')
  if (!preserveBlocks) return [...new Set(lines.filter(line => constraintLine.test(line)))]
  const retained: string[] = []
  let inConstraintBlock = false
  for (const line of lines) {
    const heading = /^\s*#{1,6}\s/u.test(line)
    const constraint = constraintLine.test(line) || /\b(constraints|non.?goals)\b/iu.test(line)
    if (heading && !constraint) inConstraintBlock = false
    if (constraint) {
      retained.push(line)
      // Explicit Markdown constraint sections often put the actual requirements on
      // following list/paragraph lines. Keep that section through the next heading.
      if (heading || /[:：]\s*$/u.test(line)) inConstraintBlock = true
    } else if (inConstraintBlock) retained.push(line)
  }
  return retained
}

export function compactExecutionContext(input: {
  pinned: string
  sources: ContextSource[]
  maxBytes?: number
  /** Best-effort space for a separate optional section; protected content has priority. */
  reserveBytes?: number
}): { prompt: string; receipt: ContextCompactionReceipt } {
  const maxBytes = input.maxBytes ?? CODING_CONTEXT_MAX_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid Context budget')
  const reserveBytes = input.reserveBytes ?? 0
  if (!Number.isSafeInteger(reserveBytes) || reserveBytes < 0) throw new Error('Invalid Context reservation')
  const optionalBudget = maxBytes - Math.min(reserveBytes, maxBytes)
  const sources = [...input.sources].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    throw new Error('Duplicate Context source identity')
  }
  const full = (source: ContextSource) => `${source.title}\n${source.content}`
  const summary = (source: ContextSource, preserveBlocks = false) => {
    if (source.required) return full(source)
    const constraints = explicitConstraints(source.content, preserveBlocks)
    return `${source.title} [extractive summary; source=${source.id}; inspect the source for omitted detail]\n${[source.summary, ...constraints].filter(Boolean).join('\n')}`
  }
  const summaries = sources.map(source => summary(source))
  const fullPrompt = [input.pinned, ...sources.map(full)].join('\n\n')
  const inputBytes = contextBytes(fullPrompt)
  let texts = sources.map(full)
  if (inputBytes > optionalBudget) {
    const beforeReservation = reserveBytes ? compactExecutionContext({ ...input, reserveBytes: 0 }) : undefined
    // A reservation may trigger compaction even when the original prompt fits. Short full
    // sources can be smaller than their summary framing; keep those instead of expanding them.
    texts = reserveBytes === 0 ? [...summaries] : sources.map((source, index) => {
      if (source.preserveForReservation) {
        return beforeReservation!.receipt.sources[index]!.representation === 'full'
          ? full(source) : summaries[index]!
      }
      const condensed = summary(source, true)
      return contextBytes(condensed) < contextBytes(texts[index]!) ? condensed : texts[index]!
    })
    const protectedBytes = contextBytes([input.pinned, ...texts].join('\n\n'))
    if (protectedBytes > maxBytes) {
      // A best-effort optional section must not make a previously executable brief fail.
      if (beforeReservation) return beforeReservation
      throw new Error('Context budget cannot preserve the current request, Memory and explicit constraints; narrow the task before calling the Provider')
    }
    // Approved inputs, Memory, pinned text and extracted constraints may consume the reservation.
    // Only optional upgrades to full narrative are limited by the best-effort reserved space.
    const upgradeBudget = Math.max(optionalBudget, protectedBytes)
    for (let index = 0; index < sources.length; index += 1) {
      const candidate = [...texts]
      candidate[index] = full(sources[index]!)
      if (contextBytes([input.pinned, ...candidate].join('\n\n')) <= upgradeBudget) texts = candidate
    }
  }
  const prompt = [input.pinned, ...texts].join('\n\n')
  if (contextBytes(prompt) > maxBytes) throw new Error('Pinned Context exceeds the Provider input budget')
  return {
    prompt,
    receipt: {
      stateVersion: 1, strategy: 'extractive-v1', budgetBytes: maxBytes,
      inputBytes, outputBytes: contextBytes(prompt), compacted: prompt !== fullPrompt,
      sources: sources.map((source, index) => ({
        id: source.id, representation: texts[index] === full(source) ? 'full' : 'summary',
        inputBytes: contextBytes(full(source)), outputBytes: contextBytes(texts[index]!),
      })),
    },
  }
}
