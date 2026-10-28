import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, type ElectronApplication } from '@playwright/test'
import type { WorkflowRun } from '../packages/shared/src/domain.ts'
import type {} from '../apps/desktop/src/desktop-api.ts'
import { detectCodingRuntimeEngines } from '../apps/desktop/electron/opencode-discovery.ts'
import { createLocalStore } from '../apps/desktop/electron/local-store.ts'
import { startIsolatedTeamApi } from './stage-agent-design-electron.mts'

/** Full real Main → OpenCode → question UI → canonical test → final acceptance boundary. */
export async function verifyQuestionInElectron(input: { root: string; directory: string; endpoint: string; version: string; delegated?: boolean }) {
  const workspace = fileURLToPath(new URL('..', import.meta.url))
  const output = path.join(workspace, `output/playwright/opencode-${input.delegated ? 'task' : 'question'}`)
  await mkdir(output, { recursive: true })
  await writeFile(path.join(input.directory, 'message.txt'), 'Old\n')
  await writeFile(path.join(input.directory, 'package.json'), JSON.stringify({ name: 'question-fixture', version: '1.0.0', scripts: { test: 'node test.mjs' } }))
  await writeFile(path.join(input.directory, 'test.mjs'), "import { readFileSync } from 'node:fs'; if (readFileSync('message.txt', 'utf8') !== 'Green\\n') process.exit(1); console.log('question answer applied');\n")
  await writeFile(path.join(input.directory, 'package-lock.json'), JSON.stringify({ name: 'question-fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'question-fixture', version: '1.0.0' } } }))
  await writeFile(path.join(input.directory, '.gitignore'), 'node_modules\n')
  for (const args of [['init', '-b', 'main'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture']]) {
    execFileSync('git', args, { cwd: input.directory, stdio: 'ignore' })
  }
  const userData = path.join(input.root, 'electron-profile'), now = new Date().toISOString()
  const run: WorkflowRun = { id: 'question-run', version: 1, projectId: 'local-question', title: '问答闭环验证', request: 'Ask color then update message.txt.', creatorId: 'u-erich',
    status: 'building', currentNodeId: 'question-build', branchName: 'devflow/question-fixture', createdAt: now, updatedAt: now,
    nodes: [{ id: 'question-build', stage: 'build', kind: 'task', status: 'running', title: '实现颜色', subtitle: '询问颜色后修改文件', ownerId: 'u-erich', retryCount: 0, artifactIds: [] },
      { id: 'question-test', stage: 'test', kind: 'test', status: 'pending', title: '测试', subtitle: '测试修改', ownerId: 'u-erich', retryCount: 0, artifactIds: [] }],
    edges: [{ id: 'question-edge', source: 'question-build', target: 'question-test', kind: 'normal' }] }
  const candidate = (await detectCodingRuntimeEngines({ projectId: run.projectId })).candidates[0]
  assert(candidate?.status === 'available' && candidate.binaryPath)
  const binaryPath = candidate.binaryPath
  const store = await createLocalStore({ dbPath: path.join(userData, 'devflow.sqlite') })
  await store.upsertProject({ id: run.projectId, name: 'Question fixture', path: input.directory, packageManager: 'npm', testCommand: 'npm test', createdAt: now, updatedAt: now })
  await store.saveRun(run)
  await store.saveProviderCredential({ providerId: 'question-fixture', name: 'Local synthetic model', model: 'fixture', baseUrl: input.endpoint, maskedCredential: 'synthetic-only', updatedAt: now }, Buffer.from('synthetic-not-billed').toString('base64'))
  await store.saveCodingRuntimeConfiguration({ projectId: run.projectId, executor: 'opencode-http', providerId: 'question-fixture', modelId: 'fixture',
    binaryPath, detectedVersion: input.version, version: 1, updatedAt: now })
  await store.saveSettings({ selectedAgentProviderId: 'question-fixture', themePreference: 'dark' })
  store.close()
  const team = await startIsolatedTeamApi(workspace, input.root)
  let app: ElectronApplication | undefined
  const launch = async () => {
    app = await electron.launch({ args: ['.'], cwd: path.join(workspace, 'apps/desktop'), env: {
      PATH: process.env.PATH ?? '', HOME: input.root, DEVFLOW_USER_DATA_DIR: userData,
      DEVFLOW_DATA_PROFILE_REGISTRY_PATH: path.join(userData, 'profiles.json'), DEVFLOW_API_BASE_URL: team.url,
      DEVFLOW_OPENCODE_BIN: binaryPath, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    } })
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isAsyncEncryptionAvailable = async () => true
      safeStorage.encryptStringAsync = async (value: string) => Buffer.from(`question-smoke:${value}`)
      safeStorage.decryptStringAsync = async (bytes) => {
        const value = bytes.toString()
        if (value === 'synthetic-not-billed') return { result: value, shouldReEncrypt: false }
        if (value.startsWith('question-smoke:')) return { result: value.slice('question-smoke:'.length), shouldReEncrypt: false }
        throw new Error('Unexpected test credential')
      }
    })
    // Test-local diagnostics: capture only the four internal scope fields and
    // rejected relay responses, never provider credentials or prompt bodies.
    await app.evaluate(async () => {
      const { Server } = process.getBuiltinModule('node:http')
      const diagnostics: unknown[] = []
      ;(globalThis as typeof globalThis & { fixtureRelayDiagnostics?: unknown[] }).fixtureRelayDiagnostics = diagnostics
      const emit = Server.prototype.emit
      Server.prototype.emit = function (event: string | symbol, ...args: any[]) {
        if (event === 'request' && args[0]?.url === '/v1/chat/completions') {
          const request = args[0], response = args[1], end = response.end
          const scope = Object.fromEntries(['x-devflow-coding-run', 'x-devflow-workspace', 'x-devflow-root-session', 'x-devflow-session']
            .map((key) => [key, request.headers[key]]))
          response.end = function (...values: any[]) {
            diagnostics.push({ scope, status: response.statusCode,
              ...(response.statusCode >= 400 ? { error: String(values[0] ?? '').slice(0, 500) } : {}) })
            return end.apply(this, values)
          }
        }
        return (emit as (event: string | symbol, ...args: any[]) => boolean).call(this, event, ...args)
      }
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1672, 973))
    return page
  }
  try {
    let page = await launch()
    await page.evaluate((pairing) => window.aiDevFlowDesktop!.pairDesktop(pairing), { code: team.pairingCode, localProjectId: run.projectId })
    await page.evaluate((projectId) => window.aiDevFlowDesktop!.saveCodingRuntimeBudgetPolicy({ projectId, enabled: false, monthlyLimitUsd: 1, warningThresholdUsd: 0.5 }), run.projectId)
    const begin = async () => {
      // A fresh isolated HOME may still be initializing OpenCode's model catalog.
      // Wait through the same bounded Main readiness probes used by the UI.
      await expect.poll(async () => (await page.evaluate((run) => window.aiDevFlowDesktop!.getCodingRuntimeReadiness({
        runId: run.id, nodeId: run.currentNodeId, projectId: run.projectId, requestedBy: 'u-erich',
      }), run)).status, { timeout: 30_000 }).toBe('ready')
      return page.evaluate(async (run) => {
        const api = window.aiDevFlowDesktop!
        const started = await api.runCodingAgent({ runId: run.id, nodeId: run.currentNodeId, projectId: run.projectId, requestedBy: 'u-erich', userInstruction: run.request })
        const request = started.state.codingPermissionRequests.find((item) => item.codingRunId === started.codingRun.id && item.status === 'pending')!
        await api.replyCodingPermission({ codingRunId: started.codingRun.id, requestId: request.id, decidedBy: 'untrusted-renderer', decision: 'approved', comment: 'Fixture execution authorization' })
        return (await api.loadState()).codingRuns.find((item) => item.id === started.codingRun.id)!
      }, run)
    }
    const waiting = await begin()
    assert.equal(waiting.status, 'waiting_input')
    assert(waiting.question?.questions[0]?.question === 'Choose color')
    const openTask = async () => {
      await page.reload()
      await page.locator('aside[aria-label="Primary navigation"]').getByRole('button', { name: /^任务中心/ }).click()
      await page.getByRole('button', { name: `继续任务：${run.title}`, exact: true }).click()
      const toggle = page.locator('[data-testid="stage-item"][aria-expanded="false"]')
      if (await toggle.count()) await toggle.click()
      await page.getByTestId(`flow-node-${run.currentNodeId}`).click()
    }
    await openTask()
    const panel = page.getByTestId('coding-question-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: '发送回答' })).toBeDisabled()
    await panel.getByLabel('Color：自定义回答').fill('Green')
    await panel.getByRole('checkbox', { name: /Desktop/ }).check()
    await panel.getByRole('checkbox', { name: /Web/ }).check()
    await page.screenshot({ path: path.join(output, '01-question.png'), scale: 'css' })
    await panel.getByRole('button', { name: '发送回答' }).click()
    if (input.delegated) {
      await expect.poll(async () => (await page.evaluate(() => window.aiDevFlowDesktop!.loadState())).codingPermissionRequests
        .find((item) => item.codingRunId === waiting.id && item.status === 'pending' && (item.origin ?? 'coding_executor') === 'coding_executor')?.command,
      { timeout: 30_000 }).toBe('npm test')
      const command = page.getByTestId('workbench-coding-permission-summary').getByLabel('待授权命令')
      await expect(command).toBeVisible()
      assert.equal(await command.textContent(), 'npm test')
      assert.equal(await command.evaluate((element) => element.closest('details') === null), true,
        'One-time command approval must not require expanding the session reuse disclosure')
      await page.getByRole('button', { name: '查看权限详情', exact: true }).click()
      await expect(command).toBeVisible()
      await command.scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(output, '01b-command-permission.png'), scale: 'css' })
      await page.evaluate(async (codingRunId) => {
        const api = window.aiDevFlowDesktop!, state = await api.loadState()
        const request = state.codingPermissionRequests.find((item) => item.codingRunId === codingRunId && item.status === 'pending' && (item.origin ?? 'coding_executor') === 'coding_executor')!
        await api.replyCodingPermission({ codingRunId, requestId: request.id, decidedBy: 'untrusted-renderer', decision: 'approved', comment: 'Fixture child test approval' })
      }, waiting.id)
    }
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.aiDevFlowDesktop!.loadState())
      const current = state.codingRuns.find((item) => item.id === waiting.id)
      if (current?.status === 'failed') throw new Error(current.summary)
      return state.codingPermissionRequests.find((item) => item.codingRunId === waiting.id && item.origin === 'change_acceptance')?.status
    }, { timeout: 60_000 }).toBe('pending')
    const completed = await page.evaluate(() => window.aiDevFlowDesktop!.loadState())
    const current = completed.codingRuns.find((item) => item.id === waiting.id)!
    const providerEvents = completed.codingEvents.filter((item) => item.codingRunId === waiting.id &&
      item.metadata?.providerCall && (item.metadata.providerCall as { status?: string }).status === 'succeeded')
    assert(providerEvents.length > 0, 'Main must persist provider settlement events from the trusted relay')
    assert.equal(current.runtimeCostSummary?.inputTokens, providerEvents.length * 50)
    assert.equal(current.runtimeCostSummary?.outputTokens, providerEvents.length * 10)
    assert.equal(current.runtimeCostSummary?.providerCallIds?.length, providerEvents.length)
    assert.equal(current.runtimeCostSummary?.costStatus, 'unknown', 'Synthetic model has no tariff; usage is known, price is unknown')
    assert.equal(current.runtimeCostSummary?.usageStatus, 'incomplete', 'Synthetic fixture intentionally omits the cache split')
    const callUsage = current.runtimeCostSummary.providerCallSettlements
    assert.equal(callUsage?.length, providerEvents.length)
    assert(callUsage?.every((call) => call.inputTokens === 50 && call.outputTokens === 10 &&
      call.cacheReadTokens === null && call.cacheMissTokens === null && call.usageStatus === 'incomplete' &&
      call.costStatus === 'unknown' && call.costUsd === null && call.pricingSnapshot === null),
    'Each fixture response omits cache usage; incomplete usage is not inferred merely from an unknown tariff')
    const totalTokens = providerEvents.length * 60
    await expect(page.getByTestId('task-usage-summary')).toContainText(`${totalTokens.toLocaleString()} + ${providerEvents.length} 项用量不完整 tokens`)
    await expect(page.getByTestId('task-usage-summary')).toContainText(`${providerEvents.length} 项金额待确认`)
    const billedSessions = new Set(providerEvents.map((item) => item.metadata?.executorSessionId))
    const billedRoots = new Set(providerEvents.map((item) => item.metadata?.parentSessionId))
    assert.equal(billedRoots.size, 1)
    assert([...billedRoots].every((value) => typeof value === 'string' && value.length > 0))
    assert(billedSessions.has([...billedRoots][0]), 'Root session usage must belong to the same Coding Run')
    assert.equal(billedSessions.size, input.delegated ? 2 : 1, 'Parent and child usage must retain their checked session scope')
    const relayed = await app!.evaluate(() => (globalThis as typeof globalThis & {
      fixtureRelayDiagnostics?: Array<{ scope: Record<string, string>; status: number }>
    }).fixtureRelayDiagnostics ?? [])
    assert.equal(relayed.length, providerEvents.length)
    assert(relayed.every((item) => item.status === 200 && item.scope['x-devflow-coding-run'] === waiting.id &&
      item.scope['x-devflow-workspace'] === current.managedWorkspaceId && billedRoots.has(item.scope['x-devflow-root-session']) &&
      billedSessions.has(item.scope['x-devflow-session'])), 'All four trusted scope headers must reach Main and match persisted usage')
    assert.equal(current.question?.status, 'answered')
    assert.equal(current.question?.answeredBy, 'u-erich')
    assert.equal(completed.runs.find((item) => item.id === run.id)?.currentNodeId, run.currentNodeId)
    assert(completed.testEvidence.some((item) => item.id === current.testEvidenceId && item.status === 'passed'))
    assert.equal(current.questionReceipts?.length, 1)
    if (input.delegated) {
      const event = completed.codingEvents.find((item) => item.codingRunId === waiting.id && item.kind === 'diff')
      assert.equal(event?.metadata?.childSessions, 1)
      assert.equal(event?.metadata?.totalToolCalls, 4)
      assert(completed.codingEvents.some((item) => item.codingRunId === waiting.id && item.metadata?.permission === 'task' && item.metadata?.executorSessionId === current.question?.sessionId))
    }
    await page.screenshot({ path: path.join(output, '02-final-acceptance.png'), scale: 'css' })
    await page.evaluate((codingRunId) => window.aiDevFlowDesktop!.cancelCodingAgentRun({ codingRunId }), waiting.id)
    const restartQuestion = await begin()
    assert.equal(restartQuestion.status, 'waiting_input')
    const beforeRestart = await page.evaluate(() => window.aiDevFlowDesktop!.loadState())
    const retained = beforeRestart.managedCodingWorkspaces.find((item) => item.id === restartQuestion.managedWorkspaceId)!
    await app!.close(); app = undefined
    page = await launch()
    await expect.poll(async () => (await page.evaluate(() => window.aiDevFlowDesktop!.loadState())).codingRuns.find((item) => item.id === restartQuestion.id)?.question?.status,
      { timeout: 15_000 }).toBe('invalidated')
    const restarted = await page.evaluate(() => window.aiDevFlowDesktop!.loadState())
    assert.deepEqual(restarted.codingRuns.find((item) => item.id === waiting.id)?.runtimeCostSummary, current.runtimeCostSummary,
      'Finished run expenses must survive cancellation, another attempt and restart')
    await access(retained.worktreePath)
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: input.directory, encoding: 'utf8' }), '')
    const evidence = { electronQuestion: 'passed', boundedTask: input.delegated === true, reloadedPendingQuestion: true, realOpenCode: input.version,
      model: 'synthetic-not-billed', teamApi: 'isolated-demo-memory', providerCalls: providerEvents.length, billedSessions: billedSessions.size,
      inputTokens: current.runtimeCostSummary!.inputTokens, outputTokens: current.runtimeCostSummary!.outputTokens, totalTokens,
      callUsage: callUsage!.map(({ inputTokens, outputTokens, cacheReadTokens, cacheMissTokens, usageStatus, costStatus, costUsd }) =>
        ({ inputTokens, outputTokens, cacheReadTokens, cacheMissTokens, usageStatus, costStatus, costUsd })),
      priceStatus: current.runtimeCostSummary!.costStatus, headerUsageProjection: true, restartedUsagePreserved: true,
      ...(input.delegated ? { commandPermissionVisible: 'npm test', commandPermissionScreenshot: '01b-command-permission.png' } : {}),
      canonicalTests: 'passed', finalAcceptance: 'pending', restartInvalidation: true, sourceRepositoryUnchanged: true, screenshots: output }
    await writeFile(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2))
    console.log(JSON.stringify(evidence))
  } catch (error) {
    if (app) {
      const page = await app.firstWindow()
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined)
      const state = await page.evaluate(() => window.aiDevFlowDesktop!.loadState()).catch(() => undefined)
      const relay = await app.evaluate(() => (globalThis as typeof globalThis & { fixtureRelayDiagnostics?: unknown[] }).fixtureRelayDiagnostics).catch(() => undefined)
      const failure = { runs: state?.codingRuns.map((item) => ({ id: item.id, status: item.status, summary: item.summary,
        engine: item.engine, providerId: item.providerId, configVersion: item.configVersion, managedWorkspaceId: item.managedWorkspaceId })),
        events: state?.codingEvents.slice(-8), relay, toast: await page.getByTestId('toast').textContent().catch(() => null) }
      await writeFile(path.join(output, 'failure.json'), JSON.stringify(failure, null, 2)).catch(() => undefined)
      console.error(JSON.stringify(failure))
    }
    throw error
  } finally { await app?.close(); await team.stop() }
}
