import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect } from '@playwright/test'
import { resolveE2eRuntime } from './e2e-runtime.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = path.join(rootDir, 'apps/desktop')
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const {
  apiPort,
  webPort: modelPort,
  desktopPort,
  apiUrl,
  desktopUrl,
} = await resolveE2eRuntime()
const modelUrl = `http://127.0.0.1:${modelPort}/v1`
const sessionSecret = 'native-coding-electron-smoke-session-secret-32'
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'devflow-native-coding-electron-'))
const repositoryPath = path.join(tempRoot, 'fixture-repository')
const userDataDir = path.join(tempRoot, 'user-data')
const modelRequests = []

function browserSessionHeaders(authAccountId) {
  const claims = {
    v: 1,
    authAccountId,
    expiresAt: Math.floor(Date.now() / 1_000) + 60 * 60,
  }
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  const signature = createHmac('sha256', sessionSecret).update(payload).digest('base64url')
  return { cookie: `devflow_session=${payload}.${signature}` }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      ...options,
    })
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
  })
}

function spawnQuiet(command, args, env = {}) {
  return spawn(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Continue until the bounded startup deadline.
    }
    await delay(500)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const kill = (signal) => {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
    else child.kill(signal)
  }
  try {
    kill('SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(3_000).then(() => false),
  ])
  if (exited === false && child.exitCode === null && child.signalCode === null) {
    try {
      kill('SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

async function readRequestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

// Native v2 sends one shared system prompt; the user JSON's phase field selects the contract.
function nativePhaseOf(body) {
  const userContent = body?.messages?.find((message) => message.role === 'user')?.content
  try {
    return JSON.parse(userContent).phase
  } catch {
    return undefined
  }
}

function modelContentFor(phase) {
  if (phase === 'analysis') {
    return JSON.stringify({
      stateVersion: 2,
      files: ['src/message.js'],
      searches: [],
      summary: 'Inspect the bounded message module.',
    })
  }
  return [
    '```json',
    JSON.stringify({
      stateVersion: 2,
      changes: [{
        path: 'src/message.js',
        replacements: [{ oldText: 'message = "old"', newText: 'message = "new"' }],
      }],
      summary: 'Apply the exact requested message change.',
    }),
    '```',
  ].join('\n')
}

function repositoryReviewContent(body) {
  const input = JSON.parse(body.messages[1].content)
  if (!input.observations?.length) return JSON.stringify({ tool: { name: 'repo_read', args: { path: 'src/message.js' } } })
  expect(input.observations[0].result.content).toContain('message = "old"')
  return JSON.stringify({
    conclusion: 'pass', summary: 'Verified the original message before implementation.',
    confidence: 1, risks: [], missingEvidence: [], suggestedTests: [],
    repositoryFindings: { version: 1, repositoryDigest: '',
      citations: [{ id: 'source', path: 'src/message.js', contentDigest: '', lineStart: 1, lineEnd: 1 }],
      verifiedFacts: [{ id: 'message', statement: 'The original message is old.', citationIds: ['source'] }],
      assumptions: [], openQuestions: [], uncheckedScopes: [],
    },
  })
}

const modelServer = createServer(async (request, response) => {
  try {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const body = await readRequestBody(request)
    const systemPrompt = body?.messages?.[0]?.content
    if (
      request.headers.authorization !== 'Bearer sk-native-electron-smoke' ||
      body?.model !== 'deepseek-flash' ||
      typeof systemPrompt !== 'string'
    ) {
      response.writeHead(400).end()
      return
    }
    modelRequests.push(body)
    const payload = JSON.stringify({
      choices: [{ message: { content: systemPrompt.includes('repo_list|repo_read|repo_search')
        ? repositoryReviewContent(body) : modelContentFor(nativePhaseOf(body)) }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 40 + modelRequests.length,
        completion_tokens: 20,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 40 + modelRequests.length,
      },
    })
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    })
    response.end(payload)
  } catch {
    response.writeHead(500).end()
  }
})

async function listenModelServer() {
  await new Promise((resolve, reject) => {
    modelServer.once('error', reject)
    modelServer.listen(modelPort, '127.0.0.1', resolve)
  })
}

async function closeModelServer() {
  await new Promise((resolve) => {
    if (!modelServer.listening) resolve()
    else modelServer.close(() => resolve())
  })
}

async function createTeamProject() {
  const response = await fetch(`${apiUrl}/api/team/projects`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...browserSessionHeaders('acct-demo-u-erich'),
    },
    body: JSON.stringify({
      name: 'DevFlow Native Electron Smoke',
      slug: `native-coding-${Date.now()}`,
      description: 'Isolated no-cost DevFlow Native Electron acceptance project.',
      repository: 'local/native-coding-electron-smoke',
    }),
  })
  if (response.status !== 201) {
    throw new Error(`Unable to create smoke Team Project: ${response.status} ${await response.text()}`)
  }
  return response.json()
}

async function createPairingCode(projectId) {
  const response = await fetch(`${apiUrl}/api/team/projects/${encodeURIComponent(projectId)}/pairing-codes`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...browserSessionHeaders('acct-demo-u-erich'),
    },
    body: '{}',
  })
  if (response.status !== 201) {
    throw new Error(`Unable to create smoke pairing code: ${response.status} ${await response.text()}`)
  }
  const body = await response.json()
  return body.code
}

