import { describe, expect, it } from 'vitest'
import {
  advanceWorkflowAfterGateApproval,
  createAcceptanceEvidenceBundleArtifact,
  createPrDraftArtifact,
  createWorkflowRunFromRequest,
} from './workflow'
import type { BudgetGuardDecision, CodingDiffArtifact, TestEvidence } from './domain'
import type { GateEnforcementDecision } from './enforcement'

describe('createWorkflowRunFromRequest', () => {
  it('creates a standard six-stage run from a raw user request', () => {
    const created = createWorkflowRunFromRequest({
      runId: 'run-webhook-retry',
      title: 'Fix webhook retry edge cases',
      request: 'Clarify webhook retry failure boundaries, design the change, implement it, and archive evidence.',
      projectId: 'p-payments',
      creatorId: 'u-wang',
      branchName: 'ai/webhook-retry',
      now: '2026-06-21T16:00:00.000Z',
    })

    expect(created.run).toMatchObject({
      id: 'run-webhook-retry',
      title: 'Fix webhook retry edge cases',
      request: 'Clarify webhook retry failure boundaries, design the change, implement it, and archive evidence.',
      projectId: 'p-payments',
      creatorId: 'u-wang',
      status: 'clarifying',
      currentNodeId: 'run-webhook-retry-clarify',
      branchName: 'ai/webhook-retry',
    })
    expect(created.run.nodes.map((node) => [node.id, node.stage, node.kind, node.status])).toEqual([
      ['run-webhook-retry-clarify', 'clarify', 'agent', 'running'],
      ['run-webhook-retry-clarify-gate', 'clarify', 'gate', 'pending'],
      ['run-webhook-retry-design', 'design', 'agent', 'pending'],
      ['run-webhook-retry-design-gate', 'design', 'gate', 'pending'],
      ['run-webhook-retry-build', 'build', 'task', 'pending'],
      ['run-webhook-retry-test', 'test', 'test', 'pending'],
      ['run-webhook-retry-pr', 'pr', 'pr', 'pending'],
      ['run-webhook-retry-accept', 'accept', 'acceptance', 'pending'],
    ])
    expect(created.run.edges.map((edge) => [edge.source, edge.target, edge.kind])).toEqual([
      ['run-webhook-retry-clarify', 'run-webhook-retry-clarify-gate', 'gate'],
      ['run-webhook-retry-clarify-gate', 'run-webhook-retry-design', 'normal'],
      ['run-webhook-retry-design', 'run-webhook-retry-design-gate', 'gate'],
      ['run-webhook-retry-design-gate', 'run-webhook-retry-build', 'normal'],
      ['run-webhook-retry-build', 'run-webhook-retry-test', 'normal'],
      ['run-webhook-retry-test', 'run-webhook-retry-pr', 'normal'],
      ['run-webhook-retry-pr', 'run-webhook-retry-accept', 'gate'],
    ])
    expect(created.artifacts).toEqual([
      expect.objectContaining({
        id: 'artifact-run-webhook-retry-raw-request',
        runId: 'run-webhook-retry',
        nodeId: 'run-webhook-retry-clarify',
        kind: 'raw_request',
        content: 'Clarify webhook retry failure boundaries, design the change, implement it, and archive evidence.',
      }),
      expect.objectContaining({
        id: 'artifact-run-webhook-retry-clarification-placeholder',
        kind: 'clarification',
        nodeId: 'run-webhook-retry-clarify',
      }),
    ])
    expect(created.events).toEqual([
      expect.objectContaining({
        runId: 'run-webhook-retry',
        nodeId: 'run-webhook-retry-clarify',
        kind: 'thinking',
        message: 'Workflow run created from raw request.',
      }),
    ])
  })
})

