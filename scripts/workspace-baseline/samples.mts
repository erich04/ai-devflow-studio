// State samples for the workspace redesign baseline (plan §7 S0, §8.1).
// A sample is a fixed preparation procedure; every run prepares it again in a fresh
// isolated workspace. No user data snapshots are stored.
//
// Page callbacks passed to page.evaluate / app.evaluate must not declare named inner
// functions: the TypeScript loader would inject a `__name` helper that the page lacks.
import { execFile } from 'node:child_process'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ServerResponse } from 'node:http'
import type { DesktopApp, SampleRepoVariant, TeamApi, Workspace } from './environment.mts'
import {
  createPairingCode,
  createSampleRepo,
  createTeamProject,
  databasePath,
  delay,
  holdResultUploads,
  routeModelRequests,
  runSql,
  startModelServer,
  stubRepositoryPicker,
  teamRequest,
} from './environment.mts'
import type { MeasureOptions } from './measure.mts'

const execFileAsync = promisify(execFile)

export type PreparationMethod = 'ui' | 'ipc' | 'store' | 'renderer'

export interface SampleContext {
  /** Replaced when the sample relaunches the desktop. */
  desktop: DesktopApp
  workspace: Workspace
  api: TeamApi
  theme: 'light' | 'dark'
  log: (message: string) => void
  /** Saves an extra evidence screenshot, for example of a transient toast. */
  capture: (label: string) => Promise<void>
  /** Records a finding in the manifest (used for the plan §2.3 verification items). */
  observe: (key: string, value: unknown) => void
  /** Closes the desktop, optionally edits the closed database, and launches it again. */
  relaunch: (whileClosed?: () => Promise<void>) => Promise<void>
  /** Registers cleanup that runs after the desktop has closed. */
  onCleanup: (action: () => Promise<void>) => void
}

export interface Sample {
  id: string
  title: string
  /** Plan sections or issue IDs this sample serves. */
  planRefs: string[]
  method: PreparationMethod
  /** True when deterministic fake runtimes or seeded data stand in for real ones. */
  simulated: boolean
  /** Transient states are captured right after preparation; they cannot be frozen. */
  transient: boolean
  repoVariant: SampleRepoVariant
  limits: string[]
  /** Content sizes measured by default; the main baseline uses all three. */
  sizes?: string[]
  /** Extra environment for the desktop main process. */
  launchEnv?: Record<string, string | undefined>
  /** Absent for states that a real Electron window cannot show; see `alternative`. */
  prepare?: (ctx: SampleContext) => Promise<void>
  /** Runs after the measurement to record follow-up checks without changing the screenshot. */
  followUp?: (ctx: SampleContext) => Promise<void>
  alternative?: string
  measure: MeasureOptions
}

/**
 * Selectors for the current (pre-S1) layout, each followed by the stable test id S1 adds,
 * so the same definition measures both before and after.
 */
export const taskPageMeasure: MeasureOptions = {
  fontRoot: 'main',
  regions: {
    topbar: '.topbar',
    statusStrip: '.status-strip',
    // Before S1 there is no status row; the node status summary is the bottom of the node header.
    statusRow: '[data-testid="task-status-row"], .inspector .node-status-summary',
    nodeHeader: '.inspector .panel-head',
    firstBodyBlock: { selector: '[data-testid="workspace-tabpanel"], #workspace-content', pick: 'first-visible-child' },
    tabpanel: '[data-testid="workspace-tabpanel"], #workspace-content',
    tabs: '.workspace-primary-tabs',
    discussion: '.workbench-workspace',
    stageNavigation: '[data-testid="stage-navigation"], .workflow-stage-navigation',
    // Global floating toast (L4); its text also counts towards the location phrases.
    toast: '.toast--floating',
    main: 'main',
  },
  controlScopes: { topbar: '.topbar', statusStrip: '.status-strip' },
  phrases: ['需求确认 Gate', '当前步骤', '实际当前节点', '实际进度'],
  truncationSelector: '[data-testid="stage-item"], .workflow-stage-navigation .workflow-stage-step > button',
}

const TASK_TITLE = 'Health API 增加依赖探测'
const TASK_REQUEST = '/health 返回数据库和缓存依赖状态，依赖超时 300 ms 内降级，不影响主服务可用性。'
const FAKE_PROVIDER = 'fake-knowledge-review'
const STAGE = { clarify: '需求澄清', design: '方案设计', build: '开发实现', test: '测试证据', pr: 'PR 交付', accept: '业务验收' }

// ---------------------------------------------------------------------------------------------
// Desktop API and state helpers.

export async function ipc<T = any>(ctx: SampleContext, method: string, input?: unknown): Promise<T> {
  return ctx.desktop.page.evaluate(
    ([name, value]) => (window as any).aiDevFlowDesktop[name as string](value),
    [method, input] as [string, unknown],
  ) as Promise<T>
}

/** Starts a desktop call without waiting for it (the renderer keeps the promise). */
async function ipcDetached(ctx: SampleContext, method: string, input?: unknown): Promise<void> {
  await ctx.desktop.page.evaluate(
    ([name, value]) => {
      void (window as any).aiDevFlowDesktop[name as string](value).catch(() => undefined)
      return true
    },
    [method, input] as [string, unknown],
  )
}

async function loadState(ctx: SampleContext): Promise<any> {
  return ipc(ctx, 'loadState')
}

