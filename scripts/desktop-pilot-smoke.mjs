import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile as execFileCallback } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { _electron as electron } from '@playwright/test'
import { resolveDesktopExecutablePath } from './desktop-pilot-artifact.mjs'

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requireFromDesktop = createRequire(
  path.join(rootDirectory, 'apps', 'desktop', 'package.json'),
)
const initSqlJs = requireFromDesktop('sql.js')
const execFile = promisify(execFileCallback)
const artifactDirectory = path.join(rootDirectory, 'out', 'desktop-pilot')
const artifactIndex = JSON.parse(
  await readFile(path.join(artifactDirectory, 'artifact-index.json'), 'utf8'),
)
const appDirectory = path.resolve(artifactDirectory, artifactIndex.appDirectory)
const executablePath = resolveDesktopExecutablePath(appDirectory, artifactIndex.platform)
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'devflow-desktop-pilot-smoke-'))
const userDataDirectory = path.join(temporaryDirectory, 'user-data')
const runtimeProjectDirectory = path.join(temporaryDirectory, 'runtime-project')
const diagnostics = []
let hostileDevelopmentServerRequests = 0
let electronApp
let runtimeBudgetPolicy = null
const packagedOrganizationPolicy = {
  id: 'enforcement-policy-org-packaged-smoke',
  organizationId: 'org-packaged-smoke',
  name: 'Packaged smoke policy',
  version: 1,
  rules: [],
  updatedAt: '2026-08-30T00:00:00.000Z',
}
const packagedEffectivePolicy = {
  id: 'effective-enforcement-policy-p-packaged-smoke',
  organizationId: 'org-packaged-smoke',
  projectId: 'p-packaged-smoke',
  version: 1,
  rules: [],
  updatedAt: '2026-08-30T00:00:00.000Z',
}
const packagedTeamProject = {
  id: 'p-packaged-smoke',
  name: 'Packaged Smoke Project',
  slug: 'packaged-smoke-project',
  description: 'Controlled local packaged smoke project.',
  repository: 'https://example.invalid/packaged-smoke.git',
  defaultBranch: 'main',
  health: 'on_track',
  knowledgeBasePath: 'docs/knowledge',
  testCommand: 'npm test',
}

const hostileDevelopmentServer = createServer((_request, response) => {
  hostileDevelopmentServerRequests += 1
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end('<title>Hostile development server</title><main>wrong renderer</main>')
})

const controlPlaneServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const sendJson = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(body))
  }
  const readBody = async () => {
    let raw = ''
    for await (const chunk of request) raw += chunk.toString()
    return raw ? JSON.parse(raw) : {}
  }

  if (request.method === 'POST' && url.pathname === '/api/desktop/pairing/exchange') {
    sendJson(201, {
      token: 'devflow-desktop-token-packaged-smoke',
      tokenId: 'desktop-token-packaged-smoke',
      organizationId: 'org-packaged-smoke',
      projectId: 'p-packaged-smoke',
      userId: 'packaged-smoke-user',
      role: 'lead',
      issuedRole: 'lead',
      expiresAt: '2099-01-01T00:00:00.000Z',
      userName: 'Packaged Smoke User',
      projectName: 'Packaged Smoke Project',
      authAccountId: 'acct-packaged-smoke',
      projectMemberships: [{
        projectId: 'p-packaged-smoke',
        userId: 'packaged-smoke-user',
        role: 'lead',
      }],
      createdAt: '2026-08-30T00:00:00.000Z',
    })
    return
  }
  if (request.method === 'PUT' && url.pathname === '/api/runtime/budget-policy') {
    const body = await readBody()
    runtimeBudgetPolicy = {
      projectId: body.projectId,
      enabled: body.enabled,
      monthlyLimitUsd: body.monthlyLimitUsd,
      warningThresholdUsd: body.warningThresholdUsd,
      currency: 'USD',
      updatedAt: new Date().toISOString(),
    }
    sendJson(200, runtimeBudgetPolicy)
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/runtime/budget-policy') {
    sendJson(200, { policy: runtimeBudgetPolicy })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/runtime/budget/evaluate') {
    const body = await readBody()
    sendJson(200, {
      status: 'allowed',
      blocksRun: false,
      currentSpendUsd: 0,
      projectedCostUsd: body.projectedCostUsd,
      reason: 'Packaged smoke budget policy allows this bounded run.',
    })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/team/overview') {
    sendJson(200, {
      projects: [packagedTeamProject],
      members: [],
      runs: [],
      projectCost: [],
      memberCost: [],
      totalCost: '$0.00',
      enforcementPolicies: {
        organizationPolicy: packagedOrganizationPolicy,
        projectOverrides: [],
        effectivePolicies: [packagedEffectivePolicy],
        gateOverrides: [],
      },
    })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/runs') {
    sendJson(200, { runs: [], artifacts: [], events: [] })
    return
  }
  if (request.method === 'GET' && url.pathname.endsWith('/work-requests')) {
    sendJson(200, { workRequests: [] })
    return
  }
  sendJson(404, { error: 'not_found', message: 'Packaged smoke endpoint is not implemented.' })
})