describe('delivery artifacts', () => {
  const created = createWorkflowRunFromRequest({
    runId: 'run-delivery',
    title: 'Ship webhook retry',
    request: 'Fix webhook retry handling and archive the delivery evidence.',
    projectId: 'p-payments',
    creatorId: 'u-wang',
    branchName: 'ai/webhook-retry',
    now: '2026-06-21T16:00:00.000Z',
  })
  const codingDiff: CodingDiffArtifact = {
    id: 'diff-1',
    runId: 'run-delivery',
    nodeId: 'run-delivery-build',
    projectId: 'p-payments',
    changedPaths: ['src/webhook.ts', 'src/webhook.test.ts'],
    patch: '+ redacted patch',
    truncated: false,
    redacted: true,
    createdAt: '2026-06-21T16:20:00.000Z',
  }
  const testEvidence: TestEvidence = {
    id: 'test-1',
    runId: 'run-delivery',
    nodeId: 'run-delivery-test',
    projectId: 'p-payments',
    command: 'pnpm test',
    cwd: '/tmp/repo',
    status: 'passed',
    exitCode: 0,
    durationMs: 1200,
    stdout: '',
    stderr: '',
    summary: 'Tests passed.',
    redacted: true,
    createdAt: '2026-06-21T16:30:00.000Z',
  }
  const enforcement: GateEnforcementDecision = {
    status: 'warn',
    blocksApproval: false,
    blockingReasons: [],
    warningReasons: [{
      id: 'warn-review',
      target: 'missing_agent_review',
      ruleKey: 'missing-agent-review',
      action: 'warn',
      summary: 'Review recommended.',
    }],
    requiredActions: [],
    canOverride: false,
    overrideRoleRequired: 'lead',
    policySource: 'built_in_default',
    policyVersion: 1,
    provisional: false,
  }
  const budget: BudgetGuardDecision = {
    status: 'warning',
    blocksRun: false,
    currentSpendUsd: 1.2,
    projectedCostUsd: 0.12,
    limitUsd: 5,
    reason: 'Within monthly budget.',
  }

  it('creates a PR draft artifact from diff, test, policy, review, and cost evidence', () => {
    const artifact = createPrDraftArtifact({
      run: created.run,
      project: { repository: 'erich/payments-api', defaultBranch: 'main' },
      artifacts: created.artifacts,
      codingDiffs: [codingDiff],
      testEvidence: [testEvidence],
      enforcement,
      budgetDecision: budget,
      agentReviewSummaries: ['No blocking risks.'],
      now: '2026-06-21T16:35:00.000Z',
    })

    expect(artifact).toMatchObject({
      id: 'artifact-run-delivery-pr-draft',
      runId: 'run-delivery',
      nodeId: 'run-delivery-pr',
      kind: 'pr',
      redacted: true,
    })
    expect(artifact.content).toContain('Compare: https://github.com/erich/payments-api/compare/main...ai%2Fwebhook-retry')
    expect(artifact.content).toContain('src/webhook.ts')
    expect(artifact.content).toContain('Test Evidence: passed - Tests passed.')
    expect(artifact.content).toContain('Policy: warn')
    expect(artifact.content).toContain('Budget: warning - projected $0.120000')
    expect(artifact.content).toContain('Agent Review: No blocking risks.')
    expect(artifact.content).not.toContain('+ redacted patch')
  })

  it('omits compare URLs when repository mapping is unsafe', () => {
    const artifact = createPrDraftArtifact({
      run: created.run,
      project: { repository: 'https://github.com/erich/payments-api', defaultBranch: 'main' },
      artifacts: created.artifacts,
      codingDiffs: [codingDiff],
      testEvidence: [testEvidence],
      now: '2026-06-21T16:35:00.000Z',
    })

    expect(artifact.content).toContain('Compare: unavailable')
    expect(artifact.content).toContain('Repository mapping could not be converted into a safe compare URL.')
  })

  it('creates an acceptance evidence bundle that references the final delivery evidence', () => {
    const prDraft = createPrDraftArtifact({
      run: created.run,
      project: { repository: 'erich/payments-api', defaultBranch: 'main' },
      artifacts: created.artifacts,
      codingDiffs: [codingDiff],
      testEvidence: [testEvidence],
      enforcement,
      budgetDecision: budget,
      agentReviewSummaries: ['No blocking risks.'],
      now: '2026-06-21T16:35:00.000Z',
    })
    const artifact = createAcceptanceEvidenceBundleArtifact({
      run: created.run,
      artifacts: [...created.artifacts, prDraft],
      codingDiffs: [codingDiff],
      testEvidence: [testEvidence],
      enforcement,
      budgetDecision: budget,
      agentReviewSummaries: ['No blocking risks.'],
      now: '2026-06-21T16:40:00.000Z',
    })

    expect(artifact).toMatchObject({
      id: 'artifact-run-delivery-acceptance-bundle',
      runId: 'run-delivery',
      nodeId: 'run-delivery-accept',
      kind: 'acceptance',
      redacted: true,
    })
    expect(artifact.content).toContain('Raw Request: Fix webhook retry handling')
    expect(artifact.content).toContain('PR Draft: artifact-run-delivery-pr-draft')
    expect(artifact.content).toContain('Changed Paths: src/webhook.ts, src/webhook.test.ts')
    expect(artifact.content).toContain('Tests: passed - Tests passed.')
    expect(artifact.content).toContain('Policy: warn')
    expect(artifact.content).toContain('Budget: warning')
    expect(artifact.content).toContain('Agent Review: No blocking risks.')
  })
})

