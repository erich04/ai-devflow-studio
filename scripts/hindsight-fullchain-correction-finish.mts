/**
 * Continue only after the operator reviewed the exported exact diff and wrote
 * its digest to approved-digest.txt. All product mutations use official IPC.
 * DEVFLOW_FULLCHAIN_LIVE=1 DEVFLOW_FULLCHAIN_CDP=http://127.0.0.1:<port>
 * DEVFLOW_FULLCHAIN_OUTPUT=<correction evidence directory>
 * corepack pnpm exec tsx scripts/hindsight-fullchain-correction-finish.mts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type Page } from '@playwright/test'
import type { CodingChangeSetPreview, LocalExecutionState } from '../packages/shared/src/index.ts'
import type { CreatePrDraftResult, RunKnowledgeReviewResult, RunProjectTestsResult } from '../apps/desktop/src/desktop-api.ts'
import { assertFullchainKnowledgeReceipt } from './hindsight-fullchain-electron.mts'
import { HINDSIGHT_TODO_KNOWLEDGE_PATHS } from './hindsight-todo-fixture.ts'
import { verifyHindsightTodoBrowser } from './hindsight-todo-browser-check.mts'

const allowedPaths = ['README.md', 'index.html', 'src/app.js', 'src/dom.js', 'src/store.js', 'test/store.test.js']
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function main() {
  assert.equal(process.env.DEVFLOW_FULLCHAIN_LIVE, '1')
  assert(process.env.DEVFLOW_FULLCHAIN_OUTPUT)
  const output = path.resolve(process.env.DEVFLOW_FULLCHAIN_OUTPUT)
  const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'))
  assert.equal(report.status, 'awaiting-independent-review')
  const pending = JSON.parse(await readFile(path.join(output, 'pending-approval.json'), 'utf8'))
  assert.equal(pending.phase, 'initial')
  // This file is supplied by the independent reviewer, never by this script.
  assert.equal((await readFile(path.join(output, 'approved-digest.txt'), 'utf8')).trim(), pending.changeSetDigest,
    'Independent approval of this exact initial diff is required')
  const endpoint = new URL(process.env.DEVFLOW_FULLCHAIN_CDP ?? '')
  assert.equal(endpoint.protocol, 'http:')
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))
  assert(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash)
  const save = () => writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  const step = async (phase: string, details: Record<string, unknown> = {}) => {
    const entry = { phase, at: new Date().toISOString(), ...details }
    report.steps.push(entry); await save(); console.log(JSON.stringify(entry))
  }
  report.continuationStartedAt = new Date().toISOString()
  report.status = 'continuing-reviewed-proposal'
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
    assert(page)
    const renderer = page
    const ipc = <T,>(method: string, input?: unknown): Promise<T> => renderer.evaluate(async ({ method, input }) => {
      const api = window.aiDevFlowDesktop as unknown as Record<string, (value?: unknown) => Promise<unknown>>
      if (typeof api[method] !== 'function') throw new Error(`Missing official IPC ${method}`)
      return api[method]!(input)
    }, { method, input }) as Promise<T>
    const sourceDigests = async () => Object.fromEntries(await Promise.all(allowedPaths.map(async (file) =>
      [file, hash(await readFile(path.join(report.workspace.repoDir, file)))])))
    const baselineDigests = await sourceDigests()
    let state = await ipc<LocalExecutionState>('loadState')
    const codingId = pending.codingRunId
    const initial = state.codingRuns.find((item) => item.id === codingId)
    assert(initial && initial.runId === report.runId && initial.projectId === report.projectId)
    assert.equal(initial.status, 'waiting_permission')
    const providerId = initial.providerId
    const receipt = async (phase: string, value: unknown, stage: string) => {
      report.evidence[phase] = await assertFullchainKnowledgeReceipt(value, {
        stage, projectId: report.projectId, repositoryPath: report.workspace.repoDir,
        selectedPaths: [...HINDSIGHT_TODO_KNOWLEDGE_PATHS],
      })
    }
    for (const phase of ['initial', 'repair'] as const) {
      if (state.codingRuns.find((item) => item.id === codingId)?.status === 'completed') break
      const permission = state.codingPermissionRequests.find((item) =>
        item.codingRunId === codingId && item.status === 'pending')
      assert(permission?.changeSetId && permission.changeSetDigest)
      const preview = await ipc<CodingChangeSetPreview>('getCodingChangeSetPreview', {
        changeSetId: permission.changeSetId, codingRunId: codingId,
      })
      assert.equal(preview.phase, phase)
      assert.equal(preview.changeSetDigest, permission.changeSetDigest)
      assert(preview.changedPaths.length > 0 && preview.changedPaths.every((file) => allowedPaths.includes(file)))
      if (phase === 'initial') {
        assert.equal(permission.id, pending.permissionId)
        assert.equal(preview.changeSetDigest, pending.changeSetDigest)
        assert.equal(preview.unifiedDiff, await readFile(path.join(output, 'preview.diff'), 'utf8'))
      } else {
        await writeFile(path.join(output, 'repair-preview.diff'), preview.unifiedDiff)
        await writeFile(path.join(output, 'repair-pending-approval.json'), `${JSON.stringify({
          phase, codingRunId: codingId, permissionId: permission.id,
          changeSetDigest: preview.changeSetDigest, changedPaths: preview.changedPaths,
        }, null, 2)}\n`)
        await step('coding:repair-review-required', { changeSetDigest: preview.changeSetDigest,
          approvalFile: path.join(output, 'repair-approved-digest.txt') })
      }
      const approvalFile = path.join(output, phase === 'initial' ? 'approved-digest.txt' : 'repair-approved-digest.txt')
      let approved = false
      for (let attempt = 0; attempt < (phase === 'initial' ? 1 : 600); attempt++) {
        if ((await readFile(approvalFile, 'utf8').catch(() => '')).trim() === preview.changeSetDigest) {
          approved = true; break
        }
        await delay(1_000)
      }
      assert(approved, 'Exact diff approval is missing; no permission was granted')
      await ipc('replyCodingPermission', {
        requestId: permission.id, codingRunId: codingId, decidedBy: 'u-erich', decision: 'approved',
        comment: 'Independent reviewer approved the exported exact correction diff for the authorized synthetic Todo validation.',
      })
      await step('coding:reviewed-permission-applied', { changeSetPhase: phase, changeSetDigest: preview.changeSetDigest })
      state = await ipc<LocalExecutionState>('loadState')
    }
    const coding = state.codingRuns.find((item) => item.id === codingId)
    assert.equal(coding?.status, 'completed', 'Coding did not complete after the bounded reviewed changes')
    assert(state.testEvidence.some((item) => item.id === coding.testEvidenceId && item.status === 'passed'))
    const managed = state.managedCodingWorkspaces.find((item) => item.codingRunId === codingId)
    assert(managed)
    assert.deepEqual(await sourceDigests(), baselineDigests)
    await receipt('coding-receipt', coding.contextReceipt, 'build')
    report.evidence.coding = { codingRunId: coding.id, status: coding.status, workspace: managed.worktreePath,
      changedPaths: coding.changedPaths, contextReceipt: coding.contextReceipt, usage: coding.runtimeCostSummary }
    for (const file of coding.changedPaths) {
      assert(allowedPaths.includes(file))
      await mkdir(path.dirname(path.join(output, 'generated', file)), { recursive: true })
      await writeFile(path.join(output, 'generated', file), await readFile(path.join(managed.worktreePath, file)))
    }
    await step('coding:complete', { codingRunId: codingId, managedRepository: managed.worktreePath,
      originalRepositoryUnchanged: true })
    const run = state.runs.find((item) => item.id === report.runId)
    assert(run)
    const testNode = run.nodes.find((node) => node.kind === 'test')
    const prNode = run.nodes.find((node) => node.stage === 'pr')
    const acceptNode = run.nodes.find((node) => node.stage === 'accept')
    assert(testNode && prNode && acceptNode)
    const tested = await ipc<RunProjectTestsResult>('runProjectTests', {
      projectId: report.projectId, runId: run.id, nodeId: testNode.id,
    })
    assert.equal(tested.evidence.status, 'passed')
    assert.equal(tested.evidence.exitCode, 0)
    await receipt('test', tested.evidence, 'test')
    await writeFile(path.join(output, 'tests.json'), `${JSON.stringify(tested.evidence, null, 2)}\n`)
    await step('test:passed', { evidenceId: tested.evidence.id })
    report.evidence.browser = await verifyHindsightTodoBrowser({
      managedRepository: managed.worktreePath, originalRepository: report.workspace.repoDir, output,
    })
    assert.equal(report.evidence.browser.passed, true, 'Independent real browser behavior checks failed')
    await step('browser:passed')
    const draft = await ipc<CreatePrDraftResult>('createPrDraft', { runId: run.id, nodeId: prNode.id })
    assert.equal(draft.artifact.kind, 'pr')
    assert.equal(draft.run.pullRequestUrl, undefined)
    report.evidence['pr-package'] = { artifactId: draft.artifact.id, modelCall: false,
      source: 'trusted-coding-diff-and-test-evidence' }
    await writeFile(path.join(output, 'pr-package.md'), draft.artifact.content)
    const reviewed = await ipc<RunKnowledgeReviewResult>('runKnowledgeReview', {
      runId: run.id, nodeId: prNode.id, projectId: report.projectId, requestedBy: 'u-erich',
      runtime: 'electron', providerId,
    })
    assert(reviewed.review?.id)
    await receipt('pr-review', reviewed.review, 'pr')
    await writeFile(path.join(output, 'pr-review.json'), `${JSON.stringify(reviewed.review, null, 2)}\n`)
    await step('pr-review:complete', { reviewId: reviewed.review.id })
    await assert.rejects(() => ipc('runKnowledgeReview', {
      runId: run.id, nodeId: acceptNode.id, projectId: report.projectId, requestedBy: 'u-erich',
      runtime: 'electron', providerId,
    }), /只能针对当前 Gate、PR 交付或 Acceptance 节点运行/u)
    report.evidence.acceptanceElectronBoundary = {
      status: 'correctly-blocked-before-delivery', knowledgeReceiptVerified: false,
      requiredAdditionalEvidence: 'Acceptance knowledge delivery requires separate public runtime integration evidence.',
    }
    state = await ipc<LocalExecutionState>('loadState')
    const finalRun = state.runs.find((item) => item.id === run.id)
    assert.equal(finalRun?.pullRequestUrl, undefined)
    report.workflowCompleted = finalRun?.status === 'completed'
    report.evidence.workflowBoundary = { currentNodeId: finalRun?.currentNodeId, status: finalRun?.status,
      note: 'Approved upstream stages were reused from the same workflow; correction/build/test/PR were exercised. Acceptance remains blocked before real remote delivery.' }
    report.status = 'available-phases-passed'
    report.passed = true
    await renderer.reload()
    await renderer.waitForLoadState('domcontentloaded')
    await renderer.screenshot({ path: path.join(output, 'desktop-final.png'), scale: 'css' })
    await step('electron-available-phases:passed', { workflowCompleted: report.workflowCompleted, deliveryPublished: false })
  } catch (error) {
    report.status = 'failed'
    report.failure = error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000)
    await step('continuation:failed', { reason: report.failure })
  } finally {
    report.finishedAt = new Date().toISOString()
    await save()
  }
  return report
}

const result = await main()
console.log(JSON.stringify({ passed: result.passed, status: result.status, output: result.output, failure: result.failure }))
// Disconnect this dedicated CDP client by ending its process; never close Electron.
process.exit(result.passed ? 0 : 1)