await new Promise((resolve, reject) => {
  hostileDevelopmentServer.once('error', reject)
  hostileDevelopmentServer.listen(0, '127.0.0.1', resolve)
})
const address = hostileDevelopmentServer.address()
if (!address || typeof address === 'string') {
  throw new Error('Unable to allocate the hostile development server smoke port.')
}
const hostileDevelopmentServerUrl = `http://127.0.0.1:${address.port}/must-not-load`

await new Promise((resolve, reject) => {
  controlPlaneServer.once('error', reject)
  controlPlaneServer.listen(0, '127.0.0.1', resolve)
})
const controlPlaneAddress = controlPlaneServer.address()
if (!controlPlaneAddress || typeof controlPlaneAddress === 'string') {
  throw new Error('Unable to allocate the packaged smoke control-plane port.')
}
const controlPlaneUrl = `http://127.0.0.1:${controlPlaneAddress.port}`

async function launchPackagedDesktop() {
  const app = await electron.launch({
    executablePath,
    cwd: appDirectory,
    env: {
      ...process.env,
      DEVFLOW_USER_DATA_DIR: userDataDirectory,
      DEVFLOW_DATA_PROFILE_REGISTRY_PATH: path.join(userDataDirectory, 'data-profiles.json'),
      DEVFLOW_API_BASE_URL: controlPlaneUrl,
      DEVFLOW_CODING_ENGINE: 'fake',
      DEVFLOW_CODING_EXECUTOR: 'native-deterministic',
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
      DEVFLOW_ENABLE_LOCAL_MCP_FIXTURE: 'true',
      DEVFLOW_ENABLE_DEMO_DATA: 'true',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      VITE_DEV_SERVER_URL: hostileDevelopmentServerUrl,
    },
    timeout: 30_000,
  })
  app.process().stderr?.on('data', (chunk) => diagnostics.push(chunk.toString()))
  const page = await app.firstWindow({ timeout: 30_000 })
  await page.waitForURL((url) => url.protocol !== 'about:', { timeout: 30_000 })
  await page.locator('#root').waitFor({ state: 'attached', timeout: 30_000 })
  return { app, page }
}

async function waitForIsolatedStore() {
  const storePath = path.join(userDataDirectory, 'devflow.sqlite')
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await access(storePath)
      return storePath
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`Packaged Desktop did not create its isolated store: ${storePath}`)
}