describe('advanceWorkflowAfterGateApproval', () => {
  const created = createWorkflowRunFromRequest({
    runId: 'run-advance',
    title: 'Advance gates',
    request: 'Move through gates using workflow edges.',
    projectId: 'p-payments',
    creatorId: 'u-wang',
    branchName: 'ai/advance',
    now: '2026-06-21T16:00:00.000Z',
  })

  it('advances from clarify gate to design using workflow edges', () => {
    const result = advanceWorkflowAfterGateApproval({
      run: {
        ...created.run,
        currentNodeId: 'run-advance-clarify-gate',
        nodes: created.run.nodes.map((node) =>
          node.id === 'run-advance-clarify-gate' ? { ...node, status: 'blocked' as const } : node,
        ),
      },
      approvedNodeId: 'run-advance-clarify-gate',
      now: '2026-06-21T16:05:00.000Z',
    })

    expect(result.advanced).toBe(true)
    expect(result.run.currentNodeId).toBe('run-advance-design')
    expect(result.run.status).toBe('designing')
    expect(result.run.nodes.find((node) => node.id === 'run-advance-clarify-gate')?.status).toBe('success')
    expect(result.run.nodes.find((node) => node.id === 'run-advance-design')?.status).toBe('running')
  })

  it('advances from design gate to build without hardcoding building for every gate', () => {
    const result = advanceWorkflowAfterGateApproval({
      run: {
        ...created.run,
        status: 'designing',
        currentNodeId: 'run-advance-design-gate',
        nodes: created.run.nodes.map((node) => {
          if (node.id === 'run-advance-clarify-gate') return { ...node, status: 'success' as const }
          if (node.id === 'run-advance-design-gate') return { ...node, status: 'blocked' as const }
          return node
        }),
      },
      approvedNodeId: 'run-advance-design-gate',
      now: '2026-06-21T16:10:00.000Z',
    })

    expect(result.run.currentNodeId).toBe('run-advance-build')
    expect(result.run.status).toBe('building')
    expect(result.run.nodes.find((node) => node.id === 'run-advance-build')?.status).toBe('running')
  })

  it('marks acceptance approved runs completed instead of building', () => {
    const result = advanceWorkflowAfterGateApproval({
      run: {
        ...created.run,
        status: 'paused_at_gate',
        currentNodeId: 'run-advance-accept',
        nodes: created.run.nodes.map((node) =>
          node.id === 'run-advance-accept' ? { ...node, status: 'blocked' as const } : node,
        ),
      },
      approvedNodeId: 'run-advance-accept',
      now: '2026-06-21T16:20:00.000Z',
    })

    expect(result.advanced).toBe(false)
    expect(result.run.currentNodeId).toBe('run-advance-accept')
    expect(result.run.status).toBe('completed')
    expect(result.run.nodes.find((node) => node.id === 'run-advance-accept')?.status).toBe('success')
  })
})
