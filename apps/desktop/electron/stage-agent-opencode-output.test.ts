import { describe, expect, it } from 'vitest'
import { readStageAgentOpencodeOutput } from './stage-agent-opencode-output.js'

const model = { providerId: 'deepseek', modelId: 'deepseek-v4-flash' }
const output = { summary: 'Clarified', repositoryFindings: { citations: [{ id: 'c1', path: 'README.md' }] } }
function message(id: string, finish: string, parts: unknown[]) {
  return { info: {
    id, role: 'assistant', providerID: model.providerId, modelID: model.modelId, finish,
    tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 40, write: 0 } },
  }, parts }
}
const first = message('first', 'tool-calls', [{ type: 'tool', tool: 'read', state: { status: 'completed' } }])
const final = message('final', 'stop', [{ type: 'text', text: JSON.stringify(output) }])

describe('real OpenCode stage response contract', () => {
  it('uses runtime model provenance and includes tools and usage from earlier assistant turns', () => {
    const result = readStageAgentOpencodeOutput({ response: final, messages: [first, final], ...model })
    expect(result.value.model).toBe(model.modelId)
    expect(result.toolCalls).toBe(1)
    expect(result.value.usage).toMatchObject({ inputTokens: 280, outputTokens: 50, cacheReadTokens: 80 })
  })
  it('rejects the observed string citation shape with a precise diagnostic', () => {
    const response = message('final', 'stop', [{ type: 'text', text: JSON.stringify({ repositoryFindings: { citations: ['README.md:1'] } }) }])
    expect(() => readStageAgentOpencodeOutput({ response, messages: [response], ...model })).toThrow('Repository citations must be objects')
  })
  it('rejects a different runtime model rather than trusting model-written provenance', () => {
    expect(() => readStageAgentOpencodeOutput({ response: { ...final, info: { ...final.info, modelID: 'different-model' } }, messages: [first, final], ...model })).toThrow('selected Provider and Model')
  })
  it('does not use model-written token counts when runtime usage is absent', () => {
    const response = { ...final, info: { ...final.info, tokens: undefined }, parts: [{ type: 'text', text: JSON.stringify({ ...output, usage: { inputTokens: 999 } }) }] }
    expect(readStageAgentOpencodeOutput({ response, messages: [response], ...model }).value.usage).toBeUndefined()
  })
})
