import { describe, expect, it } from 'vitest'
import {
  completeWorkflowAgentNode,
  createWorkflowRunFromRequest,
  type Artifact,
} from '@ai-devflow/shared'
import { requireCurrentClarificationRevision, staleClarificationRevisionMessage } from './gate-approval-revision'

const now = '2026-09-28T10:00:00.000Z'

function clarifyGate() {
  const created = createWorkflowRunFromRequest({
    runId: 'run-v3', title: 'Clarify', request: 'Clarify the retry boundary.', projectId: 'project-1',
    creatorId: 'user-1', branchName: 'ai/v3', now,
  })
  const node = created.run.nodes.find((candidate) => candidate.stage === 'clarify' && candidate.kind === 'agent')!
  const revision: Artifact = {
    id: `artifact-${created.run.id}-clarification`, runId: created.run.id, nodeId: node.id, kind: 'clarification',
    title: 'Clarification v1', summary: 'First revision.', content: 'Body.', redacted: true, updatedAt: now,
    clarificationRevision: {
      version: 1, revision: 1, status: 'review_requested', revisionDigest: 'a'.repeat(64),
      rawRequestArtifactId: created.artifacts[0]!.id, feedbackArtifactIds: [],
      goals: ['Goal'], acceptanceCriteria: ['Acceptance'], nonGoals: [], assumptions: [], risks: [], openQuestions: [],
      executor: {
        version: 1, kind: 'direct-provider', executorId: 'fake', executorVersion: '1',
        capabilityProfile: 'repository-read-only-v1', model: 'fake', startedAt: now,
        completedAt: now, durationMs: 1, terminalReason: 'success', contextDigest: 'b'.repeat(64),
      },
      generatedAt: now,
    },
  }
  const completed = completeWorkflowAgentNode({
    run: created.run, nodeId: node.id, artifacts: created.artifacts, generatedArtifact: revision,
    existingEvents: created.events, actorName: 'User', now,
  })
  const gateNode = completed.run.nodes.find((candidate) => candidate.id === completed.run.currentNodeId)!
  const expected = { artifactId: revision.id, revision: 1, revisionDigest: 'a'.repeat(64) }
  return { run: completed.run, gateNode, artifacts: completed.artifacts, revision, expected }
}

describe('clarification Gate approval revision check (plan V3)', () => {
  it('returns the current revision when the approver names it exactly', () => {
    const value = clarifyGate()
    expect(requireCurrentClarificationRevision(value)).toMatchObject({ id: value.revision.id })
  })

  it.each([
    ['missing expectation', (value: ReturnType<typeof clarifyGate>) => ({ ...value, expected: undefined })],
    ['another artifact', (value: ReturnType<typeof clarifyGate>) => ({ ...value, expected: { ...value.expected, artifactId: 'artifact-other' } })],
    ['an older revision number', (value: ReturnType<typeof clarifyGate>) => ({ ...value, expected: { ...value.expected, revision: 0 } })],
    ['a different digest', (value: ReturnType<typeof clarifyGate>) => ({ ...value, expected: { ...value.expected, revisionDigest: 'c'.repeat(64) } })],
  ])('rejects %s', (_label, mutate) => {
    expect(() => requireCurrentClarificationRevision(mutate(clarifyGate()))).toThrow(staleClarificationRevisionMessage)
  })

  it('rejects a revision that was superseded by a newer one', () => {
    const value = clarifyGate()
    const newer: Artifact = {
      ...value.revision,
      id: `${value.revision.id}-v2`,
      updatedAt: '2026-09-28T10:05:00.000Z',
      clarificationRevision: { ...value.revision.clarificationRevision!, revision: 2, revisionDigest: 'd'.repeat(64), previousRevisionArtifactId: value.revision.id },
    }
    expect(() => requireCurrentClarificationRevision({ ...value, artifacts: [...value.artifacts, newer] }))
      .toThrow(staleClarificationRevisionMessage)
  })

  it('rejects a revision that is being revised', () => {
    const value = clarifyGate()
    const artifacts = value.artifacts.map((artifact) => artifact.id === value.revision.id
      ? { ...artifact, clarificationRevision: { ...artifact.clarificationRevision!, status: 'revision_requested' as const } }
      : artifact)
    expect(() => requireCurrentClarificationRevision({ ...value, artifacts })).toThrow(staleClarificationRevisionMessage)
  })

  it('rejects when the Raw Request or the linked revision is missing', () => {
    const value = clarifyGate()
    expect(() => requireCurrentClarificationRevision({ ...value, artifacts: value.artifacts.filter((artifact) => artifact.kind !== 'raw_request') }))
      .toThrow(staleClarificationRevisionMessage)
    expect(() => requireCurrentClarificationRevision({ ...value, gateNode: { ...value.gateNode, artifactIds: [] } }))
      .toThrow(staleClarificationRevisionMessage)
  })
})
