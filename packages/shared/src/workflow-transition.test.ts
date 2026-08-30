import { describe, expect, it } from 'vitest'
import {
  applyWorkflowCommand,
  createWorkflowRunFromRequest,
  evaluateWorkflowCommand,
  type AgentReviewResult,
  type Artifact,
  type CodingAgentRun,
  type CodingDiffArtifact,
  type GitHubDeliveryIntent,
  type TestEvidence,
  type WorkflowEvidenceSnapshot,
} from './index'

const now = '2026-07-31T12:00:00.000Z'

function clarificationArtifact(runId: string, nodeId: string): Artifact {
  return {
    id: `artifact-${runId}-clarification`,
    runId,
    nodeId,
    kind: 'clarification',
    title: '需求澄清结果',
    summary: 'Scope clarified.',
    content: 'Acceptance criteria are explicit.',
    redacted: true,
    updatedAt: now,
  }
}

function currentClarificationGate() {
  const created = createWorkflowRunFromRequest({
    runId: 'run-transition',
    title: 'Close the delivery workflow',
    request: 'Make workflow transitions evidence-backed.',
    projectId: 'project-1',
    creatorId: 'user-1',
    branchName: 'ai/workflow-transition',
    now,
  })
  const gateId = 'run-transition-clarify-gate'
  const artifact = clarificationArtifact(created.run.id, 'run-transition-clarify')
  const run = {
    ...created.run,
    status: 'paused_at_gate' as const,
    currentNodeId: gateId,
    nodes: created.run.nodes.map((node) => {
      if (node.id === 'run-transition-clarify') {
        return { ...node, status: 'success' as const, artifactIds: [...node.artifactIds, artifact.id] }
      }
      if (node.id === gateId) {
        return { ...node, status: 'running' as const, artifactIds: [artifact.id] }
      }
      return node
    }),
  }
  const evidence: WorkflowEvidenceSnapshot = {
    artifacts: [...created.artifacts, artifact],
    codingRuns: [],
    codingDiffs: [],
    testEvidence: [],
    agentReviews: [],
    approval: {
      roleAllowed: true,
      policy: { blocksApproval: false },
      review: 'not_required',
      budget: 'not_required',
    },
  }

  return { run, evidence, gateId }
}

function currentDesignGate() {
  const clarification = currentClarificationGate()
  const advanced = applyWorkflowCommand({
    run: clarification.run,
    command: { type: 'approve_gate', nodeId: clarification.gateId },
    evidence: clarification.evidence,
    now,
  })
  if (!advanced.applied) {
    throw new Error('Expected clarification fixture to advance')
  }

  const designNodeId = 'run-transition-design'
  const gateId = 'run-transition-design-gate'
  const artifact: Artifact = {
    id: 'artifact-run-transition-design',
    runId: advanced.run.id,
    nodeId: designNodeId,
    kind: 'design',
    title: '方案设计结果',
    summary: 'Implementation and test strategy are explicit.',
    content: 'The delivery design is ready for review.',
    redacted: true,
    updatedAt: now,
  }
  const run = {
    ...advanced.run,
    status: 'paused_at_gate' as const,
    currentNodeId: gateId,
    nodes: advanced.run.nodes.map((node) => {
      if (node.id === designNodeId) {
        return {
          ...node,
          status: 'success' as const,
          artifactIds: [...node.artifactIds, artifact.id],
        }
      }
      if (node.id === gateId) {
        return { ...node, status: 'running' as const, artifactIds: [artifact.id] }
      }
      return node
    }),
  }
  const evidence: WorkflowEvidenceSnapshot = {
    ...clarification.evidence,
    artifacts: [...clarification.evidence.artifacts, artifact],
  }

  return { run, evidence, gateId }
}

function currentBuild() {
  const created = createWorkflowRunFromRequest({
    runId: 'run-build-transition',
    title: 'Complete build',
    request: 'Advance only after coding evidence is complete.',
    projectId: 'project-1',
    creatorId: 'user-1',
    branchName: 'ai/complete-build',
    now,
  })
  const buildId = 'run-build-transition-build'
  const run = {
    ...created.run,
    status: 'building' as const,
    currentNodeId: buildId,
    nodes: created.run.nodes.map((node) => {
      if (node.id === buildId) return { ...node, status: 'running' as const }
      if (node.stage === 'clarify' || node.stage === 'design') return { ...node, status: 'success' as const }
      return node
    }),
  }
  const codingRun: CodingAgentRun = {
    id: 'coding-run-1',
    runId: run.id,
    nodeId: buildId,
    projectId: run.projectId,
    requestedBy: 'user-1',
    providerId: 'fake',
    engine: 'fake',
    status: 'completed',
    managedWorkspaceId: 'workspace-1',
    branchName: run.branchName,
    userInstruction: 'Implement the requested change.',
    prompt: 'Implement the requested change.',
    summary: 'Coding completed.',
    changedPaths: ['src/change.ts'],
    startedAt: now,
    completedAt: now,
    diffArtifactId: 'diff-1',
    redacted: true,
  }
  const diff: CodingDiffArtifact = {
    id: 'diff-1',
    runId: run.id,
    nodeId: buildId,
    projectId: run.projectId,
    changedPaths: ['src/change.ts'],
    patch: 'diff --git a/src/change.ts b/src/change.ts',
    truncated: false,
    redacted: true,
    createdAt: now,
  }
  const evidence: WorkflowEvidenceSnapshot = {
    artifacts: created.artifacts,
    codingRuns: [codingRun],
    codingDiffs: [diff],
    testEvidence: [],
    agentReviews: [],
  }

  return { run, evidence, buildId, codingRun, diff }
}

