/** Real OpenCode + local deterministic provider. No external model endpoint or credential. */
import { createServer } from 'node:http'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runOpencodeMemoryLearningLiveSmoke } from './opencode-memory-learning-live-smoke.js'

const root = await mkdtemp(path.join(tmpdir(), 'devflow-memory-opencode-'))
let calls = 0
const server = createServer(async (request, response) => {
  try {
    if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    calls++
    if (calls > 12) throw new Error('Too many fixture requests')
    const text = body.messages.map((message: { content: unknown }) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n')
    const greeting = /to exactly "(Welcome to [^"]+)"/u.exec(text)?.[1]
    if (!greeting) throw new Error('Missing fixture request')
    const results = body.messages.filter((message: { role: string }) => message.role === 'tool').length
    const name = results === 0 ? 'read' : 'edit'
    const args = results === 0 ? { filePath: 'src/greeting.js' } : { filePath: 'src/greeting.js', oldString: 'Old greeting', newString: greeting }
    const message = results < 2
      ? { role: 'assistant', content: null, tool_calls: [{ id: `fixture-tool-${calls}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
      : { role: 'assistant', content: 'Changed the greeting only. DevFlow will run the saved tests.' }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: `fixture-${calls}`, model: body.model,
      choices: [{ index: 0, message, finish_reason: results < 2 ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80 },
    }))
  } catch { response.writeHead(400).end(JSON.stringify({ error: { message: 'Deterministic fixture contract failed' } })) }
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
try {
  const address = server.address() as { port: number }
  const report = await runOpencodeMemoryLearningLiveSmoke({ binaryPath: process.env.DEVFLOW_OPENCODE_BIN ?? 'opencode',
    providerId: 'fixture', modelId: 'gpt-4o-mini', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'fixture-local-only',
    outputDirectory: path.join(root, 'acceptance'), maxCostUsd: 0.5, maxCalls: 12 })
  assert.equal(report.modelCalls.length, 6)
  assert.ok(report.modelCalls.every((call) => call.final && call.settled && call.costUsd !== null))
  for (const run of report.runs) {
    assert.equal(run.governedCost.status, 'settled')
    assert.ok(run.governedCost.costUsd > 0 && run.governedCost.costUsd < report.maxCostUsd)
  }
  console.log(JSON.stringify({ passed: report.passed, mode: 'deterministic-local-provider', providerCalls: calls, outputDirectory: path.join(root, 'acceptance') }))
} finally {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
