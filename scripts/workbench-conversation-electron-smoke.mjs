import { execFile, spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { _electron as electron, expect } from '@playwright/test'
import { resolveE2eRuntime } from './e2e-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const temp = await mkdtemp(path.join(os.tmpdir(), 'devflow-workbench-smoke-'))
const repository = path.join(temp, 'task-list')
const userData = path.join(temp, 'user-data')
const output = path.join(root, 'out', 'workbench-conversation-qa')
await mkdir(repository, { recursive: true }); await mkdir(output, { recursive: true })
const git = (args) => promisify(execFile)('git', args, { cwd: repository })
await writeFile(path.join(repository, 'package.json'), JSON.stringify({ name: 'task-list', version: '1.0.0', scripts: { test: 'node --test' } }))
await writeFile(path.join(repository, 'tasks.js'), 'export function clearDone(tasks) { return tasks.filter(task => !task.done) }\n')
await writeFile(path.join(repository, 'README.md'), '# 中文任务清单\n\n清理已完成任务，保留未完成任务。\n')
await mkdir(path.join(repository, 'docs', 'knowledge'), { recursive: true })
await writeFile(path.join(repository, 'docs', 'knowledge', 'cleanup.md'), '---\ntitle: 任务清理规范\ncategory: development_standard\nstages: [clarify, build]\nsummary: 清理规则。\n---\n# 任务清理规范\n\n清理只删除已完成任务，未完成任务的顺序保持不变。\n')
await git(['init', '-b', 'main']); await git(['config', 'user.email', 'smoke@example.invalid']); await git(['config', 'user.name', 'DevFlow Smoke'])
await git(['add', '.']); await git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Test fixture'])
const before = (await git(['status', '--porcelain'])).stdout
const requests = []
const modelErrors = []
const { apiPort, apiUrl } = await resolveE2eRuntime()
const sessionSecret = 'workbench-smoke-isolated-session-secret-32'
let apiProcess
let apiOutput = ''
async function startTeamFixture() {
  apiProcess = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: path.join(root, 'apps/api'),
    env: { ...process.env, DATABASE_URL: '', DEVFLOW_DATABASE_URL: '', DEVFLOW_ENABLE_DEMO_DATA: 'true',
      DEV_AUTH_ENABLED: 'true', DEVFLOW_SESSION_SECRET: sessionSecret, PORT: String(apiPort),
      HOST: '127.0.0.1', DEVFLOW_GITHUB_APP_ID: '', DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64: '',
      DEVFLOW_API_DIAGNOSTICS_PATH: path.join(temp, 'api-diagnostics.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [apiProcess.stdout, apiProcess.stderr]) stream.on('data', (chunk) => { apiOutput = (apiOutput + chunk).slice(-10000) })
  for (let attempt = 0; attempt < 90; attempt++) {
    if (apiProcess.exitCode !== null) throw new Error(`Isolated Team API exited: ${apiOutput}`)
    if (await fetch(`${apiUrl}/ready`).then((response) => response.ok).catch(() => false)) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Isolated Team API did not become ready: ${apiOutput}`)
}
async function teamPost(route, body) {
  const payload = Buffer.from(JSON.stringify({ v: 1, authAccountId: 'acct-demo-u-erich', expiresAt: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const signature = createHmac('sha256', sessionSecret).update(payload).digest('base64url')
  const response = await fetch(`${apiUrl}${route}`, { method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `devflow_session=${payload}.${signature}` }, body: JSON.stringify(body) })
  expect(response.status).toBe(201)
  return response.json()
}
let run
let failureSeen = false
let malformedAttempts = 0
let releaseReasoning
const reportedUsage = (prompt = 40, completion = 12) => ({ prompt_tokens: prompt, completion_tokens: completion,
  total_tokens: prompt + completion, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: prompt })
const server = createServer(async (request, response) => {
  try {
  const chunks = []; for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  requests.push(body)
  expect(body).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'low', stream: true })
  const input = JSON.parse(body.messages.filter((message) => message.role === 'user').at(-1).content)
  expect(body.max_tokens).toBe(65536)
  expect(input.originalRequirements).toContainEqual(expect.objectContaining({ runId: run.id, content: run.request, truncated: false }))
  const user = input.history.filter((message) => message.role === 'user').at(-1)?.text ?? ''
  const observations = input.toolObservations
  let value
  if (user.includes('格式恢复') && malformedAttempts++ === 0) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: '{broken json', reasoning_content: '受控格式失败' }, finish_reason: 'stop' }], usage: reportedUsage() }))
    return
  }
  if (user.includes('失败重试') && !failureSeen) { failureSeen = true; response.writeHead(503); response.end('{}'); return }
  if (user.includes('停止调查')) {
    const timer = setTimeout(() => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: '延迟响应' }) } }], usage: reportedUsage(10, 2) })) }, 5000)
    response.once('close', () => clearTimeout(timer)); return
  }
  if (body.tools && user.includes('原生只读验证')) {
    const completedTools = body.messages.filter(message => message.role === 'tool')
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (!completedTools.length) {
      const calls = [
        {index:0,id:'native-list',type:'function',function:{name:'repo_list',arguments:'{"path":"."}'}},
        {index:1,id:'native-read',type:'function',function:{name:'repo_read',arguments:'{"path":"tasks.js"}'}},
      ]
      response.write(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',reasoning_content:'NATIVE_REQUIRED_HISTORY',tool_calls:calls},finish_reason:'tool_calls'}],usage:reportedUsage()})}\n\n`)
    } else {
      expect(completedTools.map(message => message.tool_call_id)).toEqual(['native-list','native-read'])
      expect(body.messages.some(message => message.role === 'assistant' && message.reasoning_content === 'NATIVE_REQUIRED_HISTORY')).toBe(true)
      response.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:JSON.stringify({text:'原生工具已核实清理函数保留未完成任务。',citationIds:['source-2']})},finish_reason:'stop'}],usage:reportedUsage()})}\n\n`)
    }
    response.end('data: [DONE]\n\n'); return
  }
  if (input.proposalVerification) {
    expect(input.proposalVerification.content).toContain('清理所有已完成任务')
    value = { coverageReview: input.criticalProposalInput.criteria.map((criterion) => ({ criterionId: criterion.id, status: 'covered', reason: '受控提案保留原始清理范围、未完成任务和持久化要求。' })) }
  } else if (user.includes('格式恢复')) {
    value = { format: 'markdown', text: '**格式恢复成功，原始需求仍然完整。**' }
  } else if (user.includes('流式推理验证')) {
    value = { format: 'markdown', text: '**这是独立展示的最终回答。**\n\n- 依据：当前流程\n- 下一步：核对需求' }
  } else if (user.includes('检查全部节点')) {
    const index = observations.length
    value = index < run.nodes.length
      ? { tool: { name: 'node', args: { runId: run.id, nodeId: run.nodes[index].id } } }
      : { text: `已检查全部 ${run.nodes.length} 个节点，覆盖需求、方案、开发、测试、交付和验收。当前在需求澄清；下游尚未开始。`, actions: run.nodes.map((node) => ({ label: `定位：${node.title}`, runId: run.id, nodeId: node.id, section: '状态' })) }
  } else if (user.includes('调查代码')) {
    // knowledge-context K3: list the knowledge directory, then read one standard by path.
    if (observations.length === 2) {
      expect(observations[1]).toMatchObject({ name: 'knowledge_list', result: { knowledgeRoot: 'docs/knowledge', totalDocuments: 1, documents: [expect.objectContaining({ path: 'docs/knowledge/cleanup.md', stages: ['clarify', 'build'] })] } })
    }
    if (observations.length === 3) {
      expect(observations[2]).toMatchObject({ name: 'knowledge_read', result: { kind: 'knowledge_document', path: 'docs/knowledge/cleanup.md' } })
      expect(observations[2].result.content).toContain('清理只删除已完成任务')
    }
    value = observations.length === 0 ? { tool: { name: 'repo_read', args: { path: 'tasks.js' } } }
      : observations.length === 1 ? { tool: { name: 'knowledge_list', args: { stage: 'clarify' } } }
      : observations.length === 2 ? { tool: { name: 'knowledge_read', args: { path: 'docs/knowledge/cleanup.md' } } }
      : { text: '代码使用 filter 保留未完成任务；项目文档要求一致。还有一个产品行为需要确认。', question: { prompt: '清理之后需要支持撤销吗？', options: ['需要撤销', '不需要撤销'] }, citationIds: ['source-1', 'source-3'] }
  } else if (user.includes('不需要撤销')) {
    value = { text: '已记录：不增加撤销操作。可以将这份提案保存到需求节点供后续流程使用。', question: { purpose: 'save_proposal', prompt: '将这份草稿保存到需求节点吗？', options: ['保存', '继续讨论'] }, draft: { runId: run.id, nodeId: run.nodes[0].id, title: '清理已完成任务', content: '清理所有已完成任务，保留未完成任务；刷新保留清理结果；没有已完成任务时按钮禁用；本次不增加撤销功能。' } }
  } else if (user.includes('查询共享提案')) {
    value = observations.length === 0 ? { tool: { name: 'node', args: { runId: run.id, nodeId: run.nodes[0].id } } }
      : { text: '已查到保存的讨论提案。它仍待确认，尚未批准需求 Gate。', actions: [{ label: '查看需求产物', runId: run.id, nodeId: run.nodes[0].id, section: '产物' }] }
  } else {
    const node = run.nodes.find((node) => node.kind === 'test')
    value = observations.length === 0 ? { tool: { name: 'node', args: { runId: run.id, nodeId: node.id } } }
      : { text: '测试节点尚未执行。可以打开节点查看证据与下一步操作。', actions: [{ label: '查看测试节点', runId: run.id, nodeId: node.id, section: '测试证据' }] }
  }
  if (input.criticalProposalInput && value.draft) value.draft.coverage = input.criticalProposalInput.criteria.map((criterion) => ({ criterionId: criterion.id, sourceQuote: criterion.text, proposalQuote: value.draft.content }))
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.write(`data: ${JSON.stringify({ id: 'controlled-response', choices: [{ index: 0, delta: { reasoning_content: '先核对当前工作流，再检查相关节点的真实状态。REASONING_LOCAL_ONLY。' }, finish_reason: null }] })}\n\n`)
  const finish = () => response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: JSON.stringify(value) }, finish_reason: 'stop' }], usage: reportedUsage() })}\n\ndata: [DONE]\n\n`)
  if (user.includes('流式推理验证')) releaseReasoning = finish
  else finish()
  } catch (error) {
    modelErrors.push(error.message)
    response.writeHead(500, { 'content-type': 'application/json' }).end('{}')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const modelUrl = `http://127.0.0.1:${server.address().port}/v1`
let app
let page
const errors = []
async function launch() {
  app = await electron.launch({ args: ['.'], cwd: path.join(root, 'apps/desktop'), env: { ...process.env, DEVFLOW_USER_DATA_DIR: userData, DEVFLOW_DATA_PROFILE_REGISTRY_PATH: path.join(userData, 'profiles.json'), DEVFLOW_API_BASE_URL: apiUrl, DEVFLOW_ENABLE_FAKE_RUNTIME: 'true', DEVFLOW_NATIVE_READONLY_PILOT_ENABLED: '1', DEVFLOW_INITIAL_THEME: 'dark', VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
  // Keep this synthetic-credential test independent of a user's OS keychain authorization.
  await app.evaluate(({ safeStorage }) => {
    safeStorage.isAsyncEncryptionAvailable = async () => true
    safeStorage.encryptStringAsync = async (value) => Buffer.from(`isolated-smoke:${value}`)
    safeStorage.decryptStringAsync = async (bytes) => {
      if (!bytes.toString().startsWith('isolated-smoke:')) throw new Error('Unexpected test credential')
      return { result: bytes.toString().slice('isolated-smoke:'.length), shouldReEncrypt: false }
    }
  })
  // Only this isolated test process redirects the external API boundary; no real model request.
  await app.evaluate((_, endpoint) => {
    const original = globalThis.fetch
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      if (url.hostname === 'api.deepseek.com') return original(`${endpoint}${url.pathname}`, init)
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Smoke test blocks external requests')
      return original(input, init)
    }
  }, modelUrl)
  page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1672, 973))
  page.on('pageerror', (error) => errors.push(error.message))
}
async function readyText(text) { await expect(page.getByText(text, { exact: false }).last()).toBeVisible({ timeout: 30000 }) }
async function send(text) {
  await page.getByRole('textbox', { name: '对话内容' }).fill(text)
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
}
async function openDetails(tab = page.locator('.workspace-tabs [aria-selected="true"]')) {
  await tab.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '会话详情', exact: true }).click()
  return page.getByRole('dialog', { name: '会话详情', exact: true })
}
async function checkExecutor(executor) {
  const dialog = await openDetails()
  await expect(dialog.locator('dd').filter({ hasText: new RegExp(`^${executor}$`) })).toHaveCount(1)
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
}
try {
  await startTeamFixture()
  const team = await teamPost('/api/team/projects', { name: 'Workbench Conversation Smoke', slug: `workbench-smoke-${Date.now()}`, repository: 'local/workbench-smoke', description: 'Isolated no-cost conversation and persistence test.' })
  const pairing = await teamPost(`/api/team/projects/${encodeURIComponent(team.id)}/pairing-codes`, {})
  await launch()
  await app.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }) }, repository)
  const project = await page.evaluate(() => window.aiDevFlowDesktop.selectLocalProject())
  await page.evaluate((input) => window.aiDevFlowDesktop.pairDesktop(input), { code: pairing.code, localProjectId: project.id })
  await page.evaluate((projectId) => window.aiDevFlowDesktop.saveCodingRuntimeBudgetPolicy({ projectId, enabled: true, monthlyLimitUsd: 1, warningThresholdUsd: 0.5 }), project.id)
  await page.evaluate(() => window.aiDevFlowDesktop.saveAgentProviderCredential({ name: 'DeepSeek 流式测试模型', providerId: 'workbench-smoke', model: 'deepseek-flash', apiKey: 'sk-test-workbench-only', baseUrl: 'https://api.deepseek.com' }))
  await page.evaluate(() => window.aiDevFlowDesktop.saveSettings({ selectedAgentProviderId: 'workbench-smoke', themePreference: 'dark' }))
  run = await page.evaluate((projectId) => window.aiDevFlowDesktop.createRun({ title: '为任务清单增加清除已完成功能', request: '清理已完成任务，保留未完成任务并保存结果。', projectId, creatorId: 'u-erich', branchName: 'ai/clear-done' }), project.id)
  await page.reload()
  await expect(page.getByTestId('workflow-canvas')).toBeVisible()
  const chooseBoardView = async (name) => {
    const menu = page.locator('details.workbench-project-menu')
    if ((await menu.getAttribute('open')) === null) await menu.locator(':scope > summary').click()
    await page.getByTestId('task-menu-usage').getByRole('group', { name: '看板展示方式' }).getByRole('button', { name, exact: true }).click()
    await menu.locator(':scope > summary').click()
  }
  await chooseBoardView('流程视图')
  const checked = []
  for (const node of run.nodes) {
    await page.getByTestId(`flow-node-${node.id}`).click()
    await expect(page.getByRole('tab', { name: '节点详情', exact: true })).toHaveCount(0)
    const inspector = page.getByTestId('node-inspector')
    await expect(inspector).toBeVisible()
    const tabs = await inspector.locator('.workspace-primary-tabs').getByRole('tab').all()
    const tabNames = []
    for (const tab of tabs) { tabNames.push(await tab.innerText()); await tab.click(); await expect(tab).toHaveAttribute('aria-selected', 'true') }
    for (const chip of await page.getByTestId(`workflow-card-${node.id}`).locator('.artifact-chip').all()) {
      await chip.click(); await expect(inspector).toBeVisible()
    }
    checked.push({ nodeId: node.id, stage: node.stage, kind: node.kind, tabs: tabNames })
  }
  await page.getByTestId(`flow-node-${run.nodes[0].id}`).click()
  await page.locator('.stage-grid').evaluate((element) => { element.scrollTop = 0; element.scrollLeft = 0 })
  await page.getByTestId('node-inspector').getByRole('tab', { name: '当前工作', exact: true }).click()
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15000 })
  await page.screenshot({ scale: 'css', path: path.join(output, '01-node-details.png') })
  await chooseBoardView('列表视图')
  for (const node of run.nodes) await expect(page.getByTestId(`flow-node-${node.id}`)).toBeAttached()
  await chooseBoardView('流程视图')
  // An empty discussion starts collapsed and takes no column until opened (plan L3).
  await expect(page.getByTestId('workbench-workspace')).toBeHidden()
  const discussionToggle = page.getByRole('button', { name: '讨论', exact: true })
  await expect(discussionToggle).toHaveAttribute('aria-expanded', 'false')
  await discussionToggle.click()
  await expect(page.getByTestId('workbench-workspace')).toBeVisible()
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await page.getByRole('button', { name: '创建对话', exact: true }).click()
  await send('流式推理验证')
  await expect(page.getByRole('button', { name: /推理过程.*生成中/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText(/先核对当前工作流.*REASONING_LOCAL_ONLY/)).toBeVisible()
  await expect(page.getByText('这是独立展示的最终回答。', { exact: true })).toHaveCount(0)
  await page.getByTestId('workbench-workspace').screenshot({ scale: 'css', path: path.join(output, '00-live-reasoning.png') })
  const callsWhileRunning = requests.length
  const runningDetails = await openDetails()
  await expect(runningDetails).toContainText('正在调查')
  await page.keyboard.press('Escape')
  expect(requests.length).toBe(callsWhileRunning)
  await expect(page.getByRole('button', { name: '停止调查', exact: true })).toBeVisible()
  releaseReasoning()
  await readyText('这是独立展示的最终回答。')
  await expect(page.locator('.message-markdown strong')).toHaveText('这是独立展示的最终回答。')
  await expect(page.locator('.message-markdown li')).toHaveCount(2)
  await expect(page.getByRole('button', { name: /推理过程.*已结束/ })).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: /推理过程.*已结束/ }).click()
  await expect(page.getByText(/先核对当前工作流.*REASONING_LOCAL_ONLY/)).toBeVisible()
  await send('检查全部节点的真实进展。')
  await readyText(`已检查全部 ${run.nodes.length} 个节点`)
  await send('调查代码和知识后帮我澄清需求。')
  await readyText('清理之后需要支持撤销吗？')
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15000 })
  await page.screenshot({ scale: 'css', path: path.join(output, '02-conversation-question.png') })
  await page.getByTestId('workbench-workspace').screenshot({ scale: 'css', path: path.join(output, '02-conversation-detail.png') })
  await page.getByRole('button', { name: '不需要撤销', exact: true }).click()
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  // Saving a proposal first previews the target and content; nothing is saved until confirmed (W8).
  await page.getByRole('button', { name: '保存为节点提案', exact: true }).click()
  const proposalPreview = page.getByTestId('proposal-publish-preview')
  await expect(proposalPreview).toContainText('将保存到：')
  await expect(proposalPreview).toContainText('不会更新正式需求，也不会推进流程')
  await page.screenshot({ scale: 'css', path: path.join(output, '13-proposal-preview.png') })
  // Count model calls only once the conversation is idle, so earlier verification calls are excluded.
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible({ timeout: 30000 })
  const callsBeforeProposal = requests.length
  await proposalPreview.getByRole('button', { name: '确认保存提案', exact: true }).click()
  await readyText('提案已保存，尚未更新正式需求')
  expect(requests.length).toBe(callsBeforeProposal)
  await expect(page.getByText('已保存提案', { exact: true })).toBeVisible()
  // 「讨论此材料」 adds a reference card to this conversation without sending or calling a model (W7).
  const callsBeforeReference = requests.length
  await page.getByTestId('node-inspector').getByRole('button', { name: '讨论此材料' }).first().click()
  const referenceCard = page.getByTestId('conversation-reference-card')
  await expect(referenceCard).toHaveCount(1)
  await expect(referenceCard).toContainText('读取于')
  expect(requests.length).toBe(callsBeforeReference)
  await page.screenshot({ scale: 'css', path: path.join(output, '14-discussion-reference.png') })
  await referenceCard.getByRole('button', { name: /^移除引用：/ }).click()
  await expect(page.getByTestId('conversation-reference-card')).toHaveCount(0)
  await openDetails()
  await expect(page.getByRole('textbox', { name: '仅本会话记忆' })).toHaveCount(0)
  await expect(page.getByText(/上次使用.*条本会话消息/)).toHaveCount(0)
  const help = page.getByRole('button', { name: '了解会话信息' })
  await help.click()
  const helpDialog = page.getByRole('dialog', { name: '会话说明' })
  await expect(helpDialog).toContainText('B 聊天不会自动知道')
  await expect(helpDialog).toContainText('保存提案不会共享整段聊天')
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: '关闭说明', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: '关闭会话说明', exact: true })).toBeFocused()
  await page.screenshot({ scale: 'css', path: path.join(output, '08-conversation-help.png') })
  await page.keyboard.press('Escape')
  await expect(help).toBeFocused()
  await help.click()
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(360, 480); window.setSize(480, 600) })
  await expect(page.getByRole('button', { name: '关闭说明', exact: true })).toBeInViewport()
  expect(await helpDialog.locator('.conversation-dialog-body').evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await page.screenshot({ scale: 'css', path: path.join(output, '09-conversation-help-narrow.png') })
  await page.getByRole('button', { name: '关闭说明', exact: true }).click()
  await expect(help).toBeFocused()
  await expect(page.getByRole('button', { name: '关闭详情', exact: true })).toBeInViewport()
  expect(await page.getByRole('dialog', { name: '会话详情', exact: true }).locator('.conversation-dialog-body').evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await page.screenshot({ scale: 'css', path: path.join(output, '12-conversation-details-narrow.png') })
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1672, 973))
  const beforeCancel = await page.evaluate((projectId) => window.aiDevFlowDesktop.workbenchConversation({ type: 'list', projectId }), project.id)
  const beforeCancelCalls = requests.length
  const activeTabBeforeCancel = await page.locator('.workspace-tabs [aria-selected="true"]').getAttribute('id')
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await page.getByLabel('新对话执行方式').selectOption('opencode')
  await page.screenshot({ scale: 'css', path: path.join(output, '10-create-conversation.png') })
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect((await page.evaluate((projectId) => window.aiDevFlowDesktop.workbenchConversation({ type: 'list', projectId }), project.id)).conversations.length).toBe(beforeCancel.conversations.length)
  expect(await page.locator('.workspace-tabs [aria-selected="true"]').getAttribute('id')).toBe(activeTabBeforeCancel)
  expect(requests.length).toBe(beforeCancelCalls)
  await expect(page.getByLabel('新对话执行方式')).toHaveCount(0)
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await page.getByRole('button', { name: '创建对话', exact: true }).click()
  const secondStart = requests.length
  await send('查询共享提案，然后告诉我测试阶段的进度。')
  await readyText('已查到保存的讨论提案')
  expect(JSON.stringify(requests.slice(secondStart))).not.toContain('ALPHA_PRIVATE_MEMORY')
  const nodeResults = requests.slice(secondStart).map((request) => JSON.parse(request.messages.find((message) => message.role === 'user').content)).flatMap((input) => input.toolObservations)
  expect(JSON.stringify(nodeResults)).toContain('讨论提案（待确认）')
  await page.getByRole('button', { name: '查看需求产物 ↗', exact: true }).click()
  // The conversation's legacy section name resolves to the new tab (plan W1).
  await expect(page.getByTestId('node-inspector').getByRole('tab', { name: '材料与版本', exact: true })).toHaveAttribute('aria-selected', 'true')
  // The saved proposal is listed there once, marked as pending confirmation (plan W8).
  await expect(page.getByTestId('node-artifacts')).toContainText('讨论提案（待确认）')
  const secondTab = page.getByRole('tab', { name: /查询共享提案/ })
  await secondTab.click()
  const recoveryStart = requests.length
  await send('格式恢复验证')
  await readyText('格式恢复成功，原始需求仍然完整。')
  expect(requests.length - recoveryStart).toBe(2)
  await expect(page.getByText(/本步骤调用未完成；正在自动重试/)).toBeVisible()
  await expect(page.getByRole('button', { name: '重试这一步', exact: true })).toHaveCount(0)
  await page.screenshot({ scale: 'css', path: path.join(output, '07-format-recovery.png') })
  // A failed call retains its known bound. The same operation can recover without reconciling a fake bill.
  const beforeTransient = requests.length
  await send('失败重试场景，请查询测试进度。')
  await readyText('测试节点尚未执行')
  expect(requests.length - beforeTransient).toBe(3)
  const afterTransient = await page.evaluate((projectId) => window.aiDevFlowDesktop.getModelCostRecovery({ projectId }), project.id)
  expect(afterTransient.overview.pendingBoundedCostUsd).toBeGreaterThan(0)
  expect(afterTransient.overview.records.some(row => row.costUsd === null && row.verifiedHoldUsd > 0)).toBe(true)
  // Exercise the real single-action continuation card, with this isolated team's budget still enabled.
  await page.evaluate((projectId) => window.aiDevFlowDesktop.saveCodingRuntimeBudgetPolicy({ projectId, enabled: true, monthlyLimitUsd: 0.01, warningThresholdUsd: 0.005 }), project.id)
  const beforeConsent = requests.length
  await send('确认预算后查询测试进度。')
  const continuation = page.getByRole('region', { name: '预算继续确认', exact: true })
  await expect(continuation).toBeVisible({ timeout: 30000 })
  expect(requests.length).toBe(beforeConsent)
  await expect(continuation.getByRole('checkbox')).not.toBeChecked()
  await continuation.getByRole('checkbox').click()
  await expect(continuation).toHaveCount(0)
  await expect.poll(() => requests.length - beforeConsent).toBe(2)
  await expect(page.getByRole('button', { name: '停止调查', exact: true })).toHaveCount(0)
  await readyText('测试节点尚未执行')
  // Return the dedicated fixture budget to its initial limit; no real cost record is edited.
  await page.evaluate((projectId) => window.aiDevFlowDesktop.saveCodingRuntimeBudgetPolicy({ projectId, enabled: true, monthlyLimitUsd: 10, warningThresholdUsd: 5 }), project.id)
  await send('停止调查场景')
  await page.getByRole('button', { name: '停止调查', exact: true }).click()
  await readyText('已停止调查')
  await page.getByRole('textbox', { name: '对话内容' }).fill('重启后继续输入')
  await page.getByTestId('node-inspector').getByRole('tab', { name: '当前工作', exact: true }).click()
  await secondTab.click()
  const persisted = await page.evaluate((projectId) => window.aiDevFlowDesktop.workbenchConversation({ type: 'list', projectId }), project.id)
  expect(persisted.conversations).toHaveLength(2)
  await expect.poll(async () => (await page.evaluate((projectId) => window.aiDevFlowDesktop.workbenchConversation({ type: 'list', projectId }), project.id)).conversations.some((item) => item.inputDraft === '重启后继续输入')).toBe(true)
  await app.close(); app = undefined
  await launch()
  await expect(page.getByRole('textbox', { name: '对话内容' })).toHaveValue('重启后继续输入')
  // A real persisted OpenCode conversation can coexist and reopen without starting a model.
  const directTabId = await page.locator('.workspace-tabs [aria-selected="true"]').getAttribute('id')
  const callsBeforeOpenCode = requests.length
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await page.getByLabel('新对话执行方式').selectOption('opencode')
  await page.getByRole('button', { name: '创建对话', exact: true }).click()
  await checkExecutor('OpenCode')
  const openCodeTabId = await page.locator('.workspace-tabs [aria-selected="true"]').getAttribute('id')
  await page.locator(`[id="${directTabId}"]`).click()
  await checkExecutor('Direct Provider')
  await expect(page.getByRole('textbox', { name: '对话内容' })).toHaveValue('重启后继续输入')
  await app.close(); app = undefined
  await launch()
  await page.locator(`[id="${openCodeTabId}"]`).click()
  await checkExecutor('OpenCode')
  await page.locator(`[id="${directTabId}"]`).click()
  await expect(page.getByRole('textbox', { name: '对话内容' })).toHaveValue('重启后继续输入')
  // Inspect an inactive tab without selecting it or remounting the active message pane.
  const messages = page.getByLabel('当前会话消息')
  await messages.evaluate((element) => { element.scrollTop = 0 })
  const scrollBefore = await messages.evaluate((element) => element.scrollTop)
  const paneBefore = await messages.boundingBox()
  const directActive = page.locator(`[id="${directTabId}"]`)
  await openDetails(page.locator(`[id="${openCodeTabId}"]`))
  await expect(page.getByLabel('会话名称')).toHaveValue('新对话')
  const longTitle = '用于核对另一个会话的独立详情、模型调用记录和重启后历史保留情况的长标题'
  await page.getByLabel('会话名称').fill(longTitle)
  await page.getByRole('button', { name: '保存名称', exact: true }).click()
  await expect(page.locator(`[id="${openCodeTabId}"]`)).toHaveAttribute('title', longTitle)
  await expect(directActive).toHaveAttribute('aria-selected', 'true')
  expect(await messages.boundingBox()).toEqual(paneBefore)
  await page.screenshot({ scale: 'css', path: path.join(output, '11-inactive-conversation-details.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '会话详情', exact: true })).toHaveCount(0)
  expect(await messages.evaluate((element) => element.scrollTop)).toBe(scrollBefore)
  await expect(page.getByRole('textbox', { name: '对话内容' })).toHaveValue('重启后继续输入')
  await directActive.focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menuitem', { name: '会话详情' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(directActive).toBeFocused()
  await expect(page.locator('.conversation-head')).toHaveCount(0)
  const tabStrip = await page.locator('.workspace-tab-strip').boundingBox()
  expect(Math.abs(paneBefore.y - tabStrip.y - tabStrip.height)).toBeLessThanOrEqual(2)
  expect(requests.length).toBe(callsBeforeOpenCode)
  await page.screenshot({ scale: 'css', path: path.join(output, '03-restored-tabs.png') })
  await page.getByRole('button', { name: /关闭会话 Tab：查询共享提案/ }).click()
  await page.getByRole('button', { name: '会话历史', exact: true }).click()
  await page.getByRole('button', { name: /查询共享提案.*已停止/ }).click()
  await expect(page.getByRole('textbox', { name: '对话内容' })).toHaveValue('重启后继续输入')
  // The theme is set in 设置／外观 since S3 (plan Y5); the discussion and its draft survive the trip.
  const navigation = page.locator('aside[aria-label="Primary navigation"]')
  await navigation.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('button', { name: '外观', exact: true }).click()
  for (let attempt = 0; attempt < 3 && await page.locator('html').getAttribute('data-theme') !== 'light'; attempt++) await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await navigation.getByRole('button', { name: /^任务中心/ }).click()
  await page.getByRole('button', { name: `继续任务：${run.title}`, exact: true }).click()
  await expect(page.getByRole('textbox', { name: '对话内容' })).toHaveValue('重启后继续输入')
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15000 })
  await page.screenshot({ scale: 'css', path: path.join(output, '04-light-workspace.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 973))
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: '新建对话', exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: '会话历史', exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeInViewport()
  await expect.poll(async () => (await page.getByRole('button', { name: '新建任务', exact: true }).boundingBox()).x + (await page.getByRole('button', { name: '新建任务', exact: true }).boundingBox()).width).toBeLessThanOrEqual(1280)
  await page.screenshot({ scale: 'css', path: path.join(output, '05-narrow-workspace.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 760))
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().height)).toBe(760)
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeInViewport()
  expect((await page.getByLabel('当前会话消息').boundingBox()).height).toBeGreaterThan(100)
  await page.screenshot({ scale: 'css', path: path.join(output, '13-short-window.png') })
  for (const width of [1366, 1920]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 973), width)
    // One-row top bar with four controls (plan L1, Y5): the theme moved to 设置／外观.
    for (const control of [page.getByRole('button', { name: /^团队连接：/ }), page.getByRole('button', { name: '新建任务', exact: true })]) await expect(control).toBeInViewport()
    await expect(page.locator('.topbar').getByTestId('theme-toggle')).toHaveCount(0)
    expect((await page.locator('.topbar').boundingBox()).height).toBeLessThanOrEqual(56)
    expect(await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ scale: 'css', path: path.join(output, `06-header-${width}.png`) })
  }
  // Diagnostics are 设置／高级 (plan Y2); four primary entries (Y1).
  const primaryNav = page.locator('aside[aria-label="Primary navigation"]')
  await expect(primaryNav.getByRole('button')).toHaveText([/^任务中心/, '知识', '团队', '设置'])
  await expect(page.getByTestId('data-profile-diagnostics')).toHaveCount(0)
  await primaryNav.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('button', { name: '高级', exact: true }).click()
  await expect(page.getByTestId('data-profile-diagnostics')).toBeVisible()
  await primaryNav.getByRole('button', { name: /^任务中心/ }).click()
  await page.getByRole('button', { name: `继续任务：${run.title}`, exact: true }).click()
  const beforeNative = requests.length
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await page.getByLabel('新对话执行方式').selectOption('native-tools')
  await page.getByRole('button', { name: '创建对话', exact: true }).click()
  await send('原生只读验证：列出目录、读取 tasks.js，并给出带引用的结论。')
  await readyText('原生工具已核实清理函数保留未完成任务。')
  expect(requests.length - beforeNative).toBe(2)
  const nativeSessions = await page.evaluate((projectId) => window.aiDevFlowDesktop.workbenchConversation({type:'list',projectId}), project.id)
  const native = nativeSessions.conversations.find(conversation => conversation.executor === 'native-tools')
  expect(native.messages.at(-1).citations[0].label).toContain('tasks.js')
  expect(native.messages.filter(message => message.role === 'tool')).toHaveLength(2)
  expect(native.status).toBe('idle')
  const state = await page.evaluate(() => window.aiDevFlowDesktop.loadState())
  expect(state.runs[0].currentNodeId).toBe(run.currentNodeId)
  expect(state.artifacts.some((artifact) => artifact.title.includes('讨论提案（待确认）'))).toBe(true)
  expect(JSON.stringify(state)).not.toContain('ALPHA_PRIVATE_MEMORY')
  expect(JSON.stringify(state)).not.toContain('REASONING_LOCAL_ONLY')
  expect(JSON.stringify(requests)).not.toContain('REASONING_LOCAL_ONLY')
  expect((await git(['status', '--porcelain'])).stdout).toBe(before)
  expect(errors).toEqual([])
  expect(modelErrors).toEqual([])
  const report = { passed: true, checked, modelCalls: requests.length, model: 'controlled local SSE endpoint through the real DeepSeek Provider/IPC/SQLite implementation', reasoningEffort: 'low', liveReasoningBeforeAnswer: true, sourceFilesUnchanged: true, sessionIsolation: true, restartAndHistory: true, helpDialogKeyboardAndNarrowLayout: true, independentTabDetails: true, detailsPreserveLiveRequestAndScroll: true, tabMenuKeyboardAccess: true, noPermanentHeader: true, shortWindow: { width: 1280, height: 760 }, cancelledCreationHasNoEffects: true, executorChoiceSurvivesRestart: true, fullOriginalRequirement: true, boundedFormatRecovery: true, nativeReadOnlyPilot: true, budgetContinuationCheckbox: true, externalProviderCalled: false, generatedAt: new Date().toISOString() }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  if (page) await page.screenshot({ scale: 'css', path: path.join(output, 'failure.png') }).catch(() => undefined)
  throw error
} finally {
  if (app) await app.close().catch(() => undefined)
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve))
  if (apiProcess && apiProcess.exitCode === null) {
    const exited = new Promise((resolve) => apiProcess.once('exit', resolve))
    apiProcess.kill('SIGTERM')
    const timer = setTimeout(() => apiProcess.kill('SIGKILL'), 3000)
    await exited; clearTimeout(timer)
  }
  await rm(temp, { recursive: true, force: true })
}
