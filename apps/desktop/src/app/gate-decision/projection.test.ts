import { describe, expect, it } from 'vitest'
import { stageAgentFailureDetails } from '@ai-devflow/shared'
import {
  buildF1, buildF1RevisionPending, buildF2, buildF3, buildF4, buildF5, buildF6, F1_FINDINGS, F1_QUESTIONS, F3_REVISION_TEXT, F4_FINDINGS,
  gateProjectionInput, listFor, nodeIdsOf, policyDecision, policyReason, reviewOf, type GateFixture,
} from '../../testing/gate-fixtures'
import { projectGateDecision, type GateDecisionView, type GateProjectionInput } from './projection'
import type { RevisionListOp } from './revision-list'
const ids = nodeIdsOf()
const producedProgress: string[] = []
function project(input: GateProjectionInput): GateDecisionView {
  const view = projectGateDecision(input)
  if (view.bar.progress) producedProgress.push(view.bar.progress.text)
  return view
}
const labels = (view: GateDecisionView) => view.bar.buttons.map((button) => `${button.primary ? '*' : ''}${button.label}${button.enabled ? '' : '（禁用）'}`)
const noteTexts = (view: GateDecisionView) => view.bar.notes.map((note) => note.text)
const adopt = (index: number): RevisionListOp => ({ type: 'adopt', finding: { reviewId: 'review-f1', index, text: F1_FINDINGS[index]! } })
const decline = (index: number): RevisionListOp => ({ type: 'decline', reviewId: 'review-f1', index })
const answer = (index: number, text: string): RevisionListOp => ({ type: 'answer', answer: text,
  question: { index, text: F1_QUESTIONS[index]!, merged: index === 0 ? [{ reviewId: 'review-f1', index: 0, text: F1_FINDINGS[0] }] : [] } })
const blocked = (...targets: Array<'missing_agent_review' | 'governance_check' | 'agent_finding'>) =>
  policyDecision({ status: 'blocked', blocksApproval: true, canOverride: false, blockingReasons: targets.map((target) => policyReason(target)) })
const warnMissingReview = policyDecision({ status: 'warn', warningReasons: [policyReason('missing_agent_review')] })
const withoutReview = (fixture: GateFixture): GateFixture => ({ ...fixture, reviews: [] })
const policy = (decision: GateProjectionInput['policy']['decision'], extra: Partial<GateProjectionInput['policy']> = {}): Pick<GateProjectionInput, 'policy'> =>
  ({ policy: { decision, isLoading: false, enabled: true, teamBinding: true, ...extra } })