async function pollUntil<T>(label: string, read: () => Promise<T | undefined | null | false>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (value) return value as T
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`)
    await delay(500)
  }
}

async function projectFor(ctx: SampleContext, repoDir: string): Promise<any> {
  const candidates = new Set([repoDir, await realpath(repoDir).catch(() => repoDir)])
  return pollUntil('local project', async () => {
    const state = await loadState(ctx)
    return state.projects.find((project: any) => candidates.has(project.path))
  })
}

async function runByTitle(ctx: SampleContext, projectId: string, title: string): Promise<any> {
  return pollUntil(`run "${title}"`, async () => {
    const state = await loadState(ctx)
    return state.runs
      .filter((run: any) => run.projectId === projectId && run.title === title)
      .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
  })
}

async function getRun(ctx: SampleContext, runId: string): Promise<any> {
  const state = await loadState(ctx)
  return state.runs.find((run: any) => run.id === runId)
}

function nodeOf(run: any, stage: string, kind: string): any {
  const node = run.nodes.find((candidate: any) => candidate.stage === stage && candidate.kind === kind)
  if (!node) throw new Error(`Run ${run.id} has no ${stage}/${kind} node`)
  return node
}

async function syncOperations(ctx: SampleContext, projectId: string) {
  const state = await loadState(ctx)
  return state.remoteSyncOperations
    .filter((operation: any) => operation.localProjectId === projectId)
    .map((operation: any) => ({
      kind: operation.kind,
      runId: operation.runId,
      status: operation.status,
      lastErrorCode: operation.lastErrorCode,
      recovery: operation.recovery,
      hasTeamTarget: operation.organizationId !== null || operation.teamProjectId !== null,
      teamProjectId: operation.teamProjectId,
      attemptCount: operation.attemptCount,
    }))
}

async function waitForOutboxIdle(ctx: SampleContext, projectId: string, timeoutMs = 30_000) {
  return pollUntil('remote sync outbox to go idle', async () => {
    const operations = await syncOperations(ctx, projectId)
    const busy = operations.some((operation: any) => ['pending', 'sending', 'retry-scheduled'].includes(operation.status))
    return busy ? undefined : operations
  }, timeoutMs)
}

async function pairing(ctx: SampleContext): Promise<any> {
  return ipc(ctx, 'loadDesktopPairing')
}

// ---------------------------------------------------------------------------------------------
// UI helpers (real user paths).

// Steps work on both layouts: before S1 the project and task lists share one menu in the
// node reader; from S1 the project menu is in the top bar and the task menu is the title row.
async function openMenu(ctx: SampleContext, selector: string) {
  const menu = ctx.desktop.page.locator(selector).first()
  if ((await menu.getAttribute('open')) === null) await menu.locator(':scope > summary').click()
}

async function closeMenu(ctx: SampleContext, selector: string) {
  const menu = ctx.desktop.page.locator(selector).first()
  if ((await menu.count()) > 0 && (await menu.getAttribute('open')) !== null) await menu.locator(':scope > summary').click()
}

async function projectMenuSelector(ctx: SampleContext) {
  return (await ctx.desktop.page.locator('.topbar-project-menu').count()) > 0 ? '.topbar-project-menu' : '.workbench-project-menu'
}

async function openProjectMenu(ctx: SampleContext) {
  await openMenu(ctx, '.workbench-project-menu')
}

async function closeProjectMenu(ctx: SampleContext) {
  await closeMenu(ctx, '.workbench-project-menu')
}

/** Opens the team connection popover (S1) when the pairing controls are not already on screen. */
async function openTeamControls(ctx: SampleContext) {
  const { page } = ctx.desktop
  if (await page.getByLabel('Desktop pairing code').isVisible().catch(() => false)) return
  const trigger = page.getByRole('button', { name: /^团队连接(：|$)/ })
  if ((await trigger.count()) > 0) {
    await trigger.click()
    await page.getByLabel('Desktop pairing code').waitFor({ state: 'visible', timeout: 5_000 })
  }
}

async function closeTeamControls(ctx: SampleContext) {
  const close = ctx.desktop.page.getByRole('button', { name: '关闭团队连接', exact: true })
  if ((await close.count()) > 0) await close.click()
}

async function clickNav(ctx: SampleContext, name: string) {
  await ctx.desktop.page.locator('.sidebar.rail').getByRole('button', { name, exact: true }).click()
  await delay(500)
}

/** Selects a local repository through the real project menu. Returns the local project. */
async function selectRepository(ctx: SampleContext, repoDir = ctx.workspace.repoDir): Promise<any> {
  await clickNav(ctx, '工作台')
  await stubRepositoryPicker(ctx.desktop.app, repoDir)
  const menu = await projectMenuSelector(ctx)
  await openMenu(ctx, menu)
  await ctx.desktop.page.getByRole('button', { name: /选择本地仓库/ }).click()
  const project = await projectFor(ctx, repoDir)
  await delay(800)
  await closeMenu(ctx, menu)
  return project
}

async function selectRun(ctx: SampleContext, title: string) {
  await clickNav(ctx, '工作台')
  await openProjectMenu(ctx)
  await ctx.desktop.page.locator('.run-row').filter({ hasText: title }).first().click()
  await closeProjectMenu(ctx)
  await delay(800)
}

/** Creates a task through the real new-task dialog and selects it. */
async function createTask(ctx: SampleContext, title = TASK_TITLE, request = TASK_REQUEST) {
  const { page } = ctx.desktop
  await clickNav(ctx, '工作台')
  await page.getByRole('button', { name: /新建 Run|新建任务/ }).click()
  const dialog = page.getByRole('dialog', { name: /Create new run|新建任务/ })
  await dialog.getByLabel('标题').fill(title)
  await dialog.getByLabel('一句话需求').fill(request)
  await dialog.getByRole('button', { name: /创建并开始澄清|创建任务/ }).click()
  await delay(1_500)
  await selectRun(ctx, title)
}

async function inspectorTitle(ctx: SampleContext, title: string, timeoutMs = 30_000) {
  await ctx.desktop.page
    .locator('[data-testid="node-inspector"] :is(.panel-title, .task-status-step)')
    .filter({ hasText: title })
    .waitFor({ state: 'visible', timeout: timeoutMs })
}

/** Generates the clarification with the Deterministic Fake Provider (the default provider). */
async function generateClarification(ctx: SampleContext) {
  ctx.log('generating clarification with the fake provider')
  await ctx.desktop.page.getByRole('button', { name: /生成需求澄清|生成需求草稿|生成修订/ }).first().click()
  await inspectorTitle(ctx, '需求确认 Gate')
}

/** Waits until the floating toast is gone so it does not skew the measurement (toasts last ≥ 8 s). */
export async function waitForToastToClear(ctx: SampleContext, timeoutMs = 25_000) {
  await ctx.desktop.page.locator('.toast--floating').waitFor({ state: 'detached', timeout: timeoutMs }).catch(() => {
    ctx.log('toast still visible after waiting; measurement will include it')
  })
}

async function settle(ctx: SampleContext) {
  await waitForToastToClear(ctx)
  await delay(500)
}

async function reloadAndSelectRun(ctx: SampleContext, title: string) {
  await ctx.desktop.page.reload({ waitUntil: 'domcontentloaded' })
  await ctx.desktop.page.locator('.topbar').waitFor({ state: 'visible', timeout: 30_000 })
  await delay(1_000)
  await selectRun(ctx, title)
}

/** Selects a node through the compact stage navigation, as a user would. */
async function selectNode(ctx: SampleContext, stageLabel: string, node: any) {
  const { page } = ctx.desktop
  await page.locator('.workflow-stage-navigation .workflow-stage-step > button').filter({ hasText: stageLabel }).click()
  await delay(300)
  const shown = page.locator('[data-testid="node-inspector"] :is(.panel-title, .task-status-step)').filter({ hasText: node.title })
  if ((await shown.count()) === 0) {
    const button = page.getByTestId(`flow-node-${node.id}`)
    const toggle = page.locator('.stage-substeps-toggle')
    if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
    if ((await button.count()) > 0) await button.click()
    if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click()
  }
  await inspectorTitle(ctx, node.title)
  await delay(500)
}

async function openInspectorTab(ctx: SampleContext, name: string) {
  await ctx.desktop.page.getByTestId('node-inspector').getByRole('tab', { name, exact: true }).click()
  await delay(500)
}

/** Pairs the selected local project through the real top-bar form. */
async function pairViaForm(ctx: SampleContext, code: string) {
  const before = JSON.stringify((await pairing(ctx)) ?? null)
  await openTeamControls(ctx)
  const { page } = ctx.desktop
  await page.getByLabel('Desktop pairing code').fill(code)
  await page.getByRole('button', { name: /^(绑定|连接|重新连接)$/ }).click()
  const confirm = page.getByRole('button', { name: '确认替换', exact: true })
  if (await confirm.waitFor({ state: 'visible', timeout: 1_500 }).then(() => true).catch(() => false)) await confirm.click()
  const after = await pollUntil('desktop pairing', async () => {
    const current = await pairing(ctx)
    return current && JSON.stringify(current) !== before ? current : undefined
  })
  await delay(1_000)
  await closeTeamControls(ctx)
  return after
}

function changedCredentialFields(before: any, after: any): string[] {
  return [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
    .filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))
    .sort()
}

/** Clicks the top-bar team pull and returns what the user was told. */
async function pullTeamData(ctx: SampleContext) {
  const { page } = ctx.desktop
  await openTeamControls(ctx)
  await page.getByRole('button', { name: /拉取团队数据|更新团队数据/ }).first().click()
  await pollUntil('team pull to finish', async () => {
    const text = await page.locator('body').innerText()
    return !text.includes('拉取中') && !text.includes('更新中')
  })
  await delay(500)
  const toast = (await page.locator('.toast--floating').innerText().catch(() => '')).trim()
  await closeTeamControls(ctx)
  return toast
}

async function openSyncPopover(ctx: SampleContext) {
  const legacy = ctx.desktop.page.locator('.status-strip').getByRole('button', { name: /^同步/ })
  if ((await legacy.count()) > 0) await legacy.click()
  else await ctx.desktop.page.getByRole('button', { name: /^团队连接(：|$)/ }).click()
  await delay(500)
}

/** Requests a clarification revision through the inspector form; this writes the Run. */
async function requestChangesViaUi(ctx: SampleContext, feedback = '补充依赖探测失败时的降级返回格式。') {
  const { page } = ctx.desktop
  const revise = page.getByTestId('node-inspector').getByRole('button', { name: '请求修订当前版本', exact: true })
  if (!(await revise.isVisible().catch(() => false))) await page.locator('.task-status-more > summary').click()
  await revise.click()
  await page.locator('#clarification-feedback').fill(feedback)
  await page.getByRole('button', { name: '确认提交修订请求', exact: true }).click()
  await page.getByRole('button', { name: /生成需求澄清|生成需求草稿|生成修订/ }).first().waitFor({ state: 'visible', timeout: 30_000 })
  await delay(1_000)
}

async function saveEnforcementPolicy(ctx: SampleContext, missingReviewAction: 'block' | 'warn') {
  const updatedAt = new Date().toISOString()
  const rule = (target: string, category: string, statusOrSeverity: string, action: string, remediation?: string) => ({
    ruleKey: `${target}:${category}:${statusOrSeverity}`,
    target,
    category,
    statusOrSeverity,
    defaultAction: action,
    floorAction: action === 'block' ? 'block' : 'ignore',
    overridable: true,
    ...(remediation ? { remediation } : {}),
    updatedAt,
  })
  const organizationPolicy = {
    id: 'enforcement-policy-org-demo-workspace-baseline',
    organizationId: 'org-demo',
    name: 'Workspace baseline enforcement',
    version: 1,
    updatedAt,
    rules: [
      rule('missing_agent_review', 'protected_gate', 'missing', missingReviewAction, 'Run the knowledge-grounded Gate Review for this protected Gate.'),
      rule('governance_check', 'testing_standard', 'needs_evidence', 'warn'),
      rule('governance_check', 'testing_standard', 'violated', 'warn'),
      rule('governance_check', 'api_contract', 'violated', 'warn'),
      rule('governance_check', 'review_checklist', 'needs_evidence', 'warn'),
      rule('agent_finding', 'missing_evidence', 'medium', 'warn'),
      rule('agent_finding', 'test_risk', 'high', 'warn'),
      rule('agent_finding', 'api_contract_risk', 'high', 'warn'),
      rule('agent_finding', 'security_risk', 'high', 'warn'),
      rule('agent_finding', 'review_gap', 'low', 'warn'),
    ],
  }
  const result = await teamRequest(ctx.api, 'PUT', '/api/enforcement/policy', { demo: true, body: { organizationPolicy } })
  if (result.status >= 300) throw new Error(`Unable to save the enforcement policy: ${result.status}`)
}

// ---------------------------------------------------------------------------------------------
// Composite preparations.

interface ClarifyGateState {
  projectId: string
  run: any
  gate: any
}

/** The 2026-09-28 walkthrough path: select repo → new task → generate clarification. */
async function prepareClarifyGate(ctx: SampleContext): Promise<ClarifyGateState> {
  const project = await selectRepository(ctx)
  await createTask(ctx)
  await generateClarification(ctx)
  const run = await runByTitle(ctx, project.id, TASK_TITLE)
  return { projectId: project.id, run, gate: nodeOf(run, 'clarify', 'gate') }
}

async function latestClarification(ctx: SampleContext, runId: string): Promise<any> {
  const state = await loadState(ctx)
  return state.artifacts
    .filter((artifact: any) => artifact.runId === runId && artifact.kind === 'clarification' && artifact.clarificationRevision)
    .sort((a: any, b: any) => b.clarificationRevision.revision - a.clarificationRevision.revision)[0]
}

async function runGateReviewIpc(ctx: SampleContext, runId: string, nodeId: string, projectId: string) {
  return ipc(ctx, 'runKnowledgeReview', {
    runId, nodeId, projectId, requestedBy: 'u-erich', runtime: 'electron', providerId: FAKE_PROVIDER,
  })
}

async function approveClarifyGate(ctx: SampleContext, run: any) {
  const gate = nodeOf(run, 'clarify', 'gate')
  const artifact = await latestClarification(ctx, run.id)
  return ipc(ctx, 'approveGate', {
    runId: run.id,
    nodeId: gate.id,
    expectedClarificationRevision: {
      artifactId: artifact.id,
      revision: artifact.clarificationRevision.revision,
      revisionDigest: artifact.clarificationRevision.revisionDigest,
    },
  })
}

async function completeAgent(ctx: SampleContext, runId: string, nodeId: string) {
  return ipc(ctx, 'completeWorkflowAgentNode', { runId, nodeId, userId: 'u-erich', userName: 'Erich', providerId: FAKE_PROVIDER })
}

/** Fast-forwards through both Gates with the fake provider and fake reviews (layout-only). */
async function fastForwardToBuild(ctx: SampleContext, runId: string, projectId: string): Promise<any> {
  let run = await getRun(ctx, runId)
  const nodes = {
    clarify: nodeOf(run, 'clarify', 'agent'),
    clarifyGate: nodeOf(run, 'clarify', 'gate'),
    design: nodeOf(run, 'design', 'agent'),
    designGate: nodeOf(run, 'design', 'gate'),
  }
  if (run.currentNodeId === nodes.clarify.id) run = (await completeAgent(ctx, runId, nodes.clarify.id)).run
  await runGateReviewIpc(ctx, runId, nodes.clarifyGate.id, projectId)
  run = (await approveClarifyGate(ctx, run)).run
  run = (await completeAgent(ctx, runId, nodes.design.id)).run
  await runGateReviewIpc(ctx, runId, nodes.designGate.id, projectId)
  run = (await ipc(ctx, 'approveGate', { runId, nodeId: nodes.designGate.id })).run
  if (run.currentNodeId !== nodeOf(run, 'build', 'task').id) throw new Error('Fast-forward did not reach the build node')
  return run
}

/** Pairing and a budget policy are prerequisites for coding runs and team-scoped samples. */
async function pairAndBudget(ctx: SampleContext, projectId: string) {
  await pairViaForm(ctx, await createPairingCode(ctx.api))
  await ipc(ctx, 'saveCodingRuntimeBudgetPolicy', { projectId, enabled: true, monthlyLimitUsd: 1, warningThresholdUsd: 0.5 })
}

interface BuildState {
  projectId: string
  run: any
}

async function prepareBuild(ctx: SampleContext): Promise<BuildState> {
  const project = await selectRepository(ctx)
  await pairAndBudget(ctx, project.id)
  await createTask(ctx)
  const created = await runByTitle(ctx, project.id, TASK_TITLE)
  const run = await fastForwardToBuild(ctx, created.id, project.id)
  return { projectId: project.id, run }
}

async function startFakeCoding(ctx: SampleContext, state: BuildState) {
  const build = nodeOf(state.run, 'build', 'task')
  const result = await ipc(ctx, 'runCodingAgent', {
    runId: state.run.id,
    nodeId: build.id,
    projectId: state.projectId,
    requestedBy: 'u-erich',
    userInstruction: 'Add the dependency probe to /health.',
  })
  const permission = result.state.codingPermissionRequests.find(
    (request: any) => request.codingRunId === result.codingRun.id && request.status === 'pending',
  )
  return { codingRun: result.codingRun, permission }
}

async function reachTestStage(ctx: SampleContext): Promise<BuildState> {
  const state = await prepareBuild(ctx)
  const { codingRun, permission } = await startFakeCoding(ctx, state)
  await ipc(ctx, 'replyCodingPermission', {
    requestId: permission.id, codingRunId: codingRun.id, decidedBy: 'u-erich', decision: 'approved', comment: 'Baseline approval.',
  })
  const testNode = nodeOf(state.run, 'test', 'test')
  const run = await pollUntil('run to reach the test node', async () => {
    const current = await getRun(ctx, state.run.id)
    return current?.currentNodeId === testNode.id ? current : undefined
  }, 60_000)
  return { projectId: state.projectId, run }
}

async function reachPrStage(ctx: SampleContext): Promise<BuildState> {
  const state = await reachTestStage(ctx)
  const testNode = nodeOf(state.run, 'test', 'test')
  const tested = await ipc(ctx, 'runProjectTests', { projectId: state.projectId, runId: state.run.id, nodeId: testNode.id })
  ctx.observe('testEvidenceStatus', tested.evidence?.status)
  const prNode = nodeOf(state.run, 'pr', 'pr')
  const drafted = await ipc(ctx, 'createPrDraft', { runId: state.run.id, nodeId: prNode.id })
  return { projectId: state.projectId, run: drafted.run }
}

async function reviewSummary(ctx: SampleContext, runId: string, nodeId: string) {
  const reviews = await ipc<any[]>(ctx, 'listAgentReviews', { runId })
  const review = reviews.filter((item) => item.nodeId === nodeId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
  return review
    ? {
        id: review.id,
        risks: review.risks.length,
        missingEvidence: review.missingEvidence.length,
        suggestedTests: review.suggestedTests.length,
        advisoryLevel: review.gateAdvisory?.level,
        blocksApproval: review.gateAdvisory?.blocksApproval,
      }
    : null
}

/** Runs the Gate Review from the task status row with the fake provider (plan S2, W2). */
async function runGateReviewInTask(ctx: SampleContext, gate: any) {
  const { page } = ctx.desktop
  const inspector = page.getByTestId('node-inspector')
  await inspector.getByTestId('task-status-row').getByRole('button', { name: '运行门禁审查', exact: true }).click()
  await pollUntil('Gate Review to finish', async () =>
    (await inspector.getByTestId('task-review-run').count()) > 0 &&
    (await inspector.getByTestId('task-review-run').innerText()).includes('上次审查'), 30_000)
  await selectNode(ctx, STAGE.clarify, gate)
}

async function runSummary(ctx: SampleContext, runId: string) {
  const run = await getRun(ctx, runId)
  return {
    currentNode: run.nodes.find((node: any) => node.id === run.currentNodeId)?.title,
    status: run.status,
    nodes: run.nodes.map((node: any) => `${node.stage}/${node.kind}:${node.status}`),
  }
}

// ---------------------------------------------------------------------------------------------
// Samples.

const common = { simulated: true, transient: false, repoVariant: 'pass' as SampleRepoVariant, measure: taskPageMeasure }
const fakeLimit = '模型输出来自 Deterministic Fake Provider，门禁审查与编码使用确定性模拟，不代表真实模型的内容或耗时。'
const ipcLimit = '部分步骤直接调用桌面 IPC 快进（方案 8.3 节），只用于布局对比，不作为用户路径的证据。'

const clarifyGateWarn: Sample = {
  ...common,
  id: 'clarify-gate-warn',
  title: '需求确认 Gate：策略仅警告，缺少门禁审查（主基线；同时是空讨论样例）',
  planRefs: ['2.2', 'D1', 'D3', 'L1-L5', '5.4 空讨论', '8.1'],
  method: 'ui',
  sizes: ['1440x742', '1280x742', '1024x742'],
  limits: [fakeLimit, '本地项目未连接团队，使用内置的仅警告策略。'],
  async prepare(ctx) {
    await prepareClarifyGate(ctx)
    await delay(1_500)
    // L4 evidence: the floating toast covers the discussion pane's new/history buttons.
    await ctx.capture('toast')
    await settle(ctx)
  },
}

const clarifyGateSuggestions: Sample = {
  ...common,
  id: 'clarify-gate-suggestions',
  title: '需求确认 Gate：已有门禁审查，只剩非阻断建议',
  planRefs: ['6.1', '8.1'],
  method: 'ui',
  limits: [fakeLimit, 'Fake Provider 固定给出 1 条测试建议，风险条数取决于正文中的关键词。'],
  async prepare(ctx) {
    const { run, gate } = await prepareClarifyGate(ctx)
    await runGateReviewInTask(ctx, gate)
    ctx.observe('review', await reviewSummary(ctx, run.id, gate.id))
    await settle(ctx)
  },
}

const clarifyGateClean: Sample = {
  ...common,
  id: 'clarify-gate-clean',
  title: '需求确认 Gate：已有门禁审查，没有建议',
  planRefs: ['6.1', '8.1'],
  method: 'store',
  limits: [
    fakeLimit,
    'Fake Provider 总会给出测试建议，无法产生“没有建议”的审查。先走真实界面运行审查，再在应用关闭时直接改写本地库中这条审查的风险、缺失证据、测试建议和结论等级，只用于布局对比。',
  ],
  async prepare(ctx) {
    const { projectId, run, gate } = await prepareClarifyGate(ctx)
    await runGateReviewInTask(ctx, gate)
    const reviewId = (await reviewSummary(ctx, run.id, gate.id))?.id
    if (!reviewId) throw new Error('Gate Review was not stored')
    await ctx.relaunch(async () => {
      const { createLocalStore } = await import('../../apps/desktop/electron/local-store.ts')
      const store = await createLocalStore({ dbPath: databasePath(ctx.workspace) })
      try {
        const review = (await store.listAgentReviews(run.id)).find((item: any) => item.id === reviewId)
        if (!review) throw new Error('Gate Review missing in the closed database')
        await store.saveAgentReview({
          ...review,
          risks: [],
          missingEvidence: [],
          missingEvidenceDetails: [],
          suggestedTests: [],
          policyFindings: [],
          gateAdvisory: { ...review.gateAdvisory, level: 'info', blocksApproval: false, missingEvidence: [], riskCount: 0, summary: 'Gate Review found no risks or suggestions.' },
        })
      } finally {
        store.close()
      }
    })
    await selectRun(ctx, TASK_TITLE)
    await selectNode(ctx, STAGE.clarify, gate)
    ctx.observe('review', await reviewSummary(ctx, run.id, gate.id))
    ctx.observe('projectId', projectId ? 'present' : 'missing')
    await settle(ctx)
  },
}

const gateEnforcedBlock: Sample = {
  ...common,
  id: 'gate-enforced-block',
  title: '需求确认 Gate：团队策略强制阻断（缺少门禁审查）',
  planRefs: ['6.1', '8.1', 'D1'],
  method: 'ui',
  limits: [
    fakeLimit,
    '阻断原因是“缺少门禁审查”。按现有投影，这时的主动作是运行门禁审查，而不是“处理 Gate 阻断”；其他阻断原因见 App.test.tsx 的强制阻断用例。',
    '已连接到内存演示 Team API 的 p-payments 项目，团队策略由本脚本写入。',
  ],
  async prepare(ctx) {
    await saveEnforcementPolicy(ctx, 'block')
    const { projectId, run, gate } = await prepareClarifyGate(ctx)
    await pairViaForm(ctx, await createPairingCode(ctx.api))
    ctx.observe('pullToast', await pullTeamData(ctx))
    const decision = await ipc(ctx, 'evaluateGateEnforcement', { runId: run.id, nodeId: gate.id, projectId })
    ctx.observe('gateDecision', {
      status: decision.status,
      blocksApproval: decision.blocksApproval,
      blockingReasons: (decision.blockingReasons ?? []).map((reason: any) => reason.ruleKey ?? reason.id),
      warningReasons: (decision.warningReasons ?? []).map((reason: any) => reason.ruleKey ?? reason.id),
      policySource: decision.policySource,
    })
    ctx.observe('syncOperations', await syncOperations(ctx, projectId))
    await selectNode(ctx, STAGE.clarify, gate)
    await settle(ctx)
  },
}

const upstreamWaiting: Sample = {
  ...common,
  id: 'upstream-waiting',
  title: '浏览尚未开始的方案设计阶段（等待上游）',
  planRefs: ['5.1', '6.1', 'D5', '8.1'],
  method: 'ui',
  limits: [fakeLimit],
  async prepare(ctx) {
    const { run } = await prepareClarifyGate(ctx)
    await selectNode(ctx, STAGE.design, nodeOf(run, 'design', 'agent'))
    await settle(ctx)
  },
}

const clarifyHistory: Sample = {
  ...common,
  id: 'clarify-history',
  title: '需求有 v1、v2 两个版本，正在阅读 v1',
  planRefs: ['V1', '6.2', '8.1'],
  method: 'ui',
  limits: [fakeLimit, '两个版本都由 Fake Provider 按模板生成，正文相同，只有版本号不同。'],
  async prepare(ctx) {
    const { run } = await prepareClarifyGate(ctx)
    await requestChangesViaUi(ctx)
    await generateClarification(ctx)
    await settle(ctx)
    await openInspectorTab(ctx, '当前工作')
    const select = ctx.desktop.page.getByLabel('阅读需求版本')
    await select.waitFor({ state: 'visible', timeout: 15_000 })
    const options = await select.locator('option').allTextContents()
    const index = options.findIndex((text) => /v1 ·/.test(text))
    if (index < 0) throw new Error(`No v1 option in ${JSON.stringify(options)}`)
    await select.selectOption({ index })
    ctx.observe('versionOptions', options)
    ctx.observe('activeRevision', (await latestClarification(ctx, run.id))?.clarificationRevision?.revision)
    await delay(800)
  },
}

const designGate: Sample = {
  ...common,
  id: 'design-gate',
  title: '方案评审 Gate：已生成方案，缺少门禁审查',
  planRefs: ['3.1 六阶段', 'V2', '6.2'],
  method: 'ipc',
  limits: [fakeLimit, ipcLimit, '需求确认 Gate 经 IPC 运行审查并批准，方案由 Fake Provider 生成。'],
  async prepare(ctx) {
    const { projectId, run } = await prepareClarifyGate(ctx)
    await runGateReviewIpc(ctx, run.id, nodeOf(run, 'clarify', 'gate').id, projectId)
    await approveClarifyGate(ctx, run)
    await completeAgent(ctx, run.id, nodeOf(run, 'design', 'agent').id)
    await reloadAndSelectRun(ctx, TASK_TITLE)
    await selectNode(ctx, STAGE.design, nodeOf(run, 'design', 'gate'))
    ctx.observe('run', await runSummary(ctx, run.id))
    await settle(ctx)
  },
}

const buildPermission: Sample = {
  ...common,
  id: 'build-permission',
  title: '开发实现：待处理的权限请求',
  planRefs: ['3.1 六阶段', '6.1', '8.1 关键操作可见'],
  method: 'ipc',
  transient: true,
  limits: [fakeLimit, ipcLimit, '权限请求由 fake 编码引擎在启动时发出，会超时，所以制备后立即截图。', '已连接团队并保存预算策略，这是开始编码的前提。'],
  async prepare(ctx) {
    const state = await prepareBuild(ctx)
    const { codingRun, permission } = await startFakeCoding(ctx, state)
    ctx.observe('codingRun', { status: codingRun.status, hasPendingPermission: Boolean(permission) })
    await reloadAndSelectRun(ctx, TASK_TITLE)
    await selectNode(ctx, STAGE.build, nodeOf(state.run, 'build', 'task'))
    await settle(ctx)
  },
}

const buildInterrupted: Sample = {
  ...common,
  id: 'build-interrupted',
  title: '开发实现：拒绝权限请求后执行中断',
  planRefs: ['6.1', '8.1 关键操作可见'],
  method: 'ipc',
  limits: [fakeLimit, ipcLimit, '中断由拒绝 fake 引擎的权限请求得到；“应用重启导致中断”未单独制备。'],
  async prepare(ctx) {
    const state = await prepareBuild(ctx)
    const { codingRun, permission } = await startFakeCoding(ctx, state)
    await ipc(ctx, 'replyCodingPermission', {
      requestId: permission.id, codingRunId: codingRun.id, decidedBy: 'u-erich', decision: 'rejected', comment: 'Baseline rejection.',
    })
    const current = await pollUntil('coding run to stop', async () => {
      const found = (await loadState(ctx)).codingRuns.find((item: any) => item.id === codingRun.id)
      return found && found.status !== 'waiting_permission' ? found : undefined
    })
    ctx.observe('codingRun', { status: current.status })
    await reloadAndSelectRun(ctx, TASK_TITLE)
    await selectNode(ctx, STAGE.build, nodeOf(state.run, 'build', 'task'))
    await settle(ctx)
  },
}

const buildRunning: Sample = {
  ...common,
  id: 'build-running',
  title: '开发实现：DevFlow Native 执行中（可停止）',
  planRefs: ['6.1', '8.1 关键操作可见'],
  method: 'ipc',
  transient: true,
  // The project coding configuration (DevFlow Native) must win over the fake engine.
  launchEnv: { DEVFLOW_CODING_ENGINE: undefined, DEVFLOW_CODING_EXECUTOR: undefined, DEVFLOW_NATIVE_CODING_PROVIDER_ID: undefined },
  limits: [
    fakeLimit,
    ipcLimit,
    '模型请求发往本脚本的受控服务，服务一直不响应，使执行停留在进行中；没有真实模型调用。',
  ],
  async prepare(ctx) {
    const model = await startModelServer(() => {
      // Hold every request: the Native run stays in progress for the screenshot.
    })
    ctx.onCleanup(model.close)
    await routeModelRequests(ctx.desktop, model.url)
    const state = await prepareBuild(ctx)
    await ipc(ctx, 'saveAgentProviderCredential', {
      providerId: 'baseline-native-hold', name: 'Baseline 受控模型', apiKey: 'sk-workspace-baseline-only', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com',
    })
    await ipc(ctx, 'saveCodingRuntimeConfiguration', { projectId: state.projectId, executor: 'native-model', providerId: 'baseline-native-hold' })
    const build = nodeOf(state.run, 'build', 'task')
    await ipcDetached(ctx, 'runCodingAgent', {
      runId: state.run.id, nodeId: build.id, projectId: state.projectId, requestedBy: 'u-erich', userInstruction: 'Add the dependency probe to /health.',
    })
    const codingRun = await pollUntil('Native run to wait on the model', async () => {
      const found = (await loadState(ctx)).codingRuns.find((item: any) => item.runId === state.run.id)
      return found && model.requests.length > 0 ? found : undefined
    }, 60_000)
    ctx.observe('codingRun', { status: codingRun.status, engine: codingRun.engine, modelRequests: model.requests.length })
    await reloadAndSelectRun(ctx, TASK_TITLE)
    await selectNode(ctx, STAGE.build, build)
    await settle(ctx)
  },
}

const testStage: Sample = {
  ...common,
  id: 'test-stage',
  title: '测试验证：编码完成后进入测试节点',
  planRefs: ['3.1 六阶段'],
  method: 'ipc',
  limits: [fakeLimit, ipcLimit],
  async prepare(ctx) {
    const state = await reachTestStage(ctx)
    await reloadAndSelectRun(ctx, TASK_TITLE)
    await selectNode(ctx, STAGE.test, nodeOf(state.run, 'test', 'test'))
    ctx.observe('run', await runSummary(ctx, state.run.id))
    await settle(ctx)
  },
}

const prReady: Sample = {
  ...common,
  id: 'pr-ready',
  title: 'PR 交付：已生成 PR 草稿，等待准备交付',
  planRefs: ['3.1 六阶段', '5.3'],
  method: 'ipc',
  limits: [fakeLimit, ipcLimit, '没有 GitHub 仓库绑定，停在“准备交付”之前。'],
  async prepare(ctx) {
    const state = await reachPrStage(ctx)
    await reloadAndSelectRun(ctx, TASK_TITLE)
    await selectNode(ctx, STAGE.pr, nodeOf(state.run, 'pr', 'pr'))
    ctx.observe('run', await runSummary(ctx, state.run.id))
    await settle(ctx)
  },
}

const prApproval: Sample = {
  ...common,
  id: 'pr-approval',
  title: 'PR 交付：等待 Web 审批（approval_required）',
  planRefs: ['5.3', 'P1'],
  method: 'renderer',
  limits: ['真实路径需要 GitHub App 与仓库绑定；离线只能用 v1.5 的 GitHub 替身和隔离 Postgres（test:v15-github-delivery-packaged-smoke），不在 S0 的桌面测量范围内。'],
  alternative: 'App.test.tsx 中以 prDeliveryState(githubDeliveryIntentFixture("approval_required")) 渲染的用例；S1 的状态投影单元测试覆盖此分支。',
}

const acceptance: Sample = {
  ...common,
  id: 'acceptance',
  title: '业务验收：交付后进入验收节点',
  planRefs: ['3.1 六阶段'],
  method: 'store',
  limits: [
    fakeLimit,
    ipcLimit,
    '验收依赖已完成的 GitHub 交付，离线无法走到。先快进到 PR 草稿，再在应用关闭时直接改写本地库，把 PR 节点标为完成、验收节点标为进行中；页面上的交付证据仍缺失，只用于布局对比。',
  ],
  async prepare(ctx) {
    const state = await reachPrStage(ctx)
    await ctx.relaunch(async () => {
      const { createLocalStore } = await import('../../apps/desktop/electron/local-store.ts')
      const store = await createLocalStore({ dbPath: databasePath(ctx.workspace) })
      try {
        const run = (await store.listRuns()).find((item: any) => item.id === state.run.id)
        if (!run) throw new Error('Run missing in the closed database')
        const accept = nodeOf(run, 'accept', 'acceptance')
        const updatedAt = new Date().toISOString()
        await store.saveRun({
          ...run,
          currentNodeId: accept.id,
          updatedAt,
          nodes: run.nodes.map((node: any) =>
            node.stage === 'pr' ? { ...node, status: 'success' } : node.id === accept.id ? { ...node, status: 'running' } : node,
          ),
        })
      } finally {
        store.close()
      }
    })
    await selectRun(ctx, TASK_TITLE)
    await selectNode(ctx, STAGE.accept, nodeOf(state.run, 'accept', 'acceptance'))
    ctx.observe('run', await runSummary(ctx, state.run.id))
    await settle(ctx)
  },
}

// Test evidence (plan §6.4). These samples measure the 测试 page, where D4 was observed.

async function openTestsPage(ctx: SampleContext) {
  await clickNav(ctx, '测试')
  await ctx.desktop.page.getByTestId('tests-view').waitFor({ state: 'visible' })
}

/**
 * Since S2 the check runs at the task's test step (W4, W5); the Tests page keeps the
 * command and history. Run it in the task, then open the Tests page that these samples measure.
 */
async function runTestsFromPage(ctx: SampleContext) {
  const { page } = ctx.desktop
  await page.getByTestId('tests-view').getByRole('button', { name: '在任务中处理', exact: true }).click()
  const run = page.getByTestId('node-inspector').getByTestId('task-status-row').getByRole('button', { name: '运行检查', exact: true })
  await run.waitFor({ state: 'visible', timeout: 15_000 })
  await run.click()
  await openTestsPage(ctx)
}

async function testsViewText(ctx: SampleContext) {
  return ctx.desktop.page.getByTestId('tests-view').innerText()
}

const testNoRepo: Sample = {
  ...common,
  id: 'test-no-repo',
  title: '测试页：未选择仓库',
  planRefs: ['6.4', 'D4'],
  method: 'ui',
  simulated: false,
  limits: [],
  async prepare(ctx) {
    await openTestsPage(ctx)
    await settle(ctx)
  },
}

const testNoCommand: Sample = {
  ...common,
  id: 'test-no-command',
  title: '测试页：已选仓库，未配置测试命令',
  planRefs: ['6.4', 'D4'],
  method: 'ui',
  simulated: false,
  repoVariant: 'none',
  limits: ['示例仓库的 package.json 没有 test 脚本。'],
  async prepare(ctx) {
    await selectRepository(ctx)
    await openTestsPage(ctx)
    await settle(ctx)
  },
}

const testNotRun: Sample = {
  ...common,
  id: 'test-not-run',
  title: '测试页：命令已保存，本任务尚未运行测试（D4 现象）',
  planRefs: ['6.4', 'D4'],
  method: 'ui',
  simulated: false,
  limits: [],
  async prepare(ctx) {
    await selectRepository(ctx)
    await createTask(ctx)
    await openTestsPage(ctx)
    await settle(ctx)
  },
}

// Tests can only run while the Run is at its test node, in the managed worktree of the
// completed coding run. The worktree's test script is changed to produce each outcome.

async function testWorktree(ctx: SampleContext, runId: string): Promise<string> {
  const state = await loadState(ctx)
  const coding = state.codingRuns
    .filter((item: any) => item.runId === runId)
    .sort((a: any, b: any) => String(b.startedAt).localeCompare(String(a.startedAt)))[0]
  const workspace = state.managedCodingWorkspaces.find((item: any) => item.id === coding?.managedWorkspaceId)
  if (!workspace) throw new Error('Managed worktree of the coding run not found')
  return workspace.worktreePath
}

async function setWorktreeTestScript(ctx: SampleContext, runId: string, script: string) {
  const file = path.join(await testWorktree(ctx, runId), 'package.json')
  const pkg = JSON.parse(await readFile(file, 'utf8'))
  pkg.scripts = { ...(pkg.scripts ?? {}), test: script }
  await writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`)
}

