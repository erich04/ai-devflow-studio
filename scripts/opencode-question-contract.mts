// Real OpenCode, isolated profile, local synthetic provider. No user's key or model budget.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { createOpencodeProcessManager } from '../apps/desktop/electron/opencode-process.ts'
import { isolatedOpencodeProfileEnv } from '../apps/desktop/electron/opencode-profile-isolation.ts'
import { opencodeProviderBindingEnv } from '../apps/desktop/electron/opencode-provider-binding.ts'
import { createOpencodeSession, createReadOnlyStageAgentPermissionRules, sendOpencodeMessage, abortOpencodeSession } from '../apps/desktop/electron/opencode-http-adapter.ts'

const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-question-contract-'))
const directory = path.join(root, 'repository')
const manager = createOpencodeProcessManager()
let coding = false
const requests: Array<{ tools: string[]; messages: unknown[] }> = []
const provider = createServer((request, response) => {
  void (async () => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const tools = (body.tools ?? []).map((tool: { function: { name: string } }) => tool.function.name)
    requests.push({ tools, messages: body.messages })
    const ask = tools.includes('question') && !body.messages.some((item: { role: string }) => item.role === 'tool')
    const wrote = body.messages.some((item: { tool_calls?: Array<{ function: { name: string } }> }) => item.tool_calls?.some((call) => call.function.name === 'write'))
    const write = coding && !ask && !wrote && tools.includes('write')
    const delta = ask ? { role: 'assistant', tool_calls: [{ index: 0, id: 'ask-fixture', type: 'function', function: {
      name: 'question', arguments: JSON.stringify({ questions: [
        { header: 'Color', question: 'Choose color', options: [{ label: 'Blue', description: 'Blue color' }, { label: 'Green', description: 'Green color' }] },
        { header: 'Targets', question: 'Choose targets', multiple: true, options: [{ label: 'Desktop', description: 'Desktop app' }, { label: 'Web', description: 'Browser app' }] },
      ] }),
    } }] } : write ? { role: 'assistant', tool_calls: [{ index: 0, id: 'write-fixture', type: 'function', function: { name: 'write', arguments: JSON.stringify({ filePath: 'message.txt', content: 'Green\n' }) } }] } : { role: 'assistant', content: 'Fixture completed.' }
    const finishReason = ask || write ? 'tool_calls' : 'stop'
    if (!body.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ id: 'fixture', object: 'chat.completion', model: body.model,
        choices: [{ index: 0, message: 'tool_calls' in delta ? { ...delta, content: null, tool_calls: delta.tool_calls.map(({ index: _index, ...call }) => call) } : delta, finish_reason: finishReason }],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const [part, reason] of [[delta, null], [{}, finishReason]]) {
      response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: body.model,
        choices: [{ index: 0, delta: part, finish_reason: reason }],
        ...(reason ? { usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } } : {}),
      })}\n\n`)
    }
    response.end('data: [DONE]\n\n')
  })().catch((error) => { response.destroy(error instanceof Error ? error : undefined) })
})
await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
try {
  await mkdir(directory)
  const address = provider.address()
  assert(address && typeof address !== 'string')
  const binaryPath = process.env.DEVFLOW_OPENCODE_BIN || 'opencode'
  const version = execFileSync(binaryPath, ['--version'], { encoding: 'utf8' }).trim()
  const env = { PATH: process.env.PATH, ...isolatedOpencodeProfileEnv(root, { isolateHome: true }),
    ...opencodeProviderBindingEnv({ providerId: 'question-fixture', modelId: 'fixture', apiKey: 'synthetic-not-billed',
      fingerprint: 'fixture', baseUrl: `http://127.0.0.1:${address.port}/v1` }) }
  const plain = await manager.ensure({ projectId: 'fixture', binaryPath, env })
  const codingServer = await manager.ensure({ projectId: 'fixture', binaryPath, env, profile: 'coding' })
  assert.notEqual(plain.baseUrl, codingServer.baseUrl)
  assert.equal(plain.child.exitCode, null)
  const call = async (pathname: string, body?: unknown, baseUrl = codingServer.baseUrl) => fetch(
    `${baseUrl}${pathname}?directory=${encodeURIComponent(directory)}`, { signal: AbortSignal.timeout(10_000),
      ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const session = async (allowQuestion: boolean, baseUrl = codingServer.baseUrl) => createOpencodeSession({ baseUrl, directory,
    title: 'question fixture', model: { providerID: 'question-fixture', id: 'fixture' },
    permissionRules: [...createReadOnlyStageAgentPermissionRules(), { permission: 'question', pattern: '*', action: allowQuestion ? 'allow' : 'deny' }] })
  const message = (id: string, baseUrl = codingServer.baseUrl) => sendOpencodeMessage({ baseUrl, directory, sessionId: id,
    model: { providerID: 'question-fixture', modelID: 'fixture' }, text: 'Ask the fixture questions then finish.', signal: AbortSignal.timeout(45_000) })
  const question = async (sessionID: string) => {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const questions = await (await call('/question')).json()
      const found = questions.find((item: { sessionID: string }) => item.sessionID === sessionID)
      if (found) return found
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('No question from real OpenCode')
  }
  const a = await session(true)
  const aResult = message(a.id); void aResult.catch(() => undefined)
  const asked = await question(a.id)
  assert.equal(asked.questions.length, 2)
  assert(asked.tool.messageID && asked.tool.callID)
  const b = await session(false)
  await message(b.id)
  const c = await session(true, plain.baseUrl)
  await message(c.id, plain.baseUrl)
  assert(requests.slice(-2).every((item) => !item.tools.includes('question')))
  assert(requests.every((item) => !['task', 'webfetch', 'websearch'].some((name) => item.tools.includes(name))))
  const answers = [['Custom color'], ['Desktop', 'Web']]
  assert.equal(await (await call(`/question/${asked.id}/reply`, { answers })).json(), true)
  await aResult
  assert.equal((await call(`/question/${asked.id}/reply`, { answers })).status, 404)
  assert(requests.some((item) => JSON.stringify(item.messages).includes('Custom color')))
  const d = await session(true)
  const dResult = message(d.id); void dResult.catch(() => undefined)
  const dismissed = await question(d.id)
  assert.equal(await (await call(`/question/${dismissed.id}/reject`, {})).json(), true)
  await dResult
  const e = await session(true)
  const eResult = message(e.id); void eResult.catch(() => undefined)
  const cancelled = await question(e.id)
  await abortOpencodeSession({ baseUrl: codingServer.baseUrl, directory, sessionId: e.id })
  await eResult.catch(() => undefined)
  // 1.18.15 can retain the deferred question after /abort. Explicitly dismiss it
  // after stopping the session; abort again before considering cleanup complete.
  const retainedAfterAbort = (await (await call('/question')).json()).some((item: { id: string }) => item.id === cancelled.id)
  if (retainedAfterAbort) await call(`/question/${cancelled.id}/reject`, {})
  await abortOpencodeSession({ baseUrl: codingServer.baseUrl, directory, sessionId: e.id })
  assert.equal((await call(`/question/${cancelled.id}/reply`, { answers })).status, 404)
  if (process.argv.includes('--electron')) {
    await manager.stopAll()
    coding = true
    const { verifyQuestionInElectron } = await import('./opencode-question-electron.mts')
    await verifyQuestionInElectron({ root, directory, endpoint: `http://127.0.0.1:${address.port}/v1`, version })
  }
  console.log(JSON.stringify({ passed: true, version, provider: 'local synthetic / no paid model',
    providerRequests: requests.length, orderedAnswers: true, customAnswer: true, multipleAnswers: true,
    duplicateReply: 404, rejection: true, cancellation: true, retainedAfterAbort, separateProcesses: true, sessionIsolation: true }, null, 2))
} finally {
  await manager.stopAll()
  provider.closeAllConnections()
  await new Promise<void>((resolve) => provider.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}