function workflowNodes(run) {
  const find = (stage, kind) => run.nodes.find((node) => node.stage === stage && node.kind === kind)
  const result = {
    clarify: find('clarify', 'agent'),
    clarifyGate: find('clarify', 'gate'),
    design: find('design', 'agent'),
    designGate: find('design', 'gate'),
    build: find('build', 'task'),
  }
  if (Object.values(result).some((node) => !node)) {
    throw new Error('DevFlow Native Electron smoke workflow shape is unavailable')
  }
  return result
}

async function completePreBuildWorkflow(page, run, projectId) {
  const nodes = workflowNodes(run)
  let current = run
  for (const [agentNode, gateNode] of [
    [nodes.clarify, nodes.clarifyGate],
    [nodes.design, nodes.designGate],
  ]) {
    const completed = await page.evaluate(async (input) => {
      return window.aiDevFlowDesktop.completeWorkflowAgentNode({
        runId: input.runId,
        nodeId: input.nodeId,
        userId: 'u-erich',
        userName: 'Erich',
        providerId: 'fake-knowledge-review',
      })
    }, { runId: current.id, nodeId: agentNode.id })
    current = completed.run
    const initialReview = await page.evaluate(async (input) => {
      return window.aiDevFlowDesktop.runKnowledgeReview({
        runId: input.runId,
        nodeId: input.nodeId,
        projectId: input.projectId,
        requestedBy: 'u-erich',
        runtime: 'electron',
        providerId: 'fake-knowledge-review',
      })
    }, { runId: current.id, nodeId: gateNode.id, projectId })
    if (gateNode.stage === 'design') {
      await page.evaluate(() => window.aiDevFlowDesktop.saveSettings({ knowledgeReviewExecutor: 'native-agent' }))
      const reviewed = await page.evaluate((input) => window.aiDevFlowDesktop.runKnowledgeReview(input), {
        runId: current.id, nodeId: gateNode.id, projectId, requestedBy: 'u-erich', runtime: 'electron',
        providerId: 'deepseek-native-smoke', executor: 'native-agent',
        previousReviewId: initialReview.review.id,
      })
      expect(reviewed.review.executorKind).toBe('native-agent')
      expect(reviewed.review.repositoryFindings.citations[0]).toMatchObject({
        path: 'src/message.js', contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/), lineStart: 1,
      })
      expect(reviewed.state.runs.find(candidate => candidate.id === current.id).currentNodeId).toBe(gateNode.id)
      expect(await readFile(path.join(repositoryPath, 'src/message.js'), 'utf8')).toBe('export const message = "old"\n')
    }
    const expectedClarificationRevision = completed.artifact.clarificationRevision
      ? {
          artifactId: completed.artifact.id,
          revision: completed.artifact.clarificationRevision.revision,
          revisionDigest: completed.artifact.clarificationRevision.revisionDigest,
        }
      : undefined
    const approved = await page.evaluate(async (input) => {
      const runId = input.runId
      const gateId = input.nodeId
      const isDesignGate = (await window.aiDevFlowDesktop.loadState()).runs.find((candidate) => candidate.id === runId)
        ?.nodes.find((candidate) => candidate.id === gateId)?.stage === 'design'
      return window.aiDevFlowDesktop.approveGate(isDesignGate ? { ...input, expectedDesignRevision: (await (async () => {
      const state = await window.aiDevFlowDesktop.loadState()
      const gate = state.runs.find((candidate) => candidate.id === runId)?.nodes.find((candidate) => candidate.id === gateId)
      const design = state.artifacts.find((artifact) => artifact.runId === runId && artifact.kind === 'design' && gate?.artifactIds.includes(artifact.id))
      if (!design) throw new Error('The design linked to the design Gate is missing')
      // Same digest as createDesignRevisionDigest in packages/shared (plan S4, Z1).
      const bytes = new TextEncoder().encode(JSON.stringify({ title: design.title, summary: design.summary, content: design.content }))
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      return { artifactId: design.id, updatedAt: design.updatedAt, contentDigest: digest }
    })()) } : input)
    }, {
      runId: current.id,
      nodeId: gateNode.id,
      ...(expectedClarificationRevision ? { expectedClarificationRevision } : {}),
    })
    current = approved.run
  }
  expect(current.currentNodeId).toBe(nodes.build.id)
  return { run: current, buildNode: nodes.build }
}

