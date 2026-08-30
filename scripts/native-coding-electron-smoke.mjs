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

function modelContentFor(systemPrompt) {
  if (systemPrompt.includes('Do not propose edits yet')) {
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
      body?.model !== 'deepseek-native-smoke' ||
      typeof systemPrompt !== 'string'
    ) {
      response.writeHead(400).end()
      return
    }
    modelRequests.push(body)
    const payload = JSON.stringify({
      choices: [{ message: { content: modelContentFor(systemPrompt) } }],
      usage: {
        prompt_tokens: 40 + modelRequests.length,
        completion_tokens: 20,
        cached_tokens: 0,
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
      name: 'Native Coding Electron Smoke',
      slug: `native-coding-${Date.now()}`,
      description: 'Isolated no-cost Native Coding Electron acceptance project.',
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
    throw new Error('Native Coding Electron smoke workflow shape is unavailable')
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
    await page.evaluate(async (input) => {
      return window.aiDevFlowDesktop.runKnowledgeReview({
        runId: input.runId,
        nodeId: input.nodeId,
        projectId: input.projectId,
        requestedBy: 'u-erich',
        runtime: 'electron',
        providerId: 'fake-knowledge-review',
      })
    }, { runId: current.id, nodeId: gateNode.id, projectId })
    const approved = await page.evaluate(async (input) => {
      return window.aiDevFlowDesktop.approveGate(input)
    }, { runId: current.id, nodeId: gateNode.id })
    current = approved.run
  }
  expect(current.currentNodeId).toBe(nodes.build.id)
  return { run: current, buildNode: nodes.build }
}

let apiProcess
let viteProcess
let app
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
  await runCommand('git', ['config', 'user.name', 'Native Coding Smoke'], { cwd: repositoryPath })
  await runCommand('git', ['add', '.'], { cwd: repositoryPath })
  await runCommand('git', ['commit', '-m', 'baseline'], { cwd: repositoryPath })

  await runCommand(corepack, ['pnpm', '--filter', '@ai-devflow/desktop', 'build'])
  await listenModelServer()
  apiProcess = spawnQuiet(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'dev'], {
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
      DEVFLOW_API_BASE_URL: apiUrl,
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
      DEVFLOW_CODING_ENGINE: '',
      DEVFLOW_CODING_EXECUTOR: '',
      DEVFLOW_NATIVE_CODING_PROVIDER_ID: '',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      VITE_DEV_SERVER_URL: desktopUrl,
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
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
    model: 'deepseek-native-smoke',
    baseUrl: modelUrl,
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
      monthlyLimitUsd: 0.20,
      warningThresholdUsd: 0.10,
    })
  }, project.id)
  expect(policy).toMatchObject({ enabled: true, monthlyLimitUsd: 0.20, warningThresholdUsd: 0.10 })

  const createdRun = await page.evaluate(async (projectId) => {
    return window.aiDevFlowDesktop.createRun({
      title: 'Native Coding Electron smoke',
      request: 'Change the bounded message from old to new and keep the saved test passing.',
      projectId,
      creatorId: 'u-erich',
      branchName: 'devflow/native-coding-electron-smoke',
    })
  }, project.id)
  const { run, buildNode } = await completePreBuildWorkflow(page, createdRun, project.id)
  const readiness = await page.evaluate(async (input) => {
    return window.aiDevFlowDesktop.getCodingRuntimeReadiness(input)
  }, {
    runId: run.id,
    nodeId: buildNode.id,
    projectId: project.id,
    requestedBy: 'u-erich',
  })
  expect(readiness.status).toBe('ready')
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
  expect(modelRequests).toHaveLength(2)
  expect(modelRequests.every((request) => request.model === 'deepseek-native-smoke')).toBe(true)
  console.log('Native Coding Electron smoke passed: real Main, local model server, exact approval, managed-worktree edit, saved test, Diff, Trace, Evidence, and provider-reported cost.')
} finally {
  if (app) await app.close().catch(() => undefined)
  await Promise.all([
    stopProcess(viteProcess),
    stopProcess(apiProcess),
    closeModelServer(),
  ])
  await rm(tempRoot, { recursive: true, force: true })
}
