import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRecommendedEnforcementPreset,
  createWarnOnlyDefaultPolicy,
  mcpServers as fixtureMcpServers,
  resolveEffectivePolicy,
  runs as fixtureRuns,
  validateTestCommandSafety,
} from '@ai-devflow/shared'
import { App } from './App'
import type { DevFlowDesktopApi, RunProjectTestsInput } from './desktop-api'

const localProject = {
  id: 'local-project-1',
  name: 'fixture-project',
  path: '/tmp/fixture-project',
  packageManager: 'pnpm' as const,
  detectedTestCommand: 'pnpm test',
  testCommand: 'pnpm test',
  createdAt: '2026-06-15T00:00:00.000Z',
  updatedAt: '2026-06-15T00:00:00.000Z',
}

const remoteRun = {
  ...fixtureRuns[0]!,
  id: 'run-remote-sync',
  title: '远端同步 Run',
  projectId: 'p-remote-team',
  currentNodeId: 'n-design-gate',
}

const agentProvider = {
  id: 'fake-knowledge-review',
  name: 'Deterministic Fake Provider',
  kind: 'fake' as const,
  model: 'fake',
  enabled: true,
  updatedAt: '1970-01-01T00:00:00.000Z',
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-theme-preference')
  Reflect.deleteProperty(window, 'aiDevFlowDesktop')
})

