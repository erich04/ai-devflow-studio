import { buildChangeSetDiffView, isActiveCodingAgentRunStatus, parseCodingExecutorTurn, redactSensitiveText, type CodingAgentEvent, type CodingAgentRun, type CodingChangeReview, type CodingChangeSet, type CodingPermissionRequest, type LocalProject, type ManagedCodingWorkspace, type WorkflowRun } from '@ai-devflow/shared'
import type { CodingExecutor, CodingExecutorContinuePermissionInput } from './coding-executor.js'
import type { CodingProviderCallReporter } from './coding-engine.js'
import type { CodingAgentMutation, CodingAgentMutationResult, LocalStore } from './local-store.js'
import type { CodingRuntimeStore } from './coding-runtime.js'
import type { ReviseCodingChangeSetInput } from './build-test-contract.js'
import { verifyCodingChangeSetDisplay } from './coding-change-set.js'

// IPC creates runtime facades per request, so ownership must outlive any one facade.
const revisionsInProgress = new Set<string>()
const reviewsStarting = new Set<string>()
type Continuation = Omit<CodingExecutorContinuePermissionInput, 'requestId' | 'runtimeContext'>
type HistoryStore = Pick<LocalStore, 'getCodingChangeSet' | 'listCodingChangeSets' | 'saveCodingChangeReview' | 'listCodingChangeReviews'>
export type CodingChangeControlPorts = {
  store: CodingRuntimeStore & Partial<HistoryStore>; executor: CodingExecutor; now(): string; id(prefix: string): string
  findRun(id: string): Promise<CodingAgentRun>; findWorkflow(id: string): Promise<WorkflowRun>
  findProject(id: string): Promise<LocalProject>; findWorkspace(id: string, projectId: string): Promise<ManagedCodingWorkspace>
  assertContext(run: CodingAgentRun): Promise<void>; continuation(id: string): Promise<Continuation>
  commit(mutation: CodingAgentMutation): Promise<CodingAgentMutationResult>
  mapEvents(id: string, events: CodingAgentEvent[]): Promise<CodingAgentEvent[]>
  report(run: CodingAgentRun): CodingProviderCallReporter
  budget(run: CodingAgentRun, calls: number, requestedBy: string): Promise<void>
  expire(id: string): Promise<void>; schedule(run: CodingAgentRun): void; publish(runId: string): void
  autoReview: boolean
}
function failure(code: string, detail: string): Error { return new Error(`[${code}] ${detail}`) }
function clearRevision(run: CodingAgentRun): CodingAgentRun { const { revisionInFlight: _, ...rest } = run; return rest }

