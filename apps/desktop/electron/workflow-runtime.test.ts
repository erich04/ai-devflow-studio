import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  createWorkflowRunFromRequest,
  redactTestEvidenceForStorage,
  type AgentEvent,
  type AgentReviewResult,
  type Artifact,
  type CodingAgentRun,
  type CodingDiffArtifact,
  type TestEvidence,
  type WorkflowApprovalEvidence,
} from '@ai-devflow/shared'
import { createLocalStore } from './local-store'
import {
  createTrustedGateOverrideDraft,
  createWorkflowRuntime,
  resolveTrustedWorkflowActor,
  type ExecuteWorkflowCommandInput,
  type WorkflowRuntime,
} from './workflow-runtime'

const now = '2026-07-31T12:00:00.000Z'
const allowedApproval: WorkflowApprovalEvidence = {
  roleAllowed: true,
  policy: { blocksApproval: false },
  review: 'not_required',
  budget: 'not_required',
}
let tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

async function createStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'devflow-workflow-runtime-'))
  tempDirs.push(dir)
  return createLocalStore({ dbPath: path.join(dir, 'devflow.sqlite') })
}

function clarificationCandidate(runId: string, nodeId: string) {
  const artifact: Artifact = {
    id: `artifact-${runId}-clarification`,
    runId,
    nodeId,
    kind: 'clarification',
    title: 'Clarification',
    summary: 'Scope and acceptance criteria are explicit.',
    content: 'Clarification is ready for approval.',
    redacted: true,
    updatedAt: now,
  }
  const event: AgentEvent = {
    id: `event-${runId}-clarification`,
    runId,
    nodeId,
    sequence: 1,
    kind: 'tool_result',
    message: 'Clarification artifact generated.',
    timestamp: now,
  }
  return { artifact, event }
}

async function executeApplied(
  runtime: WorkflowRuntime,
  input: ExecuteWorkflowCommandInput,
) {
  const result = await runtime.execute(input)
  if (!result.applied) {
    throw new Error(
      `Expected workflow command to apply: ${result.blockers
        .map((blocker) => `${blocker.code}: ${blocker.message}`)
        .join(', ')}`,
    )
  }
  expect(result.applied).toBe(true)
  return result
}