function currentTest(status: TestEvidence['status']) {
  const build = currentBuild()
  const completedBuild = applyWorkflowCommand({
    run: build.run,
    command: {
      type: 'complete_build',
      nodeId: build.buildId,
      codingRunId: build.codingRun.id,
      diffId: build.diff.id,
    },
    evidence: build.evidence,
    now,
  })
  if (!completedBuild.applied) {
    throw new Error('Expected build fixture to advance')
  }

  const testNodeId = 'run-build-transition-test'
  const testEvidence: TestEvidence = {
    id: `test-evidence-${status}`,
    runId: completedBuild.run.id,
    nodeId: testNodeId,
    projectId: completedBuild.run.projectId,
    command: 'pnpm test',
    cwd: '/workspace',
    status,
    exitCode: status === 'passed' ? 0 : 1,
    durationMs: 100,
    stdout: status === 'passed' ? 'tests passed' : '',
    stderr: status === 'passed' ? '' : 'tests failed',
    summary: `Tests ${status}.`,
    redacted: true,
    createdAt: now,
  }
  const artifact: Artifact = {
    id: `artifact-${testEvidence.id}`,
    runId: testEvidence.runId,
    nodeId: testEvidence.nodeId,
    kind: 'test_report',
    title: 'Local test evidence',
    summary: testEvidence.summary,
    content: testEvidence.summary,
    redacted: true,
    updatedAt: now,
  }
  const evidence: WorkflowEvidenceSnapshot = {
    ...build.evidence,
    artifacts: [...build.evidence.artifacts, artifact],
    testEvidence: [testEvidence],
  }

  return { run: completedBuild.run, evidence, testNodeId, testEvidence, artifact }
}

function currentUnattachedPr() {
  const test = currentTest('passed')
  const completedTest = applyWorkflowCommand({
    run: test.run,
    command: {
      type: 'record_test_result',
      nodeId: test.testNodeId,
      evidenceId: test.testEvidence.id,
      artifactId: test.artifact.id,
    },
    evidence: test.evidence,
    now,
  })
  if (!completedTest.applied) {
    throw new Error('Expected test fixture to advance')
  }
  const prNodeId = 'run-build-transition-pr'
  const artifact: Artifact = {
    id: 'artifact-pr-1',
    runId: completedTest.run.id,
    nodeId: prNodeId,
    kind: 'pr',
    title: 'PR Draft',
    summary: 'Delivery handoff is ready.',
    content: 'Diff and test evidence are linked.',
    redacted: true,
    updatedAt: now,
  }
  const evidence: WorkflowEvidenceSnapshot = {
    ...test.evidence,
    artifacts: [...test.evidence.artifacts, artifact],
  }

  return { run: completedTest.run, evidence, prNodeId, artifact }
}

