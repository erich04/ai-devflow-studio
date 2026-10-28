// Real OpenCode and the released plugin API; model replies are local synthetic data.
// The allowed scenario fetches one real public Node.js documentation page. No paid provider.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { createOpencodeProcessManager } from '../apps/desktop/electron/opencode-process.ts'
import { isolatedOpencodeProfileEnv } from '../apps/desktop/electron/opencode-profile-isolation.ts'
import { opencodeProviderBindingEnv } from '../apps/desktop/electron/opencode-provider-binding.ts'
import { createOpencodeSession, createDefaultOpencodePermissionRules, createReadOnlyStageAgentPermissionRules, sendOpencodeMessage, listOpencodeMessages } from '../apps/desktop/electron/opencode-http-adapter.ts'
import type { OpencodeTaskPolicy } from '../apps/desktop/electron/opencode-task-guard.ts'

const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'devflow-document-contract-')))
let serverLog = ''
const directory = path.join(root, 'repository'), manager = createOpencodeProcessManager({ spawnProcess: (binary, args, options) => {
  const child = spawn(binary, [...args, ...(process.argv.includes('--debug') ? ['--print-logs', '--log-level', 'DEBUG'] : [])], { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk) => { serverLog = (serverLog + String(chunk)).slice(-8000) })
  return child
} })
const calls: Array<{ tools: string[]; messages: Array<Record<string, unknown>>; scope: Record<string, string | string[] | undefined> }> = []
const provider = createServer((request, response) => {
  void (async () => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const tools = (body.tools ?? []).map((item: { function: { name: string } }) => item.function.name)
    const messages = body.messages as Array<Record<string, unknown>>
    calls.push({ tools, messages, scope: Object.fromEntries(['x-devflow-coding-run', 'x-devflow-root-session', 'x-devflow-session', 'x-devflow-workspace'].map((key) => [key, request.headers[key]])) })
    const invoke = tools.includes('devflow_document') && !messages.some((item) => item.role === 'tool')
    const denied = messages.some((item) => item.role === 'user' && String(item.content).includes('DENIED_fixture'))
    const message = invoke ? { role: 'assistant', content: null, tool_calls: [{ id: 'document-fixture', type: 'function', function: {
      name: 'devflow_document', arguments: JSON.stringify({ url: denied ? 'https://127.0.0.1/private' : 'https://nodejs.org/api/assert.html' }),
    } }] } : { role: 'assistant', content: 'Document fixture finished.' }
    const finish_reason = invoke ? 'tool_calls' : 'stop'
    const usage = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 }
    if (!body.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: 'document', object: 'chat.completion', model: body.model,
        choices: [{ index: 0, message, finish_reason }], usage }))
      return
    }
    const delta = { ...message, ...(invoke ? { tool_calls: message.tool_calls!.map((item, index) => ({ ...item, index })) } : {}) }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const [part, reason] of [[delta, null], [{}, finish_reason]]) response.write(`data: ${JSON.stringify({ id: 'document', object: 'chat.completion.chunk', model: body.model,
      choices: [{ index: 0, delta: part, finish_reason: reason }], ...(reason ? { usage } : {}) })}\n\n`)
    response.end('data: [DONE]\n\n')
  })().catch((error) => response.destroy(error instanceof Error ? error : undefined))
})
await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
try {
  await mkdir(directory)
  execFileSync('git', ['init', '-q'], { cwd: directory })
  const address = provider.address(); assert(address && typeof address !== 'string')
  const binaryPath = process.env.DEVFLOW_OPENCODE_BIN || 'opencode'
  const version = execFileSync(binaryPath, ['--version'], { encoding: 'utf8' }).trim()
  const rules = [...createDefaultOpencodePermissionRules(), { permission: 'devflow_document', pattern: '*', action: 'allow' as const }]
  const policy: OpencodeTaskPolicy = { owner: 'document-fixture', providerID: 'document-fixture', modelID: 'fixture',
    maxTasks: 2, maxToolTurns: 8, maxModelCalls: 8, publicDocuments: true, parentRules: rules, childRules: rules }
  const env = { PATH: process.env.PATH, ...isolatedOpencodeProfileEnv(root, { isolateHome: true }),
    ...opencodeProviderBindingEnv({ providerId: policy.providerID, modelId: policy.modelID, fingerprint: 'fixture', apiKey: 'synthetic-not-billed', baseUrl: `http://127.0.0.1:${address.port}/v1` }) }
  const coding = await manager.ensure({ projectId: 'document-fixture', binaryPath, env, profile: 'coding', taskPolicy: policy })
  for (const denied of [true, false]) {
    const session = await createOpencodeSession({ baseUrl: coding.baseUrl, directory, title: 'Document fixture', agent: 'devflow-coding', permissionRules: policy.parentRules,
      model: { providerID: policy.providerID, id: policy.modelID }, metadata: { devflow: { owner: policy.owner, codingRunId: denied ? 'run-denied' : 'run-allowed', workspaceId: 'workspace' } } })
    const callStart = calls.length
    await sendOpencodeMessage({ baseUrl: coding.baseUrl, directory, sessionId: session.id, agent: 'devflow-coding', model: { providerID: policy.providerID, modelID: policy.modelID },
      text: `${denied ? 'DENIED' : 'ALLOWED'}_fixture: read the fixture document using devflow_document.`, signal: AbortSignal.timeout(45_000) })
    const history = await listOpencodeMessages({ baseUrl: coding.baseUrl, directory, sessionId: session.id })
    const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
    const tool = history.flatMap((item) => item.parts).filter(record).find((item) => item.type === 'tool' && item.tool === 'devflow_document')
    assert(tool && typeof tool.state === 'object' && tool.state !== null, 'Custom documentation tool must be registered and executed')
    const state = tool.state as Record<string, unknown>
    const scopedCalls = calls.slice(callStart).filter((call) => call.tools.length)
    assert(scopedCalls.length > 0)
    assert(scopedCalls.every((call) => call.scope['x-devflow-coding-run'] === (denied ? 'run-denied' : 'run-allowed') &&
      call.scope['x-devflow-root-session'] === session.id && call.scope['x-devflow-session'] === session.id && call.scope['x-devflow-workspace'] === 'workspace'))
    if (denied) { assert.equal(state.status, 'error'); assert(String(state.error).includes('document_target_denied')) }
    else {
      assert.equal(state.status, 'completed', String(state.error ?? 'Document read did not complete'))
      const result = JSON.parse(String(state.output))
      assert.equal(result.finalUrl, 'https://nodejs.org/api/assert.html')
      assert.equal(result.trust, 'untrusted-public-reference')
      assert(['system', 'trusted-public-dns'].includes(result.dnsResolution))
      assert(result.bytes > 0 && result.bytes <= 524_288 && result.text.length <= 32_000)
    }
  }
  const readOnly = await manager.ensure({ projectId: 'document-fixture', binaryPath, env })
  const before = calls.length
  const session = await createOpencodeSession({ baseUrl: readOnly.baseUrl, directory, title: 'Read-only fixture', permissionRules: createReadOnlyStageAgentPermissionRules(), model: { providerID: policy.providerID, id: policy.modelID } })
  await sendOpencodeMessage({ baseUrl: readOnly.baseUrl, directory, sessionId: session.id, model: { providerID: policy.providerID, modelID: policy.modelID }, text: 'Read-only fixture.', signal: AbortSignal.timeout(30_000) })
  assert(calls.slice(0, before).some((call) => call.tools.includes('devflow_document')))
  assert(calls.slice(before).every((call) => !call.tools.includes('devflow_document') && !call.tools.includes('webfetch')))
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: directory, encoding: 'utf8' }), '')
  console.log(JSON.stringify({ status: 'passed', realOpenCode: version, model: 'synthetic-not-billed', publicDocument: 'https://nodejs.org/api/assert.html', publicDocumentRead: 'passed', attributionHeaders: true, privateTargetDenied: true, readOnlyIsolated: true, sourceUnchanged: true }))
} catch (error) {
  console.error('Synthetic OpenCode document contract server:', serverLog)
  throw error
} finally {
  await manager.stopAll()
  provider.closeAllConnections()
  await new Promise<void>((resolve) => provider.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}