describe('progress line (AC11)', () => {
  it('walks F1 from the first state to everything handled', async () => {
    const f1 = await buildF1()
    const steps: Array<[RevisionListOp[], string]> = [
      [[], '还剩 4 条意见（1 条重要）· 2 个问题（1 个重要）'],
      [[answer(0, '不区分')], '还剩 4 条意见（1 条重要）· 1 个问题'],
      [[answer(0, '不区分'), adopt(1)], '还剩 3 条意见（都是建议，可不处理）· 1 个问题'],
      [[answer(0, '不区分'), adopt(1), answer(1, '允许')], '还剩 3 条意见（都是建议，可不处理）'],
      [[answer(0, '不区分'), adopt(1), answer(1, '允许'), decline(2), adopt(3), adopt(4)], '✓ 意见和问题都处理完了'],
    ]
    for (const [ops, text] of steps) {
      const view = project(await gateProjectionInput(f1, { list: await listFor(f1.current, ops) }))
      expect(view.bar.row).toBe('15')
      expect(view.bar.progress).toEqual({ text, done: text.startsWith('✓'), showNext: !text.startsWith('✓') })
    }
  })
  it('has no level brackets without levels (F2) and counts the design (F4)', async () => {
    const f2 = await buildF2()
    expect(project(await gateProjectionInput(f2)).bar.progress?.text).toBe('还剩 4 条意见 · 2 个问题')
    const f4 = await buildF4()
    expect(project(await gateProjectionInput(f4)).bar.progress?.text).toBe('还剩 3 条意见（2 条重要）')
    const all = await listFor(f4.current, F4_FINDINGS.map((text, index) => ({ type: 'adopt' as const, finding: { reviewId: 'review-f4', index, text } })))
    expect(project(await gateProjectionInput(f4, { list: all })).bar.progress).toEqual({ text: '✓ 意见都处理完了', done: true, showNext: false })
  })
  it('says the AI review had no findings only with a bound review, and counts questions without one', async () => {
    const f1 = await buildF1()
    const empty = { ...f1, reviews: [await reviewOf({ id: 'empty', artifact: f1.current, gateNodeId: ids.clarifyGate, findings: [], createdAt: f1.review!.createdAt, details: [] })] }
    const input = await gateProjectionInput(empty)
    expect(project(input).bar.progress?.text).toBe('还剩 2 个问题')
    expect(project({ ...input, current: { ...input.current, questions: [] } }).bar.progress?.text).toBe('AI 审查没有意见')
    const unreviewed = await gateProjectionInput(withoutReview(f1), {}, policy(warnMissingReview))
    expect(project(unreviewed).bar.progress?.text).toBe('还剩 2 个问题')
    expect(project({ ...unreviewed, current: { ...unreviewed.current, questions: [] } }).bar.progress).toBeUndefined()
  })
})
describe('buttons and notes (AC25, AC32–34)', () => {
  it('offers only confirm with an empty list and submit plus confirm-without with items', async () => {
    const f1 = await buildF1()
    expect(labels(project(await gateProjectionInput(f1)))).toEqual(['*确认需求 v1'])
    const withItems = project(await gateProjectionInput(f1, { list: await listFor(f1.current, [adopt(1), answer(1, '允许')]) }))
    expect(labels(withItems)).toEqual(['*提交修订，生成 v2（2 项）', '不修订，直接确认 v1'])
    const f4 = await buildF4()
    const design = project(await gateProjectionInput(f4, { list: await listFor(f4.current, [{ type: 'addOwn', text: '补充窄屏布局' }]) }))
    expect(labels(design)).toEqual(['*生成方案 v2（1 项）', '不修订，直接确认方案 v1'])
  })
  it('F3: red workflow block, 审查需求 v2 primary, confirm disabled, margin note (AC32)', async () => {
    const view = project(await gateProjectionInput(await buildF3()))
    expect(view.bar.row).toBe('10')
    expect(view.bar.notes[0]).toEqual({ tone: 'block', text: '✕ 需要先审查需求 v2：已有的审查针对需求 v1，确认前必须重新审查（工作流要求）' })
    expect(labels(view)).toEqual(['*审查需求 v2', '确认需求 v2（禁用）'])
    expect(view.bar.buttons[1]!.disabledReason).toBe('需要先审查需求 v2')
    expect(view.margin.note).toBe('审查需求 v2 后，意见会显示在这里')
    expect(view.listActionable).toBe(false)
  })
  it('F5: nothing blocks; the optional note, confirm primary, review secondary (AC33)', async () => {
    const view = project(await gateProjectionInput(await buildF5()))
    expect(view.bar.row).toBe('13')
    expect(view.bar.notes).toEqual([{ tone: 'neutral', text: '重新审查是可选的：已有的审查针对方案 v1，不审查也能确认' }])
    expect(labels(view)).toEqual(['*确认方案 v2', '审查方案 v2'])
    expect(view.margin.note).toBe('方案 v2 还没有重新审查（可选）。审查后，意见会显示在这里。')
    expect(view.bar.notes.some((note) => note.tone === 'block')).toBe(false)
  })
  it('a warn-only missing review is never blocking; a hard block is red with its remedy (AC34)', async () => {
    const f1 = withoutReview(await buildF1())
    const warn = project(await gateProjectionInput(f1, {}, policy(warnMissingReview)))
    expect(warn.bar.row).toBe('14')
    expect(noteTexts(warn)).toEqual(['还没有审查需求 v1；策略不阻断，也可以直接确认（确认前会提醒一次）。'])
    expect(labels(warn)).toEqual(['*审查需求 v1', '确认需求 v1'])
    expect(warn.bar.buttons[1]!.confirmBefore).toBe('还没有审查需求 v1，本次确认针对需求 v1。再次点击「确认需求 v1」提交。')
    const hard = project(await gateProjectionInput(await buildF1(), {}, policy(policyDecision({ status: 'hard_blocked', blocksApproval: true, blockingReasons: [policyReason('governance_check')] }))))
    expect(hard.bar.row).toBe('12')
    expect(hard.bar.notes[0]).toEqual({ tone: 'block', text: '✕ 暂不能确认需求 v1：规范检查未满足。governance_check 处理方法' })
    expect(labels(hard)).toEqual(['确认需求 v1（禁用）'])
    expect(hard.bar.buttons[0]!.disabledReason).toBe('暂不能确认：规范检查未满足')
  })
})
describe('policy matrix', () => {
  it('unavailable never yields row 11 and keeps the list usable with a bound review', async () => {
    const f1 = await buildF1()
    const unavailable = policyDecision({ status: 'blocked_policy_unavailable', blocksApproval: true, blockingReasons: [policyReason('missing_agent_review', 'policy-unavailable')] })
    const view = project(await gateProjectionInput(f1, { list: await listFor(f1.current, [adopt(1)]) }, policy(unavailable)))
    expect(view.bar.row).toBe('9')
    expect(view.listActionable).toBe(true)
    expect(noteTexts(view)).toEqual(['状态待核实：尚未读取团队策略，暂时无法判断能否确认。更新团队数据后会重新评估。'])
    expect(labels(view)).toEqual(['*更新团队数据', '提交修订，生成 v2（1 项）'])
    const local = project(await gateProjectionInput(f1, {}, policy(unavailable, { teamBinding: false })))
    expect(noteTexts(local)).toEqual(['状态待核实：当前无法读取适用的策略，暂时无法判断能否确认。'])
    expect(labels(local)).toEqual([])
  })
  it('loading shows no confirm button', async () => {
    const view = project(await gateProjectionInput(await buildF1(), {}, policy(null, { isLoading: true })))
    expect(view.bar.row).toBe('8')
    expect(noteTexts(view)).toEqual(['正在读取审批条件；读取完成前不显示确认按钮。'])
    expect(view.bar.buttons.some((button) => button.id === 'confirm' || button.id === 'confirmWithout')).toBe(false)
  })
  it('blocked and hard_blocked both disable confirm', async () => {
    for (const status of ['blocked', 'hard_blocked'] as const) {
      const view = project(await gateProjectionInput(await buildF1(), {}, policy(policyDecision({ status, blocksApproval: true, blockingReasons: [policyReason('agent_finding')] }))))
      expect(view.bar.buttons.find((button) => button.id === 'confirm')?.enabled).toBe(false)
    }
  })
  it('a missing-review block alone is row 11; with another reason it is row 12 with both notes and the review button', async () => {
    const f1 = withoutReview(await buildF1())
    const alone = project(await gateProjectionInput(f1, {}, policy(blocked('missing_agent_review'))))
    expect(alone.bar.row).toBe('11')
    expect(noteTexts(alone)).toEqual(['✕ 需要先审查需求 v1：团队策略要求先完成 AI 审查'])
    expect(labels(alone)).toEqual(['*审查需求 v1', '确认需求 v1（禁用）'])
    const both = project(await gateProjectionInput(f1, { list: await listFor(f1.current, [{ type: 'addOwn', text: '补一条' }]) }, policy(blocked('missing_agent_review', 'governance_check'))))
    expect(both.bar.row).toBe('12')
    expect(noteTexts(both)).toEqual(['✕ 暂不能确认需求 v1：规范检查未满足。governance_check 处理方法', '团队策略要求先完成 AI 审查。'])
    // The one submit rule: no bound review under a missing-review block, so no submit button.
    expect(labels(both)).toEqual(['*审查需求 v1', '确认需求 v1（禁用）'])
  })
  it('a warn-only missing review plus another block is row 12 and never says 策略不阻断; an overridable block names the Lead', async () => {
    const decision = policyDecision({ status: 'blocked', blocksApproval: true, canOverride: true, blockingReasons: [policyReason('governance_check')], warningReasons: [policyReason('missing_agent_review')] })
    const view = project(await gateProjectionInput(withoutReview(await buildF1()), {}, policy(decision)))
    expect(view.bar.row).toBe('12')
    expect(noteTexts(view).join('\n')).not.toContain('策略不阻断')
    expect(noteTexts(view)).toContain('Lead 可以在下方「审批条件与例外处理」记录例外后确认。')
    expect(labels(view)).toEqual(['*审查需求 v1', '确认需求 v1（禁用）'])
  })
  it('rule R adds the review button in rows 12 and 15 and under the no-permission modifier', async () => {
    const f1 = withoutReview(await buildF1())
    expect(labels(project(await gateProjectionInput(f1)))).toEqual(['*确认需求 v1', '审查需求 v1'])
    const noPermission = project(await gateProjectionInput(f1, {}, { permission: { roleCanApprove: false, role: 'member', requiredRole: 'lead' } }))
    expect(labels(noPermission)).toEqual(['*审查需求 v1'])
    expect(noteTexts(noPermission)).toContain('你没有确认权限：需要 Lead 或更高角色确认需求 v1。可以处理意见、回答问题并提交修订。')
    expect(noPermission.bar.meta.role).toBe('你没有确认权限（需要 Lead）')
  })
  it('F3 under loading, failed or unavailable policy keeps the red note, makes 审查需求 v2 primary and offers no submit', async () => {
    const f3 = await buildF3()
    const list = await listFor(f3.current, [{ type: 'addOwn', text: '再补一条' }])
    const states: Array<[string, Pick<GateProjectionInput, 'policy'>]> = [
      ['8', policy(null, { isLoading: true })],
      ['8a', policy(null, { loadError: 'IPC failed' })],
      ['9', policy(policyDecision({ status: 'blocked_policy_unavailable', blocksApproval: true, blockingReasons: [policyReason('missing_agent_review', 'policy-unavailable')] }))],
    ]
    for (const [row, override] of states) {
      const view = project(await gateProjectionInput(f3, { list }, override))
      expect(view.bar.row).toBe(row)
      expect(noteTexts(view)).toContain('✕ 需要先审查需求 v2：已有的审查针对需求 v1，确认前必须重新审查（工作流要求）')
      expect(view.bar.buttons[0]).toMatchObject({ id: 'review', label: '审查需求 v2', primary: true })
      expect(view.bar.buttons.some((button) => button.id === 'submit')).toBe(false)
      expect(view.margin.note).toBe('审查需求 v2 后，意见会显示在这里')
    }
  })
})
describe('facts not yet known', () => {
  it('a pending check gives row 7a with no buttons, no progress line and a disabled toggle (F1, F4, F5)', async () => {
    const f4 = await buildF4()
    const cases: GateProjectionInput[] = [
      await gateProjectionInput(await buildF1(), {}, { reviewCheck: { state: 'pending' } }),
      await gateProjectionInput(f4, { list: await listFor(f4.current, [{ type: 'addOwn', text: '已有项' }]) }, { reviewCheck: { state: 'pending', designIdentity: true } }),
      await gateProjectionInput(await buildF5(), {}, { reviewCheck: { state: 'pending' } }),
    ]
    for (const input of cases) {
      const view = project(input)
      expect([view.bar.row, view.bar.mode, view.bar.buttons, view.bar.progress]).toEqual(['7a', 'checking', [], undefined])
      expect(view.bar.title).toMatch(/· 你的决定$/u)
      expect([view.bar.list.toggleLabel, view.bar.list.toggleEnabled, view.bar.list.count]).toEqual(['修订清单', false, undefined])
      expect(view.margin.cards).toEqual([])
    }
    expect(noteTexts(project(cases[1]!))).toEqual(['正在核对方案 v1 的版本…'])
    expect(noteTexts(project(cases[0]!))).toEqual(['正在核对审查与当前正文的对应关系…'])
  })
  it('a failed check gives row 7b with only 重新核对', async () => {
    const view = project(await gateProjectionInput(await buildF1(), {}, { reviewCheck: { state: 'failed', technical: 'SubtleCrypto unavailable' } }))
    expect([view.bar.row, view.bar.title, labels(view)]).toEqual(['7b', '状态待核实', ['*重新核对']])
    expect(view.bar.notes[0]).toEqual({ tone: 'warn', text: '无法核对审查与当前正文的对应关系；完整报告在「材料与版本」。', technical: 'SubtleCrypto unavailable' })
    expect(view.bar.meta.rerun).toEqual({ enabled: true })
    expect(view.listActionable).toBe(false)
  })
  it('a running review or generation wins over both, with 停止', async () => {
    const f1 = await buildF1()
    const review = project(await gateProjectionInput(f1, {}, { reviewCheck: { state: 'pending' }, runFacts: { reviewRunning: true, generationRunning: false, writeLock: false } }))
    expect([review.bar.row, review.bar.stop, review.bar.title]).toEqual(['5', { target: 'review' }, '正在审查需求 v1'])
    expect(noteTexts(review)).toEqual(['使用 Fake · fake-model；审查只提供建议，完成后会重新评估，不会确认需求。'])
    expect(review.margin.note).toBe('正在审查需求 v1，意见会显示在这里。')
    const f4 = await buildF4()
    const generation = project(await gateProjectionInput(f4, {}, { reviewCheck: { state: 'failed' }, runFacts: { reviewRunning: false, generationRunning: true, writeLock: false } }))
    expect([generation.bar.row, generation.bar.stop, generation.bar.title]).toEqual(['3', { target: 'generation' }, '正在生成方案 v2'])
  })
  it('a running review or generation shows its row also when the identity is not determinable', async () => {
    const input = await gateProjectionInput(await buildF1())
    const undeterminable = { ...input, current: { ...input.current, determinable: false, determinableMessage: '当前 Gate 尚未关联有效的 Clarification Revision。' } }
    expect(project(undeterminable).bar.row).toBe('7')
    expect(project({ ...undeterminable, runFacts: { reviewRunning: true, generationRunning: false, writeLock: false } }).bar).toMatchObject({ row: '5', stop: { target: 'review' } })
    expect(project({ ...undeterminable, runFacts: { reviewRunning: false, generationRunning: true, writeLock: false } }).bar).toMatchObject({ row: '3', stop: { target: 'generation' } })
  })
  it('a failed policy load gives row 8a with 重新读取 primary and no confirm; preview has no 重新读取', async () => {
    const f1 = await buildF1()
    const failed = project(await gateProjectionInput(f1, {}, policy(null, { loadError: 'loadEnforcementPolicy failed' })))
    expect([failed.bar.row, labels(failed)]).toEqual(['8a', ['*重新读取']])
    expect(failed.bar.notes[0]).toEqual({ tone: 'warn', text: '状态待核实：读取审批条件失败，暂时无法判断能否确认。', technical: 'loadEnforcementPolicy failed' })
    const preview = project(await gateProjectionInput(f1, {}, policy(policyDecision(), { enabled: false })))
    expect([preview.bar.row, labels(preview), noteTexts(preview)]).toEqual(['8a', [], ['这是预览数据，不读取审批条件，不能在这里确认。']])
  })
  it('with only 建议 left, the bracket appears only under a decision that does not block on findings (AC34)', async () => {
    const f1 = await buildF1()
    const list = await listFor(f1.current, [adopt(1), answer(0, '不区分'), answer(1, '允许')])
    const without: Array<Pick<GateProjectionInput, 'policy'>> = [policy(null, { isLoading: true }), policy(null, { loadError: 'x' }), policy(policyDecision(), { enabled: false }),
      policy(policyDecision({ status: 'blocked_policy_unavailable', blocksApproval: true, blockingReasons: [policyReason('missing_agent_review', 'policy-unavailable')] })),
      policy(blocked('agent_finding'))]
    for (const override of without) expect(project(await gateProjectionInput(f1, { list }, override)).bar.progress?.text).toBe('还剩 3 条意见')
    expect(project(await gateProjectionInput(f1, { list }, policy(policyDecision({ status: 'warn' })))).bar.progress?.text).toBe('还剩 3 条意见（都是建议，可不处理）')
  })
})
describe('modes', () => {
  it('revision-pending shows vN with its bound review, read-only cards and the submitted text', async () => {
    const pending = await buildF1RevisionPending()
    const list = { ...(await listFor(pending.current, [answer(1, '允许'), adopt(1)])), submitted: { at: '2026-10-30T09:10:00.000Z', text: F3_REVISION_TEXT, proposals: [], itemCount: 2 } }
    const input = await gateProjectionInput(pending, { nodeId: ids.clarify, list }, { submittedText: F3_REVISION_TEXT })
    const view = project(input)
    expect([view.bar.row, view.bar.mode, view.bar.title]).toEqual(['4', 'pending-generation', '需求 v1 的修订请求已记录'])
    expect(noteTexts(view)).toEqual(['需求 v2 还没有生成。'])
    expect(labels(view)).toEqual(['*重新生成需求 v2'])
    expect(view.margin.note).toBe('需求 v1 的修订请求已提交，这里只能查看。')
    expect(view.margin.cards.length).toBeGreaterThan(0)
    expect(view.margin.cards.every((card) => !card.actionable && card.readOnlyReason === '修订请求已提交')).toBe(true)
    expect(view.margin.cards.find((card) => card.id === 'question-2')?.title).toBe('问题 2 · 已回答：允许')
    expect(view.margin.cards.find((card) => card.id === 'finding-1')?.status).toBe('adopted')
    expect([view.bar.list.submittedText, view.bar.list.count, view.bar.list.items]).toEqual([F3_REVISION_TEXT, 2, []])
    expect(view.bar.costLines).toEqual([{ kind: 'generation', text: '将用 Direct Provider · fake-model 生成，可能产生费用', link: { label: '更改', action: 'openStageSettings' } }])
  })
  it('row 4: readiness, missing model, write lock and a changed proposal input', async () => {
    const pending = await buildF1RevisionPending()
    const base = await gateProjectionInput(pending, { nodeId: ids.clarify }, { submittedText: F3_REVISION_TEXT })
    const link = { label: '打开模型与执行方式设置', action: 'openModelSettings' }
    const readiness = project({ ...base, generation: { ...base.generation, modelReadinessError: '尚未读取项目预算，暂不能运行模型。' } })
    expect(readiness.bar.buttons[0]).toMatchObject({ id: 'regenerate', enabled: false, disabledReason: '尚未读取项目预算，暂不能运行模型。' })
    expect(readiness.bar.notes.at(-1)).toEqual({ tone: 'warn', text: '尚未读取项目预算，暂不能运行模型。', link })
    const noModel = project({ ...base, generation: { executorLabel: 'Direct Provider', modelSelected: false } })
    expect(noModel.bar.notes.at(-1)).toEqual({ tone: 'warn', text: '还没有选择生成使用的模型，请在设置行的「更改」里选择。', link })
    const locked = project({ ...base, runFacts: { ...base.runFacts, writeLock: true } })
    expect(locked.bar.buttons[0]).toMatchObject({ enabled: false, disabledReason: '另一个操作正在进行，请稍候。' })
    expect(locked.bar.notes.at(-1)).toEqual({ tone: 'warn', text: '另一个操作正在进行，请稍候。' })
    const changed = project({ ...base, generation: { ...base.generation, modelReadinessError: 'x' }, stageFailure: stageAgentFailureDetails('revision_input_changed', 'stage_validation') })
    expect(labels(changed)).toEqual([])
    expect(noteTexts(changed)).toEqual(['需求 v2 还没有生成。', '修订请求引用的答疑提案已不可用，无法重新生成；请到「材料与版本」核对提案。'])
    const failed = project({ ...base, stageFailure: stageAgentFailureDetails('timeout', 'stage_validation') })
    expect(noteTexts(failed)[1]).toMatch(/^上次生成没有完成：/u)
  })
  it('finished shows the confirmer and the unsubmitted items', async () => {
    const f1 = await buildF1()
    const input = await gateProjectionInput(f1)
    const list = { ...(await listFor(f1.current, [adopt(1)])), confirmedWithout: { at: '2026-10-30T09:30:00.000Z', count: 1 } }
    const view = project({ ...input, mode: 'finished', list, finished: { at: '2026-10-30T09:30:00.000Z', confirmer: { name: '王丽', role: 'Lead' }, actorId: 'user-1' } })
    expect([view.bar.row, view.bar.mode, view.bar.title, labels(view)]).toEqual(['1', 'finished', '需求 v1 已确认', []])
    expect(view.bar.notes[0]!.text).toMatch(/^✓ 确认人 王丽（Lead）· /u)
    expect(noteTexts(view)[1]).toBe('确认时修订清单里还有 1 项没有提交')
    expect(view.bar.meta.stepNote).toBe('这一步已完成；浏览这里不会改变实际进度。')
    expect(view.margin).toMatchObject({ note: '需求 v1 已确认。这里只能查看，意见不能再处理。', cards: [] })
    // A team member's stored role is shown with the same label as the bar's permission line.
    const owner = project({ ...input, mode: 'finished', finished: { at: '2026-10-30T09:30:00.000Z', confirmer: { name: 'Erich', role: 'owner' }, actorId: 'user-2' } })
    expect(owner.bar.notes[0]!.text).toMatch(/^✓ 确认人 Erich（Owner）· /u)
    const unknown = project({ ...input, mode: 'finished', finished: { at: '2026-10-30T09:30:00.000Z', actorId: 'user-9' } })
    expect(unknown.bar.notes[0]).toMatchObject({ tone: 'ok', technical: 'user-9' })
    expect(unknown.bar.notes[0]!.text).toMatch(/^✓ 已确认 · /u)
  })
  it('history mode uses the review of vM, or says there is none (finding 19)', async () => {
    const f3 = await buildF3()
    const history = project(await gateProjectionInput(f3, { readingArtifactId: f3.previous!.id }))
    expect(history.margin.note).toBe('这是需求 v1 的审查，只能查看。')
    expect(history.margin.cards.length).toBeGreaterThan(0)
    expect(history.margin.cards.every((card) => !card.actionable && card.readOnlyReason === '历史版本，只能查看')).toBe(true)
    expect(history.material.readOnlyBanner).toBe('这是历史版本 需求 v1；当前是需求 v2。这里只能查看。')
    // An adopted card of v1 names v2, the version generated from it, not v3.
    const adopted = project(await gateProjectionInput(f3, { readingArtifactId: f3.previous!.id, readingList: await listFor(f3.previous!, [adopt(1)]) }))
    expect(adopted.margin.cards.find((card) => card.id === 'finding-1')?.statusText).toBe(`已采纳 · v2 里会处理：${F1_FINDINGS[1]}`)
    const none = project(await gateProjectionInput({ ...f3, reviews: [] }, { readingArtifactId: f3.previous!.id }))
    expect(none.margin.note).toBe('需求 v1 没有对应的审查记录。')
    expect(none.margin.cards.map((card) => card.id)).toEqual(['question-1', 'question-2'])
  })
  it('history mode in rows 8–15 keeps the current version\'s state and offers only 返回 (decision 53, amendment 37)', async () => {
    const f3 = await buildF3()
    const readingList = await listFor(f3.previous!, [{ type: 'addOwn', text: '旧清单' }])
    const view = project(await gateProjectionInput(f3, { readingArtifactId: f3.previous!.id, list: await listFor(f3.current, [{ type: 'addOwn', text: 'v2 的项' }]), readingList }))
    expect(view.bar.row).toBe('10')
    expect(labels(view)).toEqual(['*返回需求 v2'])
    expect(noteTexts(view)).toEqual(['✕ 需要先审查需求 v2：已有的审查针对需求 v1，确认前必须重新审查（工作流要求）',
      '你正在阅读历史版本需求 v1。确认、修订和审查都针对当前的需求 v2，请先返回需求 v2。'])
    expect(view.bar.title).toBe('需求 v2 · 你的决定')
    expect(view.bar.costLines).toEqual([])
    expect(view.bar.meta.rerun).toBeUndefined()
    expect([view.bar.list.actionable, view.bar.list.readOnlyReason]).toEqual([false, '正在阅读历史版本需求 v1；返回需求 v2 后可以修改修订清单。'])
    expect(view.material.historyList).toEqual({ title: '已提交（1 项），内容见「版本与修订意见历史」', text: expect.stringContaining('我添加的：旧清单'), count: 1 })
    const f5 = await buildF5()
    const design = project(await gateProjectionInput(f5, { readingArtifactId: f5.previous!.id, list: await listFor(f5.current, [{ type: 'addOwn', text: '项' }]) }))
    expect(design.bar.row).toBe('13')
    expect(labels(design)).toEqual(['*返回方案 v2'])
    const f1 = await buildF1()
    const unreviewed = { ...f1, reviews: [] }
    const warn = project(await gateProjectionInput(unreviewed, { readingArtifactId: f1.current.id }, policy(warnMissingReview)))
    expect(warn.bar.buttons.some((button) => button.id === 'review')).toBe(true)  // same version: not history
  })
  it('amendment 37: row 8a in history mode has exactly one primary button, 返回需求 v2', async () => {
    const f3 = await buildF3()
    const view = project(await gateProjectionInput(f3, { readingArtifactId: f3.previous!.id }, policy(null, { loadError: 'x' })))
    expect(view.bar.row).toBe('8a')
    expect(view.bar.buttons.filter((button) => button.primary).map((button) => button.id)).toEqual(['returnToCurrent'])
    expect(labels(view)).toEqual(['*返回需求 v2', '重新读取'])
  })
  it('a sub-step page is read-only, but a running review or design generation shows its running row with 停止 (amendment 35)', async () => {
    const f1 = await buildF1()
    const subStep = await gateProjectionInput(f1, { nodeId: ids.clarify })
    expect(project(subStep).bar).toMatchObject({ row: '2', mode: 'read-only', title: '需求 v1（只读）', buttons: [] })
    expect(project({ ...subStep, runFacts: { reviewRunning: true, generationRunning: false, writeLock: false } }).bar).toMatchObject({ row: '5', mode: 'running', stop: { target: 'review' } })
    const f4 = await buildF4()
    const designSubStep = await gateProjectionInput(f4, { nodeId: ids.design })
    expect(project(designSubStep).bar.row).toBe('2')
    expect(project({ ...designSubStep, runFacts: { reviewRunning: false, generationRunning: true, writeLock: false } }).bar).toMatchObject({ row: '3', mode: 'running', stop: { target: 'generation' }, title: '正在生成方案 v2' })
  })
  it('a write in flight is row 6 without stop', async () => {
    const input = await gateProjectionInput(await buildF1())
    expect(project({ ...input, runFacts: { ...input.runFacts, writeInFlight: 'approve' } }).bar).toMatchObject({ row: '6', mode: 'running', title: '正在确认需求 v1…', buttons: [] })
    expect(project({ ...input, runFacts: { ...input.runFacts, writeInFlight: 'request' } }).bar.title).toBe('正在提交需求 v1 的修订请求…')
  })
  it('F6 legacy data renders read-only with today\'s explanations (AC41)', async () => {
    const { requirement, design } = await buildF6()
    const view = project(await gateProjectionInput(requirement))
    expect([view.bar.row, view.bar.title]).toEqual(['7', '状态待核实'])
    expect(noteTexts(view)).toEqual(['旧版需求没有版本记录，不能在这里处理意见或提交修订；需要时请重新生成需求。'])
    expect(view.margin).toMatchObject({ note: '旧版需求没有版本记录，不能在这里处理意见或回答问题。', cards: [] })
    expect(view.material.header).toBe('需求（旧版记录）')
    const legacyReview = project(await gateProjectionInput(design, {}, { reviewTarget: { state: 'legacy' } }))
    expect(legacyReview.material.header).toBe('方案 v1 · 根据已确认的需求生成')
  })
})
describe('cards, margin header and bars', () => {
  it('F1: four finding cards, two question cards, nothing for 意见 1 (AC6, AC8)', async () => {
    const f1 = await buildF1()
    const view = project(await gateProjectionInput(f1))
    expect(view.margin.cards.filter((card) => card.kind === 'finding').map((card) => card.title)).toEqual(['意见 2 · 重要', '意见 3 · 建议', '意见 4 · 建议', '意见 5 · 建议'])
    const [q1, q2] = view.margin.cards.filter((card) => card.kind === 'question')
    expect([q1!.title, q1!.mergedLines]).toEqual(['问题 1 · 重要 · 需要你决定', [`AI 审查也指出（意见 1）：${F1_FINDINGS[0]}`]])
    expect([q2!.title, q2!.mergedLines, q2!.level]).toEqual(['问题 2 · 需要你决定', [], undefined])
    expect(view.margin.header).toMatchObject({ text: '审查意见 4 条（1 条重要）', merges: [{ text: '意见 1 并入了问题 1', cardId: 'question-1' }] })
    expect(view.margin.header?.adoptAll).toEqual({ enabled: true, findingIndexes: [2, 3, 4] })
    // Unlocated cards first, then located ones in reading order.
    expect(view.margin.navigationOrder[0]).toBe('finding-4')
    expect(view.margin.cards.find((card) => card.id === 'finding-4')?.anchor).toBeUndefined()
    expect(view.margin.cards.every((card) => card.actionable)).toBe(true)
    const f2 = project(await gateProjectionInput(await buildF2()))
    expect(f2.margin.header?.text).toBe('审查意见 4 条')
    expect(f2.margin.header?.adoptAll).toEqual({ enabled: false, disabledReason: '这次审查没有给出全部意见的级别。', findingIndexes: [] })
  })
  it('adopting 意见 2 shows the item text and number and bars both cited blocks (AC15)', async () => {
    const f1 = await buildF1()
    const view = project(await gateProjectionInput(f1, { list: await listFor(f1.current, [{ type: 'addOwn', text: '先加一条' }, adopt(1)]) }))
    const card = view.margin.cards.find((item) => item.id === 'finding-1')!
    expect([card.status, card.statusText, card.itemRef]).toEqual(['adopted', `已采纳 · v2 里会处理：${F1_FINDINGS[1]}`, { itemId: 'f-review-f1-1', number: 2 }])
    expect(view.material.bars.filter((bar) => bar.cardIds.includes('finding-1')).map((bar) => [bar.block, bar.slot, bar.tone, bar.label])).toEqual(
      card.blocks.map((block) => [block, 0, 'important', '意见 2：已加入修订清单第 2 项']))
    expect(card.blocks).toHaveLength(2)
    expect(view.bar.list.items.map((item) => [item.number, item.label])).toEqual([[1, '我添加的'], [2, '来自意见 2']])
    const declined = project(await gateProjectionInput(f1, { list: await listFor(f1.current, [decline(2)]) }))
    expect(declined.margin.cards.find((item) => item.id === 'finding-2')).toMatchObject({ status: 'declined', statusText: '不采纳' })
  })
  it('answering 问题 1 handles 意见 1 and bars the question and the block 意见 1 also cites', async () => {
    const f1 = await buildF1()
    const view = project(await gateProjectionInput(f1, { list: await listFor(f1.current, [answer(0, '不区分'), adopt(2)]) }))
    const q1 = view.margin.cards.find((card) => card.id === 'question-1')!
    expect([q1.title, q1.mergedLines, q1.answer]).toEqual(['问题 1 · 已回答：不区分', ['也处理了审查意见 1'], '不区分'])
    const goal = f1.current.content.indexOf('用户可以按关键词搜索任务。')
    const goalBars = view.material.bars.filter((bar) => bar.block.startsWith(`${goal}:`))
    expect(goalBars.map((bar) => [bar.cardIds, bar.slot, bar.tone])).toEqual([[['question-1'], 0, 'question'], [['finding-2'], 1, 'suggestion']])
  })
  it('a fourth adopted card on one block shares slot 2, whose label names both', async () => {
    const f1 = await buildF1()
    const quote = '用户可以按关键词搜索任务。'
    const review = await reviewOf({ id: 'r4', artifact: f1.current, gateNodeId: ids.clarifyGate, findings: ['a', 'b', 'c', 'd'], createdAt: '2026-10-30T08:11:00.000Z',
      details: [0, 1, 2, 3].map(() => ({ quotes: [quote], importance: 'suggestion' as const })) })
    const fixture = { ...f1, reviews: [review], review }
    const list = await listFor(f1.current, [0, 1, 2, 3].map((index) => ({ type: 'adopt' as const, finding: { reviewId: 'r4', index, text: ['a', 'b', 'c', 'd'][index]! } })))
    const bars = project(await gateProjectionInput(fixture, { list })).material.bars
    expect(bars.map((bar) => [bar.slot, bar.cardIds])).toEqual([[0, ['finding-0']], [1, ['finding-1']], [2, ['finding-2', 'finding-3']]])
    expect(bars[2]!.label).toBe('意见 3：已加入修订清单第 3 项；意见 4：已加入修订清单第 4 项')
  })
  it('the material header and the old-list notice', async () => {
    const f3 = await buildF3()
    const older = await listFor(f3.previous!, [{ type: 'addOwn', text: '没提交的' }])
    const unsubmittedOlder = { ...older, target: { ...older.target, artifactId: 'gate-run-clarification-v0' } }
    const view = project(await gateProjectionInput(f3, {}, { otherLists: [{ list: older, label: '需求 v1' }, { list: unsubmittedOlder, label: '需求 v0' }] }))
    expect(view.material.header).toBe('需求 v2 · 根据需求 v1 和 2 项修改生成，新加内容以绿色标出')
    expect(view.material.rawRequest).toBe('原始需求：给任务列表加搜索。…')
    expect(view.material.newBlocks).toHaveLength(2)
    // v1's list counts as submitted (a feedback targets v1); only the other one is announced.
    expect(view.bar.notes.filter((note) => note.link?.action === 'openVersion')).toEqual([
      { tone: 'neutral', text: '需求已更新为 v2。你在需求 v0 上的修订清单（1 项）没有提交。', link: { label: '查看需求 v0 的清单', action: 'openVersion', artifactId: 'gate-run-clarification-v0' } }])
  })
})
describe('cost lines (amendment 33)', () => {
  it('row 14 on F1 without a review has the review line with the provider label', async () => {
    const view = project(await gateProjectionInput(withoutReview(await buildF1()), {}, policy(warnMissingReview)))
    expect(view.bar.row).toBe('14')
    expect(view.bar.costLines).toEqual([{ kind: 'review', text: '将用 Fake · fake-model 审查需求 v1，可能产生费用', link: { label: '更换审查模型', action: 'openModelSettings' } }])
  })
  it('row 15 with K > 0 has the generation line while the list is collapsed', async () => {
    const f1 = await buildF1()
    const view = project(await gateProjectionInput(f1, { list: await listFor(f1.current, [adopt(1)]) }))
    expect(view.bar.row).toBe('15')
    expect(view.bar.costLines).toEqual([{ kind: 'generation', text: '将用 Direct Provider · fake-model 生成，可能产生费用', link: { label: '更改', action: 'openStageSettings' } }])
  })
  it('row 10 with reviewRunBlockedReason has a disabled 审查需求 v2, the warn note and the settings link', async () => {
    const reason = '尚未选择门禁审查使用的模型，请先在设置／模型与执行方式中选择。'
    const view = project(await gateProjectionInput(await buildF3(), {}, { reviewRunBlockedReason: reason, reviewModelMissing: true, reviewProviderLabel: undefined }))
    expect(view.bar.row).toBe('10')
    expect(view.bar.buttons[0]).toMatchObject({ id: 'review', label: '审查需求 v2', enabled: false, disabledReason: reason })
    expect(view.bar.notes.filter((note) => note.text === reason)).toEqual([{ tone: 'warn', text: reason, link: { label: '打开模型与执行方式设置', action: 'openModelSettings' } }])
    expect(view.bar.costLines).toEqual([{ kind: 'review', text: '运行审查前需要先选择模型。', link: { label: '打开模型与执行方式设置', action: 'openModelSettings' } }])
    const other = project(await gateProjectionInput(await buildF3(), {}, { reviewRunBlockedReason: '请在桌面应用中运行门禁审查。' }))
    expect(other.bar.notes.find((note) => note.text === '请在桌面应用中运行门禁审查。')).toEqual({ tone: 'warn', text: '请在桌面应用中运行门禁审查。' })
  })
})
describe('the one submit rule over the AC35 matrix', () => {
  it('never offers submit when the list is not actionable or empty, and keeps the other invariants', async () => {
    const f1 = await buildF1()
    const f3 = await buildF3()
    const f4 = await buildF4()
    const f5 = await buildF5()
    const fixtures: Array<[GateFixture, string | undefined]> = [[f1, undefined], [withoutReview(f1), undefined], [f3, undefined], [f3, f3.previous!.id], [f4, undefined], [f5, undefined], [f5, f5.previous!.id]]
    const policies: Array<Pick<GateProjectionInput, 'policy'>> = [policy(policyDecision()), policy(warnMissingReview), policy(blocked('missing_agent_review')), policy(blocked('governance_check')),
      policy(blocked('missing_agent_review', 'agent_finding')), policy(null, { isLoading: true }), policy(null, { loadError: 'x' }), policy(policyDecision(), { enabled: false }),
      policy(policyDecision({ status: 'blocked_policy_unavailable', blocksApproval: true, blockingReasons: [policyReason('missing_agent_review', 'policy-unavailable')] }))]
    const runs: GateProjectionInput['runFacts'][] = [{ reviewRunning: false, generationRunning: false, writeLock: false }, { reviewRunning: true, generationRunning: false, writeLock: false },
      { reviewRunning: false, generationRunning: true, writeLock: false }, { reviewRunning: false, generationRunning: false, writeInFlight: 'approve', writeLock: false },
      { reviewRunning: false, generationRunning: false, writeLock: true }]
    let checked = 0
    for (const [fixture, reading] of fixtures) {
      for (const items of [[], [{ type: 'addOwn' as const, text: '一项' }]]) {
        const base = await gateProjectionInput(fixture, { ...(reading ? { readingArtifactId: reading } : {}), list: await listFor(fixture.current, items) })
        for (const override of policies) for (const runFacts of runs) for (const state of ['done', 'pending', 'failed'] as const) for (const roleCanApprove of [true, false]) {
          const view = project({ ...base, ...override, runFacts, reviewCheck: { state }, permission: { ...base.permission, roleCanApprove } })
          const submit = view.bar.buttons.some((button) => button.id === 'submit')
          if (submit) expect(view.listActionable && items.length > 0).toBe(true)
          if (view.listActionable && items.length > 0 && ['8', '8a', '9', '12', '13', '14', '15'].includes(view.bar.row)) expect(submit).toBe(true)
          expect(view.bar.buttons.filter((button) => button.id === 'review')).toHaveLength(view.bar.buttons.some((button) => button.id === 'review') ? 1 : 0)
          expect(view.bar.buttons.filter((button) => button.id === 'confirm' || button.id === 'confirmWithout').length).toBeLessThanOrEqual(1)
          expect(Boolean(view.bar.stop)).toBe(view.bar.row === '3' || view.bar.row === '5')
          expect(view.bar.buttons.filter((button) => button.primary).length).toBeLessThanOrEqual(1)
          if (reading && ['4', '8', '8a', '9', '10', '11', '12', '13', '14', '15'].includes(view.bar.row)) {
            expect(view.bar.buttons.filter((button) => button.primary).map((button) => button.id)).toEqual(['returnToCurrent'])
            expect(view.bar.buttons.some((button) => ['review', 'submit', 'confirm', 'confirmWithout', 'regenerate', 'syncTeam'].includes(button.id))).toBe(false)
          }
          checked++
        }
      }
    }
    expect(checked).toBe(7 * 2 * 9 * 5 * 3 * 2)
  })
  it('row 12 offers submit with a bound review under a missing-review block', async () => {
    const f1 = await buildF1()
    const view = project(await gateProjectionInput(f1, { list: await listFor(f1.current, [adopt(1)]) }, policy(blocked('missing_agent_review', 'governance_check'))))
    expect(view.bar.row).toBe('12')
    expect(labels(view)).toEqual(['*提交修订，生成 v2（1 项）', '不修订，直接确认 v1（禁用）'])
  })
  it('submit is disabled with its reason on the first layer when the text or an item is too long, or the design gate is blocked', async () => {
    const f1 = await buildF1()
    const long = project(await gateProjectionInput(f1, { list: await listFor(f1.current, [{ type: 'addOwn', text: 'x'.repeat(1000) }, { type: 'addOwn', text: 'y'.repeat(1000) },
      { type: 'addOwn', text: 'z'.repeat(1000) }, { type: 'addOwn', text: 'w'.repeat(1000) }]) }))
    const submit = long.bar.buttons.find((button) => button.id === 'submit')!
    expect(submit.enabled).toBe(false)
    expect(submit.disabledReason).toMatch(/^修订内容共 \d+ 字，超过上限 4000 字（多 \d+ 字）。请精简后再提交。$/u)
    expect(long.bar.notes.at(-1)).toEqual({ tone: 'warn', text: submit.disabledReason })
    const f4 = await buildF4()
    const gateBlocked = project(await gateProjectionInput(f4, { list: await listFor(f4.current, [{ type: 'addOwn', text: '项' }]) }, { generationAllowed: false }))
    expect(gateBlocked.bar.buttons.find((button) => button.id === 'submit')?.disabledReason).toBe('方案评审处于阻断状态，暂不能生成新版。')
  })
  it('no progress line ever shows x/y or an item number (AC12)', () => {
    expect(producedProgress.length).toBeGreaterThan(20)
    for (const text of producedProgress) {
      expect(text).not.toMatch(/\d+\s*\/\s*\d+/u)
      expect(text).not.toMatch(/(意见|问题)\s*\d/u)
    }
  })
})
