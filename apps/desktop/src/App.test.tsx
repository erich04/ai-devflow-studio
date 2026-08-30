import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  advanceWorkflowAfterGateApproval,
  completeWorkflowAgentNode,
  createRecommendedEnforcementPreset,
  createWorkflowRunFromRequest,
  createWarnOnlyDefaultPolicy,
  indexKnowledgeSources,
  resolveEffectivePolicy,
  type AgentReviewResult,
  type Artifact,
  type CodingAgentRun,
  type CodingRuntimeReadiness,
  type DesktopPairingCredential,
  type GitHubDeliveryIntent,
  type GitHubDeliveryOperatorOutcome,
  type GitHubDeliveryRevocationCheck,
  type GitHubRepositoryBinding,
  type RepositoryKnowledgeSnapshot,
  type RemoteSyncOperation,
  type TestEvidence,
  validateTestCommandSafety,
} from '@ai-devflow/shared'
import {
  artifacts as fixtureArtifacts,
  events as fixtureEvents,
  knowledgeSources as fixtureKnowledgeSources,
  mcpServers as fixtureMcpServers,
  runs as fixtureRuns,
} from '@ai-devflow/shared/fixtures'
import { App, getToastDisplayDurationMs } from './App'
import { buildWorkflowBoard } from './app/desktop-view-model'
import { useDesktopActions } from './app/useDesktopActions'
import type { DesktopWorkspaceSetters, DesktopWorkspaceState } from './app/useDesktopWorkspace'
import type { DevFlowDesktopApi, RunProjectTestsInput } from './desktop-api'

const localProject = {
  id: fixtureRuns[0]!.projectId,
  name: 'fixture-project',
  path: '/tmp/fixture-project',
  packageManager: 'pnpm' as const,
  detectedTestCommand: 'pnpm test',
  testCommand: 'pnpm test',
  createdAt: '2026-06-15T00:00:00.000Z',
  updatedAt: '2026-06-15T00:00:00.000Z',
}

const aiFdcProject = {
  id: 'local-1367832b7a57',
  name: 'ai-fdc',
  path: '/Users/erich/File/claude/10-showcase/ai-fdc',
  packageManager: 'pnpm' as const,
  detectedTestCommand: '',
  testCommand: '',
  createdAt: '2026-06-27T00:00:00.000Z',
  updatedAt: '2026-06-27T00:00:00.000Z',
}

const remoteRun = {
  ...fixtureRuns[0]!,
  id: 'run-remote-sync',
  title: '远端同步 Run',
  projectId: 'p-remote-team',
  currentNodeId: 'n-design-gate',
}

const agentProvider = {
  id: 'doubao-review',
  name: 'doubao-review',
  kind: 'openai-compatible' as const,
  model: 'ark-code-latest',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
  enabled: true,
  maskedCredential: 'e8...test',
  updatedAt: '2026-06-15T00:03:00.000Z',
}

const fixturePairingCredential: DesktopPairingCredential = {
  tokenId: 'desktop-token-1',
  organizationId: 'org-demo',
  projectId: fixtureRuns[0]!.projectId,
  localProjectId: localProject.id,
  userId: 'u-ling',
  role: 'lead',
  issuedRole: 'lead',
  expiresAt: '2999-01-01T00:00:00.000Z',
  userName: 'Ling',
  projectName: 'Payments API',
  authAccountId: 'acct-ling',
  projectMemberships: [{ projectId: fixtureRuns[0]!.projectId, userId: 'u-ling', role: 'lead' }],
  createdAt: '2026-06-20T00:00:00.000Z',
}

function repositoryKnowledgeSnapshot(
  projectId: string,
  overrides: Partial<RepositoryKnowledgeSnapshot> = {},
): RepositoryKnowledgeSnapshot {
  const index = indexKnowledgeSources([fixtureKnowledgeSources[0]!])

  return {
    projectId,
    contentHash: 'repository-hash-1',
    documents: index.documents,
    chunks: index.chunks,
    entities: index.entities,
    relations: index.relations,
    indexedAt: '2026-08-01T00:00:00.000Z',
    truncated: false,
    warnings: [],
    ...overrides,
  }
}

function desktopState(
  overrides: Partial<Awaited<ReturnType<DevFlowDesktopApi['loadState']>>> = {},
): Awaited<ReturnType<DevFlowDesktopApi['loadState']>> {
  return {
    remoteSyncOperations: [],
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
    ...overrides,
  }
}

function remoteSyncOperation(
  overrides: Partial<RemoteSyncOperation> = {},
): RemoteSyncOperation {
  return {
    id: 'remote-sync-operation-1',
    kind: 'run-summary',
    localProjectId: localProject.id,
    organizationId: 'org-demo',
    teamProjectId: fixtureRuns[0]!.projectId,
    runId: fixtureRuns[0]!.id,
    entityId: fixtureRuns[0]!.id,
    idempotencyKey: 'remote-sync:v1:fixture-project:run-summary:run-1:run-1',
    status: 'pending',
    generation: 1,
    attemptCount: 0,
    nextAttemptAt: '2026-08-01T12:00:00.000Z',
    leaseExpiresAt: null,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    recovery: 'none',
    completedAt: null,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  }
}

function persistedFixtureRunState() {
  return desktopState({
    projects: [localProject],
    runs: [fixtureRuns[0]!],
    desktopPairingCredential: fixturePairingCredential,
  })
}

function fixtureRunAtCurrentNode(nodeId: string) {
  const activeIndex = fixtureRuns[0]!.nodes.findIndex((node) => node.id === nodeId)

  return {
    ...fixtureRuns[0]!,
    currentNodeId: nodeId,
    nodes: fixtureRuns[0]!.nodes.map((node, index) => {
      if (index < activeIndex) {
        return { ...node, status: 'success' as const }
      }
      if (node.id === nodeId) {
        return { ...node, status: node.kind === 'gate' ? node.status : 'running' as const }
      }
      if (index > activeIndex) {
        return { ...node, status: 'pending' as const }
      }
      return node
    }),
  }
}

function localStateAtCurrentNode(nodeId: string) {
  return desktopState({
    projects: [localProject],
    runs: [fixtureRunAtCurrentNode(nodeId)],
    desktopPairingCredential: fixturePairingCredential,
  })
}

function codingReadinessFixture(
  overrides: Partial<CodingRuntimeReadiness> = {},
): CodingRuntimeReadiness {
  return {
    projectId: localProject.id,
    runId: fixtureRuns[0]!.id,
    nodeId: 'n-build',
    status: 'ready',
    engine: 'native',
    executor: 'native-model',
    availability: 'available',
    capabilities: ['cancellation', 'structured_diff', 'workspace_edit', 'workspace_read'],
    providerRequirement: 'saved-provider',
    providerId: agentProvider.id,
    configVersion: 1,
    checks: [
      { code: 'executor_unconfigured', status: 'ready', message: 'Coding Executor 已配置。' },
      { code: 'engine_unavailable', status: 'ready', message: 'Coding Engine 可用。' },
      { code: 'capability_unavailable', status: 'ready', message: '执行能力满足要求。' },
      { code: 'provider_unavailable', status: 'ready', message: 'Provider 可用。' },
      { code: 'team_project_unpaired', status: 'ready', message: 'Team Project 已配对。' },
      { code: 'test_command_missing', status: 'ready', message: '测试命令已配置。' },
      { code: 'budget_policy_missing', status: 'ready', message: '预算策略已配置。' },
      { code: 'budget_blocked', status: 'ready', message: '预算评估允许执行。' },
    ],
    evaluatedAt: '2026-06-15T00:03:30.000Z',
    ...overrides,
  }
}

function reviewedDesignGateState() {
  const subjectArtifact = fixtureArtifacts.find((artifact) => artifact.id === 'art-design')!
  const reference = {
    id: 'knowledge-reference-design-review',
    runId: fixtureRuns[0]!.id,
    targetType: 'node' as const,
    nodeId: 'n-design-gate',
    documentId: 'document-api-design-standard',
    chunkId: 'chunk-api-design-standard-contract',
    relation: 'cites' as const,
    reason: 'The design Gate uses the API contract checklist as review criteria.',
    sourcePath: 'docs/standards/api-design.md',
    headingPath: ['API design', 'Status mapping'],
    contentHash: 'knowledge-hash-design-1',
    category: 'api_contract' as const,
    strategy: 'lexical' as const,
    lexicalMatch: {
      rawScore: 7,
      matchedTerms: ['status', 'mapping'],
      normalized: false as const,
      crossQueryComparable: false as const,
      source: 'retriever' as const,
    },
    gateEvidence: {
      status: 'reviewed_reference' as const,
      reviewId: 'agent-review-design-gate',
    },
  }
  const review: AgentReviewResult = {
    id: 'agent-review-design-gate',
    requestId: 'agent-review-request-design-gate',
    runId: fixtureRuns[0]!.id,
    nodeId: 'n-design-gate',
    projectId: fixtureRuns[0]!.projectId,
    runtime: 'electron',
    providerId: 'fake-agent-provider',
    model: 'fake',
    conclusion: 'The complete design Artifact satisfies the API contract criteria.',
    summary: 'Reviewed the exact design revision against one Knowledge source.',
    risks: [],
    missingEvidence: [],
    suggestedTests: [],
    contextManifest: {
      version: 1,
      stage: 'design',
      coverage: 'complete',
      runRequest: {
        contentDigest: 'request-digest-design-1',
        sanitizerVersion: 'redaction-v1',
        coverage: 'complete',
      },
      subjectArtifacts: [{
        id: subjectArtifact.id,
        runId: subjectArtifact.runId,
        nodeId: subjectArtifact.nodeId,
        kind: subjectArtifact.kind,
        updatedAt: subjectArtifact.updatedAt,
        contentDigest: 'artifact-digest-design-1',
        sanitizerVersion: 'redaction-v1',
        coverage: 'complete',
        chunks: [{
          index: 0,
          start: 0,
          end: subjectArtifact.content.length,
          contentDigest: 'artifact-chunk-digest-design-1',
        }],
      }],
      knowledgeCriteria: [{
        referenceId: reference.id,
        documentId: reference.documentId,
        chunkId: reference.chunkId,
        contentHash: reference.contentHash,
        strategy: reference.strategy,
        lexicalMatch: reference.lexicalMatch,
        gateEvidence: reference.gateEvidence,
      }],
      criteriaCoverage: 'available',
    },
    knowledgeReferences: [reference],
    policyFindings: [],
    confidence: 0.91,
    gateAdvisory: {
      id: 'gate-advisory-design-gate',
      runId: fixtureRuns[0]!.id,
      nodeId: 'n-design-gate',
      level: 'info',
      blocksApproval: false,
      summary: 'The design subject is ready for reviewer approval.',
      missingEvidence: [],
      riskCount: 0,
      createdAt: '2026-08-20T12:00:00.000Z',
    },
    createdAt: '2026-08-20T12:00:00.000Z',
  }
  const testEvidence: TestEvidence = {
    id: 'test-evidence-design-baseline',
    runId: fixtureRuns[0]!.id,
    nodeId: 'n-design-gate',
    projectId: fixtureRuns[0]!.projectId,
    command: 'pnpm test -- --run',
    cwd: '/redacted/project',
    status: 'passed',
    exitCode: 0,
    durationMs: 420,
    stdout: '',
    stderr: '',
    summary: 'Baseline tests passed before implementation.',
    redacted: true,
    createdAt: '2026-08-20T11:59:00.000Z',
  }

  return desktopState({
    projects: [localProject],
    runs: [fixtureRuns[0]!],
    artifacts: [subjectArtifact],
    testEvidence: [testEvidence],
    agentReviews: [review],
    desktopPairingCredential: fixturePairingCredential,
  })
}

function prDeliveryPackageFixture(): Artifact {
  return {
    id: 'artifact-pr-delivery-package',
    runId: fixtureRuns[0]!.id,
    nodeId: 'n-pr',
    kind: 'pr',
    title: 'PR Delivery Package',
    summary: 'Redacted package bound to the reviewed coding source.',
    content: 'Safe delivery summary.',
    redacted: true,
    updatedAt: '2026-08-11T12:00:00.000Z',
    githubDeliverySource: {
      stateVersion: 1,
      codingRunId: 'coding-run-1',
      workspaceId: 'workspace-1',
      diffArtifactId: 'diff-1',
      diffSourceDigest: 'a'.repeat(64),
      testEvidenceId: 'test-evidence-1',
      headBranch: 'devflow/run-1',
    },
  }
}

function githubDeliveryIntentFixture(
  status: GitHubDeliveryIntent['status'],
  overrides: Partial<GitHubDeliveryIntent> = {},
): GitHubDeliveryIntent {
  return {
    stateVersion: 1,
    id: 'github-delivery-intent-1',
    organizationId: 'org-demo',
    teamProjectId: fixtureRuns[0]!.projectId,
    localProjectId: fixtureRuns[0]!.projectId,
    runId: fixtureRuns[0]!.id,
    runVersion: fixtureRuns[0]!.version,
    nodeId: 'n-pr',
    repositoryBindingId: 'binding-1',
    repositoryBindingVersion: 4,
    installationId: '12345',
    repositoryId: '98765',
    codingRunId: 'coding-run-1',
    codingRunCompletedAt: '2026-08-11T11:30:00.000Z',
    workspaceId: 'workspace-1',
    deliverySeriesKey: `github-delivery:${'e'.repeat(64)}`,
    deliveryAttempt: 1,
    repository: 'erich/ai-devflow-studio',
    baseBranch: 'main',
    headBranch: 'devflow/run-1',
    baseCommitSha: '1'.repeat(40),
    expectedCommitSha: '2'.repeat(40),
    diffArtifactId: 'diff-1',
    diffSourceDigest: 'a'.repeat(64),
    testEvidenceId: 'test-evidence-1',
    testEvidenceCreatedAt: '2026-08-11T11:45:00.000Z',
    testEvidenceDigest: 'b'.repeat(64),
    prPackageArtifactId: 'artifact-pr-delivery-package',
    prPackageUpdatedAt: '2026-08-11T12:00:00.000Z',
    prPackageDigest: 'c'.repeat(64),
    changedPaths: ['apps/desktop/src/App.tsx'],
    intentDigest: 'd'.repeat(64),
    idempotencyKey: 'github-delivery:v1:fixture',
    status,
    createdAt: '2026-08-11T12:01:00.000Z',
    updatedAt: '2026-08-11T12:02:00.000Z',
    redacted: true,
    ...overrides,
  }
}

function githubRepositoryBindingFixture(
  intent: GitHubDeliveryIntent,
  status: GitHubRepositoryBinding['status'],
  overrides: Partial<GitHubRepositoryBinding> = {},
): GitHubRepositoryBinding {
  return {
    stateVersion: 1,
    id: intent.repositoryBindingId,
    version: status === 'revoked'
      ? intent.repositoryBindingVersion + 1
      : intent.repositoryBindingVersion,
    organizationId: intent.organizationId,
    teamProjectId: intent.teamProjectId,
    installationId: intent.installationId,
    repositoryId: intent.repositoryId,
    repository: intent.repository,
    defaultBranch: intent.baseBranch,
    status,
    validatedAt: '2026-08-11T12:09:00.000Z',
    updatedAt: '2026-08-11T12:09:00.000Z',
    redacted: true,
    ...overrides,
  }
}

