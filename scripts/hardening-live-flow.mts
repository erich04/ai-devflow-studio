/** Paid H7 opt-in: DEVFLOW_H7_LIVE=1 plus a source DB/provider; cumulative budget <= $1. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { createLocalStore } from '../apps/desktop/electron/local-store.ts'
import type {} from '../apps/desktop/src/desktop-api.ts'
import { createWorkspace, createSampleRepo, startTeamApi, createTeamProject, createPairingCode, teamRequest, stubRepositoryPicker, delay, stopProcess, removeWorkspace, rootDir } from './workspace-baseline/environment.mts'

assert.equal(process.env.DEVFLOW_H7_LIVE, '1', 'Explicit paid H7 opt-in required')
const sourcePath = process.env.DEVFLOW_H7_DATABASE
const sourceProvider = process.env.DEVFLOW_H7_PROVIDER
assert(sourcePath && sourceProvider, 'An existing source database and provider are required')
const output = path.resolve(process.env.DEVFLOW_H7_OUTPUT ?? path.join(rootDir, 'output/hardening/h7'))
await mkdir(output, { recursive: true })
const ledgerPath = path.resolve(process.env.DEVFLOW_H7_LEDGER ?? path.join(output, 'ledger.json'))
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const sourceBytes = await readFile(sourcePath)
const sourceHash = hash(sourceBytes)
const require = createRequire(path.join(rootDir, 'apps/desktop/package.json'))
const SQL = await require('sql.js')()
const db = new SQL.Database(sourceBytes)
const rows = db.exec('SELECT json, encrypted_secret FROM provider_credentials WHERE provider_id = ?', [sourceProvider])[0]?.values
db.close()
assert.equal(rows?.length, 1, 'The selected saved provider must exist')
const metadata = JSON.parse(String(rows![0]![0]))
assert.equal(new URL(metadata.baseUrl).origin, 'https://api.deepseek.com')
const workspace = await createWorkspace('devflow-h7-')
const report: any = { startedAt: new Date().toISOString(), steps: [], model: 'deepseek-flash', budgetLimitUsd: 1 }
let app: ElectronApplication | undefined
let team: Awaited<ReturnType<typeof startTeamApi>> | undefined
const providerId = 'deepseek-h7'
const step = (phase: string, details: object = {}) => { report.steps.push({ phase, at: new Date().toISOString(), ...details }); console.log(JSON.stringify({ phase, ...details })) }

try {
  await createSampleRepo(workspace.repoDir)
  const store = await createLocalStore({ dbPath: path.join(workspace.userDataDir, 'devflow.sqlite') })
  await store.saveProviderCredential({ providerId, name: 'H7 isolated DeepSeek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', thinking: { mode: 'enabled', effort: 'low' }, maskedCredential: 'existing encrypted credential', updatedAt: new Date().toISOString() }, String(rows![0]![1]))
  store.close()
  team = await startTeamApi(workspace)
  const teamProject = await createTeamProject(team, 'H7 real DeepSeek health fixture')
  const code = await createPairingCode(team, teamProject.id, 'acct-demo-u-erich')
  app = await electron.launch({ args: [path.join(rootDir, 'scripts/hardening-live-bootstrap.cjs')], cwd: path.join(rootDir, 'apps/desktop'), env: {
    ...process.env, DEVFLOW_H7_LEDGER: ledgerPath,
    DEVFLOW_USER_DATA_DIR: workspace.userDataDir, DEVFLOW_DATA_PROFILE_REGISTRY_PATH: workspace.registryPath,
    DEVFLOW_API_BASE_URL: team.url, DEVFLOW_ENABLE_DEMO_DATA: 'false', DEVFLOW_ENABLE_FAKE_RUNTIME: 'false',
    DEVFLOW_CODING_ENGINE: '', DEVFLOW_CODING_EXECUTOR: '', DEVFLOW_NATIVE_CODING_PROVIDER_ID: '',
    VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  } })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const firstCallIndex = await app.evaluate(() => (globalThis as any).h7Ledger.calls.length)
  report.credentialReadable = await app.evaluate(async ({ safeStorage }, cipher) => {
    try { return (await safeStorage.decryptStringAsync(Buffer.from(cipher, 'base64'))).result.length > 0 }
    catch { return false }
  }, String(rows![0]![1]))
  assert(report.credentialReadable, 'Saved credential cannot be decrypted by the source development app identity; no model call made')
  const ipc = (method: string, input?: any) => page.evaluate(({ method, input }) => (window.aiDevFlowDesktop as any)[method](input), { method, input })
  const phase = async (name: string) => { step(`${name}:start`); await app!.evaluate((_, value) => { (globalThis as any).h7Phase = value }, name) }
  await stubRepositoryPicker(app, workspace.repoDir)
  const project = await ipc('selectLocalProject')
  assert.equal(project.path, workspace.repoDir)
  await ipc('pairDesktop', { code, localProjectId: project.id })
  await ipc('saveCodingRuntimeBudgetPolicy', { projectId: project.id, enabled: true, monthlyLimitUsd: 1, warningThresholdUsd: 0.5 })
  await ipc('saveCodingRuntimeConfiguration', { projectId: project.id, executor: 'native-model', providerId })
  const request = '让 src/health.js 的 health() 在返回结果中增加 checkedAt 字段，值为调用时刻的 ISO 8601 时间字符串；保留原有 status 字段和值不变。在 src/health.test.js 中补充一条测试，验证 checkedAt 能被 Date 解析且与 toISOString() 结果一致。不引入新依赖，不修改其他文件。使用内置 Date 即可，不需要网络、日志或额外配置。'
  let run = await ipc('createRun', { projectId: project.id, creatorId: 'u-erich', title: 'H7 health checkedAt', request, branchName: 'devflow/h7-health' })
  report.runId = run.id
  const node = (stage: string, kind: string) => run.nodes.find((n: any) => n.stage === stage && n.kind === kind)
  for (const stage of ['clarify', 'design']) {
    const agent = node(stage, 'agent')
    const gate = node(stage, 'gate')
    await phase(stage)
    const completed = await ipc('completeWorkflowAgentNode', { runId: run.id, nodeId: agent.id, userId: 'u-erich', userName: 'Erich', providerId })
    run = completed.run
    await writeFile(path.join(output, `${stage}.md`), completed.artifact.content)
    step(`${stage}:complete`, { artifactId: completed.artifact.id })
    await phase(`${stage}-review`)
    const review = await ipc('runKnowledgeReview', { runId: run.id, nodeId: gate.id, projectId: project.id, requestedBy: 'u-erich', runtime: 'electron', providerId })
    assert(review.review?.id, 'A persisted Gate report is required')
    const beforeApproval = await ipc('loadState')
    assert.equal(beforeApproval.runs.find((r: any) => r.id === run.id).currentNodeId, gate.id)
    const identity = stage === 'clarify'
      ? { expectedClarificationRevision: { artifactId: completed.artifact.id, revision: completed.artifact.clarificationRevision.revision, revisionDigest: completed.artifact.clarificationRevision.revisionDigest } }
      : { expectedDesignRevision: { artifactId: completed.artifact.id, updatedAt: completed.artifact.updatedAt, contentDigest: hash(JSON.stringify({ title: completed.artifact.title, summary: completed.artifact.summary, content: completed.artifact.content })) } }
    run = (await ipc('approveGate', { runId: run.id, nodeId: gate.id, ...identity })).run
    step(`${stage}-review:approved`, { reviewId: review.review.id, versionBound: true })
  }
  await phase('native-coding')
  const build = node('build', 'task')
  const started = await ipc('runCodingAgent', { runId: run.id, nodeId: build.id, projectId: project.id, requestedBy: 'u-erich', userInstruction: request })
  assert.equal(started.codingRun.status, 'waiting_permission')
  const waiting = await ipc('loadState')
  const permission = waiting.codingPermissionRequests.find((p: any) => p.codingRunId === started.codingRun.id && p.status === 'pending')
  assert(permission?.changeSetDigest)
  const preview = await ipc('getCodingChangeSetPreview', { changeSetId: permission.changeSetId, codingRunId: permission.codingRunId })
  assert.deepEqual([...preview.changedPaths].sort(), ['src/health.js', 'src/health.test.js'])
  assert.equal(preview.changeSetDigest, permission.changeSetDigest)
  await writeFile(path.join(output, 'preview.diff'), preview.unifiedDiff)
  await writeFile(path.join(output, 'pending-approval.json'), JSON.stringify({ changeSetDigest: permission.changeSetDigest }))
  step('native-coding:review-diff', { changedPaths: preview.changedPaths, changeSetDigest: permission.changeSetDigest })
  // The operator must inspect preview.diff and place the exact digest in approved-digest.txt.
  let approved = false
  for (let attempt = 0; attempt < 300; attempt++) {
    const digest = await readFile(path.join(output, 'approved-digest.txt'), 'utf8').catch(() => '')
    if (digest.trim() === permission.changeSetDigest) { approved = true; break }
    await delay(1000)
  }
  assert(approved, 'Exact diff was not approved within five minutes')
  await ipc('replyCodingPermission', { requestId: permission.id, codingRunId: permission.codingRunId, decidedBy: 'u-erich', decision: 'approved', comment: 'Reviewed the exact two-file health fixture diff for H7.' })
  let state = await ipc('loadState')
  const coding = state.codingRuns.find((c: any) => c.id === started.codingRun.id)
  report.coding = { status: coding.status, cost: coding.runtimeCostSummary, changedPaths: coding.changedPaths }
  assert.equal(coding.status, 'completed')
  const managed = state.managedCodingWorkspaces.find((w: any) => w.codingRunId === coding.id)
  assert(managed)
  report.managedCode = await readFile(path.join(managed.worktreePath, 'src/health.js'), 'utf8')
  report.managedTest = await readFile(path.join(managed.worktreePath, 'src/health.test.js'), 'utf8')
  assert.equal(await readFile(path.join(workspace.repoDir, 'src/health.js'), 'utf8'), 'export function health() { return { status: "ok" } }\n')
  const calls = coding.runtimeCostSummary?.providerCallSettlements
  assert.equal(calls?.length, 2)
  assert(calls.every((c: any) => c.budgetAttemptIds?.length === 1))
  assert.equal(new Set(calls.flatMap((c: any) => c.budgetAttemptIds)).size, 2)
  step('native-coding:complete', { budgetAttemptIdsPreserved: true })
  run = state.runs.find((r: any) => r.id === run.id)
  const testNode = run.nodes.find((n: any) => n.kind === 'test')
  await phase('test-evidence')
  const tested = await ipc('runProjectTests', { projectId: project.id, runId: run.id, nodeId: testNode.id })
  report.test = { status: tested.evidence.status, exitCode: tested.evidence.exitCode, sourceTree: tested.evidence.sourceTree }
  assert.equal(tested.evidence.status, 'passed')
  const freshness = await ipc('getTestEvidenceFreshness', { runId: run.id })
  report.testFreshness = freshness
  assert(freshness.length >= 2 && freshness.every((e: any) => e.state === 'current'))
  await phase('pr-package')
  state = await ipc('loadState')
  run = state.runs.find((r: any) => r.id === run.id)
  const prNode = run.nodes.find((n: any) => n.stage === 'pr' && n.kind === 'task')
  const draft = await ipc('createPrDraft', { runId: run.id, nodeId: prNode?.id ?? run.currentNodeId })
  assert.equal(draft.artifact.kind, 'pr')
  assert.equal(draft.run.pullRequestUrl, undefined)
  assert.equal(draft.run.status, 'paused_at_gate')
  await writeFile(path.join(output, 'delivery-package.md'), draft.artifact.content)
  step('pr-package:complete', { published: false })
  // Let the real outbox sync both stage usage and the native runtime summary before comparison.
  let overview: any
  for (let attempt = 0; attempt < 60; attempt++) {
    overview = (await teamRequest(team, 'GET', '/api/team/overview', { account: 'acct-demo-u-erich' })).body
    if (overview.codingAgentSummaries?.some((c: any) => c.codingRunId?.endsWith(coding.id) || c.id?.endsWith(coding.id))) break
    await delay(500)
  }
  state = await ipc('loadState')
  const ledger = await app.evaluate(() => (globalThis as any).h7Ledger)
  const runCalls = ledger.calls.slice(firstCallIndex)
  assert.equal(runCalls.length, 6)
  assert(runCalls.every((c: any) => c.httpStatus === 200 && c.finishReason === 'stop' && c.usage))
  const analysis = runCalls.find((c: any) => c.nativePhase === 'analysis')
  assert.equal(analysis.outputLimit, 4096)
  assert.equal(analysis.thinking.type, 'enabled')
  const expected = runCalls.reduce((sum: number, c: any) => sum + c.usage.inputTokens + c.usage.outputTokens, 0)
  const localUsage = state.agentTokenUsage.filter((u: any) => u.runId === run.id)
  const localTokens = localUsage.reduce((sum: number, u: any) => sum + u.inputTokens + u.outputTokens, 0) + coding.runtimeCostSummary.inputTokens + coding.runtimeCostSummary.outputTokens
  const teamCost = overview.projectCost.find((p: any) => p.key === teamProject.id)
  const budget = await teamRequest(team, 'POST', '/api/runtime/budget/evaluate', { account: 'acct-demo-u-erich', body: { projectId: teamProject.id, providerId, projectedCostUsd: 0 } })
  assert.equal(budget.status, 200)
  // The Team per-call ledger currently uses estimateAgentTokenUsage's conservative peak
  // price. Native's local runtime summary separately uses the actual time-of-day price.
  const expectedPeakCost = runCalls.reduce((sum: number, c: any) => sum + c.peakCostUsd, 0)
  const cumulativePeakCost = ledger.calls.reduce((sum: number, c: any) => sum + (c.peakCostUsd ?? c.reservedUsd), 0)
  report.usage = { modelCalls: runCalls.length, providerTokens: expected, localTokens, teamTokens: teamCost.totalTokens, teamCostUsd: teamCost.costUsd, budgetSpendUsd: budget.body.currentSpendUsd, expectedPeakCostUsd: expectedPeakCost, cumulativePeakGuardSpendUsd: cumulativePeakCost, codingBudgetIds: calls.flatMap((c: any) => c.budgetAttemptIds) }
  assert.equal(localTokens, expected)
  assert.equal(teamCost.totalTokens, expected)
  assert(Math.abs(budget.body.currentSpendUsd - expectedPeakCost) < 0.000001, `Budget mismatch: ${budget.body.currentSpendUsd} vs ${expectedPeakCost}`)
  assert(Math.abs(teamCost.costUsd - expectedPeakCost) < 0.000001)
  assert(cumulativePeakCost < 1)
  report.lifecycle = await app.evaluate(() => (globalThis as any).h7Lifecycle)
  assert.equal(report.lifecycle.length, 0)
  await page.screenshot({ path: path.join(output, 'desktop-final.png'), scale: 'css' })
  report.passed = true
  step('h7:passed', report.usage)
} catch (error) {
  report.passed = false
  report.failure = String(error).slice(0, 1200)
  process.exitCode = 1
} finally {
  if (app) report.lifecycle ??= await app.evaluate(() => (globalThis as any).h7Lifecycle).catch(() => [])
  await app?.close().catch(() => undefined)
  await stopProcess(team?.process)
  await removeWorkspace(workspace)
  report.sourceDatabaseUnchanged = hash(await readFile(sourcePath)) === sourceHash
  report.finishedAt = new Date().toISOString()
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ passed: report.passed, failure: report.failure, sourceDatabaseUnchanged: report.sourceDatabaseUnchanged, output }))
}
