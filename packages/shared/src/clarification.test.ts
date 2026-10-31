import { describe, expect, it } from 'vitest'
import { createWorkflowRunFromRequest, completeWorkflowAgentNode } from './workflow'
import {
  assessClarificationReviewTarget,
  buildClarificationReviewBundle,
  requestClarificationChanges,
} from './clarification'
import type { AgentReviewContextManifest, AgentReviewResult, Artifact } from './domain'

const now = '2026-08-30T12:00:00.000Z'

function fixture() {
  const created = createWorkflowRunFromRequest({
    runId: 'run-clarification-revision',
    title: 'Clarify repository behavior',
    request: 'Explain the behavior before implementation.',
    projectId: 'project-1',
    creatorId: 'user-1',
    branchName: 'codex/clarification-revision',
    now,
  })
  const node = created.run.nodes.find((candidate) => candidate.stage === 'clarify' && candidate.kind === 'agent')!
  const artifact: Artifact = {
    id: `artifact-${created.run.id}-clarification`,
    runId: created.run.id,
    nodeId: node.id,
    kind: 'clarification',
    title: 'Clarification v1',
    summary: 'First revision.',
    content: 'Full clarification body.',
    redacted: true,
    updatedAt: now,
    clarificationRevision: {
      version: 1,
      revision: 1,
      status: 'review_requested',
      revisionDigest: 'a'.repeat(64),
      rawRequestArtifactId: created.artifacts[0]!.id,
      feedbackArtifactIds: [],
      goals: ['Goal'], acceptanceCriteria: ['Acceptance'], nonGoals: ['Non-goal'],
      assumptions: [], risks: [], openQuestions: [],
      executor: {
        version: 1, kind: 'direct-provider', executorId: 'fake', executorVersion: '1',
        capabilityProfile: 'repository-read-only-v1', model: 'fake', startedAt: now,
        completedAt: now, durationMs: 1, terminalReason: 'success', contextDigest: 'b'.repeat(64),
      },
      generatedAt: now,
    },
  }
  const completed = completeWorkflowAgentNode({
    run: created.run,
    nodeId: node.id,
    artifacts: created.artifacts,
    generatedArtifact: artifact,
    existingEvents: created.events,
    actorName: 'User',
    now,
  })
  return { created, artifact, run: completed.run, artifacts: completed.artifacts }
}

describe('clarification revision review', () => {
  it('binds the Gate to one immutable Raw Request and one current revision', () => {
    const value = fixture()
    const gate = value.run.nodes.find((node) => node.id === value.run.currentNodeId)!
    const bundle = buildClarificationReviewBundle({ run: value.run, gateNode: gate, artifacts: value.artifacts })
    expect(bundle).toMatchObject({
      state: 'ready',
      rawRequest: { kind: 'raw_request' },
      activeRevision: { id: value.artifact.id },
    })
  })

  it('records structured feedback, resets clarification, and rejects stale replay', async () => {
    const value = fixture()
    const gate = value.run.nodes.find((node) => node.id === value.run.currentNodeId)!
    const input = {
      run: value.run,
      gateNodeId: gate.id,
      artifacts: value.artifacts,
      existingEvents: [],
      actor: { id: 'reviewer-1', name: 'Reviewer' },
      reason: 'State the repository boundary explicitly.',
      expectedArtifactId: value.artifact.id,
      expectedRevision: 1,
      expectedRevisionDigest: 'a'.repeat(64),
      now: '2026-08-30T12:05:00.000Z',
    }
    const revised = await requestClarificationChanges(input)
    expect(revised.run.currentNodeId).toBe('run-clarification-revision-clarify')
    expect(revised.updatedRevision.clarificationRevision?.status).toBe('revision_requested')
    expect(revised.feedbackArtifact.clarificationFeedback).toMatchObject({
      targetArtifactId: value.artifact.id,
      actorId: 'reviewer-1',
    })
    await expect(requestClarificationChanges({
      ...input,
      run: revised.run,
      artifacts: [...value.artifacts, revised.updatedRevision, revised.feedbackArtifact],
    })).rejects.toThrow()
  })

  it('fails closed when the Gate links a stale revision', () => {
    const value = fixture()
    const gate = value.run.nodes.find((node) => node.id === value.run.currentNodeId)!
    const v2: Artifact = {
      ...value.artifact,
      id: `${value.artifact.id}-v2`,
      updatedAt: '2026-08-30T12:10:00.000Z',
      clarificationRevision: { ...value.artifact.clarificationRevision!, revision: 2, revisionDigest: 'c'.repeat(64) },
    }
    const bundle = buildClarificationReviewBundle({
      run: value.run,
      gateNode: gate,
      artifacts: [...value.artifacts, v2],
    })
    expect(bundle.state).toBe('stale_revision')
  })
})

