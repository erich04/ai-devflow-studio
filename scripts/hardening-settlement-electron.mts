/** H6/#202 diagnostic reproduction. Built desktop required; no paid model or existing data. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {} from '../apps/desktop/src/desktop-api.ts'
import {
  createWorkspace, createSampleRepo, startTeamApi, createTeamProject, createPairingCode,
  launchDesktop, stubRepositoryPicker, startModelServer, routeModelRequests,
  delay, stopProcess, removeWorkspace, rootDir,
} from './workspace-baseline/environment.mts'

type Fault = 'none' | 'http-503' | 'connection-reset' | 'lost-ack'
const workspace = await createWorkspace('devflow-h6-')
const report: any = { startedAt: new Date().toISOString(), cases: [], events: [], paidModelCalls: 0 }
const record = (event: string, detail: object = {}) => report.events.push({ at: Date.now(), event, ...detail })
let fault: Fault = 'none'
let team: Awaited<ReturnType<typeof startTeamApi>> | undefined
let desktop: Awaited<ReturnType<typeof launchDesktop>> | undefined
let model: Awaited<ReturnType<typeof startModelServer>> | undefined
let proxy: ReturnType<typeof createServer> | undefined
const output = path.resolve(process.env.DEVFLOW_H6_REPORT ?? path.join(rootDir, 'output/hardening/h6-settlement.json'))

try {
  await createSampleRepo(workspace.repoDir)
  team = await startTeamApi(workspace)
  const teamProject = await createTeamProject(team, 'H6 settlement diagnostic')
  const code = await createPairingCode(team, teamProject.id, 'acct-demo-u-erich')
  proxy = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const bytes = Buffer.concat(chunks)
    const settlement = request.url === '/api/runtime/model-calls/settle'
    const mode = settlement ? fault : 'none'
    if (settlement) record('settlement-request', { mode, id: JSON.parse(bytes.toString()).id })
    if (mode === 'http-503') {
      response.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"H6 injected settlement outage"}')
      return
    }
    if (mode === 'connection-reset') { request.socket.destroy(); return }
    try {
      const headers = Object.fromEntries(Object.entries(request.headers).filter(([key]) => !['host', 'connection', 'content-length'].includes(key))) as Record<string, string>
      const upstream = await fetch(`${team!.url}${request.url}`, {
        method: request.method ?? 'GET', headers, ...(bytes.length ? { body: bytes } : {}),
      })
      const body = Buffer.from(await upstream.arrayBuffer())
      if (settlement) record('settlement-upstream-response', { status: upstream.status, mode })
      // The Team API has committed the settlement, but the desktop never receives its acknowledgement.
      if (mode === 'lost-ack') { request.socket.destroy(); return }
      response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' }).end(body)
    } catch { response.writeHead(502).end() }
  })
  await new Promise<void>((resolve) => proxy!.listen(0, '127.0.0.1', resolve))
  const address = proxy.address()
  assert(address && typeof address === 'object')
  model = await startModelServer((_body, response) => {
    record('model-response', { status: 200 })
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      id: 'h6-synthetic', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
        title: 'Health timestamp design', summary: 'Add checkedAt and a bounded regression.',
        content: '# Design\nAdd checkedAt using new Date().toISOString() in src/health.js. Preserve status.\n## Verification\nAdd a parseable ISO timestamp assertion in src/health.test.js. Run npm test. No other changes.',
        goals: ['Add the current ISO checkedAt timestamp and preserve status.'],
        acceptanceCriteria: ['npm test passes; checkedAt parses as an ISO timestamp.'],
        nonGoals: ['Do not change files outside src/health.js and src/health.test.js.'],
        openQuestions: [], assumptions: ['Node.js supplies Date.'], risks: ['Wall clock is not monotonic.'],
      }) } }], usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
    }))
  })
  desktop = await launchDesktop({ workspace, apiUrl: `http://127.0.0.1:${address.port}`, env: { DEVFLOW_ENABLE_DEMO_DATA: 'false' } })
  const { app, page } = desktop
  await routeModelRequests(desktop, model.url)
  await app.evaluate(({ app, BrowserWindow }) => {
    const events: any[] = []
    ;(globalThis as any).__h6Events = events
    app.on('child-process-gone', (_, details) => events.push({ at: Date.now(), event: 'child-process-gone', type: details.type, reason: details.reason, exitCode: details.exitCode }))
    app.on('before-quit', () => events.push({ at: Date.now(), event: 'before-quit' }))
    for (const window of BrowserWindow.getAllWindows()) {
      window.on('close', () => events.push({ at: Date.now(), event: 'window-close' }))
      window.on('closed', () => events.push({ at: Date.now(), event: 'window-closed' }))
      window.webContents.on('render-process-gone', (_, details) => events.push({ at: Date.now(), event: 'render-process-gone', ...details }))
      window.webContents.on('destroyed', () => events.push({ at: Date.now(), event: 'webcontents-destroyed' }))
      window.webContents.on('unresponsive', () => events.push({ at: Date.now(), event: 'webcontents-unresponsive' }))
    }
  })
  page.on('close', () => record('playwright-page-close'))
  page.on('crash', () => record('playwright-page-crash'))
  app.process().on('exit', (code, signal) => record('main-exit', { code, signal }))
  await stubRepositoryPicker(app, workspace.repoDir)
  const project = await page.evaluate(() => window.aiDevFlowDesktop!.selectLocalProject())
  assert(project)
  await page.evaluate((input) => window.aiDevFlowDesktop!.pairDesktop(input), { code, localProjectId: project.id })
  // Fake clarification/review usage is deliberately unpriced. H6 tests settlement availability;
  // monetary budget admission is exercised separately by H7 with every call priced.
  await page.evaluate((projectId) => window.aiDevFlowDesktop!.saveCodingRuntimeBudgetPolicy({ projectId, enabled: false, monthlyLimitUsd: 1, warningThresholdUsd: 0.5 }), project.id)
  await page.evaluate(() => window.aiDevFlowDesktop!.saveAgentProviderCredential({ providerId: 'h6-synthetic', apiKey: 'synthetic-h6', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' }))
  const ipc = async (method: string, input: any) => page.evaluate(({ method, input }) => (window.aiDevFlowDesktop as any)[method](input), { method, input })
  const completeDesign = (run: any, nodeId: string) => ipc('completeWorkflowAgentNode', { runId: run.id, nodeId, userId: 'u-erich', userName: 'Erich', providerId: 'h6-synthetic' })

  for (const mode of ['none', ...Array.from({ length: 3 }, () => ['http-503', 'connection-reset', 'lost-ack']).flat()] as Fault[]) {
    fault = 'none'
    const run = await ipc('createRun', { title: `H6 ${mode} ${report.cases.length + 1}`, request: 'Add checkedAt to health() and test the ISO timestamp; preserve status and only change the two src files.', projectId: project.id, creatorId: 'u-erich', branchName: `devflow/h6-${report.cases.length + 1}` })
    const clarify = run.nodes.find((n: any) => n.stage === 'clarify' && n.kind === 'agent')
    const gate = run.nodes.find((n: any) => n.stage === 'clarify' && n.kind === 'gate')
    const design = run.nodes.find((n: any) => n.stage === 'design' && n.kind === 'agent')
    const completed = await ipc('completeWorkflowAgentNode', { runId: run.id, nodeId: clarify.id, userId: 'u-erich', userName: 'Erich', providerId: 'fake-knowledge-review' })
    await ipc('runKnowledgeReview', { runId: run.id, nodeId: gate.id, projectId: project.id, requestedBy: 'u-erich', runtime: 'electron', providerId: 'fake-knowledge-review' })
    const rev = completed.artifact.clarificationRevision
    await ipc('approveGate', { runId: run.id, nodeId: gate.id, expectedClarificationRevision: { artifactId: completed.artifact.id, revision: rev.revision, revisionDigest: rev.revisionDigest } })
    fault = mode
    const callsBefore: number = model.requests.length
    const result: any = { mode, startedAt: Date.now() }
    record('design-start', { mode })
    try { await completeDesign(run, design.id); result.succeeded = true }
    catch (error) {
      const message = String(error)
      result.succeeded = false
      result.settlementSyncFailed = message.includes('settlement_sync_failed')
      result.billingConfirmed = message.includes('billing=confirmed')
      record('design-rejected', { mode, settlementSyncFailed: result.settlementSyncFailed, message })
      assert(result.settlementSyncFailed, 'Expected the specific settlement_sync_failed error')
      assert(result.billingConfirmed)
    }
    await delay(1000)
    const state = await ipc('loadState', undefined)
    assert.equal(page.isClosed(), false)
    assert.equal(app.process().exitCode, null)
    assert.equal(model.requests.length, callsBefore + 1)
    const current = state.runs.find((r: any) => r.id === run.id)
    const designs = state.artifacts.filter((a: any) => a.runId === run.id && a.kind === 'design')
    const lifecycle = await app.evaluate(() => (globalThis as any).__h6Events)
    assert.equal(lifecycle.filter((e: any) => ['window-close', 'render-process-gone', 'webcontents-destroyed'].includes(e.event)).length, 0)
    assert.equal(result.succeeded, mode === 'none')
    if (mode !== 'none') {
      assert.equal(current.currentNodeId, design.id)
      assert.equal(designs.length, 0)
      // Repeated admission while settlement remains unavailable must not make another model call.
      await assert.rejects(() => completeDesign(run, design.id))
      assert.equal(model.requests.length, callsBefore + 1)
      fault = 'none'
      const recovered = await completeDesign(run, design.id)
      assert.equal(recovered.artifact.kind, 'design')
      assert.equal(model.requests.length, callsBefore + 2)
      result.recoverySucceeded = true
    } else assert.equal(designs.length, 1)
    Object.assign(result, { rendererResponsive: true, mainAlive: true, automaticRetryCalls: 0, finishedAt: Date.now() })
    report.cases.push(result)
    console.log(JSON.stringify(result))
  }
  report.lifecycleBeforeControls = await app.evaluate(() => (globalThis as any).__h6Events)
  // Positive controls prove the probes distinguish a renderer crash from an explicit window close.
  record('positive-control-renderer-crash')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.forcefullyCrashRenderer())
  await delay(500)
  record('positive-control-window-close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
  await delay(500)
  report.lifecycleWithControls = await app.evaluate(() => (globalThis as any).__h6Events)
  assert(report.lifecycleWithControls.some((e: any) => e.event === 'render-process-gone'))
  assert(report.lifecycleWithControls.some((e: any) => e.event === 'window-closed'))
  report.passed = true
  report.syntheticModelCalls = model.requests.length
} catch (error) {
  report.passed = false
  report.failure = String(error).slice(0, 1200)
  process.exitCode = 1
} finally {
  record('cleanup-start')
  report.mainStderr = desktop?.diagnostics.join('').slice(-16_000) ?? ''
  await desktop?.app.close().catch(() => undefined)
  await model?.close()
  if (proxy) { proxy.closeAllConnections(); await new Promise<void>((resolve) => proxy!.close(() => resolve())) }
  await stopProcess(team?.process)
  await removeWorkspace(workspace)
  report.finishedAt = new Date().toISOString()
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, output, failure: report.failure }))
}
