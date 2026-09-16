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
}

export function contextBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

// Extractive compaction never invents facts. Recognizable constraints are kept verbatim;
// when they alone exceed the budget, stop instead of silently losing them.
const constraintLine = /\b(must|shall|required|never|do not|cannot|acceptance|constraint|non.?goal|only|preserve|test command)\b|必须|不得|禁止|不能|不要|验收|约束|非目标|仅限|保留|测试命令/iu

export function compactExecutionContext(input: {
  pinned: string
  sources: ContextSource[]
  maxBytes?: number
}): { prompt: string; receipt: ContextCompactionReceipt } {
  const maxBytes = input.maxBytes ?? CODING_CONTEXT_MAX_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid Context budget')
  const sources = [...input.sources].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    throw new Error('Duplicate Context source identity')
  }
  const full = (source: ContextSource) => `${source.title}\n${source.content}`
  const summaries = sources.map((source) => {
    if (source.required) return full(source)
    const constraints = [...new Set(source.content.split('\n').filter((line) => constraintLine.test(line)))]
    return `${source.title} [extractive summary; source=${source.id}; inspect the source for omitted detail]\n${[source.summary, ...constraints].filter(Boolean).join('\n')}`
  })
  const fullPrompt = [input.pinned, ...sources.map(full)].join('\n\n')
  const inputBytes = contextBytes(fullPrompt)
  let texts = sources.map(full)
  if (inputBytes > maxBytes) {
    texts = [...summaries]
    if (contextBytes([input.pinned, ...texts].join('\n\n')) > maxBytes) {
      throw new Error('Context budget cannot preserve the current request, Memory and explicit constraints; narrow the task before calling the Provider')
    }
    // Upgrade high-priority sources back to full text when the remaining budget allows it.
    for (let index = 0; index < sources.length; index += 1) {
      const candidate = [...texts]
      candidate[index] = full(sources[index]!)
      if (contextBytes([input.pinned, ...candidate].join('\n\n')) <= maxBytes) texts = candidate
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