function currentPr() {
  const prepared = currentUnattachedPr()
  const attached = applyWorkflowCommand({
    run: prepared.run,
    command: {
      type: 'attach_pr_package',
      nodeId: prepared.prNodeId,
      artifactId: prepared.artifact.id,
    },
    evidence: prepared.evidence,
    now,
  })
  if (!attached.applied) {
    throw new Error('Expected PR package fixture to attach')
  }
  const intent: GitHubDeliveryIntent = {
    stateVersion: 1,
    id: 'delivery-intent-workflow-1',
    organizationId: 'org-1',
    teamProjectId: 'team-project-1',
    localProjectId: attached.run.projectId,
    runId: attached.run.id,
    runVersion: attached.run.version,
    nodeId: prepared.prNodeId,
    repositoryBindingId: 'binding-1',
    repositoryBindingVersion: 1,
    installationId: '123',
    repositoryId: '456',
    codingRunId: prepared.evidence.codingRuns[0]!.id,
    codingRunCompletedAt: now,
    workspaceId: 'workspace-1',
    deliverySeriesKey: `github-delivery:${'7'.repeat(64)}`,
    deliveryAttempt: 1,
    repository: 'owner/repository',
    baseBranch: 'main',
    headBranch: 'devflow/run-build-transition',
    baseCommitSha: '0'.repeat(40),
    expectedCommitSha: '1'.repeat(40),
    diffArtifactId: prepared.evidence.codingDiffs[0]!.id,
    diffSourceDigest: '2'.repeat(64),
    testEvidenceId: prepared.evidence.testEvidence[0]!.id,
    testEvidenceCreatedAt: now,
    testEvidenceDigest: '3'.repeat(64),
    prPackageArtifactId: prepared.artifact.id,
    prPackageUpdatedAt: prepared.artifact.updatedAt,
    prPackageDigest: '4'.repeat(64),
    changedPaths: ['src/change.ts'],
    intentDigest: '5'.repeat(64),
    idempotencyKey: `github-delivery:${'6'.repeat(64)}`,
    status: 'completed',
    completion: {
      stateVersion: 1,
      remoteRequestId: 'remote-delivery-1',
      publicationId: 'publication-1',
      pullRequestOutcomeId: 'pull-request-outcome-1',
      pullRequestId: '789',
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/owner/repository/pull/42',
      providerCreatedAt: '2026-07-31T11:59:00.000Z',
      recordedAt: now,
      draft: true,
      redacted: true,
    },
    createdAt: '2026-07-31T11:58:00.000Z',
    updatedAt: now,
    redacted: true,
  }
  return {
    ...prepared,
    run: attached.run,
    evidence: {
      ...prepared.evidence,
      githubDeliveryIntents: [intent],
    },
  }
}

function currentAcceptance() {
  const pr = currentPr()
  const completedPr = applyWorkflowCommand({
    run: pr.run,
    command: {
      type: 'complete_pr',
      nodeId: pr.prNodeId,
      artifactId: pr.artifact.id,
    },
    evidence: pr.evidence,
    now,
  })
  if (!completedPr.applied) {
    throw new Error('Expected PR fixture to advance')
  }
  const acceptanceNodeId = 'run-build-transition-accept'
  const artifact: Artifact = {
    id: 'artifact-acceptance-1',
    runId: completedPr.run.id,
    nodeId: acceptanceNodeId,
    kind: 'acceptance',
    title: 'Acceptance Bundle',
    summary: 'Final delivery evidence is ready.',
    content: 'PR, diff, tests, policy, and review evidence.',
    redacted: true,
    updatedAt: now,
  }
  const evidence: WorkflowEvidenceSnapshot = {
    ...pr.evidence,
    artifacts: [...pr.evidence.artifacts, artifact],
  }

  return { run: completedPr.run, evidence, acceptanceNodeId, artifact }
}

function approvalReadyAcceptance() {
  const acceptance = currentAcceptance()
  const attached = applyWorkflowCommand({
    run: acceptance.run,
    command: {
      type: 'attach_acceptance_bundle',
      nodeId: acceptance.acceptanceNodeId,
      artifactId: acceptance.artifact.id,
    },
    evidence: acceptance.evidence,
    now,
  })
  if (!attached.applied) {
    throw new Error('Expected acceptance fixture to attach its bundle')
  }
  const review: AgentReviewResult = {
    id: 'review-acceptance-1',
    requestId: 'review-request-1',
    runId: attached.run.id,
    nodeId: acceptance.acceptanceNodeId,
    projectId: attached.run.projectId,
    runtime: 'electron',
    providerId: 'review-provider',
    model: 'review-model',
    conclusion: 'Delivery evidence is ready.',
    summary: 'No blocking delivery risks remain.',
    risks: [],
    missingEvidence: [],
    suggestedTests: [],
    knowledgeReferences: [],
    policyFindings: [],
    confidence: 0.95,
    gateAdvisory: {
      id: 'advisory-acceptance-1',
      runId: attached.run.id,
      nodeId: acceptance.acceptanceNodeId,
      level: 'info',
      blocksApproval: false,
      summary: 'Acceptance can proceed.',
      missingEvidence: [],
      riskCount: 0,
      createdAt: now,
    },
    createdAt: now,
  }
  const evidence: WorkflowEvidenceSnapshot = {
    ...acceptance.evidence,
    agentReviews: [review],
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
  }

  return { run: attached.run, evidence, acceptanceNodeId: acceptance.acceptanceNodeId }
}

