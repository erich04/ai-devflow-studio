import { describe, expect, it, vi } from 'vitest'
import { createOpenAiCompatibleAgentProvider } from './agent-review'
import { validateNativeToolBatch, readOnlyToolDefinitions } from './native-readonly-tools'

const call = (id: string, name = 'repo_read', args = '{"path":"src/a.ts"}') => ({ id, type: 'function', function: { name, arguments: args } })
describe('native read-only protocol', () => {
  it('validates the whole batch, IDs, arguments and tool whitelist before execution', () => {
    expect(validateNativeToolBatch([call('a'), call('b', 'repo_list', '{}')])).toHaveLength(2)
    for (const batch of [
      [call('a'), call('b', 'shell', '{}')], [call('a'), call('a')],
      [call('a', 'repo_read', '{"path":"src/a.ts","projectId":"foreign"}')],
      [call('a', 'repo_read', '{')], [call('a', 'repo_read', '{"path":"../other"}')],
      Array.from({ length: 17 }, (_, i) => call(String(i))),
    ]) expect(() => validateNativeToolBatch(batch)).toThrow()
  })
  it('distinguishes tool turns from final JSON and replays complete private thinking history', async () => {
    const requests: Record<string, unknown>[] = []
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ id: 'r1', choices: [{ finish_reason: requests.length === 1 ? 'tool_calls' : 'stop', message: requests.length === 1
        ? { content: null, reasoning_content: 'private reasoning', tool_calls: [call('a')] }
        : { content: '{"text":"read complete","citationIds":["source-1"]}', reasoning_content: 'private final' } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }), { headers: { 'content-type': 'application/json' } })
    })
    const provider = createOpenAiCompatibleAgentProvider({ id: 'deepseek', name: 'DeepSeek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', apiKey: 'fixture', fetcher })
    const first = await provider.completeStructuredJson!({ systemPrompt: 'Return JSON. Use read-only tools.', userPrompt: 'Read src/a.ts', purpose: 'conversation', nativeTools: { definitions: readOnlyToolDefinitions(), messages: [] } })
    expect(first.toolCalls).toHaveLength(1)
    const second = await provider.completeStructuredJson!({ systemPrompt: 'Return JSON.', userPrompt: 'Finish with references', purpose: 'conversation', nativeTools: { definitions: readOnlyToolDefinitions(), messages: [first.assistantMessage!, { role: 'tool', tool_call_id: 'a', content: 'source-1: content' }] } })
    expect(second.value.text).toBe('read complete')
    expect(requests[0]).toMatchObject({ tools: expect.any(Array), tool_choice: 'auto' })
    expect(requests[1]?.messages).toContainEqual({ role: 'assistant', content: null, reasoning_content: 'private reasoning', tool_calls: [call('a')] })
    expect(requests[0]).not.toHaveProperty('response_format')
  })
})

it('assembles interleaved streaming tool arguments by index and preserves every call ID', async () => {
  const parts = [
    { choices: [{ delta: { tool_calls: [{ index: 1, ...call('b', 'repo_list', '{"pa') }, { index: 0, ...call('a', 'repo_read', '{"path":"中') }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '文.ts"}' } }, { index: 1, function: { arguments: 'th":"src"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 2 } },
  ]
  const provider = createOpenAiCompatibleAgentProvider({ id: 'deepseek', name: 'DeepSeek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', apiKey: 'fixture', fetcher: async () => new Response(parts.map(part => `data: ${JSON.stringify(part)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }) })
  const result = await provider.completeStructuredJson!({ systemPrompt: 'read only', userPrompt: 'inspect', purpose: 'conversation', nativeTools: { definitions: readOnlyToolDefinitions(), messages: [] } })
  expect(result.toolCalls).toEqual([call('a', 'repo_read', '{"path":"中文.ts"}'), call('b', 'repo_list', '{"path":"src"}')])
})