function installDesktopApi(overrides: Partial<DevFlowDesktopApi> = {}) {
  const policy = createWarnOnlyDefaultPolicy()
  const api: DevFlowDesktopApi = {
    platform: 'test',
    loadState: vi.fn().mockResolvedValue({
      projects: [],
      runs: [],
      artifacts: [],
      events: [],
      testEvidence: [],
      settings: { themePreference: 'system' },
      mcpServers: [],
      agentReviews: [],
      agentTraces: [],
      agentTokenUsage: [],
      codingRuns: [],
      codingEvents: [],
      codingPermissionRequests: [],
      codingPermissionDecisions: [],
      managedCodingWorkspaces: [],
      dependencyBootstrapEvidence: [],
      codingDiffArtifacts: [],
    }),
    loadRemoteSnapshot: vi.fn().mockResolvedValue({
      projects: [],
      members: [],
      runs: [],
      artifacts: [],
      events: [],
      projectCost: [],
      memberCost: [],
      totalCost: '$0.000',
    }),
    uploadRunSummary: vi.fn().mockResolvedValue({
      accepted: true,
      syncedAt: '2026-06-16T00:00:00.000Z',
      message: 'run summary accepted',
    }),
    uploadTestEvidenceSummary: vi.fn().mockResolvedValue({
      accepted: true,
      syncedAt: '2026-06-16T00:00:00.000Z',
      message: 'test evidence summary accepted',
    }),
    uploadCodingAgentSummary: vi.fn().mockResolvedValue({
      accepted: true,
      syncedAt: '2026-06-16T00:00:00.000Z',
      message: 'coding agent summary accepted',
    }),
    selectLocalProject: vi.fn().mockResolvedValue(localProject),
    saveProjectTestCommand: vi.fn().mockImplementation(async ({ testCommand }) => ({
      ...localProject,
      testCommand,
      updatedAt: '2026-06-15T00:01:00.000Z',
    })),
    validateTestCommand: vi.fn().mockImplementation(async ({ testCommand }) =>
      validateTestCommandSafety(testCommand),
    ),
    runProjectTests: vi.fn().mockImplementation(async ({ run, nodeId }: RunProjectTestsInput) => {
      const evidence = {
        id: 'evidence-1',
        runId: run.id,
        nodeId,
        projectId: localProject.id,
        command: 'pnpm test -- --run',
        cwd: localProject.path,
        status: 'passed' as const,
        exitCode: 0,
        durationMs: 900,
        stdout: '8 tests passed',
        stderr: '',
        summary: 'Tests passed in 900ms',
        redacted: false,
        createdAt: '2026-06-15T00:02:00.000Z',
      }
      const artifact = {
        id: 'artifact-evidence-1',
        runId: run.id,
        nodeId,
        kind: 'test_report' as const,
        title: 'Local test evidence',
        summary: evidence.summary,
        content: '8 tests passed',
        redacted: false,
        updatedAt: evidence.createdAt,
      }
      const event = {
        id: 'event-evidence-1',
        runId: run.id,
        nodeId,
        sequence: 1,
        kind: 'test_result' as const,
        message: evidence.summary,
        timestamp: evidence.createdAt,
      }
      const updatedRun = {
        ...run,
        status: 'testing' as const,
        nodes: run.nodes.map((node) =>
          node.id === nodeId
            ? { ...node, status: 'success' as const, artifactIds: [...node.artifactIds, artifact.id] }
            : node,
        ),
      }

      return {
        evidence,
        state: {
          projects: [{ ...localProject, testCommand: evidence.command }],
          runs: [updatedRun],
          artifacts: [artifact],
          events: [event],
          testEvidence: [evidence],
          settings: { themePreference: 'system' },
          mcpServers: [],
          agentReviews: [],
          agentTraces: [],
          agentTokenUsage: [],
          codingRuns: [],
          codingEvents: [],
          codingPermissionRequests: [],
          codingPermissionDecisions: [],
          managedCodingWorkspaces: [],
          dependencyBootstrapEvidence: [],
          codingDiffArtifacts: [],
        },
      }
    }),
    loadEnforcementPolicy: vi.fn().mockResolvedValue({
      projectId: fixtureRuns[0]!.projectId,
      organizationPolicy: policy,
      projectOverride: null,
      effectivePolicy: resolveEffectivePolicy(policy, null),
      version: policy.version,
      updatedAt: policy.updatedAt,
      syncedAt: policy.updatedAt,
      source: 'built_in_default',
    }),
    evaluateGateEnforcement: vi.fn().mockResolvedValue({
      status: 'pass',
      blocksApproval: false,
      blockingReasons: [],
      warningReasons: [],
      requiredActions: [],
      canOverride: false,
      overrideRoleRequired: 'lead',
      policySource: 'built_in_default',
      policyVersion: policy.version,
      provisional: false,
    }),
    createRun: vi.fn().mockImplementation(async (run) => run),
    saveRun: vi.fn().mockImplementation(async (run) => run),
    approveGate: vi.fn().mockImplementation(async (input) => {
      const timestamp = '2026-06-15T00:05:00.000Z'
      const run = fixtureRuns[0]!
      const updatedRun = {
        ...run,
        status: 'building' as const,
        nodes: run.nodes.map((node) =>
          node.id === input.nodeId ? { ...node, status: 'success' as const } : node,
        ),
        updatedAt: timestamp,
      }
      const event = {
        id: 'event-approval-test',
        runId: input.runId,
        nodeId: input.nodeId,
        sequence: 1,
        kind: 'approval' as const,
        message: `${input.userName} Gate approved`,
        timestamp,
      }

      return {
        run: updatedRun,
        event,
        state: {
          projects: [],
          runs: [updatedRun],
          artifacts: [],
          events: [event],
          testEvidence: [],
          settings: { themePreference: 'system' },
          mcpServers: [],
          agentReviews: [],
          agentTraces: [],
          agentTokenUsage: [],
          codingRuns: [],
          codingEvents: [],
          codingPermissionRequests: [],
          codingPermissionDecisions: [],
          managedCodingWorkspaces: [],
          dependencyBootstrapEvidence: [],
          codingDiffArtifacts: [],
        },
      }
    }),
    saveGateOverride: vi.fn().mockImplementation(async (input) => ({
      id: 'gate-override-test',
      runId: input.runId,
      nodeId: input.nodeId,
      projectId: input.projectId,
      userId: input.userId,
      role: input.role,
      reason: input.reason,
      blockedReasonIds: input.blockedReasonIds,
      policyVersion: input.policyVersion,
      provisional: input.provisional === true,
      status: input.provisional === true ? 'provisional' : 'accepted',
      createdAt: '2026-06-15T00:05:00.000Z',
    })),
    listGateOverrides: vi.fn().mockResolvedValue([]),
    saveEvent: vi.fn().mockImplementation(async (event) => event),
    saveSettings: vi.fn().mockImplementation(async (settings) => ({
      themePreference: settings.themePreference ?? 'system',
    })),
    saveMcpServers: vi.fn().mockImplementation(async (servers) => servers),
    listAgentProviders: vi.fn().mockResolvedValue([agentProvider]),
    saveAgentProviderCredential: vi.fn().mockResolvedValue({
      providerId: 'openai-default',
      model: 'gpt-4.1-mini',
      baseUrl: 'https://api.openai.com/v1',
      maskedCredential: 'sk-...test',
      updatedAt: '2026-06-15T00:03:00.000Z',
    }),
    runKnowledgeReview: vi.fn().mockImplementation(async (input) => {
      const createdAt = '2026-06-15T00:04:00.000Z'
      const review = {
        id: 'agent-review-1',
        requestId: 'agent-request-1',
        runId: input.runId,
        nodeId: input.nodeId,
        projectId: input.projectId,
        runtime: input.runtime,
        providerId: input.providerId ?? 'fake-knowledge-review',
        model: 'fake',
        conclusion: 'Knowledge review completed for the selected gate.',
        summary: 'Reviewed knowledge references and found one advisory.',
        risks: ['Gate requires reviewer evidence before approval.'],
        missingEvidence: ['Attach passing local test evidence before final approval.'],
        suggestedTests: ['Run the local test command and archive redacted evidence.'],
        knowledgeReferences: [],
        policyFindings: [],
        confidence: 0.82,
        gateAdvisory: {
          id: 'gate-advisory-1',
          runId: input.runId,
          nodeId: input.nodeId,
          level: 'warn' as const,
          blocksApproval: false,
          summary: '1 evidence gap needs reviewer attention.',
          missingEvidence: ['Attach passing local test evidence before final approval.'],
          riskCount: 1,
          createdAt,
        },
        createdAt,
      }
      const trace = {
        id: 'agent-trace-1',
        runId: input.runId,
        nodeId: input.nodeId,
        reviewId: review.id,
        runtime: input.runtime,
        createdAt,
        steps: [
          {
            id: 'agent-trace-step-1',
            kind: 'context' as const,
            label: 'Build redacted context',
            summary: 'Prepared review context.',
            timestamp: createdAt,
          },
        ],
      }
      const tokenUsage = {
        id: 'agent-token-usage-1',
        runId: input.runId,
        nodeId: input.nodeId,
        userId: input.requestedBy,
        projectId: input.projectId,
        provider: 'local' as const,
        model: 'fake',
        inputTokens: 128,
        outputTokens: 72,
        cacheReadTokens: 0,
        costUsd: 0,
        timestamp: createdAt,
        source: 'estimated' as const,
      }

      return {
        review,
        trace,
        tokenUsage,
        state: {
          projects: [localProject],
          runs: fixtureRuns,
          artifacts: [],
          events: [],
          testEvidence: [],
          settings: { themePreference: 'system' },
          mcpServers: [],
          agentReviews: [review],
          agentTraces: [trace],
          agentTokenUsage: [tokenUsage],
          codingRuns: [],
          codingEvents: [],
          codingPermissionRequests: [],
          codingPermissionDecisions: [],
          managedCodingWorkspaces: [],
          dependencyBootstrapEvidence: [],
          codingDiffArtifacts: [],
        },
      }
    }),
    listAgentReviews: vi.fn().mockResolvedValue([]),
    ensureCodingEngine: vi.fn().mockResolvedValue({
      projectId: localProject.id,
      engine: 'fake',
      status: 'ready',
    }),
    runCodingAgent: vi.fn().mockResolvedValue({
      codingRun: {
        id: 'coding-run-1',
        runId: fixtureRuns[0]!.id,
        nodeId: 'n-build',
        projectId: localProject.id,
        requestedBy: 'u-ling',
        providerId: 'fake-coding-engine',
        engine: 'fake',
        status: 'waiting_permission',
        managedWorkspaceId: 'workspace-1',
        branchName: 'devflow/run-1-node-build',
        userInstruction: 'Keep changes minimal.',
        prompt: 'local prompt',
        summary: 'Waiting for permission.',
        changedPaths: [],
        startedAt: '2026-06-16T00:00:00.000Z',
        redacted: true,
      },
      state: {
        projects: [localProject],
        runs: fixtureRuns,
        artifacts: [],
        events: [],
        testEvidence: [],
        settings: { themePreference: 'system' },
        mcpServers: [],
        agentReviews: [],
        agentTraces: [],
        agentTokenUsage: [],
        codingRuns: [],
        codingEvents: [],
        codingPermissionRequests: [],
        codingPermissionDecisions: [],
        managedCodingWorkspaces: [],
        dependencyBootstrapEvidence: [],
        codingDiffArtifacts: [],
      },
    }),
    startRetryAttempt: vi.fn().mockResolvedValue({
      retryAttempt: {
        id: 'retry-1',
        runId: fixtureRuns[0]!.id,
        nodeId: 'n-build',
        projectId: localProject.id,
        remediationPlanId: 'remediation-run-devflow-n-build-1',
        candidateIds: ['remediation-candidate-run-devflow-n-build-1'],
        requestedBy: 'u-ling',
        userInstruction: 'Apply selected remediation.',
        status: 'started',
        codingRunId: 'coding-run-1',
        createdAt: '2026-06-18T00:00:00.000Z',
      },
      codingRun: {
        id: 'coding-run-1',
        runId: fixtureRuns[0]!.id,
        nodeId: 'n-build',
        projectId: localProject.id,
        requestedBy: 'u-ling',
        providerId: 'fake-coding-engine',
        engine: 'fake',
        status: 'waiting_permission',
        managedWorkspaceId: 'workspace-1',
        branchName: 'devflow/run-1-node-build',
        userInstruction: 'Apply selected remediation.',
        prompt: 'local prompt with remediation',
        summary: 'Waiting for permission.',
        changedPaths: [],
        startedAt: '2026-06-18T00:00:00.000Z',
        redacted: true,
      },
      state: {
        projects: [localProject],
        runs: fixtureRuns,
        artifacts: [],
        events: [],
        testEvidence: [],
        settings: { themePreference: 'system' },
        mcpServers: [],
        agentReviews: [],
        agentTraces: [],
        agentTokenUsage: [],
        codingRuns: [],
        codingEvents: [],
        codingPermissionRequests: [],
        codingPermissionDecisions: [],
        managedCodingWorkspaces: [],
        dependencyBootstrapEvidence: [],
        codingDiffArtifacts: [],
        retryAttempts: [],
      },
    }),
    cancelCodingAgentRun: vi.fn(),
    replyCodingPermission: vi.fn(),
    subscribeCodingRun: vi.fn().mockResolvedValue({
      projects: [],
      runs: [],
      artifacts: [],
      events: [],
      testEvidence: [],
      settings: { themePreference: 'system' },
      mcpServers: [],
      agentReviews: [],
      agentTraces: [],
      agentTokenUsage: [],
      codingRuns: [],
      codingEvents: [],
      codingPermissionRequests: [],
      codingPermissionDecisions: [],
      managedCodingWorkspaces: [],
      dependencyBootstrapEvidence: [],
      codingDiffArtifacts: [],
    }),
    listCodingAgentRuns: vi.fn().mockResolvedValue([]),
    openManagedWorktree: vi.fn(),
    deleteManagedWorktree: vi.fn(),
    onCodingRunStatusUpdated: vi.fn(() => vi.fn()),
    onCodingEventAppended: vi.fn(() => vi.fn()),
    onCodingPermissionUpdated: vi.fn(() => vi.fn()),
    ...overrides,
  }

  Object.defineProperty(window, 'aiDevFlowDesktop', {
    configurable: true,
    value: api,
  })

  return api
}