describe('assessClarificationReviewTarget', () => {
  function review(
    value: ReturnType<typeof fixture>,
    overrides: Partial<AgentReviewResult> & { subject?: { id: string; updatedAt: string } | null } = {},
  ): AgentReviewResult {
    const { subject, ...rest } = overrides
    const gateNodeId = value.run.currentNodeId
    const manifest = {
      version: 1,
      subjectArtifacts: subject === null
        ? []
        : [{
            id: subject?.id ?? value.artifact.id,
            runId: value.run.id,
            nodeId: gateNodeId,
            kind: 'clarification',
            updatedAt: subject?.updatedAt ?? value.artifact.updatedAt,
          }],
    } as unknown as AgentReviewContextManifest
    return {
      id: 'review-1',
      requestId: 'request-1',
      runId: value.run.id,
      nodeId: gateNodeId,
      projectId: 'project-1',
      createdAt: '2026-08-30T12:01:00.000Z',
      contextManifest: manifest,
      ...rest,
    } as AgentReviewResult
  }

  function assess(value: ReturnType<typeof fixture>, reviews: AgentReviewResult[]) {
    return assessClarificationReviewTarget({
      runId: value.run.id,
      gateNodeId: value.run.currentNodeId,
      reviews,
      activeRevision: value.artifact,
    })
  }

  it('returns none when the Gate node has no review', () => {
    const value = fixture()
    expect(assess(value, [])).toEqual({ state: 'none' })
    expect(assess(value, [review(value, { nodeId: 'other-node' }), review(value, { runId: 'other-run' })]))
      .toEqual({ state: 'none' })
  })

  it('returns legacy when the latest review has no context manifest', () => {
    const value = fixture()
    const legacy = review(value, { id: 'review-legacy', createdAt: '2026-08-30T12:02:00.000Z' })
    delete legacy.contextManifest
    expect(assess(value, [review(value), legacy])).toMatchObject({ state: 'legacy', review: { id: 'review-legacy' } })
  })

  it('returns current when the latest review targets the active revision', () => {
    const value = fixture()
    const old = review(value, { id: 'review-old', subject: { id: 'artifact-old', updatedAt: now } })
    const latest = review(value, { id: 'review-latest', createdAt: '2026-08-30T12:03:00.000Z' })
    expect(assess(value, [old, latest])).toMatchObject({ state: 'current', review: { id: 'review-latest' } })
  })

  it('returns stale with the reviewed artifact when the subject differs or is missing', () => {
    const value = fixture()
    expect(assess(value, [review(value, { subject: { id: 'artifact-v0', updatedAt: now } })]))
      .toMatchObject({ state: 'stale', reviewedArtifactId: 'artifact-v0' })
    expect(assess(value, [review(value, { subject: { id: value.artifact.id, updatedAt: '2026-08-30T11:00:00.000Z' } })]))
      .toMatchObject({ state: 'stale', reviewedArtifactId: value.artifact.id })
    const missing = assess(value, [review(value, { subject: null })])
    expect(missing.state).toBe('stale')
    expect(missing).not.toHaveProperty('reviewedArtifactId')
  })
})
