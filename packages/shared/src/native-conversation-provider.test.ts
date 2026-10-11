import { describe, expect, it, vi } from 'vitest'
import { createOpenAiCompatibleAgentProvider } from './agent-review'
import { governAgentProvider, type ModelCallGovernance } from './governed-provider'

const definition = { type: 'function' as const, function: { name: 'propose_revision', description: '提案', parameters: { type: 'object' } } }
function provider(message: unknown, finish = 'stop') {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ choices: [{ message, finish_reason: finish }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }))
  return { fetcher, agent: createOpenAiCompatibleAgentProvider({ id: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', apiKey: 'fixture', fetcher, thinking: { mode: 'enabled', effort: 'low' } }) }
}
const request = { systemPrompt: '直接回答或调用函数。', messages: [{ role: 'user' as const, content: '解释一下' }], tools: [definition], purpose: 'conversation' as const }
describe('native conversation transport', () => {
  it('accepts ordinary Markdown and JSON examples without parsing the answer as a command', async () => {
    const content = '说明：\n```json\n{"tool": "这是示例"}\n```'
    const { agent, fetcher } = provider({ content, reasoning_content: 'provider reasoning' })
    const result = await agent.completeNativeConversation!(request)
    expect(result).toMatchObject({ kind: 'text', text: content, assistantMessage: { content, reasoning_content: 'provider reasoning' }, usage: { inputTokens: 12, outputTokens: 3 } })
    const wire = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(agent.serializeNativeRequest!(request)).toBe(fetcher.mock.calls[0]?.[1]?.body)
    expect(wire).toMatchObject({ model: 'deepseek-flash', tool_choice: 'auto', thinking: { type: 'enabled' } })
    expect(wire.response_format).toBeUndefined()
    expect(wire.messages).toEqual([{ role: 'system', content: request.systemPrompt }, ...request.messages])
  })
  it('accepts long business arguments and does not insert a user message after tool results', async () => {
    const calls = [{ id: 'proposal-1', type: 'function', function: { name: 'propose_revision', arguments: JSON.stringify({ content: '中文'.repeat(20000) }) } }]
    const { agent, fetcher } = provider({ content: null, tool_calls: calls }, 'tool_calls')
    const messages = [...request.messages, { role: 'assistant' as const, content: null, reasoning_content: 'original', tool_calls: [{ id: 'q', type: 'function' as const, function: { name: 'propose_revision', arguments: '{}' } }] }, { role: 'tool' as const, tool_call_id: 'q', content: 'accepted' }]
    expect(await agent.completeNativeConversation!({ ...request, messages })).toMatchObject({ kind: 'tools', toolCalls: calls })
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).messages.at(-1)).toEqual(messages.at(-1))
  })
  it('records usage on truncated replies without returning an executable call', async () => {
    const { agent } = provider({ content: '{partial' }, 'length')
    await expect(agent.completeNativeConversation!(request)).rejects.toMatchObject({ sanitizedCause: 'output_length', usage: { totalTokens: 15 } })
  })
  it('governs every native request and validates input before spending a reservation', async () => {
    const { agent, fetcher } = provider({ content: '回答' })
    const reserve = vi.fn(async (_quote: import('./model-call-budget').ModelCallQuote) => ({ accepted: true, decision: { status: 'allowed' as const, blocksRun: false, currentSpendUsd: 0, projectedCostUsd: 0, reason: 'fixture' } }))
    const settle = vi.fn(async () => {})
    const governance: ModelCallGovernance = { reserve, settle, persist: async () => {}, pending: async () => [] }
    const governed = governAgentProvider(agent, 'project', governance)
    for (let i = 0; i < 2; i++) await governed.completeNativeConversation!({ ...request, operationKey: 'one-step' })
    expect(reserve).toHaveBeenCalledTimes(2)
    expect(reserve.mock.calls[0]?.[0]?.operation).toEqual(reserve.mock.calls[1]?.[0]?.operation)
    expect(settle).toHaveBeenCalledTimes(2)
    await expect(governed.completeNativeConversation!({ ...request, messages: [{ role: 'user', content: 'x'.repeat(5 * 1024 * 1024) }] })).rejects.toMatchObject({ deliveryState: 'not_sent' })
    expect(reserve).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('includes transport fields in the preflight byte limit', async () => {
    const { agent, fetcher } = provider({ content: '回答' })
    const policy = agent.resolveRequestPolicy!(request)
    const limit = new TextEncoder().encode(agent.serializeNativeRequest!(request)).byteLength - 1
    agent.resolveRequestPolicy = () => ({ ...policy, maxInputBytes: limit })
    await expect(agent.completeNativeConversation!(request)).rejects.toMatchObject({ sanitizedCause: 'input_capacity_exceeded', deliveryState: 'not_sent' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