async function openTestsAtTestNode(ctx: SampleContext, script?: string): Promise<BuildState> {
  const state = await reachTestStage(ctx)
  if (script) await setWorktreeTestScript(ctx, state.run.id, script)
  await reloadAndSelectRun(ctx, TASK_TITLE)
  await openTestsPage(ctx)
  return state
}

async function waitForTestEvidence(ctx: SampleContext, runId: string, status: string, timeoutMs: number) {
  return pollUntil(`test evidence "${status}"`, async () => {
    const state = await loadState(ctx)
    const testNode = nodeOf(state.runs.find((run: any) => run.id === runId), 'test', 'test')
    return state.testEvidence.find((item: any) => item.runId === runId && item.nodeId === testNode.id && item.status === status)
  }, timeoutMs)
}

const testStageLimits = [
  fakeLimit,
  ipcLimit,
  '测试只能在任务处于测试节点时运行，且在编码生成的托管工作树中执行。样例先快进到测试节点，再改写工作树中 package.json 的 test 脚本来得到对应结果；自 S2 起在任务测试步骤点击「运行检查」走真实界面（测试页只保留命令与历史），再打开测试页测量。',
  '快进需要连接团队并保存预算，所以顶栏是已连接状态。',
]

const testRunning: Sample = {
  ...common,
  id: 'test-running',
  title: '测试页：测试执行中',
  planRefs: ['6.4'],
  method: 'ipc',
  transient: true,
  limits: [...testStageLimits, '测试脚本只是等待 180 秒，状态稳定后立即截图。'],
  async prepare(ctx) {
    await openTestsAtTestNode(ctx, 'node -e "setTimeout(() => {}, 180000)"')
    await runTestsFromPage(ctx)
    await pollUntil('tests to start', async () => (await testsViewText(ctx)).includes('测试中'))
    await settle(ctx)
  },
}

