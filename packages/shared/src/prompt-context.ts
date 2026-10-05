/** Context estimates are deliberately separate from provider-reported billing usage. */
export type PromptSection = {
  id: string
  kind: 'system' | 'instructions' | 'approved' | 'current' | 'history' | 'summary' | 'memory' | 'tools' | 'state'
  content: string
  required: boolean
  sourceIds?: readonly string[]
  maxTokens?: number
}

export type PromptBudget = { provider: string; model?: string; maxTokens?: number; maxBytes?: number; maxChars?: number }

/** Versioned, conservative heuristics, not tokenizer counts or advertised model windows. */
export function measurePromptSections(sections: readonly PromptSection[], budget: PromptBudget) {
  const family = /deepseek/iu.test(`${budget.provider} ${budget.model ?? ''}`) ? 'deepseek' : /openai|gpt|^o[134]-/iu.test(`${budget.provider} ${budget.model ?? ''}`) ? 'openai' : 'generic'
  const estimator = `${family}-estimate-v1` as const
  const limits = { tokens: budget.maxTokens ?? 24_000, bytes: budget.maxBytes ?? 96_000, chars: budget.maxChars ?? 40_000 }
  if (Object.values(limits).some((limit) => !Number.isFinite(limit) || limit < 1)) throw new Error('Invalid prompt budget')
  const measured = sections.map((section) => {
    let ascii = 0
    let other = 0
    for (const character of section.content) { if (character.codePointAt(0)! < 128) ascii++; else other++ }
    // Leave room for message/section framing. Unknown providers use the stricter profile.
    const tokens = Math.ceil(ascii / (family === 'generic' ? 3 : 4) + other * (family === 'deepseek' ? 1.5 : 2)) + 8
    return { id: section.id, kind: section.kind, required: section.required, sourceIds: [...(section.sourceIds ?? [])], tokens,
      bytes: new TextEncoder().encode(section.content).byteLength, chars: section.content.length,
      overLimit: section.maxTokens !== undefined && tokens > section.maxTokens }
  })
  const total = measured.reduce((sum, item) => ({ tokens: sum.tokens + item.tokens, bytes: sum.bytes + item.bytes, chars: sum.chars + item.chars }), { tokens: 0, bytes: 0, chars: 0 })
  return { stateVersion: 1 as const, estimator, limits, ...total, sections: measured,
    overLimitSections: measured.filter((section) => section.overLimit).map((section) => section.id),
    overflow: total.tokens > limits.tokens || total.bytes > limits.bytes || total.chars > limits.chars || measured.some((section) => section.overLimit) }
}

export type PromptBudgetReceipt = ReturnType<typeof measurePromptSections>
