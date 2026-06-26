import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  advanceWorkflowAfterGateApproval,
  completeWorkflowAgentNode,
  createRecommendedEnforcementPreset,
  createWorkflowRunFromRequest,
  createWarnOnlyDefaultPolicy,
  mcpServers as fixtureMcpServers,
  resolveEffectivePolicy,
  runs as fixtureRuns,
  validateTestCommandSafety,
} from '@ai-devflow/shared'
import { App, getToastDisplayDurationMs } from './App'
import { buildWorkflowBoard } from './app/desktop-view-model'
import { useDesktopActions } from './app/useDesktopActions'
import type { DesktopWorkspaceSetters, DesktopWorkspaceState } from './app/useDesktopWorkspace'
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
    loadDesktopPairing: vi.fn().mockResolvedValue(null),
    pairDesktop: vi.fn().mockResolvedValue({
      credential: {
        tokenId: 'desktop-token-1',
        organizationId: 'org-demo',
        projectId: 'p-payments',
        userId: 'u-ling',
        role: 'lead',
        authAccountId: 'acct-ling',
        projectMemberships: [{ projectId: 'p-payments', userId: 'u-ling', role: 'lead' }],
        createdAt: '2026-06-20T00:00:00.000Z',
      },
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
    createRun: vi.fn().mockImplementation(async (input) =>
      createWorkflowRunFromRequest({
        ...input,
        runId: 'run-created-from-request',
        now: '2026-06-21T16:00:00.000Z',
      }).run,
    ),
    completeWorkflowAgentNode: vi.fn().mockImplementation(async (input) => {
      const created = createWorkflowRunFromRequest({
        runId: 'run-created-from-request',
        title: '重构 GitHub webhook 重试策略',
        request: '请先澄清 webhook retry 的失败边界，再设计实现方案。',
        projectId: 'p-payments',
        creatorId: 'u-ling',
        branchName: 'ai/webhook-retry',
        now: '2026-06-21T16:00:00.000Z',
      })
      const completed = completeWorkflowAgentNode({
        run: created.run,
        nodeId: input.nodeId,
        artifacts: created.artifacts,
        existingEvents: created.events,
        actorName: input.userName,
        now: '2026-06-21T16:05:00.000Z',
      })

      return {
        run: completed.run,
        artifact: completed.artifact,
        event: completed.event,
        state: {
          projects: [],
          runs: [completed.run],
          artifacts: completed.artifacts,
          events: [...created.events, completed.event],
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
    saveRun: vi.fn().mockImplementation(async (run) => run),
    approveGate: vi.fn().mockImplementation(async (input) => {
      const timestamp = '2026-06-15T00:05:00.000Z'
      const run = fixtureRuns[0]!
      const { run: updatedRun } = advanceWorkflowAfterGateApproval({
        run,
        approvedNodeId: input.nodeId,
        now: timestamp,
      })
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
    saveArtifact: vi.fn().mockImplementation(async (artifact) => artifact),
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
      providerId: 'doubao-review',
      model: 'ark-code-latest',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      maskedCredential: 'e8...test',
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

function DeliveryActionHarness({ api }: { api: DevFlowDesktopApi }) {
  const [runs, setRuns] = useState([fixtureRuns[0]!])
  const [artifacts, setArtifacts] = useState([])
  const [events, setEvents] = useState([])
  const [, setToast] = useState('')
  const actions = useDesktopActions({
    desktopApi: api,
    state: {
      artifacts,
      events,
      testEvidence: [],
      teamProjects: [{
        id: 'p-payments',
        name: 'Payments API',
        repository: 'erich/payments-api',
        defaultBranch: 'main',
      }],
      testCommandDraft: '',
      commandSafety: null,
      desktopPairing: null,
      pairingCodeDraft: '',
      mcpServers: [],
      selectedAgentProviderId: 'fake-knowledge-review',
      providerIdDraft: '',
      providerBaseUrlDraft: '',
      providerModelDraft: '',
      providerKeyDraft: '',
      runtimeBudgetApprovalId: '',
      draftTitle: '',
      draftRequest: '',
      codingDiffArtifacts: [],
      agentReviews: [],
    } as unknown as DesktopWorkspaceState,
    setters: {
      setRuns,
      setArtifacts,
      setEvents,
      setToast,
    } as unknown as DesktopWorkspaceSetters,
    derived: {
      selectedLocalProject: undefined,
      isTestCommandDirty: false,
    },
    selectedRun: runs[0],
    selectedNode: undefined,
    currentUser: undefined,
    pendingCodingPermission: undefined,
    latestCodingRun: undefined,
    selectedManagedWorkspace: undefined,
    gateEnforcementDecision: null,
    applyLocalExecutionState: vi.fn(),
  })

  return (
    <button
      onClick={async () => {
        await actions.generatePrDraft()
        await actions.generateAcceptanceBundle()
      }}
    >
      Generate delivery artifacts in one tick
    </button>
  )
}

function GateApprovalFallbackHarness() {
  const selectedRun = fixtureRuns[0]!
  const selectedNode = selectedRun.nodes.find((node) => node.id === selectedRun.currentNodeId)!
  const [runs, setRuns] = useState([selectedRun])
  const [events, setEvents] = useState([{
    id: 'event-existing',
    runId: selectedRun.id,
    nodeId: selectedNode.id,
    sequence: 7,
    kind: 'thinking' as const,
    message: 'Existing event.',
    timestamp: '2026-06-15T00:00:00.000Z',
  }])
  const [, setToast] = useState('')
  const actions = useDesktopActions({
    desktopApi: null,
    state: {
      artifacts: [],
      events,
      testEvidence: [],
      teamProjects: [],
      testCommandDraft: '',
      commandSafety: null,
      desktopPairing: null,
      pairingCodeDraft: '',
      mcpServers: [],
      selectedAgentProviderId: 'fake-knowledge-review',
      providerIdDraft: '',
      providerBaseUrlDraft: '',
      providerModelDraft: '',
      providerKeyDraft: '',
      runtimeBudgetApprovalId: '',
      draftTitle: '',
      draftRequest: '',
      codingDiffArtifacts: [],
      agentReviews: [],
    } as unknown as DesktopWorkspaceState,
    setters: {
      setRuns,
      setEvents,
      setToast,
    } as unknown as DesktopWorkspaceSetters,
    derived: {
      selectedLocalProject: undefined,
      isTestCommandDirty: false,
    },
    selectedRun: runs[0],
    selectedNode,
    currentUser: {
      id: 'u-ling',
      name: 'Ling',
      role: 'lead',
      avatarInitials: 'L',
      focus: 'Delivery',
    },
    pendingCodingPermission: undefined,
    latestCodingRun: undefined,
    selectedManagedWorkspace: undefined,
    gateEnforcementDecision: null,
    applyLocalExecutionState: vi.fn(),
  })

  return (
    <>
      <button
        onClick={async () => {
          vi.setSystemTime(new Date('2026-06-15T00:00:01.000Z'))
          await actions.approveSelectedGate()
          vi.setSystemTime(new Date('2026-06-15T00:00:02.000Z'))
          await actions.approveSelectedGate()
        }}
      >
        Approve twice
      </button>
      <output data-testid="event-sequences">{events.map((event) => event.sequence).join(',')}</output>
    </>
  )
}

describe('App', () => {
  it('keeps toast messages visible for at least 8 seconds and longer for long text', () => {
    expect(getToastDisplayDurationMs('测试命令已保存')).toBe(8000)
    expect(
      getToastDisplayDurationMs(
        'Team enforcement policy is unavailable. Sync policy before approving this Gate.',
      ),
    ).toBeGreaterThan(8000)
  })

  it('renders app feedback as a floating toast status', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())

    const toast = screen.getByRole('status')

    expect(toast).toHaveClass('toast--floating')
    expect(toast).toHaveAttribute('aria-live', 'polite')
  })

  it('toggles theme preference through the topbar control', () => {
    render(<App />)

    const button = screen.getByTestId('theme-toggle')
    expect(button).toHaveTextContent('跟随系统')

    fireEvent.click(button)
    expect(button).toHaveTextContent('浅色')
  })

  it('labels browser preview, seed knowledge, and fake providers as fallback sources', () => {
    render(<App />)

    expect(screen.getByTestId('runtime-source-badge')).toHaveTextContent('browser preview')
    expect(screen.getByTestId('runtime-source-badge')).toHaveTextContent('fixture fallback')

    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))
    expect(screen.getByTestId('review-provider-mode')).toHaveTextContent('fake provider fallback')

    fireEvent.click(screen.getByRole('button', { name: /^Knowledge$/ }))
    expect(screen.getByTestId('knowledge-data-source')).toHaveTextContent('shared knowledge index')
  })

  it('labels Electron preview as seed fallback when no persisted runs exist', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    expect(screen.getByTestId('runtime-source-badge')).toHaveTextContent('seed fallback')
    expect(screen.getByTestId('runtime-source-badge')).toHaveTextContent('fixture fallback')
  })

  it('approves the selected lead gate and updates the toast', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /通过 Gate/ }))

    expect(screen.getByTestId('toast')).toHaveTextContent('Gate 已通过，流程已推进')
  })

  it('creates a new run from the modal', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /新建 Run/ }))
    fireEvent.click(screen.getByRole('button', { name: /创建并开始澄清/ }))

    expect(screen.getAllByText('重构 GitHub webhook 重试策略').length).toBeGreaterThan(0)
    expect(screen.getByTestId('toast')).toHaveTextContent('新 Run 已创建')
  })

  it('persists a newly created run through the desktop API and keeps it selected first', async () => {
    const api = installDesktopApi()
    const { container } = render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /新建 Run/ }))
    fireEvent.click(screen.getByRole('button', { name: /创建并开始澄清/ }))

    await waitFor(() => expect(api.createRun).toHaveBeenCalled())
    expect(api.createRun).toHaveBeenCalledWith(expect.objectContaining({
      title: '重构 GitHub webhook 重试策略',
      request: '请先澄清 webhook retry 的失败边界，再设计实现方案。',
      projectId: 'p-payments',
      creatorId: 'u-ling',
    }))
    expect(screen.getAllByText('重构 GitHub webhook 重试策略').length).toBeGreaterThan(0)
    await waitFor(() => {
      const runRows = Array.from(container.querySelectorAll('.run-row'))
      expect(runRows[0]).toHaveTextContent('重构 GitHub webhook 重试策略')
      expect(runRows[0]).toHaveClass('is-selected')
    })
  })

  it('completes the current clarify agent through the desktop write path', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /新建 Run/ }))
    fireEvent.click(screen.getByRole('button', { name: /创建并开始澄清/ }))

    const completeButton = await screen.findByTestId('complete-clarify-agent')
    fireEvent.click(completeButton)

    await waitFor(() =>
      expect(api.completeWorkflowAgentNode).toHaveBeenCalledWith(expect.objectContaining({
        runId: 'run-created-from-request',
        nodeId: 'run-created-from-request-clarify',
        userId: 'u-ling',
        userName: 'Ling',
      })),
    )
    expect(await screen.findByText('需求澄清结果')).toBeInTheDocument()
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('需求确认 Gate')
    expect(screen.getByTestId('workflow-canvas')).toBeInTheDocument()
    expect(screen.getByTestId('toast')).toHaveTextContent('需求澄清已生成，进入需求确认 Gate')
  })

  it('completes the current clarify agent in the browser fallback path', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /新建 Run/ }))
    fireEvent.click(screen.getByRole('button', { name: /创建并开始澄清/ }))
    fireEvent.click(await screen.findByTestId('complete-clarify-agent'))

    expect(await screen.findByText('需求澄清结果')).toBeInTheDocument()
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('需求确认 Gate')
  })

  it('generates PR draft and acceptance bundle artifacts from the inspector', async () => {
    render(<App />)

    fireEvent.click(screen.getByTestId('flow-node-n-pr'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /生成 PR Draft/ }))
    })

    expect(await screen.findByText(/PR Draft:/)).toBeInTheDocument()
    expect(screen.getByText(/Pending PR creation/)).not.toBeNull()

    fireEvent.click(screen.getByTestId('flow-node-n-accept'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /生成验收证据包/ }))
    })

    expect(await screen.findByText(/Acceptance Bundle:/)).toBeInTheDocument()
    expect(screen.getByText(/PR Draft:/)).toBeInTheDocument()
  })

  it('persists increasing delivery event sequences when delivery actions run before a rerender', async () => {
    const api = installDesktopApi()
    render(<DeliveryActionHarness api={api} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate delivery artifacts in one tick/ }))
    })

    await waitFor(() => expect(api.saveEvent).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.saveEvent).mock.calls.map(([event]) => event.sequence)).toEqual([1, 2])
  })

  it('increments browser fallback gate approval event sequences from the latest events', async () => {
    vi.useFakeTimers()
    try {
      render(<GateApprovalFallbackHarness />)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Approve twice/ }))
      })

      expect(screen.getByTestId('event-sequences')).toHaveTextContent('7,8,9')
    } finally {
      vi.useRealTimers()
    }
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
    expect(screen.getByTestId('runtime-source-badge')).toHaveTextContent('local SQLite')
    expect(screen.getByTestId('runtime-source-badge')).toHaveTextContent('local persisted')
    expect(screen.queryByText('为 Payments API 增加 /health 端点')).not.toBeInTheDocument()
    expect(screen.getByTestId('node-inspector')).not.toHaveTextContent('healthService.check()')
  })

  it('explains board provenance, folded attachments, and inspector status states', () => {
    render(<App />)

    const board = screen.getByTestId('workflow-canvas')
    expect(board).toHaveTextContent('Run template')
    expect(board).toHaveTextContent('Team policy 插入')
    expect(board).toHaveTextContent('Local runtime 结果')
    expect(board).toHaveTextContent('折叠输出节点')
    expect(board).toHaveTextContent('ART')
    expect(board).toHaveTextContent('EVD')
    expect(board).toHaveTextContent('TRC')
    expect(board).toHaveTextContent('阻断 Gate 没过时，不能算完成交付')
    const railSegments = Array.from(board.querySelectorAll('.flow-rail span'))
    expect(railSegments.map((segment) => Array.from(segment.classList).find((className) => className.startsWith('is-')))).toEqual([
      'is-passed',
      'is-blocked',
      'is-waiting',
      'is-waiting',
      'is-waiting',
      'is-waiting',
    ])
    const stageProgressSegments = Array.from(board.querySelectorAll('.stage-progress'))
    expect(stageProgressSegments.map((segment) => Array.from(segment.classList).find((className) => className.startsWith('stage-progress--')))).toEqual([
      'stage-progress--passed',
      'stage-progress--blocked',
      'stage-progress--waiting',
      'stage-progress--waiting',
      'stage-progress--waiting',
      'stage-progress--waiting',
    ])
    expect(stageProgressSegments.some((segment) => segment.classList.contains('stage-progress--design'))).toBe(false)

    const inspector = screen.getByTestId('node-inspector')
    expect(screen.getByTestId('inspector-status-matrix')).toHaveTextContent('Policy snapshot')
    expect(screen.getByTestId('inspector-status-matrix')).toHaveTextContent('Knowledge Review')
    expect(inspector).toHaveTextContent('Gate 会根据 Team policy、review、evidence、role、budget 写路径重新计算')
  })

  it('derives workflow stage color from the visible cards in each stage', () => {
    const board = buildWorkflowBoard(fixtureRuns[0]!)

    expect(board.map((stage) => stage.completionState)).toEqual([
      'passed',
      'blocked',
      'waiting',
      'waiting',
      'waiting',
      'waiting',
    ])

    const advancedRun = {
      ...fixtureRuns[0]!,
      currentNodeId: 'n-test',
      nodes: fixtureRuns[0]!.nodes.map((node) =>
        node.id === 'n-design-gate'
          ? { ...node, status: 'success' as const }
          : node.id === 'n-test'
            ? { ...node, status: 'running' as const }
            : node,
      ),
    }
    const advancedBoard = buildWorkflowBoard(advancedRun)

    expect(advancedBoard.map((stage) => stage.completionState)).toEqual([
      'passed',
      'passed',
      'waiting',
      'current',
      'waiting',
      'waiting',
    ])
  })

  it('loads remote team state without hiding local runs', async () => {
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
    expect(screen.getAllByText('为 Payments API 增加 /health 端点').length).toBeGreaterThan(0)
    expect(screen.getByText(/Run Sources/)).toHaveTextContent('1 local · 1 remote')
    expect(screen.getByTestId('runtime-source-badge')).toHaveTextContent('remote snapshot + local merge')
    expect(screen.getByTestId('runtime-source-badge')).toHaveTextContent('real IPC/API')
    expect(screen.getByText('remote')).toBeInTheDocument()
    expect(screen.getAllByText('local').length).toBeGreaterThan(0)
    expect(screen.getByTestId('toast')).toHaveTextContent('团队远端状态已同步')

    fireEvent.click(screen.getByRole('button', { name: /Team Overview/ }))
    expect(screen.getAllByText('Remote Team API').length).toBeGreaterThan(0)
    expect(screen.getByText('erich/remote-team-api')).toBeInTheDocument()
    expect(screen.getAllByText('$0.250').length).toBeGreaterThan(0)
    expect(screen.getByText('Remote Lead')).toBeInTheDocument()
    expect(screen.queryByText('erich/payments-api')).not.toBeInTheDocument()
  })

  it('pairs the desktop client with a team project through the desktop API', async () => {
    const api = installDesktopApi()
    render(<App />)

    fireEvent.change(screen.getByLabelText('Desktop pairing code'), {
      target: { value: 'pair-p-payments.copy-once-secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pair' }))

    await waitFor(() =>
      expect(api.pairDesktop).toHaveBeenCalledWith({
        code: 'pair-p-payments.copy-once-secret',
      }),
    )
    expect(screen.getByText('Paired p-payments')).toBeInTheDocument()
    expect(screen.getByTestId('toast')).toHaveTextContent('已配对团队项目 p-payments')
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
    expect(screen.getByTestId('toast')).toHaveTextContent('方案评审 Gate 已通过')
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
    expect(screen.getByTestId('missing-agent-review-cta')).toHaveTextContent('Gate 前置证据不足')
    expect(screen.getByRole('button', { name: /运行 Agent Review/ })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /通过 Gate/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Agent Review' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /执行测试/ })).not.toBeDisabled()
  })

  it('explains unavailable team policy without hiding the local agent completion action', async () => {
    installDesktopApi({
      evaluateGateEnforcement: vi.fn().mockResolvedValue({
        status: 'blocked_policy_unavailable',
        blocksApproval: true,
        blockingReasons: [
          {
            id: 'policy-unavailable',
            target: 'governance_check',
            ruleKey: 'policy-unavailable',
            action: 'block',
            summary: 'Team enforcement policy is unavailable.',
          },
        ],
        warningReasons: [],
        requiredActions: ['Sync team policy before approving this Gate.'],
        canOverride: false,
        overrideRoleRequired: 'lead',
        policySource: 'unavailable',
        policyVersion: 0,
        provisional: false,
      }),
      loadEnforcementPolicy: vi.fn().mockResolvedValue({
        projectId: fixtureRuns[0]!.projectId,
        organizationPolicy: createWarnOnlyDefaultPolicy(),
        projectOverride: null,
        effectivePolicy: null,
        version: 0,
        updatedAt: '2026-06-18T00:00:00.000Z',
        syncedAt: '2026-06-18T00:00:00.000Z',
        source: 'unavailable',
      }),
    })

    render(<App />)

    const inspector = await screen.findByTestId('node-inspector')
    expect(inspector).toHaveTextContent('blocked_policy_unavailable')
    expect(screen.getByTestId('policy-unavailable-cta')).toHaveTextContent('Pair this Desktop')
    expect(screen.getByRole('button', { name: /通过 Gate/ })).toBeDisabled()
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

    expect(screen.getByTestId('search-results')).toHaveTextContent('为 Payments API 增加 /health 端点')
    expect(screen.getAllByText('为 Payments API 增加 /health 端点').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('Search runs and knowledge'), {
      target: { value: 'nothing matches this' },
    })
    expect(screen.getByTestId('search-results')).toHaveTextContent('没有匹配结果')
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

  it('opens Knowledge from an inspector reference and returns to the selected inspector', () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: /查看引用来源/ })[0]!)

    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('来自 Workbench Inspector')
    expect(screen.getByTestId('focused-knowledge-document')).toHaveTextContent('API Health Endpoint Standard')
    expect(screen.getByTestId('focused-knowledge-reference')).toHaveTextContent('lexical')

    fireEvent.click(screen.getByRole('button', { name: /返回当前 Inspector/ }))
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('Knowledge Governance')
  })

  it('opens Tests from the inspector and preserves the return target', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /执行测试/ }))

    expect(screen.getByTestId('tests-view')).toHaveTextContent('来自 Workbench Inspector')
    expect(screen.getByTestId('tests-view')).toHaveTextContent('执行本地测试并生成 Test Evidence')

    fireEvent.click(screen.getByRole('button', { name: /返回当前 Inspector/ }))
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('方案评审 Gate')
  })

  it('opens a knowledge search result instead of treating search as a passive filter only', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Search runs and knowledge'), {
      target: { value: 'API Health Endpoint Standard' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /API Health Endpoint Standard/ })[0]!)

    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('Git Markdown Index')
    expect(screen.getByTestId('focused-knowledge-document')).toHaveTextContent('API Health Endpoint Standard')
  })

  it('deep-links Artifact and Event search results back into the inspector', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Search runs and knowledge'), {
      target: { value: 'healthService.check' },
    })
    fireEvent.click(within(screen.getByTestId('search-results')).getByRole('button', { name: /方案设计/ }))

    expect(screen.getByTestId('node-inspector')).toHaveTextContent('方案设计')
    expect(screen.getByTestId('focused-artifact')).toHaveTextContent('healthService.check')

    fireEvent.change(screen.getByLabelText('Search runs and knowledge'), {
      target: { value: 'degraded 状态定义' },
    })
    fireEvent.click(within(screen.getByTestId('search-results')).getByRole('button', { name: /thinking/ }))

    expect(screen.getByTestId('node-inspector')).toHaveTextContent('需求澄清')
    expect(screen.getByTestId('focused-event')).toHaveTextContent('degraded 状态定义')
  })

  it('opens Agents from the inspector, runs Knowledge Review, and returns to the current inspector', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.listAgentProviders).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Agent Review/ }))

    expect(await screen.findByTestId('agent-workbench')).toHaveTextContent('来自 Workbench Inspector')
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('运行 Knowledge Review 并补齐 Gate Advisory')
    expect(api.runKnowledgeReview).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Run Knowledge Review/ }))

    await waitFor(() => expect(api.runKnowledgeReview).toHaveBeenCalledWith(expect.objectContaining({
      runId: fixtureRuns[0]!.id,
      nodeId: fixtureRuns[0]!.currentNodeId,
      runtime: 'electron',
      providerId: 'fake-knowledge-review',
    })))
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('Knowledge Review Agent')
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('warning-only')
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('Build redacted context')
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('estimated')

    fireEvent.click(screen.getByRole('button', { name: /返回当前 Inspector/ }))
    expect(await screen.findByTestId('node-inspector')).toHaveTextContent('Knowledge Review Agent')
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('warning-only')
  })

  it('saves a custom Review Model Provider credential for Doubao-compatible review', async () => {
    const liveProvider = {
      id: 'doubao-review',
      name: 'doubao-review',
      kind: 'openai-compatible' as const,
      model: 'ark-code-latest',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      enabled: true,
      maskedCredential: 'e8...test',
      updatedAt: '2026-06-15T00:03:00.000Z',
    }
    const listAgentProviders = vi
      .fn()
      .mockResolvedValueOnce([agentProvider])
      .mockResolvedValueOnce([agentProvider, liveProvider])
    const saveAgentProviderCredential = vi.fn().mockResolvedValue({
      providerId: 'doubao-review',
      model: 'ark-code-latest',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      maskedCredential: 'e8...test',
      updatedAt: '2026-06-15T00:03:00.000Z',
    })
    const api = installDesktopApi({ listAgentProviders, saveAgentProviderCredential })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))

    expect(await screen.findByLabelText('Review Model Provider')).toBeInTheDocument()
    expect(screen.getByTestId('review-provider-mode')).toHaveTextContent('fake provider fallback')
    expect(screen.getByLabelText('Review Provider ID')).toHaveValue('doubao-review')
    expect(screen.getByLabelText('Review Provider Base URL')).toHaveValue(
      'https://ark.cn-beijing.volces.com/api/coding/v3',
    )
    expect(screen.getByLabelText('Review Provider Model')).toHaveValue('ark-code-latest')

    fireEvent.change(screen.getByLabelText('Review Provider API Key'), {
      target: { value: 'e8fa6ce2-test-key' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Save Credential/ }))

    await waitFor(() =>
      expect(saveAgentProviderCredential).toHaveBeenCalledWith({
        providerId: 'doubao-review',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
        model: 'ark-code-latest',
        apiKey: 'e8fa6ce2-test-key',
      }),
    )
    await waitFor(() => expect(api.listAgentProviders).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('review-provider-mode')).toHaveTextContent('stored provider metadata')
    expect(screen.getByText('Review model credential saved: e8...test')).toBeInTheDocument()
  })

  it('requires an API key before saving a Review Model Provider credential', async () => {
    const api = installDesktopApi()
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))
    await screen.findByLabelText('Review Model Provider')
    fireEvent.click(screen.getByRole('button', { name: /Save Credential/ }))

    expect(api.saveAgentProviderCredential).not.toHaveBeenCalled()
    expect(screen.getByText('请输入 Review Model API Key')).toBeInTheDocument()
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

  it('explains real opencode runtime evidence without exposing raw workspace paths', async () => {
    installDesktopApi({
      loadState: vi.fn().mockResolvedValue({
        projects: [localProject],
        runs: fixtureRuns,
        artifacts: [],
        events: [],
        testEvidence: [
          {
            id: 'evidence-opencode',
            runId: fixtureRuns[0]!.id,
            nodeId: 'n-build',
            projectId: localProject.id,
            command: 'npm test',
            cwd: '/tmp/devflow-opencode-smoke/repo',
            status: 'passed',
            exitCode: 0,
            durationMs: 1200,
            stdout: 'opencode smoke tests passed',
            stderr: '',
            summary: 'opencode smoke tests passed',
            redacted: true,
            createdAt: '2026-06-20T10:24:00.000Z',
          },
        ],
        settings: { themePreference: 'system' },
        mcpServers: [],
        agentReviews: [],
        agentTraces: [],
        agentTokenUsage: [],
        codingRuns: [
          {
            id: 'coding-run-real',
            runId: fixtureRuns[0]!.id,
            nodeId: 'n-build',
            projectId: localProject.id,
            requestedBy: 'u-ling',
            providerId: 'double',
            engine: 'opencode-http',
            status: 'completed',
            managedWorkspaceId: 'workspace-real',
            branchName: 'devflow/opencode-smoke',
            userInstruction: 'Create a smoke marker.',
            prompt: 'redacted prompt',
            summary: 'opencode completed the managed coding run.',
            changedPaths: ['devflow-opencode-smoke.txt'],
            startedAt: '2026-06-20T10:20:00.000Z',
            completedAt: '2026-06-20T10:24:00.000Z',
            diffArtifactId: 'diff-opencode',
            bootstrapEvidenceId: 'bootstrap-opencode',
            testEvidenceId: 'evidence-opencode',
            redacted: true,
          },
        ],
        codingEvents: [
          {
            id: 'coding-event-brief',
            codingRunId: 'coding-run-real',
            runId: fixtureRuns[0]!.id,
            nodeId: 'n-build',
            sequence: 1,
            kind: 'brief',
            message: 'DevFlow coding brief sent to opencode HTTP session.',
            timestamp: '2026-06-20T10:20:00.000Z',
            redacted: true,
          },
          {
            id: 'coding-event-permission',
            codingRunId: 'coding-run-real',
            runId: fixtureRuns[0]!.id,
            nodeId: 'n-build',
            sequence: 2,
            kind: 'permission',
            message: 'opencode requested bash permission.',
            timestamp: '2026-06-20T10:21:00.000Z',
            redacted: true,
          },
          {
            id: 'coding-event-tool-call',
            codingRunId: 'coding-run-real',
            runId: fixtureRuns[0]!.id,
            nodeId: 'n-build',
            sequence: 3,
            kind: 'tool_call',
            message: 'opencode requested bash via shell-runner.',
            timestamp: '2026-06-20T10:21:01.000Z',
            metadata: {
              source: 'opencode_metadata',
              permissionRequestId: 'permission-bash',
              permission: 'bash',
              toolName: 'bash',
              skillName: 'shell-runner',
              commandSummary: 'npm test',
              inputSummary: 'bash: npm test',
              redactionApplied: true,
            },
            redacted: true,
          },
          {
            id: 'coding-event-tool-result',
            codingRunId: 'coding-run-real',
            runId: fixtureRuns[0]!.id,
            nodeId: 'n-build',
            sequence: 4,
            kind: 'tool_result',
            message: 'DevFlow approved opencode bash permission.',
            timestamp: '2026-06-20T10:21:02.000Z',
            metadata: {
              source: 'opencode_metadata',
              permissionRequestId: 'permission-bash',
              permission: 'bash',
              toolName: 'bash',
              skillName: 'shell-runner',
              decision: 'approved',
              status: 'completed',
              outputSummary: 'DevFlow relay approved bash permission; opencode completed after the tool action.',
              redactionApplied: false,
            },
            redacted: true,
          },
          {
            id: 'coding-event-cleanup',
            codingRunId: 'coding-run-real',
            runId: fixtureRuns[0]!.id,
            nodeId: 'n-build',
            sequence: 7,
            kind: 'cleanup',
            message: 'Managed coding workspace cleanup completed.',
            timestamp: '2026-06-20T10:25:00.000Z',
            metadata: { cleanupStatus: 'deleted' },
            redacted: true,
          },
        ],
        codingPermissionRequests: [
          {
            id: 'permission-bash',
            codingRunId: 'coding-run-real',
            runId: fixtureRuns[0]!.id,
            nodeId: 'n-build',
            permission: 'bash',
            title: 'opencode requested bash permission',
            command: 'pwd',
            risk: 'safe',
            reasons: ['Confirm managed worktree.'],
            status: 'approved',
            requestedAt: '2026-06-20T10:21:00.000Z',
            expiresAt: '2026-06-20T10:22:00.000Z',
          },
        ],
        codingPermissionDecisions: [],
        managedCodingWorkspaces: [
          {
            id: 'workspace-real',
            projectId: localProject.id,
            codingRunId: 'coding-run-real',
            sourcePath: '/Users/erich/File/claude/10-showcase/ai-devflow-studio',
            worktreePath: '/tmp/devflow-opencode-smoke/worktrees/coding-run-real',
            branchName: 'devflow/opencode-smoke',
            baseBranch: 'main',
            createdAt: '2026-06-20T10:20:00.000Z',
            deletedAt: '2026-06-20T10:25:00.000Z',
            cleanupStatus: 'deleted',
          },
        ],
        dependencyBootstrapEvidence: [
          {
            id: 'bootstrap-opencode',
            codingRunId: 'coding-run-real',
            runId: fixtureRuns[0]!.id,
            nodeId: 'n-build',
            projectId: localProject.id,
            command: 'npm ci',
            status: 'passed',
            exitCode: 0,
            durationMs: 100,
            stdout: 'up to date',
            stderr: '',
            summary: 'Dependencies verified.',
            dependencyHash: 'hash-real',
            redacted: true,
            createdAt: '2026-06-20T10:22:00.000Z',
          },
        ],
        codingDiffArtifacts: [
          {
            id: 'diff-opencode',
            runId: fixtureRuns[0]!.id,
            nodeId: 'n-build',
            projectId: localProject.id,
            changedPaths: ['devflow-opencode-smoke.txt'],
            patch: 'diff --git a/devflow-opencode-smoke.txt b/devflow-opencode-smoke.txt\n+success\n',
            truncated: false,
            redacted: true,
            createdAt: '2026-06-20T10:24:00.000Z',
          },
        ],
      }),
    })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Agents/ }))

    const workbench = await screen.findByTestId('agent-workbench')
    expect(workbench).toHaveTextContent('real opencode')
    expect(workbench).toHaveTextContent('Terminal state')
    expect(workbench).toHaveTextContent('completed')
    expect(workbench).toHaveTextContent('Cleanup')
    expect(workbench).toHaveTextContent('deleted')
    expect(workbench).toHaveTextContent('Test Evidence')
    expect(workbench).toHaveTextContent('opencode smoke tests passed')
    expect(workbench).toHaveTextContent('Permission Timeline')
    expect(workbench).toHaveTextContent('approved')
    expect(workbench).toHaveTextContent('Tool / Skill Timeline')
    expect(workbench).toHaveTextContent('shell-runner')
    expect(workbench).toHaveTextContent('bash')
    expect(workbench).toHaveTextContent('opencode metadata')
    expect(workbench).toHaveTextContent('Redacted')
    expect(workbench).toHaveTextContent('DevFlow relay approved bash permission')
    expect(workbench).toHaveTextContent('devflow-opencode-smoke.txt')
    expect(workbench).not.toHaveTextContent('/tmp/devflow-opencode-smoke/worktrees/coding-run-real')
    expect(workbench).not.toHaveTextContent('/Users/erich/File/claude/10-showcase/ai-devflow-studio')
  })

  it('shows runtime budget approval retry controls for blocked coding runs', async () => {
    installDesktopApi({
      loadState: vi.fn().mockResolvedValue({
        projects: [localProject],
        runs: [{ ...fixtureRuns[0]!, currentNodeId: 'n-build' }],
        artifacts: [],
        events: [],
        testEvidence: [],
        settings: { themePreference: 'system' },
        mcpServers: [],
        agentReviews: [],
        agentTraces: [],
        agentTokenUsage: [],
        codingRuns: [
          {
            id: 'coding-run-budget-blocked',
            runId: fixtureRuns[0]!.id,
            nodeId: 'n-build',
            projectId: localProject.id,
            requestedBy: 'u-ling',
            providerId: 'double',
            engine: 'opencode-http',
            status: 'failed',
            managedWorkspaceId: 'workspace-budget',
            branchName: 'devflow/budget-blocked',
            userInstruction: 'Retry with an approved runtime budget.',
            prompt: 'redacted prompt',
            summary: 'Runtime budget requires lead approval before calling opencode-http.',
            changedPaths: [],
            startedAt: '2026-06-21T00:00:00.000Z',
            completedAt: '2026-06-21T00:00:00.000Z',
            runtimeCostSummary: {
              engine: 'opencode-http',
              providerId: 'double',
              model: 'ark-code-latest',
              inputTokens: 8000,
              outputTokens: 2000,
              cacheReadTokens: 0,
              costUsd: 0.42,
              source: 'estimated',
              timestamp: '2026-06-21T00:00:00.000Z',
            },
            budgetDecision: {
              status: 'requires_lead_approval',
              blocksRun: true,
              currentSpendUsd: 0.19,
              projectedCostUsd: 0.42,
              limitUsd: 0.2,
              approvalRequiredRole: 'lead',
              reason: 'Project runtime budget would be exceeded; lead approval is required before calling the real provider.',
            },
            redacted: true,
          },
        ],
        codingEvents: [],
        codingPermissionRequests: [],
        codingPermissionDecisions: [],
        managedCodingWorkspaces: [
          {
            id: 'workspace-budget',
            projectId: localProject.id,
            codingRunId: 'coding-run-budget-blocked',
            sourcePath: '/tmp/fixture-project',
            worktreePath: '/tmp/devflow-budget/worktree',
            branchName: 'devflow/budget-blocked',
            baseBranch: 'main',
            createdAt: '2026-06-21T00:00:00.000Z',
            cleanupStatus: 'deleted',
            deletedAt: '2026-06-21T00:01:00.000Z',
          },
        ],
        dependencyBootstrapEvidence: [],
        codingDiffArtifacts: [],
        retryAttempts: [],
      }),
    })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Agents/ }))

    const workbench = await screen.findByTestId('agent-workbench')
    expect(workbench).toHaveTextContent('Runtime Budget')
    expect(workbench).toHaveTextContent('requires_lead_approval')
    expect(workbench).toHaveTextContent('projected $0.42')
    expect(workbench).toHaveTextContent('limit $0.20')
    expect(screen.getByLabelText('Runtime budget approval ID')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry with approval/ })).toBeDisabled()
  })

  it('selects a local project, saves an editable test command, and archives local test evidence', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /选择本地仓库/ }))
    await screen.findByText('fixture-project')
    fireEvent.click(screen.getByRole('button', { name: '测试' }))

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

  it('shows explicit save states for the local test command', async () => {
    let resolveSave: (() => void) | undefined
    const api = installDesktopApi({
      saveProjectTestCommand: vi.fn(
        ({ testCommand }) =>
          new Promise<typeof localProject>((resolve) => {
            resolveSave = () =>
              resolve({
                ...localProject,
                testCommand,
                updatedAt: '2026-06-15T00:01:00.000Z',
              })
          }),
      ),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /选择本地仓库/ }))
    await screen.findByText('fixture-project')
    fireEvent.click(screen.getByRole('button', { name: '测试' }))

    expect(screen.getByRole('button', { name: /已保存/ })).toBeDisabled()

    const commandInput = screen.getByLabelText('测试命令')
    await act(async () => {
      fireEvent.change(commandInput, { target: { value: 'pnpm test -- --run' } })
    })

    const saveButton = screen.getByRole('button', { name: /保存测试命令/ })
    expect(saveButton).toBeEnabled()

    fireEvent.click(saveButton)

    expect(screen.getByRole('button', { name: /保存中/ })).toBeDisabled()
    await act(async () => {
      resolveSave?.()
    })

    await waitFor(() => expect(screen.getByRole('button', { name: /已保存/ })).toBeDisabled())
  })

  it('keeps local test evidence visible when remote evidence sync fails', async () => {
    const api = installDesktopApi({
      uploadTestEvidenceSummary: vi.fn().mockRejectedValue(new Error('remote API unavailable')),
    })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /选择本地仓库/ }))
    await screen.findByText('fixture-project')
    fireEvent.click(screen.getByRole('button', { name: '测试' }))

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
    fireEvent.click(screen.getByRole('button', { name: '测试' }))

    const commandInput = screen.getByLabelText('测试命令')
    await waitFor(() => expect(commandInput).toHaveValue('pnpm test'))
    fireEvent.change(commandInput, { target: { value: 'rm -rf /tmp/devflow' } })
    await screen.findByText('Command contains destructive recursive removal.')
    fireEvent.click(screen.getByRole('button', { name: /保存测试命令/ }))
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('测试命令已阻断'))
    expect(api.saveProjectTestCommand).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /执行测试/ }))
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('测试命令已阻断'))

    expect(api.runProjectTests).not.toHaveBeenCalled()
  })
})
