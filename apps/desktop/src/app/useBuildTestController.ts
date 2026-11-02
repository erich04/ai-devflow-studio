import { useCallback, useEffect, useRef, useState } from 'react'
import type { CodingPermissionRequest, CodingQuestionReply, LocalExecutionState } from '@ai-devflow/shared'
import type { CodingActionCosts, CodingChangeHistory } from '../../electron/build-test-contract'
import type { DevFlowDesktopApi } from '../desktop-api'
import type { GateButtonId } from './gate-decision/projection'
import type { BuildTestDecisionView } from './build-test/material'
import { claimed, effectiveCodingRun, taskCodingRuns, type BuildTestFacts, type BuildTestWrite } from './build-test/facts'
import { buildChangeVersions } from './build-test/versions'
import { buildTestReports } from './build-test/reports'
import { describeBuildTestError } from './build-test/errors'
import { validateTestCommandSafety } from '@ai-devflow/shared'
import { ipcErrorMessage } from './ipc-error'

export type BuildTestBaseFacts = Omit<BuildTestFacts, 'history' | 'historyError' | 'costs' | 'costsError' | 'writes' | 'stopping' | 'writeResult' | 'budgetContinuations'>
export function useBuildTestController(input: { api: DevFlowDesktopApi | null; base?: BuildTestBaseFacts | undefined; requestedBy?: string | undefined; otherWriteBusy: boolean; runtimeBudgetApprovalId: string; applyState(state: LocalExecutionState): void; reloadReadiness(): unknown; reloadFreshness(): void; selectNode(id: string): void }) {
  const [history, setHistory] = useState<CodingChangeHistory>()
  const [historyError, setHistoryError] = useState<string>()
  const [costs, setCosts] = useState<{ projectId: string; value: CodingActionCosts }>()
  const [costsError, setCostsError] = useState<string>()
  const [writes, setWrites] = useState<BuildTestWrite[]>([])
  const pending = useRef<BuildTestWrite[]>([])
  const [stopping, setStopping] = useState(false)
  const stopLock = useRef(false)
  const [writeResult, setWriteResult] = useState<BuildTestFacts['writeResult']>()
  const [budgetContinuations, setBudgetContinuations] = useState<BuildTestFacts['budgetContinuations']>([])
  const [refresh, setRefresh] = useState(0)
  const runId = input.base?.run.id, projectId = input.base?.run.projectId
  const actualStage = input.base?.run.nodes.find(n => n.id === input.base?.run.currentNodeId)?.stage
  const key = input.base ? input.base.codingPermissionRequests.filter(p => p.runId === runId).map(p => `${p.id}:${p.status}`).join('|') + input.base.codingRuns.filter(r => r.runId === runId).map(r => `${r.id}:${r.status}:${r.revisionInFlight?.previousRequestId ?? ''}`).join('|') : ''
  useEffect(() => {
    let active = true
    if (!runId || !input.api?.getCodingChangeHistory) { setHistory(undefined); return }
    input.api.getCodingChangeHistory({ runId }).then(value => { if (active) { setHistory(value); setHistoryError(undefined) } }).catch(error => { if (active) { setHistory(undefined); setHistoryError(ipcErrorMessage(error, '现在读不到改动内容。')) } })
    return () => { active = false }
  }, [input.api, runId, key, refresh])
  useEffect(() => {
    let active = true
    if (!projectId || !input.api?.getCodingActionCosts) { setCosts(undefined); return }
    input.api.getCodingActionCosts({ projectId }).then(value => { if (active) { setCosts({ projectId, value }); setCostsError(undefined) } }).catch(error => { if (active) { setCosts(undefined); setCostsError(ipcErrorMessage(error, '暂时读不到费用估计。')) } })
    return () => { active = false }
  }, [input.api, projectId, key, refresh])
  useEffect(() => {
    if (!projectId || !['build', 'test'].includes(actualStage ?? '')) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const dispose = input.api?.onModelBudgetUpdated?.(() => { if (!timer) timer = setTimeout(() => { timer = undefined; setRefresh(n => n + 1) }, 1000) })
    return () => { clearTimeout(timer); dispose?.() }
  }, [input.api, projectId, actualStage])
  useEffect(() => input.api?.onCodingChangeHistoryUpdated?.(event => { if (event.runId === runId) setRefresh(n => n + 1) }), [input.api, runId])
  useEffect(() => { const reload = () => setRefresh(n => n + 1); window.addEventListener('focus', reload); return () => window.removeEventListener('focus', reload) }, [])
  useEffect(() => {
    let active = true
    void input.api?.modelBudgetContinuation?.({ action: 'list' }).then(cards => { if (active) setBudgetContinuations(cards) }).catch(() => undefined)
    const dispose = input.api?.onModelBudgetContinuationUpdated?.(setBudgetContinuations)
    return () => { active = false; dispose?.() }
  }, [input.api])
  useEffect(() => setWriteResult(undefined), [key, runId])
  const facts: BuildTestFacts | undefined = input.base ? { ...input.base, history: history?.runId === runId ? history : undefined, historyError, costs: costs && costs.projectId === projectId ? costs.value : undefined, costsError, writes, stopping, writeResult, budgetContinuations } : undefined
  const current = useRef({ ...input, facts }); current.current = { ...input, facts }
  const reload = useCallback(() => { setRefresh(n => n + 1); current.current.reloadReadiness(); current.current.reloadFreshness() }, [])
  async function write(action: string, target: string, claim: BuildTestWrite['claim'], execute: (api: DevFlowDesktopApi, f: BuildTestFacts) => Promise<void>, allowOther = true) {
    const { api, facts: f, otherWriteBusy } = current.current
    if (!api || !f) { setWriteResult({ tone: 'error', text: '请在桌面应用中操作。' }); return false }
    if (pending.current.some(w => w.target === target || !claimed(w, f)) || (!allowOther && otherWriteBusy)) { setWriteResult({ tone: 'warn', text: '另一个操作正在进行，请稍候。' }); return false }
    const token: BuildTestWrite = { id: crypto.randomUUID(), action, target, startedAt: new Date().toISOString(), ...(claim ? { claim } : {}) }
    pending.current = [...pending.current, token]; setWrites(pending.current); setWriteResult(undefined)
    try { await execute(api, f); return true }
    catch (error) { setWriteResult(describeBuildTestError(error, action)); return false }
    finally { pending.current = pending.current.filter(w => w.id !== token.id); setWrites(pending.current); reload() }
  }
  async function sync(api: DevFlowDesktopApi) { current.current.applyState(await api.loadState()) }
  function expected(p: CodingPermissionRequest) { return { runId: p.runId, nodeId: p.nodeId, expiresAt: p.expiresAt, ...(p.changeSetId ? { changeSetId: p.changeSetId, changeSetDigest: p.changeSetDigest! } : {}), ...(p.diffArtifactId ? { diffArtifactId: p.diffArtifactId, diffSourceDigest: p.diffSourceDigest! } : {}) } }
  async function permission(p: CodingPermissionRequest, decision: 'approved' | 'rejected', scope: 'once' | 'session' = 'once', reason = '') {
    return write(decision === 'approved' ? '批准请求' : '拒绝请求', p.id, { kind: 'permission', requestId: p.id }, async (api, f) => {
      if (!f.canDecide || !current.current.requestedBy) throw new Error('请先完成当前项目的团队配对。')
      await api.replyCodingPermission({ codingRunId: p.codingRunId, requestId: p.id, decidedBy: current.current.requestedBy, decision, comment: reason, scope, expected: expected(p) }); await sync(api)
    }, true)
  }
  async function dispatch(id: GateButtonId, view: BuildTestDecisionView, extra?: { reason?: string }) {
    const f = current.current.facts
    if (!f || !view.bar.buttons.some(b => b.id === id && b.enabled)) return false
    const run = effectiveCodingRun(f), request = f.codingPermissionRequests.find(p => p.codingRunId === run?.id && p.status === 'pending')
    if (['approveChange', 'approveWithout', 'approveRepair', 'rejectChange', 'rejectRepair'].includes(id) && request) return permission(request, id.startsWith('reject') ? 'rejected' : 'approved', 'once', extra?.reason ?? (view.bar.list.count ? `修订清单中 ${view.bar.list.count} 项未提交，直接批准当前改动。` : ''))
    if (id === 'startCoding' || id === 'redevelop' || id === 'refix') return write(id === 'refix' ? '重新修复' : id === 'redevelop' ? '重新开发' : '开始开发', `start:${f.run.id}`, { kind: 'start', existing: taskCodingRuns(f).map(r => r.id) }, async (api, latest) => {
      const previous = effectiveCodingRun(latest), failed = buildTestReports(latest).filter(r => r.report.codingRunId === previous?.id && r.report.evidence.status !== 'passed').at(-1)
      const change = buildChangeVersions(latest).filter(v => v.codingRunId === previous?.id).at(-1)
      const reason = [...latest.codingPermissionDecisions].reverse().find(d => d.requestId === change?.request.id && d.decision === 'rejected' && !d.decidedBy.startsWith('devflow-'))?.comment
      const opaqueCount = taskCodingRuns(latest).filter(r => r.engine === 'opencode-http').length
      if (!current.current.requestedBy) throw new Error('请先完成当前项目的团队配对。')
      const result = await api.runCodingAgent({ runId: latest.run.id, nodeId: latest.buildNode.id, projectId: latest.run.projectId, requestedBy: current.current.requestedBy, userInstruction: `Implement the approved design for ${latest.run.title}.`, ...(id !== 'startCoding' && previous ? { context: { kind: id, previousCodingRunId: previous.id, ...(change?.record ? { changeSetId: change.id } : {}), ...(id === 'refix' && failed ? { failedTestEvidenceId: failed.id } : {}), ...(reason ? { reason } : {}) } } : {}), ...(opaqueCount >= 3 ? { additionalAttemptAfterCount: opaqueCount } : {}), ...(current.current.runtimeBudgetApprovalId.trim() ? { runtimeBudgetApprovalId: current.current.runtimeBudgetApprovalId.trim() } : {}) }); current.current.applyState(result.state)
    }, false)
    if ((id === 'reviseChange' || id === 'reviseRepair') && run && request?.changeSetId) return write('提交修订清单', request.id, { kind: 'revision', codingRunId: run.id, requestId: request.id }, async api => {
      if (!api.reviseCodingChangeSet || !current.current.requestedBy) throw new Error('当前桌面版本不支持修改，请重新启动。')
      const result = await api.reviseCodingChangeSet({ codingRunId: run.id, requestId: request.id, changeSetId: request.changeSetId!, changeSetDigest: request.changeSetDigest!, changeRequest: view.bar.list.composedText, itemCount: view.bar.list.count ?? 0, requestedBy: current.current.requestedBy }); current.current.applyState(result.state)
    })
    if (id === 'rerunSelfCheck' && run && request?.changeSetId) return write('重新自检', `review:${request.id}`, undefined, async api => { if (!api.startCodingChangeReview) throw new Error('当前桌面版本不支持自检。'); await api.startCodingChangeReview({ codingRunId: run.id, changeSetId: request.changeSetId!, changeSetDigest: request.changeSetDigest! }) })
    if (id === 'runTests' || id === 'rerunTests') return write(id, `tests:${f.run.id}`, undefined, async api => { if (validateTestCommandSafety(f.testCommand ?? '').level === 'blocked') throw new Error('[test_command_unsafe] Saved test command is blocked'); const result = await api.runProjectTests({ projectId: f.run.projectId, runId: f.run.id, nodeId: f.testNode.id, completeOnPass: false }); current.current.applyState(result.state) })
    if (id === 'confirmEvidence') return write('确认测试证据', `confirm:${f.run.id}`, undefined, async api => {
      const report = buildTestReports(f).at(-1)
      if (!api.confirmTestEvidence || !report) throw new Error('请重新读取测试证据。')
      const result = await api.confirmTestEvidence({ runId: f.run.id, nodeId: f.testNode.id, evidenceId: report.id, expectedRunUpdatedAt: f.run.updatedAt }); current.current.applyState(result.state)
      if (current.current.facts?.run.id === f.run.id) current.current.selectNode(result.run.currentNodeId)
    })
    return false
  }
  async function stop(target: 'coding' | 'revision' | 'review') {
    const { api, facts: f } = current.current, run = f && effectiveCodingRun(f)
    if (!api || !f || !run || stopLock.current) return
    stopLock.current = true; setStopping(true)
    try {
      if (target === 'revision') { if (!api.cancelCodingRevision) throw new Error('当前桌面版本不支持停止修订。'); await api.cancelCodingRevision({ codingRunId: run.id }) }
      else if (target === 'review') { const review = f.history?.reviews.find(r => r.codingRunId === run.id && r.status === 'running'); if (review && api.cancelCodingChangeReview) await api.cancelCodingChangeReview({ codingRunId: run.id, reviewId: review.id }) }
      else await api.cancelCodingAgentRun({ codingRunId: run.id })
      await sync(api)
    } catch (error) { setWriteResult(describeBuildTestError(error, target === 'review' ? '停止自检' : '停止')) }
    finally { stopLock.current = false; setStopping(false); reload() }
  }
  return { facts, dispatch, permission, stop, reload,
    renew: (p: CodingPermissionRequest) => write('重新请求审批', p.id, undefined, async api => { await api.renewCodingPermission({ requestId: p.id, codingRunId: p.codingRunId, decidedBy: current.current.requestedBy ?? '' }); await sync(api) }, true),
    question: (codingRunId: string, requestId: string, revision: string, reply: CodingQuestionReply) => write('提交回答', requestId, { kind: 'question', codingRunId, requestId }, async api => { await api.replyCodingQuestion({ codingRunId, requestId, revision, reply }); await sync(api) }, true),
  }
}
export type BuildTestController = ReturnType<typeof useBuildTestController>
