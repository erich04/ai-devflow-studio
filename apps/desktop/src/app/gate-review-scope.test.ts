import { describe, expect, it } from 'vitest'
import type { AgentReviewResult, Artifact, WorkflowNode, WorkflowRun } from '@ai-devflow/shared'
import { describeGateReviewScope } from './gate-review-scope'

const formatTime = (iso: string) => `T(${iso})`
const gate = { id: 'gate', stage: 'clarify', kind: 'gate', artifactIds: ['v2'] } as WorkflowNode
const run = {
  id: 'run-1',
  nodes: [{ id: 'agent', stage: 'clarify', kind: 'agent', artifactIds: [] }, gate],
  edges: [{ id: 'e', source: 'agent', target: 'gate' }],
} as unknown as WorkflowRun
const requirement = (id: string, revision: number | undefined, updatedAt: string) => ({
  id, runId: 'run-1', nodeId: 'agent', kind: 'clarification', updatedAt,
  ...(revision ? { clarificationRevision: { revision } } : {}),
}) as Artifact
const reviewOf = (subject: Artifact | undefined, stage = 'clarify') => ({
  id: 'review-1',
  ...(subject ? {
    contextManifest: {
      stage,
      subjectArtifacts: [{ id: subject.id, runId: subject.runId, nodeId: subject.nodeId, kind: subject.kind, updatedAt: subject.updatedAt }],
    },
  } : {}),
}) as unknown as AgentReviewResult

describe('describeGateReviewScope (#251)', () => {
  const v1 = requirement('v1', 1, '2026-10-18T01:00:00.000Z')
  const v2 = requirement('v2', 2, '2026-10-18T02:00:00.000Z')

  it('names the requirement version a review covered and whether it is still current', () => {
    expect(describeGateReviewScope({ review: reviewOf(v1), run, node: gate, artifacts: [v1, v2], formatTime }))
      .toEqual({ appliesToCurrent: false, reviewedLabel: '需求 v1' })
    expect(describeGateReviewScope({ review: reviewOf(v2), run, node: gate, artifacts: [v1, v2], formatTime }))
      .toEqual({ appliesToCurrent: true, reviewedLabel: '需求 v2' })
  })

  it('falls back to the recorded time when the requirement has no version metadata', () => {
    const legacy = requirement('legacy', undefined, '2026-10-18T00:30:00.000Z')
    expect(describeGateReviewScope({ review: reviewOf(legacy), run, node: gate, artifacts: [legacy, v2], formatTime }))
      .toEqual({ appliesToCurrent: false, reviewedLabel: '需求（记录于 T(2026-10-18T00:30:00.000Z)）' })
  })

  it('treats a review without a subject manifest as current and unnamed, as enforcement does', () => {
    expect(describeGateReviewScope({ review: reviewOf(undefined), run, node: gate, artifacts: [v2], formatTime }))
      .toEqual({ appliesToCurrent: true, reviewedLabel: undefined })
  })

  it('labels design reviews by recorded time', () => {
    const design = { id: 'd1', runId: 'run-1', nodeId: 'design-agent', kind: 'design', updatedAt: '2026-10-18T03:00:00.000Z' } as Artifact
    const designGate = { id: 'design-gate', stage: 'design', kind: 'gate', artifactIds: ['d2'] } as WorkflowNode
    expect(describeGateReviewScope({ review: reviewOf(design, 'design'), run, node: designGate, artifacts: [design], formatTime }))
      .toMatchObject({ appliesToCurrent: false, reviewedLabel: '方案（记录于 T(2026-10-18T03:00:00.000Z)）' })
  })
})
