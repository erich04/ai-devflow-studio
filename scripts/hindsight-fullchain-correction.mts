/**
 * Continue an isolated live validation through the existing renderer's public IPC.
 * This script rejects the reviewed initial proposal and stops at a new, unapproved
 * preview. It never edits project source, saved state, or an approval digest.
 *
 * DEVFLOW_FULLCHAIN_LIVE=1 DEVFLOW_FULLCHAIN_CDP=http://127.0.0.1:<port>
 * DEVFLOW_FULLCHAIN_PREVIOUS=<original evidence directory>
 * corepack pnpm exec tsx scripts/hindsight-fullchain-correction.mts
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { chromium, type Page } from '@playwright/test'
import type { CodingAgentRun, CodingChangeSetPreview, LocalExecutionState } from '../packages/shared/src/index.ts'
import { assertFullchainKnowledgeReceipt } from './hindsight-fullchain-electron.mts'
import { HINDSIGHT_TODO_KNOWLEDGE_PATHS } from './hindsight-todo-fixture.ts'

const execute = promisify(execFile)
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const allowedPaths = ['README.md', 'index.html', 'src/app.js', 'src/dom.js', 'src/store.js', 'test/store.test.js']
const correction = [
  '代码复核修正：清理时 localStorage.setItem 可能在启动探针成功后抛异常。clearCompleted 必须保持内存清理可用，并将持久化失败传递至界面，复用 storage-warning 和现有“当前浏览器无法保存数据，刷新后内容会丢失”提示；不能仅吞掉异常而只显示成功。',
  '增加有真实断言的测试：先成功写入后令 setItem 抛异常，确认清理结果与失败状态/通知；补 emoji 按码点 200 允许、201 拒绝，以及先清除非零项后再次清理返回 0。沿用 Node 内置测试，无新依赖。',
  '保留已批准业务规则、幸存任务全部字段与相对顺序、存储键格式及既有功能。最多修改 README.md、index.html、src/app.js、src/dom.js、src/store.js、test/store.test.js 六文件，最多 12 个精确替换项；沿用现有样式，不修改 src/styles.css。',
].join('\n')

async function main() {
  assert.equal(process.env.DEVFLOW_FULLCHAIN_LIVE, '1', 'Explicit live synthetic validation authorization is required')
  const endpoint = new URL(process.env.DEVFLOW_FULLCHAIN_CDP ?? '')
  assert.equal(endpoint.protocol, 'http:')
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))
  assert(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash)
  const previous = path.resolve(process.env.DEVFLOW_FULLCHAIN_PREVIOUS ?? '')
  assert(process.env.DEVFLOW_FULLCHAIN_PREVIOUS, 'Original evidence directory is required')
  const original = JSON.parse(await readFile(path.join(previous, 'report.json'), 'utf8'))
  const pending = JSON.parse(await readFile(path.join(previous, 'pending-approval.json'), 'utf8'))
  assert.equal(pending.phase, 'initial')
  assert(original.runId && original.projectId && original.workspace?.repoDir && original.evidence?.request)
  for (const phase of ['clarify', 'clarify-review', 'design', 'design-review']) {
    assert(original.evidence[phase], `Original ${phase} evidence is required`)
  }
  const output = path.resolve(process.env.DEVFLOW_FULLCHAIN_OUTPUT ?? `${previous}-correction`)
  assert.notEqual(output, previous)
  await mkdir(output) // Refuse to overwrite a previous correction attempt.
  const report: {
    startedAt: string; finishedAt?: string; passed: boolean; failure?: string
    status: string; output: string; previous: string; runId: string; projectId: string
    workspace: typeof original.workspace; evidence: Record<string, unknown>; steps: Record<string, unknown>[]
    workflowCompleted: boolean; deliveryPublished: boolean
  } = {
    startedAt: new Date().toISOString(), passed: false, status: 'starting', output, previous,
    runId: original.runId, projectId: original.projectId, workspace: original.workspace,
    evidence: { inheritedWorkflow: {
      report: path.join(previous, 'report.json'), runId: original.runId,
      phases: ['clarify', 'clarify-review', 'design', 'design-review'],
      note: 'The approved upstream stages are reused from this same workflow, not regenerated or newly verified.',
    } }, steps: [], workflowCompleted: false, deliveryPublished: false,
  }
  const save = () => writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  const step = async (phase: string, details: Record<string, unknown> = {}) => {
    const entry = { phase, at: new Date().toISOString(), ...details }
    report.steps.push(entry); await save(); console.log(JSON.stringify(entry))
  }
  await save()
  try {
    const browser = await chromium.connectOverCDP(endpoint.href)
    let page: Page | undefined
    for (const candidate of browser.contexts().flatMap((context) => context.pages())) {
      if (await candidate.evaluate(() => Boolean(window.aiDevFlowDesktop)).catch(() => false)) {
        assert(!page, 'More than one DevFlow renderer found')
        page = candidate
      }
    }
    assert(page, 'The existing DevFlow renderer is unavailable')
    const renderer = page
    const ipc = <T,>(method: string, input?: unknown): Promise<T> => renderer.evaluate(async ({ method, input }) => {
      const api = window.aiDevFlowDesktop as unknown as Record<string, (value?: unknown) => Promise<unknown>>
      if (typeof api[method] !== 'function') throw new Error(`Missing official IPC ${method}`)
      return api[method]!(input)
    }, { method, input }) as Promise<T>
    const sourceDigests = async () => Object.fromEntries(await Promise.all(allowedPaths.map(async (file) =>
      [file, hash(await readFile(path.join(original.workspace.repoDir, file)))])))
    const baselineDigests = await sourceDigests()
    let state = await ipc<LocalExecutionState>('loadState')
    const old = state.codingRuns.find((item) => item.id === pending.codingRunId)
    const permission = state.codingPermissionRequests.find((item) => item.id === pending.permissionId)
    assert(old && permission)
    assert.equal(old.runId, original.runId)
    assert.equal(old.projectId, original.projectId)
    assert.equal(old.status, 'waiting_permission')
    assert.equal(permission.status, 'pending')
    assert.equal(permission.changeSetDigest, pending.changeSetDigest)
    assert.equal(permission.codingRunId, old.id)
    assert.deepEqual(old.changedPaths, [])
    assert(!old.diffArtifactId && !old.testEvidenceId)
    assert(!state.codingDiffArtifacts.some((item) => item.runId === old.runId))
    const oldPreview = await ipc<CodingChangeSetPreview>('getCodingChangeSetPreview', {
      changeSetId: permission.changeSetId, codingRunId: old.id,
    })
    assert.equal(oldPreview.phase, 'initial')
    assert.equal(oldPreview.changeSetDigest, pending.changeSetDigest)
    const managed = state.managedCodingWorkspaces.find((item) => item.codingRunId === old.id)
    assert(managed)
    assert.equal((await execute('git', ['status', '--porcelain'], { cwd: managed.worktreePath })).stdout, '')
    assert.equal((await execute('git', ['status', '--porcelain'], { cwd: original.workspace.repoDir })).stdout, '')
    await ipc('replyCodingPermission', {
      requestId: permission.id, codingRunId: old.id, decidedBy: 'u-erich', decision: 'rejected',
      comment: 'Independent code review rejected this exact initial proposal: runtime storage-write failure does not show the required existing warning; correction must add the notification path and regression coverage.',
    })
    state = await ipc<LocalExecutionState>('loadState')
    const rejected = state.codingRuns.find((item) => item.id === old.id)
    assert.equal(rejected?.status, 'interrupted')
    assert.equal(state.codingPermissionRequests.find((item) => item.id === permission.id)?.status, 'rejected')
    assert.deepEqual(rejected.changedPaths, [])
    assert(!rejected.diffArtifactId && !rejected.testEvidenceId)
    assert(!state.codingDiffArtifacts.some((item) => item.runId === old.runId))
    assert.deepEqual(await sourceDigests(), baselineDigests)
    const run = state.runs.find((item) => item.id === original.runId)
    const build = run?.nodes.find((node) => node.id === run.currentNodeId)
    assert(run && build && build.id === old.nodeId && build.stage === 'build' && build.kind === 'task')
    assert.equal(run.status, 'building')
    assert.equal(build.status, 'running')
    report.evidence.rejectedProposal = {
      codingRunId: old.id, permissionId: permission.id, changeSetDigest: pending.changeSetDigest,
      status: rejected.status, sourceUnchanged: true, worktreeCleanBeforeRejection: true,
      changedPaths: rejected.changedPaths, usage: rejected.runtimeCostSummary,
      providerCalls: state.codingEvents.filter((item) => item.codingRunId === old.id && item.metadata?.providerCall)
        .map((item) => item.metadata!.providerCall),
    }
    await step('coding:review-rejected', { codingRunId: old.id, changeSetDigest: pending.changeSetDigest })
    const request = `${original.evidence.request}\n\n${correction}`
    report.evidence.request = request
    await step('coding:correction-started')
    const started = await ipc<{ codingRun: CodingAgentRun }>('runCodingAgent', {
      runId: run.id, nodeId: build.id, projectId: original.projectId, requestedBy: 'u-erich',
      userInstruction: request,
    })
    assert.notEqual(started.codingRun.id, old.id)
    state = await ipc<LocalExecutionState>('loadState')
    const current = state.codingRuns.find((item) => item.id === started.codingRun.id)
    assert.equal(current?.status, 'waiting_permission')
    assert.deepEqual(current.changedPaths, [])
    const receipt = await assertFullchainKnowledgeReceipt(current.contextReceipt, {
      stage: 'build', projectId: original.projectId, repositoryPath: original.workspace.repoDir,
      selectedPaths: [...HINDSIGHT_TODO_KNOWLEDGE_PATHS],
    })
    const nextPermission = state.codingPermissionRequests.find((item) =>
      item.codingRunId === current.id && item.status === 'pending')
    assert(nextPermission?.changeSetId && nextPermission.changeSetDigest)
    const preview = await ipc<CodingChangeSetPreview>('getCodingChangeSetPreview', {
      changeSetId: nextPermission.changeSetId, codingRunId: current.id,
    })
    assert.equal(preview.phase, 'initial')
    assert.equal(preview.changeSetDigest, nextPermission.changeSetDigest)
    assert(preview.changedPaths.length > 0 && preview.changedPaths.every((file) => allowedPaths.includes(file)))
    assert(preview.changedPaths.includes('src/store.js'))
    assert.deepEqual(await sourceDigests(), baselineDigests)
    await writeFile(path.join(output, 'preview.diff'), preview.unifiedDiff)
    await writeFile(path.join(output, 'pending-approval.json'), `${JSON.stringify({
      phase: 'initial', changeSetDigest: preview.changeSetDigest, codingRunId: current.id,
      permissionId: nextPermission.id, changedPaths: preview.changedPaths,
    }, null, 2)}\n`)
    report.evidence.coding = { codingRunId: current.id, status: current.status, receipt,
      usage: current.runtimeCostSummary, contextReceipt: current.contextReceipt }
    report.status = 'awaiting-independent-review'
    await step('coding:correction-preview-ready', {
      codingRunId: current.id, changeSetDigest: preview.changeSetDigest, changedPaths: preview.changedPaths,
      note: 'No approval issued. Tests, PR review and browser acceptance remain pending.',
    })
  } catch (error) {
    report.status = 'failed'
    report.failure = error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000)
    await step('correction:failed', { reason: report.failure })
  } finally {
    report.finishedAt = new Date().toISOString()
    await save()
  }
  return report
}

const result = await main()
console.log(JSON.stringify({ status: result.status, output: result.output, failure: result.failure }))
// Public Playwright Browser has no disconnect method. Exit this dedicated CDP
// client process, closing only its sockets. Never send Browser.close to Electron.
process.exit(result.status === 'awaiting-independent-review' ? 0 : 1)