export function createCodingChangeControl(p: CodingChangeControlPorts) {
  function history(): HistoryStore {
    const s = p.store
    if (!s.getCodingChangeSet || !s.listCodingChangeSets || !s.saveCodingChangeReview || !s.listCodingChangeReviews) throw failure('revise_unsupported', '这个执行器还不能按清单修改。')
    return { getCodingChangeSet: s.getCodingChangeSet.bind(s), listCodingChangeSets: s.listCodingChangeSets.bind(s), saveCodingChangeReview: s.saveCodingChangeReview.bind(s), listCodingChangeReviews: s.listCodingChangeReviews.bind(s) }
  }
  async function pending(run: CodingAgentRun) { return (await p.store.listCodingPermissionRequests(run.id)).filter(r => r.status === 'pending') }
  async function saveReview(review: CodingChangeReview) { const saved = await history().saveCodingChangeReview(review); p.publish(saved.runId); return saved }
  async function reviewCurrent(runId: string, changeId: string, digest: string) {
    const run = await p.findRun(runId), change = await history().getCodingChangeSet(changeId)
    if (!p.executor.reviewChangeSet || run.engine !== 'native' || run.status !== 'waiting_permission' || run.revisionInFlight || !change || run.changeSetId !== change.id || change.phase !== 'initial' || change.codingRunId !== run.id || change.changeSetDigest !== digest || !(await pending(run)).some(r => r.changeSetId === change.id && r.changeSetDigest === digest && Date.parse(r.expiresAt) > Date.parse(p.now()))) throw failure('review_not_allowed', 'not_current')
    await p.assertContext(run)
    return { run, change }
  }
  async function cancelCodingChangeReview(input: { codingRunId: string; reviewId: string }): Promise<CodingChangeReview> {
    const review = (await history().listCodingChangeReviews(input.codingRunId)).find(r => r.id === input.reviewId)
    if (!review) throw failure('review_not_allowed', 'not_current')
    if (review.status !== 'running') return review
    const cancelled = await saveReview({ ...review, status: 'cancelled', completedAt: p.now() })
    await p.executor.cancelAuxiliary?.(input.codingRunId)
    return cancelled
  }
  async function cancelReviews(codingRunId: string) {
    if (!p.store.listCodingChangeReviews) return
    for (const review of await p.store.listCodingChangeReviews(codingRunId)) if (review.status === 'running') await cancelCodingChangeReview({ codingRunId, reviewId: review.id })
  }
  async function startCodingChangeReview(input: { codingRunId: string; changeSetId: string; changeSetDigest: string }, trigger: 'automatic' | 'manual' = 'manual'): Promise<CodingChangeReview> {
    const key = `${input.codingRunId}:${input.changeSetId}`
    if (reviewsStarting.has(key)) throw failure('review_not_allowed', 'running')
    reviewsStarting.add(key)
    let review: CodingChangeReview, run: CodingAgentRun, change: CodingChangeSet
    try {
      ({ run, change } = await reviewCurrent(input.codingRunId, input.changeSetId, input.changeSetDigest))
      const prior = (await history().listCodingChangeReviews(run.id)).filter(r => r.changeSetId === change.id)
      if (prior.some(r => r.status === 'running')) throw failure('review_not_allowed', 'running')
      if (prior.filter(r => r.trigger === trigger).length >= (trigger === 'automatic' ? 1 : 2)) throw failure('review_not_allowed', trigger === 'automatic' ? 'already_reviewed' : 'manual_limit')
      if (trigger === 'manual') await p.budget(run, 1, run.requestedBy)
      await reviewCurrent(run.id, change.id, change.changeSetDigest)
      review = await saveReview({ id: p.id('change-review'), stateVersion: 1, codingRunId: run.id, runId: run.runId, nodeId: run.nodeId, projectId: run.projectId,
        changeSetId: change.id, changeSetDigest: change.changeSetDigest, status: 'running', trigger, providerId: p.executor.providerId, model: p.executor.modelId ?? p.executor.providerId, startedAt: p.now(), findings: [], levelsKnown: true, redacted: true })
    } finally { reviewsStarting.delete(key) }
    const assertCurrent = async () => {
      await reviewCurrent(run.id, change.id, change.changeSetDigest)
      if ((await history().listCodingChangeReviews(run.id)).find(r => r.id === review.id)?.status !== 'running') throw failure('review_cancelled', '自检已停止。')
    }
    // The review is advisory. Publishing its durable running record never delays approval.
    void (async () => {
      try {
        const view = buildChangeSetDiffView(verifyCodingChangeSetDisplay(change))
        const result = await p.executor.reviewChangeSet!({ codingRun: run, changeSet: change, view, brief: run.prompt, assertContextCurrent: assertCurrent, reportProviderCall: p.report(run) })
        await assertCurrent()
        await saveReview({ ...review, findings: result.findings, levelsKnown: result.levelsKnown, status: 'completed', completedAt: p.now() })
      } catch (error) {
        const current = (await history().listCodingChangeReviews(run.id)).find(r => r.id === review.id)
        if (current?.status === 'running') await saveReview({ ...current, status: 'failed', completedAt: p.now(), failure: { code: error instanceof Error && /invalid_model_output/u.test(error.message) ? 'invalid_model_output' : 'review_failed' } })
      }
    })().catch(() => { p.publish(run.runId) })
    return review
  }
  function autoReview(run: CodingAgentRun) {
    if (!p.autoReview || !run.changeSetId || !p.executor.reviewChangeSet) return
    void (async () => {
      const change = await history().getCodingChangeSet(run.changeSetId!)
      if (change?.phase === 'initial') await startCodingChangeReview({ codingRunId: run.id, changeSetId: change.id, changeSetDigest: change.changeSetDigest }, 'automatic')
    })().catch(() => undefined)
  }
  async function restore(codingRunId: string, requestId: string, reason: string): Promise<CodingAgentRun> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await p.findRun(codingRunId)
      if (!isActiveCodingAgentRunStatus(current.status)) throw failure('revise_run_ended', current.status)
      if (current.revisionInFlight?.previousRequestId !== requestId) throw failure('revise_state_changed', '记录已经更新。')
      const requests = await p.store.listCodingPermissionRequests(current.id), request = requests.find(r => r.id === requestId)
      if (!request || request.status === 'expired' || Date.parse(request.expiresAt) <= Date.parse(p.now())) {
        await p.expire(current.id)
        throw failure('revise_failed_expired', '原改动的批准期限已过，这次开发已结束。')
      }
      if (request.status !== 'pending') throw failure('revise_state_changed', '原请求已结束。')
      const result = await p.commit({ expectedRun: current, expectedPendingPermissionRequestIds: requests.filter(r => r.status === 'pending').map(r => r.id), expectedPermissionRequests: [request], run: { ...clearRevision(current), status: 'waiting_permission', summary: reason } })
      if (result.committed) { p.publish(result.run.runId); return result.run }
    }
    throw failure('revise_state_changed', '记录在保存时一直在变化，请点停止后重试。')
  }
  async function cancelCodingRevision(input: { codingRunId: string }): Promise<CodingAgentRun> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await p.findRun(input.codingRunId)
      if (!current.revisionInFlight || !isActiveCodingAgentRunStatus(current.status)) return current
      if (!revisionsInProgress.has(current.id)) return restore(current.id, current.revisionInFlight.previousRequestId, '已停止生成新版本，原改动仍可查看和批准。')
      if (current.revisionInFlight.stopRequestedAt) return current
      const result = await p.commit({ expectedRun: current, expectedPendingPermissionRequestIds: (await pending(current)).map(r => r.id), run: { ...current, revisionInFlight: { ...current.revisionInFlight, stopRequestedAt: p.now() } } })
      if (result.committed) { p.publish(result.run.runId); await p.executor.cancelAuxiliary?.(current.id); return result.run }
    }
    throw failure('revise_state_changed', '记录在保存时一直在变化，请再点一次停止。')
  }
  async function reviseCodingChangeSet(input: ReviseCodingChangeSetInput) {
    if (!p.executor.reviseChangeSet || !p.executor.descriptor.capabilities.includes('feedback_revision')) throw failure('revise_unsupported', '这个执行器还不能按清单修改。')
    const run = await p.findRun(input.codingRunId)
    if (run.revisionInFlight || run.status !== 'waiting_permission' || run.engine !== 'native') throw failure('revise_in_flight', '当前不能生成另一个版本。')
    const request = (await p.store.listCodingPermissionRequests(run.id)).find(r => r.id === input.requestId)
    const change = await history().getCodingChangeSet(input.changeSetId)
    if (!request || request.status !== 'pending' || request.origin !== 'coding_executor' || request.permission !== 'patch' || request.changeSetId !== input.changeSetId || request.changeSetDigest !== input.changeSetDigest || run.changeSetId !== input.changeSetId || !change || change.changeSetDigest !== input.changeSetDigest || change.codingRunId !== run.id) throw failure('revise_stale', '改动已更新，请重新查看。')
    if (Date.parse(request.expiresAt) <= Date.parse(p.now())) throw failure('revise_expired', '批准期限已过。')
    const workflow = await p.findWorkflow(run.runId)
    if (workflow.currentNodeId !== run.nodeId || workflow.nodes.find(n => n.id === run.nodeId)?.status !== 'running') throw failure('revise_workflow_changed', '任务步骤已经更新。')
    if (!run.managedWorkspaceId) throw failure('revise_workspace_unavailable', '受管工作区已不存在。')
    const workspace = await p.findWorkspace(run.managedWorkspaceId, run.projectId)
    if (workspace.codingRunId !== run.id || workspace.cleanupStatus !== 'active' || workspace.deletedAt) throw failure('revise_workspace_unavailable', '受管工作区已不存在。')
    if ((await history().listCodingChangeSets(run.id)).filter(c => c.revision).length >= 3) throw failure('revise_limit_reached', '这次开发已按清单修改三次。')
    await p.assertContext(run)
    await p.budget(run, change.phase === 'repair' ? 1 : 2, input.requestedBy)
    await cancelReviews(run.id)
    const claimed: CodingAgentRun = { ...run, status: 'running', revisionInFlight: { previousChangeSetId: change.id, previousChangeSetDigest: change.changeSetDigest, previousRequestId: request.id, requestedAt: p.now(), itemCount: input.itemCount }, summary: '正在按修订清单生成新版本。' }
    const claim = await p.commit({ expectedRun: run, expectedWorkflowRun: workflow, expectedPendingPermissionRequestIds: [request.id], expectedPermissionRequests: [request], run: claimed })
    if (!claim.committed) throw failure('revise_stale', '改动已更新，请重新查看。')
    revisionsInProgress.add(run.id); p.schedule(claim.run); p.publish(run.runId)
    try {
      const continuation = await p.continuation(run.id)
      const assertCurrent = async () => {
        const current = await p.findRun(run.id)
        if (!isActiveCodingAgentRunStatus(current.status) || current.revisionInFlight?.previousRequestId !== request.id || current.revisionInFlight.stopRequestedAt) throw failure('revise_stopped', '新版本生成已停止。')
        await p.assertContext(current)
      }
      const result = await p.executor.reviseChangeSet({ requestId: run.id, ...continuation, runtimeContext: { codingRun: claim.run, workspace, project: await p.findProject(run.projectId), previous: { changeSet: change, request, expired: false }, changeRequest: redactSensitiveText(input.changeRequest).value, itemCount: input.itemCount, revisionIndex: (change.revision?.index ?? 0) + 1, now: p.now(), assertContextCurrent: assertCurrent, reportProviderCall: p.report(run) } })
      for (let attempt = 0; attempt < 8; attempt++) {
        await assertCurrent()
        const current = await p.findRun(run.id), requests = await p.store.listCodingPermissionRequests(run.id), previous = requests.find(r => r.id === request.id)
        if (current.revisionInFlight?.stopRequestedAt) throw failure('revise_stopped', '新版本生成已停止。')
        if (!previous || !['pending', 'expired'].includes(previous.status)) throw failure('revise_state_changed', '原请求已结束。')
        const expired = previous.status === 'expired' || Date.parse(previous.expiresAt) <= Date.parse(p.now())
        if (change.phase === 'repair' && expired) throw failure('revise_expired', '修复批准期限已过。')
        const decision = expired ? 'expired' as const : 'superseded' as const
        const turn = parseCodingExecutorTurn({ ...result.turn, events: result.turn.events.map(e => e.type === 'permission_decision' ? { ...e, metadata: { ...e.metadata, decision } } : e) }, { expectedRequestId: run.id, ...continuation })
        const events = (await p.mapEvents(run.id, result.events)).map(e => e.kind === 'permission' ? { ...e, metadata: { ...e.metadata, codingExecutorTurn: turn } } : e)
        const updatedWorkflow = await p.findWorkflow(run.runId)
        if (updatedWorkflow.currentNodeId !== run.nodeId || updatedWorkflow.nodes.find(n => n.id === run.nodeId)?.status !== 'running') throw failure('revise_workflow_changed', '任务步骤已经更新。')
        const committed = await p.commit({ expectedRun: current, expectedWorkflowRun: updatedWorkflow, expectedPendingPermissionRequestIds: requests.filter(r => r.status === 'pending').map(r => r.id), expectedPermissionRequests: [previous],
          run: { ...clearRevision(current), status: 'waiting_permission', changeSetId: result.changeSet.id, summary: '新版本已生成，请查看后决定。' }, changeSets: [result.changeSet], events,
          permissionRequests: [...(previous.status === 'pending' ? [{ ...previous, status: decision }] : []), result.permissionRequest],
          permissionDecisions: previous.status === 'pending' ? [{ id: p.id('coding-permission-decision'), requestId: previous.id, codingRunId: run.id, decidedBy: input.requestedBy, decision, comment: expired ? '生成期间原批准期限已过。' : '已由修订后的改动替代。', decidedAt: p.now(), ...(expired ? {} : { supersededBy: { changeSetId: result.changeSet.id } }) }] : [],
        })
        if (committed.committed) { p.publish(run.runId); autoReview(committed.run); return { codingRun: committed.run, changeSetId: result.changeSet.id, state: await p.store.loadState() } }
      }
      throw failure('commit_conflict', '记录在保存时一直在变化。')
    } catch (error) {
      const current = await p.findRun(run.id)
      const stopped = Boolean(current.revisionInFlight?.stopRequestedAt)
      await restore(run.id, request.id, stopped ? '已停止生成新版本，原改动仍可查看和批准。' : '新版本没有生成，原改动仍可查看和批准。')
      throw failure(stopped ? 'revise_stopped' : 'revise_failed', `${stopped ? '已停止。' : '新版本没有生成。'}原改动已恢复。${error instanceof Error && /commit_conflict/u.test(error.message) ? '记录在保存时一直在变化。' : ''}`)
    } finally { revisionsInProgress.delete(run.id) }
  }
  async function recover(run: CodingAgentRun): Promise<CodingAgentRun | undefined> {
    if (p.store.listCodingChangeReviews) for (const review of await p.store.listCodingChangeReviews(run.id)) if (review.status === 'running') await saveReview({ ...review, status: 'failed', completedAt: p.now(), failure: { code: 'interrupted' } })
    if (!run.revisionInFlight || !isActiveCodingAgentRunStatus(run.status) || revisionsInProgress.has(run.id)) return undefined
    return restore(run.id, run.revisionInFlight.previousRequestId, '桌面重启时正在按清单生成新版本，没有生成。原改动已恢复。')
  }
  return { reviseCodingChangeSet, cancelCodingRevision, startCodingChangeReview, cancelCodingChangeReview, cancelReviews, autoReview, recover }
}
