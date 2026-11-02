import { testEvidenceFreshnessRule } from '@ai-devflow/shared'
import { describeCodingRunFailure } from './errors'
import { composeRevisionText, measureRevisionText, numberItems } from '../gate-decision/revision-list'
import type { GateButton, GateButtonId, GateNote, ListView } from '../gate-decision/projection'
import { claimed, displayCurrentStage, effectiveCodingRun, isActive, resolveBuildTestPage, taskCodingRuns, type BuildTestFacts } from './facts'
import { buildChangeVersions } from './versions'
import { buildTestReports } from './reports'
import { buildMaterial, type BuildTestDecisionView } from './material'
import { buildCards } from './cards'
import { costText, deadlineMeta, executorText, formatDecisionTime, versionSpacing, countsText } from './copy'

const readyCopy: Record<string, string> = { executor_unconfigured: '还没有选择开发用的执行器。', provider_unavailable: '开发用的模型还不能用：没有选择模型或凭据。', model_unavailable: '开发用的模型还不能用：没有选择模型或凭据。', profile_unavailable: '开发用的模型还不能用：没有选择模型或凭据。', auth_unavailable: '开发用的模型还不能用：没有选择模型或凭据。', binary_missing: '本机的 OpenCode 不能用（没找到或版本不对）。', version_incompatible: '本机的 OpenCode 不能用（没找到或版本不对）。', engine_unavailable: '本机的 OpenCode 不能用（没找到或版本不对）。', capability_unavailable: '所选执行器缺少开发需要的能力。', test_command_missing: '这个项目还没有保存测试命令。', git_unavailable: '项目目录不是可用的 Git 仓库。', team_project_unpaired: '当前项目还没有完成团队配对。', budget_policy_missing: '团队项目还没有设置预算。', budget_fetch_failed: '现在核对不了预算，请检查团队连接后再试。', budget_evaluation_failed: '现在核对不了预算，请检查团队连接后再试。', budget_not_checked: '现在核对不了预算，请检查团队连接后再试。', budget_not_evaluated: '现在核对不了预算，请检查团队连接后再试。', budget_blocked: '预算不够，不能开始开发。', active_run: '这个项目有另一次开发正在进行。', permission_pending: '有一个权限请求还没处理。', wrong_workflow_node: '流程当前不在开发步骤。' }
const note = (text: string, tone: GateNote['tone'] = 'neutral'): GateNote => ({ text, tone })
export function projectBuildTestDecision(input: { facts: BuildTestFacts; stage: 'build' | 'test'; reading?: string | undefined }): BuildTestDecisionView {
  const { facts: f, stage, reading } = input, mode = resolveBuildTestPage(f, stage, reading), history = mode === 'history'
  const versions = buildChangeVersions(f), run = effectiveCodingRun(f), own = versions.filter(v => v.codingRunId === run?.id), current = own.at(-1)
  const reports = buildTestReports(f), latest = reports.at(-1), failed = reports.filter(r => r.report.codingRunId === run?.id && r.report.evidence.status !== 'passed').at(-1)
  const pending = f.codingPermissionRequests.find(p => p.codingRunId === run?.id && p.status === 'pending')
  const approved = [...own].reverse().find(v => v.request.status === 'approved')
  const initialApproved = [...own].reverse().find(v => !v.repair && v.request.status === 'approved')
  const review = f.history?.reviews.filter(r => r.changeSetId === current?.id).at(-1)
  const label = current?.label ?? `改动 v${versions.length + 1}`, nextLabel = `改动 v${versions.length + 1}`
  const { material, shown, anchors } = buildMaterial(f, stage, reading)
  const cards = buildCards(f, shown, material, anchors, history, stage)
  const numbers = (reviewId: string, index: number) => cards.find(c => c.finding?.reviewId === reviewId && c.finding.index === index)?.number ?? index + 1
  const items = numberItems(f.list?.items ?? [], [], review?.id, numbers)
  const composedText = composeRevisionText(items, { kind: 'change', version: label }), measure = measureRevisionText(composedText)
  const listActive = !history && f.canDecide && pending?.changeSetId !== undefined && Date.parse(pending.expiresAt) > Date.parse(f.now) && mode === 'current' && !run?.revisionInFlight && isActive(run)
  const list: ListView = { toggleLabel: pending?.changeSetId || (shown?.record && f.list) ? `修订清单${items.length ? `（${items.length} 项）` : ''}` : '', toggleEnabled: Boolean(shown?.record && (pending?.changeSetId || history && f.list)), count: items.length, header: `对${label} 的修改 · 提交后生成${nextLabel}`, emptyText: '还没有修改。采纳 AI 自检意见，或点「＋ 添加其他修改」；右侧答疑里的建议也可以加入。', items: items.map(i => ({ id: i.id, number: i.number, source: i.source, label: i.label, text: i.text, detail: i.label, ...(i.item?.chat ? { messageId: i.item.chat.messageId } : {}), ...(i.item?.finding ? { cardId: `finding:${i.item.finding.reviewId}:${i.item.finding.index}` } : {}) })), actionable: listActive, addLabel: '＋ 添加其他修改', addPlaceholder: '例如：错误信息沿用现有的写法', composedText, composedLength: measure.length, ...(measure.reason ? { overflowReason: measure.reason } : {}), proposalIds: [], ...(run?.revisionInFlight ? { submittedText: f.list?.submitted?.text ?? composedText, readOnlyReason: '正在按清单生成，暂时不能修改。' } : {}) }
  const bar: BuildTestDecisionView['bar'] = { row: 'B3', mode: 'decide', title: '', notes: [], buttons: [], costLines: [], list, meta: { changeReviewModel: false, freshness: `数据更新于 ${formatDecisionTime(f.observedAt, f.now)}`, technical: [{ label: '任务', value: f.run.id }, ...(run ? [{ label: '开发运行', value: run.id }, { label: '执行记录摘要', value: run.summary }] : []), ...(current ? [{ label: '改动', value: current.id }, { label: '请求', value: current.request.id }] : [])] } }
  const view: BuildTestDecisionView = { bar, margin: { cards, navigationOrder: cards.map(c => c.id) }, material, listActionable: listActive, identity: { runId: f.run.id, ...(shown ? { request: { ...shown.request } } : {}), ...(latest ? { evidence: { id: latest.id, runUpdatedAt: f.run.updatedAt } } : {}) } }
  const exec = executorText(f.costs), start = costText(f.costs, 'start')
  const add = (id: GateButtonId, text: string, primary: boolean, consequence?: string): GateButton => {
    const button: GateButton = { id, label: versionSpacing(text), primary, enabled: true }
    bar.buttons.push(button)
    if (consequence) bar.costLines.push({ kind: 'action', buttonId: id, text: versionSpacing(consequence) })
    return button
  }
  const stop = (target: 'coding' | 'revision', text: string) => { bar.stop = { target, ...(f.stopping ? { busy: true } : {}) }; bar.costLines.push({ kind: 'run', text }); bar.mode = 'running' }
  const startButton = (id: 'startCoding' | 'redevelop' | 'refix', text: string) => {
    const button = add(id, text, true, `${exec} · ${start}${id === 'startCoding' ? '（写改动和 AI 自检；测试没通过时的一次自动修复也算在内）· 在受管工作区里写，你的项目目录不会被改' : ' · 新开一次开发 · 从新的受管工作区开始，上次的理由和没通过的原因会一起交给 AI'}`)
    if (!f.readiness) { button.enabled = false; button.disabledReason = f.readinessError ? '现在检查不了能不能开始开发。' : '正在检查能不能开始开发…'; if (f.readinessError) bar.notes.push({ ...note('✕ 现在检查不了能不能开始开发。', 'block'), link: { action: 'reload', label: '重新读取' } }) }
    else for (const check of f.readiness.checks.filter(c => c.status === 'blocked')) {
      button.enabled = false; button.disabledReason = '先处理上面标 ✕ 的问题。'
      const action = ['test_command_missing', 'git_unavailable'].includes(check.code) ? 'openProjectSettings' : check.code.startsWith('team_') || ['budget_fetch_failed', 'budget_evaluation_failed', 'budget_not_checked', 'budget_not_evaluated'].includes(check.code) ? 'openTeamSettings' : 'openModelSettings'
      bar.notes.push({ text: `✕ ${readyCopy[check.code] ?? '当前还不能开始开发。'}`, tone: 'block', technical: check.message, ...(['active_run', 'permission_pending', 'wrong_workflow_node'].includes(check.code) ? {} : { link: action === 'openModelSettings' ? { action, label: '打开模型与执行方式设置' } : { action, label: action === 'openProjectSettings' ? '打开本地项目设置' : '打开团队连接设置' } }) })
    }
    if (run?.engine === 'opencode-http' && taskCodingRuns(f).filter(r => r.engine === 'opencode-http').length >= 3) button.confirmBefore = 'OpenCode 在这个开发步骤上的开发次数已到上限。再开一次要你明确同意：会再调用模型，费用未知；之前的记录都保留。再点一次确认。'
  }
  const decide = (repair: boolean) => {
    bar.row = repair ? 'T5' : pending?.origin === 'change_acceptance' ? 'B10' : 'B8'; bar.title = `${label} · 你的决定`
    if (pending) bar.meta.deadline = deadlineMeta(pending.expiresAt, f.now, repair ? '修复' : '改动', start)
    if (repair) {
      bar.notes.push(note(`${approved?.label ?? '上一版改动'} 已批准。${failed?.report.label ?? '上一次测试'} 没通过，DevFlow Native 自动修了一次，就是下面的修复。`, 'ok'), note('✕ 测试通过前，不能进入 PR 交付。', 'block'))
      const paths = current?.view?.files.map(file => file.path) ?? [], unchanged = approved?.view?.files.filter(file => !paths.includes(file.path)).map(file => file.path) ?? []
      if (paths.length) bar.notes.push({ ...note(paths.length > 3 ? `修复改 ${paths.length} 个文件（${countsText(current!.view!.additions, current!.view!.deletions)} 行）。` : `修复${unchanged.length ? '只' : ''}改 ${paths.join('、')}（${countsText(current!.view!.additions, current!.view!.deletions)} 行）${unchanged.length ? `，不改 ${unchanged.slice(0, 3).join('、')}${unchanged.length > 3 ? '等文件' : ''}` : ''}。`), raw: [...paths, ...unchanged] })
    }
    if (!f.canDecide) { bar.meta.role = '需要先完成当前项目的团队配对才能批准'; bar.notes.push({ ...note('需要先完成当前项目的团队配对才能批准'), link: { action: 'openTeamSettings', label: '打开团队连接设置' } }); return }
    bar.meta.role = '你可以批准或拒绝'
    const revised = f.history?.changeSets.filter(c => c.codingRunId === run?.id && c.revision).length ?? 0
    if (items.length && pending?.changeSetId && revised < 3) {
      const button = add(repair ? 'reviseRepair' : 'reviseChange', `按清单修改，生成${nextLabel}（${items.length} 项）`, true, `${exec} · ${costText(f.costs, repair ? 'repairRevise' : 'revise')}${repair ? ' · 修复的批准期限不会延长' : `（生成${nextLabel} 和 AI 自检）· 这次开发和受管工作区不变`}`)
      if (measure.over || items.length > 100) { button.enabled = false; button.disabledReason = measure.reason ?? '修订清单最多 100 项。' }
    } else if (revised >= 3) bar.notes.push(note('这次开发已经按清单修改了 3 次，不能再按清单修改；可以批准、拒绝或新开一次开发。'))
    const approval = add(repair ? 'approveRepair' : items.length ? 'approveWithout' : 'approveChange', repair ? '批准修复，重新测试' : pending?.origin === 'change_acceptance' ? `批准${label}` : items.length ? `不修改，批准${label}` : `批准${label}，进入测试`, !items.length, repair ? '重新测试不调用模型' : pending?.origin === 'change_acceptance' ? '不调用模型；批准后进入下一步' : `测试本身不花钱；没通过时会自动修一次（${exec} · ${costText(f.costs, 'repair')}）`)
    if (items.length) approval.confirmBefore = `清单里还有 ${items.length} 项没有提交。这次会直接批准当前改动，再点一次确认。`
    if (!current || (pending?.changeSetId && (current.record?.verified !== true || f.preview?.id !== pending.changeSetId || f.preview?.codingRunId !== pending.codingRunId || f.preview?.changeSetDigest !== pending.changeSetDigest || f.preview?.expiresAt !== pending.expiresAt))) { approval.enabled = false; approval.disabledReason = current ? 'DevFlow 核对不了这份改动的显示内容，不能在这里批准。' : '改动内容还没读到，不能批准。' }
    const reject = add(repair ? 'rejectRepair' : 'rejectChange', repair ? '拒绝修复' : '拒绝改动', false, `拒绝后${label} 不会应用；重做要新开一次开发（${exec} · ${start}）`)
    reject.danger = true; reject.reason = { label: `拒绝${label} 的理由`, placeholder: repair ? '例如：只补 1 条就够，不要改测试标题' : '例如：错误信息要和现有代码一致，换个写法', confirmLabel: '确认拒绝', cancelLabel: '取消' }
    if (!repair && pending?.changeSetId) {
      if (review?.status === 'running') bar.notes.push({ ...note(`AI 正在自检${label}，意见会显示在右侧；你可以不等它直接决定。`), link: { action: 'stopSelfCheck', label: f.stopping ? '正在停止…' : '停止自检', busy: Boolean(f.stopping) } })
      else if (review?.status === 'failed' || review?.status === 'cancelled' || !review) {
        bar.notes.push(note(review?.status === 'cancelled' ? 'AI 自检已停止。' : 'AI 自检没有完成。', 'warn'))
        if ((f.history?.reviews.filter(r => r.changeSetId === current?.id && r.trigger === 'manual').length ?? 0) < 2) add('rerunSelfCheck', '重新自检', false, `${exec} · ${costText(f.costs, 'selfCheck')}`)
        else bar.notes.push(note('这份改动不能再重新自检。'))
      }
    }
    for (const button of bar.buttons) {
      const action = button.id === 'reviseChange' ? 'revise' : button.id === 'reviseRepair' ? 'repairRevise' : button.id === 'rerunSelfCheck' ? 'selfCheck' : undefined
      const budget = action && f.costs?.budget[action]
      if (budget?.blocks) { button.enabled = false; button.disabledReason = '先处理上面标 ✕ 的问题。'; bar.notes.push({ ...note(`✕ ${budget.status === 'unavailable' ? '现在核对不了预算' : '预算不够'}，不能${button.id === 'rerunSelfCheck' ? '重新自检' : '按清单修改'}。`, 'block'), link: { action: 'openTeamSettings', label: '打开团队连接设置' } }) }
    }
  }
  if (history) { bar.row = stage === 'build' ? 'B2' : 'T2'; bar.mode = 'read-only'; bar.title = material.header; add('returnToCurrent', `返回${current?.label ?? '当前测试报告'}`, true); list.actionable = false }
  else if (mode === 'finished') {
    bar.row = stage === 'build' ? 'B1' : 'T1'; bar.mode = 'finished'; list.actionable = false
    const decision = f.codingPermissionDecisions.filter(d => d.requestId === initialApproved?.request.id && d.decision === 'approved').at(-1)
    const confirmation = f.events?.filter(e => e.runId === f.run.id && e.nodeId === f.testNode.id && e.kind === 'test_result').at(-1)
    const actorId = stage === 'build' ? decision?.decidedBy : typeof confirmation?.metadata?.confirmedBy === 'string' ? confirmation.metadata.confirmedBy : undefined
    const at = stage === 'build' ? decision?.decidedAt : confirmation?.timestamp
    const member = f.members?.find(m => m.id === actorId)
    bar.title = stage === 'build' ? initialApproved ? `${initialApproved.label} 已批准` : '开发实现已完成' : '测试证据已确认'
    const who = member ? `${stage === 'build' ? '批准人' : '确认人'} ${member.name}（${member.role === 'owner' ? 'Owner' : member.role === 'lead' ? 'Lead' : 'Member'}）` : stage === 'build' ? '已批准' : '已确认'
    bar.notes.push(note(`✓ ${who}${at ? ` · ${formatDecisionTime(at, f.now)}` : ''}`, 'ok'))
    if (stage === 'test') bar.notes.push(note(`用的是${latest?.report.label ?? '通过的测试报告'}（${run?.retryOf?.kind === 'refix' ? '重新修复后通过' : own.some(v => v.repair && v.request.status === 'approved') ? '修复 1 次后通过' : '一次通过'}）。`))
    if (actorId) bar.meta.technical.push({ label: stage === 'build' ? '批准人' : '确认人', value: actorId })
    bar.meta.stepNote = '这一步已完成；浏览这里不会改变实际进度。'
  }
  else if (run?.revisionInFlight) { bar.row = 'B9'; bar.title = `正在生成${nextLabel}`; stop('revision', `${exec} · ${costText(f.costs, current?.repair ? 'repairRevise' : 'revise')}`); bar.notes.push(note(run.revisionInFlight.previousExpired ? `${label} 已经过期；生成没成功时这次开发结束。` : `${label} 在生成期间不能批准或拒绝。生成没成功时，原改动还能在期限内批准。`)) }
  else if (stage === 'build') {
    if (!run) { bar.row = 'B3'; bar.title = '还没开始开发'; bar.notes.push(note(`按${f.designLabel} 写改动。写好后先给你看，你批准后才会应用和测试。`)); startButton('startCoding', '开始开发') }
    else if (run.status === 'completed') { bar.row = 'B1'; bar.mode = 'finished'; bar.title = '开发实现已完成'; bar.notes.push(note('可以在执行记录里查看这次开发。')) }
    else if (run.status === 'waiting_input') { bar.row = 'B5'; bar.title = `开发暂停：等你回答问题 ${cards.find(c => c.kind === 'coding_question' && c.actionable)?.number ?? 1}`; stop('coding', `${exec} · ${start}`); bar.mode = 'paused'; bar.notes.push(note('在「问题」卡片或标记上回答。')); if (run.question) bar.meta.deadline = deadlineMeta(run.question.expiresAt, f.now, '问题', start) }
    else if (run.permissionPause) { bar.row = 'B7'; bar.title = `开发暂停：权限请求 ${cards.find(c => c.permission?.id === run.permissionPause?.requestId)?.number ?? 1} 已过期`; stop('coding', `${exec} · ${start}`); bar.mode = 'paused'; bar.notes.push(note('在权限请求卡片上重新核验并请求审批。')) }
    else if (pending && !pending.changeSetId && pending.origin !== 'change_acceptance') { bar.row = 'B6'; bar.title = `开发暂停：等你决定权限请求 ${cards.find(c => c.permission?.id === pending.id)?.number ?? 1}`; stop('coding', `${exec} · ${start}`); bar.mode = 'paused'; bar.notes.push(note('在权限请求卡片或标记上允许或拒绝。')); bar.meta.deadline = deadlineMeta(pending.expiresAt, f.now, run.engine === 'opencode-http' && (!pending.origin || pending.origin === 'coding_executor') ? '暂停权限' : '权限', start) }
    else if (pending && Date.parse(pending.expiresAt) > Date.parse(f.now)) decide(false)
    else if (isActive(run) && !pending) { bar.row = 'B4'; bar.title = run.retryOf?.kind === 'refix' ? run.retryOf.hasReason ? '正在按你的理由重新修复' : '正在生成修复' : run.retryOf ? `正在重新开发 · ${nextLabel}` : `正在开发 · ${nextLabel}`; stop('coding', `${exec} · ${start}`) }
    else {
      bar.row = 'B11'
      const decision = f.codingPermissionDecisions.filter(d => d.requestId === current?.request.id).at(-1)
      bar.title = current?.request.status === 'expired' || pending ? `${label} 已过期` : run.status === 'cancelled' ? '开发已停止' : current?.request.status === 'rejected' ? `${label} 已拒绝` : failed ? '改动没有通过测试' : run.status === 'timed_out' ? '开发超时，已停止' : '开发没有完成'
      bar.notes.push(decision?.comment && !decision.decidedBy.startsWith('devflow-') ? { ...note(`你的理由：${decision.comment}`), raw: [decision.comment] } : note('这次开发已结束，未批准的改动不会应用。'))
      startButton(failed ? 'refix' : 'redevelop', run.status === 'cancelled' && !current ? '重新开始开发' : failed ? '交给 AI 重新修复' : decision?.comment && !decision.decidedBy.startsWith('devflow-') ? '按理由重新开发' : '重新开发')
    }
  } else if (f.writes.some(w => w.action === 'runTests' || w.action === 'rerunTests')) { bar.row = 'T12'; bar.title = `正在运行测试${approved ? ` · 针对${approved.label}` : ''}`; bar.mode = 'running'; bar.notes.push(note('运行保存的测试命令，不调用模型。')) }
  else if (pending?.changeSetId && current?.repair && Date.parse(pending.expiresAt) > Date.parse(f.now)) decide(true)
  else if (isActive(run) && (!pending || Date.parse(pending.expiresAt) > Date.parse(f.now))) {
    bar.row = approved?.repair ? 'T6' : failed ? 'T4' : 'T3'
    bar.title = bar.row === 'T4' ? '正在生成修复' : `正在运行测试${approved ? ` · 针对${approved.label}` : ''}`
    if (approved) bar.notes.push(note(`${approved.label} 已批准`, 'ok'))
    stop('coding', bar.row === 'T4' ? `${exec} · ${costText(f.costs, 'repair')}` : '运行保存的测试命令，不调用模型 · 停止会结束这次开发')
  } else if (latest?.report.evidence.status !== 'passed' && latest || (run && run.status !== 'completed')) {
    bar.row = 'T7'
    const decision = f.codingPermissionDecisions.filter(d => d.requestId === current?.request.id).at(-1)
    const rejected = current?.repair && current.request.status === 'rejected' && decision?.decidedBy !== 'devflow-cancel'
    const expired = current?.repair && (current.request.status === 'expired' || pending && Date.parse(pending.expiresAt) <= Date.parse(f.now))
    const testedApproved = approved && reports.some(r => r.report.codingRunId === run?.id && r.title.includes(`针对${approved.label} ·`))
    const directTest = f.run.currentNodeId === f.testNode.id && latest?.report.evidence.status !== 'passed'
    bar.title = directTest && latest ? `${latest.report.label} · 没通过` : rejected ? `${label} 已拒绝` : expired ? `${label} 已过期` : approved && !testedApproved ? '测试没有完成' : approved?.repair && failed ? '修复后的测试也没通过' : run?.status === 'cancelled' && failed ? '修复已停止' : run?.status === 'failed' && failed && !current?.repair ? '修复没有生成' : '测试没有完成'
    bar.notes.push(note(bar.title === '测试没有完成' ? '✕ 测试没有跑完，不能进入 PR 交付。' : '✕ 测试还没通过，不能进入 PR 交付。', 'block'))
    if (rejected) bar.notes.push(decision?.comment ? { ...note(`你的理由：${decision.comment}`), raw: [decision.comment] } : note('你没有写理由。'))
    if (expired) bar.notes.push(note('过期等于拒绝，这次开发已结束。'))
    if (run?.status === 'cancelled') bar.notes.push(note(current?.repair ? `${label} 没有批准，不会应用。` : failed ? '没有生成修复。' : '你停止了这次开发。'))
    if (f.run.currentNodeId === f.testNode.id) { add('rerunTests', '重新运行测试', true, '在受管工作区运行，不调用模型'); bar.notes.push(note('要改代码需要回到开发步骤，产品还没有从这里退回的操作。')) }
    else startButton(failed ? 'refix' : 'redevelop', rejected && decision?.comment ? '按理由重新修复' : failed ? '交给 AI 重新修复' : '重新开发')
  } else if (!latest) { bar.row = 'T11'; bar.title = '还没有测试报告'; add('runTests', '运行测试', true, '运行保存的测试命令，不调用模型') }
  else {
    const freshness = f.freshness.states[latest.id]
    const freshnessRule = freshness ? testEvidenceFreshnessRule(freshness) : undefined
    bar.row = freshness === 'stale' ? 'T9' : freshness === 'unavailable' || freshness === 'unrecorded' ? 'T10' : 'T8'
    bar.title = `${latest.report.label} · 你的决定`
    if (bar.row !== 'T8') { bar.notes.push(note(bar.row === 'T9' ? '✕ 测试证据已过期，先重新测试才能进入 PR 交付。' : '✕ 无法核实测试证据是否对应当前代码，先重新测试才能进入 PR 交付。', 'block')); add('rerunTests', '重新运行测试', true, '在受管工作区运行，不调用模型') }
    else if (freshness === 'current') bar.notes.push(note(`✓ ${run?.retryOf?.kind === 'refix' ? '重新修复后通过' : own.some(v => v.repair && v.request.status === 'approved') ? '修复 1 次后通过' : '一次通过'} · ${latest.result}`, 'ok'))
    const confirm = add('confirmEvidence', '确认测试证据，进入 PR 交付', bar.row === 'T8', '不调用模型')
    if (!freshnessRule || freshnessRule.blocks) { confirm.enabled = false; confirm.disabledReason = freshness ? '先重新运行测试' : f.freshness.status === 'failed' ? '现在核对不了测试证据，请稍后再试。' : '正在核对测试证据是否对应当前代码…'; if (!freshness && f.freshness.status === 'failed') bar.notes.push({ ...note(confirm.disabledReason, 'warn'), link: { action: 'reload', label: '重新读取' } }) }
  }
  if (f.testBlockedReason) for (const b of bar.buttons.filter(b => b.id === 'runTests' || b.id === 'rerunTests')) {
    b.enabled = false; b.disabledReason = f.testBlockedReason
    bar.notes.push({ ...note(f.testBlockedReason, 'warn'), link: { action: 'openProjectSettings', label: '打开本地项目设置' } })
  }
  if (f.testCommand && ['T11', 'T12'].includes(bar.row)) bar.notes.push({ ...note(`测试命令：${f.testCommand}`), raw: [f.testCommand] })
  if (f.historyError && pending?.changeSetId) bar.notes.push({ ...note('改动内容读取失败。', 'warn'), technical: f.historyError, link: { action: 'reload', label: '重新读取' } })
  if (run && ['B11', 'T7'].includes(bar.row) && ['failed', 'timed_out', 'invalid_result'].includes(run.status)) bar.notes.push(note(describeCodingRunFailure(run, f.codingEvents)))
  if (['T3', 'T6', 'T12'].includes(bar.row)) material.placeholder = `第 ${reports.length + 1} 次测试正在运行，结果出来后显示在这里。`
  const workspace = f.managedCodingWorkspaces.find(w => w.id === run?.managedWorkspaceId)
  if (run && !isActive(run) && !history && mode !== 'finished') bar.notes.push(note(workspace?.cleanupStatus === 'deleted' || workspace?.deletedAt ? '受管工作区已清理。' : workspace?.cleanupStatus === 'cleanup_failed' ? '受管工作区清理没有完成，需要手动清理（见执行记录）。' : workspace?.cleanupStatus === 'active' ? '受管工作区保留。' : '正在清理受管工作区。'))
  if (latest?.report.evidence.sourceTree?.workspaceId && !f.managedCodingWorkspaces.some(w => w.id === latest.report.evidence.sourceTree?.workspaceId && w.cleanupStatus === 'active' && !w.deletedAt)) for (const b of bar.buttons.filter(b => ['rerunTests', 'runTests'].includes(b.id))) { b.enabled = false; b.disabledReason = '受管工作区已不存在，这里不能重新测试。' }
  if (run?.status === 'cancelled' && stage === 'build' && !current) { bar.notes.push(note('没有生成改动。')); view.margin.note = '开发已停止，没有生成改动。' }
  const latestRun = taskCodingRuns(f).at(-1)
  if (latestRun && run && latestRun.id !== run.id) bar.notes.push(note('重新修复已停止，没有生成新的修复。'))
  if (latestRun && f.budgetContinuations.some(c => c.operation.id === `coding-${latestRun.id}`) && (['B4', 'B9', 'T4'].includes(bar.row) || bar.row === 'B8' && review?.status === 'running')) {
    if (bar.row !== 'B8') bar.title = `等你确认预算 · ${bar.title}`
    bar.notes.unshift(note('在窗口顶部的「继续本次模型操作」卡片上确认后才会调用模型；不确认不会花钱。'))
  }
  const unclaimed = f.writes.find(w => !['runTests', 'rerunTests'].includes(w.action) && !claimed(w, f))
  if (unclaimed) { bar.title = `正在${unclaimed.action}…`; bar.buttons.forEach(b => { b.enabled = false; b.disabledReason = '另一个操作正在进行，请稍候。' }); cards.forEach(c => { c.actionable = false }); list.actionable = false }
  if (history || mode === 'finished' || run?.revisionInFlight) cards.forEach(c => { c.actionable = false })
  for (const card of cards.filter(c => c.kind === 'test_failure')) { if (bar.row === 'T4') { card.status = 'fixing'; card.statusText = 'DevFlow Native 正在生成修复' } else if (bar.row === 'T5') { card.status = 'fixing'; card.statusText = '这次修复会补上' } else if (bar.row === 'T6') { card.status = 'retesting'; card.statusText = '正在重新测试' } }
  if (pending && (pending.changeSetId || pending.diffArtifactId) && (shown?.request.id !== pending.id || pending.changeSetId && shown.record?.digest !== pending.changeSetDigest)) {
    for (const button of bar.buttons.filter(b => ['approveChange', 'approveWithout', 'approveRepair', 'rejectChange', 'rejectRepair', 'reviseChange', 'reviseRepair', 'rerunSelfCheck'].includes(b.id))) { button.enabled = false; button.disabledReason = '当前改动内容还没读到，请稍候。' }
    list.actionable = false
    cards.forEach(c => { c.actionable = false })
  }
  if (f.writeResult) bar.notes.unshift(f.writeResult)
  const findings = cards.filter(c => c.kind === 'finding'), open = cards.filter(c => ['open', 'fixing', 'retesting'].includes(c.status))
  const parts = [['finding', '条意见'], ['coding_question', '个问题'], ['permission', '个权限请求'], ['test_failure', '个测试失败（重要）'], ['stale_evidence', '处证据需要核实（重要）']].flatMap(([kind, text]) => { const n = open.filter(c => c.kind === kind).length; return n ? [`${n} ${text}`] : [] })
  if (parts.length) bar.progress = { text: `还剩 ${parts.join(' · ')}`, done: false, showNext: true }
  else if (review?.status === 'completed' && !review.findings.length) bar.progress = { text: `✓ AI 自检${label}：没有意见`, done: true, showNext: false }
  else if (cards.length) bar.progress = { text: '✓ 意见和问题都处理完了', done: true, showNext: false }
  view.margin.header = { title: stage === 'test' ? '测试失败与证据' : current ? `${label} 的问题与意见` : '开发中的问题与权限请求', text: findings.length ? `AI 自检意见 ${findings.length} 条${findings.some(c => c.level === 'important') ? `（${findings.filter(c => c.level === 'important').length} 条重要）` : ''}` : '', merges: [], adoptAll: { enabled: list.actionable && findings.some(c => c.level === 'suggestion' && c.status === 'open'), findingIndexes: findings.filter(c => c.level === 'suggestion' && c.status === 'open').map(c => c.finding!.index) } }
  if (!cards.length && !view.margin.note) view.margin.note = stage === 'test' && isActive(run) ? '测试结果出来后，失败和缺证据会显示在这里。' : review?.status === 'running' ? `AI 正在自检${label}，意见会显示在这里。` : isActive(run) && !current ? '开发中有问题或权限请求时，会显示在这里。' : '没有要你处理的事。'
  material.bars = cards.flatMap(c => c.anchor ? [{ cardIds: [c.id], block: c.anchor, slot: 0 as const, tone: c.level === 'important' || c.kind === 'test_failure' ? 'important' as const : c.kind === 'finding' ? 'suggestion' as const : 'question' as const, label: c.title }] : [])
  bar.title = versionSpacing(bar.title); bar.notes = bar.notes.map(n => ({ ...n, text: versionSpacing(n.text) }))
  return view
}
export function buildTestStageLabels(f: BuildTestFacts) {
  const build = projectBuildTestDecision({ facts: f, stage: 'build' }).bar, test = projectBuildTestDecision({ facts: f, stage: 'test' }).bar
  return { build: build.row === 'B3' ? '还没开始' : build.title.replace(' · 你的决定', ' 待批准'), test: displayCurrentStage(f) === 'build' ? '还没开始' : test.row === 'T8' ? '测试通过，等你确认' : test.row === 'T9' ? '证据已过期' : test.row === 'T10' ? '证据无法核实' : test.title }
}
