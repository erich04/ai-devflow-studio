import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { _electron as electron, expect } from '@playwright/test'

// Explicitly opt in. Copy only an already encrypted local credential into a disposable profile.
// Neither its ciphertext nor its plaintext is printed or sent through the renderer.
const sourceDatabase = process.env.DEVFLOW_WORKBENCH_LIVE_DATABASE
const providerId = process.env.DEVFLOW_WORKBENCH_LIVE_PROVIDER_ID
if (!sourceDatabase || !providerId) throw new Error('Set DEVFLOW_WORKBENCH_LIVE_DATABASE and DEVFLOW_WORKBENCH_LIVE_PROVIDER_ID for this paid, opt-in smoke.')
const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(path.join(root, 'apps/desktop/package.json'))
const SQL = await require('sql.js')()
const source = new SQL.Database(await readFile(sourceDatabase))
const rows = source.exec('select provider_id, json, encrypted_secret, updated_at from provider_credentials where provider_id = ?', [providerId])[0]?.values
source.close()
if (rows?.length !== 1) throw new Error('The selected encrypted Provider is unavailable.')
const metadata = JSON.parse(rows[0][1])
const temp = await mkdtemp(path.join(os.tmpdir(), 'devflow-conversation-live-'))
const repository = path.join(temp, 'task-list')
const userData = path.join(temp, 'user-data')
const output = path.join(root, 'out/workbench-conversation-qa/live-report.json')
const bootstrap = path.join(temp, 'real-keychain-bootstrap.cjs')
const desktopPackage = JSON.parse(await readFile(path.join(root, 'apps/desktop/package.json'), 'utf8'))
// Playwright's Electron loader otherwise forces a mock keychain. Restore the real OS boundary.
await writeFile(bootstrap, `
const { app } = require('electron');
app.commandLine.removeSwitch('use-mock-keychain');
app.commandLine.removeSwitch('password-store');
app.setName(${JSON.stringify(desktopPackage.productName ?? desktopPackage.name)});
globalThis.workbenchLiveRequestChecks = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  if (new URL(String(args[0])).origin !== ${JSON.stringify(new URL(metadata.baseUrl).origin)}) return originalFetch(...args);
  if (globalThis.workbenchLiveRequestChecks.length >= 4) throw new Error('Live probe reached its four-request budget.');
  const check = { attempt: globalThis.workbenchLiveRequestChecks.length + 1 };
  globalThis.workbenchLiveRequestChecks.push(check);
  const response = await originalFetch(...args);
  check.httpStatus = response.status;
  try {
    const body = await response.clone().json();
    const content = body.choices?.[0]?.message?.content;
    check.finishReason = body.choices?.[0]?.finish_reason;
    check.containsMarkdownFence = typeof content === 'string' && content.includes(String.fromCharCode(96).repeat(3));
    try { check.validJson = typeof JSON.parse(content) === 'object'; } catch { check.validJson = false; }
  } catch { check.validJson = false; }
  return response;
};
import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/dist-electron/main.js')).href)});
`)
let app
let page
async function launch() {
  app = await electron.launch({ args: [bootstrap], cwd: path.join(root, 'apps/desktop'), env: {
    ...process.env, DEVFLOW_USER_DATA_DIR: userData,
    DEVFLOW_DATA_PROFILE_REGISTRY_PATH: path.join(temp, 'profiles.json'),
    DEVFLOW_API_BASE_URL: 'http://127.0.0.1:9', DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
    VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  } })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
}
try {
  await mkdir(repository)
  await writeFile(path.join(repository, 'package.json'), JSON.stringify({ name: 'task-list-live-probe', version: '1.0.0', scripts: { test: 'node --test' } }))
  await writeFile(path.join(repository, 'tasks.js'), 'export const clearDone = (tasks) => tasks.filter(task => !task.done)\n')
  const git = (args) => promisify(execFile)('git', args, { cwd: repository })
  await git(['init', '-b', 'main'])
  await git(['add', '.'])
  await git(['-c', 'user.name=DevFlow Probe', '-c', 'user.email=probe@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Isolated probe'])
  await launch()
  await app.evaluate(({ dialog }, localPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [localPath] }) }, repository)
  const project = await page.evaluate(() => window.aiDevFlowDesktop.selectLocalProject())
  const run = await page.evaluate((projectId) => window.aiDevFlowDesktop.createRun({ title: '清理已完成任务', request: '清理已完成任务，保留未完成任务', projectId, creatorId: 'live-probe', branchName: 'ai/probe' }), project.id)
  await app.close(); app = undefined
  const targetPath = path.join(userData, 'devflow.sqlite')
  const target = new SQL.Database(await readFile(targetPath))
  target.run('insert into provider_credentials (provider_id, json, encrypted_secret, updated_at) values (?, ?, ?, ?)', rows[0])
  await writeFile(targetPath, target.export(), { mode: 0o600 })
  target.close()
  await launch()
  const credentialCheck = await app.evaluate(({ safeStorage }, encrypted) => {
    try { return { encryptionAvailable: safeStorage.isEncryptionAvailable(), decryptable: safeStorage.decryptString(Buffer.from(encrypted, 'base64')).length > 0 } }
    catch { return { encryptionAvailable: safeStorage.isEncryptionAvailable(), decryptable: false } }
  }, rows[0][2])
  if (!credentialCheck.decryptable) {
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, JSON.stringify({ passed: false, blockedReason: 'Existing ciphertext cannot be decrypted in the isolated Electron process', model: metadata.model, providerCalls: 0, sourceDatabaseModified: false, credentialCheck, generatedAt: new Date().toISOString() }, null, 2))
    throw new Error('The encrypted credential cannot be reused in this isolated Electron process; no Provider call was made.')
  }
  const created = await page.evaluate((projectId) => window.aiDevFlowDesktop.workbenchConversation({ type: 'create', projectId }), project.id)
  const conversationId = created.conversationId
  const testNode = run.nodes.find((node) => node.kind === 'test')
  const sent = await page.evaluate((input) => window.aiDevFlowDesktop.workbenchConversation(input), {
    type: 'send', projectId: project.id, conversationId, providerId,
    text: `这是只读联调。请先读取 tasks.js，再用 node 工具查看 Run ${run.id} 的测试节点 ${testNode.id}。然后简要解释清理逻辑和测试的真实状态，给出来源和“查看测试证据”按钮。不生成提案、不追问。总共只需两个工具调用后给出答复。`,
  })
  if (sent.error) throw new Error(sent.error)
  let session
  await expect.poll(async () => {
    const result = await page.evaluate((projectId) => window.aiDevFlowDesktop.workbenchConversation({ type: 'list', projectId }), project.id)
    session = result.conversations.find((item) => item.id === conversationId)
    const calls = session?.messages.filter((message) => message.provider).length ?? 0
    if (calls > 4) {
      await page.evaluate((input) => window.aiDevFlowDesktop.workbenchConversation(input), { type: 'cancel', projectId: project.id, conversationId })
      throw new Error('Live probe exceeded its four-call budget.')
    }
    return session?.status
  }, { timeout: 90000, intervals: [500, 1000] }).not.toBe('running')
  const providerRequests = await app.evaluate(() => globalThis.workbenchLiveRequestChecks)
  if (session.status !== 'idle') {
    const failure = { passed: false, status: session.status, failure: session.failure, completedCalls: session.messages.filter((message) => message.provider).length, providerRequests, generatedAt: new Date().toISOString() }
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, JSON.stringify(failure, null, 2))
    console.log(JSON.stringify(failure))
  }
  expect(session.status, session.error).toBe('idle')
  const tools = session.messages.filter((message) => message.role === 'tool')
  expect(tools.some((message) => message.text.includes('repo_read') && message.citations.some((source) => source.excerpt.includes('tasks.filter')))).toBe(true)
  expect(tools.some((message) => message.text.includes('node') && message.citations.some((source) => source.excerpt.includes(testNode.id)))).toBe(true)
  const answer = session.messages.filter((message) => message.role === 'assistant').at(-1)
  expect(answer.actions.some((action) => action.nodeId === testNode.id && action.section === '测试证据')).toBe(true)
  expect((await git(['status', '--porcelain'])).stdout).toBe('')
  await mkdir(path.dirname(output), { recursive: true })
  const report = { passed: true, provider: metadata.name, model: metadata.model,
    calls: session.messages.filter((message) => message.provider).length, providerRequests,
    sourceDatabaseModified: false, sourceCodeModified: false,
    result: answer, usage: session.messages.flatMap((message) => message.usage ? [message.usage] : []),
    generatedAt: new Date().toISOString(),
  }
  await writeFile(output, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ passed: true, model: metadata.model, calls: report.calls, report: output }))
} finally {
  if (app) await app.close().catch(() => undefined)
  await rm(temp, { recursive: true, force: true })
}
