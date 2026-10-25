/**
 * Opt-in live validation. Every model call must use the separately budgeted loopback gateway.
 * No existing user database or provider credential is read. Build the desktop before running.
 * DEVFLOW_FULLCHAIN_LIVE=1 HINDSIGHT_SMOKE_ENDPOINT=http://127.0.0.1:8890
 * DEVFLOW_FULLCHAIN_MODEL_ENDPOINT=http://127.0.0.1:<gateway-port>/v1
 * DEVFLOW_FULLCHAIN_OUTPUT=<new evidence directory> corepack pnpm exec tsx <this file>
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import type {
  CodingAgentRun, CodingChangeSetPreview, HindsightStatus,
  LocalExecutionState, LocalProject, ProviderCredentialMetadata, RetrievedKnowledgeManifest,
  WorkflowRun,
} from '../packages/shared/src/index.ts'
import type {
  CompleteWorkflowAgentNodeResult, CreatePrDraftResult, RunKnowledgeReviewResult,
  RunProjectTestsResult,
} from '../apps/desktop/src/desktop-api.ts'
import { HINDSIGHT_PROTOCOL } from '../apps/desktop/electron/hindsight-client.ts'
import { createHindsightTodoFixture } from './hindsight-todo-fixture.ts'
import {
  createWorkspace, startTeamApi, createTeamProject, createPairingCode,
  stubRepositoryPicker, delay, stopProcess, rootDir, type Workspace, type TeamApi,
} from './workspace-baseline/environment.mts'

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const allowedChangePaths = new Set([
  'README.md', 'index.html', 'src/app.js', 'src/dom.js', 'src/store.js',
  'test/store.test.js',
])
const providerName = 'Hindsight full-chain synthetic Todo'
const userId = 'u-erich'

function loopbackEndpoint(raw: string | undefined, name: string): string {
  assert(raw, `${name} is required`)
  const url = new URL(raw)
  assert.equal(url.protocol, 'http:', `${name} must use the local test service`)
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), `${name} must be loopback`)
  assert(!url.username && !url.password && !url.search && !url.hash, `${name} cannot contain credentials or query parameters`)
  return url.href.replace(/\/$/u, '')
}

/** Public helper: verify the actual persisted receipt, including current authorized source bytes. */
export async function assertFullchainKnowledgeReceipt(
  value: unknown, expected: { stage: string; projectId: string; repositoryPath: string; selectedPaths: string[] },
): Promise<RetrievedKnowledgeManifest> {
  const found: RetrievedKnowledgeManifest[] = []
  function visit(candidate: unknown): void {
    if (!candidate || typeof candidate !== 'object') return
    const record = candidate as Record<string, unknown>
    if (record.retrievedKnowledge && typeof record.retrievedKnowledge === 'object') {
      found.push(record.retrievedKnowledge as RetrievedKnowledgeManifest)
    }
    for (const nested of Object.values(record)) if (nested !== record.retrievedKnowledge) visit(nested)
  }
  visit(value)
  const receipt = found.find((item) => item.stage === expected.stage)
  assert(receipt, `Missing ${expected.stage} retrievedKnowledge receipt`)
  assert.equal(receipt.scope.projectId, expected.projectId)
  assert.equal(receipt.scope.userId, userId)
  assert.equal(receipt.degraded, false, `${expected.stage} only used fallback knowledge`)
  assert(receipt.configGeneration && receipt.modelVersion)
  assert(receipt.usedBytes > 0 && receipt.usedBytes <= receipt.budgetBytes)
  assert(receipt.references.length > 0, `${expected.stage} had no delivered references`)
  assert(receipt.references.some((ref) => ref.matchReason === 'semantic' || ref.matchReason === 'both'),
    `${expected.stage} did not deliver a verified Hindsight candidate`)
  for (const ref of receipt.references) {
    assert(expected.selectedPaths.includes(ref.path), `${expected.stage} returned an unselected source`)
    assert.equal(ref.contentDigest, `sha256:${hash(await readFile(path.join(expected.repositoryPath, ref.path)))}`,
      `${expected.stage} returned a stale source`)
    assert(ref.sourceRef && ref.bytes > 0)
  }
  return receipt
}