function prDeliveryState(
  intent?: GitHubDeliveryIntent,
  operatorOutcomes: GitHubDeliveryOperatorOutcome[] = [],
  revocationChecks: GitHubDeliveryRevocationCheck[] = [],
  repositoryBindings: GitHubRepositoryBinding[] = [],
) {
  const artifact = prDeliveryPackageFixture()
  const run = fixtureRunAtCurrentNode('n-pr')
  const linkedRun = {
    ...run,
    nodes: run.nodes.map((node) => (
      node.id === 'n-pr'
        ? { ...node, artifactIds: [...new Set([...node.artifactIds, artifact.id])] }
        : node
    )),
  }
  return desktopState({
    projects: [localProject],
    runs: [linkedRun],
    artifacts: [artifact],
    githubDeliveryIntents: intent ? [intent] : [],
    githubDeliveryOperatorOutcomes: operatorOutcomes,
    githubDeliveryRevocationChecks: revocationChecks,
    githubRepositoryBindings: repositoryBindings,
    desktopPairingCredential: fixturePairingCredential,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-theme-preference')
  Reflect.deleteProperty(window, 'aiDevFlowDesktop')
})

function installDesktopApi(overrides: Partial<DevFlowDesktopApi> = {}) {
  const policy = createWarnOnlyDefaultPolicy({ organizationId: 'org-demo' })
  let deliveryRun = fixtureRuns[0]!
  let deliveryArtifacts = [...fixtureArtifacts]
  let deliveryEvents = [...fixtureEvents]
  const api: DevFlowDesktopApi = {
    platform: 'test',
    loadState: vi.fn().mockResolvedValue(persistedFixtureRunState()),
    loadDataProfileDiagnostics: vi.fn().mockResolvedValue({
      id: 'development-0123456789abcdef',
      name: 'local-development',
      mode: 'development',
      source: 'saved_profile',
      pathFingerprint: '0123456789abcdef',
      schemaVersion: 34,
      projectCount: 1,
      runCount: 2,
      latestRunUpdatedAt: '2026-08-30T12:00:00.000Z',
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
    listWorkRequests: vi.fn().mockResolvedValue([]),
    materializeWorkRequest: vi.fn().mockRejectedValue(
      new Error('Work Request materialization is not configured for this test.'),
    ),
    loadRepositoryKnowledge: vi.fn().mockImplementation(async ({ projectId }) => ({
      projectId,
      contentHash: '',
      documents: [],
      chunks: [],
      entities: [],
      relations: [],
      indexedAt: '2026-08-01T00:00:00.000Z',
      truncated: false,
      warnings: [],
    })),
    refreshRepositoryKnowledge: vi.fn().mockImplementation(async ({ projectId }) => ({
      projectId,
      contentHash: '',
      documents: [],
      chunks: [],
      entities: [],
      relations: [],
      indexedAt: '2026-08-01T00:00:00.000Z',
      truncated: false,
      warnings: [],
    })),
    loadDesktopPairing: vi.fn().mockResolvedValue(null),
    pairDesktop: vi.fn().mockResolvedValue({
      credential: {
        tokenId: 'desktop-token-1',
        organizationId: 'org-demo',
        projectId: 'p-payments',
        localProjectId: localProject.id,
        userId: 'u-ling',
        role: 'lead',
        issuedRole: 'lead',
        expiresAt: '2999-01-01T00:00:00.000Z',
        userName: 'Ling',
        projectName: 'Payments API',
        authAccountId: 'acct-ling',
        projectMemberships: [{ projectId: 'p-payments', userId: 'u-ling', role: 'lead' }],
        createdAt: '2026-06-20T00:00:00.000Z',
      },
    }),
    retryRemoteSyncOperation: vi.fn().mockResolvedValue(desktopState()),
    selectLocalProject: vi.fn().mockResolvedValue(localProject),
    getProjectGitStatus: vi.fn().mockResolvedValue({
      projectId: localProject.id,
      status: 'branch',
      branch: 'codex/local-context',
      refreshedAt: '2026-06-15T00:00:00.000Z',
    }),
    watchProjectGitStatus: vi.fn().mockResolvedValue({
      projectId: localProject.id,
      status: 'branch',
      branch: 'codex/local-context',
      refreshedAt: '2026-06-15T00:00:00.000Z',
    }),
    unwatchProjectGitStatus: vi.fn().mockResolvedValue(undefined),
    saveProjectTestCommand: vi.fn().mockImplementation(async ({ testCommand }) => ({
      ...localProject,
      testCommand,
      updatedAt: '2026-06-15T00:01:00.000Z',
    })),
    validateTestCommand: vi.fn().mockImplementation(async ({ testCommand }) =>
      validateTestCommandSafety(testCommand),
    ),
    runProjectTests: vi.fn().mockImplementation(async ({ runId, nodeId }: RunProjectTestsInput) => {
      const run = fixtureRuns.find((candidate) => candidate.id === runId) ?? {
        ...fixtureRuns[0]!,
        id: runId,
      }
      const evidence = {
        id: 'evidence-1',
        runId,
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
        status: 'paused_at_gate' as const,
        currentNodeId: run.nodes.find((node) => node.kind === 'pr')?.id ?? nodeId,
        nodes: run.nodes.map((node) =>
          node.id === nodeId
            ? { ...node, status: 'success' as const, artifactIds: [...node.artifactIds, artifact.id] }
            : node.kind === 'pr'
              ? { ...node, status: 'running' as const }
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
    deleteRun: vi.fn().mockResolvedValue({
      state: {
        projects: [localProject],
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
        retryAttempts: [],
      },
    }),
    startAgentRuntime: vi.fn().mockRejectedValue(
      new Error('Agent Runtime is not configured for this test.'),
    ),
    advanceAgentRuntime: vi.fn().mockRejectedValue(
      new Error('Agent Runtime is not configured for this test.'),
    ),
    cancelAgentRuntime: vi.fn().mockRejectedValue(
      new Error('Agent Runtime is not configured for this test.'),
    ),
    listAgentRuntimes: async () => [],
    getAgentRuntime: vi.fn().mockRejectedValue(
      new Error('Agent Runtime is not configured for this test.'),
    ),
    listCoordinationSessions: async () => [],
    startCoordinationPlan: async () => Promise.reject(new Error('not configured')),
    resumeCoordinationSession: async () => Promise.reject(new Error('not configured')),
    startCoordinationTask: async () => Promise.reject(new Error('not configured')),
    cancelCoordinationSession: async () => Promise.reject(new Error('not configured')),
    getCoordinationSession: vi.fn().mockRejectedValue(
      new Error('Agent Coordination is not configured for this test.'),
    ),
    listAgentMemoryLifecycle: vi.fn(async ({ localProjectId }: {
      runtimeId: string
      runId: string
      localProjectId: string
    }) => ({
      projectionVersion: 1 as const,
      localProjectId,
      observedAt: '2026-08-13T12:00:00.000Z',
      candidateCount: 0,
      memoryCount: 0,
      truncated: false,
      candidates: [],
      memories: [],
      redacted: true as const,
    })),
    promoteAgentMemoryCandidate: vi.fn().mockRejectedValue(
      new Error('Agent Memory promotion is not configured for this test.'),
    ),
    reviseAgentMemory: vi.fn().mockRejectedValue(
      new Error('Agent Memory revision is not configured for this test.'),
    ),
    deleteAgentMemory: vi.fn().mockRejectedValue(
      new Error('Agent Memory deletion is not configured for this test.'),
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
    createPrDraft: vi.fn().mockImplementation(async ({ runId, nodeId }) => {
      const timestamp = '2026-06-15T00:06:00.000Z'
      const artifact = {
        id: `artifact-${runId}-pr-draft`,
        runId,
        nodeId,
        kind: 'pr' as const,
        title: `PR Draft: ${deliveryRun.title}`,
        summary: 'Trusted PR draft.',
        content: 'Compare: https://github.com/erich/payments-api/compare/main...ai/payment-retry',
        redacted: true,
        updatedAt: timestamp,
        githubDeliverySource: {
          stateVersion: 1 as const,
          codingRunId: 'coding-run-1',
          workspaceId: 'workspace-1',
          diffArtifactId: 'diff-1',
          diffSourceDigest: 'a'.repeat(64),
          testEvidenceId: 'test-evidence-1',
          headBranch: 'devflow/run-1',
        },
      }
      const event = {
        id: `event-${artifact.id}`,
        runId,
        nodeId,
        sequence: deliveryEvents.length + 1,
        kind: 'thinking' as const,
        message: 'PR draft generated.',
        timestamp,
      }
      deliveryRun = {
        ...deliveryRun,
        status: 'paused_at_gate',
        currentNodeId: nodeId,
        version: deliveryRun.version + 1,
        updatedAt: timestamp,
        nodes: deliveryRun.nodes.map((node) => {
          if (node.id === nodeId) {
            return {
              ...node,
              status: 'running' as const,
              artifactIds: [...node.artifactIds, artifact.id],
            }
          }
          return node
        }),
      }
      deliveryArtifacts = [...deliveryArtifacts, artifact]
      deliveryEvents = [...deliveryEvents, event]
      return {
        run: deliveryRun,
        artifact,
        event,
        state: desktopState({
          projects: [localProject],
          runs: [deliveryRun],
          artifacts: deliveryArtifacts,
          events: deliveryEvents,
          desktopPairingCredential: fixturePairingCredential,
        }),
      }
    }),
    prepareGitHubDelivery: vi.fn().mockRejectedValue(
      new Error('GitHub Delivery preparation is not configured for this test.'),
    ),
    reviseGitHubDelivery: vi.fn().mockRejectedValue(
      new Error('GitHub Delivery revision is not configured for this test.'),
    ),
    retryGitHubDelivery: vi.fn().mockRejectedValue(
      new Error('GitHub Delivery retry is not configured for this test.'),
    ),
    resumeGitHubDelivery: vi.fn().mockRejectedValue(
      new Error('GitHub Delivery recovery is not configured for this test.'),
    ),
    stopGitHubDelivery: vi.fn().mockRejectedValue(
      new Error('GitHub Delivery Stop is not configured for this test.'),
    ),
    verifyGitHubDeliveryRevocation: vi.fn().mockRejectedValue(
      new Error('GitHub Delivery revocation verification is not configured for this test.'),
    ),
    createAcceptanceBundle: vi.fn().mockImplementation(async ({ runId, nodeId }) => {
      const timestamp = '2026-06-15T00:07:00.000Z'
      const artifact = {
        id: `artifact-${runId}-acceptance-bundle`,
        runId,
        nodeId,
        kind: 'acceptance' as const,
        title: `Acceptance Bundle: ${deliveryRun.title}`,
        summary: 'Trusted acceptance bundle.',
        content: `Acceptance bundle generated by the Electron workflow runtime.\nPR Draft: ${deliveryRun.title}`,
        redacted: true,
        updatedAt: timestamp,
      }
      const event = {
        id: `event-${artifact.id}`,
        runId,
        nodeId,
        sequence: deliveryEvents.length + 1,
        kind: 'thinking' as const,
        message: 'Acceptance bundle generated.',
        timestamp,
      }
      deliveryRun = {
        ...deliveryRun,
        status: 'paused_at_gate',
        currentNodeId: nodeId,
        updatedAt: timestamp,
        nodes: deliveryRun.nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                status: 'running' as const,
                artifactIds: [...node.artifactIds, artifact.id],
              }
            : node,
        ),
      }
      deliveryArtifacts = [...deliveryArtifacts, artifact]
      deliveryEvents = [...deliveryEvents, event]
      return {
        run: deliveryRun,
        artifact,
        event,
        state: desktopState({
          projects: [localProject],
          runs: [deliveryRun],
          artifacts: deliveryArtifacts,
          events: deliveryEvents,
          desktopPairingCredential: fixturePairingCredential,
        }),
      }
    }),
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
        message: `${fixturePairingCredential.userId} Gate approved`,
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
      projectId: localProject.id,
      userId: fixturePairingCredential.userId,
      role: fixturePairingCredential.role,
      reason: input.reason,
      blockedReasonIds: [],
      policyVersion: 1,
      provisional: false,
      status: 'accepted',
      createdAt: '2026-06-15T00:05:00.000Z',
    })),
    listGateOverrides: vi.fn().mockResolvedValue([]),
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
        providerId: input.providerId ?? agentProvider.id,
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
    getCodingRuntimeConfiguration: vi.fn().mockResolvedValue(null),
    saveCodingRuntimeConfiguration: vi.fn().mockImplementation(async (input) => ({
      ...input,
      version: 1,
      updatedAt: '2026-06-15T00:03:30.000Z',
    })),
    detectCodingRuntimeEngines: vi.fn().mockResolvedValue({
      projectId: localProject.id,
      candidates: [{
        engine: 'opencode-http',
        executor: 'opencode-http',
        status: 'available',
        binaryPath: '/opt/devflow/bin/opencode',
        version: '1.2.3',
        requiresConfirmation: true,
        reason: '已检测到本机 OpenCode。确认后才会把它用于当前项目。',
      }],
      detectedAt: '2026-06-15T00:03:30.000Z',
    }),
    getCodingRuntimeReadiness: vi.fn().mockResolvedValue({
      projectId: localProject.id,
      runId: fixtureRuns[0]!.id,
      nodeId: 'n-build',
      status: 'ready',
      engine: 'fake',
      executor: 'native-deterministic',
      availability: 'available',
      capabilities: ['cancellation', 'structured_diff', 'workspace_edit', 'workspace_read'],
      providerRequirement: 'none',
      checks: [],
      evaluatedAt: '2026-06-15T00:03:30.000Z',
    }),
    getCodingChangeSetPreview: vi.fn().mockImplementation(async (input) => ({
      stateVersion: 2 as const,
      id: input.changeSetId,
      codingRunId: input.codingRunId,
      phase: 'initial' as const,
      changedPaths: ['src/pushed.ts'],
      unifiedDiff: 'diff --git a/src/pushed.ts b/src/pushed.ts\n+pushed',
      changeSetDigest: 'c'.repeat(64),
      createdAt: '2026-06-15T00:03:30.000Z',
      expiresAt: '2099-06-15T00:18:30.000Z',
    })),
    getCodingRuntimeBudgetPolicy: vi.fn().mockResolvedValue(null),
    saveCodingRuntimeBudgetPolicy: vi.fn().mockImplementation(async (input) => ({
      ...input,
      currency: 'USD' as const,
      updatedAt: '2026-06-15T00:03:30.000Z',
    })),
    createCodingRuntimeBudgetApproval: vi.fn().mockImplementation(async (input) => ({
      id: 'runtime-budget-approval-1',
      projectId: input.projectId,
      requestedBy: input.requestedBy,
      approvedBy: input.requestedBy,
      role: 'owner' as const,
      providerId: agentProvider.id,
      maxAdditionalCostUsd: input.maxAdditionalCostUsd,
      reason: input.reason,
      status: 'approved' as const,
      createdAt: '2026-06-15T00:03:30.000Z',
      expiresAt: '2026-06-15T00:18:30.000Z',
    })),
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
    onAgentRuntimeUpdated: vi.fn(() => vi.fn()),
    onProjectGitStatusUpdated: vi.fn(() => vi.fn()),
    onLocalStateUpdated: vi.fn(() => vi.fn()),
    ...overrides,
  }

  Object.defineProperty(window, 'aiDevFlowDesktop', {
    configurable: true,
    value: api,
  })

  return api
}

function fillNewRunForm(title = '本地真实 Run', request = '请基于当前本地项目创建一个真实交付 Run。') {
  fireEvent.change(screen.getByLabelText('标题'), { target: { value: title } })
  fireEvent.change(screen.getByLabelText('一句话需求'), { target: { value: request } })
}

function clickInspectorTab(name: RegExp | string) {
  const inspector = screen.getByTestId('node-inspector')
  fireEvent.click(within(inspector).getByRole('tab', { name }))
  return inspector
}

function DeliveryActionHarness({ api }: { api: DevFlowDesktopApi }) {
  const [runs, setRuns] = useState([fixtureRunAtCurrentNode('n-pr')])
  const [artifacts, setArtifacts] = useState([])
  const [events, setEvents] = useState([])
  const [pendingInspectorAction, setPendingInspectorAction] = useState(null)
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
      desktopPairing: fixturePairingCredential,
      pairingCodeDraft: '',
      mcpServers: [],
      selectedAgentProviderId: agentProvider.id,
      providerNameDraft: '',
      providerBaseUrlDraft: '',
      providerModelDraft: '',
      providerKeyDraft: '',
      runtimeBudgetApprovalId: '',
      draftTitle: '',
      draftRequest: '',
      codingDiffArtifacts: [],
      agentReviews: [],
      pendingInspectorAction,
    } as unknown as DesktopWorkspaceState,
    setters: {
      setRuns,
      setArtifacts,
      setEvents,
      setToast,
      setPendingInspectorAction,
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

function PrDraftActionHarness({
  api,
  pairing,
}: {
  api: DevFlowDesktopApi
  pairing: DesktopPairingCredential | null
}) {
  const selectedRun = fixtureRunAtCurrentNode('n-pr')
  const [pendingInspectorAction, setPendingInspectorAction] = useState(null)
  const [toast, setToast] = useState('')
  const actions = useDesktopActions({
    desktopApi: api,
    state: {
      artifacts: [],
      events: [],
      testEvidence: [],
      teamProjects: [],
      testCommandDraft: '',
      commandSafety: null,
      desktopPairing: pairing,
      pairingCodeDraft: '',
      mcpServers: [],
      selectedAgentProviderId: agentProvider.id,
      providerNameDraft: '',
      providerBaseUrlDraft: '',
      providerModelDraft: '',
      providerKeyDraft: '',
      runtimeBudgetApprovalId: '',
      draftTitle: '',
      draftRequest: '',
      codingDiffArtifacts: [],
      agentReviews: [],
      pendingInspectorAction,
    } as unknown as DesktopWorkspaceState,
    setters: {
      setToast,
      setPendingInspectorAction,
    } as unknown as DesktopWorkspaceSetters,
    derived: {
      selectedLocalProject: localProject,
      isTestCommandDirty: false,
    },
    selectedRun,
    selectedNode: selectedRun.nodes.find((node) => node.id === selectedRun.currentNodeId),
    currentUser: undefined,
    pendingCodingPermission: undefined,
    latestCodingRun: undefined,
    selectedManagedWorkspace: undefined,
    gateEnforcementDecision: null,
    applyLocalExecutionState: vi.fn(),
  })

  return (
    <>
      <button onClick={() => void actions.generatePrDraft()}>Generate PR Draft directly</button>
      <span data-testid="pr-draft-action-toast">{toast}</span>
    </>
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
  const [pendingInspectorAction, setPendingInspectorAction] = useState(null)
  const [toast, setToast] = useState('')
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
      selectedAgentProviderId: agentProvider.id,
      providerNameDraft: '',
      providerBaseUrlDraft: '',
      providerModelDraft: '',
      providerKeyDraft: '',
      runtimeBudgetApprovalId: '',
      draftTitle: '',
      draftRequest: '',
      codingDiffArtifacts: [],
      agentReviews: [],
      pendingInspectorAction,
    } as unknown as DesktopWorkspaceState,
    setters: {
      setRuns,
      setEvents,
      setToast,
      setPendingInspectorAction,
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
      <output data-testid="gate-browser-toast">{toast}</output>
    </>
  )
}

function BrowserDeliveryBoundaryHarness({
  nodeId,
  action,
}: {
  nodeId: 'n-pr' | 'n-accept'
  action: 'pr' | 'acceptance'
}) {
  const initialRun = fixtureRunAtCurrentNode(nodeId)
  const [runs, setRuns] = useState([initialRun])
  const [artifacts, setArtifacts] = useState([...fixtureArtifacts])
  const [events, setEvents] = useState([...fixtureEvents])
  const [toast, setToast] = useState('')
  const [pendingInspectorAction, setPendingInspectorAction] = useState(null)
  const selectedRun = runs[0]!
  const actions = useDesktopActions({
    desktopApi: null,
    state: {
      runs,
      artifacts,
      events,
      testEvidence: [],
      teamProjects: [{
        id: fixturePairingCredential.projectId,
        name: 'Payments API',
        repository: 'erich/payments-api',
        defaultBranch: 'main',
      }],
      testCommandDraft: '',
      commandSafety: null,
      desktopPairing: fixturePairingCredential,
      pairingCodeDraft: '',
      mcpServers: [],
      selectedAgentProviderId: agentProvider.id,
      providerNameDraft: '',
      providerBaseUrlDraft: '',
      providerModelDraft: '',
      providerKeyDraft: '',
      runtimeBudgetApprovalId: '',
      draftTitle: '',
      draftRequest: '',
      codingDiffArtifacts: [],
      agentReviews: [],
      pendingInspectorAction,
    } as unknown as DesktopWorkspaceState,
    setters: {
      setRuns,
      setArtifacts,
      setEvents,
      setToast,
      setPendingInspectorAction,
    } as unknown as DesktopWorkspaceSetters,
    derived: {
      selectedLocalProject: localProject,
      isTestCommandDirty: false,
    },
    selectedRun,
    selectedNode: selectedRun.nodes.find((node) => node.id === nodeId),
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
        onClick={() => void (
          action === 'pr' ? actions.generatePrDraft() : actions.generateAcceptanceBundle()
        )}
      >
        Attempt browser delivery
      </button>
      <output data-testid="browser-delivery-toast">{toast}</output>
      <output data-testid="browser-delivery-state">
        {`${selectedRun.currentNodeId}|${artifacts.length}|${events.length}`}
      </output>
    </>
  )
}

function AcceptanceApprovalHarness({ api }: { api: DevFlowDesktopApi }) {
  const selectedRun = fixtureRunAtCurrentNode('n-accept')
  const selectedNode = selectedRun.nodes.find((node) => node.id === 'n-accept')!
  const [pendingInspectorAction, setPendingInspectorAction] = useState(null)
  const [toast, setToast] = useState('')
  const actions = useDesktopActions({
    desktopApi: api,
    state: {
      artifacts: [],
      events: [],
      testEvidence: [],
      teamProjects: [],
      testCommandDraft: '',
      commandSafety: null,
      desktopPairing: fixturePairingCredential,
      pairingCodeDraft: '',
      mcpServers: [],
      selectedAgentProviderId: agentProvider.id,
      providerNameDraft: '',
      providerBaseUrlDraft: '',
      providerModelDraft: '',
      providerKeyDraft: '',
      runtimeBudgetApprovalId: '',
      draftTitle: '',
      draftRequest: '',
      codingDiffArtifacts: [],
      agentReviews: [],
      pendingInspectorAction,
    } as unknown as DesktopWorkspaceState,
    setters: {
      setToast,
      setPendingInspectorAction,
    } as unknown as DesktopWorkspaceSetters,
    derived: {
      selectedLocalProject: localProject,
      isTestCommandDirty: false,
    },
    selectedRun,
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
      <button onClick={() => void actions.approveSelectedGate()}>Approve acceptance</button>
      <output data-testid="acceptance-toast">{toast}</output>
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

  it('shows safe LocalStore profile diagnostics without an absolute path', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadDataProfileDiagnostics).toHaveBeenCalled())
    const diagnostics = screen.getByTestId('data-profile-diagnostics')
    fireEvent.click(within(diagnostics).getByText(/本地数据/))

    expect(diagnostics).toHaveTextContent('local-development')
    expect(diagnostics).toHaveTextContent('saved_profile')
    expect(diagnostics).toHaveTextContent('Schema')
    expect(diagnostics).toHaveTextContent('v34')
    expect(diagnostics).toHaveTextContent('Run2')
    expect(diagnostics).toHaveTextContent('0123456789abcdef')
    expect(diagnostics).not.toHaveTextContent('/Users/')
  })

  it('toggles theme preference through the topbar control', () => {
    render(<App />)

    const button = screen.getByTestId('theme-toggle')
    expect(button).toHaveTextContent('跟随系统')

    fireEvent.click(button)
    expect(button).toHaveTextContent('浅色')
  })

  it('labels browser preview, unloaded knowledge, and missing providers as empty sources', () => {
    render(<App />)

    expect(screen.getByTestId('runtime-source-badge')).toHaveTextContent('browser preview')
    expect(screen.getByTestId('runtime-source-badge')).toHaveTextContent('missing contract')
    expect(screen.getByTestId('workflow-empty-state')).toHaveTextContent('暂无 Run')

    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))
    expect(screen.getByTestId('review-provider-mode')).toHaveTextContent(
      '未选择 Provider 请先添加 Provider Name、Base URL、模型和 API Key',
    )

    fireEvent.click(screen.getByRole('button', { name: /^Knowledge$/ }))
    expect(screen.getByTestId('knowledge-data-source')).toHaveTextContent('not indexed')
  })

  it('keeps unconfigured Gate Review surfaces neutral in light and dark themes', async () => {
    const api = installDesktopApi({
      listAgentProviders: vi.fn().mockResolvedValue([]),
    })
    render(<App />)

    await waitFor(() => expect(api.listAgentProviders).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))

    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(screen.getByTestId('agent-current-task')).toHaveClass('agent-current-task--soft')
    expect(screen.getByTestId('agent-current-task')).not.toHaveClass(
      'agent-current-task--warn',
      'agent-current-task--bad',
    )
    expect(screen.getByTestId('gate-review-path')).toHaveClass(
      'agent-path-card--secondary',
      'agent-path-card--soft',
    )
    expect(screen.getByTestId('gate-review-path')).not.toHaveClass(
      'agent-path-card--primary',
      'agent-path-card--warn',
      'agent-path-card--bad',
    )

    fireEvent.click(screen.getByTestId('theme-toggle'))
    fireEvent.click(screen.getByTestId('theme-toggle'))
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'))

    expect(screen.getByTestId('agent-current-task')).toHaveClass('agent-current-task--soft')
    expect(screen.getByTestId('gate-review-path')).toHaveClass('agent-path-card--soft')
  })

  it('mounts single and Multi-Agent observability for the exact selected Run and local project', async () => {
    const listAgentRuntimes = vi.fn().mockResolvedValue([])
    const listCoordinationSessions = vi.fn().mockResolvedValue([])
    const api = installDesktopApi({ listAgentRuntimes, listCoordinationSessions })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))

    expect(await screen.findByRole('region', { name: 'Agent Runtime observability' })).toBeInTheDocument()
    await waitFor(() => expect(listAgentRuntimes).toHaveBeenCalledWith({
      runId: fixtureRuns[0]!.id,
      localProjectId: localProject.id,
    }))
    expect(screen.getByText('No Agent Runtime has been recorded for this Run.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Start Agent Runtime/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Multi-Agent Coordination' }))
      .toBeInTheDocument()
    await waitFor(() => expect(listCoordinationSessions).toHaveBeenCalledWith({
      runId: fixtureRuns[0]!.id,
      localProjectId: localProject.id,
    }))
    expect(screen.getByText('No Multi-Agent Coordination has been recorded for this Run.'))
      .toBeInTheDocument()
  })

  it('labels Electron local state as empty when no persisted runs exist', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState()),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('runtime-source-badge')).toHaveTextContent('local SQLite empty'))
    expect(screen.getByTestId('workflow-empty-state')).toHaveTextContent('暂无 Run')

    const localProjectPanel = screen.getByLabelText('Local project')
    expect(within(localProjectPanel).getByText('未选择仓库')).toBeInTheDocument()
    expect(within(localProjectPanel).getByText('not selected')).toBeInTheDocument()
    expect(within(localProjectPanel).queryByText('Team Project')).not.toBeInTheDocument()
    expect(within(localProjectPanel).queryByText('Branch')).not.toBeInTheDocument()
  })

  it('does not show a stale run project id as the selected local repository team ownership', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [aiFdcProject],
        runs: [{ ...fixtureRuns[0]!, projectId: 'p-payments' }],
      })),
      watchProjectGitStatus: vi.fn().mockResolvedValue({
        projectId: aiFdcProject.id,
        status: 'branch',
        branch: 'main',
        refreshedAt: '2026-06-27T00:00:00.000Z',
      }),
      getProjectGitStatus: vi.fn().mockResolvedValue({
        projectId: aiFdcProject.id,
        status: 'branch',
        branch: 'main',
        refreshedAt: '2026-06-27T00:00:00.000Z',
      }),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())

    const localProjectPanel = screen.getByLabelText('Local project')
    expect(within(localProjectPanel).getByText('ai-fdc')).toBeInTheDocument()
    expect(within(localProjectPanel).queryByText('connected')).not.toBeInTheDocument()
    expect(within(localProjectPanel).queryByText('not selected')).not.toBeInTheDocument()
    expect(within(localProjectPanel).queryByText('未绑定 Team Project')).not.toBeInTheDocument()
    expect(within(localProjectPanel).getByText('未绑定')).toBeInTheDocument()
    expect(await within(localProjectPanel).findByText('main')).toBeInTheDocument()
    const refreshBranchButton = within(localProjectPanel).getByRole('button', { name: '刷新 Git 分支' })
    expect(refreshBranchButton).toBeInTheDocument()
    fireEvent.click(refreshBranchButton)
    await waitFor(() => expect(api.getProjectGitStatus).toHaveBeenCalledWith({ projectId: aiFdcProject.id }))
    expect(within(localProjectPanel).queryByText('Command safety')).not.toBeInTheDocument()
    expect(within(localProjectPanel).queryByText('Test command 来源')).not.toBeInTheDocument()
    expect(within(localProjectPanel).queryByText('p-payments')).not.toBeInTheDocument()
  })

  it('shows the paired Team Project id while its remote snapshot is still waiting to sync', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [aiFdcProject],
        runs: [{ ...fixtureRunAtCurrentNode('n-pr'), projectId: aiFdcProject.id }],
        desktopPairingCredential: {
          ...fixturePairingCredential,
          projectId: 'p-payments',
          localProjectId: aiFdcProject.id,
        },
      })),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())

    const projectSelector = screen.getByLabelText('Project selector')
    const localProjectPanel = screen.getByLabelText('Local project')
    expect(within(projectSelector).getByText('Payments API')).toBeInTheDocument()
    expect(within(projectSelector).getByText('已绑定 · 待同步')).toBeInTheDocument()
    expect(within(localProjectPanel).getByText('Payments API')).toBeInTheDocument()
    expect(within(localProjectPanel).getByText('已绑定 · 待同步')).toBeInTheDocument()
  })

  it('loads the Work Request Inbox only for the selected paired local project', async () => {
    const inboxWorkRequest = {
      id: 'work-request-inbox-1',
      organizationId: 'org-demo',
      projectId: fixturePairingCredential.projectId,
      title: '实现 Work Request Inbox',
      request: '把远端请求安全地创建为本地 Run。',
      version: 1,
      status: 'open' as const,
      createdByUserId: 'u-ling',
      claim: null,
      expiresAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }
    const api = installDesktopApi({
      listWorkRequests: vi.fn().mockResolvedValue([inboxWorkRequest]),
    })

    render(<App />)

    expect(await screen.findByText('实现 Work Request Inbox')).toBeInTheDocument()
    expect(api.listWorkRequests).toHaveBeenCalledTimes(1)
    expect(api.listWorkRequests).toHaveBeenCalledWith({
      localProjectId: localProject.id,
    })
    expect(screen.getByRole('region', { name: 'Work Request Inbox' })).toBeInTheDocument()
  })

  it('materializes a Work Request through the narrow command and selects the returned local Run', async () => {
    const inboxWorkRequest = {
      id: 'work-request-inbox-2',
      organizationId: 'org-demo',
      projectId: fixturePairingCredential.projectId,
      title: '交付可恢复 Inbox',
      request: '创建具备来源绑定的本地 Run。',
      version: 1,
      status: 'open' as const,
      createdByUserId: 'u-ling',
      claim: null,
      expiresAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }
    const created = createWorkflowRunFromRequest({
      runId: 'run-from-work-request-inbox',
      title: inboxWorkRequest.title,
      request: inboxWorkRequest.request,
      projectId: localProject.id,
      creatorId: 'u-ling',
      branchName: 'ai/work-request-inbox',
      now: '2026-08-01T00:01:00.000Z',
    })
    const materializedWorkRequest = {
      ...inboxWorkRequest,
      version: 3,
      status: 'materialized' as const,
      claim: {
        runId: created.run.id,
        claimedAt: '2026-08-01T00:01:00.000Z',
        materializedAt: '2026-08-01T00:02:00.000Z',
      },
      updatedAt: '2026-08-01T00:02:00.000Z',
    }
    const nextState = desktopState({
      projects: [localProject],
      runs: [created.run],
      artifacts: created.artifacts,
      events: created.events,
      desktopPairingCredential: fixturePairingCredential,
    })
    const api = installDesktopApi({
      listWorkRequests: vi
        .fn()
        .mockResolvedValueOnce([inboxWorkRequest])
        .mockResolvedValue([materializedWorkRequest]),
      materializeWorkRequest: vi.fn().mockResolvedValue({
        workRequest: materializedWorkRequest,
        run: created.run,
        state: nextState,
      }),
    })
    render(<App />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: '创建本地 Run：交付可恢复 Inbox',
      }),
    )

    await waitFor(() => {
      expect(api.materializeWorkRequest).toHaveBeenCalledWith({
        localProjectId: localProject.id,
        workRequestId: 'work-request-inbox-2',
        expectedVersion: 1,
      })
    })
    expect(Object.keys(vi.mocked(api.materializeWorkRequest).mock.calls[0]![0]).sort()).toEqual([
      'expectedVersion',
      'localProjectId',
      'workRequestId',
    ])
    expect(await screen.findByText('ai/work-request-inbox')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Work Request 已创建本地 Run')
  })

  it('treats a credential for another local project as unbound on the current project', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [aiFdcProject],
        runs: [{ ...fixtureRunAtCurrentNode('n-pr'), projectId: aiFdcProject.id }],
        desktopPairingCredential: {
          ...fixturePairingCredential,
          projectId: 'p-payments',
          localProjectId: 'local-project-other',
        },
      })),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())

    expect(screen.getByText('未配对 Team')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Project selector')).getByText('未绑定')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Local project')).getByText('未绑定')).toBeInTheDocument()
  })

  it('shows the explicitly bound Team Project for a local run after sync', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [aiFdcProject],
        runs: [{ ...fixtureRunAtCurrentNode('n-pr'), projectId: aiFdcProject.id }],
        desktopPairingCredential: {
          ...fixturePairingCredential,
          projectId: 'p-payments',
          localProjectId: aiFdcProject.id,
        },
      })),
      loadRemoteSnapshot: vi.fn().mockResolvedValue({
        projects: [{
          id: 'p-payments',
          name: 'Payments API',
          slug: 'payments-api',
          description: 'The Team Project bound to the selected local repository.',
          repository: 'erich/payments-api',
          defaultBranch: 'main',
          health: 'on_track',
          knowledgeBasePath: 'docs/',
          testCommand: 'pnpm test',
        }],
        members: [],
        runs: [],
        artifacts: [],
        events: [],
        projectCost: [],
        memberCost: [],
        totalCost: '$0.00',
      }),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /同步团队/ }))
    await waitFor(() => expect(api.loadRemoteSnapshot).toHaveBeenCalled())

    expect(within(screen.getByLabelText('Project selector')).getByText('Payments API')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Local project')).getByText('Payments API')).toBeInTheDocument()
  })

  it('approves the selected lead gate and updates the toast', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: /通过 Gate/ })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /通过 Gate/ }))

    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('方案评审 Gate 已通过，Run 进入本地实现阶段'))
  })

  it('reports final acceptance approval as a completed Run', async () => {
    const acceptanceRun = fixtureRunAtCurrentNode('n-accept')
    const completedRun = {
      ...acceptanceRun,
      status: 'completed' as const,
      nodes: acceptanceRun.nodes.map((node) => ({
        ...node,
        status: 'success' as const,
      })),
    }
    const api = installDesktopApi({
      approveGate: vi.fn().mockResolvedValue({
        run: completedRun,
        event: {
          id: 'event-acceptance-approved',
          runId: completedRun.id,
          nodeId: 'n-accept',
          sequence: 1,
          kind: 'approval',
          message: 'Acceptance approved.',
          timestamp: '2026-06-15T00:08:00.000Z',
        },
        state: desktopState({
          projects: [localProject],
          runs: [completedRun],
          desktopPairingCredential: fixturePairingCredential,
        }),
      }),
    })
    render(<AcceptanceApprovalHarness api={api} />)

    fireEvent.click(screen.getByRole('button', { name: /Approve acceptance/ }))

    await waitFor(() =>
      expect(screen.getByTestId('acceptance-toast')).toHaveTextContent('Run 已完成'),
    )
    expect(screen.getByTestId('acceptance-toast')).not.toHaveTextContent('进入本地实现阶段')
  })

  it('creates a new run from the modal', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /新建 Run/ }))
    fillNewRunForm()
    fireEvent.click(screen.getByRole('button', { name: /创建并开始澄清/ }))

    expect(screen.getAllByText('本地真实 Run').length).toBeGreaterThan(0)
    expect(screen.getByTestId('toast')).toHaveTextContent('新 Run 已创建')
  })

  it('persists a newly created run through the desktop API and keeps it selected first', async () => {
    const api = installDesktopApi()
    const { container } = render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /新建 Run/ }))
    fillNewRunForm()
    fireEvent.click(screen.getByRole('button', { name: /创建并开始澄清/ }))

    await waitFor(() => expect(api.createRun).toHaveBeenCalled())
    expect(api.createRun).toHaveBeenCalledWith(expect.objectContaining({
      title: '本地真实 Run',
      request: '请基于当前本地项目创建一个真实交付 Run。',
      projectId: localProject.id,
      creatorId: 'u-ling',
    }))
    expect(screen.getAllByText('本地真实 Run').length).toBeGreaterThan(0)
    await waitFor(() => {
      const runRows = Array.from(container.querySelectorAll('.run-row'))
      expect(runRows[0]).toHaveTextContent('本地真实 Run')
      expect(runRows[0]).toHaveClass('is-selected')
    })
  })

  it('deletes a local run from the row menu after confirmation', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: `${fixtureRuns[0]!.title} actions` }))
    fireEvent.click(screen.getByRole('menuitem', { name: /删除本地 Run/ }))
    expect(screen.getByRole('dialog', { name: 'Delete run' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除本地 Run' }))

    await waitFor(() =>
      expect(api.deleteRun).toHaveBeenCalledWith({
        runId: fixtureRuns[0]!.id,
        deleteRemote: false,
      }),
    )
  })

  it('keeps the run menu open internally and closes it on outside click, pointer, or Escape', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    const menuTrigger = screen.getByRole('button', { name: `${fixtureRuns[0]!.title} actions` })
    await act(async () => {
      fireEvent.click(menuTrigger)
    })

    const menu = screen.getByRole('menu')
    await act(async () => {
      fireEvent.pointerDown(menu)
      fireEvent.click(menu)
    })
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(document.body)
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(menuTrigger)
    })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await act(async () => {
      fireEvent.pointerDown(document.body)
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(menuTrigger)
    })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('completes the current clarify agent through the desktop write path', async () => {
    const api = installDesktopApi()
    const defaultCompleteWorkflowAgentNode = vi.mocked(api.completeWorkflowAgentNode).getMockImplementation()
    let releaseCompleteWorkflowAgentNode!: () => void
    const pendingCompleteWorkflowAgentNode = new Promise<void>((resolve) => {
      releaseCompleteWorkflowAgentNode = resolve
    })
    vi.mocked(api.completeWorkflowAgentNode).mockImplementationOnce(async (input) => {
      await pendingCompleteWorkflowAgentNode
      if (!defaultCompleteWorkflowAgentNode) {
        throw new Error('default completeWorkflowAgentNode mock is not installed')
      }
      return defaultCompleteWorkflowAgentNode(input)
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /新建 Run/ }))
    fillNewRunForm()
    fireEvent.click(screen.getByRole('button', { name: /创建并开始澄清/ }))

    const inspector = await screen.findByTestId('node-inspector')
    const completeButton = within(inspector).getByRole('button', { name: /生成需求澄清/ })
    expect(completeButton).toBe(await screen.findByTestId('complete-clarify-agent'))
    fireEvent.click(completeButton)
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('正在生成需求澄清...'))
    const pendingButton = await within(inspector).findByRole('button', { name: /生成中/ })
    expect(pendingButton).toBeDisabled()

    await act(async () => {
      releaseCompleteWorkflowAgentNode()
    })

    await waitFor(() =>
      expect(api.completeWorkflowAgentNode).toHaveBeenCalledWith(expect.objectContaining({
        runId: 'run-created-from-request',
        nodeId: 'run-created-from-request-clarify',
        userId: 'u-ling',
        userName: 'Ling',
        providerId: agentProvider.id,
      })),
    )
    const gateInspector = await screen.findByTestId('node-inspector')
    expect(gateInspector).toHaveTextContent('需求确认 Gate')
    clickInspectorTab(/Evidence/)
    expect(await screen.findByText('需求澄清结果')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-canvas')).toBeInTheDocument()
    expect(screen.getByTestId('toast')).toHaveTextContent('需求澄清已生成，进入需求确认 Gate')
  })

  it('completes the current clarify agent from Agents without running Gate Review', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /新建 Run/ }))
    fillNewRunForm()
    fireEvent.click(screen.getByRole('button', { name: /创建并开始澄清/ }))
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))

    const agentWorkbench = await screen.findByTestId('agent-workbench')
    expect(agentWorkbench).toHaveTextContent('生成需求澄清')
    expect(within(agentWorkbench).queryByRole('button', { name: /运行门禁审查/ })).not.toBeInTheDocument()

    fireEvent.click(within(agentWorkbench).getByRole('button', { name: /生成需求澄清/ }))

    await waitFor(() =>
      expect(api.completeWorkflowAgentNode).toHaveBeenCalledWith(expect.objectContaining({
        runId: 'run-created-from-request',
        nodeId: 'run-created-from-request-clarify',
        userId: 'u-ling',
        userName: 'Ling',
        providerId: agentProvider.id,
      })),
    )
    expect(api.runKnowledgeReview).not.toHaveBeenCalled()
    expect(await screen.findByTestId('node-inspector')).toHaveTextContent('需求确认 Gate')
  })

  it('keeps workflow execution read-only in the browser preview', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /新建 Run/ }))
    fillNewRunForm()
    fireEvent.click(screen.getByRole('button', { name: /创建并开始澄清/ }))
    fireEvent.click(await screen.findByTestId('complete-clarify-agent'))

    expect(await screen.findByTestId('node-inspector')).toHaveTextContent('需求澄清')
    clickInspectorTab(/产物/)
    expect(screen.queryByText('需求澄清结果')).not.toBeInTheDocument()
    expect(screen.getByTestId('toast')).toHaveTextContent(
      '浏览器预览不执行工作流推进，请在 Electron 应用中继续',
    )
  })

  it('generates the PR Delivery Package without advancing to Acceptance', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(localStateAtCurrentNode('n-pr')),
      loadRemoteSnapshot: vi.fn().mockResolvedValue({
        projects: [{
          id: fixtureRuns[0]!.projectId,
          name: 'Fixture Project',
          slug: 'fixture-project',
          description: 'Project used by this test.',
          repository: 'erich/fixture-project',
          defaultBranch: 'main',
          health: 'on_track',
          knowledgeBasePath: 'docs/',
          testCommand: 'pnpm test',
        }],
        members: [],
        runs: [],
        artifacts: [],
        events: [],
        projectCost: [],
        memberCost: [],
        totalCost: '$0.00',
      }),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /同步团队/ }))
    await waitFor(() => expect(api.loadRemoteSnapshot).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('flow-node-n-pr'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /生成 PR Delivery Package/ }))
    })

    expect(screen.getByTestId('node-inspector')).toHaveTextContent('创建 PR')
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('Prepare GitHub Delivery')
    fireEvent.click(within(screen.getByTestId('node-inspector')).getByRole('tab', { name: /Artifacts/ }))
    expect(await screen.findByText(/PR Draft:/)).toBeInTheDocument()
    expect(screen.getByText(/Compare:/)).not.toBeNull()
    expect(screen.getByTestId('flow-node-n-pr')).toHaveTextContent('当前步骤')
    expect(screen.getByTestId('flow-node-n-accept')).toHaveTextContent('等待中')
  })

  it('delegates paired project resolution to the trusted PR draft command', async () => {
    const boundTeamProjectId = 'team-fixture-project'
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [fixtureRunAtCurrentNode('n-pr')],
        desktopPairingCredential: {
          ...fixturePairingCredential,
          projectId: boundTeamProjectId,
          projectMemberships: [{
            projectId: boundTeamProjectId,
            userId: fixturePairingCredential.userId,
            role: fixturePairingCredential.role,
          }],
        },
      })),
      loadRemoteSnapshot: vi.fn().mockResolvedValue({
        projects: [
          {
            id: 'wrong-first-project',
            name: 'Wrong First Project',
            slug: 'wrong-first-project',
            description: 'Must not be used for the local run.',
            repository: 'erich/wrong-first-project',
            defaultBranch: 'main',
            health: 'on_track',
            knowledgeBasePath: 'docs/',
            testCommand: 'pnpm test',
          },
          {
            id: boundTeamProjectId,
            name: 'Bound Project',
            slug: 'bound-project',
            description: 'Explicitly bound to the local project.',
            repository: 'erich/bound-project',
            defaultBranch: 'main',
            health: 'on_track',
            knowledgeBasePath: 'docs/',
            testCommand: 'pnpm test',
          },
        ],
        members: [],
        runs: [],
        artifacts: [],
        events: [],
        projectCost: [],
        memberCost: [],
        totalCost: '$0.00',
      }),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /同步团队/ }))
    await waitFor(() => expect(api.loadRemoteSnapshot).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('flow-node-n-pr'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /生成 PR Delivery Package/ }))
    })

    expect(api.createPrDraft).toHaveBeenCalledWith({
      runId: fixtureRuns[0]!.id,
      nodeId: 'n-pr',
    })
  })

  it('routes the current build node primary CTA to the coding agent handler', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(localStateAtCurrentNode('n-build')),
      getCodingRuntimeReadiness: vi.fn().mockResolvedValue(codingReadinessFixture()),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    const inspector = await screen.findByTestId('node-inspector')
    await waitFor(() => expect(inspector).toHaveTextContent('启动 Coding Agent'))
    expect(inspector).not.toHaveTextContent('Gate Enforcement')
    expect(api.loadEnforcementPolicy).not.toHaveBeenCalled()
    expect(api.evaluateGateEnforcement).not.toHaveBeenCalled()
    const codingAction = within(inspector).getByRole('button', { name: /Coding Agent/ })
    await waitFor(() => expect(codingAction).toBeEnabled())
    fireEvent.click(codingAction)

    await waitFor(() =>
      expect(api.runCodingAgent).toHaveBeenCalledWith(expect.objectContaining({
        runId: fixtureRuns[0]!.id,
        nodeId: 'n-build',
        projectId: localProject.id,
      })),
    )
    expect(api.ensureCodingEngine).not.toHaveBeenCalled()
  })

  it('shows exact pending Change Set context in Workbench and jumps to the single Agents approval surface', async () => {
    const buildRun = fixtureRunAtCurrentNode('n-build')
    const codingRun = {
      id: 'coding-run-exact-review',
      runId: buildRun.id,
      nodeId: 'n-build',
      projectId: localProject.id,
      requestedBy: 'u-ling',
      providerId: agentProvider.id,
      engine: 'native' as const,
      status: 'waiting_permission' as const,
      managedWorkspaceId: 'workspace-exact-review',
      changeSetId: 'change-set-exact-review',
      branchName: 'devflow/exact-review',
      userInstruction: 'Review the exact patch.',
      prompt: 'local prompt',
      summary: 'Waiting for exact Change Set approval.',
      changedPaths: [],
      startedAt: '2026-08-30T12:00:00.000Z',
      redacted: true,
    }
    const digest = 'd'.repeat(64)
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [buildRun],
        desktopPairingCredential: fixturePairingCredential,
        codingRuns: [codingRun],
        codingPermissionRequests: [{
          id: 'permission-exact-review',
          codingRunId: codingRun.id,
          runId: buildRun.id,
          nodeId: 'n-build',
          origin: 'coding_executor',
          permission: 'patch',
          title: 'Apply exact two-file Change Set',
          changeSetId: codingRun.changeSetId,
          changeSetDigest: digest,
          risk: 'warn',
          reasons: ['Review both files.'],
          status: 'pending',
          requestedAt: '2026-08-30T12:00:00.000Z',
          expiresAt: '2099-08-30T12:05:00.000Z',
        }],
        managedCodingWorkspaces: [{
          id: 'workspace-exact-review',
          projectId: localProject.id,
          codingRunId: codingRun.id,
          sourcePath: localProject.path,
          worktreePath: '/tmp/exact-review',
          branchName: codingRun.branchName,
          baseBranch: 'main',
          createdAt: '2026-08-30T12:00:00.000Z',
          cleanupStatus: 'active',
        }],
      })),
      getCodingChangeSetPreview: vi.fn().mockResolvedValue({
        stateVersion: 2,
        id: codingRun.changeSetId,
        codingRunId: codingRun.id,
        phase: 'initial',
        changedPaths: ['src/a.ts', 'src/b.ts'],
        unifiedDiff: 'diff --git a/src/a.ts b/src/a.ts\n+a\ndiff --git a/src/b.ts b/src/b.ts\n+b',
        changeSetDigest: digest,
        createdAt: '2026-08-30T12:00:00.000Z',
        expiresAt: '2099-08-30T12:05:00.000Z',
      }),
    })
    render(<App />)

    const inspector = await screen.findByTestId('node-inspector')
    const summary = await within(inspector).findByTestId('workbench-coding-permission-summary')
    expect(summary).toHaveTextContent('2 个文件')
    expect(summary).toHaveTextContent(digest)
    expect(within(inspector).queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()

    fireEvent.click(within(inspector).getByRole('button', { name: '审查并批准修改' }))
    const review = await screen.findByTestId('coding-change-set-review')
    expect(within(review).getByLabelText('src/a.ts diff')).toBeInTheDocument()
    expect(within(review).getByLabelText('src/b.ts diff')).toBeInTheDocument()
    expect(within(review).getByRole('button', { name: 'Approve exact Change Set' })).toBeEnabled()
    expect(api.replyCodingPermission).not.toHaveBeenCalled()
  })

  it('explains terminal timeout evidence and confirms that retry creates a newly billable Run', async () => {
    const buildRun = fixtureRunAtCurrentNode('n-build')
    const timedOutRun = {
      id: 'coding-run-timeout',
      runId: buildRun.id,
      nodeId: 'n-build',
      projectId: localProject.id,
      requestedBy: 'u-ling',
      providerId: agentProvider.id,
      engine: 'native' as const,
      status: 'timed_out' as const,
      managedWorkspaceId: 'workspace-timeout',
      diffArtifactId: 'diff-timeout',
      testEvidenceId: 'test-timeout',
      branchName: 'devflow/timeout',
      userInstruction: 'Implement safely.',
      prompt: 'local prompt',
      summary: 'Provider response timed out.',
      changedPaths: ['src/timeout.ts'],
      startedAt: '2026-08-30T12:00:00.000Z',
      completedAt: '2026-08-30T12:01:00.000Z',
      runtimeCostSummary: {
        id: 'usage-timeout', runId: buildRun.id, nodeId: 'n-build', userId: 'u-ling', projectId: localProject.id,
        provider: 'openai' as const, providerId: agentProvider.id, model: 'ark-code-latest', inputTokens: 140,
        outputTokens: 20, cacheReadTokens: 10, cacheMissTokens: 130, totalTokens: 160,
        cacheHitRate: 10 / 140, usageStatus: 'complete' as const, costStatus: 'settled' as const,
        phase: 'provider_settlement' as const, costUsd: 0.02,
        pricingSnapshot: {
          providerId: agentProvider.id, model: 'ark-code-latest', tier: 'off_peak' as const,
          effectiveAt: '2026-08-30T00:00:00.000Z', source: 'https://pricing.example.test',
          sourceVersion: 'pricing-v1', currency: 'USD' as const, unit: 'per_1m_tokens' as const,
          cacheHitInputUsdPerMillion: 1, cacheMissInputUsdPerMillion: 2, outputUsdPerMillion: 3,
        },
        breakdown: { cacheHitInputUsd: 0.001, cacheMissInputUsd: 0.004, outputUsd: 0.015, totalUsd: 0.02 },
        providerCallSettlements: [{
          requestPhase: 'initial' as const,
          providerId: agentProvider.id,
          model: 'ark-code-latest',
          inputTokens: 140,
          outputTokens: 20,
          cacheReadTokens: 10,
          cacheMissTokens: 130,
          totalTokens: 160,
          cacheHitRate: 10 / 140,
          usageStatus: 'complete' as const,
          costStatus: 'settled' as const,
          costUsd: 0.02,
          pricingSnapshot: {
            providerId: agentProvider.id, model: 'ark-code-latest', tier: 'off_peak' as const,
            effectiveAt: '2026-08-30T00:00:00.000Z', source: 'https://pricing.example.test',
            sourceVersion: 'pricing-v1', currency: 'USD' as const, unit: 'per_1m_tokens' as const,
            cacheHitInputUsdPerMillion: 1, cacheMissInputUsdPerMillion: 2, outputUsdPerMillion: 3,
          },
          breakdown: { cacheHitInputUsd: 0.001, cacheMissInputUsd: 0.004, outputUsd: 0.015, totalUsd: 0.02 },
          timestamp: '2026-08-30T12:01:00.000Z',
          source: 'provider_reported' as const,
          redacted: true as const,
        }],
        timestamp: '2026-08-30T12:01:00.000Z',
        source: 'provider_reported' as const, redacted: true as const,
      },
      redacted: true,
    }
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [buildRun],
        desktopPairingCredential: fixturePairingCredential,
        codingRuns: [timedOutRun],
        testEvidence: [{
          id: 'test-timeout', runId: buildRun.id, nodeId: 'n-build', projectId: localProject.id,
          command: 'pnpm test', cwd: '<workspace>', status: 'failed', exitCode: 1, durationMs: 20,
          stdout: '', stderr: 'failed', summary: 'Saved test failed before timeout.', redacted: true,
          createdAt: timedOutRun.completedAt,
        }],
        codingDiffArtifacts: [{
          id: 'diff-timeout', runId: buildRun.id, nodeId: 'n-build', projectId: localProject.id,
          changedPaths: ['src/timeout.ts'], patch: 'diff --git a/src/timeout.ts b/src/timeout.ts\n+timed out',
          truncated: false, redacted: true, createdAt: timedOutRun.completedAt,
        }],
        managedCodingWorkspaces: [{
          id: 'workspace-timeout', projectId: localProject.id, codingRunId: timedOutRun.id,
          sourcePath: localProject.path, worktreePath: '/tmp/deleted-timeout', branchName: timedOutRun.branchName,
          baseBranch: 'main', createdAt: timedOutRun.startedAt, deletedAt: timedOutRun.completedAt,
          cleanupStatus: 'deleted',
        }],
        codingEvents: [{
          id: 'event-timeout', codingRunId: timedOutRun.id, runId: buildRun.id, nodeId: 'n-build', sequence: 1,
          kind: 'error', message: 'Provider response exceeded the runtime deadline.', timestamp: timedOutRun.completedAt,
          redacted: true,
        }],
      })),
      getCodingRuntimeReadiness: vi.fn().mockResolvedValue(codingReadinessFixture()),
    })
    render(<App />)

    const inspector = await screen.findByTestId('node-inspector')
    expect(inspector).toHaveTextContent('上次运行超时 · 重新运行 Coding Agent')
    const workbenchTerminal = within(inspector).getByTestId('workbench-coding-terminal')
    expect(workbenchTerminal).toHaveTextContent('Provider response exceeded the runtime deadline.')
    expect(workbenchTerminal).toHaveTextContent('Saved test failed before timeout.')
    expect(workbenchTerminal).toHaveTextContent('+timed out')
    expect(within(workbenchTerminal).getByRole('list', { name: 'Coding Run terminal trace' })).toHaveTextContent('Provider response exceeded the runtime deadline.')
    fireEvent.click(within(inspector).getByRole('button', { name: '上次运行超时 · 重新运行 Coding Agent' }))

    const agents = await screen.findByTestId('agent-workbench')
    expect(agents).toHaveTextContent('Provider response exceeded the runtime deadline.')
    expect(screen.getByTestId('coding-terminal-summary')).toHaveTextContent('140 / 20')
    expect(screen.getByTestId('coding-terminal-summary')).toHaveTextContent('10 / 130')
    expect(screen.getByTestId('coding-terminal-summary')).toHaveTextContent('7.1%')
    expect(screen.getByTestId('coding-terminal-summary')).toHaveTextContent('settled')
    expect(screen.getByTestId('coding-terminal-summary')).toHaveTextContent('pricing-v1')
    expect(screen.getByTestId('coding-terminal-summary')).toHaveTextContent('Actual provider settlement')
    expect(screen.getByTestId('coding-terminal-summary')).toHaveTextContent('hit $1 / 1M')
    expect(screen.getByTestId('coding-terminal-summary')).toHaveTextContent('miss $2 / 1M')
    expect(screen.getByTestId('coding-terminal-summary')).toHaveTextContent('output $3 / 1M')
    expect(screen.getByTestId('coding-terminal-summary')).toHaveTextContent('total $0.02')
    expect(screen.getByTestId('coding-provider-call-settlements')).toHaveTextContent('initial · off_peak')
    expect(screen.getByTestId('coding-provider-call-settlements')).toHaveTextContent('140 input · 10 hit · 130 miss · 20 output')
    expect(within(agents).queryByRole('button', { name: 'Open worktree' })).not.toBeInTheDocument()
    fireEvent.click(within(agents).getByRole('button', { name: '上次运行超时 · 重新运行 Coding Agent' }))
    const confirmation = screen.getByRole('alertdialog')
    expect(confirmation).toHaveTextContent('新的 Run ID')
    expect(confirmation).toHaveTextContent('token')
    expect(api.runCodingAgent).not.toHaveBeenCalled()
    fireEvent.click(within(confirmation).getByRole('button', { name: '新建 Run 并重试' }))
    await waitFor(() => expect(api.runCodingAgent).toHaveBeenCalledTimes(1))
  })

  it('keeps a completed Coding Run read-only without start or retry actions', async () => {
    const buildRun = fixtureRunAtCurrentNode('n-build')
    installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [buildRun],
        desktopPairingCredential: fixturePairingCredential,
        codingRuns: [{
          id: 'coding-run-complete', runId: buildRun.id, nodeId: 'n-build', projectId: localProject.id,
          requestedBy: 'u-ling', providerId: agentProvider.id, engine: 'native', status: 'completed',
          branchName: 'devflow/completed', userInstruction: 'Done', prompt: 'Done', summary: 'Completed.',
          changedPaths: ['src/done.ts'], startedAt: '2026-08-30T12:00:00.000Z',
          completedAt: '2026-08-30T12:01:00.000Z', redacted: true,
        }],
      })),
    })
    render(<App />)

    const inspector = await screen.findByTestId('node-inspector')
    expect(inspector).toHaveTextContent('查看 Coding Run 结果')
    expect(within(inspector).queryByRole('button', { name: '启动 Coding Agent' })).not.toBeInTheDocument()
    expect(within(inspector).queryByRole('button', { name: /重试/ })).not.toBeInTheDocument()
  })

  it('selects prior Coding Runs for permission, trace, terminal, and cost audit after retry', async () => {
    const buildRun = fixtureRunAtCurrentNode('n-build')
    const oldCompletedAt = '2026-08-30T12:01:00.000Z'
    const oldRun: CodingAgentRun = {
      id: 'coding-run-old-failed', runId: buildRun.id, nodeId: 'n-build', projectId: localProject.id,
      requestedBy: 'u-ling', providerId: agentProvider.id, engine: 'native' as const, status: 'failed' as const,
      branchName: 'devflow/old-failed', userInstruction: 'First try', prompt: 'First try', summary: 'Old provider failure.',
      changedPaths: [], startedAt: '2026-08-30T12:00:00.000Z', completedAt: oldCompletedAt,
      runtimeCostSummary: {
        id: 'cost-old', runId: buildRun.id, nodeId: 'n-build', userId: 'u-ling', projectId: localProject.id,
        provider: 'openai' as const, providerId: agentProvider.id, model: 'old-model', inputTokens: 90,
        outputTokens: 10, cacheReadTokens: 0, costUsd: 0.01, timestamp: '2026-08-30T12:01:00.000Z',
        source: 'provider_reported' as const, redacted: true,
      },
      redacted: true,
    }
    const { runtimeCostSummary: _oldRuntimeCostSummary, ...oldRunWithoutCost } = oldRun
    const latestRun: CodingAgentRun = {
      ...oldRunWithoutCost,
      id: 'coding-run-new-completed',
      status: 'completed' as const,
      branchName: 'devflow/new-completed',
      summary: 'Retry completed.',
      startedAt: '2026-08-30T13:00:00.000Z',
      completedAt: '2026-08-30T13:01:00.000Z',
    }
    installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject], runs: [buildRun], desktopPairingCredential: fixturePairingCredential,
        codingRuns: [oldRun, latestRun],
        codingPermissionRequests: [{
          id: 'permission-old', codingRunId: oldRun.id, runId: buildRun.id, nodeId: 'n-build',
          origin: 'coding_executor', permission: 'patch', title: 'Old exact Change Set', risk: 'warn',
          reasons: ['Old request'], status: 'rejected', requestedAt: oldRun.startedAt, expiresAt: oldCompletedAt,
        }],
        codingEvents: [{
          id: 'event-old', codingRunId: oldRun.id, runId: buildRun.id, nodeId: 'n-build', sequence: 1,
          kind: 'error', message: 'Old terminal trace.', timestamp: oldCompletedAt, redacted: true,
        }],
      })),
    })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Agents/ }))
    const picker = await screen.findByLabelText('Coding Run history')
    expect(picker).toHaveValue(latestRun.id)
    fireEvent.change(picker, { target: { value: oldRun.id } })
    const audit = screen.getByTestId('coding-run-audit')
    expect(audit).toHaveTextContent(oldRun.id)
    expect(audit).toHaveTextContent('Old provider failure.')
    expect(audit).toHaveTextContent('permission-old · rejected')
    expect(audit).toHaveTextContent('Old terminal trace.')
    expect(audit).toHaveTextContent('100 · $0.01')
  })

  it('fails closed in Workbench when no Coding Engine is available and opens the shared configuration', async () => {
    const readiness = codingReadinessFixture({
      status: 'blocked',
      availability: 'unavailable',
      engine: 'unconfigured',
      executor: 'unconfigured',
      capabilities: [],
      providerRequirement: 'none',
      checks: [
        { code: 'executor_unconfigured', status: 'blocked', message: '请先选择 Coding Executor。' },
        { code: 'engine_unavailable', status: 'blocked', message: '当前没有可用的 Coding Engine。' },
      ],
    })
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(localStateAtCurrentNode('n-build')),
      getCodingRuntimeReadiness: vi.fn().mockResolvedValue(readiness),
    })
    render(<App />)

    const inspector = await screen.findByTestId('node-inspector')
    const codingAction = await within(inspector).findByRole('button', { name: '完成 Coding Runtime 配置' })
    expect(codingAction).toBeEnabled()
    expect(within(inspector).getByTestId('workbench-coding-readiness')).toHaveTextContent(
      '请先选择 Coding Executor。',
    )
    expect(api.runCodingAgent).not.toHaveBeenCalled()

    fireEvent.click(codingAction)
    expect(await screen.findByTestId('agent-workbench')).toBeInTheDocument()
    expect(screen.getByLabelText('Coding Executor')).toBeInTheDocument()
  })

  it('uses the same budget blocker in Workbench and Agents without exposing its machine code as status copy', async () => {
    const readiness = codingReadinessFixture({
      status: 'blocked',
      checks: [
        ...codingReadinessFixture().checks.slice(0, -1),
        {
          code: 'budget_blocked',
          status: 'blocked',
          message: '预算评估阻止本次运行，请取得一次性批准。',
        },
      ],
    })
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(localStateAtCurrentNode('n-build')),
      getCodingRuntimeReadiness: vi.fn().mockResolvedValue(readiness),
    })
    render(<App />)

    const inspector = await screen.findByTestId('node-inspector')
    await waitFor(() =>
      expect(within(inspector).getByRole('button', { name: '完成 Coding Runtime 配置' })).toBeEnabled(),
    )
    expect(within(inspector).getByTestId('workbench-coding-readiness')).toHaveTextContent(
      '预算评估阻止本次运行',
    )

    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))
    const workbench = await screen.findByTestId('agent-workbench')
    await waitFor(() => expect(workbench).toHaveTextContent('预算评估：阻止执行'))
    expect(workbench).toHaveTextContent('Team Project：已配对')
    expect(workbench).toHaveTextContent('测试命令：已配置')
    expect(workbench).toHaveTextContent('预算策略：已配置')
    expect(workbench).not.toHaveTextContent('budget_policy_missing：通过')
    expect(within(workbench).getByText('budget_blocked')).toBeInTheDocument()
  })

  it('detects OpenCode as a recommendation and saves it only after explicit project confirmation', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(localStateAtCurrentNode('n-build')),
      getCodingRuntimeReadiness: vi.fn().mockResolvedValue(codingReadinessFixture()),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))
    const executorPicker = await screen.findByLabelText('Coding Executor')
    await waitFor(() => expect(api.getCodingRuntimeConfiguration).toHaveBeenCalled())
    await waitFor(() => expect(executorPicker).toHaveValue('native-model'))
    fireEvent.change(executorPicker, {
      target: { value: 'opencode-http' },
    })
    fireEvent.click(screen.getByRole('button', { name: '检测本机 OpenCode' }))

    await waitFor(() => expect(api.detectCodingRuntimeEngines).toHaveBeenCalledWith({
      projectId: localProject.id,
    }))
    expect(api.saveCodingRuntimeConfiguration).not.toHaveBeenCalled()
    expect(screen.getByTestId('opencode-discovery-status')).toHaveTextContent('尚未确认用于当前项目')

    fireEvent.click(screen.getByRole('button', { name: '确认并用于当前项目' }))
    await waitFor(() => expect(api.saveCodingRuntimeConfiguration).toHaveBeenCalledWith({
      projectId: localProject.id,
      executor: 'opencode-http',
      providerId: 'openai',
      modelId: 'gpt-4.1-mini',
      binaryPath: '/opt/devflow/bin/opencode',
      detectedVersion: '1.2.3',
    }))
  })

  it('binds Native Coding to an explicitly selected locally saved Provider', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(localStateAtCurrentNode('n-build')),
      getCodingRuntimeReadiness: vi.fn().mockResolvedValue(codingReadinessFixture()),
    })
    render(<App />)

    await waitFor(() => expect(api.listAgentProviders).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))
    const provider = await screen.findByLabelText('Coding Agent Provider')
    await waitFor(() => expect(provider).toHaveValue(agentProvider.id))
    fireEvent.click(screen.getByRole('button', { name: '保存并用于当前项目' }))

    await waitFor(() => expect(api.saveCodingRuntimeConfiguration).toHaveBeenCalledWith({
      projectId: localProject.id,
      executor: 'native-model',
      providerId: agentProvider.id,
    }))
  })

  it('routes the current test node primary CTA to Tests', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(localStateAtCurrentNode('n-test')),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    const inspector = screen.getByTestId('node-inspector')
    expect(inspector).toHaveTextContent('执行本地测试')
    expect(inspector).not.toHaveTextContent('Gate Enforcement')
    expect(api.loadEnforcementPolicy).not.toHaveBeenCalled()
    expect(api.evaluateGateEnforcement).not.toHaveBeenCalled()
    fireEvent.click(within(inspector).getByRole('button', { name: /执行测试/ }))

    expect(screen.getByTestId('tests-view')).toHaveTextContent('来自 Workbench Inspector')
  })

  it('explains and disables PR draft generation until the local project is paired', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [fixtureRunAtCurrentNode('n-pr')],
        desktopPairingCredential: null,
      })),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    const inspector = screen.getByTestId('node-inspector')
    const action = within(inspector).getByRole('button', { name: /生成 PR Delivery Package/ })

    expect(action).toBeDisabled()
    expect(inspector).toHaveTextContent('先绑定当前 Local Project 与 Team Project')
    expect(api.createPrDraft).not.toHaveBeenCalled()
  })

  it('keeps PR draft generation disabled when the pairing belongs to another local project', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [fixtureRunAtCurrentNode('n-pr')],
        desktopPairingCredential: {
          ...fixturePairingCredential,
          localProjectId: 'local-project-other',
        },
      })),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    const inspector = screen.getByTestId('node-inspector')

    expect(within(inspector).getByRole('button', { name: /生成 PR Delivery Package/ })).toBeDisabled()
    expect(inspector).toHaveTextContent('先绑定当前 Local Project 与 Team Project')
    expect(api.createPrDraft).not.toHaveBeenCalled()
  })

  it('turns a stale PR binding IPC failure into an actionable re-pairing message', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(localStateAtCurrentNode('n-pr')),
      createPrDraft: vi.fn().mockRejectedValue(
        new Error(
          "Error invoking remote method 'devflow:pr-draft:create': Error: The workflow project is not bound to the paired Team project",
        ),
      ),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /生成 PR Delivery Package/ }))

    const toast = await screen.findByTestId('toast')
    expect(toast).toHaveTextContent('当前 Local Project 与 Team Project 的绑定已失效，请重新绑定后再生成 PR Delivery Package')
    expect(toast).not.toHaveTextContent('Error invoking remote method')
  })

  it('blocks the PR draft renderer action when its local project binding is missing', async () => {
    const api = installDesktopApi()
    render(<PrDraftActionHarness api={api} pairing={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Generate PR Draft directly' }))

    expect(api.createPrDraft).not.toHaveBeenCalled()
    expect(screen.getByTestId('pr-draft-action-toast')).toHaveTextContent(
      '请先将当前 Local Project 绑定到 Team Project，再生成 PR Delivery Package',
    )
  })

  it('routes the current PR node primary CTA to PR Delivery Package generation', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(localStateAtCurrentNode('n-pr')),
      loadRemoteSnapshot: vi.fn().mockResolvedValue({
        projects: [{
          id: fixtureRuns[0]!.projectId,
          name: 'Fixture Project',
          slug: 'fixture-project',
          description: 'Project used by this test.',
          repository: 'erich/fixture-project',
          defaultBranch: 'main',
          health: 'on_track',
          knowledgeBasePath: 'docs/',
          testCommand: 'pnpm test',
        }],
        members: [],
        runs: [],
        artifacts: [],
        events: [],
        projectCost: [],
        memberCost: [],
        totalCost: '$0.00',
      }),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /同步团队/ }))
    await waitFor(() => expect(api.loadRemoteSnapshot).toHaveBeenCalled())
    const inspector = screen.getByTestId('node-inspector')
    expect(inspector).toHaveTextContent('生成 PR Delivery Package')
    await act(async () => {
      fireEvent.click(within(inspector).getByRole('button', { name: /生成 PR Delivery Package/ }))
    })

    expect(screen.getByTestId('node-inspector')).toHaveTextContent('Prepare GitHub Delivery')
    fireEvent.click(within(screen.getByTestId('node-inspector')).getByRole('tab', { name: /Artifacts/ }))
    expect(await screen.findByText(/PR Draft:/)).toBeInTheDocument()
    expect(api.createPrDraft).toHaveBeenCalledWith({
      runId: fixtureRuns[0]!.id,
      nodeId: 'n-pr',
    })
  })

  it('keeps PR package creation separate from explicit GitHub Delivery preparation', async () => {
    const preparedIntent = githubDeliveryIntentFixture('approval_required')
    const initialState = prDeliveryState()
    const preparedState = prDeliveryState(preparedIntent)
    const loadState = vi.fn()
      .mockResolvedValueOnce(initialState)
      .mockResolvedValue(preparedState)
    const prepareGitHubDelivery = vi.fn().mockResolvedValue({
      status: 'prepared',
      replayed: false,
      intent: preparedIntent,
      testEvidence: {
        id: preparedIntent.testEvidenceId,
        runId: preparedIntent.runId,
        nodeId: 'n-build',
        projectId: preparedIntent.localProjectId,
        command: 'pnpm test',
        cwd: '[redacted-local-path]',
        status: 'passed',
        exitCode: 0,
        durationMs: 1234,
        stdout: 'tests passed',
        stderr: '',
        summary: 'Tests passed.',
        redacted: true,
        sourceCommitSha: preparedIntent.expectedCommitSha,
        createdAt: preparedIntent.testEvidenceCreatedAt,
      },
    })
    const api = installDesktopApi({
      loadState,
      prepareGitHubDelivery,
    } as Partial<DevFlowDesktopApi>)
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    const inspector = screen.getByTestId('node-inspector')
    expect(inspector).toHaveTextContent('Prepare GitHub Delivery')
    expect(within(inspector).queryByRole('button', { name: '生成 PR Delivery Package' })).not.toBeInTheDocument()

    const prepareButton = within(inspector).getByRole('button', { name: 'Prepare GitHub Delivery' })
    expect(prepareButton).not.toBeDisabled()
    fireEvent.click(prepareButton)

    await waitFor(() => expect(prepareGitHubDelivery).toHaveBeenCalledWith({
      runId: fixtureRuns[0]!.id,
      nodeId: 'n-pr',
    }))
    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('github-delivery-panel')).toHaveTextContent('approval_required')
    expect(screen.getByTestId('github-delivery-panel')).toHaveTextContent(preparedIntent.expectedCommitSha)
    expect(api.createPrDraft).not.toHaveBeenCalled()
  })

  it('revises approval-wait material once using only the visible intent CAS', async () => {
    const original = githubDeliveryIntentFixture('approval_required')
    const revised = {
      ...original,
      id: 'github-delivery-intent-revision-2',
      intentDigest: 'e'.repeat(64),
      updatedAt: '2026-08-11T12:04:00.000Z',
      createdAt: '2026-08-11T12:04:00.000Z',
    }
    const loadState = vi.fn()
      .mockResolvedValueOnce(prDeliveryState(original))
      .mockResolvedValue(prDeliveryState(revised))
    const reviseGitHubDelivery = vi.fn().mockResolvedValue({
      status: 'prepared',
      replayed: false,
      intent: revised,
      testEvidence: {},
    })
    installDesktopApi({ loadState, reviseGitHubDelivery } as Partial<DevFlowDesktopApi>)
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    const button = within(screen.getByTestId('node-inspector')).getByRole(
      'button',
      { name: 'Revise GitHub Delivery' },
    )
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(reviseGitHubDelivery).toHaveBeenCalledTimes(1))
    expect(reviseGitHubDelivery).toHaveBeenCalledWith({
      intentId: original.id,
      expectedUpdatedAt: original.updatedAt,
    })
    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(2))
  })

  it('revises approved pre-publication material once using only the visible intent CAS', async () => {
    const original = githubDeliveryIntentFixture('approved')
    const revised = {
      ...original,
      id: 'github-delivery-approved-revision-2',
      status: 'approval_required' as const,
      intentDigest: 'd'.repeat(64),
      updatedAt: '2026-08-11T12:04:00.000Z',
      createdAt: '2026-08-11T12:04:00.000Z',
    }
    const loadState = vi.fn()
      .mockResolvedValueOnce(prDeliveryState(original))
      .mockResolvedValue(prDeliveryState(revised))
    const reviseGitHubDelivery = vi.fn().mockResolvedValue({
      status: 'prepared',
      replayed: false,
      intent: revised,
      testEvidence: {},
    })
    installDesktopApi({ loadState, reviseGitHubDelivery } as Partial<DevFlowDesktopApi>)
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    const button = within(screen.getByTestId('node-inspector')).getByRole(
      'button',
      { name: 'Revise GitHub Delivery' },
    )
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(reviseGitHubDelivery).toHaveBeenCalledTimes(1))
    expect(reviseGitHubDelivery).toHaveBeenCalledWith({
      intentId: original.id,
      expectedUpdatedAt: original.updatedAt,
    })
    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(2))
  })

  it('retries a failed delivery once using only the visible terminal intent CAS', async () => {
    const failed = githubDeliveryIntentFixture('failed')
    const retry = {
      ...failed,
      id: 'github-delivery-intent-attempt-2',
      status: 'approval_required' as const,
      deliveryAttempt: 2,
      idempotencyKey: 'github-delivery:retry-attempt-2',
      intentDigest: 'f'.repeat(64),
      updatedAt: '2026-08-11T12:04:00.000Z',
      createdAt: '2026-08-11T12:04:00.000Z',
    }
    const loadState = vi.fn()
      .mockResolvedValueOnce(prDeliveryState(failed))
      .mockResolvedValue(prDeliveryState(retry))
    const retryGitHubDelivery = vi.fn().mockResolvedValue({
      status: 'prepared',
      replayed: false,
      intent: retry,
      testEvidence: {},
    })
    installDesktopApi({ loadState, retryGitHubDelivery } as Partial<DevFlowDesktopApi>)
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    const button = within(screen.getByTestId('node-inspector')).getByRole(
      'button',
      { name: 'Retry GitHub Delivery' },
    )
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(retryGitHubDelivery).toHaveBeenCalledTimes(1))
    expect(retryGitHubDelivery).toHaveBeenCalledWith({
      intentId: failed.id,
      expectedUpdatedAt: failed.updatedAt,
    })
    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(2))
  })

  it('resumes recovery exactly once with the visible intent updatedAt CAS', async () => {
    const recoveryIntent = githubDeliveryIntentFixture('recovery_required')
    const advancedIntent = {
      ...recoveryIntent,
      status: 'approved' as const,
      updatedAt: '2026-08-11T12:04:00.000Z',
    }
    const loadState = vi.fn()
      .mockResolvedValueOnce(prDeliveryState(recoveryIntent))
      .mockResolvedValue(prDeliveryState(advancedIntent))
    const resumeGitHubDelivery = vi.fn().mockResolvedValue({
      intentId: recoveryIntent.id,
      remoteRequestId: 'delivery-request-1',
      disposition: 'advanced',
      outcomeCode: null,
    })
    const api = installDesktopApi({
      loadState,
      resumeGitHubDelivery,
    } as Partial<DevFlowDesktopApi>)
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    const inspector = screen.getByTestId('node-inspector')
    const resumeButton = within(inspector).getByRole('button', { name: 'Resume GitHub Delivery' })
    expect(inspector).toHaveTextContent('recovery_required')

    fireEvent.click(resumeButton)
    fireEvent.click(resumeButton)

    await waitFor(() => expect(resumeGitHubDelivery).toHaveBeenCalledTimes(1))
    expect(resumeGitHubDelivery).toHaveBeenCalledWith({
      intentId: recoveryIntent.id,
      expectedUpdatedAt: recoveryIntent.updatedAt,
    })
    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('github-delivery-panel')).toHaveTextContent('approved')
    expect(api.prepareGitHubDelivery).not.toHaveBeenCalled()
  })

  it('stops an active delivery exactly once with the visible intent updatedAt CAS', async () => {
    const activeIntent = githubDeliveryIntentFixture('approved')
    const stoppedIntent = {
      ...activeIntent,
      status: 'recovery_required' as const,
      updatedAt: '2026-08-11T12:04:00.000Z',
    }
    const loadState = vi.fn()
      .mockResolvedValueOnce(prDeliveryState(activeIntent))
      .mockResolvedValue(prDeliveryState(stoppedIntent))
    const stopGitHubDelivery = vi.fn().mockResolvedValue({
      intentId: activeIntent.id,
      disposition: 'stopped',
      outcomeCode: 'operation_cancelled',
    })
    installDesktopApi({
      loadState,
      stopGitHubDelivery,
    } as Partial<DevFlowDesktopApi>)
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    const stopButton = within(screen.getByTestId('node-inspector')).getByRole(
      'button',
      { name: 'Stop GitHub Delivery' },
    )

    fireEvent.click(stopButton)
    fireEvent.click(stopButton)

    await waitFor(() => expect(stopGitHubDelivery).toHaveBeenCalledTimes(1))
    expect(stopGitHubDelivery).toHaveBeenCalledWith({
      intentId: activeIntent.id,
      expectedUpdatedAt: activeIntent.updatedAt,
    })
    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('github-delivery-panel')).toHaveTextContent('recovery_required')
  })

  it('restores the safe Stop outcome from local state after a cold restart', async () => {
    const recoveryIntent = githubDeliveryIntentFixture('recovery_required')
    const outcome: GitHubDeliveryOperatorOutcome = {
      stateVersion: 1,
      intentId: recoveryIntent.id,
      intentUpdatedAt: recoveryIntent.updatedAt,
      outcomeCode: 'operation_cancelled',
      recordedAt: recoveryIntent.updatedAt,
      redacted: true,
    }
    const loadState = vi.fn().mockResolvedValue(
      prDeliveryState(recoveryIntent, [outcome]),
    )
    installDesktopApi({ loadState } as Partial<DevFlowDesktopApi>)

    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    const panel = screen.getByTestId('github-delivery-panel')
    expect(panel).toHaveTextContent('operation_cancelled')
    expect(panel).not.toHaveTextContent(/token|\/Users\/|worktree|raw error/i)
  })

  it('does not render an unknown raw Stop outcome', async () => {
    const activeIntent = githubDeliveryIntentFixture('approved')
    const loadState = vi.fn().mockResolvedValue(prDeliveryState(activeIntent))
    const stopGitHubDelivery = vi.fn().mockResolvedValue({
      intentId: activeIntent.id,
      disposition: 'local_conflict',
      outcomeCode: 'API_TOKEN=private /Users/alice/repository',
    })
    installDesktopApi({ loadState, stopGitHubDelivery } as Partial<DevFlowDesktopApi>)
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Stop GitHub Delivery' }))

    await waitFor(() => expect(stopGitHubDelivery).toHaveBeenCalledTimes(1))
    const toast = screen.getByTestId('toast')
    expect(toast).toHaveTextContent('stop_outcome_unavailable')
    expect(toast).not.toHaveTextContent('/Users/')
    expect(toast).not.toHaveTextContent('API_TOKEN')
    expect(toast).not.toHaveTextContent('private')
  })

  it('reports a stale local Resume conflict as not accepted', async () => {
    const recoveryIntent = githubDeliveryIntentFixture('recovery_required')
    const loadState = vi.fn().mockResolvedValue(prDeliveryState(recoveryIntent))
    const resumeGitHubDelivery = vi.fn().mockResolvedValue({
      intentId: recoveryIntent.id,
      remoteRequestId: 'delivery-request-1',
      disposition: 'local_conflict',
      outcomeCode: null,
    })
    installDesktopApi({ loadState, resumeGitHubDelivery } as Partial<DevFlowDesktopApi>)
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Resume GitHub Delivery' }))

    await waitFor(() => expect(resumeGitHubDelivery).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(2))
    const toast = screen.getByTestId('toast')
    expect(toast).toHaveTextContent('本地状态已变化')
    expect(toast).toHaveTextContent('Resume 未被接受')
    expect(toast).not.toHaveTextContent('Resume 已接受')
  })

  it('shows a safe typed publisher outcome when Resume remains in recovery', async () => {
    const recoveryIntent = githubDeliveryIntentFixture('recovery_required')
    const loadState = vi.fn().mockResolvedValue(prDeliveryState(recoveryIntent))
    const resumeGitHubDelivery = vi.fn().mockResolvedValue({
      intentId: recoveryIntent.id,
      remoteRequestId: 'delivery-request-1',
      disposition: 'recovery_required',
      outcomeCode: 'workspace_dirty',
    })
    installDesktopApi({ loadState, resumeGitHubDelivery } as Partial<DevFlowDesktopApi>)
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Resume GitHub Delivery' }))

    await waitFor(() => expect(resumeGitHubDelivery).toHaveBeenCalledTimes(1))
    const toast = screen.getByTestId('toast')
    expect(toast).toHaveTextContent('workspace_dirty')
    expect(toast).toHaveTextContent('managed workspace')
    expect(toast).not.toHaveTextContent('/Users/')
    expect(toast).not.toHaveTextContent('API_TOKEN')
  })

  it('does not render an unknown raw publisher outcome', async () => {
    const recoveryIntent = githubDeliveryIntentFixture('recovery_required')
    const loadState = vi.fn().mockResolvedValue(prDeliveryState(recoveryIntent))
    const resumeGitHubDelivery = vi.fn().mockResolvedValue({
      intentId: recoveryIntent.id,
      remoteRequestId: 'delivery-request-1',
      disposition: 'recovery_required',
      outcomeCode: 'API_TOKEN=private /Users/alice/repository',
    })
    installDesktopApi({ loadState, resumeGitHubDelivery } as Partial<DevFlowDesktopApi>)
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Resume GitHub Delivery' }))

    await waitFor(() => expect(resumeGitHubDelivery).toHaveBeenCalledTimes(1))
    const toast = screen.getByTestId('toast')
    expect(toast).toHaveTextContent('publisher_outcome_unavailable')
    expect(toast).not.toHaveTextContent('/Users/')
    expect(toast).not.toHaveTextContent('API_TOKEN')
    expect(toast).not.toHaveTextContent('private')
  })

  it('refreshes after an ambiguous Resume failure without exposing raw token or worktree details', async () => {
    const recoveryIntent = githubDeliveryIntentFixture('recovery_required')
    const loadState = vi.fn().mockResolvedValue(prDeliveryState(recoveryIntent))
    const resumeGitHubDelivery = vi.fn().mockRejectedValue(
      new Error('ghs_secret_token failed in /Users/erich/.devflow/worktrees/run-1'),
    )
    installDesktopApi({ loadState, resumeGitHubDelivery } as Partial<DevFlowDesktopApi>)
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Resume GitHub Delivery' }))

    await waitFor(() => expect(resumeGitHubDelivery).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(2))
    const toast = screen.getByTestId('toast')
    expect(toast).toHaveTextContent('不会自动重试')
    expect(toast).not.toHaveTextContent('ghs_secret_token')
    expect(toast).not.toHaveTextContent('/Users/erich')
  })

  it('shows the safe Draft PR completion and leaves workflow advancement to the processor', async () => {
    const completedIntent = githubDeliveryIntentFixture('completed', {
      completion: {
        stateVersion: 1,
        remoteRequestId: 'delivery-request-1',
        publicationId: 'publication-1',
        pullRequestOutcomeId: 'pull-request-outcome-1',
        pullRequestId: '123456',
        pullRequestNumber: 17,
        pullRequestUrl: 'https://github.com/erich/ai-devflow-studio/pull/17',
        providerCreatedAt: '2026-08-11T12:03:00.000Z',
        recordedAt: '2026-08-11T12:03:01.000Z',
        draft: true,
        redacted: true,
      },
    })
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(prDeliveryState(completedIntent)),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    const inspector = screen.getByTestId('node-inspector')
    expect(inspector).toHaveTextContent('Draft PR 已创建')
    expect(within(inspector).getByRole('link', { name: 'Open Draft PR #17' })).toHaveAttribute(
      'href',
      completedIntent.completion?.pullRequestUrl,
    )
    expect(within(inspector).queryByRole('button', { name: 'Prepare GitHub Delivery' })).not.toBeInTheDocument()
    expect(within(inspector).queryByRole('button', { name: 'Resume GitHub Delivery' })).not.toBeInTheDocument()
  })

  it('verifies completed delivery revocation once with exact local CAS and reloads persisted proof', async () => {
    const completedIntent = githubDeliveryIntentFixture('completed', {
      repositoryBindingVersion: 3,
    })
    const check: GitHubDeliveryRevocationCheck = {
      stateVersion: 2,
      intentId: completedIntent.id,
      intentUpdatedAt: completedIntent.updatedAt,
      bindingId: completedIntent.repositoryBindingId,
      bindingVersion: 4,
      outcomeCode: 'binding_inactive',
      checkedAt: '2026-08-11T12:10:00.000Z',
      redacted: true,
    }
    const loadState = vi.fn()
      .mockResolvedValueOnce(prDeliveryState(
        completedIntent,
        [],
        [],
        [githubRepositoryBindingFixture(completedIntent, 'revoked')],
      ))
      .mockResolvedValue(prDeliveryState(
        completedIntent,
        [],
        [check],
        [githubRepositoryBindingFixture(completedIntent, 'revoked')],
      ))
    const verifyGitHubDeliveryRevocation = vi.fn().mockResolvedValue({
      intentId: completedIntent.id,
      disposition: 'blocked',
      outcomeCode: 'binding_inactive',
    })
    installDesktopApi({
      loadState,
      verifyGitHubDeliveryRevocation,
    } as Partial<DevFlowDesktopApi>)
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    const verifyButton = within(screen.getByTestId('node-inspector')).getByRole(
      'button',
      { name: 'Verify credential revocation' },
    )

    fireEvent.click(verifyButton)
    fireEvent.click(verifyButton)

    await waitFor(() => expect(verifyGitHubDeliveryRevocation).toHaveBeenCalledTimes(1))
    expect(verifyGitHubDeliveryRevocation).toHaveBeenCalledWith({
      intentId: completedIntent.id,
      expectedUpdatedAt: completedIntent.updatedAt,
    })
    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('toast')).toHaveTextContent(
      'Credential revocation 已验证：binding_inactive',
    )
    const panel = screen.getByTestId('github-delivery-panel')
    expect(panel).toHaveTextContent('Credential revocation proof')
    expect(panel).toHaveTextContent(check.checkedAt)
  })

  it.each([
    ['missing', []],
    ['active', ['active']],
  ] as const)(
    'hides credential revocation verification when the exact binding is %s',
    async (_label, statuses) => {
      const completedIntent = githubDeliveryIntentFixture('completed')
      const repositoryBindings = statuses.map((status) =>
        githubRepositoryBindingFixture(completedIntent, status),
      )
      const api = installDesktopApi({
        loadState: vi.fn().mockResolvedValue(
          prDeliveryState(completedIntent, [], [], repositoryBindings),
        ),
      })
      render(<App />)

      await waitFor(() => expect(api.loadState).toHaveBeenCalled())
      expect(
        within(screen.getByTestId('node-inspector')).queryByRole('button', {
          name: 'Verify credential revocation',
        }),
      ).not.toBeInTheDocument()
    },
  )

  it('shows fixed retry copy while credential revocation remains quarantined', async () => {
    const completedIntent = githubDeliveryIntentFixture('completed')
    const state = prDeliveryState(
      completedIntent,
      [],
      [],
      [githubRepositoryBindingFixture(completedIntent, 'revoked')],
    )
    const loadState = vi.fn().mockResolvedValue(state)
    const verifyGitHubDeliveryRevocation = vi.fn().mockResolvedValue({
      intentId: completedIntent.id,
      disposition: 'unverified',
      outcomeCode: 'credential_revocation_pending',
    })
    installDesktopApi({
      loadState,
      verifyGitHubDeliveryRevocation,
    } as Partial<DevFlowDesktopApi>)
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', {
      name: 'Verify credential revocation',
    }))

    await waitFor(() => expect(verifyGitHubDeliveryRevocation).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('toast')).toHaveTextContent(
      'Credential revocation 仍在安全隔离，请稍后重试',
    )
  })

  it('hides credential revocation verification for a same-version revoked observation', async () => {
    const completedIntent = githubDeliveryIntentFixture('completed')
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(prDeliveryState(
        completedIntent,
        [],
        [],
        [githubRepositoryBindingFixture(completedIntent, 'revoked', {
          version: completedIntent.repositoryBindingVersion,
        })],
      )),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    expect(screen.queryByRole('button', {
      name: 'Verify credential revocation',
    })).not.toBeInTheDocument()
  })

  it('hides credential revocation verification when revoked authority is ambiguous', async () => {
    const completedIntent = githubDeliveryIntentFixture('completed')
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(prDeliveryState(
        completedIntent,
        [],
        [],
        [
          githubRepositoryBindingFixture(completedIntent, 'revoked'),
          githubRepositoryBindingFixture(completedIntent, 'revoked', {
            version: completedIntent.repositoryBindingVersion + 2,
            updatedAt: '2026-08-11T12:10:00.000Z',
          }),
        ],
      )),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    expect(screen.queryByRole('button', {
      name: 'Verify credential revocation',
    })).not.toBeInTheDocument()
  })

  it('hides credential revocation verification when a newer active authority conflicts with revoked history', async () => {
    const completedIntent = githubDeliveryIntentFixture('completed')
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(prDeliveryState(
        completedIntent,
        [],
        [],
        [
          githubRepositoryBindingFixture(completedIntent, 'revoked'),
          githubRepositoryBindingFixture(completedIntent, 'active', {
            version: completedIntent.repositoryBindingVersion + 2,
            updatedAt: '2026-08-11T12:10:00.000Z',
          }),
        ],
      )),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    expect(screen.queryByRole('button', {
      name: 'Verify credential revocation',
    })).not.toBeInTheDocument()
  })

  it('hides credential revocation verification for a newer revoked binding from another repository scope', async () => {
    const completedIntent = githubDeliveryIntentFixture('completed')
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(prDeliveryState(
        completedIntent,
        [],
        [],
        [githubRepositoryBindingFixture(completedIntent, 'revoked', {
          repositoryId: 'different-repository-id',
          repository: 'erich/different-repository',
        })],
      )),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    expect(screen.queryByRole('button', {
      name: 'Verify credential revocation',
    })).not.toBeInTheDocument()
  })

  it('does not display a check for an older revoked authority version', async () => {
    const completedIntent = githubDeliveryIntentFixture('completed')
    const revokedBinding = githubRepositoryBindingFixture(completedIntent, 'revoked', {
      version: completedIntent.repositoryBindingVersion + 2,
    })
    const staleCheck: GitHubDeliveryRevocationCheck = {
      stateVersion: 2,
      intentId: completedIntent.id,
      intentUpdatedAt: completedIntent.updatedAt,
      bindingId: completedIntent.repositoryBindingId,
      bindingVersion: completedIntent.repositoryBindingVersion + 1,
      outcomeCode: 'binding_inactive',
      checkedAt: '2026-08-11T12:10:00.000Z',
      redacted: true,
    }
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(prDeliveryState(
        completedIntent,
        [],
        [staleCheck],
        [revokedBinding],
      )),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    expect(screen.getByRole('button', {
      name: 'Verify credential revocation',
    })).toBeInTheDocument()
    expect(screen.getByTestId('github-delivery-panel')).not.toHaveTextContent(
      'Credential revocation proof',
    )
  })

  it.each([
    [
      'stale',
      {
        intentId: 'github-delivery-intent-1',
        disposition: 'unverified',
        outcomeCode: 'stale_intent',
      },
    ],
    [
      'unexpected',
      {
        intentId: 'different-intent',
        disposition: 'blocked',
        outcomeCode: 'binding_inactive',
      },
    ],
  ] as const)(
    'fails closed with fixed safe copy for a %s revocation result',
    async (_label, result) => {
      const completedIntent = githubDeliveryIntentFixture('completed')
      const state = prDeliveryState(
        completedIntent,
        [],
        [],
        [githubRepositoryBindingFixture(completedIntent, 'revoked')],
      )
      const loadState = vi.fn().mockResolvedValue(state)
      const verifyGitHubDeliveryRevocation = vi.fn().mockResolvedValue(result)
      installDesktopApi({
        loadState,
        verifyGitHubDeliveryRevocation,
      } as Partial<DevFlowDesktopApi>)
      render(<App />)

      await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
      fireEvent.click(screen.getByRole('button', {
        name: 'Verify credential revocation',
      }))

      await waitFor(() => expect(verifyGitHubDeliveryRevocation).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(loadState).toHaveBeenCalledTimes(2))
      const toast = screen.getByTestId('toast')
      expect(toast).toHaveTextContent(
        'Credential revocation 未验证；授权阻断证明不可用',
      )
      expect(toast).not.toHaveTextContent('stale_intent')
      expect(toast).not.toHaveTextContent('API_TOKEN')
      expect(toast).not.toHaveTextContent('/Users/')
      expect(toast).not.toHaveTextContent('private')
    },
  )

  it('fails closed and refreshes after a raw revocation probe failure', async () => {
    const completedIntent = githubDeliveryIntentFixture('completed')
    const state = prDeliveryState(
      completedIntent,
      [],
      [],
      [githubRepositoryBindingFixture(completedIntent, 'revoked')],
    )
    const loadState = vi.fn().mockResolvedValue(state)
    const verifyGitHubDeliveryRevocation = vi.fn().mockRejectedValue(
      new Error('ghs_secret_token failed in /Users/alice/repository'),
    )
    installDesktopApi({
      loadState,
      verifyGitHubDeliveryRevocation,
    } as Partial<DevFlowDesktopApi>)
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', {
      name: 'Verify credential revocation',
    }))

    await waitFor(() => expect(verifyGitHubDeliveryRevocation).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(2))
    const toast = screen.getByTestId('toast')
    expect(toast).toHaveTextContent(
      'Credential revocation 未验证；授权阻断证明不可用',
    )
    expect(toast).not.toHaveTextContent('ghs_secret_token')
    expect(toast).not.toHaveTextContent('/Users/')
  })

  it('carries the completed PR delivery evidence into Acceptance for the same Run', async () => {
    const prPackage = prDeliveryPackageFixture()
    const pullRequestUrl = 'https://github.com/erich/ai-devflow-studio/pull/17'
    const completedIntent = githubDeliveryIntentFixture('completed', {
      completion: {
        stateVersion: 1,
        remoteRequestId: 'delivery-request-1',
        publicationId: 'publication-1',
        pullRequestOutcomeId: 'pull-request-outcome-1',
        pullRequestId: '123456',
        pullRequestNumber: 17,
        pullRequestUrl,
        providerCreatedAt: '2026-08-11T12:03:00.000Z',
        recordedAt: '2026-08-11T12:03:01.000Z',
        draft: true,
        redacted: true,
      },
    })
    const acceptanceRun = fixtureRunAtCurrentNode('n-accept')
    const acceptanceRunWithDelivery = {
      ...acceptanceRun,
      pullRequestUrl,
      nodes: acceptanceRun.nodes.map((node) => (
        node.id === 'n-pr'
          ? { ...node, artifactIds: [...new Set([...node.artifactIds, prPackage.id])] }
          : node
      )),
    }
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [acceptanceRunWithDelivery],
        artifacts: [prPackage],
        githubDeliveryIntents: [completedIntent],
        githubRepositoryBindings: [
          githubRepositoryBindingFixture(completedIntent, 'revoked'),
        ],
        desktopPairingCredential: fixturePairingCredential,
      })),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    const inspector = screen.getByTestId('node-inspector')
    const panel = within(inspector).getByTestId('github-delivery-panel')
    expect(inspector).toHaveTextContent('业务验收')
    expect(panel).toHaveTextContent('completed')
    expect(panel).toHaveTextContent(completedIntent.expectedCommitSha)
    expect(panel).not.toHaveTextContent('package_required')
    expect(within(panel).getByRole('link', { name: 'Open Draft PR #17' })).toHaveAttribute(
      'href',
      completedIntent.completion?.pullRequestUrl,
    )
    expect(within(inspector).getByRole('button', {
      name: 'Verify credential revocation',
    })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('flow-node-n-build'))
    })
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('本地实现')
    expect(screen.queryByTestId('github-delivery-panel')).not.toBeInTheDocument()
  })

  it('fails closed in Acceptance when the recorded Draft URL has ambiguous delivery evidence', async () => {
    const prPackage = prDeliveryPackageFixture()
    const pullRequestUrl = 'https://github.com/erich/ai-devflow-studio/pull/17'
    const canonicalIntent = githubDeliveryIntentFixture('completed', {
      completion: {
        stateVersion: 1,
        remoteRequestId: 'delivery-request-1',
        publicationId: 'publication-1',
        pullRequestOutcomeId: 'pull-request-outcome-1',
        pullRequestId: '123456',
        pullRequestNumber: 17,
        pullRequestUrl,
        providerCreatedAt: '2026-08-11T12:03:00.000Z',
        recordedAt: '2026-08-11T12:03:01.000Z',
        draft: true,
        redacted: true,
      },
    })
    const conflictingIntent = {
      ...canonicalIntent,
      id: 'github-delivery-intent-conflict',
      expectedCommitSha: '3'.repeat(40),
      intentDigest: 'e'.repeat(64),
    }
    const acceptanceRun = fixtureRunAtCurrentNode('n-accept')
    const acceptanceRunWithDelivery = {
      ...acceptanceRun,
      pullRequestUrl,
      nodes: acceptanceRun.nodes.map((node) => (
        node.id === 'n-pr'
          ? { ...node, artifactIds: [...new Set([...node.artifactIds, prPackage.id])] }
          : node
      )),
    }
    installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [acceptanceRunWithDelivery],
        artifacts: [prPackage],
        githubDeliveryIntents: [canonicalIntent, conflictingIntent],
        desktopPairingCredential: fixturePairingCredential,
      })),
    })
    render(<App />)

    const panel = await screen.findByTestId('github-delivery-panel')
    expect(panel).toHaveTextContent('evidence_unavailable')
    expect(panel).toHaveTextContent('无法唯一确认')
    expect(panel).not.toHaveTextContent('package_required')
    expect(panel).not.toHaveTextContent(canonicalIntent.expectedCommitSha)
    expect(panel).not.toHaveTextContent(conflictingIntent.expectedCommitSha)
    expect(within(panel).queryByRole('link')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('node-inspector')).queryByRole('button', {
      name: 'Prepare GitHub Delivery',
    })).not.toBeInTheDocument()
    expect(within(screen.getByTestId('node-inspector')).queryByRole('button', {
      name: 'Resume GitHub Delivery',
    })).not.toBeInTheDocument()
  })

  it('does not generate a PR draft for a future workflow node', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('flow-node-n-pr'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /生成 PR Delivery Package/ }))
    })

    expect(api.createPrDraft).not.toHaveBeenCalled()
    expect(screen.getByTestId('toast')).toHaveTextContent('当前 PR 节点')
  })

  it('routes the current acceptance node primary CTA to acceptance bundle generation', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(localStateAtCurrentNode('n-accept')),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    await waitFor(() =>
      expect(api.evaluateGateEnforcement).toHaveBeenCalledWith({
        runId: fixtureRuns[0]!.id,
        nodeId: 'n-accept',
        projectId: fixtureRuns[0]!.projectId,
      }),
    )
    const inspector = screen.getByTestId('node-inspector')
    expect(inspector).toHaveTextContent('生成验收证据包')
    await act(async () => {
      fireEvent.click(within(inspector).getByRole('button', { name: /生成验收证据包/ }))
    })

    fireEvent.click(within(screen.getByTestId('node-inspector')).getByRole('tab', { name: /Artifacts/ }))
    expect(await screen.findByText(/Acceptance Bundle:/)).toBeInTheDocument()
    expect(api.createAcceptanceBundle).toHaveBeenCalledWith({
      runId: fixtureRuns[0]!.id,
      nodeId: 'n-accept',
    })
  })

  it('does not generate an acceptance bundle for a future workflow node', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('flow-node-n-accept'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /生成验收证据包/ }))
    })

    expect(api.createAcceptanceBundle).not.toHaveBeenCalled()
    expect(screen.getByTestId('toast')).toHaveTextContent('当前验收节点')
  })

  it('does not bypass current-node delivery guards when actions run before a rerender', async () => {
    const api = installDesktopApi()
    render(<DeliveryActionHarness api={api} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate delivery artifacts in one tick/ }))
    })

    expect(api.createPrDraft).toHaveBeenCalledWith({
      runId: fixtureRuns[0]!.id,
      nodeId: 'n-pr',
    })
    expect(api.createAcceptanceBundle).not.toHaveBeenCalled()
  })

  it('does not approve gates or append events in the browser preview', async () => {
    vi.useFakeTimers()
    try {
      render(<GateApprovalFallbackHarness />)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Approve twice/ }))
      })

      expect(screen.getByTestId('event-sequences')).toHaveTextContent('7')
      expect(screen.getByTestId('gate-browser-toast')).toHaveTextContent(
        '浏览器预览不执行工作流推进，请在 Electron 应用中继续',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not generate PR drafts in the browser preview', async () => {
    render(<BrowserDeliveryBoundaryHarness nodeId="n-pr" action="pr" />)

    fireEvent.click(screen.getByRole('button', { name: 'Attempt browser delivery' }))

    expect(screen.getByTestId('browser-delivery-toast')).toHaveTextContent(
      '浏览器预览不执行工作流推进，请在 Electron 应用中继续',
    )
    expect(screen.getByTestId('browser-delivery-state')).toHaveTextContent(
      `n-pr|${fixtureArtifacts.length}|${fixtureEvents.length}`,
    )
  })

  it('does not generate acceptance bundles in the browser preview', async () => {
    render(<BrowserDeliveryBoundaryHarness nodeId="n-accept" action="acceptance" />)

    fireEvent.click(screen.getByRole('button', { name: 'Attempt browser delivery' }))

    expect(screen.getByTestId('browser-delivery-toast')).toHaveTextContent(
      '浏览器预览不执行工作流推进，请在 Electron 应用中继续',
    )
    expect(screen.getByTestId('browser-delivery-state')).toHaveTextContent(
      `n-accept|${fixtureArtifacts.length}|${fixtureEvents.length}`,
    )
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

  it('separates workflow node type, source, display mode, and Inspector semantics', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    const board = await screen.findByTestId('workflow-canvas')
    expect(board).toHaveTextContent('Run 模板')
    expect(board).toHaveTextContent('Team Policy')
    expect(board).toHaveTextContent('本地 Runtime')
    expect(board).toHaveTextContent('系统派生')
    expect(board).toHaveTextContent('折叠输出')
    expect(board).toHaveTextContent('Test')
    expect(board).toHaveTextContent('Delivery')
    expect(board).toHaveTextContent('Acceptance')
    expect(screen.getByTestId('stage-summary-clarify')).toHaveTextContent('节点：Task 1 · Gate 1')
    expect(screen.getByTestId('stage-summary-clarify')).toHaveTextContent('来源：Run 模板 1 · Team Policy 1')
    expect(screen.getByTestId('stage-summary-clarify')).not.toHaveTextContent('展示：')
    expect(screen.getByTestId('stage-summary-pr')).toHaveTextContent('节点：Delivery 1')
    expect(screen.getByTestId('stage-summary-pr')).toHaveTextContent('来源：系统派生 1')
    expect(screen.getByTestId('stage-summary-pr')).toHaveTextContent('展示：折叠输出 1')
    const designCard = within(board).getByTestId('flow-node-n-design')
    expect(designCard).toHaveTextContent('Task')
    expect(designCard).not.toHaveTextContent('Review')
    expect(board).toHaveTextContent('产物')
    expect(board).toHaveTextContent('证据')
    expect(board).toHaveTextContent('轨迹')
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
    expect(inspector).toHaveTextContent('类型：Gate · 来源：Team Policy')
    expect(screen.getByTestId('inspector-status-matrix')).toHaveTextContent('Policy snapshot')
    expect(screen.getByTestId('inspector-status-matrix')).toHaveTextContent('门禁审查')
    expect(inspector).toHaveTextContent('Next best action')
    expect(inspector).toHaveTextContent('通过 Gate')
  })

  it('derives a Task Gate impact from workflow edges and navigates to the Gate read-only', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [fixtureRuns[0]!],
        artifacts: fixtureArtifacts,
        events: fixtureEvents,
        desktopPairingCredential: fixturePairingCredential,
      })),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('flow-node-n-clarify'))
    const inspector = clickInspectorTab('Gate影响')
    const impact = within(inspector).getByTestId('gate-impact-summary')

    expect(impact).toHaveTextContent('直接下游 Gate')
    expect(impact).toHaveTextContent('需求确认 Gate')
    expect(impact).toHaveTextContent('已完成')
    expect(impact).toHaveTextContent('需求澄清结果')
    expect(impact).toHaveTextContent('此处只展示前向影响')
    expect(within(impact).queryByRole('button', { name: /通过 Gate|Override/ })).not.toBeInTheDocument()

    fireEvent.click(within(impact).getByRole('button', { name: '查看 Gate' }))
    await waitFor(() => expect(screen.getByTestId('node-inspector')).toHaveTextContent('需求确认 Gate'))
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('类型：Gate · 来源：Team Policy')
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

  it('loads remote team state without mixing other project runs into the selected local project', async () => {
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
            totalTokens: 150,
            costUsd: 0.25,
            unknownCostCount: 1,
          },
        ],
        memberCost: [
          {
            key: 'u-remote-lead',
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 25,
            totalTokens: 150,
            costUsd: 0.25,
            unknownCostCount: 1,
          },
        ],
        totalCost: '$0.250 + unknown',
      }),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /同步团队/ }))

    await waitFor(() => expect(api.loadRemoteSnapshot).toHaveBeenCalledWith({ organizationId: 'org-demo' }))
    expect(screen.getAllByText('为 Payments API 增加 /health 端点').length).toBeGreaterThan(0)
    expect(screen.queryByText('远端同步 Run')).not.toBeInTheDocument()
    expect(screen.getByText(/Run Sources/)).toHaveTextContent('1 local · 0 remote')
    expect(screen.getByTestId('runtime-source-badge')).toHaveTextContent('remote snapshot + local merge')
    expect(screen.getByTestId('runtime-source-badge')).toHaveTextContent('real IPC/API')
    expect(screen.getAllByText('local').length).toBeGreaterThan(0)
    expect(screen.getByTestId('toast')).toHaveTextContent('团队远端状态已同步')

    fireEvent.click(screen.getByRole('button', { name: /Team Overview/ }))
    expect(screen.getAllByText('Remote Team API').length).toBeGreaterThan(0)
    expect(screen.getByText('erich/remote-team-api')).toBeInTheDocument()
    expect(screen.getAllByText(/\$0\.250.*unknown/).length).toBeGreaterThan(0)
    expect(screen.getByText('Remote Lead')).toBeInTheDocument()
    expect(screen.queryByText('erich/payments-api')).not.toBeInTheDocument()
  })

  it('keeps the complete local workflow when sync returns a lossy run with the same id', async () => {
    const api = installDesktopApi({
      loadRemoteSnapshot: vi.fn().mockResolvedValue({
        projects: [],
        members: [],
        runs: [{
          ...fixtureRuns[0]!,
          title: 'Lossy remote summary',
          request: 'Synced from DevFlow Electron.',
          status: 'completed',
          currentNodeId: 'remote-node',
          nodes: [],
          edges: [],
        }],
        artifacts: [],
        events: [],
        projectCost: [],
        memberCost: [],
        totalCost: '$0.00',
      }),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /同步团队/ }))

    await waitFor(() => expect(api.loadRemoteSnapshot).toHaveBeenCalled())
    expect(screen.getByTestId('flow-node-n-design-gate')).toBeInTheDocument()
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('方案评审 Gate')
    expect(screen.getByText(/Run Sources/)).toHaveTextContent('1 local · 0 remote')
  })

  it('does not sync remote team state until the desktop is paired', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [fixtureRuns[0]!],
      })),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /同步团队/ }))

    expect(api.loadRemoteSnapshot).not.toHaveBeenCalled()
    expect(screen.getByTestId('toast')).toHaveTextContent('请先 Pair Team Project 后再同步团队远端状态')
  })

  it('keeps the Gate status tab as a readiness overview and moves details into the matching tabs', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())

    const inspector = await screen.findByTestId('node-inspector')
    expect(inspector).toHaveTextContent('方案评审 Gate')
    const readinessSummary = within(inspector).getByTestId('gate-readiness-summary')
    await waitFor(() => expect(readinessSummary).toHaveTextContent('可以通过'))
    expect(readinessSummary).toHaveTextContent('已通过')
    expect(readinessSummary).toHaveTextContent('警告')
    expect(readinessSummary).toHaveTextContent('缺失')
    expect(readinessSummary).toHaveTextContent('阻断')
    expect(within(inspector).getByTestId('readiness-group-conclusion')).not.toHaveAttribute('open')
    expect(inspector).toHaveTextContent('Required Artifact')
    expect(inspector).not.toHaveTextContent('Lead 审批方案后进入实现')
    expect(inspector).not.toHaveTextContent('Gate Enforcement')

    clickInspectorTab(/Gate条件/)
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('Gate Enforcement')

    clickInspectorTab(/Evidence/)
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('Evidence · 可审计结果')
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('当前节点尚未产生可审计 Evidence')
    expect(screen.getByTestId('node-inspector')).not.toHaveTextContent('Gate Enforcement · 详细结论')

    clickInspectorTab(/Remediation/)
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('Remediation · 恢复计划')
    expect(screen.getByTestId('node-inspector')).not.toHaveTextContent('Gate Enforcement · 详细结论')
  })

  it('keeps Knowledge sources separate from auditable Review and Test Evidence', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(reviewedDesignGateState()),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    const inspector = await screen.findByTestId('node-inspector')
    expect(inspector).toHaveTextContent('方案评审 Gate')

    clickInspectorTab(/引用来源/)
    const sources = within(inspector).getByTestId('knowledge-reference-sources')
    expect(sources).toHaveTextContent('docs/standards/api-design.md')
    expect(sources).toHaveTextContent('document document-api-design-standard')
    expect(sources).toHaveTextContent('chunk chunk-api-design-standard-contract')
    expect(sources).toHaveTextContent('API design / Status mapping')
    expect(sources).toHaveTextContent('knowledge-hash-design-1')
    expect(sources).toHaveTextContent('关键词匹配分 7（原始累加）')
    expect(sources).toHaveTextContent('未进行语义相关性判断')
    expect(sources).toHaveTextContent('Gate 使用状态：已审查引用')
    expect(sources).not.toHaveTextContent('Review Subject')
    expect(sources).not.toHaveTextContent('Baseline tests passed before implementation.')

    clickInspectorTab(/^Evidence$/)
    const evidence = within(inspector).getByTestId('review-evidence-results')
    expect(evidence).toHaveTextContent('方案设计')
    expect(evidence).toHaveTextContent('Review Subject')
    expect(evidence).toHaveTextContent('artifact-digest-design-1')
    expect(evidence).toHaveTextContent('The complete design Artifact satisfies the API contract criteria.')
    expect(evidence).toHaveTextContent('Baseline tests passed before implementation.')
    expect(evidence).not.toHaveTextContent('docs/standards/api-design.md')
    expect(evidence).not.toHaveTextContent('关键词匹配分')

    clickInspectorTab(/引用来源/)
    fireEvent.click(within(inspector).getByRole('button', { name: /查看引用来源/ }))
    expect(await screen.findByTestId('knowledge-view')).toHaveTextContent('来自 Workbench Inspector')
    fireEvent.click(screen.getByRole('button', { name: /返回当前 Inspector/ }))
    expect(await screen.findByTestId('node-inspector')).toHaveTextContent('方案评审 Gate')
    expect(screen.getByTestId('knowledge-reference-sources')).toBeInTheDocument()
  })

  it('does not surface Gate Review or empty Evidence on a design generation Agent', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [fixtureRuns[0]!],
        artifacts: fixtureArtifacts,
        desktopPairingCredential: fixturePairingCredential,
      })),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('flow-node-n-design'))
    const inspector = screen.getByTestId('node-inspector')
    expect(inspector).toHaveTextContent('方案设计')
    expect(within(inspector).queryByRole('tab', { name: /引用来源|Evidence/ })).not.toBeInTheDocument()
    expect(within(inspector).queryByRole('button', { name: /运行门禁审查/ })).not.toBeInTheDocument()
    expect(inspector).not.toHaveTextContent('当前阶段缺少 Policy 要求的 Test Evidence')
  })

  it('pairs the desktop client with a team project through the desktop API', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Desktop pairing code'), {
      target: { value: 'pair-p-payments.copy-once-secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: '绑定' }))

    await waitFor(() =>
      expect(api.pairDesktop).toHaveBeenCalledWith({
        code: 'pair-p-payments.copy-once-secret',
        localProjectId: localProject.id,
      }),
    )
    expect(screen.getByTestId('desktop-pairing-identity')).toHaveTextContent(
      'Ling · lead · Payments API',
    )
    expect(screen.getByTestId('toast')).toHaveTextContent(
      '已绑定 Ling / lead 到 Payments API',
    )
  })

  it('fails closed and prompts re-pairing when the persisted Desktop token has expired', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue({
        ...persistedFixtureRunState(),
        desktopPairingCredential: {
          ...fixturePairingCredential,
          expiresAt: '2000-01-01T00:00:00.000Z',
        },
      }),
    })
    render(<App />)
    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    expect(await screen.findByTestId('desktop-pairing-identity')).toHaveTextContent(
      '配对已过期 · 请重新绑定',
    )
    vi.mocked(api.loadRemoteSnapshot).mockClear()
    fireEvent.click(screen.getByRole('button', { name: '同步团队' }))
    expect(api.loadRemoteSnapshot).not.toHaveBeenCalled()
    expect(screen.getByTestId('toast')).toHaveTextContent(
      '请先 Pair Team Project 后再同步团队远端状态',
    )
  })

  it('persists gate approval through the desktop write-path guard', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    const inspector = screen.getByTestId('node-inspector')
    expect(inspector).toHaveTextContent('Next best action')
    expect(within(inspector).getByRole('button', { name: /通过 Gate/ })).toBeEnabled()
    fireEvent.click(within(inspector).getByRole('button', { name: /通过 Gate/ }))

    await waitFor(() => expect(api.approveGate).toHaveBeenCalledWith({
      runId: fixtureRuns[0]!.id,
      nodeId: 'n-design-gate',
    }))
    expect(api).not.toHaveProperty('uploadRunSummary')
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('approval')
  })

  it('keeps remote Run synchronization behind the trusted main-process approval path', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /通过 Gate/ }))

    await waitFor(() => expect(api.approveGate).toHaveBeenCalled())
    expect(window.aiDevFlowDesktop).not.toHaveProperty('uploadRunSummary')
    expect(screen.getByTestId('toast')).toHaveTextContent('方案评审 Gate 已通过')
  })

  it('shows blocking enforcement details and keeps non-approval actions available', async () => {
    const recommended = createRecommendedEnforcementPreset({
      organizationId: 'org-demo',
      updatedAt: '2026-06-18T00:00:00.000Z',
    })
    const effectivePolicy = resolveEffectivePolicy(recommended, null)
    const overrideEligibleRun = {
      ...fixtureRuns[0]!,
      nodes: fixtureRuns[0]!.nodes.map((node) =>
        node.id === 'n-design-gate' ? { ...node, ownerId: 'u-yu' } : node,
      ),
    }
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [overrideEligibleRun],
        desktopPairingCredential: fixturePairingCredential,
      })),
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
            summary: '此受保护 Gate 尚未运行基于知识的门禁审查。',
            remediation: '在审批此受保护 Gate 前运行基于知识的门禁审查。',
          },
        ],
        warningReasons: [],
        requiredActions: ['在审批此受保护 Gate 前运行基于知识的门禁审查。'],
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

    const inspector = clickInspectorTab(/Gate条件/)
    expect(inspector).toHaveTextContent('Gate Enforcement')
    expect(screen.getByTestId('gate-enforcement-summary')).toHaveTextContent('存在 1 项阻断')
    expect(screen.getByTestId('gate-enforcement-summary')).toHaveTextContent('阻断审批')
    expect(screen.getByTestId('gate-enforcement-summary')).toHaveTextContent('尚未运行门禁审查')
    expect(screen.getAllByTestId('enforcement-finding')).toHaveLength(1)
    expect(screen.getByTestId('gate-technical-details')).not.toHaveAttribute('open')
    expect(inspector).toHaveTextContent('团队远端缓存')
    expect(inspector).toHaveTextContent('policy v1')
    expect(inspector).toHaveTextContent('此受保护 Gate 尚未运行基于知识的门禁审查。')
    expect(inspector).toHaveTextContent('在审批此受保护 Gate 前运行基于知识的门禁审查。')
    expect(screen.getByRole('button', { name: '运行门禁审查' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /通过 Gate/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /执行测试/ })).not.toBeInTheDocument()

    clickInspectorTab(/Remediation/)
    expect(screen.getByTestId('remediation-actions')).toHaveTextContent('运行门禁审查')
    expect(screen.queryAllByTestId('enforcement-finding')).toHaveLength(0)
    clickInspectorTab(/Gate条件/)

    fireEvent.change(screen.getByLabelText('Lead override reason'), {
      target: { value: 'Reviewed the canonical blocking evidence.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save lead override' }))
    await waitFor(() =>
      expect(api.saveGateOverride).toHaveBeenCalledWith({
        runId: fixtureRuns[0]!.id,
        nodeId: 'n-design-gate',
        reason: 'Reviewed the canonical blocking evidence.',
      }),
    )
  })

  it('explains unavailable team policy without hiding the local agent completion action', async () => {
    installDesktopApi({
      loadState: vi.fn().mockResolvedValue(persistedFixtureRunState()),
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
        organizationPolicy: createWarnOnlyDefaultPolicy({ organizationId: 'org-demo' }),
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
    await waitFor(() => expect(within(inspector).getByTestId('gate-readiness-summary')).toHaveTextContent('不能通过'))
    clickInspectorTab(/Gate条件/)
    expect(screen.getByTestId('gate-enforcement-summary')).toHaveTextContent('团队策略不可用')
    expect(screen.getByTestId('gate-enforcement-summary')).toHaveTextContent('同步团队策略后重新评估 Gate')
    clickInspectorTab(/Remediation/)
    expect(screen.getByRole('button', { name: '同步团队策略' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /通过 Gate/ })).not.toBeInTheDocument()
  })

  it('shows provisional overrides distinctly from confirmed overrides', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(persistedFixtureRunState()),
      evaluateGateEnforcement: vi.fn().mockResolvedValue({
        status: 'overridden',
        blocksApproval: false,
        blockingReasons: [
          {
            id: 'missing_agent_review:protected_gate:missing',
            target: 'missing_agent_review',
            ruleKey: 'missing_agent_review:protected_gate:missing',
            action: 'block',
            summary: '此受保护 Gate 尚未运行基于知识的门禁审查。',
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

    const inspector = clickInspectorTab(/Gate条件/)
    expect(inspector).toHaveTextContent('阻断已由 Lead 例外放行')
    expect(inspector).toHaveTextContent('可继续审批')
    expect(inspector).toHaveTextContent('Provisional override')
    expect(inspector).toHaveTextContent('Offline lead override pending server confirmation.')
    expect(screen.getByRole('button', { name: '运行门禁审查' })).toBeEnabled()
  })

  it('shows rejected provisional overrides as blocked and actionable', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(persistedFixtureRunState()),
      evaluateGateEnforcement: vi.fn().mockResolvedValue({
        status: 'blocked',
        blocksApproval: true,
        blockingReasons: [
          {
            id: 'missing_agent_review:protected_gate:missing',
            target: 'missing_agent_review',
            ruleKey: 'missing_agent_review:protected_gate:missing',
            action: 'block',
            summary: '此受保护 Gate 尚未运行基于知识的门禁审查。',
            remediation: '在审批此受保护 Gate 前运行基于知识的门禁审查。',
          },
        ],
        warningReasons: [],
        requiredActions: ['在审批此受保护 Gate 前运行基于知识的门禁审查。'],
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

    const inspector = clickInspectorTab(/Gate条件/)
    expect(inspector).toHaveTextContent('Rejected override')
    expect(inspector).toHaveTextContent('Rejected by team policy because version 1 is stale.')
    expect(inspector).toHaveTextContent('在审批此受保护 Gate 前运行基于知识的门禁审查。')
    expect(screen.getByRole('button', { name: '运行门禁审查' })).toBeEnabled()
  })

  it('persists theme and MCP local preferences through the desktop API', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [fixtureRuns[0]!],
        mcpServers: fixtureMcpServers,
        desktopPairingCredential: fixturePairingCredential,
      })),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
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
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
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

  it('shows an indexed but empty repository knowledge snapshot', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    clickInspectorTab(/Gate条件/)
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('Knowledge Governance')
    expect(screen.getByTestId('node-inspector')).not.toHaveTextContent('API Health Endpoint Standard')

    fireEvent.click(screen.getByRole('button', { name: /Knowledge/ }))

    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('Knowledge Governance')
    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('Git Markdown Index')
    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('indexed')
    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('Run references')
    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('没有匹配的知识文档')
    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('没有匹配的知识节点')
  })

  it('does not show inspector knowledge-reference actions before repository indexing', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    clickInspectorTab(/Gate条件/)
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('Knowledge Governance')
    expect(screen.queryByRole('button', { name: /查看引用来源/ })).not.toBeInTheDocument()
  })

  it('opens Tests from the test-node inspector and preserves the return target', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(localStateAtCurrentNode('n-test')),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /执行测试/ }))

    expect(screen.getByTestId('tests-view')).toHaveTextContent('来自 Workbench Inspector')
    expect(screen.getByTestId('tests-view')).toHaveTextContent('执行本地测试并生成 Test Evidence')

    fireEvent.click(screen.getByRole('button', { name: /返回当前 Inspector/ }))
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('开发自测')
  })

  it('does not return bundled knowledge search results before repository indexing', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Search runs and knowledge'), {
      target: { value: 'API Health Endpoint Standard' },
    })

    expect(screen.getByTestId('search-results')).toHaveTextContent('没有匹配结果')
  })

  it('loads repository knowledge by project id and drives search, references, governance, and graph', async () => {
    const snapshot = repositoryKnowledgeSnapshot(localProject.id, {
      truncated: true,
      warnings: ['file_count_limit_exceeded'],
    })
    const api = installDesktopApi({
      loadRepositoryKnowledge: vi.fn().mockResolvedValue(snapshot),
    })
    render(<App />)

    await waitFor(() =>
      expect(api.loadRepositoryKnowledge).toHaveBeenCalledWith({ projectId: localProject.id }),
    )
    expect(api.loadRepositoryKnowledge).toHaveBeenCalledTimes(1)

    clickInspectorTab(/Gate条件/)
    await waitFor(() =>
      expect(screen.getByTestId('node-inspector')).toHaveTextContent('API Health Endpoint Standard'),
    )

    fireEvent.change(screen.getByLabelText('Search runs and knowledge'), {
      target: { value: 'API Health Endpoint Standard' },
    })
    expect(screen.getByTestId('search-results')).toHaveTextContent('API Health Endpoint Standard')

    fireEvent.click(screen.getByRole('button', { name: /^Knowledge$/ }))
    const knowledgeView = screen.getByTestId('knowledge-view')
    expect(knowledgeView).toHaveTextContent('indexed · truncated')
    expect(knowledgeView).toHaveTextContent('file_count_limit_exceeded')
    expect(knowledgeView).toHaveTextContent('API Health Endpoint Standard')
    expect(knowledgeView).toHaveTextContent('defines')
    expect(knowledgeView).toHaveTextContent('2026-08-01T00:00:00.000Z')
    expect(screen.getAllByTestId('knowledge-run-reference')).not.toHaveLength(0)
    for (const reference of screen.getAllByTestId('knowledge-run-reference')) {
      expect(reference).toHaveTextContent('docs/knowledge/standards/api-health.md')
    }
  })

  it('bounds a large repository knowledge graph in the renderer', async () => {
    const snapshot = repositoryKnowledgeSnapshot(localProject.id, {
      entities: Array.from({ length: 20 }, (_, index) => ({
        id: `knowledge-entity-${index}`,
        label: `Knowledge entity ${index}`,
        kind: 'term' as const,
        sourcePath: `docs/entity-${index}.md`,
      })),
      relations: [],
    })
    installDesktopApi({
      loadRepositoryKnowledge: vi.fn().mockResolvedValue(snapshot),
    })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /^Knowledge$/ }))
    await waitFor(() => expect(screen.getAllByTestId('knowledge-graph-node')).toHaveLength(12))
    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('图谱较大')
  })

  it('refreshes repository knowledge and re-evaluates Gate enforcement when the content hash changes', async () => {
    const initial = repositoryKnowledgeSnapshot(localProject.id)
    const refreshedIndex = indexKnowledgeSources([fixtureKnowledgeSources[1]!])
    const refreshed = repositoryKnowledgeSnapshot(localProject.id, {
      contentHash: 'repository-hash-2',
      documents: refreshedIndex.documents,
      chunks: refreshedIndex.chunks,
      entities: refreshedIndex.entities,
      relations: refreshedIndex.relations,
      indexedAt: '2026-08-01T00:05:00.000Z',
    })
    const api = installDesktopApi({
      loadRepositoryKnowledge: vi.fn().mockResolvedValue(initial),
      refreshRepositoryKnowledge: vi.fn().mockResolvedValue(refreshed),
    })
    render(<App />)

    await waitFor(() => expect(api.loadRepositoryKnowledge).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.evaluateGateEnforcement).toHaveBeenCalled())
    const gateEvaluationsBeforeRefresh = vi.mocked(api.evaluateGateEnforcement).mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: /^Knowledge$/ }))
    fireEvent.click(screen.getByRole('button', { name: /刷新仓库知识/ }))

    await waitFor(() =>
      expect(api.refreshRepositoryKnowledge).toHaveBeenCalledWith({ projectId: localProject.id }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('knowledge-view')).toHaveTextContent('Local Test Evidence Standard'),
    )
    await waitFor(() =>
      expect(vi.mocked(api.evaluateGateEnforcement).mock.calls.length).toBeGreaterThan(
        gateEvaluationsBeforeRefresh,
      ),
    )
  })

  it('keeps the last successful repository index when refresh fails without exposing raw paths', async () => {
    const initial = repositoryKnowledgeSnapshot(localProject.id)
    const api = installDesktopApi({
      loadRepositoryKnowledge: vi.fn().mockResolvedValue(initial),
      refreshRepositoryKnowledge: vi.fn().mockRejectedValue(
        new Error('EACCES /Users/example/private-repository/secret.md'),
      ),
    })
    render(<App />)

    await waitFor(() => expect(api.loadRepositoryKnowledge).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /^Knowledge$/ }))
    await waitFor(() =>
      expect(screen.getByTestId('knowledge-view')).toHaveTextContent('API Health Endpoint Standard'),
    )
    fireEvent.click(screen.getByRole('button', { name: /刷新仓库知识/ }))

    await waitFor(() =>
      expect(screen.getByTestId('knowledge-data-source')).toHaveTextContent('indexed · refresh failed'),
    )
    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('API Health Endpoint Standard')
    expect(screen.getByTestId('knowledge-view')).not.toHaveTextContent('/Users/example')
    expect(screen.getByTestId('knowledge-view')).not.toHaveTextContent('secret.md')
  })

  it('keeps delayed repository knowledge responses isolated after switching projects', async () => {
    const secondProject = {
      ...localProject,
      id: 'local-project-2',
      name: 'second-project',
      path: '/tmp/second-project',
    }
    let resolveFirst: ((snapshot: RepositoryKnowledgeSnapshot) => void) | undefined
    const firstLoad = new Promise<RepositoryKnowledgeSnapshot>((resolve) => {
      resolveFirst = resolve
    })
    let resolveSecond: ((snapshot: RepositoryKnowledgeSnapshot) => void) | undefined
    const secondLoad = new Promise<RepositoryKnowledgeSnapshot>((resolve) => {
      resolveSecond = resolve
    })
    const secondIndex = indexKnowledgeSources([fixtureKnowledgeSources[1]!])
    const secondSnapshot = repositoryKnowledgeSnapshot(secondProject.id, {
      contentHash: 'repository-hash-second',
      documents: secondIndex.documents,
      chunks: secondIndex.chunks,
      entities: secondIndex.entities,
      relations: secondIndex.relations,
    })
    const api = installDesktopApi({
      selectLocalProject: vi.fn().mockResolvedValue(secondProject),
      loadRepositoryKnowledge: vi.fn().mockImplementation(({ projectId }) =>
        projectId === localProject.id ? firstLoad : secondLoad,
      ),
    })
    render(<App />)

    await waitFor(() =>
      expect(api.loadRepositoryKnowledge).toHaveBeenCalledWith({ projectId: localProject.id }),
    )
    fireEvent.click(screen.getByRole('button', { name: /选择本地仓库/ }))
    await waitFor(() =>
      expect(api.loadRepositoryKnowledge).toHaveBeenCalledWith({ projectId: secondProject.id }),
    )

    fireEvent.click(screen.getByRole('button', { name: /^Knowledge$/ }))
    await act(async () => {
      resolveFirst?.(repositoryKnowledgeSnapshot(localProject.id))
    })
    await waitFor(() => {
      const secondProjectCalls = vi.mocked(api.loadRepositoryKnowledge).mock.calls.filter(
        ([input]) => input.projectId === secondProject.id,
      )
      expect(secondProjectCalls).toHaveLength(1)
    })
    await act(async () => {
      resolveSecond?.(secondSnapshot)
    })
    await waitFor(() =>
      expect(screen.getByTestId('knowledge-view')).toHaveTextContent('Local Test Evidence Standard'),
    )
    expect(screen.getByTestId('knowledge-view')).toHaveTextContent('Local Test Evidence Standard')
    expect(screen.getByTestId('knowledge-view')).not.toHaveTextContent('API Health Endpoint Standard')
  })

  it('deep-links Artifact and Event search results back into the inspector', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [fixtureRuns[0]!],
        artifacts: fixtureArtifacts,
        events: fixtureEvents,
        desktopPairingCredential: fixturePairingCredential,
      })),
    })
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
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

  it('opens Agents from the inspector, runs Gate Review, and returns to the current inspector', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.listAgentProviders).toHaveBeenCalled())
    const readinessBeforeReview = screen.getByTestId('gate-readiness-summary')
    await waitFor(() => expect(readinessBeforeReview).toHaveTextContent('缺失'))
    fireEvent.click(screen.getByRole('button', { name: /运行门禁审查/ }))

    expect(await screen.findByTestId('agent-workbench')).toHaveTextContent('来自 Workbench Inspector')
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('运行门禁审查并补齐 Gate Advisory')
    expect(api.runKnowledgeReview).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /运行门禁审查/ }))

    await waitFor(() => expect(api.runKnowledgeReview).toHaveBeenCalledWith(expect.objectContaining({
      runId: fixtureRuns[0]!.id,
      nodeId: fixtureRuns[0]!.currentNodeId,
      runtime: 'electron',
      providerId: agentProvider.id,
    })))
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('基于知识的门禁审查')
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('warning-only')
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('Build redacted context')
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('estimated')

    fireEvent.click(screen.getByRole('button', { name: /返回当前 Inspector/ }))
    const inspector = await screen.findByTestId('node-inspector')
    await waitFor(() => expect(within(inspector).getByTestId('readiness-group-review-evidence')).toHaveTextContent('success'))
    expect(within(inspector).queryByRole('button', { name: /运行门禁审查/ })).not.toBeInTheDocument()
    clickInspectorTab(/Gate条件/)
    expect(screen.getByTestId('knowledge-governance-flow')).toHaveTextContent('2 · 完成审查已完成')
    clickInspectorTab(/Evidence/)
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('Evidence · 可审计结果')
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('Knowledge review completed for the selected gate.')
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('warning-only')
    expect(screen.getByTestId('node-inspector')).not.toHaveTextContent(agentProvider.id)
  })

  it('runs the required Gate Review from final acceptance enforcement', async () => {
    const recommended = createRecommendedEnforcementPreset({
      organizationId: 'org-demo',
      updatedAt: '2026-06-18T00:00:00.000Z',
    })
    const effectivePolicy = resolveEffectivePolicy(recommended, null)
    const acceptanceRun = fixtureRunAtCurrentNode('n-accept')
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [acceptanceRun],
        desktopPairingCredential: fixturePairingCredential,
      })),
      loadEnforcementPolicy: vi.fn().mockResolvedValue({
        projectId: acceptanceRun.projectId,
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
        blockingReasons: [{
          id: 'missing_agent_review:protected_gate:missing',
          target: 'missing_agent_review',
          ruleKey: 'missing_agent_review:protected_gate:missing',
          action: 'block',
          summary: '最终验收尚未运行基于知识的门禁审查。',
          remediation: '为最终验收运行基于知识的门禁审查。',
        }],
        warningReasons: [],
        requiredActions: ['为最终验收运行基于知识的门禁审查。'],
        canOverride: false,
        overrideRoleRequired: 'lead',
        policySource: 'remote_cache',
        policyVersion: 1,
        provisional: false,
      }),
    })

    render(<App />)

    await waitFor(() => expect(api.evaluateGateEnforcement).toHaveBeenCalledWith({
      runId: acceptanceRun.id,
      nodeId: 'n-accept',
      projectId: acceptanceRun.projectId,
    }))
    const inspector = screen.getByTestId('node-inspector')
    fireEvent.click(within(inspector).getByRole('button', { name: /运行门禁审查/ }))

    const agentWorkbench = await screen.findByTestId('agent-workbench')
    expect(agentWorkbench).toHaveTextContent('业务验收')
    const runReview = within(agentWorkbench).getByRole('button', { name: /运行门禁审查/ })
    expect(runReview).toBeEnabled()
    fireEvent.click(runReview)

    await waitFor(() => expect(api.runKnowledgeReview).toHaveBeenCalledWith(expect.objectContaining({
      runId: acceptanceRun.id,
      nodeId: 'n-accept',
      projectId: acceptanceRun.projectId,
      requestedBy: fixturePairingCredential.userId,
      runtime: 'electron',
      providerId: agentProvider.id,
    })))
  })

  it('saves a custom Agent Provider credential for Doubao-compatible model calls', async () => {
    const liveProvider = {
      id: 'provider_123e4567e89b12d3a456426614174000',
      name: '公司火山方舟',
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
      providerId: 'provider_123e4567e89b12d3a456426614174000',
      name: '公司火山方舟',
      model: 'ark-code-latest',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      maskedCredential: 'e8...test',
      updatedAt: '2026-06-15T00:03:00.000Z',
    })
    const api = installDesktopApi({ listAgentProviders, saveAgentProviderCredential })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))

    expect(await screen.findByText('Add Agent Provider')).toBeInTheDocument()
    expect(screen.getByLabelText('Saved Agent Provider')).toBeInTheDocument()
    expect(screen.getByTestId('review-provider-mode')).toHaveTextContent(
      '已保存 Provider 配置 实时 OpenAI 兼容服务 · 可能消耗模型 Token',
    )
    expect(screen.queryByLabelText('Agent Provider ID')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Agent Provider Name'), {
      target: { value: '公司火山方舟' },
    })
    fireEvent.change(screen.getByLabelText('Agent Provider Base URL'), {
      target: { value: 'https://ark.cn-beijing.volces.com/api/coding/v3' },
    })
    fireEvent.change(screen.getByLabelText('Agent Provider Model'), {
      target: { value: 'ark-code-latest' },
    })

    fireEvent.change(screen.getByLabelText('Agent Provider API Key'), {
      target: { value: 'e8fa6ce2-test-key' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Save and Use Provider/ }))

    await waitFor(() =>
      expect(saveAgentProviderCredential).toHaveBeenCalledWith({
        name: '公司火山方舟',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
        model: 'ark-code-latest',
        apiKey: 'e8fa6ce2-test-key',
      }),
    )
    await waitFor(() => expect(api.listAgentProviders).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('review-provider-mode')).toHaveTextContent(
      '已保存 Provider 配置 实时 OpenAI 兼容服务 · 可能消耗模型 Token',
    )
    expect(screen.getByText('已保存并选择 Provider：公司火山方舟 · e8...test')).toBeInTheDocument()
  })

  it('requires an API key before saving an Agent Provider credential', async () => {
    const api = installDesktopApi()
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))
    await screen.findByText('Add Agent Provider')
    fireEvent.click(screen.getByRole('button', { name: /Save and Use Provider/ }))

    expect(api.saveAgentProviderCredential).not.toHaveBeenCalled()
    expect(screen.getByText('请输入 API Key')).toBeInTheDocument()
  })

  it('requires a Provider Name and never asks the user for an internal provider ID', async () => {
    const api = installDesktopApi()
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))
    await screen.findByText('Add Agent Provider')
    expect(screen.getByLabelText('Agent Provider Name')).toBeInTheDocument()
    expect(screen.queryByLabelText('Agent Provider ID')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Agent Provider API Key'), {
      target: { value: 'sk-test-secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Save and Use Provider/ }))

    expect(api.saveAgentProviderCredential).not.toHaveBeenCalled()
    expect(screen.getByText('Provider name is required.')).toBeInTheDocument()
  })

  it('applies main-process local state pushes to the current project sync status', async () => {
    let localStateListener:
      | Parameters<DevFlowDesktopApi['onLocalStateUpdated']>[0]
      | undefined
    const onLocalStateUpdated = vi.fn(
      (listener: Parameters<DevFlowDesktopApi['onLocalStateUpdated']>[0]) => {
        localStateListener = listener
        return vi.fn()
      },
    )
    installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: fixtureRuns,
      })),
      onLocalStateUpdated,
    })
    render(<App />)

    await waitFor(() => expect(onLocalStateUpdated).toHaveBeenCalledTimes(1))
    act(() => {
      localStateListener?.(desktopState({
        projects: [localProject],
        runs: fixtureRuns,
        remoteSyncOperations: [
          remoteSyncOperation(),
          remoteSyncOperation({
            id: 'remote-sync-operation-2',
            kind: 'test-evidence-summary',
            status: 'sending',
          }),
          remoteSyncOperation({
            id: 'remote-sync-operation-3',
            kind: 'agent-review-summary',
            status: 'retry-scheduled',
            attemptCount: 2,
          }),
        ],
      }))
    })

    const syncStatus = await screen.findByTestId('remote-sync-operations')
    expect(syncStatus).toHaveTextContent('run-summary')
    expect(syncStatus).toHaveTextContent('queued')
    expect(syncStatus).toHaveTextContent('sending')
    expect(syncStatus).toHaveTextContent('retry_wait')
  })

  it('preserves the selected Run when an outbox state push arrives', async () => {
    let localStateListener:
      | Parameters<DevFlowDesktopApi['onLocalStateUpdated']>[0]
      | undefined
    const secondRun = {
      ...fixtureRuns[0]!,
      id: 'run-selected-during-sync',
      title: 'Selected during sync',
      branchName: 'codex/selected-during-sync',
    }
    installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: [fixtureRuns[0]!, secondRun],
      })),
      onLocalStateUpdated: vi.fn((listener) => {
        localStateListener = listener
        return vi.fn()
      }),
    })
    render(<App />)

    const selectedRunButton = await screen.findByTitle('Selected during sync')
    fireEvent.click(selectedRunButton)
    expect(selectedRunButton.closest('.run-row')).toHaveClass('is-selected')

    act(() => {
      localStateListener?.(desktopState({
        projects: [localProject],
        runs: [fixtureRuns[0]!, secondRun],
        remoteSyncOperations: [remoteSyncOperation()],
      }))
    })

    expect(selectedRunButton.closest('.run-row')).toHaveClass('is-selected')
  })

  it('shows terminal sync metadata without exposing raw remote errors', async () => {
    installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: fixtureRuns,
        remoteSyncOperations: [remoteSyncOperation({
          status: 'terminal',
          attemptCount: 4,
          lastErrorCode: 'immutable_conflict',
          lastErrorMessage:
            'Bearer secret-token failed at https://api.internal/private with raw body',
          nextAttemptAt: '2026-08-02T12:30:00.000Z',
        })],
      })),
    })
    render(<App />)

    const syncStatus = await screen.findByTestId('remote-sync-operations')
    expect(syncStatus).toHaveTextContent('run-summary')
    expect(syncStatus).toHaveTextContent('terminal')
    expect(syncStatus).toHaveTextContent('attempt 4')
    expect(syncStatus).toHaveTextContent('immutable_conflict')
    expect(syncStatus).toHaveTextContent('2026-08-02T12:30:00.000Z')
    expect(syncStatus).not.toHaveTextContent(/secret-token|api\.internal|private|raw body/i)
    expect(screen.getByRole('button', { name: '重试 run-summary 同步' })).toBeEnabled()
  })

  it('retries terminal sync with only the operation ID and applies the returned state', async () => {
    const operation = remoteSyncOperation({
      status: 'terminal',
      attemptCount: 4,
      lastErrorCode: 'immutable_conflict',
      nextAttemptAt: null,
    })
    const retryRemoteSyncOperation = vi.fn().mockResolvedValue(desktopState({
      projects: [localProject],
      runs: fixtureRuns,
      remoteSyncOperations: [remoteSyncOperation({
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: '2026-08-02T13:00:00.000Z',
      })],
    }))
    installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: fixtureRuns,
        remoteSyncOperations: [operation],
      })),
      retryRemoteSyncOperation,
    })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '重试 run-summary 同步' }))

    await waitFor(() =>
      expect(retryRemoteSyncOperation).toHaveBeenCalledWith({
        operationId: 'remote-sync-operation-1',
      }),
    )
    expect(retryRemoteSyncOperation).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.getByTestId('remote-sync-operations')).toHaveTextContent('queued'),
    )
    expect(screen.getByTestId('remote-sync-operations')).not.toHaveTextContent('terminal')
    expect(screen.getByTestId('toast')).toHaveTextContent('远端同步操作已重新排队')
  })

  it('shows a fixed safe toast when a terminal sync retry fails', async () => {
    const retryRemoteSyncOperation = vi.fn().mockRejectedValue(
      new Error('Bearer secret-token failed at https://api.internal/private with raw body'),
    )
    installDesktopApi({
      loadState: vi.fn().mockResolvedValue(desktopState({
        projects: [localProject],
        runs: fixtureRuns,
        remoteSyncOperations: [remoteSyncOperation({
          status: 'terminal',
          attemptCount: 4,
          lastErrorCode: 'immutable_conflict',
          nextAttemptAt: null,
        })],
      })),
      retryRemoteSyncOperation,
    })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '重试 run-summary 同步' }))

    await waitFor(() =>
      expect(screen.getByTestId('toast')).toHaveTextContent('远端同步重试失败，请稍后再试'),
    )
    const toast = screen.getByTestId('toast')
    expect(toast).not.toHaveTextContent(/secret-token|api\.internal|private|raw body/i)
    expect(screen.getByTestId('remote-sync-operations')).toHaveTextContent('terminal')
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
    fireEvent.click(screen.getByTestId('flow-node-n-build'))
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))

    expect(await screen.findByTestId('agent-workbench')).toHaveTextContent('Waiting for pushed permission.')
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('Apply pushed diff')
    expect(screen.getByTestId('agent-workbench')).toHaveTextContent('Pushed permission event.')
  })

  it('reloads the trusted workflow state when a coding run completes', async () => {
    const handlers: {
      run?: Parameters<NonNullable<DevFlowDesktopApi['onCodingRunStatusUpdated']>>[0]
    } = {}
    const onCodingRunStatusUpdated = vi.fn((listener: NonNullable<typeof handlers.run>) => {
      handlers.run = listener
      return vi.fn()
    })
    const buildRun = fixtureRunAtCurrentNode('n-build')
    const testRun = fixtureRunAtCurrentNode('n-test')
    const completedCodingRun = {
      id: 'coding-run-completed',
      runId: buildRun.id,
      nodeId: 'n-build',
      projectId: localProject.id,
      requestedBy: 'u-ling',
      providerId: 'fake-coding-engine',
      engine: 'fake' as const,
      status: 'completed' as const,
      managedWorkspaceId: 'workspace-completed',
      branchName: 'devflow/run-completed',
      userInstruction: 'Complete the build.',
      prompt: 'local prompt',
      summary: 'Build implementation completed.',
      changedPaths: ['src/completed.ts'],
      startedAt: '2026-06-17T00:00:00.000Z',
      completedAt: '2026-06-17T00:01:00.000Z',
      redacted: true,
    }
    const loadState = vi
      .fn()
      .mockResolvedValueOnce(desktopState({
        projects: [localProject],
        runs: [buildRun],
      }))
      .mockResolvedValueOnce(desktopState({
        projects: [localProject],
        runs: [testRun],
        codingRuns: [completedCodingRun],
      }))
    installDesktopApi({
      loadState,
      onCodingRunStatusUpdated,
    })
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    act(() => {
      handlers.run?.(completedCodingRun)
    })

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.getByTestId('flow-node-n-test')).toHaveTextContent('当前步骤'),
    )
    expect(screen.getByTestId('flow-node-n-build')).toHaveTextContent('已完成')
  })

  it('reloads the trusted workflow state when a coding run times out', async () => {
    const handlers: {
      run?: Parameters<NonNullable<DevFlowDesktopApi['onCodingRunStatusUpdated']>>[0]
    } = {}
    const onCodingRunStatusUpdated = vi.fn((listener: NonNullable<typeof handlers.run>) => {
      handlers.run = listener
      return vi.fn()
    })
    const buildRun = fixtureRunAtCurrentNode('n-build')
    const timedOutCodingRun = {
      id: 'coding-run-timed-out', runId: buildRun.id, nodeId: 'n-build', projectId: localProject.id,
      requestedBy: 'u-ling', providerId: 'fake-coding-engine', engine: 'fake' as const,
      status: 'timed_out' as const, managedWorkspaceId: 'workspace-timed-out', branchName: 'devflow/timed-out',
      userInstruction: 'Complete the build.', prompt: 'local prompt', summary: 'Provider deadline exceeded.',
      changedPaths: [], startedAt: '2026-06-17T00:00:00.000Z', completedAt: '2026-06-17T00:01:00.000Z',
      redacted: true,
    }
    const loadState = vi
      .fn()
      .mockResolvedValueOnce(desktopState({ projects: [localProject], runs: [buildRun] }))
      .mockResolvedValueOnce(desktopState({
        projects: [localProject],
        runs: [buildRun],
        codingRuns: [timedOutCodingRun],
      }))
    installDesktopApi({ loadState, onCodingRunStatusUpdated })
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    act(() => handlers.run?.(timedOutCodingRun))
    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(2))
  })

  it('reloads managed workspace cleanup state after a cleanup event', async () => {
    const handlers: {
      event?: Parameters<NonNullable<DevFlowDesktopApi['onCodingEventAppended']>>[0]
    } = {}
    const onCodingEventAppended = vi.fn((listener: NonNullable<typeof handlers.event>) => {
      handlers.event = listener
      return vi.fn()
    })
    const buildRun = fixtureRunAtCurrentNode('n-build')
    const loadState = vi.fn().mockResolvedValue(desktopState({ projects: [localProject], runs: [buildRun] }))
    installDesktopApi({ loadState, onCodingEventAppended })
    render(<App />)

    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1))
    act(() => handlers.event?.({
      id: 'coding-cleanup-event', codingRunId: 'coding-run-cleanup', runId: buildRun.id, nodeId: 'n-build',
      sequence: 5, kind: 'cleanup', message: 'Managed coding workspace cleanup completed.',
      timestamp: '2026-06-17T00:02:00.000Z', metadata: { cleanupStatus: 'deleted' }, redacted: true,
    }))
    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(2))
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

    fireEvent.click(await screen.findByTestId('flow-node-n-build'))
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))

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
    const api = installDesktopApi({
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
    const retry = screen.getByRole('button', { name: '使用预算批准重新运行' })
    expect(retry).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Runtime budget approval ID'), {
      target: { value: 'runtime-budget-approval-1' },
    })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    const confirmation = screen.getByRole('alertdialog')
    expect(confirmation).toHaveTextContent('runtime-budget-approval-1')
    expect(confirmation).toHaveTextContent('新的 token 与费用单独结算')
    expect(api.runCodingAgent).not.toHaveBeenCalled()
    fireEvent.click(within(confirmation).getByRole('button', { name: '新建 Run 并重试' }))
    await waitFor(() => expect(api.runCodingAgent).toHaveBeenCalledTimes(1))
  })

  it('presents an unavailable runtime budget guard as a blocking recovery state without an approval retry', async () => {
    installDesktopApi({
      loadState: vi.fn().mockResolvedValue({
        ...localStateAtCurrentNode('n-build'),
        codingRuns: [
          {
            id: 'coding-run-budget-unavailable',
            runId: fixtureRuns[0]!.id,
            nodeId: 'n-build',
            projectId: localProject.id,
            requestedBy: 'u-ling',
            providerId: 'doubao-review',
            engine: 'opencode-http',
            status: 'failed',
            branchName: 'devflow/budget-unavailable',
            userInstruction: 'Use the paid coding runtime.',
            prompt: 'redacted prompt',
            summary: 'Runtime budget guard is unavailable.',
            changedPaths: [],
            startedAt: '2026-06-21T00:00:00.000Z',
            completedAt: '2026-06-21T00:00:00.000Z',
            runtimeCostSummary: {
              engine: 'opencode-http',
              providerId: 'doubao-review',
              model: 'ark-code-latest',
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              costUsd: 0.42,
              source: 'estimated',
              timestamp: '2026-06-21T00:00:00.000Z',
            },
            budgetDecision: {
              status: 'unavailable',
              blocksRun: true,
              currentSpendUsd: 0,
              projectedCostUsd: 0.42,
              reason: 'Runtime budget authorization is unavailable.',
            },
            redacted: true,
          },
        ],
      }),
    })
    render(<App />)

    const budgetStatus = await screen.findByTestId('runtime-budget-status')
    expect(within(budgetStatus).getByText('unavailable')).toHaveClass('bad')
    expect(budgetStatus).toHaveTextContent('恢复 Team 项目配对、API 连接和已保存的预算策略后重试')

    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))
    await screen.findByTestId('agent-workbench')
    expect(screen.queryByLabelText('Runtime budget approval ID')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '使用预算批准重新运行' })).not.toBeInTheDocument()
  })

  it('selects a local project, saves an editable test command, and archives local test evidence', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(localStateAtCurrentNode('n-test')),
    })
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
        projectId: localProject.id,
        testCommand: 'pnpm test -- --run',
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: /执行测试/ }))
    await waitFor(() =>
      expect(api.runProjectTests).toHaveBeenCalledWith({
        projectId: localProject.id,
        runId: fixtureRuns[0]!.id,
        nodeId: 'n-test',
      }),
    )
    expect(api).not.toHaveProperty('uploadTestEvidenceSummary')
    await screen.findByText('Local test evidence')
    expect(screen.getByTestId('tests-view')).toHaveTextContent('8 tests passed')
    expect(screen.getByTestId('tests-view')).toHaveTextContent('Exit code 0')
    expect(screen.getByTestId('tests-view')).toHaveTextContent('900ms')
    expect(screen.getByTestId('tests-view')).toHaveTextContent('Redacted no')
    expect(screen.getByTestId('toast')).toHaveTextContent('测试通过，证据已归档')

    fireEvent.click(screen.getByRole('button', { name: /工作台/ }))
    const inspector = screen.getByTestId('node-inspector')
    expect(inspector).toHaveTextContent('测试报告已归档')
    expect(inspector).toHaveTextContent('当前节点已有测试报告 Artifact。')
    expect(inspector).not.toHaveTextContent('Gate Enforcement')
    fireEvent.click(within(inspector).getByRole('tab', { name: /Test Evidence/ }))
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('Local test evidence')
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

  it('keeps Test Evidence synchronization behind the trusted main-process test path', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(localStateAtCurrentNode('n-test')),
    })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /选择本地仓库/ }))
    await screen.findByText('fixture-project')
    fireEvent.click(screen.getByRole('button', { name: '测试' }))

    fireEvent.click(screen.getByRole('button', { name: /执行测试/ }))

    await waitFor(() => expect(api.runProjectTests).toHaveBeenCalled())
    expect(window.aiDevFlowDesktop).not.toHaveProperty('uploadTestEvidenceSummary')
    await screen.findByText('Local test evidence')
    expect(screen.getByTestId('toast')).toHaveTextContent('测试通过，证据已归档')
  })

  it('does not execute tests for a future workflow node', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /选择本地仓库/ }))
    await screen.findByText('fixture-project')
    fireEvent.click(screen.getByRole('button', { name: '测试' }))
    fireEvent.click(screen.getByRole('button', { name: /执行测试/ }))

    expect(api.runProjectTests).not.toHaveBeenCalled()
    expect(screen.getByTestId('toast')).toHaveTextContent('当前运行中或失败的测试节点')
  })

  it('shows command safety feedback and blocks dangerous test commands before execution', async () => {
    const api = installDesktopApi({
      loadState: vi.fn().mockResolvedValue(localStateAtCurrentNode('n-test')),
    })
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
