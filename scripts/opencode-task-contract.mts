// Real OpenCode + a local synthetic provider. No paid model or user credential.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { createOpencodeProcessManager } from '../apps/desktop/electron/opencode-process.ts'
import { isolatedOpencodeProfileEnv } from '../apps/desktop/electron/opencode-profile-isolation.ts'
import { opencodeProviderBindingEnv } from '../apps/desktop/electron/opencode-provider-binding.ts'
import { createOpencodeSession, createDefaultOpencodePermissionRules, sendOpencodeMessage } from '../apps/desktop/electron/opencode-http-adapter.ts'
import type { OpencodeTaskPolicy } from '../apps/desktop/electron/opencode-task-guard.ts'
import { OpencodeTaskScope } from '../apps/desktop/electron/opencode-task-scope.ts'
import { createGovernedOpencodeProxy, type GovernedOpencodeProxy } from '../apps/desktop/electron/governed-opencode-proxy.ts'
import type { ModelCallQuote, ModelCallSettlement } from '../packages/shared/src/index.ts'

const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'devflow-task-contract-')))
const directory = path.join(root, 'repository')
const manager = createOpencodeProcessManager()
let proxy: GovernedOpencodeProxy | undefined
let allowBudget = true
let electronMode = false
let operationId = 'coding-fixture'
const quotes: ModelCallQuote[] = []
const deniedQuotes: string[] = []
const settlements = new Map<string, ModelCallSettlement>()
const requests: Array<{ child: boolean; tools: string[] }> = []
let limitModelCalls = 0
const provider = createServer((request, response) => {
  void (async () => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const tools = (body.tools ?? []).map((tool: { function: { name: string } }) => tool.function.name)
    const child = body.messages.some((item: { role: string; content: unknown }) => item.role === 'user' && JSON.stringify(item.content).includes('CHILD_fixture'))
    const limitFixture = body.messages.some((item: { role: string; content: unknown }) => item.role === 'user' && JSON.stringify(item.content).includes('LIMIT_fixture'))
    if (limitFixture && tools.length) limitModelCalls++
    requests.push({ child, tools })
    const used = (name: string) => body.messages.some((item: { tool_calls?: Array<{ function: { name: string } }> }) => item.tool_calls?.some((call) => call.function.name === name))
    const name = !tools.length ? undefined : limitFixture ? 'read' : !child && !used('task') ? 'task' : child && !used('question') ? 'question' : child && !used('write') ? 'write'
      : child && electronMode && !used('bash') ? 'bash' : undefined
    const args = name === 'read' ? { filePath: path.join(directory, 'message.txt'), limit: limitModelCalls } : name === 'task' ? { description: 'Write fixture', prompt: 'CHILD_fixture: ask a question and write message.txt', subagent_type: 'devflow-worker' }
      : name === 'question' ? { questions: [
        { header: 'Color', question: 'Choose color', options: [{ label: 'Green', description: 'Fixture value' }] },
        { header: 'Targets', question: 'Choose targets', multiple: true, options: [{ label: 'Desktop', description: 'Desktop app' }, { label: 'Web', description: 'Web app' }] },
      ] }
      : name === 'bash' ? { command: 'npm test', description: 'Check delegated edit' } : { filePath: 'message.txt', content: 'Green\n' }
    if (name && body.stream && tools.length) assert(tools.includes(name), `Missing ${name}; got ${tools.join(',')}`)
    const delta = name ? { role: 'assistant', tool_calls: [{ index: 0, id: limitFixture ? `fixture-limit-${limitModelCalls}` : `fixture-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
      : { role: 'assistant', content: 'Fixture completed.' }
    const finishReason = name ? 'tool_calls' : 'stop'
    if (!body.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ id: 'fixture', object: 'chat.completion', model: body.model,
        choices: [{ index: 0, message: 'tool_calls' in delta ? { ...delta, content: null, tool_calls: delta.tool_calls.map(({ index: _index, ...call }) => call) } : delta, finish_reason: finishReason }],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const [part, reason] of [[delta, null], [{}, finishReason]]) response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: body.model,
      choices: [{ index: 0, delta: part, finish_reason: reason }], ...(reason ? { usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } } : {}) })}\n\n`)
    response.end('data: [DONE]\n\n')
  })().catch((error) => { console.error(error); response.destroy(error instanceof Error ? error : undefined) })
})
await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
try {
  await mkdir(directory)
  execFileSync('git', ['init', '-q'], { cwd: directory })
  const address = provider.address()
  assert(address && typeof address !== 'string')
  const binaryPath = process.env.DEVFLOW_OPENCODE_BIN || 'opencode'
  const version = execFileSync(binaryPath, ['--version'], { encoding: 'utf8' }).trim()
  const policy: OpencodeTaskPolicy = { owner: 'fixture-owner', providerID: 'task-fixture', modelID: 'fixture', maxTasks: 4, maxToolTurns: 24, maxModelCalls: 32,
    parentRules: [...createDefaultOpencodePermissionRules({ question: true }), { permission: 'task', pattern: 'devflow-worker', action: 'ask' }],
    childRules: createDefaultOpencodePermissionRules({ question: true }) }
  proxy = await createGovernedOpencodeProxy({ projectId: 'fixture',
    binding: { providerId: policy.providerID, modelId: policy.modelID, apiKey: 'synthetic-not-billed', fingerprint: 'fixture', baseUrl: `http://127.0.0.1:${address.port}/v1` },
    resolveOperation: async () => ({ id: operationId, version: 'a'.repeat(64), purpose: 'native-tool' }),
    governance: { reserve: async (quote) => { quotes.push(quote); if (!allowBudget) deniedQuotes.push(quote.id); return { accepted: allowBudget, decision: {
      status: 'allowed', blocksRun: !allowBudget, currentSpendUsd: 0, projectedCostUsd: 0, reason: 'Synthetic shared budget gate',
    } } }, persist: async (settlement) => { settlements.set(settlement.id, settlement) }, settle: async () => undefined, pending: async () => [] },
  })
  const env = { PATH: process.env.PATH, ...isolatedOpencodeProfileEnv(root, { isolateHome: true }),
    ...opencodeProviderBindingEnv(proxy.binding) }
  const server = await manager.ensure({ projectId: 'fixture', binaryPath, env, profile: 'coding', taskPolicy: policy })
  const call = async (pathname: string, body?: unknown) => {
    const response = await fetch(`${server.baseUrl}${pathname}?directory=${encodeURIComponent(directory)}`, { signal: AbortSignal.timeout(5000),
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
    assert(response.ok, `${pathname}: ${response.status}`)
    return response.json()
  }
  const session = await createOpencodeSession({ baseUrl: server.baseUrl, directory, title: 'Task fixture', agent: 'devflow-coding',
    model: { providerID: policy.providerID, id: policy.modelID }, permissionRules: policy.parentRules,
    metadata: { devflow: { owner: policy.owner, codingRunId: 'run-fixture', workspaceId: 'workspace-fixture' } } })
  const scope = new OpencodeTaskScope({ baseUrl: server.baseUrl, directory, sessionId: session.id, codingRunId: 'run-fixture', workspaceId: 'workspace-fixture', policy })
  let settled = false
  const result = sendOpencodeMessage({ baseUrl: server.baseUrl, directory, sessionId: session.id, agent: 'devflow-coding',
    model: { providerID: policy.providerID, modelID: policy.modelID }, text: 'PARENT_fixture: delegate the fixture.', signal: AbortSignal.timeout(45000) }).finally(() => { settled = true })
  void result.catch(() => undefined)
  let taskApproved = false, questionAnswered = false
  const deadline = Date.now() + 45000
  while (!settled && Date.now() < deadline) {
    for (const permission of await call('/permission')) {
      assert.equal(permission.sessionID, session.id)
      assert.equal(permission.permission, 'task')
      const children = await call(`/session/${session.id}/children`)
      assert.equal(children.length, 1)
      assert.equal(children[0].metadata.devflow.taskCallId, permission.tool.callID)
      assert.deepEqual(children[0].permission, policy.childRules)
      assert.equal(await scope.admit(permission), children[0].id)
      await call(`/permission/${permission.id}/reply`, { reply: 'once' })
      taskApproved = true
    }
    for (const question of await call('/question')) {
      assert.notEqual(question.sessionID, session.id)
      assert(scope.owns(question.sessionID))
      await call(`/question/${question.id}/reply`, { answers: [['Green'], ['Desktop', 'Web']] })
      questionAnswered = true
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  await result
  assert(taskApproved && questionAnswered)
  if (process.argv.includes('--debug')) {
    for (const item of [session, ...await call(`/session/${session.id}/children`)]) {
      console.log(JSON.stringify(await call(`/session/${item.id}/message`), null, 2))
    }
  }
  await scope.stop(5000)
  assert(await scope.idle())
  assert.equal(await readFile(path.join(directory, 'message.txt'), 'utf8'), 'Green\n')
  assert(requests.some((request) => request.child && request.tools.includes('write') && !request.tools.includes('task')))
  assert.equal(quotes.length, requests.length)
  assert.equal(new Set(quotes.map((quote) => quote.id)).size, quotes.length)
  assert(quotes.every((quote) => quote.operation?.id === operationId && quote.providerId === policy.providerID))
  assert.equal(proxy.usageAfter(0)?.budgetAttemptIds?.length, quotes.length)
  assert.equal(proxy.usageAfter(0)?.inputTokens, requests.length * 50)
  const successfulCalls = requests.length
  operationId = 'coding-budget-blocked'
  const blocked = await createOpencodeSession({ baseUrl: server.baseUrl, directory, title: 'Budget fixture', agent: 'devflow-coding',
    model: { providerID: policy.providerID, id: policy.modelID }, permissionRules: policy.parentRules,
    metadata: { devflow: { owner: policy.owner, codingRunId: 'run-blocked', workspaceId: 'workspace-fixture' } } })
  const blockedScope = new OpencodeTaskScope({ baseUrl: server.baseUrl, directory, sessionId: blocked.id, codingRunId: 'run-blocked', workspaceId: 'workspace-fixture', policy })
  const blockedResult = sendOpencodeMessage({ baseUrl: server.baseUrl, directory, sessionId: blocked.id, agent: 'devflow-coding',
    model: { providerID: policy.providerID, modelID: policy.modelID }, text: 'PARENT_fixture: delegate the fixture.', signal: AbortSignal.timeout(45000) }).catch(() => undefined)
  const admissionDeadline = Date.now() + 30000
  let blockedChild = false
  while (Date.now() < admissionDeadline) {
    const permission = (await call('/permission')).find((item: { sessionID: string }) => item.sessionID === blocked.id)
    if (permission) {
      await blockedScope.admit(permission)
      allowBudget = false
      await call(`/permission/${permission.id}/reply`, { reply: 'once' })
      blockedChild = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert(blockedChild)
  await blockedResult
  await blockedScope.stop(5000)
  assert.equal(requests.length, successfulCalls + 1, 'Blocked child must not reach the provider')
  assert(deniedQuotes.length > 0)
  assert(deniedQuotes.every((id) => !settlements.has(id)), 'Rejected reservations have no dispatched settlement')
  assert(quotes.slice(successfulCalls).every((quote) => quote.operation?.id === operationId))
  allowBudget = true
  operationId = 'coding-cancelled'
  await writeFile(path.join(directory, 'message.txt'), 'Before cancellation\n')
  const cancelled = await createOpencodeSession({ baseUrl: server.baseUrl, directory, title: 'Cancellation fixture', agent: 'devflow-coding',
    model: { providerID: policy.providerID, id: policy.modelID }, permissionRules: policy.parentRules,
    metadata: { devflow: { owner: policy.owner, codingRunId: 'run-cancelled', workspaceId: 'workspace-fixture' } } })
  const cancelledScope = new OpencodeTaskScope({ baseUrl: server.baseUrl, directory, sessionId: cancelled.id, codingRunId: 'run-cancelled', workspaceId: 'workspace-fixture', policy })
  const cancelledResult = sendOpencodeMessage({ baseUrl: server.baseUrl, directory, sessionId: cancelled.id, agent: 'devflow-coding',
    model: { providerID: policy.providerID, modelID: policy.modelID }, text: 'PARENT_fixture: delegate the fixture.', signal: AbortSignal.timeout(45000) }).catch(() => undefined)
  let cancelledQuestionId: string | undefined
  const cancellationDeadline = Date.now() + 30000
  while (Date.now() < cancellationDeadline) {
    for (const permission of await call('/permission')) {
      if (permission.sessionID !== cancelled.id) continue
      await cancelledScope.admit(permission)
      await call(`/permission/${permission.id}/reply`, { reply: 'once' })
    }
    const question = (await call('/question')).find((item: { sessionID: string }) => cancelledScope.owns(item.sessionID))
    if (question) { cancelledQuestionId = question.id; break }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert(cancelledQuestionId)
  await cancelledScope.stop(5000)
  await cancelledResult
  assert(await cancelledScope.idle())
  const staleReply = await fetch(`${server.baseUrl}/question/${cancelledQuestionId}/reply?directory=${encodeURIComponent(directory)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: [['Green'], ['Web']] }), signal: AbortSignal.timeout(5000),
  })
  assert.equal(staleReply.status, 404)
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(await readFile(path.join(directory, 'message.txt'), 'utf8'), 'Before cancellation\n')
  // A tool error must not fund another model round after the local attempt
  // budget is exhausted. Exercise the real plugin without host polling aborts.
  const limited = await createOpencodeSession({ baseUrl: server.baseUrl, directory, title: 'Tool limit fixture', agent: 'devflow-coding',
    model: { providerID: policy.providerID, id: policy.modelID }, permissionRules: policy.parentRules,
    metadata: { devflow: { owner: policy.owner, codingRunId: 'run-limited', workspaceId: 'workspace-fixture' } } })
  const limitedScope = new OpencodeTaskScope({ baseUrl: server.baseUrl, directory, sessionId: limited.id, codingRunId: 'run-limited', workspaceId: 'workspace-fixture', policy })
  await sendOpencodeMessage({ baseUrl: server.baseUrl, directory, sessionId: limited.id, agent: 'devflow-coding',
    model: { providerID: policy.providerID, modelID: policy.modelID }, text: 'LIMIT_fixture: read message.txt repeatedly.', signal: AbortSignal.timeout(45000) }).catch(() => undefined)
  assert.equal(limitModelCalls, policy.maxToolTurns + 1, 'The denied tool attempt must not trigger another model request')
  await assert.rejects(limitedScope.refresh(), /opencode_tool_turn_limit_exceeded/u)
  await limitedScope.stop(5000)
  assert(await limitedScope.idle())
  if (process.argv.includes('--electron')) {
    await manager.stopAll()
    electronMode = true
    const { verifyQuestionInElectron } = await import('./opencode-question-electron.mts')
    await verifyQuestionInElectron({ root, directory, endpoint: `http://127.0.0.1:${address.port}/v1`, version, delegated: true })
  }
  console.log(JSON.stringify({ passed: true, version, provider: 'local synthetic / no paid model', providerRequests: requests.length,
    taskApproved, questionAnswered, explicitChildPermissions: true, managedWrite: true, sharedAccounting: true,
    childBudgetBlockedBeforeDispatch: true, childCancellation: true, noLateWrite: true, toolBudgetStopsNextModel: true, limitModelCalls }, null, 2))
} finally {
  await manager.stopAll()
  await proxy?.close()
  provider.closeAllConnections()
  await new Promise<void>((resolve) => provider.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}