const testFailed: Sample = {
  ...common,
  id: 'test-failed',
  title: '测试页：测试失败',
  planRefs: ['6.4'],
  method: 'ipc',
  limits: [...testStageLimits, '“被跳过”只对工作流节点成立，测试证据没有这个状态，界面上无法单独制备；由 S1 的组件测试覆盖。'],
  async prepare(ctx) {
    const state = await openTestsAtTestNode(ctx, 'node -e "process.exit(1)"')
    await runTestsFromPage(ctx)
    await waitForTestEvidence(ctx, state.run.id, 'failed', 60_000)
    await settle(ctx)
  },
}

const testTimeout: Sample = {
  ...common,
  id: 'test-timeout',
  title: '测试页：测试超时（固定 120 秒）',
  planRefs: ['6.4'],
  method: 'ipc',
  limits: [...testStageLimits, '桌面端的测试超时固定为 120 秒，制备需要等待约 2 分钟。'],
  async prepare(ctx) {
    const state = await openTestsAtTestNode(ctx, 'node -e "setTimeout(() => {}, 180000)"')
    await runTestsFromPage(ctx)
    await waitForTestEvidence(ctx, state.run.id, 'timed_out', 170_000)
    await settle(ctx)
  },
}

const testStale: Sample = {
  ...common,
  id: 'test-stale',
  title: '测试页：已有通过结果，但代码随后有新提交',
  planRefs: ['6.4'],
  method: 'ipc',
  limits: [...testStageLimits, '通过后由脚本在托管工作树中直接提交一次改动。现有界面没有“已过期”分支，这正是改前基线要记录的。'],
  async prepare(ctx) {
    const state = await openTestsAtTestNode(ctx)
    await runTestsFromPage(ctx)
    const evidence = await waitForTestEvidence(ctx, state.run.id, 'passed', 60_000)
    const worktree = await testWorktree(ctx, state.run.id)
    const before = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim()
    await writeFile(path.join(worktree, 'src/health.js'), 'export function health() { return { status: "ok", checks: [] } }\n')
    await execFileAsync('git', ['-c', 'user.name=workspace-baseline', '-c', 'user.email=workspace-baseline@example.invalid', 'commit', '-qam', 'change after tests'], { cwd: worktree })
    const after = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim()
    ctx.observe('worktreeHeadChanged', before !== after)
    ctx.observe('evidenceFields', Object.keys(evidence).sort())
    await delay(3_000)
    await settle(ctx)
  },
}

