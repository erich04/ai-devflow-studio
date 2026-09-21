import { createServer } from 'node:http'
import { createWorkbenchOpencodeExecutor } from '../apps/desktop/electron/workbench-opencode-executor.ts'
let calls = 0
let queries = 0
let actualTools: string[] = []
let heldCall!: () => void
const holding = new Promise<void>((resolve) => { heldCall = resolve })
let cancelledConnection = false
let isolatedCalls = 0
const server = createServer((request, response) => {
  void (async () => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    calls++
    actualTools = (body.tools ?? []).map((tool: any) => tool.function.name)
    const messages = body.messages ?? []
    const prompt = JSON.stringify(messages)
    if (prompt.includes('CONVERSATION_B') && prompt.includes('PRIVATE_A_MARKER')) throw new Error('conversation history leaked')
    if (prompt.includes('CONVERSATION_B')) isolatedCalls++
    const hasResult = messages.some((message: any) => message.role === 'tool')
    const tool = actualTools.find((name) => name.endsWith('workflow'))
    if (!hasResult && !tool) { response.writeHead(400); response.end(JSON.stringify({ error: { message: 'missing-scoped-tools' } })); return }
    if (actualTools.some((name) => !name.startsWith('devflow_'))) { response.writeHead(400); response.end(JSON.stringify({ error: { message: 'unexpected-tools' } })); return }
    if (prompt.includes('PRIVATE_A_MARKER') && !prompt.includes('EXPLICIT_RETRY')) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ id: 'held-fixture', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`)
      response.on('close', () => { cancelledConnection = true })
      heldCall()
      return
    }
    const delta = hasResult ? { role: 'assistant', content: JSON.stringify({ text: '当前在需求澄清阶段，来源 source-1。', format: 'markdown', citationIds: ['source-1'] }) }
      : { role: 'assistant', tool_calls: [{ index: 0, id: 'scoped-tool-call', type: 'function', function: { name: tool, arguments: '{}' } }] }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify({ id: `fixture-${calls}`, object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ id: `fixture-${calls}`, object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: hasResult ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52, completion_tokens_details: { reasoning_tokens: 3 } } })}\n\n`)
    response.end('data: [DONE]\n\n')
  })().catch(() => { response.writeHead(500); response.end() })
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address() as { port: number }
let executor: Awaited<ReturnType<typeof createWorkbenchOpencodeExecutor>> | undefined
const additional: Array<Awaited<ReturnType<typeof createWorkbenchOpencodeExecutor>>> = []
try {
  executor = await createWorkbenchOpencodeExecutor({ binaryPath: process.env.DEVFLOW_OPENCODE_BIN || 'opencode',
    binding: { providerId: 'devflow-fixture', modelId: 'contract-fixture', apiKey: 'synthetic-no-billing', fingerprint: 'fixture', baseUrl: `http://127.0.0.1:${address.port}/v1` },
    signal: AbortSignal.timeout(60000), query: async (name) => { queries++; return { sourceId: 'source-1', name, result: { run: { id: 'isolated-run', stage: '需求澄清' } } } } })
  const result = await executor.completeStructuredJson!({ systemPrompt: 'Use devflow_workflow to query the current project. Then return a JSON answer with text, format and citationIds.', userPrompt: '当前走到哪里了？', maxOutputTokens: 3500 })
  if (queries !== 1 || calls !== 2) throw new Error('real MCP loop did not execute exactly once')
  if (result.usage?.totalTokens !== 104) throw new Error('token accounting changed; reasoning must not be counted twice')
  await executor.close!()
  const make = async (signal: AbortSignal) => {
    const runtime = await createWorkbenchOpencodeExecutor({ binaryPath: process.env.DEVFLOW_OPENCODE_BIN || 'opencode',
      binding: { providerId: 'devflow-fixture', modelId: 'contract-fixture', apiKey: 'synthetic-no-billing', fingerprint: 'fixture', baseUrl: `http://127.0.0.1:${address.port}/v1` },
      signal, query: async () => { queries++; return { sourceId: 'source-1', result: { run: { id: 'isolated-run', stage: '需求澄清' } } } } })
    additional.push(runtime)
    return runtime
  }
  const controller = new AbortController()
  const a = await make(AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]))
  const pending = a.completeStructuredJson!({ systemPrompt: 'Return a JSON answer.', userPrompt: 'PRIVATE_A_MARKER', maxOutputTokens: 3500 }).then(() => 'unexpected success', () => 'cancelled')
  await Promise.race([holding, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('held call did not start')), 15000); timer.unref() })])
  const b = await make(AbortSignal.timeout(60000))
  const independent = b.completeStructuredJson!({ systemPrompt: 'Query workflow and return JSON text, format, citationIds.', userPrompt: 'CONVERSATION_B', maxOutputTokens: 3500 })
  controller.abort()
  if (await pending !== 'cancelled') throw new Error('cancellation did not stop the owned turn')
  await a.close!()
  const separateResult = await independent
  if (!separateResult.value.text || isolatedCalls !== 2 || !cancelledConnection) throw new Error('cancellation interrupted another conversation or left its request open')
  await b.close!()
  const retry = await make(AbortSignal.timeout(60000))
  const recovered = await retry.completeStructuredJson!({ systemPrompt: 'Query workflow and return JSON text, format, citationIds.', userPrompt: 'PRIVATE_A_MARKER EXPLICIT_RETRY', maxOutputTokens: 3500 })
  if (!recovered.value.text) throw new Error('explicit retry did not recover')
  console.log(JSON.stringify({ passed: true, provider: 'local fixture, no paid model', calls, queries, actualTools, result,
    cancellation: 'owned request closed', isolation: 'second conversation completed', retry: 'fresh runtime completed' }, null, 2))
} catch (error) { console.error(error); process.exitCode = 1 }
finally { await executor?.close?.(); await Promise.all(additional.map((runtime) => runtime.close!())); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) }
