import { describe, expect, it } from 'vitest'
import { evaluateWorkflowCommand, type WorkflowEvidenceSnapshot } from '@ai-devflow/shared'
import { buildF1, buildF3, buildF5, gateProjectionInput, type GateFixture } from '../../testing/gate-fixtures'
import { projectGateDecision } from './projection'
// The bar and the runtime read the same rule (AC32, AC33): the runtime is the authority.
function approve(fixture: GateFixture) {
  const evidence: WorkflowEvidenceSnapshot = { artifacts: fixture.artifacts, codingRuns: [], codingDiffs: [], testEvidence: [], agentReviews: fixture.reviews,
    approval: { roleAllowed: true, policy: { blocksApproval: false }, review: 'not_required', budget: 'not_required' } }
  return evaluateWorkflowCommand({ run: fixture.run, command: { type: 'approve_gate', nodeId: fixture.gateNode.id }, evidence })
}
describe('projectGateDecision agrees with evaluateWorkflowCommand(approve_gate)', () => {
  it('F3: the runtime blocks with clarification_revision_stale and the bar shows the red block with confirm disabled', async () => {
    const f3 = await buildF3()
    const decision = approve(f3)
    expect(decision.allowed).toBe(false)
    expect(decision.blockers.map((blocker) => blocker.code)).toEqual(['clarification_revision_stale'])
    const view = projectGateDecision(await gateProjectionInput(f3))
    expect(view.bar.notes.some((note) => note.tone === 'block')).toBe(true)
    expect(view.bar.buttons.find((button) => button.id === 'confirm')).toMatchObject({ enabled: false })
  })
  it('a requirement without any review: the runtime allows approval and the bar does not block', async () => {
    const f1 = await buildF1()
    const unreviewed = { ...f1, reviews: [] }
    expect(approve(unreviewed)).toEqual({ allowed: true, blockers: [] })
    const view = projectGateDecision(await gateProjectionInput(unreviewed))
    expect(view.bar.notes.some((note) => note.tone === 'block')).toBe(false)
    expect(view.bar.buttons.find((button) => button.id === 'confirm')).toMatchObject({ enabled: true })
  })
  it('F5 (design v2 with only a v1 review): the runtime allows approval and the bar shows the optional note', async () => {
    const f5 = await buildF5()
    expect(approve(f5)).toEqual({ allowed: true, blockers: [] })
    const view = projectGateDecision(await gateProjectionInput(f5))
    expect(view.bar.notes).toEqual([{ tone: 'neutral', text: '重新审查是可选的：已有的审查针对方案 v1，不审查也能确认' }])
    expect(view.bar.buttons.find((button) => button.id === 'confirm')).toMatchObject({ enabled: true, primary: true })
  })
})