describe('workflow runtime', () => {
  it('derives the Gate actor from trusted local state instead of renderer identity fields', () => {
    const created = createWorkflowRunFromRequest({
      runId: 'run-trusted-actor',
      title: 'Derive trusted Gate actor',
      request: 'Keep approval identity inside Electron main.',
      projectId: 'project-1',
      creatorId: 'local-creator',
      branchName: 'ai/trusted-actor',
      now,
    })
    const pairing = {
      tokenId: 'desktop-token-1',
      organizationId: 'org-1',
      projectId: 'team-project-1',
      localProjectId: 'project-1',
      userId: 'paired-lead',
      role: 'lead' as const,
      authAccountId: 'account-1',
      projectMemberships: [
        { projectId: 'team-project-1', userId: 'paired-lead', role: 'lead' as const },
      ],
      createdAt: now,
    }

    expect(resolveTrustedWorkflowActor(created.run, pairing)).toEqual({
      userId: 'paired-lead',
      userName: 'paired-lead',
      role: 'lead',
    })
    expect(
      resolveTrustedWorkflowActor(created.run, {
        ...pairing,
        localProjectId: 'another-local-project',
      }),
    ).toEqual({
      userId: 'local-creator',
      userName: 'local-creator',
      role: 'owner',
    })
  })

  it('builds Gate override audit fields from canonical run, actor, and policy state', () => {
    const created = createWorkflowRunFromRequest({
      runId: 'run-trusted-override',
      title: 'Build a trusted override',
      request: 'Do not accept derived audit fields from the renderer.',
      projectId: 'project-1',
      creatorId: 'local-creator',
      branchName: 'ai/trusted-override',
      now,
    })
    const node = created.run.nodes.find((candidate) => candidate.kind === 'gate')!
    const draft = createTrustedGateOverrideDraft({
      id: 'override-1',
      run: created.run,
      node,
      actor: { userId: 'paired-lead', userName: 'Paired Lead', role: 'lead' },
      reason: 'Reviewed the canonical blocker.',
      decision: {
        status: 'blocked',
        blocksApproval: true,
        blockingReasons: [{
          id: 'canonical-blocker',
          target: 'governance_check',
          ruleKey: 'canonical-blocker',
          action: 'block',
          summary: 'Canonical blocker.',
        }],
        warningReasons: [],
        requiredActions: [],
        canOverride: true,
        overrideRoleRequired: 'lead',
        policySource: 'remote_cache',
        policyVersion: 7,
        provisional: false,
      },
      createdAt: now,
    })

    expect(draft).toEqual({
      id: 'override-1',
      runId: created.run.id,
      nodeId: node.id,
      projectId: created.run.projectId,
      userId: 'paired-lead',
      role: 'lead',
      reason: 'Reviewed the canonical blocker.',
      blockedReasonIds: ['canonical-blocker'],
      policyVersion: 7,
      provisional: true,
      status: 'provisional',
      createdAt: now,
    })
  })

  it('reloads the current run, atomically commits candidate evidence, and rejects a duplicate command', async () => {
    const created = createWorkflowRunFromRequest({
      runId: 'run-runtime-agent',
      title: 'Runtime agent completion',
      request: 'Advance using the trusted runtime.',
      projectId: 'project-1',
      creatorId: 'user-1',
      branchName: 'ai/runtime-agent',
      now,
    })
    const nodeId = 'run-runtime-agent-clarify'
    const gateId = 'run-runtime-agent-clarify-gate'
    const candidate = clarificationCandidate(created.run.id, nodeId)
    const store = await createStore()
    await store.saveRun(created.run)
    const runtime = createWorkflowRuntime(store)

    const first = await runtime.execute({
      runId: created.run.id,
      expectedRunUpdatedAt: created.run.updatedAt,
      command: {
        type: 'complete_agent',
        nodeId,
        artifactId: candidate.artifact.id,
      },
      candidates: {
        artifacts: [candidate.artifact],
        events: [candidate.event],
      },
      now: '2026-07-31T12:01:00.000Z',
    })

    expect(first.applied).toBe(true)
    expect(first.run).toMatchObject({
      version: 2,
      currentNodeId: gateId,
      status: 'paused_at_gate',
    })
    expect((await store.getRun(created.run.id))?.version).toBe(2)
    expect(await store.listArtifacts(created.run.id)).toEqual([candidate.artifact])
    expect(await store.listEvents(created.run.id)).toEqual([candidate.event])

    const duplicate = await runtime.execute({
      runId: created.run.id,
      command: {
        type: 'complete_agent',
        nodeId,
        artifactId: candidate.artifact.id,
      },
      candidates: {
        artifacts: [candidate.artifact],
        events: [candidate.event],
      },
      now: '2026-07-31T12:02:00.000Z',
    })

    expect(duplicate.applied).toBe(false)
    expect(duplicate.blockers.map((blocker) => blocker.code)).toEqual([
      'not_current_node',
    ])
    expect(duplicate.run?.version).toBe(2)
    expect((await store.getRun(created.run.id))?.version).toBe(2)
    expect(await store.listArtifacts(created.run.id)).toEqual([candidate.artifact])
    expect(await store.listEvents(created.run.id)).toEqual([candidate.event])
    store.close()
  })

  it('rejects an explicitly stale command before committing candidate evidence', async () => {
    const created = createWorkflowRunFromRequest({
      runId: 'run-runtime-stale',
      title: 'Reject stale runtime command',
      request: 'Do not commit evidence against a stale Run snapshot.',
      projectId: 'project-1',
      creatorId: 'user-1',
      branchName: 'ai/runtime-stale',
      now,
    })
    const nodeId = 'run-runtime-stale-clarify'
    const candidate = clarificationCandidate(created.run.id, nodeId)
    const store = await createStore()
    await store.saveRun(created.run)
    const runtime = createWorkflowRuntime(store)

    const result = await runtime.execute({
      runId: created.run.id,
      expectedRunUpdatedAt: '2026-07-31T11:59:00.000Z',
      command: {
        type: 'complete_agent',
        nodeId,
        artifactId: candidate.artifact.id,
      },
      candidates: {
        artifacts: [candidate.artifact],
        events: [candidate.event],
      },
      now: '2026-07-31T12:01:00.000Z',
    })

    expect(result.applied).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(['stale_run'])
    expect(await store.getRun(created.run.id)).toEqual(created.run)
    expect(await store.listArtifacts(created.run.id)).toEqual([])
    expect(await store.listEvents(created.run.id)).toEqual([])
    store.close()
  })

  it('rejects a valid command that attempts to bundle evidence from another node', async () => {
    const created = createWorkflowRunFromRequest({
      runId: 'run-runtime-candidate-scope',
      title: 'Reject cross-node candidates',
      request: 'Commit evidence only for the command node.',
      projectId: 'project-1',
      creatorId: 'user-1',
      branchName: 'ai/runtime-candidate-scope',
      now,
    })
    const nodeId = 'run-runtime-candidate-scope-clarify'
    const candidate = clarificationCandidate(created.run.id, nodeId)
    const unrelatedArtifact: Artifact = {
      ...candidate.artifact,
      id: 'artifact-unrelated-design-node',
      nodeId: 'run-runtime-candidate-scope-design',
    }
    const store = await createStore()
    await store.saveRun(created.run)
    const runtime = createWorkflowRuntime(store)

    const result = await runtime.execute({
      runId: created.run.id,
      command: {
        type: 'complete_agent',
        nodeId,
        artifactId: candidate.artifact.id,
      },
      candidates: {
        artifacts: [candidate.artifact, unrelatedArtifact],
      },
      now: '2026-07-31T12:01:00.000Z',
    })

    expect(result.applied).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      'evidence_scope_mismatch',
    ])
    expect(await store.getRun(created.run.id)).toEqual(created.run)
    expect(await store.listArtifacts(created.run.id)).toEqual([])
    store.close()
  })

  it('does not partially commit rejected test evidence, report, or event candidates', async () => {
    const created = createWorkflowRunFromRequest({
      runId: 'run-runtime-test-rejection',
      title: 'Reject invalid test bundle',
      request: 'Keep rejected test candidates out of the store.',
      projectId: 'project-1',
      creatorId: 'user-1',
      branchName: 'ai/runtime-test-rejection',
      now,
    })
    const testNodeId = 'run-runtime-test-rejection-test'
    const testRun = {
      ...created.run,
      status: 'testing' as const,
      currentNodeId: testNodeId,
      nodes: created.run.nodes.map((node) => {
        if (
          node.stage === 'clarify' ||
          node.stage === 'design' ||
          node.stage === 'build'
        ) {
          return { ...node, status: 'success' as const }
        }
        if (node.id === testNodeId) {
          return { ...node, status: 'running' as const }
        }
        return node
      }),
    }
    const testEvidence: TestEvidence = {
      id: 'test-evidence-runtime-rejected',
      runId: created.run.id,
      nodeId: testNodeId,
      projectId: created.run.projectId,
      command: 'pnpm test',
      cwd: '/workspace/runtime-rejected',
      status: 'passed',
      exitCode: 0,
      durationMs: 100,
      stdout: 'tests passed',
      stderr: '',
      summary: 'Tests passed.',
      redacted: true,
      createdAt: '2026-07-31T12:01:00.000Z',
    }
    const unrelatedReport: Artifact = {
      ...createTestEvidenceArtifact(testEvidence),
      id: 'artifact-unrelated-test-report',
    }
    const testEvent = createTestEvidenceEvent(testEvidence, 1)
    const store = await createStore()
    await store.saveRun(testRun)
    const runtime = createWorkflowRuntime(store)

    const result = await runtime.execute({
      runId: created.run.id,
      command: {
        type: 'record_test_result',
        nodeId: testNodeId,
        evidenceId: testEvidence.id,
        artifactId: unrelatedReport.id,
      },
      candidates: {
        artifacts: [unrelatedReport],
        events: [testEvent],
        testEvidence: [testEvidence],
      },
      now: '2026-07-31T12:01:00.000Z',
    })

    expect(result.applied).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      'evidence_scope_mismatch',
    ])
    expect(await store.getRun(created.run.id)).toEqual(testRun)
    expect(await store.listArtifacts(created.run.id)).toEqual([])
    expect(await store.listEvents(created.run.id)).toEqual([])
    expect(await store.listTestEvidence(created.run.id)).toEqual([])
    store.close()
  })

  it('executes the complete trusted workflow using stored coding evidence and atomic test candidates', async () => {
    const created = createWorkflowRunFromRequest({
      runId: 'run-runtime-full',
      title: 'Trusted workflow',
      request: 'Exercise every workflow runtime command.',
      projectId: 'project-1',
      creatorId: 'user-1',
      branchName: 'ai/runtime-full',
      now,
    })
    const ids = {
      clarify: 'run-runtime-full-clarify',
      clarifyGate: 'run-runtime-full-clarify-gate',
      design: 'run-runtime-full-design',
      designGate: 'run-runtime-full-design-gate',
      build: 'run-runtime-full-build',
      test: 'run-runtime-full-test',
      pr: 'run-runtime-full-pr',
      accept: 'run-runtime-full-accept',
    }
    const store = await createStore()
    await store.saveRun(created.run)
    const runtime = createWorkflowRuntime(store)

    const clarification = clarificationCandidate(created.run.id, ids.clarify)
    await executeApplied(runtime, {
      runId: created.run.id,
      command: {
        type: 'complete_agent',
        nodeId: ids.clarify,
        artifactId: clarification.artifact.id,
      },
      candidates: {
        artifacts: [clarification.artifact],
        events: [clarification.event],
      },
      now: '2026-07-31T12:01:00.000Z',
    })
    await executeApplied(runtime, {
      runId: created.run.id,
      command: { type: 'approve_gate', nodeId: ids.clarifyGate },
      approval: allowedApproval,
      now: '2026-07-31T12:02:00.000Z',
    })

    const designArtifact: Artifact = {
      id: 'artifact-run-runtime-full-design',
      runId: created.run.id,
      nodeId: ids.design,
      kind: 'design',
      title: 'Design',
      summary: 'Implementation and test strategy are ready.',
      content: 'Trusted runtime design.',
      redacted: true,
      updatedAt: '2026-07-31T12:03:00.000Z',
    }
    await executeApplied(runtime, {
      runId: created.run.id,
      command: {
        type: 'complete_agent',
        nodeId: ids.design,
        artifactId: designArtifact.id,
      },
      candidates: { artifacts: [designArtifact] },
      now: '2026-07-31T12:03:00.000Z',
    })
    await executeApplied(runtime, {
      runId: created.run.id,
      command: { type: 'approve_gate', nodeId: ids.designGate },
      approval: allowedApproval,
      now: '2026-07-31T12:04:00.000Z',
    })

    const codingRun: CodingAgentRun = {
      id: 'coding-run-runtime-full',
      runId: created.run.id,
      nodeId: ids.build,
      projectId: created.run.projectId,
      requestedBy: 'user-1',
      providerId: 'fake',
      engine: 'fake',
      status: 'completed',
      managedWorkspaceId: 'workspace-runtime-full',
      branchName: created.run.branchName,
      userInstruction: 'Implement the trusted workflow.',
      prompt: 'Implement the trusted workflow.',
      summary: 'Coding completed.',
      changedPaths: ['src/workflow.ts'],
      startedAt: '2026-07-31T12:04:00.000Z',
      completedAt: '2026-07-31T12:05:00.000Z',
      diffArtifactId: 'diff-runtime-full',
      redacted: true,
    }
    const codingDiff: CodingDiffArtifact = {
      id: 'diff-runtime-full',
      runId: created.run.id,
      nodeId: ids.build,
      projectId: created.run.projectId,
      changedPaths: ['src/workflow.ts'],
      patch: 'diff --git a/src/workflow.ts b/src/workflow.ts',
      truncated: false,
      redacted: true,
      createdAt: '2026-07-31T12:05:00.000Z',
    }
    const missingCodingEvidence = await runtime.execute({
      runId: created.run.id,
      command: {
        type: 'complete_build',
        nodeId: ids.build,
        codingRunId: codingRun.id,
        diffId: codingDiff.id,
      },
      now: '2026-07-31T12:05:00.000Z',
    })
    expect(missingCodingEvidence.applied).toBe(false)
    expect(
      missingCodingEvidence.blockers.map((blocker) => blocker.code),
    ).toEqual(['coding_run_missing'])
    await store.saveCodingAgentRun(codingRun)
    await store.saveCodingDiffArtifact(codingDiff)
    await executeApplied(runtime, {
      runId: created.run.id,
      command: {
        type: 'complete_build',
        nodeId: ids.build,
        codingRunId: codingRun.id,
        diffId: codingDiff.id,
      },
      now: '2026-07-31T12:06:00.000Z',
    })

    const testEvidence: TestEvidence = {
      id: 'test-evidence-runtime-full',
      runId: created.run.id,
      nodeId: ids.test,
      projectId: created.run.projectId,
      command: 'pnpm test',
      cwd: '/workspace/runtime-full',
      status: 'passed',
      exitCode: 0,
      durationMs: 1200,
      stdout: '126 tests passed',
      stderr: '',
      summary: 'All tests passed.',
      redacted: true,
      createdAt: '2026-07-31T12:07:00.000Z',
    }
    const testReport = createTestEvidenceArtifact(testEvidence)
    const testEvent = createTestEvidenceEvent(testEvidence, 2)
    await executeApplied(runtime, {
      runId: created.run.id,
      command: {
        type: 'record_test_result',
        nodeId: ids.test,
        evidenceId: testEvidence.id,
        artifactId: testReport.id,
      },
      candidates: {
        artifacts: [testReport],
        events: [testEvent],
        testEvidence: [testEvidence],
      },
      now: '2026-07-31T12:07:00.000Z',
    })
    expect(await store.listTestEvidence(created.run.id)).toEqual([
      redactTestEvidenceForStorage(testEvidence),
    ])
    expect(await store.listArtifacts(created.run.id)).toContainEqual(testReport)

    const prArtifact: Artifact = {
      id: 'artifact-pr-runtime-full',
      runId: created.run.id,
      nodeId: ids.pr,
      kind: 'pr',
      title: 'PR draft',
      summary: 'Diff and test evidence are linked.',
      content: 'Trusted PR delivery bundle.',
      redacted: true,
      updatedAt: '2026-07-31T12:08:00.000Z',
    }
    await executeApplied(runtime, {
      runId: created.run.id,
      command: {
        type: 'complete_pr',
        nodeId: ids.pr,
        artifactId: prArtifact.id,
      },
      candidates: { artifacts: [prArtifact] },
      now: '2026-07-31T12:08:00.000Z',
    })

    const acceptanceArtifact: Artifact = {
      id: 'artifact-acceptance-runtime-full',
      runId: created.run.id,
      nodeId: ids.accept,
      kind: 'acceptance',
      title: 'Acceptance bundle',
      summary: 'All delivery evidence is present.',
      content: 'Ready for final approval.',
      redacted: true,
      updatedAt: '2026-07-31T12:09:00.000Z',
    }
    await executeApplied(runtime, {
      runId: created.run.id,
      command: {
        type: 'attach_acceptance_bundle',
        nodeId: ids.accept,
        artifactId: acceptanceArtifact.id,
      },
      candidates: { artifacts: [acceptanceArtifact] },
      now: '2026-07-31T12:09:00.000Z',
    })

    const review: AgentReviewResult = {
      id: 'review-runtime-full',
      requestId: 'review-request-runtime-full',
      runId: created.run.id,
      nodeId: ids.accept,
      projectId: created.run.projectId,
      runtime: 'electron',
      providerId: 'fake-review',
      model: 'fake',
      conclusion: 'Delivery is ready.',
      summary: 'No blocking evidence gaps remain.',
      risks: [],
      missingEvidence: [],
      suggestedTests: [],
      knowledgeReferences: [],
      policyFindings: [],
      confidence: 0.95,
      gateAdvisory: {
        id: 'advisory-runtime-full',
        runId: created.run.id,
        nodeId: ids.accept,
        level: 'info',
        blocksApproval: false,
        summary: 'Acceptance can proceed.',
        missingEvidence: [],
        riskCount: 0,
        createdAt: '2026-07-31T12:10:00.000Z',
      },
      createdAt: '2026-07-31T12:10:00.000Z',
    }
    await store.saveAgentReview(review)
    const completed = await executeApplied(runtime, {
      runId: created.run.id,
      command: { type: 'approve_acceptance', nodeId: ids.accept },
      approval: {
        roleAllowed: true,
        policy: { blocksApproval: false },
        review: 'required',
        budget: 'required',
      },
      budgetDecision: {
        status: 'allowed',
        blocksRun: false,
        currentSpendUsd: 1,
        projectedCostUsd: 0.1,
        reason: 'Within budget.',
      },
      now: '2026-07-31T12:11:00.000Z',
    })
    expect(completed.run).toMatchObject({ status: 'completed', version: 10 })
    expect((await store.getRun(created.run.id))?.version).toBe(10)

    const afterTerminal = await runtime.execute({
      runId: created.run.id,
      command: { type: 'approve_acceptance', nodeId: ids.accept },
      approval: allowedApproval,
      now: '2026-07-31T12:12:00.000Z',
    })
    expect(afterTerminal.applied).toBe(false)
    expect(afterTerminal.blockers.map((blocker) => blocker.code)).toEqual([
      'run_terminal',
    ])
    expect(afterTerminal.run?.version).toBe(10)
    expect((await store.getRun(created.run.id))?.version).toBe(10)
    store.close()
  })
})
