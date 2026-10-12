import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createOpenAiCompatibleAgentProvider, governAgentProvider, AgentProviderRequestError, type NativeToolMessage } from '../packages/shared/src/index.ts'
import { createEvaluationLedger, evaluationUsage, saveJson } from './native-coding-live-support.ts'

const [keyFile, directory] = process.argv.slice(2)
if (!keyFile || !directory) throw new Error('Usage: endpoint-live <private-key-file> <new-output-directory>')
const output = path.resolve(directory); await mkdir(output, { recursive: false })
const apiKey = (await readFile(keyFile, 'utf8')).trim()
const ledger = await createEvaluationLedger({ file: path.join(output, 'ledger.json'), projectId: 'endpoint', maxCalls: 64, maxCostUsd: 100 })
const cells: Array<Record<string, unknown>> = []
const tools = [{ type: 'function' as const, function: { name: 'read_fixture', description: 'Read an isolated fixture by name.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false } } }]
for (const mode of ['disabled', 'enabled'] as const) for (const stream of [true, false]) {
  const cell: Record<string, unknown> = { mode, effort: mode === 'enabled' ? 'high' : null, stream, passed: false }; cells.push(cell)
  const raw = createOpenAiCompatibleAgentProvider({ id: 'deepseek-evaluation', name: 'DeepSeek V4.1 Flash', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', apiKey,
    thinking: mode === 'enabled' ? { mode, effort: 'high' } : { mode }, structuredRequestTimeoutMs: 180000,
    fetcher: async (url, init) => { const body = JSON.parse(String(init?.body)); if (!stream) { delete body.stream; delete body.stream_options }; return fetch(url, { ...init, body: JSON.stringify(body) }) } })
  const provider = governAgentProvider(raw, 'endpoint', ledger)
  try {
    const messages: NativeToolMessage[] = []
    for (const round of [1, 2]) {
      messages.push({ role: 'user', content: `Call read_fixture with name fixture-${round}, then report its actual value. Do not guess.` })
      const input = { systemPrompt: 'Use the requested tool before answering. After receiving a tool result answer in one short sentence.', messages, tools, maxOutputTokens: 8192, purpose: 'conversation' as const, operationKey: `${mode}-${stream}-${round}` }
      const first = await provider.completeNativeConversation!(input); assert.equal(first.kind, 'tools')
      if (first.kind !== 'tools') throw new Error('Expected tool call')
      messages.push(first.assistantMessage)
      for (const call of first.toolCalls) { assert.equal(call.function.name, 'read_fixture'); messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ value: `observed-${round}-k71` }) }) }
      const last = await provider.completeNativeConversation!(input); assert.equal(last.kind, 'text'); assert.match(last.assistantMessage.content ?? '', new RegExp(`observed-${round}-k71`)); messages.push(last.assistantMessage)
    }
    const json = await provider.completeStructuredJson!({ purpose: 'native-tool', systemPrompt: 'Return JSON with the key ok and boolean value true.', userPrompt: 'Return the requested JSON.', maxOutputTokens: 8192 }); assert.equal((json.value as { ok?: boolean }).ok, true)
    cell.passed = true
  } catch (error) { cell.failure = error instanceof AgentProviderRequestError ? { code: error.code, reason: error.sanitizedCause, metadata: error.responseMetadata } : { message: error instanceof Error ? error.message.replaceAll(apiKey, '[redacted]').slice(0, 500) : 'unknown' } }
  await saveJson(path.join(output, 'report.json'), { model: 'deepseek-flash', displayName: 'DeepSeek-V4.1-Flash', cells, usage: evaluationUsage(ledger.records()), complete: cells.length === 4, passed: cells.length === 4 && cells.every(cell => cell.passed) })
  console.log(JSON.stringify(cell))
}