let apiProcess
let viteProcess
let app
const watchdog = setTimeout(() => {
  console.error('Native smoke timed out; closing only its isolated Electron application.', { modelRequests: modelRequests.length })
  void app?.close()
}, 180_000)
try {
  await mkdir(path.join(repositoryPath, 'src'), { recursive: true })
  await writeFile(path.join(repositoryPath, '.gitignore'), 'node_modules\n', 'utf8')
  await writeFile(path.join(repositoryPath, 'src/message.js'), 'export const message = "old"\n', 'utf8')
  await writeFile(
    path.join(repositoryPath, 'test.js'),
    "const fs = require('node:fs'); if (fs.readFileSync('src/message.js', 'utf8') !== 'export const message = \\\"new\\\"\\n') process.exit(1)\n",
    'utf8',
  )
  await writeFile(path.join(repositoryPath, 'package.json'), JSON.stringify({
    name: 'native-coding-electron-smoke',
    version: '1.0.0',
    scripts: { test: 'node test.js' },
  }, null, 2), 'utf8')
  await writeFile(path.join(repositoryPath, 'package-lock.json'), JSON.stringify({
    name: 'native-coding-electron-smoke',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: { '': { name: 'native-coding-electron-smoke', version: '1.0.0' } },
  }, null, 2), 'utf8')
  await runCommand('git', ['init', '-b', 'main'], { cwd: repositoryPath })
  await runCommand('git', ['config', 'user.email', 'native-coding-smoke@example.invalid'], { cwd: repositoryPath })
  await runCommand('git', ['config', 'user.name', 'DevFlow Native Smoke'], { cwd: repositoryPath })
  await runCommand('git', ['add', '.'], { cwd: repositoryPath })
  await runCommand('git', ['commit', '-m', 'baseline'], { cwd: repositoryPath })

  await runCommand(corepack, ['pnpm', '--filter', '@ai-devflow/desktop', 'build'])
  await listenModelServer()
  apiProcess = spawnQuiet(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'dev'], {
    DATABASE_URL: '',
    DEVFLOW_DATABASE_URL: '',
    DEVFLOW_API_DIAGNOSTICS_PATH: path.join(tempRoot, 'api-diagnostics.json'),
    DEVFLOW_ENABLE_DEMO_DATA: 'true',
    DEV_AUTH_ENABLED: 'true',
    DEVFLOW_SESSION_SECRET: sessionSecret,
    PORT: String(apiPort),
  })
  viteProcess = spawnQuiet(corepack, [
    'pnpm', '--filter', '@ai-devflow/desktop', 'exec', 'vite',
    '--host', '127.0.0.1', '--port', String(desktopPort), '--strictPort',
  ])
  await Promise.all([waitForServer(`${apiUrl}/health`), waitForServer(desktopUrl)])
  const teamProject = await createTeamProject()
  const pairingCode = await createPairingCode(teamProject.id)

  app = await electron.launch({
    args: ['.'],
    cwd: desktopDir,
    env: {
      ...process.env,
      DEVFLOW_USER_DATA_DIR: userDataDir,
      DEVFLOW_DATA_PROFILE_REGISTRY_PATH: path.join(userDataDir, 'data-profiles.json'),
      DEVFLOW_API_BASE_URL: apiUrl,
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
      DEVFLOW_CODING_ENGINE: '',
      DEVFLOW_CODING_EXECUTOR: '',
      DEVFLOW_NATIVE_CODING_PROVIDER_ID: '',
      DEVFLOW_OPENCODE_BIN: path.join(tempRoot, 'opencode-not-installed'),
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      VITE_DEV_SERVER_URL: desktopUrl,
    },
  })
  app.process().stderr?.on('data', chunk => process.stderr.write(chunk))
  app.on('close', () => console.log('Isolated Native Electron application closed.'))
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // Only this isolated test process stores synthetic credentials; OS keychain
  // acceptance is a separate signed-installation check, not part of this fixture.
  await app.evaluate(({ safeStorage }) => {
    safeStorage.isAsyncEncryptionAvailable = async () => true
    safeStorage.encryptStringAsync = async (value) => Buffer.from(`isolated-native-smoke:${value}`)
    safeStorage.decryptStringAsync = async (bytes) => {
      if (!bytes.toString().startsWith('isolated-native-smoke:')) throw new Error('Unexpected test credential')
      return { result: bytes.toString().slice('isolated-native-smoke:'.length), shouldReEncrypt: false }
    }
  })
  await app.evaluate((_, endpoint) => {
    const original = globalThis.fetch
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      if (url.hostname === 'api.deepseek.com') return original(`${endpoint}${url.pathname}`, init)
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Smoke test blocks external requests')
      return original(input, init)
    }
  }, modelUrl)
  await app.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
  }, repositoryPath)

  const project = await page.evaluate(async () => window.aiDevFlowDesktop.selectLocalProject())
  expect(project?.path).toBe(repositoryPath)
  await page.evaluate(async (input) => window.aiDevFlowDesktop.pairDesktop(input), {
    code: pairingCode,
    localProjectId: project.id,
  })
  await page.evaluate(async (input) => window.aiDevFlowDesktop.saveAgentProviderCredential(input), {
    providerId: 'deepseek-native-smoke',
    apiKey: 'sk-native-electron-smoke',
    model: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com',
  })
  const configuration = await page.evaluate(async (input) => {
    return window.aiDevFlowDesktop.saveCodingRuntimeConfiguration(input)
  }, {
    projectId: project.id,
    executor: 'native-model',
    providerId: 'deepseek-native-smoke',
  })
  expect(configuration).toMatchObject({ version: 1, executor: 'native-model' })
  const policy = await page.evaluate(async (projectId) => {
    return window.aiDevFlowDesktop.saveCodingRuntimeBudgetPolicy({
      projectId,
      enabled: true,
      monthlyLimitUsd: 5,
      warningThresholdUsd: 2.5,
    })
  }, project.id)
  expect(policy).toMatchObject({ enabled: true, monthlyLimitUsd: 5, warningThresholdUsd: 2.5 })

  const createdRun = await page.evaluate(async (projectId) => {
    return window.aiDevFlowDesktop.createRun({
      title: 'DevFlow Native Electron smoke',
      request: 'Change the bounded message from old to new and keep the saved test passing.',
      projectId,
      creatorId: 'u-erich',
      branchName: 'devflow/native-coding-electron-smoke',
    })
  }, project.id)
  const preBuildReadiness = await page.evaluate(async ({ run, projectId }) => window.aiDevFlowDesktop.getCodingRuntimeReadiness({
    runId: run.id, nodeId: run.currentNodeId, projectId, requestedBy: 'u-erich',
  }), { run: createdRun, projectId: project.id })
  expect(preBuildReadiness.budgetPolicy).toMatchObject({ enabled: true, monthlyLimitUsd: 5 })
  expect(preBuildReadiness.checks.find(check => check.code === 'budget_policy_missing')?.status).toBe('ready')
  expect(preBuildReadiness.checks.some(check => check.code === 'budget_not_evaluated')).toBe(true)
  expect(preBuildReadiness.status).not.toBe('ready')
  const { run, buildNode } = await completePreBuildWorkflow(page, createdRun, project.id)
  const readiness = await page.evaluate(async (input) => {
    return window.aiDevFlowDesktop.getCodingRuntimeReadiness(input)
  }, {
    runId: run.id,
    nodeId: buildNode.id,
    projectId: project.id,
    requestedBy: 'u-erich',
  })
  expect(readiness.status, JSON.stringify(readiness)).toBe('ready')
  expect(readiness).toMatchObject({
    engine: 'native',
    providerId: 'deepseek-native-smoke',
    configVersion: 1,
  })

  const started = await page.evaluate(async (input) => {
    return window.aiDevFlowDesktop.runCodingAgent(input)
  }, {
    runId: run.id,
    nodeId: buildNode.id,
    projectId: project.id,
    requestedBy: 'u-erich',
    userInstruction: 'Change the message from old to new.',
  })
  expect(started.codingRun).toMatchObject({
    status: 'waiting_permission',
    engine: 'native',
    providerId: 'deepseek-native-smoke',
    configVersion: 1,
  })
  const waitingState = await page.evaluate(async () => window.aiDevFlowDesktop.loadState())
  const permission = waitingState.codingPermissionRequests.find((candidate) =>
    candidate.codingRunId === started.codingRun.id && candidate.status === 'pending')
  expect(permission).toMatchObject({
    changeSetId: expect.any(String),
    changeSetDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
  })
  expect(permission).not.toHaveProperty('diffPreview')
  expect(permission).not.toHaveProperty('filePath')
  const changeSetPreview = await page.evaluate(async (input) =>
    window.aiDevFlowDesktop.getCodingChangeSetPreview(input), {
    changeSetId: permission.changeSetId,
    codingRunId: permission.codingRunId,
  })
  expect(changeSetPreview).toMatchObject({
    id: permission.changeSetId,
    codingRunId: permission.codingRunId,
    changedPaths: ['src/message.js'],
    changeSetDigest: permission.changeSetDigest,
  })
  expect(changeSetPreview.unifiedDiff).toContain('diff --git a/src/message.js b/src/message.js')

  await page.evaluate(async (input) => window.aiDevFlowDesktop.replyCodingPermission(input), {
    requestId: permission.id,
    codingRunId: permission.codingRunId,
    decidedBy: 'u-erich',
    decision: 'approved',
    comment: 'Approve the exact Native v2 Change Set once.',
  })
  const completedState = await page.evaluate(async () => window.aiDevFlowDesktop.loadState())
  const codingRun = completedState.codingRuns.find((candidate) => candidate.id === started.codingRun.id)
  expect(codingRun).toMatchObject({
    status: 'completed',
    engine: 'native',
    providerId: 'deepseek-native-smoke',
    changedPaths: ['src/message.js'],
    runtimeCostSummary: { source: 'provider_reported' },
  })
  const workspace = completedState.managedCodingWorkspaces.find((candidate) =>
    candidate.codingRunId === codingRun.id)
  expect(await readFile(path.join(workspace.worktreePath, 'src/message.js'), 'utf8'))
    .toBe('export const message = "new"\n')
  expect(await readFile(path.join(repositoryPath, 'src/message.js'), 'utf8'))
    .toBe('export const message = "old"\n')
  expect(completedState.testEvidence.some((evidence) =>
    evidence.id === codingRun.testEvidenceId && evidence.status === 'passed')).toBe(true)
  expect(completedState.codingDiffArtifacts.some((diff) =>
    diff.id === codingRun.diffArtifactId && diff.changedPaths.includes('src/message.js'))).toBe(true)
  expect(completedState.codingEvents.filter((event) => event.codingRunId === codingRun.id).length)
    .toBeGreaterThanOrEqual(4)
  const codingRequests = modelRequests.filter(request => nativePhaseOf(request) !== undefined)
  expect(codingRequests).toHaveLength(2)
  expect(modelRequests).toHaveLength(4)
  expect(modelRequests.every((request) => request.model === 'deepseek-flash')).toBe(true)
  // Through the real HTTP adapter: both phases send the identical system message and open
  // the user JSON with the same brief, so provider prefix caching can reuse it.
  expect(codingRequests.map(nativePhaseOf)).toEqual(['analysis', 'initial'])
  expect(codingRequests[1].messages[0].content).toBe(codingRequests[0].messages[0].content)
  const sentBrief = JSON.parse(codingRequests[0].messages[1].content).brief
  const sharedPrefix = `{"stateVersion":2,"brief":${JSON.stringify(sentBrief)},`
  expect(codingRequests.every((request) => request.messages[1].content.startsWith(sharedPrefix))).toBe(true)
  expect((await page.evaluate(() => window.aiDevFlowDesktop.loadState())).settings.knowledgeReviewExecutor).toBe('native-agent')
  console.log('DevFlow Native Electron smoke passed: real Main, local model server, built-in repository review without OpenCode, exact approval, managed-worktree edit, saved test, Diff, Trace, Evidence, and provider-reported cost.')
} finally {
  clearTimeout(watchdog)
  if (app) await app.close().catch(() => undefined)
  await Promise.all([
    stopProcess(viteProcess),
    stopProcess(apiProcess),
    closeModelServer(),
  ])
  await rm(tempRoot, { recursive: true, force: true })
}
