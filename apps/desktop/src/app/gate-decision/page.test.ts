import { describe, expect, it } from 'vitest'
import type { AgentEvent, WorkflowRun } from '@ai-devflow/shared'
import { buildF1, buildF3, buildF4, buildF5, nodeIdsOf, type GateFixture } from '../../testing/gate-fixtures'
import { resolveGatePage } from './page'
const withNodes = (run: WorkflowRun, changes: Record<string, Partial<WorkflowRun['nodes'][number]>>, currentNodeId = run.currentNodeId): WorkflowRun =>
  ({ ...run, currentNodeId, nodes: run.nodes.map((node) => ({ ...node, ...changes[node.id] })) })
const page = (fixture: GateFixture, nodeId: string, run = fixture.run, extra: { readingArtifactId?: string; events?: AgentEvent[] } = {}) =>
  resolveGatePage({ run, node: run.nodes.find((node) => node.id === nodeId)!, artifacts: fixture.artifacts, reviews: fixture.reviews, events: extra.events ?? fixture.events,
    ...(extra.readingArtifactId ? { readingArtifactId: extra.readingArtifactId } : {}) })
const ids = nodeIdsOf()
describe('resolveGatePage (the 9 rows of §5.1)', () => {
  it('row 1: a revision_requested latest revision is revision-pending on either node', async () => {
    const f1 = await buildF1()
    const requested = { ...f1, artifacts: f1.artifacts.map((artifact) => artifact.id === f1.current.id ? { ...artifact, clarificationRevision: { ...artifact.clarificationRevision!, status: 'revision_requested' as const } } : artifact) }
    const run = withNodes(f1.run, { [ids.clarifyGate]: { status: 'pending', artifactIds: [] }, [ids.clarify]: { status: 'running' } }, ids.clarify)
    for (const node of [ids.clarify, ids.clarifyGate]) {
      const result = page(requested, node, run)!
      expect([result.kind, result.mode, result.row]).toEqual(['requirement', 'revision-pending', 1])
      expect(result.current.artifact.id).toBe(f1.current.id)
      expect(result.currentReview?.id).toBe(f1.review!.id)
    }
  })
  it('row 2: a successful clarify gate is finished and shows the approved revision', async () => {
    const f1 = await buildF1()
    const approved = { ...f1, artifacts: f1.artifacts.map((artifact) => artifact.id === f1.current.id ? { ...artifact, clarificationRevision: { ...artifact.clarificationRevision!, status: 'approved' as const } } : artifact) }
    const run = withNodes(f1.run, { [ids.clarifyGate]: { status: 'success' } }, ids.design)
    expect(page(approved, ids.clarify, run)).toMatchObject({ mode: 'finished', row: 2, current: { label: '需求 v1' } })
  })
  it('row 3: the current running clarify gate; row 4: its agent node is a sub-step', async () => {
    const f1 = await buildF1()
    expect(page(f1, ids.clarifyGate)).toMatchObject({ kind: 'requirement', mode: 'current', row: 3, determinable: true, current: { number: 1, label: '需求 v1' } })
    expect(page(f1, ids.clarify)).toMatchObject({ mode: 'sub-step', row: 4 })
  })
  it('row 5: no clarification revision keeps today\'s UI', async () => {
    const f1 = await buildF1()
    const run = withNodes(f1.run, { [ids.clarify]: { status: 'running' }, [ids.clarifyGate]: { status: 'pending', artifactIds: [] } }, ids.clarify)
    const empty = { ...f1, artifacts: f1.artifacts.filter((artifact) => artifact.kind !== 'clarification') }
    expect(page(empty, ids.clarify, run)).toBeUndefined()
    expect(page(empty, ids.clarifyGate, run)).toBeUndefined()
  })
  it('rows 6–8: design finished, current (generation only while running) and sub-step', async () => {
    const f4 = await buildF4()
    expect(page(f4, ids.designGate)).toMatchObject({ kind: 'design', mode: 'current', row: 7, generationAllowed: true, current: { label: '方案 v1' } })
    const blocked = withNodes(f4.run, { [ids.designGate]: { status: 'blocked' } })
    expect(page(f4, ids.designGate, blocked)).toMatchObject({ mode: 'current', generationAllowed: false })
    expect(page(f4, ids.design)).toMatchObject({ mode: 'sub-step', row: 8 })
    const event: AgentEvent = { id: 'e', runId: f4.run.id, nodeId: ids.designGate, sequence: 9, kind: 'approval', message: '确认', timestamp: '2026-10-30T09:00:00.000Z',
      designAudit: { version: 1, action: 'approved', actorId: 'user-1', artifactId: f4.current.id, updatedAt: f4.current.updatedAt, contentDigest: 'x' } }
    const finished = withNodes(f4.run, { [ids.designGate]: { status: 'success' } }, `${f4.run.id}-build`)
    expect(page(f4, ids.design, finished, { events: [event] })).toMatchObject({ mode: 'finished', row: 6, current: { artifact: { id: f4.current.id } } })
  })
  it('row 9: any other node or a gate that is not current', async () => {
    const f1 = await buildF1()
    const other = f1.run.nodes.find((node) => node.stage === 'build')!
    expect(page(f1, other.id)).toBeUndefined()
    const f4 = await buildF4()
    expect(page(f4, ids.designGate, withNodes(f4.run, {}, ids.clarifyGate))).toBeUndefined()
  })
  it('uses the gate node\'s latest review in current mode and the review of vM in history mode', async () => {
    const f3 = await buildF3()
    const current = page(f3, ids.clarifyGate)!
    expect(current.current.label).toBe('需求 v2')
    expect(current.currentReview?.id).toBe('review-f1')          // targets v1: the FR-7.7(a) block
    expect(current.reading.artifact.id).toBe(f3.current.id)
    const history = page(f3, ids.clarifyGate, f3.run, { readingArtifactId: f3.previous!.id })!
    expect(history.reading.label).toBe('需求 v1')
    expect(history.readingReview?.id).toBe('review-f1')
    expect(history.current.label).toBe('需求 v2')
    const f5 = await buildF5()
    const design = page(f5, ids.designGate, f5.run, { readingArtifactId: f5.previous!.id })!
    expect([design.current.label, design.reading.label, design.readingReview?.id]).toEqual(['方案 v2', '方案 v1', 'review-f4'])
    const v2history = page(f5, ids.designGate)!
    expect(v2history.readingReview?.id).toBe('review-f4')
  })
  it('marks a gate whose identity is not determinable', async () => {
    const f1 = await buildF1()
    const ambiguous = withNodes(f1.run, { [ids.clarifyGate]: { artifactIds: [f1.current.id, 'other'] } })
    const fixture = { ...f1, artifacts: [...f1.artifacts, { ...f1.current, id: 'other', updatedAt: '2026-10-30T08:06:00.000Z' }] }
    expect(page(fixture, ids.clarifyGate, ambiguous)).toMatchObject({ determinable: false, determinableMessage: '当前 Gate 关联了多个 Clarification Revision，已安全阻断审批。' })
  })
})
