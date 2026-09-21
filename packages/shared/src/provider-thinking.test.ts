import { describe, expect, it } from 'vitest'
import { resolveProviderThinking, parseProviderThinking } from './provider-thinking'
import { buildAgentReviewContext, createOpenAiCompatibleAgentProvider } from './agent-review'
import { runs, artifacts } from './fixtures'

const deepseek = { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' }
describe('Provider thinking configuration', () => {
  it.each([{ mode: 'disabled' as const }, { mode: 'enabled' as const, effort: 'high' as const }])('applies $mode consistently to review, clarification and design requests', async (thinking) => {
    const bodies: Record<string, unknown>[] = []
    const provider = createOpenAiCompatibleAgentProvider({ ...deepseek, thinking, apiKey: 'fixture-only', fetcher: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: 'result', content: 'design', goals: ['a'], nonGoals: ['b'], acceptanceCriteria: ['c'], openQuestions: [], conclusion: 'done', risks: [], missingEvidence: [], suggestedTests: [] }), reasoning_content: thinking.mode === 'enabled' ? 'separate reasoning' : undefined }, finish_reason: 'stop' }] })
    } })
    const run = runs[0]!
    const node = run.nodes.find((item) => item.id === 'n-design-gate')!
    const context = await buildAgentReviewContext({ run, node, artifacts, testEvidence: [], knowledgeDocuments: [], knowledgeChunks: [] })
    const request = { id: 'thinking-request', runId: run.id, nodeId: node.id, projectId: run.projectId, requestedBy: 'fixture', runtime: 'electron' as const }
    const review = await provider.reviewKnowledge({ request, context, prompt: 'Return JSON.' })
    expect(review.effectiveThinking?.mode).toBe(thinking.mode)
    for (const stage of ['clarify', 'design'] as const) {
      const output = await provider.generateWorkflowArtifact!({ request: { ...request, stage }, context: { run, node, artifacts: [] }, prompt: 'Return JSON.' })
      expect(output.summary).toBe('result')
      expect(output.content).toBe('design')
      expect(output.reasoningContent).toBe(thinking.mode === 'enabled' ? 'separate reasoning' : undefined)
    }
    expect(bodies).toHaveLength(3)
    for (const body of bodies) {
      expect(body.thinking).toEqual({ type: thinking.mode })
      expect(body.reasoning_effort).toBe(thinking.mode === 'enabled' ? 'high' : undefined)
    }
  })
  it('gives old official DeepSeek configurations the agreed enabled/low default', () => {
    expect(resolveProviderThinking(deepseek)).toEqual({ mode: 'enabled', effort: 'low', source: 'application_default' })
    expect(resolveProviderThinking({ ...deepseek, thinking: { mode: 'disabled' } })).toEqual({ mode: 'disabled', source: 'provider_configuration' })
  })

  it('does not infer extension support from a label, proxy hostname or unknown model', () => {
    for (const input of [
      { ...deepseek, baseUrl: 'https://deepseek.example.invalid/v1' },
      { ...deepseek, model: 'future-model' },
      { model: 'gpt-4.1-mini' },
    ]) {
      expect(resolveProviderThinking(input)).toEqual({ mode: 'provider_default', source: 'provider_default' })
      expect(() => resolveProviderThinking({ ...input, thinking: { mode: 'enabled', effort: 'low' } })).toThrow('不支持')
    }
    expect(() => parseProviderThinking({ mode: 'enabled', effort: 'bogus' })).toThrow()
    expect(() => parseProviderThinking({ mode: 'disabled', effort: 'max' })).toThrow()
  })

  it.each(['low', 'high', 'max'] as const)('sends saved %s effort without coupling it to a display callback', async (effort) => {
    const bodies: Record<string, unknown>[] = []
    const provider = createOpenAiCompatibleAgentProvider({ ...deepseek, thinking: { mode: 'enabled', effort }, apiKey: 'fixture-only',
      fetcher: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)))
        return Response.json({ choices: [{ message: { content: '{"ok":true}', reasoning_content: 'provider reasoning' }, finish_reason: 'stop' }] })
      },
    })
    const result = await provider.completeStructuredJson!({ systemPrompt: 'JSON', userPrompt: 'fixture', maxOutputTokens: 500 })
    expect(bodies[0]).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: effort })
    expect(bodies[0]).not.toHaveProperty('stream')
    expect(result).toMatchObject({ value: { ok: true }, reasoningContent: 'provider reasoning', responseMetadata: { effectiveThinking: { mode: 'enabled', effort } } })
  })

  it('keeps thinking disabled even when the caller subscribes to reasoning output', async () => {
    let body: Record<string, unknown> = {}
    const provider = createOpenAiCompatibleAgentProvider({ ...deepseek, thinking: { mode: 'disabled' }, apiKey: 'fixture-only', fetcher: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })
    } })
    await provider.completeStructuredJson!({ systemPrompt: 'JSON', userPrompt: 'fixture', maxOutputTokens: 500, reasoning: { onDelta() { throw new Error('disabled') } } })
    expect(body).toMatchObject({ thinking: { type: 'disabled' } })
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('stream')
  })
})