try {
  await access(executablePath)
  await mkdir(runtimeProjectDirectory, { recursive: true })
  await writeFile(
    path.join(runtimeProjectDirectory, 'package.json'),
    `${JSON.stringify({
      name: 'devflow-agent-runtime-smoke',
      version: '1.0.0',
      private: true,
      scripts: {
        test: 'node -e "const fs=require(\'node:fs\');const p=\'devflow-native-change.txt\';if(!fs.existsSync(p)||fs.readFileSync(p,\'utf8\')!==\'DevFlow deterministic Native Coding repair.\\n\')process.exit(1)"',
      },
    }, null, 2)}\n`,
  )
  await writeFile(
    path.join(runtimeProjectDirectory, 'README.md'),
    '# Packaged Agent Runtime smoke\n\nThis isolated repository accepts one bounded Native Coding repair.\n',
  )
  await writeFile(
    path.join(runtimeProjectDirectory, 'package-lock.json'),
    `${JSON.stringify({
      name: 'devflow-agent-runtime-smoke',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'devflow-agent-runtime-smoke', version: '1.0.0' },
      },
    }, null, 2)}\n`,
  )
  await execFile('git', ['init', '-b', 'main'], { cwd: runtimeProjectDirectory })
  await execFile('git', ['config', 'user.email', 'packaged-smoke@example.invalid'], {
    cwd: runtimeProjectDirectory,
  })
  await execFile('git', ['config', 'user.name', 'Packaged Smoke'], {
    cwd: runtimeProjectDirectory,
  })
  await execFile('git', ['add', 'package.json', 'package-lock.json', 'README.md'], {
    cwd: runtimeProjectDirectory,
  })
  await execFile('git', ['commit', '-m', 'packaged smoke baseline'], {
    cwd: runtimeProjectDirectory,
  })

  const firstLaunch = await launchPackagedDesktop()
  electronApp = firstLaunch.app
  const page = firstLaunch.page
  const loadedUrl = page.url()
  if (!loadedUrl.startsWith('file://')) {
    throw new Error(`Packaged Desktop loaded a non-file renderer: ${loadedUrl}`)
  }
  if (hostileDevelopmentServerRequests !== 0) {
    throw new Error(
      `Packaged Desktop honored VITE_DEV_SERVER_URL (${hostileDevelopmentServerRequests} request(s)).`,
    )
  }
  const storePath = await waitForIsolatedStore()
  await electronApp.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
  }, runtimeProjectDirectory)
  const runtimeBeforeRestart = await page.evaluate(async () => {
    const project = await window.aiDevFlowDesktop.selectLocalProject()
    if (!project) throw new Error('Packaged Runtime smoke project was not selected')
    await window.aiDevFlowDesktop.pairDesktop({
      localProjectId: project.id,
      code: 'pair-packaged-smoke.copy-once-secret',
    })
    await window.aiDevFlowDesktop.saveCodingRuntimeBudgetPolicy({
      projectId: project.id,
      enabled: true,
      monthlyLimitUsd: 1,
      warningThresholdUsd: 0.5,
    })
    const run = await window.aiDevFlowDesktop.createRun({
      title: 'Packaged Agent Runtime smoke',
      request: 'Complete one bounded no-side-effect observation.',
      projectId: project.id,
      creatorId: 'packaged-smoke-user',
      branchName: 'devflow/packaged-agent-runtime-smoke',
    })
    let snapshot = await window.aiDevFlowDesktop.startAgentRuntime({
      runId: run.id,
      nodeId: run.currentNodeId,
      localProjectId: project.id,
    })
    for (let iteration = 0; iteration < 3; iteration += 1) {
      snapshot = await window.aiDevFlowDesktop.advanceAgentRuntime({
        runtimeId: snapshot.runtime.runtimeId,
        runId: run.id,
        localProjectId: project.id,
        expectedVersion: snapshot.runtime.version,
        expectedCheckpointVersion: snapshot.runtime.checkpointVersion,
      })
    }
    return snapshot
  })
  if (
    runtimeBeforeRestart.runtime.status !== 'terminal' ||
    runtimeBeforeRestart.runtime.stopReason !== 'success'
  ) {
    throw new Error('Packaged Agent Runtime did not reach the exact success terminal state.')
  }
  if (
    runtimeBeforeRestart.runtime.acceptedActionCount !== 1 ||
    runtimeBeforeRestart.events.filter((event) => event.type === 'action_requested').length !== 1 ||
    runtimeBeforeRestart.terminalSummary?.acceptedActionCount !== 1
  ) {
    throw new Error('Packaged Agent Runtime did not accept exactly one deterministic action.')
  }

  const memoryBeforeRestart = await page.evaluate(async (selection) => {
    let lifecycle = await window.aiDevFlowDesktop.listAgentMemoryLifecycle(selection)
    const pending = lifecycle.candidates.filter(
      (candidate) => candidate.lifecycleStatus === 'pending',
    )
    const candidate = pending[0]
    if (pending.length !== 1 || candidate === undefined || lifecycle.memoryCount !== 0) {
      throw new Error('Packaged Agent Runtime did not produce one inert Memory Candidate.')
    }
    lifecycle = await window.aiDevFlowDesktop.promoteAgentMemoryCandidate({
      ...selection,
      candidateId: candidate.id,
      expectedContentDigest: candidate.contentDigest,
      expectedProvenanceDigest: candidate.provenanceDigest,
    })
    const promoted = lifecycle.memories[0]
    if (
      lifecycle.memoryCount !== 1 ||
      promoted === undefined ||
      promoted.lifecycleStatus !== 'active' ||
      promoted.currentRevision !== 1 ||
      promoted.headVersion !== 1
    ) {
      throw new Error('Packaged Agent Memory promotion did not commit exact revision one.')
    }
    lifecycle = await window.aiDevFlowDesktop.reviseAgentMemory({
      ...selection,
      memoryId: promoted.memoryId,
      expectedRevision: promoted.currentRevision,
      expectedHeadVersion: promoted.headVersion,
      expectedContentDigest: promoted.contentDigest,
      expectedProvenanceDigest: promoted.provenanceDigest,
      statement: 'The packaged Runtime observation remains useful after exact human review.',
    })
    const revised = lifecycle.memories[0]
    if (
      revised === undefined ||
      revised.lifecycleStatus !== 'active' ||
      revised.currentRevision !== 2 ||
      revised.headVersion !== 2
    ) {
      throw new Error('Packaged Agent Memory revision did not advance exact optimistic concurrency.')
    }
    lifecycle = await window.aiDevFlowDesktop.deleteAgentMemory({
      ...selection,
      memoryId: revised.memoryId,
      expectedRevision: revised.currentRevision,
      expectedHeadVersion: revised.headVersion,
      expectedContentDigest: revised.contentDigest,
      expectedProvenanceDigest: revised.provenanceDigest,
    })
    const deleted = lifecycle.memories[0]
    if (
      deleted === undefined ||
      deleted.lifecycleStatus !== 'deleted' ||
      deleted.revisionStatus !== 'active' ||
      deleted.currentRevision !== 2 ||
      deleted.headVersion !== 4 ||
      deleted.statement !== null ||
      deleted.tombstone?.purgeStatus !== 'completed' ||
      deleted.tombstone.lastRevision !== 2 ||
      deleted.tombstone.deletionVersion !== 3 ||
      deleted.tombstone.purgedAt === null
    ) {
      throw new Error(`Packaged Agent Memory deletion did not complete tombstone-first purge: ${JSON.stringify({
        lifecycleStatus: deleted?.lifecycleStatus ?? null,
        revisionStatus: deleted?.revisionStatus ?? null,
        currentRevision: deleted?.currentRevision ?? null,
        headVersion: deleted?.headVersion ?? null,
        statementRedacted: deleted?.statement === null,
        tombstone: deleted?.tombstone ?? null,
      })}`)
    }
    return {
      selection,
      candidateId: candidate.id,
      memoryId: deleted.memoryId,
      currentRevision: deleted.currentRevision,
      headVersion: deleted.headVersion,
      contentDigest: deleted.contentDigest,
      provenanceDigest: deleted.provenanceDigest,
      tombstone: deleted.tombstone,
    }
  }, {
    runtimeId: runtimeBeforeRestart.runtime.runtimeId,
    runId: runtimeBeforeRestart.runtime.runId,
    localProjectId: runtimeBeforeRestart.runtime.localProjectId,
  })

  const nativeCodingBeforeRestart = await page.evaluate(async () => {
    const project = await window.aiDevFlowDesktop.selectLocalProject()
    if (!project) throw new Error('Packaged Native Coding project was not selected')
    let run = await window.aiDevFlowDesktop.createRun({
      title: 'Packaged Native Coding smoke',
      request: 'Apply one bounded native edit through accepted main-owned Tools.',
      projectId: project.id,
      creatorId: 'packaged-smoke-user',
      branchName: 'devflow/packaged-native-coding-smoke',
    })
    const currentNode = () => run.nodes.find((node) => node.id === run.currentNodeId)
    let node = currentNode()
    if (!node || node.kind !== 'agent' || node.stage !== 'clarify') {
      throw new Error('Packaged Native Coding Workflow did not start at Clarify')
    }
    const clarification = await window.aiDevFlowDesktop.completeWorkflowAgentNode({
      runId: run.id,
      nodeId: node.id,
      userId: 'packaged-smoke-user',
      userName: 'Packaged Smoke User',
      providerId: 'fake-knowledge-review',
    })
    run = clarification.run
    node = currentNode()
    if (!node || node.kind !== 'gate' || node.stage !== 'clarify') {
      throw new Error('Packaged Native Coding Workflow did not reach Clarify Gate')
    }
    if (!clarification.artifact.clarificationRevision) {
      throw new Error('Packaged Native Coding clarification revision metadata was not persisted')
    }
    run = (await window.aiDevFlowDesktop.approveGate({
      runId: run.id,
      nodeId: node.id,
      expectedClarificationRevision: {
        artifactId: clarification.artifact.id,
        revision: clarification.artifact.clarificationRevision.revision,
        revisionDigest: clarification.artifact.clarificationRevision.revisionDigest,
      },
    })).run
    node = currentNode()
    if (!node || node.kind !== 'agent' || node.stage !== 'design') {
      throw new Error('Packaged Native Coding Workflow did not reach Design')
    }
    run = (await window.aiDevFlowDesktop.completeWorkflowAgentNode({
      runId: run.id,
      nodeId: node.id,
      userId: 'packaged-smoke-user',
      userName: 'Packaged Smoke User',
      providerId: 'fake-knowledge-review',
    })).run
    node = currentNode()
    if (!node || node.kind !== 'gate' || node.stage !== 'design') {
      throw new Error('Packaged Native Coding Workflow did not reach Design Gate')
    }
    run = (await window.aiDevFlowDesktop.approveGate({ runId: run.id, nodeId: node.id })).run
    node = currentNode()
    if (!node || node.kind !== 'task' || node.stage !== 'build') {
      throw new Error('Packaged Native Coding Workflow did not reach Build')
    }
    await window.aiDevFlowDesktop.ensureCodingEngine({ projectId: project.id })
    const started = await window.aiDevFlowDesktop.runCodingAgent({
      runId: run.id,
      nodeId: node.id,
      projectId: project.id,
      requestedBy: 'packaged-smoke-user',
      userInstruction: 'Apply the exact bounded Native Coding repair.',
    })
    const pending = started.state.codingPermissionRequests.find(
      (request) => request.codingRunId === started.codingRun.id && request.status === 'pending',
    )
    if (!pending || pending.permission !== 'edit') {
      throw new Error('Packaged Native Coding did not stop at one edit permission')
    }
    await window.aiDevFlowDesktop.replyCodingPermission({
      requestId: pending.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'packaged-smoke-user',
      decision: 'approved',
      comment: 'Approve one bounded packaged Native Coding edit.',
    })
    const [completed] = await window.aiDevFlowDesktop.listCodingAgentRuns({ runId: run.id })
    const runtime = (await window.aiDevFlowDesktop.listAgentRuntimes({
      runId: run.id,
      localProjectId: project.id,
    }))
      .find((candidate) => candidate.runtime.runtimeId === `agent-runtime-coding-${started.codingRun.id}`)
    const state = await window.aiDevFlowDesktop.loadState()
    const completedWorkflow = state.runs.find((candidate) => candidate.id === run.id)
    const workflowNode = completedWorkflow?.nodes.find(
      (candidate) => candidate.id === completedWorkflow.currentNodeId,
    )
    if (
      !completed ||
      completed.status !== 'completed' ||
      completed.changedPaths.length !== 1 ||
      completed.changedPaths[0] !== 'devflow-native-change.txt' ||
      !runtime ||
      runtime.runtime.status !== 'terminal' ||
      runtime.runtime.stopReason !== 'success' ||
      workflowNode?.stage !== 'test'
    ) {
      throw new Error(`Packaged Native Coding did not complete at the bounded Test boundary: ${JSON.stringify({
        codingStatus: completed?.status ?? null,
        changedPaths: completed?.changedPaths ?? [],
        runtimeStatus: runtime?.runtime.status ?? null,
        runtimeStopReason: runtime?.runtime.stopReason ?? null,
        workflowStage: workflowNode?.stage ?? null,
        events: state.codingEvents
          .filter((event) => event.codingRunId === started.codingRun.id)
          .map((event) => ({ kind: event.kind, message: event.message })),
      })}`)
    }
    return {
      workflowRunId: run.id,
      codingRunId: completed.id,
      runtimeId: runtime.runtime.runtimeId,
      localProjectId: project.id,
      status: completed.status,
      changedPaths: completed.changedPaths,
      acceptedActionCount: runtime.runtime.acceptedActionCount,
    }
  })

  await electronApp.close()
  electronApp = undefined
  const secondLaunch = await launchPackagedDesktop()
  electronApp = secondLaunch.app
  const runtimeAfterRestart = await secondLaunch.page.evaluate(async (identity) => {
    const runtimes = await window.aiDevFlowDesktop.listAgentRuntimes({
      runId: identity.runId,
      localProjectId: identity.localProjectId,
    })
    return runtimes.find((candidate) => candidate.runtime.runtimeId === identity.runtimeId)
  }, {
    runtimeId: runtimeBeforeRestart.runtime.runtimeId,
    runId: runtimeBeforeRestart.runtime.runId,
    localProjectId: runtimeBeforeRestart.runtime.localProjectId,
  })
  if (
    !runtimeAfterRestart ||
    runtimeAfterRestart.runtime.status !== 'terminal' ||
    runtimeAfterRestart.runtime.stopReason !== 'success' ||
    runtimeAfterRestart.runtime.acceptedActionCount !== 1 ||
    runtimeAfterRestart.terminalSummary?.acceptedActionCount !== 1
  ) {
    throw new Error('Packaged Agent Runtime was not restored exactly after restart.')
  }
  const memoryAfterRestart = await secondLaunch.page.evaluate(async (identity) => {
    const lifecycle = await window.aiDevFlowDesktop.listAgentMemoryLifecycle(identity.selection)
    return {
      candidate: lifecycle.candidates.find((entry) => entry.id === identity.candidateId),
      memory: lifecycle.memories.find((entry) => entry.memoryId === identity.memoryId),
    }
  }, memoryBeforeRestart)
  if (
    memoryAfterRestart.candidate?.lifecycleStatus !== 'promoted' ||
    memoryAfterRestart.memory?.lifecycleStatus !== 'deleted' ||
    memoryAfterRestart.memory.revisionStatus !== 'active' ||
    memoryAfterRestart.memory.currentRevision !== memoryBeforeRestart.currentRevision ||
    memoryAfterRestart.memory.headVersion !== memoryBeforeRestart.headVersion ||
    memoryAfterRestart.memory.contentDigest !== memoryBeforeRestart.contentDigest ||
    memoryAfterRestart.memory.provenanceDigest !== memoryBeforeRestart.provenanceDigest ||
    memoryAfterRestart.memory.statement !== null ||
    JSON.stringify(memoryAfterRestart.memory.tombstone) !==
      JSON.stringify(memoryBeforeRestart.tombstone)
  ) {
    throw new Error('Packaged Agent Memory was not restored exactly after restart.')
  }
  const nativeCodingAfterRestart = await secondLaunch.page.evaluate(async (identity) => {
    const codingRun = (await window.aiDevFlowDesktop.listCodingAgentRuns({
      runId: identity.workflowRunId,
    })).find((candidate) => candidate.id === identity.codingRunId)
    const runtime = (await window.aiDevFlowDesktop.listAgentRuntimes({
      runId: identity.workflowRunId,
      localProjectId: identity.localProjectId,
    }))
      .find((candidate) => candidate.runtime.runtimeId === identity.runtimeId)
    return { codingRun, runtime }
  }, nativeCodingBeforeRestart)
  if (
    nativeCodingAfterRestart.codingRun?.status !== 'completed' ||
    nativeCodingAfterRestart.codingRun.changedPaths.length !== 1 ||
    nativeCodingAfterRestart.codingRun.changedPaths[0] !== 'devflow-native-change.txt' ||
    nativeCodingAfterRestart.runtime?.runtime.status !== 'terminal' ||
    nativeCodingAfterRestart.runtime.runtime.stopReason !== 'success' ||
    nativeCodingAfterRestart.runtime.runtime.acceptedActionCount !==
      nativeCodingBeforeRestart.acceptedActionCount
  ) {
    throw new Error('Packaged Native Coding was not restored exactly after restart.')
  }
  await electronApp.close()
  electronApp = undefined

  const SQL = await initSqlJs({
    locateFile: (file) => requireFromDesktop.resolve(`sql.js/dist/${file}`),
  })
  const database = new SQL.Database(await readFile(storePath))
  const schemaVersion = Number(
    database.exec("select value from schema_meta where key = 'schema_version'")[0]?.values[0]?.[0],
  )
  const localMcpAudit = database.exec(
    `select tool_id, source, installation_id, installation_version,
            sum(case when status = 'started' then 1 else 0 end),
            sum(case when status = 'succeeded' then 1 else 0 end),
            count(*),
            sum(case when result_digest is not null then 1 else 0 end)
       from agent_runtime_tool_audits
      where runtime_id = ?
      group by tool_id, source, installation_id, installation_version`,
    [runtimeBeforeRestart.runtime.runtimeId],
  )[0]?.values[0]
  const localMcpInstallations = database.exec(
    `select id, version, enabled
       from local_mcp_installations
      order by id`,
  )[0]?.values ?? []
  const nativeCodingAudits = database.exec(
    `select tool_id, status, count(*)
       from agent_runtime_tool_audits
      where runtime_id = ?
      group by tool_id, status
      order by tool_id, status`,
    [nativeCodingBeforeRestart.runtimeId],
  )[0]?.values ?? []
  const nativeCodingPermissionDecisions = Number(
    database.exec(
      `select count(*)
         from coding_permission_decisions
        where coding_run_id = ?`,
      [nativeCodingBeforeRestart.codingRunId],
    )[0]?.values[0]?.[0],
  )
  const memoryLifecycleRows = {
    candidates: Number(database.exec(
      'select count(*) from agent_memory_candidates where id = ?',
      [memoryBeforeRestart.candidateId],
    )[0]?.values[0]?.[0]),
    revisions: Number(database.exec(
      'select count(*) from agent_memory_revisions where memory_id = ?',
      [memoryBeforeRestart.memoryId],
    )[0]?.values[0]?.[0]),
    tombstones: Number(database.exec(
      'select count(*) from agent_memory_tombstones where memory_id = ?',
      [memoryBeforeRestart.memoryId],
    )[0]?.values[0]?.[0]),
    derivedIndexEntries: Number(database.exec(
      'select count(*) from agent_memory_index_entries where memory_id = ?',
      [memoryBeforeRestart.memoryId],
    )[0]?.values[0]?.[0]),
    audits: database.exec(
      `select event_kind, count(*)
         from agent_memory_audits
        where memory_id = ?
        group by event_kind
        order by event_kind`,
      [memoryBeforeRestart.memoryId],
    )[0]?.values ?? [],
  }
  database.close()
  if (schemaVersion !== 34) {
    throw new Error(`Packaged Desktop did not initialize schema 34: ${schemaVersion}`)
  }
  const [toolId, source, installationId, installationVersion, started, succeeded, records, results] =
    localMcpAudit ?? []
  const [persistedInstallation] = localMcpInstallations
  if (
    toolId !== 'scenario.evaluate' ||
    source !== 'mcp' ||
    installationId !== 'local-mcp-installation-runtime-fixture' ||
    Number(installationVersion) !== 2 ||
    Number(started) !== 1 ||
    Number(succeeded) !== 1 ||
    Number(records) !== 2 ||
    Number(results) !== 1 ||
    localMcpInstallations.length !== 1 ||
    persistedInstallation?.[0] !== installationId ||
    Number(persistedInstallation?.[1]) !== Number(installationVersion) ||
    Number(persistedInstallation?.[2]) !== 1
  ) {
    throw new Error('Packaged Agent Runtime did not persist one exact bounded Local MCP audit.')
  }
  const expectedNativeCodingAudits = [
    ['repo.read_text', 'started', 1],
    ['repo.read_text', 'succeeded', 1],
    ['workspace.run_saved_test', 'started', 1],
    ['workspace.run_saved_test', 'succeeded', 1],
    ['workspace.write_text', 'started', 1],
    ['workspace.write_text', 'succeeded', 1],
  ]
  if (
    JSON.stringify(nativeCodingAudits) !== JSON.stringify(expectedNativeCodingAudits) ||
    nativeCodingPermissionDecisions !== 1
  ) {
    throw new Error('Packaged Native Coding repeated or escaped its bounded Tool/permission effects.')
  }
  const nativeCodingRestartDuplicateEffects = 0
  const expectedMemoryAudits = [
    ['candidate_promoted', 1],
    ['memory_deleted', 1],
    ['memory_revised', 1],
    ['purge_completed', 1],
  ]
  if (
    memoryLifecycleRows.candidates !== 1 ||
    memoryLifecycleRows.revisions !== 2 ||
    memoryLifecycleRows.tombstones !== 1 ||
    memoryLifecycleRows.derivedIndexEntries !== 0 ||
    JSON.stringify(memoryLifecycleRows.audits) !== JSON.stringify(expectedMemoryAudits)
  ) {
    throw new Error('Packaged Agent Memory repeated or escaped its exact lifecycle effects.')
  }
  const memoryRestartDuplicateEffects = 0

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        executablePath,
        loadedProtocol: new URL(loadedUrl).protocol,
        hostileDevelopmentServerRequests,
        isolatedStore: path.relative(temporaryDirectory, storePath).split(path.sep).join('/'),
        agentRuntime: {
          status: runtimeAfterRestart.runtime.status,
          stopReason: runtimeAfterRestart.runtime.stopReason,
          acceptedActionCount: runtimeAfterRestart.terminalSummary.acceptedActionCount,
          restartDuplicateEffects: 0,
          localMcp: {
            installationId,
            installationVersion: Number(installationVersion),
            toolId,
            source,
            started: Number(started),
            succeeded: Number(succeeded),
            durableRecords: Number(records),
          },
        },
        nativeCoding: {
          status: nativeCodingAfterRestart.codingRun.status,
          changedPaths: nativeCodingAfterRestart.codingRun.changedPaths,
          permissionDecisions: nativeCodingPermissionDecisions,
          durableToolAuditRows: nativeCodingAudits.length,
          nativeCodingRestartDuplicateEffects,
        },
        agentMemory: {
          lifecycleStatus: memoryAfterRestart.memory.lifecycleStatus,
          currentRevision: memoryAfterRestart.memory.currentRevision,
          headVersion: memoryAfterRestart.memory.headVersion,
          purgeStatus: memoryAfterRestart.memory.tombstone.purgeStatus,
          durableLifecycleRows: memoryLifecycleRows,
          memoryRestartDuplicateEffects,
        },
      },
      null,
      2,
    ),
  )
} catch (error) {
  if (diagnostics.length > 0) {
    console.error(diagnostics.join(''))
  }
  throw error
} finally {
  if (electronApp) {
    await electronApp.close()
  }
  await new Promise((resolve) => hostileDevelopmentServer.close(resolve))
  await new Promise((resolve) => controlPlaneServer.close(resolve))
  await rm(temporaryDirectory, { recursive: true, force: true })
}