describe('workflow command core', () => {
  it('completes the current clarification agent with matching evidence and advances to its gate', () => {
    const created = createWorkflowRunFromRequest({
      runId: 'run-complete-agent',
      title: 'Complete clarification',
      request: 'Advance through the shared command core.',
      projectId: 'project-1',
      creatorId: 'user-1',
      branchName: 'ai/complete-agent',
      now,
    })
    const nodeId = 'run-complete-agent-clarify'
    const gateId = 'run-complete-agent-clarify-gate'
    const artifact = clarificationArtifact(created.run.id, nodeId)
    const evidence: WorkflowEvidenceSnapshot = {
      artifacts: [...created.artifacts, artifact],
      codingRuns: [],
      codingDiffs: [],
      testEvidence: [],
      agentReviews: [],
    }
    const command = {
      type: 'complete_agent' as const,
      nodeId,
      artifactId: artifact.id,
    }

    expect(evaluateWorkflowCommand({ run: created.run, command, evidence })).toEqual({
      allowed: true,
      blockers: [],
    })

    const result = applyWorkflowCommand({
      run: created.run,
      command,
      evidence,
      now,
    })

    expect(result.applied).toBe(true)
    expect(result.run.currentNodeId).toBe(gateId)
    expect(result.run.status).toBe('paused_at_gate')
    expect(result.run.nodes.find((node) => node.id === nodeId)).toMatchObject({
      status: 'success',
      artifactIds: expect.arrayContaining([artifact.id]),
    })
    expect(result.run.nodes.find((node) => node.id === gateId)).toMatchObject({
      status: 'running',
      artifactIds: [artifact.id],
    })
  })

  it('approves the current clarification gate and advances to design when required evidence is ready', () => {
    const { run, evidence, gateId } = currentClarificationGate()
    const command = { type: 'approve_gate' as const, nodeId: gateId }

    expect(evaluateWorkflowCommand({ run, command, evidence })).toEqual({
      allowed: true,
      blockers: [],
    })

    const result = applyWorkflowCommand({ run, command, evidence, now })

    expect(result.applied).toBe(true)
    expect(result.run.version).toBe(run.version + 1)
    expect(result.run.currentNodeId).toBe('run-transition-design')
    expect(result.run.status).toBe('designing')
    expect(result.run.nodes.find((node) => node.id === gateId)?.status).toBe('success')
    expect(result.run.nodes.find((node) => node.id === 'run-transition-design')?.status).toBe('running')
  })

  it('rejects a clarification artifact that is not produced by the gate predecessor', () => {
    const { run, evidence, gateId } = currentClarificationGate()
    const clarificationId = `artifact-${run.id}-clarification`
    const decision = evaluateWorkflowCommand({
      run,
      command: { type: 'approve_gate', nodeId: gateId },
      evidence: {
        ...evidence,
        artifacts: evidence.artifacts.map((artifact) =>
          artifact.id === clarificationId
            ? { ...artifact, nodeId: 'run-transition-design' }
            : artifact,
        ),
      },
    })

    expect(decision.allowed).toBe(false)
    expect(decision.blockers.map((item) => item.code)).toEqual([
      'clarification_artifact_missing',
    ])
  })

  it('preserves the Run version when a canonical command is rejected', () => {
    const { run, evidence, gateId } = currentClarificationGate()
    const result = applyWorkflowCommand({
      run,
      command: { type: 'approve_gate', nodeId: gateId },
      evidence: {
        ...evidence,
        artifacts: evidence.artifacts.filter(
          (artifact) => artifact.kind !== 'clarification',
        ),
      },
      now,
    })

    expect(result.applied).toBe(false)
    expect(result.run).toBe(run)
    expect(result.run.version).toBe(run.version)
  })

  it('requires the matching design artifact before the design gate can advance to build', () => {
    const { run, evidence, gateId } = currentDesignGate()
    const decision = evaluateWorkflowCommand({
      run,
      command: { type: 'approve_gate', nodeId: gateId },
      evidence: {
        ...evidence,
        artifacts: evidence.artifacts.filter((artifact) => artifact.kind !== 'design'),
      },
    })

    expect(decision.allowed).toBe(false)
    expect(decision.blockers.map((item) => item.code)).toEqual(['design_artifact_missing'])

    const result = applyWorkflowCommand({
      run,
      command: { type: 'approve_gate', nodeId: gateId },
      evidence,
      now,
    })
    expect(result.applied).toBe(true)
    expect(result.run.currentNodeId).toBe('run-transition-build')
    expect(result.run.status).toBe('building')
  })

  it('rejects a command when the declared current node still has an unfinished upstream node', () => {
    const { run, evidence, gateId } = currentClarificationGate()
    const inconsistentRun = {
      ...run,
      nodes: run.nodes.map((node) =>
        node.id === 'run-transition-clarify' ? { ...node, status: 'running' as const } : node,
      ),
    }

    const decision = evaluateWorkflowCommand({
      run: inconsistentRun,
      command: { type: 'approve_gate', nodeId: gateId },
      evidence,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.blockers.map((item) => item.code)).toContain('workflow_invariant_violation')
  })

  it('completes the current build and advances to test when matching coding run and diff evidence exist', () => {
    const { run, evidence, buildId, codingRun, diff } = currentBuild()
    const command = {
      type: 'complete_build' as const,
      nodeId: buildId,
      codingRunId: codingRun.id,
      diffId: diff.id,
    }

    expect(evaluateWorkflowCommand({ run, command, evidence })).toEqual({
      allowed: true,
      blockers: [],
    })

    const result = applyWorkflowCommand({ run, command, evidence, now })

    expect(result.applied).toBe(true)
    expect(result.run.currentNodeId).toBe('run-build-transition-test')
    expect(result.run.status).toBe('testing')
    expect(result.run.nodes.find((node) => node.id === buildId)?.status).toBe('success')
    expect(result.run.nodes.find((node) => node.id === 'run-build-transition-test')?.status).toBe('running')
  })

  it('advances an OpenCode build only after the exact Change Acceptance decision is persisted', () => {
    const { run, evidence, buildId, codingRun, diff } = currentBuild()
    const command = {
      type: 'complete_build' as const,
      nodeId: buildId,
      codingRunId: codingRun.id,
      diffId: diff.id,
    }
    const applyingWithoutAcceptance: CodingAgentRun = {
      ...codingRun,
      engine: 'opencode-http',
      status: 'applying',
    }
    delete applyingWithoutAcceptance.completedAt
    expect(evaluateWorkflowCommand({
      run,
      command,
      evidence: { ...evidence, codingRuns: [applyingWithoutAcceptance] },
    })).toMatchObject({
      allowed: false,
      blockers: [{ code: 'coding_run_not_completed' }],
    })

    const accepted: CodingAgentRun = {
      ...applyingWithoutAcceptance,
      changeAcceptanceDecisionId: 'decision-change-acceptance-1',
    }
    expect(evaluateWorkflowCommand({
      run,
      command,
      evidence: { ...evidence, codingRuns: [accepted] },
    })).toEqual({ allowed: true, blockers: [] })
  })

  it('rejects a command when a downstream workflow node is already non-pending', () => {
    const { run, evidence, buildId, codingRun, diff } = currentBuild()
    const inconsistentRun = {
      ...run,
      nodes: run.nodes.map((node) =>
        node.id === 'run-build-transition-pr' ? { ...node, status: 'success' as const } : node,
      ),
    }

    const decision = evaluateWorkflowCommand({
      run: inconsistentRun,
      command: {
        type: 'complete_build',
        nodeId: buildId,
        codingRunId: codingRun.id,
        diffId: diff.id,
      },
      evidence,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.blockers.map((item) => item.code)).toContain('workflow_invariant_violation')
  })

  it('reports a stable blocker when the immediate next node is not pending', () => {
    const { run, evidence, buildId, codingRun, diff } = currentBuild()
    const inconsistentRun = {
      ...run,
      nodes: run.nodes.map((node) =>
        node.id === 'run-build-transition-test' ? { ...node, status: 'failed' as const } : node,
      ),
    }

    const decision = evaluateWorkflowCommand({
      run: inconsistentRun,
      command: {
        type: 'complete_build',
        nodeId: buildId,
        codingRunId: codingRun.id,
        diffId: diff.id,
      },
      evidence,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.blockers.map((item) => item.code)).toEqual(['next_node_not_pending'])
  })

  it('rejects a command when the run status disagrees with its current node', () => {
    const { run, evidence, buildId, codingRun, diff } = currentBuild()
    const inconsistentRun = {
      ...run,
      status: 'testing' as const,
    }

    const decision = evaluateWorkflowCommand({
      run: inconsistentRun,
      command: {
        type: 'complete_build',
        nodeId: buildId,
        codingRunId: codingRun.id,
        diffId: diff.id,
      },
      evidence,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.blockers.map((item) => item.code)).toEqual(['workflow_invariant_violation'])
  })

  it('rejects commands for any node other than the declared current node', () => {
    const { run, evidence } = currentBuild()
    const decision = evaluateWorkflowCommand({
      run,
      command: {
        type: 'approve_gate',
        nodeId: 'run-build-transition-design-gate',
      },
      evidence,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.blockers.map((item) => item.code)).toEqual(['not_current_node'])
  })

  it('records a passing result for the current test node and advances to PR', () => {
    const { run, evidence, testNodeId, testEvidence, artifact } = currentTest('passed')
    const command = {
      type: 'record_test_result' as const,
      nodeId: testNodeId,
      evidenceId: testEvidence.id,
      artifactId: artifact.id,
    }

    expect(evaluateWorkflowCommand({ run, command, evidence })).toEqual({
      allowed: true,
      blockers: [],
    })

    const result = applyWorkflowCommand({ run, command, evidence, now })

    expect(result.applied).toBe(true)
    expect(result.run.currentNodeId).toBe('run-build-transition-pr')
    expect(result.run.status).toBe('paused_at_gate')
    expect(result.run.nodes.find((node) => node.id === testNodeId)?.status).toBe('success')
    expect(result.run.nodes.find((node) => node.id === 'run-build-transition-pr')?.status).toBe('running')
  })

  it('increments the Run version when a failed test result is committed', () => {
    const { run, evidence, testNodeId, testEvidence, artifact } = currentTest('failed')
    const result = applyWorkflowCommand({
      run,
      command: {
        type: 'record_test_result',
        nodeId: testNodeId,
        evidenceId: testEvidence.id,
        artifactId: artifact.id,
      },
      evidence,
      now,
    })

    expect(result.applied).toBe(true)
    expect(result.run.version).toBe(run.version + 1)
    expect(result.run.status).toBe('failed')
  })

  it('preserves the Run version when the same failed test result is recorded again', () => {
    const { run, evidence, testNodeId, testEvidence, artifact } = currentTest('failed')
    const command = {
      type: 'record_test_result' as const,
      nodeId: testNodeId,
      evidenceId: testEvidence.id,
      artifactId: artifact.id,
    }
    const first = applyWorkflowCommand({ run, command, evidence, now })
    if (!first.applied) {
      throw new Error('Expected the first failed test result to apply')
    }

    const replay = applyWorkflowCommand({
      run: first.run,
      command,
      evidence,
      now: '2026-07-31T12:01:00.000Z',
    })

    expect(replay.applied).toBe(true)
    expect(replay.run).toBe(first.run)
    expect(replay.run.version).toBe(first.run.version)
  })

  it('rejects a test report that is not derived from the selected test evidence', () => {
    const { run, evidence, testNodeId, testEvidence, artifact } = currentTest('passed')
    const unrelatedArtifact: Artifact = {
      ...artifact,
      id: 'artifact-unrelated-test-evidence',
    }

    const decision = evaluateWorkflowCommand({
      run,
      command: {
        type: 'record_test_result',
        nodeId: testNodeId,
        evidenceId: testEvidence.id,
        artifactId: unrelatedArtifact.id,
      },
      evidence: {
        ...evidence,
        artifacts: [...evidence.artifacts, unrelatedArtifact],
      },
    })

    expect(decision.allowed).toBe(false)
    expect(decision.blockers.map((item) => item.code)).toEqual(['evidence_scope_mismatch'])
  })

  it('completes the current PR and advances to acceptance when delivery evidence is ready', () => {
    const { run, evidence, prNodeId, artifact } = currentPr()
    const command = {
      type: 'complete_pr' as const,
      nodeId: prNodeId,
      artifactId: artifact.id,
    }

    expect(evaluateWorkflowCommand({ run, command, evidence })).toEqual({
      allowed: true,
      blockers: [],
    })

    const result = applyWorkflowCommand({ run, command, evidence, now })

    expect(result.applied).toBe(true)
    expect(result.run.currentNodeId).toBe('run-build-transition-accept')
    expect(result.run.status).toBe('paused_at_gate')
    expect(result.run.nodes.find((node) => node.id === prNodeId)?.status).toBe('success')
    expect(result.run.nodes.find((node) => node.id === 'run-build-transition-accept')?.status).toBe('running')
  })

  it('does not complete a PR from the local package without a completed GitHub Delivery', () => {
    const { run, evidence, prNodeId, artifact } = currentPr()
    const decision = evaluateWorkflowCommand({
      run,
      command: {
        type: 'complete_pr',
        nodeId: prNodeId,
        artifactId: artifact.id,
      },
      evidence: { ...evidence, githubDeliveryIntents: [] },
    })

    expect(decision.allowed).toBe(false)
    expect(decision.blockers.map((item) => item.code)).toEqual([
      'github_delivery_incomplete',
    ])
  })

  it('attaches a PR Delivery Package without advancing and replays the exact package', () => {
    const { run, evidence, prNodeId, artifact } = currentUnattachedPr()
    const command = {
      type: 'attach_pr_package' as const,
      nodeId: prNodeId,
      artifactId: artifact.id,
    }

    const attached = applyWorkflowCommand({ run, command, evidence, now })
    expect(attached.applied).toBe(true)
    expect(attached.run.currentNodeId).toBe(prNodeId)
    expect(attached.run.status).toBe('paused_at_gate')
    expect(attached.run.version).toBe(run.version + 1)
    expect(attached.run.nodes.find((node) => node.id === prNodeId)).toMatchObject({
      status: 'running',
      artifactIds: expect.arrayContaining([artifact.id]),
    })

    const replay = applyWorkflowCommand({
      run: attached.run,
      command,
      evidence,
      now: '2026-07-31T12:01:00.000Z',
    })
    expect(replay.applied).toBe(true)
    expect(replay.run).toBe(attached.run)
    expect(replay.run.version).toBe(attached.run.version)
  })

  it('blocks PR completion when a newer matching test result is no longer passing', () => {
    const { run, evidence, prNodeId, artifact } = currentPr()
    const latestFailure: TestEvidence = {
      ...evidence.testEvidence[0]!,
      id: 'test-evidence-latest-failure',
      status: 'failed',
      exitCode: 1,
      summary: 'A later regression failed.',
      createdAt: '2026-07-31T12:01:00.000Z',
    }
    const decision = evaluateWorkflowCommand({
      run,
      command: {
        type: 'complete_pr',
        nodeId: prNodeId,
        artifactId: artifact.id,
      },
      evidence: {
        ...evidence,
        testEvidence: [...evidence.testEvidence, latestFailure],
      },
    })

    expect(decision.allowed).toBe(false)
    expect(decision.blockers.map((item) => item.code)).toEqual(['latest_test_not_passed'])
  })

  it('blocks PR completion when the passing test report is no longer attached', () => {
    const { run, evidence, prNodeId, artifact } = currentPr()
    const decision = evaluateWorkflowCommand({
      run,
      command: {
        type: 'complete_pr',
        nodeId: prNodeId,
        artifactId: artifact.id,
      },
      evidence: {
        ...evidence,
        artifacts: evidence.artifacts.filter(
          (candidate) => candidate.kind !== 'test_report',
        ),
      },
    })

    expect(decision.allowed).toBe(false)
    expect(decision.blockers.map((item) => item.code)).toEqual(['test_report_missing'])
  })

  it('attaches an acceptance bundle to the current node without completing the run', () => {
    const { run, evidence, acceptanceNodeId, artifact } = currentAcceptance()
    const command = {
      type: 'attach_acceptance_bundle' as const,
      nodeId: acceptanceNodeId,
      artifactId: artifact.id,
    }

    expect(evaluateWorkflowCommand({ run, command, evidence })).toEqual({
      allowed: true,
      blockers: [],
    })

    const result = applyWorkflowCommand({ run, command, evidence, now })

    expect(result.applied).toBe(true)
    if (!result.applied) {
      throw new Error('Expected final acceptance to complete')
    }
    expect(result.run.version).toBe(run.version + 1)
    expect(result.run.currentNodeId).toBe(acceptanceNodeId)
    expect(result.run.status).toBe('paused_at_gate')
    expect(result.run.nodes.find((node) => node.id === acceptanceNodeId)).toMatchObject({
      status: 'running',
      artifactIds: [artifact.id],
    })
  })

  it('preserves the Run version when the same acceptance bundle is attached again', () => {
    const { run, evidence, acceptanceNodeId, artifact } = currentAcceptance()
    const command = {
      type: 'attach_acceptance_bundle' as const,
      nodeId: acceptanceNodeId,
      artifactId: artifact.id,
    }
    const first = applyWorkflowCommand({ run, command, evidence, now })
    if (!first.applied) {
      throw new Error('Expected the first acceptance bundle attachment to apply')
    }

    const replay = applyWorkflowCommand({
      run: first.run,
      command,
      evidence,
      now: '2026-07-31T12:01:00.000Z',
    })

    expect(replay.applied).toBe(true)
    expect(replay.run).toBe(first.run)
    expect(replay.run.version).toBe(first.run.version)
  })

  it('approves final acceptance only after authorization, policy, review, budget, and delivery evidence pass', () => {
    const { run, evidence, acceptanceNodeId } = approvalReadyAcceptance()
    const command = {
      type: 'approve_acceptance' as const,
      nodeId: acceptanceNodeId,
    }

    expect(evaluateWorkflowCommand({ run, command, evidence })).toEqual({
      allowed: true,
      blockers: [],
    })

    const result = applyWorkflowCommand({ run, command, evidence, now })

    expect(result.applied).toBe(true)
    expect(result.run.version).toBe(run.version + 1)
    expect(result.run.currentNodeId).toBe(acceptanceNodeId)
    expect(result.run.status).toBe('completed')
    expect(result.run.nodes.find((node) => node.id === acceptanceNodeId)?.status).toBe('success')
    if (!result.applied) {
      throw new Error('Expected acceptance approval to be applied')
    }
    expect(result.nextNode).toBeUndefined()
  })

  it('reports every failed acceptance authorization check with stable blocker codes', () => {
    const { run, evidence, acceptanceNodeId } = approvalReadyAcceptance()
    const latestBlockingReview: AgentReviewResult = {
      ...evidence.agentReviews[0]!,
      id: 'review-acceptance-blocking',
      gateAdvisory: {
        ...evidence.agentReviews[0]!.gateAdvisory,
        id: 'advisory-acceptance-blocking',
        blocksApproval: true,
        createdAt: '2026-07-31T12:01:00.000Z',
      },
      createdAt: '2026-07-31T12:01:00.000Z',
    }
    const decision = evaluateWorkflowCommand({
      run,
      command: {
        type: 'approve_acceptance',
        nodeId: acceptanceNodeId,
      },
      evidence: {
        ...evidence,
        approval: {
          roleAllowed: false,
          policy: { blocksApproval: true },
          review: 'required',
          budget: 'required',
        },
        agentReviews: [...evidence.agentReviews, latestBlockingReview],
        budgetDecision: {
          status: 'requires_lead_approval',
          blocksRun: true,
          currentSpendUsd: 2,
          projectedCostUsd: 1,
          reason: 'Budget exhausted.',
        },
      },
    })

    expect(decision.allowed).toBe(false)
    expect(decision.blockers.map((item) => item.code)).toEqual([
      'authorization_denied',
      'policy_blocked',
      'review_blocked',
      'budget_blocked',
    ])
  })

  it('rejects every command after the workflow reaches a terminal status', () => {
    const { run, evidence, acceptanceNodeId } = approvalReadyAcceptance()
    const completed = applyWorkflowCommand({
      run,
      command: { type: 'approve_acceptance', nodeId: acceptanceNodeId },
      evidence,
      now,
    })
    if (!completed.applied) {
      throw new Error('Expected acceptance fixture to complete')
    }

    const decision = evaluateWorkflowCommand({
      run: completed.run,
      command: { type: 'approve_acceptance', nodeId: acceptanceNodeId },
      evidence,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.blockers.map((item) => item.code)).toEqual(['run_terminal'])
  })

  it('rejects final acceptance when the completed PR no longer has a matching PR artifact', () => {
    const { run, evidence, acceptanceNodeId } = approvalReadyAcceptance()
    const decision = evaluateWorkflowCommand({
      run,
      command: {
        type: 'approve_acceptance',
        nodeId: acceptanceNodeId,
      },
      evidence: {
        ...evidence,
        artifacts: evidence.artifacts.filter((artifact) => artifact.kind !== 'pr'),
      },
    })

    expect(decision.allowed).toBe(false)
    expect(decision.blockers.map((item) => item.code)).toEqual(['pr_artifact_missing'])
  })

  it('fails closed when the requirement Gate still points at an older clarification revision', () => {
    const fixture = currentClarificationGate()
    const v1 = fixture.evidence.artifacts.find((artifact) => artifact.kind === 'clarification')!
    const executor = {
      version: 1 as const, kind: 'direct-provider' as const, executorId: 'fake', executorVersion: '1',
      capabilityProfile: 'repository-read-only-v1' as const, model: 'fake', startedAt: now,
      completedAt: now, durationMs: 1, terminalReason: 'success' as const, contextDigest: 'b'.repeat(64),
    }
    const trackedV1: Artifact = {
      ...v1,
      clarificationRevision: {
        version: 1, revision: 1, status: 'superseded', revisionDigest: 'a'.repeat(64),
        rawRequestArtifactId: fixture.evidence.artifacts.find((artifact) => artifact.kind === 'raw_request')!.id,
        feedbackArtifactIds: [], goals: ['Goal'], acceptanceCriteria: ['Acceptance'], nonGoals: ['Non-goal'],
        assumptions: [], risks: [], openQuestions: [], executor, generatedAt: now,
      },
    }
    const v2: Artifact = {
      ...trackedV1,
      id: `${trackedV1.id}-v2`,
      updatedAt: '2026-07-31T12:01:00.000Z',
      clarificationRevision: {
        ...trackedV1.clarificationRevision!, revision: 2, status: 'review_requested',
        revisionDigest: 'c'.repeat(64), previousRevisionArtifactId: trackedV1.id,
      },
    }
    const decision = evaluateWorkflowCommand({
      run: fixture.run,
      command: { type: 'approve_gate', nodeId: fixture.gateId },
      evidence: {
        ...fixture.evidence,
        artifacts: fixture.evidence.artifacts.map((artifact) => artifact.id === v1.id ? trackedV1 : artifact).concat(v2),
      },
    })
    expect(decision).toMatchObject({
      allowed: false,
      blockers: [{ code: 'clarification_revision_stale' }],
    })
  })
})