const testReadFailure: Sample = {
  ...common,
  id: 'test-read-failure',
  title: '测试页：证据读取失败或适用性无法核实',
  planRefs: ['6.4'],
  method: 'renderer',
  simulated: false,
  limits: ['现有代码没有“证据读取失败”这一事实来源，真实窗口里不注入故障就无法出现。'],
  alternative: 'S1 在 SupportViews 的组件测试中模拟证据读取失败，断言显示“读取失败／待核实”，而不是“未运行”或“已通过”。',
}

// Team connection and result upload (plan §6.5).

const pairLimit = '团队服务是本脚本启动的内存演示 Team API，配对码由脚本签发。'

const teamUnpaired: Sample = {
  ...common,
  id: 'team-unpaired',
  title: '未连接团队：同步弹层（上传情况 1：尚无团队目标）',
  planRefs: ['D3', 'T4', '6.5 上传情况 1', '待验证项 2'],
  method: 'ui',
  limits: [fakeLimit],
  async prepare(ctx) {
    const { projectId } = await prepareClarifyGate(ctx)
    await delay(3_000)
    ctx.observe('credential', (await pairing(ctx)) ? 'present' : 'none')
    ctx.observe('syncOperations', await syncOperations(ctx, projectId))
    await settle(ctx)
    await openSyncPopover(ctx)
  },
}

