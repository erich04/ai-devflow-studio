// @vitest-environment node
import { expect, it } from 'vitest'
import { createFakeAgentProvider, resolveRequestPolicy, validateNativeHistory, type AgentProvider } from '@ai-devflow/shared'
import { codingContext } from './native-coding-context'
import { createNativeCodingSession } from './native-coding-session'
import { nativeRequestBudget } from './native-request-budget'

it('compacts only closed tool pairs, retains the full history, and can read the next bounded request', () => {
  const session = createNativeCodingSession({ id: 's', codingRunId: 'c', workflowRunId: 'r', nodeId: 'n', localProjectId: 'p', providerId: 'fake', model: 'test', objective: 'Preserve compatibility', now: new Date().toISOString() })
  for (let index = 0; index < 20; index++) session.transcript.push(
    { role: 'assistant', content: null, tool_calls: [{ id: `call-${index}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: `module-${index}.ts` }) } }] },
    { role: 'tool', tool_call_id: `call-${index}`, content: JSON.stringify({ path: `module-${index}.ts`, hash: String(index), content: 'evidence '.repeat(400) }) },
  )
  const provider: AgentProvider = { ...createFakeAgentProvider(), serializeNativeRequest: request => JSON.stringify(request), resolveRequestPolicy: input => ({ ...resolveRequestPolicy({ ...input, model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' }), maxInputBytes: 30000 }) }
  const full = structuredClone(session.transcript), input = { systemPrompt: 'coding', messages: session.transcript, tools: [], maxOutputTokens: 4096 }
  let summaries = 0
  for (;;) {
    const context = codingContext(session, provider, input)
    expect(nativeRequestBudget(provider, context.request).overflow).toBe(false)
    if (!context.compact) { expect(context.request.messages[0]?.content).toContain('Preserve compatibility'); validateNativeHistory(context.request.messages); break }
    expect(++summaries).toBeLessThan(10)
    validateNativeHistory(session.transcript.slice(0, context.compact.through))
    session.compactions.push({ ...context.compact, summary: 'Observed files; unresolved changes remain. See read_history.', attemptId: `attempt-${summaries}`, createdAt: new Date().toISOString() })
  }
  expect(summaries).toBeGreaterThan(0)
  expect(session.transcript).toEqual(full)
})

it('pins exact human constraints and question answers even when the model summary omits them', () => {
  const session = createNativeCodingSession({ id: 's', codingRunId: 'c', workflowRunId: 'r', nodeId: 'n', localProjectId: 'p', providerId: 'fake', model: 'test', objective: 'Implement feature', now: new Date().toISOString() })
  session.transcript.push({ role: 'user', content: 'Do not change the public API.' }, { role: 'assistant', content: null, tool_calls: [{ id: 'q', type: 'function', function: { name: 'request_user_input', arguments: '{"text":"Which version?"}' } }] }, { role: 'tool', tool_call_id: 'q', content: '{"answer":"Support v1 as well","source":"human"}' })
  session.compactions.push({ through: session.transcript.length, sourceDigest: 'a'.repeat(64), summary: 'Continue implementation.', attemptId: 'compact', createdAt: new Date().toISOString() })
  const provider = { ...createFakeAgentProvider(), serializeNativeRequest: (value: unknown) => JSON.stringify(value) }
  const context = codingContext(session, provider, { systemPrompt: 'coding', messages: session.transcript, tools: [] })
  expect(JSON.stringify(context.request.messages)).toContain('Do not change the public API.')
  expect(JSON.stringify(context.request.messages)).toContain('Support v1 as well')
})