describe('App', () => {
  it('toggles theme preference through the topbar control', () => {
    render(<App />)

    const button = screen.getByTestId('theme-toggle')
    expect(button).toHaveTextContent('跟随系统')

    fireEvent.click(button)
    expect(button).toHaveTextContent('浅色')
  })

  it('approves the selected lead gate and updates the toast', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /通过 Gate/ }))

    expect(screen.getByTestId('toast')).toHaveTextContent('架构 Gate 已通过')
  })

  it('creates a new run from the modal', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /新建 Run/ }))
    fireEvent.click(screen.getByRole('button', { name: /创建并开始澄清/ }))

    expect(screen.getByText('重构 GitHub webhook 重试策略')).toBeInTheDocument()
    expect(screen.getByTestId('toast')).toHaveTextContent('新 Run 已创建')
  })

  it('persists a newly created run through the desktop API', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /新建 Run/ }))
    fireEvent.click(screen.getByRole('button', { name: /创建并开始澄清/ }))

    await waitFor(() => expect(api.createRun).toHaveBeenCalled())
    expect(api.createRun).toHaveBeenCalledWith(expect.objectContaining({
      title: '重构 GitHub webhook 重试策略',
      status: 'clarifying',
    }))
    expect(screen.getByText('重构 GitHub webhook 重试策略')).toBeInTheDocument()
  })

  it('uses local runs without mixing fixture artifacts and events when SQLite has runs', async () => {
    installDesktopApi({
      loadState: vi.fn().mockResolvedValue({
        projects: [],
        runs: [{
          ...fixtureRuns[0]!,
          id: 'run-local-only',
          title: '本地持久化 Run',
          nodes: fixtureRuns[0]!.nodes.map((node) => ({ ...node, artifactIds: [] })),
        }],
        artifacts: [],
        events: [],
        testEvidence: [],
        settings: { themePreference: 'system' },
        mcpServers: [],
        agentReviews: [],
        agentTraces: [],
        agentTokenUsage: [],
        codingRuns: [],
        codingEvents: [],
        codingPermissionRequests: [],
        codingPermissionDecisions: [],
        managedCodingWorkspaces: [],
        dependencyBootstrapEvidence: [],
        codingDiffArtifacts: [],
      }),
    })
    render(<App />)

    await screen.findByText('本地持久化 Run')
    expect(screen.queryByText('为 Payments API 增加 /health 端点')).not.toBeInTheDocument()
    expect(screen.getByTestId('node-inspector')).not.toHaveTextContent('healthService.check()')
  })

  it('loads remote team state through the desktop sync boundary without local evidence', async () => {
    const api = installDesktopApi({
      loadRemoteSnapshot: vi.fn().mockResolvedValue({
        projects: [
          {
            id: 'p-remote-team',
            name: 'Remote Team API',
            repository: 'erich/remote-team-api',
            defaultBranch: 'main',
            health: 'blocked',
            knowledgeBasePath: 'docs/remote-team',
            testCommand: 'pnpm test:remote',
          },
        ],
        members: [
          {
            id: 'u-remote-lead',
            name: 'Remote Lead',
            role: 'lead',
            avatarInitials: 'RL',
            focus: 'Remote orchestration',
          },
        ],
        runs: [remoteRun],
        artifacts: [],
        events: [],
        projectCost: [
          {
            key: 'p-remote-team',
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 25,
            totalTokens: 175,
            costUsd: 0.25,
          },
        ],
        memberCost: [
          {
            key: 'u-remote-lead',
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 25,
            totalTokens: 175,
            costUsd: 0.25,
          },
        ],
        totalCost: '$0.250',
      }),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /同步团队/ }))

    await waitFor(() => expect(api.loadRemoteSnapshot).toHaveBeenCalledWith({ organizationId: 'org-demo' }))
    expect(await screen.findByText('远端同步 Run')).toBeInTheDocument()
    expect(screen.getByTestId('toast')).toHaveTextContent('团队远端状态已同步')

    fireEvent.click(screen.getByRole('button', { name: /Team Overview/ }))
    expect(screen.getAllByText('Remote Team API').length).toBeGreaterThan(0)
    expect(screen.getByText('erich/remote-team-api')).toBeInTheDocument()
    expect(screen.getAllByText('$0.250').length).toBeGreaterThan(0)
    expect(screen.getByText('Remote Lead')).toBeInTheDocument()
    expect(screen.queryByText('erich/payments-api')).not.toBeInTheDocument()
  })

  it('persists gate approval through the desktop write-path guard', async () => {
    const api = installDesktopApi()
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /通过 Gate/ }))

    await waitFor(() => expect(api.approveGate).toHaveBeenCalledWith(expect.objectContaining({
      runId: fixtureRuns[0]!.id,
      nodeId: 'n-design-gate',
      role: 'lead',
    })))
    await waitFor(() =>
      expect(api.uploadRunSummary).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'run',
        runId: fixtureRuns[0]!.id,
        projectId: fixtureRuns[0]!.projectId,
      })),
    )
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('approval')
  })

  it('keeps local gate approval successful when remote run sync fails', async () => {
    const api = installDesktopApi({
      uploadRunSummary: vi.fn().mockRejectedValue(new Error('remote API unavailable')),
    })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /通过 Gate/ }))

    await waitFor(() => expect(api.approveGate).toHaveBeenCalled())
    await waitFor(() => expect(api.uploadRunSummary).toHaveBeenCalled())
    expect(screen.getByTestId('toast')).toHaveTextContent('架构 Gate 已通过')
  })

  it('shows blocking enforcement details and keeps non-approval actions available', async () => {
    const recommended = createRecommendedEnforcementPreset({
      updatedAt: '2026-06-18T00:00:00.000Z',
    })
    const effectivePolicy = resolveEffectivePolicy(recommended, null)
    const api = installDesktopApi({
      loadEnforcementPolicy: vi.fn().mockResolvedValue({
        projectId: fixtureRuns[0]!.projectId,
        organizationPolicy: recommended,
        projectOverride: null,
        effectivePolicy,
        version: effectivePolicy.version,
        updatedAt: effectivePolicy.updatedAt,
        syncedAt: '2026-06-18T00:00:10.000Z',
        source: 'remote_cache',
      }),
      evaluateGateEnforcement: vi.fn().mockResolvedValue({
        status: 'blocked',
        blocksApproval: true,
        blockingReasons: [
          {
            id: 'missing_agent_review:protected_gate:missing',
            target: 'missing_agent_review',
            ruleKey: 'missing_agent_review:protected_gate:missing',
            action: 'block',
            summary: 'Knowledge Review Agent has not reviewed this protected Gate.',
            remediation: 'Run Knowledge Review Agent for this protected Gate.',
          },
        ],
        warningReasons: [],
        requiredActions: ['Run Knowledge Review Agent for this protected Gate.'],
        canOverride: true,
        overrideRoleRequired: 'lead',
        policySource: 'remote_cache',
        policyVersion: 1,
        provisional: false,
      }),
      listGateOverrides: vi.fn().mockResolvedValue([]),
    })

    render(<App />)

    await waitFor(() =>
      expect(api.evaluateGateEnforcement).toHaveBeenCalledWith({
        runId: fixtureRuns[0]!.id,
        nodeId: 'n-design-gate',
        projectId: fixtureRuns[0]!.projectId,
      }),
    )

    const inspector = screen.getByTestId('node-inspector')
    expect(inspector).toHaveTextContent('Gate Enforcement')
    expect(inspector).toHaveTextContent('blocked')
    expect(inspector).toHaveTextContent('remote_cache')
    expect(inspector).toHaveTextContent('policy v1')
    expect(inspector).toHaveTextContent('Knowledge Review Agent has not reviewed this protected Gate.')
    expect(inspector).toHaveTextContent('Run Knowledge Review Agent for this protected Gate.')
    expect(screen.getByRole('button', { name: /通过 Gate/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Agent Review/ })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /执行测试/ })).not.toBeDisabled()
  })

  it('shows provisional overrides distinctly from confirmed overrides', async () => {
    const api = installDesktopApi({
      evaluateGateEnforcement: vi.fn().mockResolvedValue({
        status: 'overridden',
        blocksApproval: false,
        blockingReasons: [
          {
            id: 'missing_agent_review:protected_gate:missing',
            target: 'missing_agent_review',
            ruleKey: 'missing_agent_review:protected_gate:missing',
            action: 'block',
            summary: 'Knowledge Review Agent has not reviewed this protected Gate.',
          },
        ],
        warningReasons: [],
        requiredActions: [],
        canOverride: true,
        overrideRoleRequired: 'lead',
        policySource: 'remote_cache',
        policyVersion: 1,
        provisional: true,
      }),
      listGateOverrides: vi.fn().mockResolvedValue([
        {
          id: 'override-provisional',
          runId: fixtureRuns[0]!.id,
          nodeId: 'n-design-gate',
          projectId: fixtureRuns[0]!.projectId,
          userId: 'u-review-lead',
          role: 'lead',
          reason: 'Offline lead override pending server confirmation.',
          blockedReasonIds: ['missing_agent_review:protected_gate:missing'],
          policyVersion: 1,
          provisional: true,
          status: 'provisional',
          createdAt: '2026-06-18T00:00:00.000Z',
        },
      ]),
    })

    render(<App />)

    await waitFor(() => expect(api.listGateOverrides).toHaveBeenCalledWith({ runId: fixtureRuns[0]!.id }))

    const inspector = screen.getByTestId('node-inspector')
    expect(inspector).toHaveTextContent('overridden')
    expect(inspector).toHaveTextContent('Provisional override')
    expect(inspector).toHaveTextContent('Offline lead override pending server confirmation.')
    expect(screen.getByRole('button', { name: /通过 Gate/ })).not.toBeDisabled()
  })

  it('shows rejected provisional overrides as blocked and actionable', async () => {
    const api = installDesktopApi({
      evaluateGateEnforcement: vi.fn().mockResolvedValue({
        status: 'blocked',
        blocksApproval: true,
        blockingReasons: [
          {
            id: 'missing_agent_review:protected_gate:missing',
            target: 'missing_agent_review',
            ruleKey: 'missing_agent_review:protected_gate:missing',
            action: 'block',
            summary: 'Knowledge Review Agent has not reviewed this protected Gate.',
            remediation: 'Run Knowledge Review Agent for this protected Gate.',
          },
        ],
        warningReasons: [],
        requiredActions: ['Run Knowledge Review Agent for this protected Gate.'],
        canOverride: true,
        overrideRoleRequired: 'lead',
        policySource: 'remote_cache',
        policyVersion: 2,
        provisional: false,
      }),
      listGateOverrides: vi.fn().mockResolvedValue([
        {
          id: 'override-rejected',
          runId: fixtureRuns[0]!.id,
          nodeId: 'n-design-gate',
          projectId: fixtureRuns[0]!.projectId,
          userId: 'u-review-lead',
          role: 'lead',
          reason: 'Rejected by team policy because version 1 is stale.',
          blockedReasonIds: ['missing_agent_review:protected_gate:missing'],
          policyVersion: 1,
          provisional: true,
          status: 'rejected',
          createdAt: '2026-06-18T00:00:00.000Z',
        },
      ]),
    })

    render(<App />)

    await waitFor(() => expect(api.listGateOverrides).toHaveBeenCalledWith({ runId: fixtureRuns[0]!.id }))

    const inspector = screen.getByTestId('node-inspector')
    expect(inspector).toHaveTextContent('Rejected override')
    expect(inspector).toHaveTextContent('Rejected by team policy because version 1 is stale.')
    expect(inspector).toHaveTextContent('Run Knowledge Review Agent for this protected Gate.')
    expect(screen.getByRole('button', { name: /通过 Gate/ })).toBeDisabled()
  })

  it('persists theme and MCP local preferences through the desktop API', async () => {
    const api = installDesktopApi()
    render(<App />)

    fireEvent.click(screen.getByTestId('theme-toggle'))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ themePreference: 'light' }))

    fireEvent.click(screen.getByRole('button', { name: /^MCP$/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /Disable/ })[0]!)

    await waitFor(() =>
      expect(api.saveMcpServers).toHaveBeenCalledWith([
        expect.objectContaining({
          id: fixtureMcpServers[0]!.id,
          enabledLocally: false,
        }),
        ...fixtureMcpServers.slice(1).map((server) => expect.objectContaining({ id: server.id })),
      ]),
    )
  })

  it('filters runs and knowledge with the search box and shows empty states', async () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Search runs and knowledge'), {
      target: { value: 'health endpoint' },
    })

    expect(screen.getByText('为 Payments API 增加 /health 端点')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search runs and knowledge'), {
      target: { value: 'nothing matches this' },
    })
    expect(screen.getByText('没有匹配的 Run')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Knowledge/ }))
    expect(screen.getByText('没有匹配的知识节点')).toBeInTheDocument()
  })

  it('shows v0.4 knowledge governance documents and selected-node checks', () => {
    render(<App />)

    expect(screen.getByTestId('node-inspector')).toHaveTextContent('Knowledge Governance')
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('API Health Endpoint Standard')
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('Local Test Evidence Standard')
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('lexical')
    expect(screen.getByTestId('node-inspector')).toHaveTextContent(/score \d+/)
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('API Health Endpoint Standard')

    fireEvent.click(screen.getByRole('button', { name: /Knowledge/ }))

    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('Knowledge Governance')
    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('Git Markdown Index')
    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('docs/knowledge/standards/api-health.md')
    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('Run references')
    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('lexical')
    expect(screen.getByTestId('knowledge-view')).toHaveTextContent(/kh-[a-f0-9]{8}/)
    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('art-design')
  })

  it('runs Knowledge Review Agent from the inspector and shows trace and advisory', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.listAgentProviders).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Agent Review/ }))

    await waitFor(() => expect(api.runKnowledgeReview).toHaveBeenCalledWith(expect.objectContaining({
      runId: fixtureRuns[0]!.id,
      nodeId: fixtureRuns[0]!.currentNodeId,
      runtime: 'electron',
      providerId: 'fake-knowledge-review',
    })))
    expect(await screen.findByTestId('agent-workbench')).toHaveTextContent('Knowledge Review Agent')
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('warning-only')
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('Build redacted context')
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('estimated')
  })

  it('subscribes to coding push updates and merges pushed state into the Agents view', async () => {
    const handlers: {
      run?: Parameters<NonNullable<DevFlowDesktopApi['onCodingRunStatusUpdated']>>[0]
      event?: Parameters<NonNullable<DevFlowDesktopApi['onCodingEventAppended']>>[0]
      permission?: Parameters<NonNullable<DevFlowDesktopApi['onCodingPermissionUpdated']>>[0]
    } = {}
    const onCodingRunStatusUpdated = vi.fn((listener: NonNullable<typeof handlers.run>) => {
      handlers.run = listener
      return vi.fn()
    })
    const onCodingEventAppended = vi.fn((listener: NonNullable<typeof handlers.event>) => {
      handlers.event = listener
      return vi.fn()
    })
    const onCodingPermissionUpdated = vi.fn((listener: NonNullable<typeof handlers.permission>) => {
      handlers.permission = listener
      return vi.fn()
    })
    installDesktopApi({
      loadState: vi.fn().mockResolvedValue({
        projects: [localProject],
        runs: fixtureRuns,
        artifacts: [],
        events: [],
        testEvidence: [],
        settings: { themePreference: 'system' },
        mcpServers: [],
        agentReviews: [],
        agentTraces: [],
        agentTokenUsage: [],
        codingRuns: [],
        codingEvents: [],
        codingPermissionRequests: [],
        codingPermissionDecisions: [],
        managedCodingWorkspaces: [],
        dependencyBootstrapEvidence: [],
        codingDiffArtifacts: [],
      }),
      onCodingRunStatusUpdated,
      onCodingEventAppended,
      onCodingPermissionUpdated,
    })
    render(<App />)

    await waitFor(() => expect(onCodingRunStatusUpdated).toHaveBeenCalled())
    act(() => {
      handlers.run?.({
        id: 'coding-run-push',
        runId: fixtureRuns[0]!.id,
        nodeId: 'n-build',
        projectId: localProject.id,
        requestedBy: 'u-ling',
        providerId: 'fake-coding-engine',
        engine: 'fake',
        status: 'waiting_permission',
        managedWorkspaceId: 'workspace-1',
        branchName: 'devflow/run-push',
        userInstruction: 'Use pushed context.',
        prompt: 'local prompt',
        summary: 'Waiting for pushed permission.',
        changedPaths: [],
        startedAt: '2026-06-17T00:00:00.000Z',
        redacted: true,
      })
      handlers.permission?.({
        id: 'permission-push',
        codingRunId: 'coding-run-push',
        runId: fixtureRuns[0]!.id,
        nodeId: 'n-build',
        permission: 'edit',
        title: 'Apply pushed diff',
        filePath: 'src/pushed.ts',
        diffPreview: '+pushed',
        risk: 'warn',
        reasons: ['Pushed permission requires approval.'],
        status: 'pending',
        requestedAt: '2026-06-17T00:00:00.000Z',
        expiresAt: '2026-06-17T00:01:00.000Z',
      })
      handlers.event?.({
        id: 'coding-event-push',
        codingRunId: 'coding-run-push',
        runId: fixtureRuns[0]!.id,
        nodeId: 'n-build',
        sequence: 1,
        kind: 'permission',
        message: 'Pushed permission event.',
        timestamp: '2026-06-17T00:00:00.000Z',
        redacted: true,
      })
    })
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))

    expect(await screen.findByTestId('agent-workbench')).toHaveTextContent('Waiting for pushed permission.')
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('Apply pushed diff')
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('Pushed permission event.')
  })

  it('selects a local project, saves an editable test command, and archives local test evidence', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /选择本地仓库/ }))
    await screen.findByText('fixture-project')

    const commandInput = screen.getByLabelText('测试命令')
    await waitFor(() => expect(commandInput).toHaveValue('pnpm test'))
    await act(async () => {
      fireEvent.change(commandInput, { target: { value: 'pnpm test -- --run' } })
    })
    expect(commandInput).toHaveValue('pnpm test -- --run')
    fireEvent.click(screen.getByRole('button', { name: /保存测试命令/ }))

    await waitFor(() =>
      expect(api.saveProjectTestCommand).toHaveBeenCalledWith({
        projectId: 'local-project-1',
        testCommand: 'pnpm test -- --run',
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: /执行测试/ }))
    await waitFor(() => expect(api.runProjectTests).toHaveBeenCalled())
    await waitFor(() =>
      expect(api.uploadTestEvidenceSummary).toHaveBeenCalledWith({
      id: 'evidence-1',
      runId: fixtureRuns[0]!.id,
      nodeId: 'n-test',
      projectId: fixtureRuns[0]!.projectId,
      command: 'pnpm test -- --run',
        status: 'passed',
        exitCode: 0,
        durationMs: 900,
        summary: 'Tests passed in 900ms',
        redacted: true,
        createdAt: '2026-06-15T00:02:00.000Z',
      }),
    )
    await screen.findByText('Local test evidence')
    expect(screen.getByTestId('tests-view')).toHaveTextContent('8 tests passed')
    expect(screen.getByTestId('tests-view')).toHaveTextContent('Exit code 0')
    expect(screen.getByTestId('tests-view')).toHaveTextContent('900ms')
    expect(screen.getByTestId('tests-view')).toHaveTextContent('Redacted no')
    expect(screen.getByTestId('toast')).toHaveTextContent('测试通过，证据已归档')

    fireEvent.click(screen.getByRole('button', { name: /工作台/ }))
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('Local Test Evidence Standard')
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('satisfied')
  })

  it('keeps local test evidence visible when remote evidence sync fails', async () => {
    const api = installDesktopApi({
      uploadTestEvidenceSummary: vi.fn().mockRejectedValue(new Error('remote API unavailable')),
    })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /选择本地仓库/ }))
    await screen.findByText('fixture-project')

    fireEvent.click(screen.getByRole('button', { name: /执行测试/ }))

    await waitFor(() => expect(api.runProjectTests).toHaveBeenCalled())
    await waitFor(() => expect(api.uploadTestEvidenceSummary).toHaveBeenCalled())
    await screen.findByText('Local test evidence')
    expect(screen.getByTestId('toast')).toHaveTextContent('测试通过，证据已归档')
  })

  it('shows command safety feedback and blocks dangerous test commands before execution', async () => {
    const api = installDesktopApi()
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /选择本地仓库/ }))
    await screen.findByText('fixture-project')

    fireEvent.change(screen.getByLabelText('测试命令'), { target: { value: 'rm -rf /tmp/devflow' } })
    await screen.findByText(/blocked/i)

    fireEvent.click(screen.getByRole('button', { name: /保存测试命令/ }))
    fireEvent.click(screen.getByRole('button', { name: /执行测试/ }))

    expect(api.runProjectTests).not.toHaveBeenCalled()
    expect(screen.getByTestId('toast')).toHaveTextContent('测试命令已阻断')
  })
})
