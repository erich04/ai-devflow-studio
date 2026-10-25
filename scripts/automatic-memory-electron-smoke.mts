/** Real Electron/preload/IPC/SQLite; only disposable loopback Team, provider and Hindsight fixtures.
 * Build desktop first, then: corepack pnpm exec tsx scripts/automatic-memory-electron-smoke.mts
 * No production credentials, user database, external model or paid Hindsight calls are used.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import type { AutomaticMemoryStatus, AgentMemoryRendererSnapshot, LocalProject, ProviderCredentialMetadata, LocalExecutionState } from '../packages/shared/src/index.ts'
import type { ConversationResponse, WorkbenchConversation } from '../apps/desktop/electron/workbench-conversation-contract.ts'
import { HINDSIGHT_PROTOCOL } from '../apps/desktop/electron/hindsight-client.ts'
import { createWorkspace, startTeamApi, createTeamProject, createPairingCode, stopProcess, delay, rootDir, type TeamApi } from './workspace-baseline/environment.mts'

const workspace = await createWorkspace('devflow-automatic-memory-smoke-')
const output = path.join(rootDir, 'out', 'automatic-memory-smoke')
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const reports: string[] = []
const providerRequests: unknown[] = []
const remoteDocuments = new Map<string, { bank: string; id: string; content: string; metadata: Record<string, string>; fact: string; updatedAt: string }>()
const operations = new Set<string>()
let retainCalls = 0; let deleteCalls = 0; let modelClosed = false; let hindsightClosed = false
let app: ElectronApplication | undefined; let page: Page | undefined; let team: TeamApi | undefined
let projectId = ''; let providerId = ''
const requestErrors: string[] = []
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address(); assert(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
const model = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); providerRequests.push(body)
    const answer = JSON.stringify({ text: '已收到。本轮公开答复已完成。', format: 'markdown' })
    if (!body.stream) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 50, completion_tokens: 15, total_tokens: 65, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 50 } }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: 'automatic-memory-local-provider', choices: [{ index: 0, delta: { content: answer }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 50, completion_tokens: 15, total_tokens: 65, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 50 } })}\n\ndata: [DONE]\n\n`)
  } catch (error) { requestErrors.push(String(error)); response.writeHead(500).end('{}') }
})
const hindsight = createServer(async (request, response) => {
  const json = (body: unknown, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)) }
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    if (url.pathname === '/version') return json({ api_version: HINDSIGHT_PROTOCOL.version })
    const match = url.pathname.match(/^\/v1\/default\/banks\/([^/]+)(.*)$/u)
    if (!match) return json({}, 404)
    const bank = decodeURIComponent(match[1]!); const suffix = match[2]!
    if (request.method === 'PUT' && !suffix) return json({ bank_id: bank })
    if (request.method === 'PATCH' && suffix === '/config') return json({ bank_id: bank, config: body.updates })
    if (request.method === 'POST' && suffix === '/memories') {
      retainCalls++
      const item = body.items[0]; const event = JSON.parse(item.content)
      const fact = event.materials.find((material: { role: string }) => material.role === 'user' || material.role === 'tool' || material.role === 'artifact')?.text
      assert.equal(typeof fact, 'string')
      remoteDocuments.set(`${bank}:${item.document_id}`, { bank, id: item.document_id, content: item.content,
        metadata: item.metadata, fact, updatedAt: new Date().toISOString() })
      operations.add(`${bank}:${body.operation_id}`)
      return json({ success: true, bank_id: bank, async: true, operation_id: body.operation_id, items_count: 1 })
    }
    if (suffix.startsWith('/operations/')) {
      const id = decodeURIComponent(suffix.slice('/operations/'.length))
      return operations.has(`${bank}:${id}`) ? json({ operation_id: id, status: 'completed' }) : json({}, 404)
    }
    if (suffix.startsWith('/documents/')) {
      const id = decodeURIComponent(suffix.slice('/documents/'.length)); const document = remoteDocuments.get(`${bank}:${id}`)
      if (request.method === 'DELETE') { deleteCalls++; remoteDocuments.delete(`${bank}:${id}`); return json({ success: true, document_id: id }) }
      return document ? json({ id, bank_id: bank, original_text: document.content, content_hash: hash(document.content),
        memory_unit_count: 1, updated_at: document.updatedAt, document_metadata: document.metadata }) : json({}, 404)
    }
    if (suffix === '/memories/list') {
      const id = url.searchParams.get('document_id')!; const document = remoteDocuments.get(`${bank}:${id}`)
      assert(document)
      return json({ total: 1, limit: Number(url.searchParams.get('limit')), offset: Number(url.searchParams.get('offset')),
        items: [{ id: `fact-${id}`, text: document.fact, document_id: id, fact_type: 'world', state: 'valid',
          updated_at: document.updatedAt, metadata: document.metadata, source_memory_ids: [] }] })
    }
    if (suffix === '/memories/recall') return json({ results: [] })
    return json({}, 404)
  } catch (error) { requestErrors.push(String(error)); json({}, 500) }
})
const modelEndpoint = await listen(model)
const hindsightEndpoint = await listen(hindsight)
async function launch() {
  assert(team)
  app = await electron.launch({ args: ['.'], cwd: path.join(rootDir, 'apps/desktop'), env: {
    ...process.env, DEVFLOW_USER_DATA_DIR: workspace.userDataDir, DEVFLOW_DATA_PROFILE_REGISTRY_PATH: workspace.registryPath,
    DEVFLOW_API_BASE_URL: team.url, DEVFLOW_ENABLE_DEMO_DATA: 'false', DEVFLOW_ENABLE_FAKE_RUNTIME: 'false',
    DEVFLOW_CODING_ENGINE: '', DEVFLOW_CODING_EXECUTOR: '', DEVFLOW_NATIVE_CODING_PROVIDER_ID: '',
    DEVFLOW_HINDSIGHT_PROTOCOL_VERIFIED: HINDSIGHT_PROTOCOL.commit, VITE_DEV_SERVER_URL: '',
  } })
  await app.evaluate(({ safeStorage, session }, endpoint) => {
    safeStorage.isAsyncEncryptionAvailable = async () => true
    safeStorage.encryptStringAsync = async (value: string) => Buffer.from(`automatic-memory-fixture:${value}`)
    safeStorage.decryptStringAsync = async (bytes) => {
      if (!bytes.toString().startsWith('automatic-memory-fixture:')) throw new Error('Unexpected non-fixture credential')
      return { result: bytes.toString().slice('automatic-memory-fixture:'.length), shouldReEncrypt: false }
    }
    const original = globalThis.fetch
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      if (url.hostname === 'api.deepseek.com') return original(`${endpoint}/v1/chat/completions`, init)
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Automatic memory smoke forbids external requests')
      return original(input, init)
    }
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      callback({ cancel: !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(details.url).hostname) })
    })
  }, modelEndpoint)
  page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded')
}
async function ipc<T>(method: string, input?: unknown): Promise<T> {
  assert(page)
  return page.evaluate(async ({ method, input }) => {
    const api = window.aiDevFlowDesktop as unknown as Record<string, (value?: unknown) => Promise<unknown>>
    const operation = api[method]; if (!operation) throw new Error(`Missing IPC ${method}`)
    return operation(input)
  }, { method, input }) as Promise<T>
}
async function chat(text: string): Promise<WorkbenchConversation> {
  const created = await ipc<ConversationResponse>('workbenchConversation', { type: 'create', projectId, title: '自动记忆验证', executor: 'direct-provider' })
  assert(created.conversationId)
  await ipc('workbenchConversation', { type: 'send', projectId, conversationId: created.conversationId, providerId, text })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const state = await ipc<ConversationResponse>('workbenchConversation', { type: 'list', projectId })
    const conversation = state.conversations.find((item) => item.id === created.conversationId)!
    if (conversation.status !== 'running') { assert.equal(conversation.status, 'idle', JSON.stringify(conversation.failure ?? conversation.error)); return conversation }
    await delay(100)
  }
  throw new Error('Controlled conversation timed out')
}
async function processed(test: (status: AutomaticMemoryStatus) => boolean): Promise<AutomaticMemoryStatus> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const status = await ipc<AutomaticMemoryStatus>('processAutomaticMemory', { projectId })
    if (test(status)) return status
    await delay(250)
  }
  throw new Error(`Automatic memory did not settle: ${JSON.stringify(await ipc('getAutomaticMemoryStatus', { projectId }))}`)
}
try {
  await mkdir(output, { recursive: true }); await mkdir(path.join(workspace.repoDir, 'docs/knowledge'), { recursive: true })
  await writeFile(path.join(workspace.repoDir, 'package.json'), JSON.stringify({ name: 'automatic-memory-todo', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }))
  await writeFile(path.join(workspace.repoDir, 'todo.js'), 'export const tasks = []\n')
  await writeFile(path.join(workspace.repoDir, 'docs/knowledge/model.json'), JSON.stringify({ version: 'smoke-v1', dimensions: [{ key: 'sem_kind', type: 'text' }] }))
  const git = (args: string[]) => promisify(execFile)('git', args, { cwd: workspace.repoDir })
  await git(['init', '-q', '-b', 'main']); await git(['add', '.'])
  await git(['-c', 'user.name=Automatic Memory Smoke', '-c', 'user.email=smoke@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic Todo fixture'])
  team = await startTeamApi(workspace)
  const teamProject = await createTeamProject(team, 'Automatic Memory Smoke')
  const pairingCode = await createPairingCode(team, teamProject.id, 'acct-demo-u-erich')
  await launch(); assert(app)
  await app.evaluate(({ dialog }, repo) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [repo] }) }, workspace.repoDir)
  const project = await ipc<LocalProject>('selectLocalProject'); projectId = project.id
  await ipc('pairDesktop', { code: pairingCode, localProjectId: projectId })
  const provider = await ipc<ProviderCredentialMetadata>('saveAgentProviderCredential', { name: 'Automatic memory loopback fixture',
    providerId: 'automatic-memory-smoke', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-fixture-never-real', thinking: { mode: 'disabled' } })
  providerId = provider.providerId
  await ipc('saveCodingRuntimeBudgetPolicy', { projectId, enabled: true, monthlyLimitUsd: 1, warningThresholdUsd: 0.5 })
  assert.equal((await ipc<LocalExecutionState>('loadState')).runs.length, 0)
  await ipc('configureHindsight', { projectId, endpoint: hindsightEndpoint, selectedPaths: [], includeMemories: false, enabled: true, pairedProjectConsent: true })
  await ipc('configureAutomaticMemory', { projectId, enabled: true, consent: true, maxRetainsPerDay: 20 })
  await chat('请用中文回答')
  const initial = await processed((status) => status.decisions.some((decision) => decision.resolution === 'saved'))
  const first = initial.decisions.find((decision) => decision.resolution === 'saved')!; assert(first.memoryId)
  reports.push('no-run-project-consent-and-automatic-save')
  const recalled = await chat('请说明中文回答的偏好')
  const memoryReceipt = recalled.contextReceipt?.memory; assert(memoryReceipt)
  assert(memoryReceipt.memories.some((memory) => memory.id === first.memoryId), 'New conversation did not send the saved memory')
  assert.equal(memoryReceipt.state, 'response_received')
  assert(JSON.stringify(providerRequests.at(-1)).includes('请用中文回答'))
  reports.push('new-chat-actual-request-memory-receipt')
  await chat('请用英文回答')
  const conflicted = await processed((status) => status.decisions.some((decision) => decision.disposition === 'conflict'))
  const conflict = conflicted.decisions.find((decision) => decision.disposition === 'conflict')!; const prior = conflict.conflictsWith?.[0]; assert(prior)
  await ipc('resolveAutomaticMemoryDecision', { projectId, decisionId: conflict.id, action: 'approve', targetMemoryId: prior.memoryId, expectedRevision: prior.revision })
  const replaced = await ipc<AgentMemoryRendererSnapshot>('listAgentMemoryLifecycle', { localProjectId: projectId })
  assert(!replaced.memories.some((memory) => memory.memoryId === prior.memoryId && memory.lifecycleStatus === 'active'))
  const ruleConversation = await chat('Todo 删除必须可撤销')
  await processed((status) => status.decisions.some((decision) => decision.disposition === 'rule_candidate'))
  const rules = await ipc<AgentMemoryRendererSnapshot>('listAgentMemoryLifecycle', { localProjectId: projectId })
  assert(!rules.memories.some((memory) => memory.statement === 'Todo 删除必须可撤销' && memory.lifecycleStatus === 'active'))
  reports.push('conflict-version-confirmation-and-rule-queue')
  await ipc('configureAutomaticMemory', { projectId, enabled: false, consent: false, maxRetainsPerDay: 20 })
  const lifecycle = await ipc<AgentMemoryRendererSnapshot>('listAgentMemoryLifecycle', { localProjectId: projectId })
  const active = lifecycle.memories.find((memory) => memory.statement === '请用英文回答'); assert(active)
  await ipc('deleteAgentMemory', { localProjectId: projectId, memoryId: active.memoryId, expectedRevision: active.currentRevision,
    expectedHeadVersion: active.headVersion, expectedContentDigest: active.contentDigest, expectedProvenanceDigest: active.provenanceDigest })
  await processed((status) => status.jobs.every((job) => job.status !== 'cleanup_pending'))
  await close(model); modelClosed = true
  await close(hindsight); hindsightClosed = true
  const countBefore = providerRequests.length; const retainsBefore = retainCalls
  const manual = await ipc<AutomaticMemoryStatus>('rememberConversationMemory', { projectId, conversationId: ruleConversation.id,
    messageId: ruleConversation.messages.filter((message) => message.role === 'assistant').at(-1)!.id,
    statement: '排障时先核对当前构建的日志版本', pin: true })
  assert(manual.decisions.some((decision) => decision.manual && decision.pin && decision.resolution === 'saved'))
  assert.equal(providerRequests.length, countBefore); assert.equal(retainCalls, retainsBefore)
  reports.push('provider-and-hindsight-offline-manual-save-and-pin')
  await app.close(); app = undefined; await launch()
  await ipc('processAutomaticMemory', { projectId })
  const restored = await ipc<AgentMemoryRendererSnapshot>('listAgentMemoryLifecycle', { localProjectId: projectId })
  assert(!restored.memories.some((memory) => memory.memoryId === active.memoryId && memory.lifecycleStatus === 'active'))
  assert.equal((await ipc<LocalExecutionState>('loadState')).runs.length, 0)
  reports.push('delete-cleanup-and-restart-without-resurrection')
  assert.deepEqual(requestErrors, [])
  const report = { status: 'passed', paidModels: false, realHindsight: false, realElectron: true, checks: reports,
    modelCalls: providerRequests.length, retainCalls, deleteCalls, remoteDocumentsRemaining: remoteDocuments.size }
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report))
} finally {
  await app?.close()
  if (!modelClosed) await close(model)
  if (!hindsightClosed) await close(hindsight)
  await stopProcess(team?.process)
  await rm(workspace.tempRoot, { recursive: true, force: true })
}
