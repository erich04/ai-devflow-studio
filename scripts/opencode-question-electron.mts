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
export async function verifyQuestionInElectron(input: { root: string; directory: string; endpoint: string; version: string }) {
  const workspace = fileURLToPath(new URL('..', import.meta.url))
  const output = path.join(workspace, 'output/playwright/opencode-question')
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
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1672, 973))
    return page
  }
  try {
    let page = await launch()
    await page.evaluate((pairing) => window.aiDevFlowDesktop!.pairDesktop(pairing), { code: team.pairingCode, localProjectId: run.projectId })
    await page.evaluate((projectId) => window.aiDevFlowDesktop!.saveCodingRuntimeBudgetPolicy({ projectId, enabled: false, monthlyLimitUsd: 1, warningThresholdUsd: 0.5 }), run.projectId)
    const begin = async () => page.evaluate(async (run) => {
      const api = window.aiDevFlowDesktop!
      const started = await api.runCodingAgent({ runId: run.id, nodeId: run.currentNodeId, projectId: run.projectId, requestedBy: 'u-erich', userInstruction: run.request })
      const request = started.state.codingPermissionRequests.find((item) => item.codingRunId === started.codingRun.id && item.status === 'pending')!
      await api.replyCodingPermission({ codingRunId: started.codingRun.id, requestId: request.id, decidedBy: 'untrusted-renderer', decision: 'approved', comment: 'Fixture execution authorization' })
      return (await api.loadState()).codingRuns.find((item) => item.id === started.codingRun.id)!
    }, run)
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
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.aiDevFlowDesktop!.loadState())
      const current = state.codingRuns.find((item) => item.id === waiting.id)
      if (current?.status === 'failed') throw new Error(current.summary)
      return state.codingPermissionRequests.find((item) => item.codingRunId === waiting.id && item.origin === 'change_acceptance')?.status
    }, { timeout: 60_000 }).toBe('pending')
    const completed = await page.evaluate(() => window.aiDevFlowDesktop!.loadState())
    const current = completed.codingRuns.find((item) => item.id === waiting.id)!
    assert.equal(current.question?.status, 'answered')
    assert.equal(current.question?.answeredBy, 'u-erich')
    assert.equal(completed.runs.find((item) => item.id === run.id)?.currentNodeId, run.currentNodeId)
    assert(completed.testEvidence.some((item) => item.id === current.testEvidenceId && item.status === 'passed'))
    assert.equal(current.questionReceipts?.length, 1)
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
    await access(retained.worktreePath)
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: input.directory, encoding: 'utf8' }), '')
    console.log(JSON.stringify({ electronQuestion: 'passed', reloadedPendingQuestion: true, realOpenCode: input.version,
      canonicalTests: 'passed', finalAcceptance: 'pending', restartInvalidation: true, sourceRepositoryUnchanged: true, screenshots: output }))
  } catch (error) {
    if (app) {
      const page = await app.firstWindow()
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined)
      const state = await page.evaluate(() => window.aiDevFlowDesktop!.loadState()).catch(() => undefined)
      console.error(JSON.stringify({ runs: state?.codingRuns.map((item) => ({ id: item.id, status: item.status, summary: item.summary })),
        events: state?.codingEvents.slice(-8), toast: await page.getByTestId('toast').textContent().catch(() => null) }))
    }
    throw error
  } finally { await app?.close(); await team.stop() }
}