const policyUnavailableAfterReload: Sample = {
  ...common,
  id: 'policy-unavailable-after-reload',
  title: '已连接团队、尚未拉取团队数据时重新载入：策略不可用',
  planRefs: ['6.1 状态待核实', '6.3 warn/blocked', '6.5 团队数据更新'],
  method: 'ui',
  limits: [fakeLimit, pairLimit, '重新载入的是渲染层页面（相当于刷新窗口），不是重启应用。'],
  async prepare(ctx) {
    const { projectId, run, gate } = await prepareClarifyGate(ctx)
    await pairViaForm(ctx, await createPairingCode(ctx.api))
    await reloadAndSelectRun(ctx, TASK_TITLE)
    await selectNode(ctx, STAGE.clarify, gate)
    const decision = await ipc(ctx, 'evaluateGateEnforcement', { runId: run.id, nodeId: gate.id, projectId })
    ctx.observe('gateDecision', {
      status: decision.status,
      blocksApproval: decision.blocksApproval,
      blockingReasons: (decision.blockingReasons ?? []).map((reason: any) => reason.ruleKey ?? reason.id),
      policySource: decision.policySource,
    })
    await settle(ctx)
  },
}

const uploadRequeued: Sample = {
  ...common,
  id: 'upload-requeued',
  title: '刚完成绑定：旧记录已重排，正在尝试上传（上传情况 2）',
  planRefs: ['6.5 上传情况 2', '待验证项 3'],
  method: 'ui',
  transient: true,
  limits: [fakeLimit, pairLimit, '上传请求被本脚本在主进程中暂时挂起，使“正在上传”状态停留到截图完成；挂起不改变记录本身。'],
  async prepare(ctx) {
    const { projectId } = await prepareClarifyGate(ctx)
    await delay(3_000)
    ctx.observe('beforePairing', await syncOperations(ctx, projectId))
    await holdResultUploads(ctx.desktop, true)
    await pairViaForm(ctx, await createPairingCode(ctx.api))
    await delay(1_500)
    ctx.observe('afterPairing', await syncOperations(ctx, projectId))
    await openSyncPopover(ctx)
  },
  async followUp(ctx) {
    await holdResultUploads(ctx.desktop, false)
    const project = await projectFor(ctx, ctx.workspace.repoDir)
    ctx.observe('afterRelease', await waitForOutboxIdle(ctx, project.id))
  },
}

