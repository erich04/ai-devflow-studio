import { describe, expect, it } from 'vitest'
import { measurePromptSections } from './prompt-context'

describe('provider-aware prompt sections', () => {
  it('measures Chinese and escaped tool data separately from billing, with hard limits', () => {
    const sections = [{ id: 'request', kind: 'current' as const, content: '中'.repeat(1000), required: true }]
    const deepseek = measurePromptSections(sections, { provider: 'deepseek', maxTokens: 1800 })
    expect(deepseek).toMatchObject({ bytes: 3000, chars: 1000, overflow: false, estimator: 'deepseek-estimate-v1' })
    expect(measurePromptSections(sections, { provider: 'openai', maxTokens: 1800 }).overflow).toBe(true)
    expect(measurePromptSections(sections, { provider: 'deepseek', maxBytes: 2999 }).overflow).toBe(true)
    expect(measurePromptSections([{ ...sections[0]!, maxTokens: 10 }], { provider: 'deepseek' }).overLimitSections).toEqual(['request'])
    expect(measurePromptSections([{ ...sections[0]!, content: 'a'.repeat(100001) }], { provider: 'deepseek' }).overflow).toBe(true)
  })
})
