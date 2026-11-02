import { describe, expect, it } from 'vitest'
import { addChange, addCoding, addReport, approve, buildTestFacts } from '../../testing/build-test-fixtures'
import { displayCurrentStage, effectiveCodingRun, nextSelectedStage } from './facts'
import { projectBuildTestDecision as project } from './projection'
import { emptyRevisionList, applyRevisionListOp } from '../gate-decision/revision-list'
const button = (view: ReturnType<typeof project>, id: string) => view.bar.buttons.find(b => b.id === id)
describe('build/test decision lifecycle', () => {
  it('starts at B3; readiness blocks start without exposing internal messages in first-layer copy', () => {
    const f = buildTestFacts(); f.readiness!.checks = [{ status: 'blocked', code: 'provider_unavailable', message: 'secret implementation detail' }]
    const v = project({ facts: f, stage: 'build' }); expect(v.bar.row).toBe('B3'); expect(button(v, 'startCoding')?.enabled).toBe(false)
    expect(v.bar.notes.map(n => n.text).join()).not.toContain('secret implementation detail')
  })
  it('shows pending change approval only with exact verified material; unknown cost does not block rejection', () => {
    const f = buildTestFacts(), r = addCoding(f); addChange(f, r)
    expect(button(project({ facts: f, stage: 'build' }), 'approveChange')?.enabled).toBe(true)
    f.history!.changeSets[0]!.verified = false
    const v = project({ facts: f, stage: 'build' }); expect(button(v, 'approveChange')?.enabled).toBe(false); expect(button(v, 'rejectChange')?.enabled).toBe(true)
    f.history = undefined; expect(button(project({ facts: f, stage: 'build' }), 'approveChange')?.enabled).toBe(false)
  })
  it('distinguishes a pending start from its claimed dependency request, without deadlocking the decision', () => {
    const f = buildTestFacts(); f.writes = [{ id: 'start', action: '开始开发', target: 'start:task', startedAt: f.now, claim: { kind: 'start', existing: [] } }]
    expect(button(project({ facts: f, stage: 'build' }), 'startCoding')?.enabled).toBe(false)
    const r = addCoding(f, { status: 'waiting_permission' }); const p = addChange(f, r); delete p.changeSetId; delete p.changeSetDigest; p.origin = 'dependency_bootstrap'; p.permission = 'install'
    const v = project({ facts: f, stage: 'build' }); expect(v.bar.row).toBe('B6'); expect(v.margin.cards[0]?.actionable).toBe(true)
  })
  it('follows approval to testing even while history is loading and the approval IPC has not returned', () => {
    const f = buildTestFacts(), r = addCoding(f), p = addChange(f, r); approve(f, p); r.status = 'applying'
    f.writes = [{ id: 'approve', action: '批准', target: p.id, startedAt: f.now, claim: { kind: 'permission', requestId: p.id } }]
    f.history = undefined; expect(displayCurrentStage(f)).toBe('test'); const v = project({ facts: f, stage: 'test' }); expect(v.bar.row).toBe('T3'); expect(v.bar.title).not.toMatch(/^正在批准/u)
    expect(nextSelectedStage({ before: 'build', after: 'test', selected: 'build' })).toBe('test'); expect(nextSelectedStage({ before: 'build', after: 'test', selected: 'build', reading: 'old' })).toBe('build')
  })
  it('projects repair generation, pending repair and retest separately', () => {
    const f = buildTestFacts(), r = addCoding(f), p = addChange(f, r); approve(f, p); r.status = 'running'; addReport(f, r, 'failed')
    expect(project({ facts: f, stage: 'test' }).bar.row).toBe('T4')
    const repair = addChange(f, r, 'repair'); expect(project({ facts: f, stage: 'test' }).bar.row).toBe('T5')
    approve(f, repair); r.status = 'testing'; expect(project({ facts: f, stage: 'test' }).bar.row).toBe('T6')
    r.status = 'completed'; const result = addReport(f, r); f.freshness.states = { [result.id]: 'current' }
    const v = project({ facts: f, stage: 'test' }); expect(v.bar.row).toBe('T8'); expect(button(v, 'confirmEvidence')?.enabled).toBe(true)
  })
  it.each(['stale', 'unavailable', 'unrecorded'] as const)('blocks confirming %s evidence', freshness => {
    const f = buildTestFacts(); f.run.currentNodeId = f.testNode.id; const e = addReport(f, undefined); f.freshness.states = { [e.id]: freshness }
    const v = project({ facts: f, stage: 'test' }); expect(v.bar.row).toBe(freshness === 'stale' ? 'T9' : 'T10'); expect(button(v, 'confirmEvidence')?.enabled).toBe(false); expect(v.bar.notes.filter(n => n.tone === 'block')).toHaveLength(1)
  })
  it('never offers approval for an expired repair before the timeout push arrives', () => {
    const f = buildTestFacts(), r = addCoding(f), p = addChange(f, r); approve(f, p); addReport(f, r, 'failed'); const repair = addChange(f, r, 'repair'); f.now = repair.expiresAt
    expect(project({ facts: f, stage: 'test' }).bar.buttons.some(b => b.id === 'approveRepair')).toBe(false)
  })
  it('keeps the revision list editable at the revision limit but budget blocks only paid actions', () => {
    const f = buildTestFacts(), r = addCoding(f), p = addChange(f, r)
    const list = emptyRevisionList({ kind: 'change', runId: f.run.id, codingRunId: r.id, changeSetId: p.changeSetId!, changeSetDigest: p.changeSetDigest! }, f.now)
    const changed = applyRevisionListOp(list, { type: 'addOwn', text: '保留现有标题' }, f.now); if (!changed.ok) throw new Error(changed.message); f.list = changed.list
    f.costs!.budget.revise = { blocks: true, status: 'requires_lead_approval' }
    const v = project({ facts: f, stage: 'build' }); expect(button(v, 'reviseChange')?.enabled).toBe(false); expect(button(v, 'approveWithout')?.enabled).toBe(true); expect(v.bar.list.actionable).toBe(true)
  })
  it('does not confuse conversation budget continuation with the current coding run', () => {
    const f = buildTestFacts(), r = addCoding(f); f.budgetContinuations = [{ operation: { id: 'opencode-other' } }]
    expect(project({ facts: f, stage: 'build' }).bar.title).not.toContain('等你确认预算'); f.budgetContinuations = [{ operation: { id: `coding-${r.id}` } }]; expect(project({ facts: f, stage: 'build' }).bar.title).toContain('等你确认预算')
  })
  it('cancelling a retry with no changes returns to the previous rejected version, never to approval', () => {
    const f = buildTestFacts(), r = addCoding(f), p = addChange(f, r); p.status = 'rejected'; r.status = 'interrupted'
    addCoding(f, { status: 'cancelled', retryOf: { kind: 'redevelop', codingRunId: r.id, hasReason: false }, startedAt: '2026-11-02T12:01:00.000Z' })
    expect(effectiveCodingRun(f)?.id).toBe(r.id); const v = project({ facts: f, stage: 'build' }); expect(v.bar.title).toContain('已拒绝'); expect(button(v, 'approveChange')).toBeUndefined()
  })
  it('history and completed steps expose no mutation even if another request is pending', () => {
    const f = buildTestFacts(), r = addCoding(f), p = addChange(f, r)
    const v = project({ facts: f, stage: 'build', reading: p.changeSetId }); expect(v.bar.buttons.map(b => b.id)).toEqual(['returnToCurrent']); expect(v.margin.cards.every(c => !c.actionable)).toBe(true)
    approve(f, p); r.status = 'testing'; expect(project({ facts: f, stage: 'build' }).bar.buttons).toEqual([])
  })
})
