// @vitest-environment node
import { expect, it } from 'vitest'
import { createOpenAiCompatibleAgentProvider, type NativeConversationRequest } from '../packages/shared/src/index'
import { legacyPrefixRequest } from './native-coding-cache-probe'

it('reconstructs the old on-wire layout without rewriting persisted history or reasoning', () => {
  const request: NativeConversationRequest = { systemPrompt: 'fixed rules', messages: [
    { role: 'user', content: 'Inspect the fixture.' },
    { role: 'assistant', content: null, reasoning_content: 'Prior thought', tool_calls: [{ id: 'r1', type: 'function', function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'r1', content: '{"value":7,"devflowRuntimeState":{"step":1}}' },
  ], tools: [], maxOutputTokens: 1024 }
  const original = structuredClone(request), before = legacyPrefixRequest(request, 'old rules')
  expect(before.systemPrompt).toBe('old rules\n[DevFlow runtime state]\n{"step":1}')
  expect(before.messages.at(-1)!.content).toBe('{"value":7}')
  expect(before.messages.slice(0, -1)).toEqual(original.messages.slice(0, -1))
  expect(request).toEqual(original)
  const wire = createOpenAiCompatibleAgentProvider({ id: 'deepseek-evaluation', model: 'deepseek-flash', apiKey: 'unused', baseUrl: 'https://api.deepseek.com', thinking: { mode: 'enabled', effort: 'high' } })
  const body = JSON.parse(wire.serializeNativeRequest!(before))
  expect(body.messages[0].content).toBe(before.systemPrompt)
  expect(body.messages[2].reasoning_content).toBe('Prior thought')
})

it('removes only the appended text state and refuses a request without the known marker', () => {
  const input: NativeConversationRequest = { systemPrompt: 'fixed', messages: [{ role: 'user', content: 'Task\n\n[DevFlow runtime state]\n{"step":0}' }], tools: [] }
  expect(legacyPrefixRequest(input, 'old').messages).toEqual([{ role: 'user', content: 'Task' }])
  expect(() => legacyPrefixRequest({ ...input, messages: [{ role: 'user', content: 'Task' }] }, 'old')).toThrow(/runtime state/)
})


it('restores an empty JSON tool result without losing the appended state', () => {
  const input: NativeConversationRequest = { systemPrompt: 'fixed', messages: [{ role: 'tool', tool_call_id: 'empty', content: '{"devflowRuntimeState":{"step":1}}' }], tools: [] }
  const result = legacyPrefixRequest(input, 'old')
  expect(result.messages[0]!.content).toBe('{}')
  expect(result.systemPrompt).toContain('{"step":1}')
  expect(input.messages[0]!.content).toBe('{"devflowRuntimeState":{"step":1}}')
})
