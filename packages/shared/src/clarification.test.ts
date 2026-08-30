import { describe, expect, it } from 'vitest'
import { createWorkflowRunFromRequest, completeWorkflowAgentNode } from './workflow'
import {
  buildClarificationReviewBundle,
  requestClarificationChanges,
} from './clarification'
import type { Artifact } from './domain'

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