const teamPaired: Sample = {
  ...common,
  id: 'team-paired',
  title: '已连接团队：上传完成后的同步弹层',
  planRefs: ['6.5', 'T4', '待验证项 1'],
  method: 'ui',
  limits: [fakeLimit, pairLimit],
  async prepare(ctx) {
    const { projectId, run } = await prepareClarifyGate(ctx)
    const credential = await pairViaForm(ctx, await createPairingCode(ctx.api))
    const snapshot = async () => {
      const remote = await ipc(ctx, 'loadRemoteSnapshot', { organizationId: credential.organizationId })
      const counts: Record<string, number> = {}
      for (const [key, value] of Object.entries(remote ?? {})) if (Array.isArray(value)) counts[key] = value.length
      const runs = Array.isArray(remote?.runs) ? remote.runs : []
      return {
        counts,
        containsLocalRun: runs.some((item: any) => item.id === run.id),
        localRunProjectIds: runs.filter((item: any) => item.id === run.id).map((item: any) => item.projectId === projectId ? 'local-project-id' : item.projectId),
      }
    }
    const usage = (await loadState(ctx)).agentTokenUsage.filter((row: any) => row.runId === run.id)
    ctx.observe('identity', {
      pairingUserId: credential.userId,
      stageUsageUserIds: [...new Set(usage.map((row: any) => row.userId))],
    })
    ctx.observe('pullRightAfterPairing', { toast: await pullTeamData(ctx), snapshot: await snapshot(), operations: await syncOperations(ctx, projectId) })
    await waitForOutboxIdle(ctx, projectId)
    await settle(ctx)
    ctx.observe('pullAfterUpload', { toast: await pullTeamData(ctx), snapshot: await snapshot(), operations: await syncOperations(ctx, projectId) })
    await openProjectMenu(ctx)
    ctx.observe('runRowsAfterPull', await ctx.desktop.page.locator('.run-row').count())
    await closeProjectMenu(ctx)
    await settle(ctx)
    await openSyncPopover(ctx)
  },
}

const teamExistingCredential: Sample = {
  ...common,
  id: 'team-existing-credential',
  title: '已有凭据：准备输入新的配对码（重新配对前）',
  planRefs: ['P1', '6.5 重新配对的确认', '待验证项 5'],
  method: 'ui',
  limits: [fakeLimit, pairLimit, '截图中的配对码是占位文字，不是有效配对码。'],
  async prepare(ctx) {
    await prepareClarifyGate(ctx)
    await pairViaForm(ctx, await createPairingCode(ctx.api))
    await settle(ctx)
    await openTeamControls(ctx)
    await ctx.desktop.page.getByLabel('Desktop pairing code').fill('PLACEHOLDER.not-a-real-code')
    await delay(500)
  },
  async followUp(ctx) {
    // P1 baseline: submitting a second real code replaces the credential without any confirmation.
    const before = await pairing(ctx)
    await openTeamControls(ctx)
    const { page } = ctx.desktop
    await page.getByLabel('Desktop pairing code').fill(await createPairingCode(ctx.api))
    await page.getByRole('button', { name: /^(绑定|连接|重新连接)$/ }).click()
    await delay(300)
    const dialogs = await page.locator('[role="alertdialog"]').count()
    if (dialogs > 0) {
      ctx.observe('repairConfirmationText', (await page.locator('[role="alertdialog"]').innerText()).split('\n').slice(0, 3))
      await ctx.capture('repair-confirmation')
      await page.getByRole('button', { name: '确认替换', exact: true }).click()
    }
    const after = await pollUntil('replacement credential', async () => {
      const current = await pairing(ctx)
      return current && JSON.stringify(current) !== JSON.stringify(before) ? current : undefined
    })
    ctx.observe('repairWithoutConfirmation', {
      confirmationDialogs: dialogs,
      changedCredentialFields: changedCredentialFields(before, after),
      sameTeamProject: after.projectId === before.projectId,
      sameLocalProject: after.localProjectId === before.localProjectId,
    })
  },
}

const uploadTargetOtherProject: Sample = {
  ...common,
  id: 'upload-target-other-project',
  title: '记录目标是团队项目 X，当前凭据属于另一个本地项目（上传情况 3）',
  planRefs: ['6.5 上传情况 3', 'D3', '待验证项 2', '待验证项 3'],
  method: 'ui',
  limits: [fakeLimit, pairLimit, '两个示例仓库都连接到演示项目 p-payments。'],
  async prepare(ctx) {
    const first = await prepareClarifyGate(ctx)
    await pairViaForm(ctx, await createPairingCode(ctx.api))
    await waitForOutboxIdle(ctx, first.projectId)
    const secondRepo = path.join(ctx.workspace.tempRoot, 'billing-api')
    await createSampleRepo(secondRepo, 'pass')
    await selectRepository(ctx, secondRepo)
    await pairViaForm(ctx, await createPairingCode(ctx.api))
    await selectRepository(ctx, ctx.workspace.repoDir)
    await selectRun(ctx, TASK_TITLE)
    await selectNode(ctx, STAGE.clarify, first.gate)
    await requestChangesViaUi(ctx)
    await delay(3_000)
    ctx.observe('afterWriteWhileOtherProjectPaired', await syncOperations(ctx, first.projectId))
    await settle(ctx)
    await openSyncPopover(ctx)
  },
  async followUp(ctx) {
    const project = await projectFor(ctx, ctx.workspace.repoDir)
    await ctx.desktop.page.keyboard.press('Escape')
    // A never-bound task created while another local project is paired (plan §2.3 item 3).
    await createTask(ctx, 'Health API 第二个任务')
    await delay(3_000)
    const second = await runByTitle(ctx, project.id, 'Health API 第二个任务')
    const forRun = (operations: any[], runId: string) => operations.filter((operation) => operation.runId === runId)
    ctx.observe('newTaskWhileOtherProjectPaired', forRun(await syncOperations(ctx, project.id), second.id))
    await pairViaForm(ctx, await createPairingCode(ctx.api))
    await delay(3_000)
    ctx.observe('afterPairingAgain', await syncOperations(ctx, project.id))
    await generateClarification(ctx)
    await delay(1_000)
    ctx.observe('afterNextWriteToNewTask', await waitForOutboxIdle(ctx, project.id).catch(async () => syncOperations(ctx, project.id)))
  },
}

