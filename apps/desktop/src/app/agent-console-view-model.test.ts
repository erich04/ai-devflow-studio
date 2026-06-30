import { describe, expect, it } from 'vitest'
import {
  runs as fixtureRuns,
  type AgentProviderConfig,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingDiffArtifact,
  type CodingPermissionRequest,
  type TestEvidence,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { buildAgentConsoleViewModel, type BuildAgentConsoleViewModelInput } from './agent-console-view-model'

const provider: AgentProviderConfig = {
  id: 'doubao-review',
  name: 'doubao-review',
  kind: 'openai-compatible',
  model: 'ark-code-latest',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
  enabled: true,
  maskedCredential: 'e8...test',
  updatedAt: '2026-06-17T00:00:00.000Z',
}

function runWithCurrentNode(nodeId: string): WorkflowRun {
  const run = fixtureRuns[0]!
  return { ...run, currentNodeId: nodeId }
}

function nodeFrom(run: WorkflowRun, nodeId: string) {
  return run.nodes.find((node) => node.id === nodeId)!
}

function baseInput(overrides: Partial<BuildAgentConsoleViewModelInput> = {}): BuildAgentConsoleViewModelInput {
  const run = runWithCurrentNode('n-design-gate')
  return {
    providers: [provider],
    selectedProviderId: provider.id,
    selectedRun: run,
    selectedNode: nodeFrom(run, 'n-design-gate'),
    reviews: [],
    selectedReviews: [],
    latestReview: undefined,
    latestTrace: undefined,
    latestUsage: undefined,
    isRunningReview: false,
    isStartingCodingAgent: false,
    codingRuns: [],
    retryAttempts: [],
    latestCodingRun: undefined,
    codingEvents: [],
    pendingCodingPermission: undefined,
    permissionRequests: [],
    workspace: undefined,
    diff: undefined,
    bootstrapEvidence: undefined,
    testEvidence: undefined,
    ...overrides,
  }
}

function review(run: WorkflowRun): AgentReviewResult {
  return {
    id: 'review-1',
    requestId: 'request-1',
    runId: run.id,
    nodeId: 'n-design-gate',
    projectId: run.projectId,
    runtime: 'electron',
    providerId: provider.id,
    model: provider.model,
    conclusion: 'warning-only',
    summary: 'Build redacted context before approval.',
    risks: ['Missing test evidence.'],
    missingEvidence: ['Attach passing test evidence.'],
    suggestedTests: ['pnpm test'],
    knowledgeReferences: [],
    policyFindings: [],
    confidence: 0.82,
    gateAdvisory: {
      id: 'advisory-1',
      runId: run.id,
      nodeId: 'n-design-gate',
      level: 'warn',
      blocksApproval: false,
      summary: 'Review found warning-only gaps.',
      missingEvidence: ['Attach passing test evidence.'],
      riskCount: 1,
      createdAt: '2026-06-17T00:00:00.000Z',
    },
    createdAt: '2026-06-17T00:00:00.000Z',
  }
}

function trace(run: WorkflowRun): AgentTrace {
  return {
    id: 'trace-1',
    runId: run.id,
    nodeId: 'n-design-gate',
    reviewId: 'review-1',
    runtime: 'electron',
    createdAt: '2026-06-17T00:00:01.000Z',
    steps: [
      {
        id: 'trace-step-1',
        kind: 'context',
        label: 'Build redacted context',
        summary: 'Collected current Run and node context.',
        timestamp: '2026-06-17T00:00:01.000Z',
      },
    ],
  }
}

describe('agent console view model', () => {
  it('uses Knowledge Review as the primary action for Gate and Review-like nodes', () => {
    const viewModel = buildAgentConsoleViewModel(baseInput())

    expect(viewModel.title).toBe('Agent 执行台')
    expect(viewModel.primaryAction.id).toBe('run-review')
    expect(viewModel.primaryAction.label).toBe('Run Knowledge Review')
    expect(viewModel.pathStatuses.find((section) => section.id === 'review')?.emphasis).toBe('primary')
  })

  it('uses Coding Agent as the primary action for build task nodes', () => {
    const run = runWithCurrentNode('n-build')
    const viewModel = buildAgentConsoleViewModel(baseInput({
      selectedRun: run,
      selectedNode: nodeFrom(run, 'n-build'),
    }))

    expect(viewModel.primaryAction.id).toBe('run-coding')
    expect(viewModel.primaryAction.label).toBe('Run Coding Agent')
    expect(viewModel.pathStatuses.find((section) => section.id === 'coding')?.emphasis).toBe('primary')
  })

  it('promotes pending permission to the current task', () => {
    const run = runWithCurrentNode('n-build')
    const permission: CodingPermissionRequest = {
      id: 'permission-1',
      codingRunId: 'coding-run-1',
      runId: run.id,
      nodeId: 'n-build',
      permission: 'edit',
      title: 'Apply managed diff',
      filePath: 'src/change.ts',
      risk: 'warn',
      reasons: ['Permission required before writing the diff.'],
      status: 'pending',
      requestedAt: '2026-06-17T00:00:00.000Z',
      expiresAt: '2026-06-17T00:01:00.000Z',
    }

    const viewModel = buildAgentConsoleViewModel(baseInput({
      selectedRun: run,
      selectedNode: nodeFrom(run, 'n-build'),
      pendingCodingPermission: permission,
      permissionRequests: [permission],
    }))

    expect(viewModel.primaryAction.id).toBe('resolve-permission')
    expect(viewModel.advisory.label).toBe('Permission required')
    expect(viewModel.evidenceGroups.find((group) => group.id === 'permission')?.items[0]?.title).toBe('Apply managed diff')
  })

  it('explains the empty state when there is no current Run or Node', () => {
    const viewModel = buildAgentConsoleViewModel(baseInput({
      selectedRun: undefined,
      selectedNode: undefined,
    }))

    expect(viewModel.primaryAction.id).toBe('return-workbench')
    expect(viewModel.primaryAction.summary).toContain('先从 Workbench 选择')
    expect(viewModel.currentTarget.nodeTitle).toBe('No selected node')
  })

  it('keeps Review action visible but disabled when provider is missing', () => {
    const viewModel = buildAgentConsoleViewModel(baseInput({
      providers: [],
      selectedProviderId: '',
    }))

    expect(viewModel.primaryAction.id).toBe('run-review')
    expect(viewModel.primaryAction.disabled).toBe(true)
    expect(viewModel.primaryAction.disabledReason).toBe('请先配置真实 Review Provider：Provider ID、Base URL、Model 和 API Key。')
  })

  it('groups review, coding, permission, diff, test evidence, and cost outputs', () => {
    const run = runWithCurrentNode('n-build')
    const latestReview = review(run)
    const latestTrace = trace(run)
    const latestUsage: AgentTokenUsage = {
      id: 'usage-1',
      runId: run.id,
      nodeId: 'n-design-gate',
      userId: 'u-wang',
      projectId: run.projectId,
      provider: 'local',
      model: 'fake',
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 10,
      costUsd: 0,
      timestamp: '2026-06-17T00:00:00.000Z',
      source: 'estimated',
    }
    const codingRun: CodingAgentRun = {
      id: 'coding-run-1',
      runId: run.id,
      nodeId: 'n-build',
      projectId: run.projectId,
      requestedBy: 'u-wang',
      providerId: 'fake',
      engine: 'fake',
      status: 'completed',
      managedWorkspaceId: 'workspace-1',
      branchName: 'devflow/build',
      userInstruction: 'Implement change.',
      prompt: 'redacted',
      summary: 'Coding Agent completed.',
      changedPaths: ['src/change.ts'],
      startedAt: '2026-06-17T00:00:00.000Z',
      completedAt: '2026-06-17T00:03:00.000Z',
      redacted: true,
    }
    const permission: CodingPermissionRequest = {
      id: 'permission-1',
      codingRunId: codingRun.id,
      runId: run.id,
      nodeId: 'n-build',
      permission: 'edit',
      title: 'Apply managed diff',
      risk: 'safe',
      reasons: ['Approved write.'],
      status: 'approved',
      requestedAt: '2026-06-17T00:01:00.000Z',
      expiresAt: '2026-06-17T00:02:00.000Z',
    }
    const codingEvents: CodingAgentEvent[] = [
      {
        id: 'coding-event-1',
        codingRunId: codingRun.id,
        runId: run.id,
        nodeId: 'n-build',
        sequence: 1,
        kind: 'tool_call',
        message: 'Called bash.',
        timestamp: '2026-06-17T00:01:00.000Z',
        metadata: {
          source: 'opencode_metadata',
          toolName: 'bash',
          skillName: 'shell-runner',
          inputSummary: 'bash: pnpm test',
          redactionApplied: true,
        },
        redacted: true,
      },
    ]
    const diff: CodingDiffArtifact = {
      id: 'diff-1',
      runId: run.id,
      nodeId: 'n-build',
      projectId: run.projectId,
      changedPaths: ['src/change.ts'],
      patch: '+changed',
      truncated: false,
      redacted: true,
      createdAt: '2026-06-17T00:02:00.000Z',
    }
    const testEvidence: TestEvidence = {
      id: 'test-evidence-1',
      runId: run.id,
      nodeId: 'n-build',
      projectId: run.projectId,
      command: 'pnpm test',
      cwd: '/tmp/redacted',
      status: 'passed',
      exitCode: 0,
      durationMs: 1000,
      stdout: 'passed',
      stderr: '',
      summary: 'Test evidence passed.',
      redacted: true,
      createdAt: '2026-06-17T00:03:00.000Z',
    }

    const viewModel = buildAgentConsoleViewModel(baseInput({
      selectedRun: run,
      selectedNode: nodeFrom(run, 'n-build'),
      reviews: [latestReview],
      selectedReviews: [latestReview],
      latestReview,
      latestTrace,
      latestUsage,
      codingRuns: [codingRun],
      latestCodingRun: codingRun,
      codingEvents,
      permissionRequests: [permission],
      diff,
      testEvidence,
    }))

    expect(viewModel.evidenceGroups.map((group) => group.id)).toEqual([
      'review-trace',
      'review-history',
      'permission',
      'tool-skill',
      'coding-trace',
      'diff',
      'test-evidence',
      'cost',
    ])
  })
})