/** Exercise the generated Todo page in a real Electron Chromium window and inspect its own storage. */
export async function verifyFullchainTodoBrowser(input: {
  app: ElectronApplication; originalRepository: string; managedRepository: string; output: string
}) {
  // The server comes from the untouched baseline. Agent changes to server/package files are disallowed.
  const serverModule = await import(pathToFileURL(path.join(input.originalRepository, 'scripts/dev-server.js')).href)
  const server: Server = serverModule.createServer(input.managedRepository)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}`
  let todo: Page | undefined
  try {
    const window = input.app.waitForEvent('window')
    await input.app.evaluate(({ BrowserWindow }, pageUrl) => {
      const browser = new BrowserWindow({ width: 1000, height: 800,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
      void browser.loadURL(pageUrl)
    }, url)
    todo = await window
    await todo.waitForLoadState('domcontentloaded')
    let dialogs = 0
    todo.on('dialog', async (dialog) => { dialogs++; await dialog.dismiss() })
    const initial = [
      { id: 'todo-kept-a', text: '保留甲', done: false, createdAt: 101 },
      { id: 'todo-done-b', text: '清理乙', done: true, createdAt: 102 },
      { id: 'todo-kept-c', text: '保留丙', done: false, createdAt: 103 },
    ]
    await todo.evaluate((tasks) => localStorage.setItem('tasklist.tasks.v1', JSON.stringify(tasks)), initial)
    await todo.reload()
    const clear = todo.getByRole('button', { name: '清除已完成', exact: true })
    await expect(clear).toBeEnabled()
    await clear.click()
    await expect(todo.getByText('已清除 1 项', { exact: true })).toBeVisible()
    await expect(clear).toBeDisabled()
    const survivors = await todo.evaluate(() => JSON.parse(localStorage.getItem('tasklist.tasks.v1') ?? 'null'))
    assert.deepEqual(survivors, [initial[0], initial[2]])
    await todo.reload()
    await expect(todo.locator('.task-item')).toHaveCount(2)
    assert.deepEqual(await todo.evaluate(() => JSON.parse(localStorage.getItem('tasklist.tasks.v1') ?? 'null')), survivors)
    await todo.getByLabel('新任务内容', { exact: true }).fill('新增中文任务丁')
    await todo.getByLabel('新任务内容', { exact: true }).press('Enter')
    await expect(todo.locator('.task-item')).toHaveCount(3)
    const added = todo.getByRole('checkbox', { name: '标记“新增中文任务丁”为已完成', exact: true })
    await added.check()
    await expect(clear).toBeEnabled()
    await todo.getByRole('checkbox', { name: '标记“新增中文任务丁”为未完成', exact: true }).uncheck()
    await expect(clear).toBeDisabled()
    await todo.getByRole('button', { name: '删除“新增中文任务丁”', exact: true }).click()
    await expect(todo.locator('.task-item')).toHaveCount(2)
    for (const checkbox of await todo.getByRole('checkbox').all()) await checkbox.check()
    await clear.click()
    await expect(todo.getByText('已清除 2 项', { exact: true })).toBeVisible()
    await expect(todo.locator('#empty-state')).toBeVisible()
    await todo.reload()
    await expect(clear).toBeDisabled()
    await expect(todo.locator('.task-item')).toHaveCount(0)
    assert.equal(dialogs, 0)
    await todo.screenshot({ path: path.join(input.output, 'todo-browser.png'), scale: 'css' })
    return { passed: true, engine: 'real-electron-chromium', checks: [
      'mixed-completion-cleanup', 'survivor-fields-and-order', 'actual-refresh-persistence',
      'disabled-button', 'Chinese-input-and-enter', 'toggle-and-untoggle', 'single-delete',
      'clear-all-and-original-empty-state', 'no-confirmation-dialog',
    ] }
  } finally {
    await todo?.close().catch(() => undefined)
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

export async function runHindsightFullchainElectron() {
  assert.equal(process.env.DEVFLOW_FULLCHAIN_LIVE, '1', 'Explicit live synthetic project/provider/budget authorization is required')
  const hindsightEndpoint = loopbackEndpoint(process.env.HINDSIGHT_SMOKE_ENDPOINT, 'HINDSIGHT_SMOKE_ENDPOINT')
  const modelEndpoint = loopbackEndpoint(process.env.DEVFLOW_FULLCHAIN_MODEL_ENDPOINT, 'DEVFLOW_FULLCHAIN_MODEL_ENDPOINT')
  const workspace = await createWorkspace('devflow-hindsight-fullchain-')
  workspace.repoDir = path.join(workspace.tempRoot, 'todo')
  const output = path.resolve(process.env.DEVFLOW_FULLCHAIN_OUTPUT ?? path.join(workspace.tempRoot, 'evidence'))
  await mkdir(output, { recursive: true })
  const report: {
    startedAt: string; finishedAt?: string; passed: boolean; failure?: string
    workspace: Workspace; output: string; steps: Record<string, unknown>[]
    evidence: Record<string, unknown>; runId?: string; projectId?: string
    workflowCompleted: boolean; deliveryPublished: boolean
  } = {
    startedAt: new Date().toISOString(), passed: false, workspace, output, steps: [], evidence: {},
    workflowCompleted: false, deliveryPublished: false,
  }
  let app: ElectronApplication | undefined
  let team: TeamApi | undefined
  const save = async () => writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  const step = async (phase: string, details: Record<string, unknown> = {}) => {
    const row = { phase, at: new Date().toISOString(), ...details }
    report.steps.push(row); await save(); console.log(JSON.stringify(row))
  }
  try {
    const fixture = await createHindsightTodoFixture(workspace.repoDir)
    // Small-task documentation must fit the existing downstream brief. This is an
    // explicit request to the real generator, not truncation of approved artifacts.
    const request = `${fixture.request}\n文档表达要求：这是一个小型增量功能，需求澄清和设计正文各控制在约 1000 汉字以内；完整保留业务约束、验收条件和必要的实施检查，避免多章节重复复述同一规则。不输出完整代码，不虚构已检查仓库或已通过测试。\n实现范围：本次最多修改 6 个文件，允许路径仅为 README.md、index.html、src/app.js、src/dom.js、src/store.js、test/store.test.js。沿用既有样式，无需修改 src/styles.css；在以上范围内完整实现业务约束、测试和文档，仅修改确有必要的文件。编码提案最多包含 6 个文件、12 个精确替换项，输出前核对数量。`
    report.evidence.request = request
    const baselineStoreDigest = hash(await readFile(path.join(fixture.repositoryPath, 'src/store.js')))
    report.evidence.sourceCommit = fixture.sourceCommit
    team = await startTeamApi(workspace)
    const teamProject = await createTeamProject(team, 'Hindsight synthetic Todo full-chain')
    const pairingCode = await createPairingCode(team, teamProject.id, 'acct-demo-u-erich')
    app = await electron.launch({ args: ['.'], cwd: path.join(rootDir, 'apps/desktop'), env: {
      ...process.env, DEVFLOW_USER_DATA_DIR: workspace.userDataDir,
      DEVFLOW_DATA_PROFILE_REGISTRY_PATH: workspace.registryPath,
      DEVFLOW_API_BASE_URL: team.url, DEVFLOW_ENABLE_DEMO_DATA: 'false',
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'false', DEVFLOW_CODING_ENGINE: '',
      DEVFLOW_CODING_EXECUTOR: '', DEVFLOW_NATIVE_CODING_PROVIDER_ID: '',
      DEVFLOW_HINDSIGHT_PROTOCOL_VERIFIED: HINDSIGHT_PROTOCOL.commit,
      VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    } })
    // This process only holds a synthetic gateway key and disposable isolated-Team pairing token.
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isAsyncEncryptionAvailable = async () => true
      safeStorage.encryptStringAsync = async (value: string) => Buffer.from(`hindsight-fullchain-fixture:${value}`)
      safeStorage.decryptStringAsync = async (bytes) => {
        const text = bytes.toString()
        if (!text.startsWith('hindsight-fullchain-fixture:')) throw new Error('Not an isolated fixture credential')
        return { result: text.slice('hindsight-fullchain-fixture:'.length), shouldReEncrypt: false }
      }
    })
    // Preserve the real provider's billing identity and all product governance. Only the
    // isolated test transport is redirected through the same cumulative CNY gateway.
    await app.evaluate((_, endpoint) => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (new URL(url).hostname === 'api.deepseek.com') {
          if (url !== 'https://api.deepseek.com/v1/chat/completions') throw new Error('Unapproved live model route')
          return originalFetch(`${endpoint}/chat/completions`, init)
        }
        return originalFetch(input, init)
      }
    }, modelEndpoint)
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    async function ipc<T>(method: string, input?: unknown): Promise<T> {
      return page.evaluate(async ({ method, input }) => {
        const api = window.aiDevFlowDesktop as unknown as Record<string, (payload?: unknown) => Promise<unknown>>
        const operation = api[method]
        if (!operation) throw new Error(`Missing real IPC method ${method}`)
        return operation(input)
      }, { method, input }) as Promise<T>
    }
    await stubRepositoryPicker(app, fixture.repositoryPath)
    const project = await ipc<LocalProject>('selectLocalProject')
    assert.equal(project.path, fixture.repositoryPath)
    report.projectId = project.id
    await ipc('pairDesktop', { code: pairingCode, localProjectId: project.id })
    const provider = await ipc<ProviderCredentialMetadata>('saveAgentProviderCredential', {
      name: providerName, apiKey: 'sk-synthetic-budget-gateway', model: 'deepseek-flash',
      baseUrl: 'https://api.deepseek.com/v1', thinking: { mode: 'disabled' },
    })
    const providerId = provider.providerId
    await ipc('saveSettings', { selectedAgentProviderId: providerId })
    await ipc('saveProjectTestCommand', { projectId: project.id, testCommand: 'npm test' })
    await ipc('saveCodingRuntimeBudgetPolicy', { projectId: project.id, enabled: true,
      monthlyLimitUsd: 1, warningThresholdUsd: 0.5 })
    await ipc('saveCodingRuntimeConfiguration', { projectId: project.id, executor: 'native-model', providerId })
    await ipc('configureHindsight', { projectId: project.id, endpoint: hindsightEndpoint,
      selectedPaths: fixture.selectedPaths, includeMemories: false, enabled: true, pairedProjectConsent: true })
    await step('knowledge-sync:started', { selectedPaths: fixture.selectedPaths })
    const syncDeadline = Date.now() + 10 * 60_000
    let synced = false
    while (Date.now() < syncDeadline) {
      const status = await ipc<HindsightStatus>('getHindsightStatus', { projectId: project.id })
      if (status.counts.ready === fixture.selectedPaths.length) {
        report.evidence.hindsightStatus = status; synced = true; break
      }
      assert(status.enabled && status.transportAvailable, status.note)
      await delay(2_000)
    }
    assert(synced, 'Hindsight did not synchronize the selected documents within ten minutes')
    await step('knowledge-sync:ready')
    let run = await ipc<WorkflowRun>('createRun', { projectId: project.id, creatorId: userId,
      title: 'Hindsight Todo 全阶段知识验证', request, branchName: 'devflow/hindsight-todo-fullchain' })
    report.runId = run.id
    const nodes = run.nodes
    const receipt = async (phase: string, value: unknown, stage: string) => {
      report.evidence[phase] = await assertFullchainKnowledgeReceipt(value, {
        stage, projectId: project.id, repositoryPath: fixture.repositoryPath, selectedPaths: fixture.selectedPaths,
      })
    }
    const review = async (phase: string, nodeId: string, stage: string) => {
      await step(`${phase}:started`)
      const result = await ipc<RunKnowledgeReviewResult>('runKnowledgeReview', {
        runId: run.id, nodeId, projectId: project.id, requestedBy: userId, runtime: 'electron', providerId,
      })
      assert(result.review?.id, `${phase} did not persist a report`)
      await receipt(phase, result.review, stage)
      await writeFile(path.join(output, `${phase}.json`), `${JSON.stringify(result.review, null, 2)}\n`)
      await step(`${phase}:complete`, { reviewId: result.review.id })
      return result.review
    }
    for (const stage of ['clarify', 'design'] as const) {
      const agent = nodes.find((node) => node.stage === stage && node.kind === 'agent')
      const gate = nodes.find((node) => node.stage === stage && node.kind === 'gate')
      assert(agent && gate)
      await step(`${stage}:started`)
      let completed: CompleteWorkflowAgentNodeResult | undefined
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          completed = await ipc<CompleteWorkflowAgentNodeResult>('completeWorkflowAgentNode', {
            runId: run.id, nodeId: agent.id, userId, userName: 'Synthetic validation', providerId, executor: 'direct-provider',
          })
          break
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          if (attempt === 3 || !reason.includes('invalid_model_output') ||
              !reason.includes('retryable=true') || !reason.includes('cause=invalid_json')) throw error
          const failed = await ipc<LocalExecutionState>('loadState')
          assert.equal(failed.runs.find((item) => item.id === run.id)?.currentNodeId, agent.id)
          assert(!failed.artifacts.some((item) => item.runId === run.id && item.nodeId === agent.id &&
            item.kind === (stage === 'clarify' ? 'clarification' : 'design')),
          'A malformed model response must not create a stage artifact')
          await step(`${stage}:provider-retry`, { failedAttempt: attempt, reason: 'retryable_invalid_json',
            note: 'The actual failed call remains audited and billed; retry uses the same governed public IPC.' })
        }
      }
      assert(completed, `${stage} did not produce a valid response`)
      run = completed.run
      await receipt(stage, completed.artifact, stage)
      await writeFile(path.join(output, `${stage}.md`), completed.artifact.content)
      await review(`${stage}-review`, gate.id, stage)
      const identity = stage === 'clarify'
        ? { expectedClarificationRevision: { artifactId: completed.artifact.id,
          revision: completed.artifact.clarificationRevision!.revision,
          revisionDigest: completed.artifact.clarificationRevision!.revisionDigest } }
        : { expectedDesignRevision: { artifactId: completed.artifact.id, updatedAt: completed.artifact.updatedAt,
          contentDigest: hash(JSON.stringify({ title: completed.artifact.title,
            summary: completed.artifact.summary, content: completed.artifact.content })) } }
      run = (await ipc<{ run: WorkflowRun }>('approveGate', { runId: run.id, nodeId: gate.id, ...identity })).run
      await step(`${stage}:approved`, { artifactId: completed.artifact.id, versionBound: true })
    }
    const build = nodes.find((node) => node.stage === 'build' && node.kind === 'task')
    assert(build)
    await step('coding:started')
    const started = await ipc<{ codingRun: CodingAgentRun }>('runCodingAgent', {
      runId: run.id, nodeId: build.id, projectId: project.id, requestedBy: userId, userInstruction: request,
    })
    const codingId = started.codingRun.id
    let state = await ipc<LocalExecutionState>('loadState')
    await receipt('coding', started.codingRun.contextReceipt, 'build')
    // Native may propose one bounded repair after running the real configured tests.
    // Each diff, including a repair, requires independent review of its exact digest.
    for (const phase of ['initial', 'repair'] as const) {
      if (state.codingRuns.find((item) => item.id === codingId)?.status === 'completed') break
      const permission = state.codingPermissionRequests.find((item) => item.codingRunId === codingId && item.status === 'pending')
      assert(permission?.changeSetId && permission.changeSetDigest, `Expected a pending exact Native ${phase} Change Set`)
      const preview = await ipc<CodingChangeSetPreview>('getCodingChangeSetPreview', {
        changeSetId: permission.changeSetId, codingRunId: codingId,
      })
      assert.equal(preview.phase, phase)
      assert.equal(preview.changeSetDigest, permission.changeSetDigest)
      assert(preview.changedPaths.length > 0 && preview.changedPaths.every((file) => allowedChangePaths.has(file)),
        'The proposed changes exceed the isolated Todo target allowlist')
      if (phase === 'initial') assert(preview.changedPaths.includes('src/store.js'), 'The proposed diff does not implement the Todo operation')
      const prefix = phase === 'initial' ? '' : 'repair-'
      const approvalFile = path.join(output, `${prefix}approved-digest.txt`)
      await writeFile(path.join(output, `${prefix}preview.diff`), preview.unifiedDiff)
      await writeFile(path.join(output, `${prefix}pending-approval.json`), `${JSON.stringify({
        phase, changeSetDigest: permission.changeSetDigest, codingRunId: codingId, permissionId: permission.id,
        changedPaths: preview.changedPaths,
      }, null, 2)}\n`)
      await step('coding:review-diff', { changeSetPhase: phase, changeSetDigest: permission.changeSetDigest,
        changedPaths: preview.changedPaths, approvalFile })
      let approved = false
      for (let attempt = 0; attempt < 600; attempt++) {
        const approvedDigest = await readFile(approvalFile, 'utf8').catch(() => '')
        if (approvedDigest.trim() === preview.changeSetDigest) { approved = true; break }
        await delay(1_000)
      }
      assert(approved, 'The exact diff was not reviewed within ten minutes; profile retained')
      await ipc('replyCodingPermission', { requestId: permission.id, codingRunId: codingId, decidedBy: userId,
        decision: 'approved', comment: 'Codex reviewed the exact isolated Todo diff under the authorized full-chain test.' })
      state = await ipc<LocalExecutionState>('loadState')
    }
    const coding = state.codingRuns.find((item) => item.id === codingId)
    assert.equal(coding?.status, 'completed', 'Native coding did not complete; do not approve an unreviewed repair')
    assert(state.testEvidence.some((item) => item.id === coding?.testEvidenceId && item.status === 'passed'))
    const managed = state.managedCodingWorkspaces.find((item) => item.codingRunId === codingId)
    assert(managed)
    report.evidence.coding = { status: coding.status, workspace: managed.worktreePath,
      changedPaths: coding.changedPaths, contextReceipt: coding.contextReceipt, usage: coding.runtimeCostSummary }
    assert.equal(hash(await readFile(path.join(fixture.repositoryPath, 'src/store.js'))), baselineStoreDigest)
    for (const file of coding.changedPaths) {
      await mkdir(path.dirname(path.join(output, 'generated', file)), { recursive: true })
      await writeFile(path.join(output, 'generated', file), await readFile(path.join(managed.worktreePath, file)))
    }
    await step('coding:complete', { originalRepositoryUnchanged: true, managedRepository: managed.worktreePath })
    const testNode = nodes.find((node) => node.kind === 'test')
    assert(testNode)
    const tested = await ipc<RunProjectTestsResult>('runProjectTests', {
      projectId: project.id, runId: run.id, nodeId: testNode.id,
    })
    assert.equal(tested.evidence.status, 'passed')
    assert.equal(tested.evidence.exitCode, 0)
    await receipt('test', tested.evidence, 'test')
    await writeFile(path.join(output, 'tests.json'), `${JSON.stringify(tested.evidence, null, 2)}\n`)
    report.evidence.browser = await verifyFullchainTodoBrowser({
      app, originalRepository: fixture.repositoryPath, managedRepository: managed.worktreePath, output,
    })
    await step('test:passed', { evidenceId: tested.evidence.id })
    const prNode = nodes.find((node) => node.stage === 'pr')
    const acceptNode = nodes.find((node) => node.stage === 'accept')
    assert(prNode && acceptNode)
    const draft = await ipc<CreatePrDraftResult>('createPrDraft', { runId: run.id, nodeId: prNode.id })
    assert.equal(draft.artifact.kind, 'pr')
    assert.equal(draft.run.pullRequestUrl, undefined)
    // Delivery packaging is deterministic evidence assembly, not a model call.
    // Verify knowledge delivery through the PR review below.
    report.evidence['pr-package'] = { artifactId: draft.artifact.id, modelCall: false,
      source: 'trusted-coding-diff-and-test-evidence' }
    await writeFile(path.join(output, 'pr-package.md'), draft.artifact.content)
    await review('pr-review', prNode.id, 'pr')
    // The product requires real remote delivery before this node becomes current. Exercise that
    // boundary through IPC rather than fabricating delivery or editing the saved Run.
    await assert.rejects(() => ipc('runKnowledgeReview', {
      runId: run.id, nodeId: acceptNode.id, projectId: project.id,
      requestedBy: userId, runtime: 'electron', providerId,
    }), /只能针对当前 Gate、PR 交付或 Acceptance 节点运行/u)
    report.evidence.acceptanceElectronBoundary = {
      status: 'correctly-blocked-before-delivery',
      knowledgeReceiptVerified: false,
      requiredAdditionalEvidence: 'Acceptance knowledge delivery must be covered by the public runtime integration test; this Electron run did not reach Acceptance.',
    }
    state = await ipc<LocalExecutionState>('loadState')
    const finalRun = state.runs.find((item) => item.id === run.id)
    assert.equal(finalRun?.pullRequestUrl, undefined)
    report.workflowCompleted = finalRun?.status === 'completed'
    report.evidence.workflowBoundary = {
      currentNodeId: finalRun?.currentNodeId, status: finalRun?.status,
      note: 'Clarify/design/build/test/PR knowledge verified. Acceptance IPC correctly refused the future node; no remote delivery or final business approval was fabricated.',
    }
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.screenshot({ path: path.join(output, 'desktop-final.png'), scale: 'css' })
    report.passed = true
    await step('electron-available-phases:passed', {
      deliveryPublished: false, workflowCompleted: report.workflowCompleted, acceptanceElectronReviewVerified: false,
    })
  } catch (error) {
    report.failure = error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000)
    await step('fullchain:failed', { reason: report.failure })
  } finally {
    // Keep profile, repository and evidence, including on failure. Do not delete remote projections
    // behind an operator's back; the caller separately runs the audited cleanup/ledger closure.
    await app?.close().catch(() => undefined)
    await stopProcess(team?.process)
    report.evidence.coverage = {
      clarification: Boolean(report.evidence.clarify),
      clarificationReview: Boolean(report.evidence['clarify-review']),
      design: Boolean(report.evidence.design),
      designReview: Boolean(report.evidence['design-review']),
      coding: (report.evidence.coding as { status?: string } | undefined)?.status === 'completed',
      projectTests: Boolean(report.evidence.test),
      todoBrowser: Boolean(report.evidence.browser),
      prPackage: Boolean(report.evidence['pr-package']),
      prReview: Boolean(report.evidence['pr-review']),
      acceptanceElectronReview: false,
      acceptancePublicRuntime: 'requires separate integration evidence',
      remoteDelivery: false,
      workflowCompleted: report.workflowCompleted,
    }
    report.finishedAt = new Date().toISOString()
    await save()
    console.log(JSON.stringify({ passed: report.passed, failure: report.failure, output,
      retainedWorkspace: workspace.tempRoot, cleanupRequired: true }))
  }
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runHindsightFullchainElectron()
  if (!result.passed) process.exitCode = 1
}