const uploadNoCredential: Sample = {
  ...common,
  id: 'upload-no-credential',
  title: '记录目标是团队项目 X，当前没有凭据（上传情况 4）',
  planRefs: ['6.5 上传情况 4'],
  method: 'store',
  limits: [
    fakeLimit,
    pairLimit,
    '界面没有解除连接的入口。先连接并上传，再在应用关闭时直接删除本地库中的配对凭据，只用于布局对比。',
  ],
  async prepare(ctx) {
    const { projectId, gate } = await prepareClarifyGate(ctx)
    await pairViaForm(ctx, await createPairingCode(ctx.api))
    await waitForOutboxIdle(ctx, projectId)
    await ctx.relaunch(() => runSql(ctx.workspace, 'delete from desktop_pairing_credentials'))
    ctx.observe('credentialAfterRelaunch', (await pairing(ctx)) ? 'present' : 'none')
    await selectRun(ctx, TASK_TITLE)
    await selectNode(ctx, STAGE.clarify, gate)
    await requestChangesViaUi(ctx)
    await delay(3_000)
    ctx.observe('afterWriteWithoutCredential', await syncOperations(ctx, projectId))
    await settle(ctx)
    await openSyncPopover(ctx)
  },
}

const uploadTargetUnrecoverable: Sample = {
  ...common,
  id: 'upload-target-unrecoverable',
  title: '本地项目已改连到团队项目 Y，记录仍属于 X（上传情况 5）',
  planRefs: ['6.5 上传情况 5'],
  method: 'ui',
  limits: [fakeLimit, pairLimit, '团队项目 Y 由脚本在内存 Team API 中新建。'],
  async prepare(ctx) {
    const { projectId, gate } = await prepareClarifyGate(ctx)
    await pairViaForm(ctx, await createPairingCode(ctx.api))
    await waitForOutboxIdle(ctx, projectId)
    const y = await createTeamProject(ctx.api, 'Workspace Baseline Y')
    await pairViaForm(ctx, await createPairingCode(ctx.api, y.id, 'acct-demo-u-erich'))
    await selectNode(ctx, STAGE.clarify, gate)
    await requestChangesViaUi(ctx)
    await delay(3_000)
    ctx.observe('afterWriteAfterRebinding', await syncOperations(ctx, projectId))
    await settle(ctx)
    await openSyncPopover(ctx)
  },
}

const uploadCredentialInvalid: Sample = {
  ...common,
  id: 'upload-credential-invalid',
  title: '凭据在服务端失效（与过期同一路径）：上传被拒',
  planRefs: ['6.5 凭据过期', '待验证项 4'],
  method: 'ui',
  limits: [
    fakeLimit,
    pairLimit,
    '无法在测量期间等到令牌真正过期。改为通过 Team API 撤销该桌面令牌：API 对已撤销和已过期的令牌都返回空会话（team-repository.ts 的 resolveDesktopTokenSession），桌面端收到同样的 401。',
  ],
  async prepare(ctx) {
    const { projectId, gate } = await prepareClarifyGate(ctx)
    const credential = await pairViaForm(ctx, await createPairingCode(ctx.api))
    await waitForOutboxIdle(ctx, projectId)
    const revoked = await teamRequest(ctx.api, 'DELETE', `/api/team/projects/${credential.projectId}/desktop-tokens/${credential.tokenId}`)
    ctx.observe('tokenRevocationStatus', revoked.status)
    await selectNode(ctx, STAGE.clarify, gate)
    await requestChangesViaUi(ctx)
    await delay(4_000)
    ctx.observe('afterWriteWithRejectedToken', await syncOperations(ctx, projectId))
    await settle(ctx)
    await openSyncPopover(ctx)
  },
}

// Discussion (plan §5.4).

function sendControlledAnswer(body: any, response: ServerResponse) {
  const text = '当前任务停在需求确认 Gate：需求澄清已生成，尚未运行门禁审查。可以先阅读需求正文，再决定是否确认。'
  const value = JSON.stringify({ format: 'markdown', text })
  const usage = { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 40 }
  if (body?.stream) {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify({ id: 'baseline', choices: [{ index: 0, delta: { reasoning_content: '核对当前任务与节点状态。' }, finish_reason: null }] })}\n\n`)
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: value }, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`)
    return
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ choices: [{ message: { content: value }, finish_reason: 'stop' }], usage }))
}

const discussionMessages: Sample = {
  ...common,
  id: 'discussion-messages',
  title: '讨论栏：有一轮问答',
  planRefs: ['5.4', 'L3', '8.1'],
  method: 'ui',
  limits: [
    fakeLimit,
    pairLimit,
    '对话模型是本脚本的受控服务，固定返回一段回答；没有真实模型调用。会话需要团队连接与预算，所以顶栏是已连接状态。',
  ],
  async prepare(ctx) {
    const model = await startModelServer(sendControlledAnswer)
    ctx.onCleanup(model.close)
    await routeModelRequests(ctx.desktop, model.url)
    // Same order as the conversation smoke: connect first, so later uploads do not change the
    // conversation's context while an answer is being generated.
    const project = await selectRepository(ctx)
    await pairAndBudget(ctx, project.id)
    await createTask(ctx)
    await generateClarification(ctx)
    const run = await runByTitle(ctx, project.id, TASK_TITLE)
    const gate = nodeOf(run, 'clarify', 'gate')
    await waitForOutboxIdle(ctx, project.id)
    await pullTeamData(ctx)
    await ipc(ctx, 'saveAgentProviderCredential', {
      providerId: 'baseline-chat', name: 'Baseline 受控对话模型', apiKey: 'sk-workspace-baseline-only', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com',
    })
    const settings = (await loadState(ctx)).settings
    await ipc(ctx, 'saveSettings', { selectedAgentProviderId: 'baseline-chat', themePreference: settings.themePreference })
    await reloadAndSelectRun(ctx, TASK_TITLE)
    await selectNode(ctx, STAGE.clarify, gate)
    await waitForOutboxIdle(ctx, project.id)
    const { page } = ctx.desktop
    // S1 collapses an empty discussion (L3); open it the way a user would.
    const discussionToggle = page.getByRole('button', { name: '讨论', exact: true })
    if (await discussionToggle.isVisible().catch(() => false)) await discussionToggle.click()
    await page.getByRole('button', { name: '新建对话', exact: true }).click()
    const create = page.getByRole('button', { name: '创建对话', exact: true })
    if ((await create.count()) > 0) await create.click()
    await page.getByRole('textbox', { name: '对话内容' }).fill('这个任务现在卡在哪一步？')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    const answer = page.getByText('当前任务停在需求确认 Gate', { exact: false }).last()
    let retries = 0
    for (;;) {
      const outcome = await Promise.race([
        answer.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'answer'),
        page.getByRole('button', { name: '重试调查', exact: true }).waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'retry'),
      ])
      if (outcome === 'answer') break
      if (retries >= 1) throw new Error('Conversation failed twice')
      retries += 1
      ctx.observe('firstAttemptError', (await page.getByTestId('workbench-workspace').innerText()).split('\n').find((line) => line.includes('请') || line.includes('失败')) ?? 'unknown')
      await page.getByRole('button', { name: '重试调查', exact: true }).click()
    }
    ctx.observe('conversation', { retries, modelRequests: model.requests.length })
    await settle(ctx)
  },
}

export const samples: Sample[] = [
  clarifyGateWarn,
  clarifyGateSuggestions,
  clarifyGateClean,
  gateEnforcedBlock,
  upstreamWaiting,
  clarifyHistory,
  designGate,
  buildRunning,
  buildPermission,
  buildInterrupted,
  testStage,
  prReady,
  prApproval,
  acceptance,
  testNoRepo,
  testNoCommand,
  testNotRun,
  testRunning,
  testFailed,
  testTimeout,
  testStale,
  testReadFailure,
  teamUnpaired,
  uploadRequeued,
  teamPaired,
  policyUnavailableAfterReload,
  teamExistingCredential,
  uploadTargetOtherProject,
  uploadNoCredential,
  uploadTargetUnrecoverable,
  uploadCredentialInvalid,
  discussionMessages,
]

export function findSamples(ids: string[] | undefined): Sample[] {
  if (!ids || ids.length === 0) return samples
  const unknown = ids.filter((id) => !samples.some((sample) => sample.id === id))
  if (unknown.length > 0) {
    throw new Error(`Unknown sample id(s): ${unknown.join(', ')}. Known: ${samples.map((s) => s.id).join(', ')}`)
  }
  return ids.map((id) => samples.find((sample) => sample.id === id)!)
}
