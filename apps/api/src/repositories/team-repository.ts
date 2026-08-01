import {
  formatUsd,
  redactSensitiveText,
  rollupTokenUsage,
  runtimeCostSummaryToTokenUsage,
  buildPolicyAwareDeliverySummaries,
  createWarnOnlyDefaultPolicy,
  redactRemoteCodingAgentSummaryForSync,
  redactRemoteAgentReviewSummaryForSync,
  redactRemoteRunSummaryForSync,
  redactRemoteTestEvidenceSummaryForSync,
  resolveEffectivePolicy,
  type AgentEvent,
  type AgentProviderConfig,
  type AgentReviewExecutionResult,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type Artifact,
  type AuthProvider,
  type AuthenticatedIdentity,
  type AuthenticatedSession,
  type DesktopPairingCode,
  type DesktopPairingExchangeResult,
  type EffectiveEnforcementPolicy,
  type GateOverrideDecision,
  type McpServerDefinition,
  type OrganizationEnforcementPolicy,
  type Project,
  type ProviderCredentialMetadata,
  type ProjectEnforcementPolicyOverride,
  type RemoteAgentReviewSummary,
  type RemoteCodingAgentSummary,
  type RemoteRunDeleteResult,
  type RuntimeBudgetApproval,
  type RuntimeBudgetPolicy,
  type PolicyAwareDeliverySummary,
  type RemoteRunSummary,
  type RemoteSyncUploadResult,
  type RemoteTestEvidenceSummary,
  type SkillDefinition,
  type TeamMember,
  type TeamSession,
  type TokenUsageRollup,
  type WorkflowRun,
} from '@ai-devflow/shared'
import {
  artifacts,
  events,
  mcpServers,
  members,
  projects,
  runs,
  skills,
  tokenUsage,
} from '@ai-devflow/shared/fixtures'

const DEMO_ORGANIZATION_ID = 'org-demo'
const DEMO_IDENTITY_TIMESTAMP = new Date(0).toISOString()

export type RunsBundle = {
  runs: WorkflowRun[]
  artifacts: Artifact[]
  events: AgentEvent[]
}

export type AgentProviderCredentialRecord = {
  metadata: ProviderCredentialMetadata
  encryptedSecret: string
}

export type AgentReviewBundle = AgentReviewExecutionResult & {
  artifact: Artifact
  event: AgentEvent
}

export type TeamOverviewPayload = {
  projects: Project[]
  members: TeamMember[]
  runs: WorkflowRun[]
  projectCost: TokenUsageRollup[]
  memberCost: TokenUsageRollup[]
  totalCost: string
  testEvidenceSummaries: RemoteTestEvidenceSummary[]
  agentReviews: AgentReviewResult[]
  agentTraces: AgentTrace[]
  agentTokenUsage: AgentTokenUsage[]
  agentProviders: AgentProviderConfig[]
  codingAgentSummaries: RemoteCodingAgentSummary[]
  policyAwareDeliverySummaries: PolicyAwareDeliverySummary[]
  enforcementPolicies: {
    organizationPolicy: OrganizationEnforcementPolicy
    projectOverrides: ProjectEnforcementPolicyOverride[]
    effectivePolicies: EffectiveEnforcementPolicy[]
    gateOverrides: GateOverrideDecision[]
  }
  runtimeBudgetPolicies: RuntimeBudgetPolicy[]
  runtimeBudgetApprovals: RuntimeBudgetApproval[]
}

export type TeamRepositoryReadContext = Pick<TeamSession, 'organizationId'>

export type TeamRepositorySyncContext = TeamRepositoryReadContext & Pick<TeamSession, 'userId'>

export type ResolvedDesktopTokenSession = {
  tokenRecordId: string
  session: AuthenticatedSession
}

export class CanonicalRunRequiredError extends Error {
  constructor(runId: string, projectId: string) {
    super(`Canonical Run Summary is required before evidence sync: ${runId} (${projectId})`)
    this.name = 'CanonicalRunRequiredError'
  }
}

export class RemoteRunSummaryConflictError extends Error {
  constructor(runId: string, projectId: string) {
    super(
      `Remote Run Summary conflicts with canonical ownership or is stale: ${runId} (${projectId})`,
    )
    this.name = 'RemoteRunSummaryConflictError'
  }
}

export class RemoteChildSummaryConflictError extends Error {
  constructor(summaryId: string, runId: string, projectId: string) {
    super(
      `Remote child summary ID conflicts with canonical scope: ${summaryId} -> ${runId} (${projectId})`,
    )
    this.name = 'RemoteChildSummaryConflictError'
  }
}

export class TeamProjectScopeError extends Error {
  constructor() {
    super('Team project is unavailable in the authenticated organization.')
    this.name = 'TeamProjectScopeError'
  }
}

export type GitHubIdentityProfile = {
  providerAccountId: string
  username?: string
  name: string
  email?: string
  avatarUrl?: string
}

export type GitHubIdentityBootstrapResult =
  | {
      status: 'existing' | 'created'
      identity: AuthenticatedIdentity
    }
  | {
      status: 'blocked'
      reason: 'organization_exists'
    }

export type TeamProjectCreateInput = {
  name: string
  slug: string
  description: string
  repository: string
  defaultBranch?: string
  knowledgeBasePath?: string
  testCommand?: string
}

export type TeamRepository = {
  getAuthenticatedIdentity(input: {
    provider: AuthProvider
    providerAccountId: string
  }): Promise<AuthenticatedIdentity | null>
  resolveBrowserSession(authAccountId: string): Promise<AuthenticatedSession | null>
  resolveOrBootstrapGitHubIdentity(
    input: GitHubIdentityProfile,
  ): Promise<GitHubIdentityBootstrapResult>
  createProject(
    input: TeamProjectCreateInput,
    context: TeamRepositorySyncContext,
  ): Promise<Project>
  createDesktopPairingCode(
    input: { projectId: string },
    context: TeamRepositorySyncContext,
  ): Promise<DesktopPairingCode>
  exchangeDesktopPairingCode(input: { code: string }): Promise<DesktopPairingExchangeResult>
  resolveDesktopTokenSession(token: string): Promise<ResolvedDesktopTokenSession | null>
  getRunsBundle(context: TeamRepositoryReadContext): Promise<RunsBundle>
  getTeamOverview(context: TeamRepositoryReadContext): Promise<TeamOverviewPayload>
  getSkills(context: TeamRepositoryReadContext): Promise<SkillDefinition[]>
  getMcpServers(context: TeamRepositoryReadContext): Promise<McpServerDefinition[]>
  uploadRunSummary(
    summary: RemoteRunSummary,
    context: TeamRepositorySyncContext,
  ): Promise<RemoteSyncUploadResult>
  deleteRun(runId: string, context: TeamRepositorySyncContext): Promise<RemoteRunDeleteResult>
  uploadTestEvidenceSummary(
    summary: RemoteTestEvidenceSummary,
    context: TeamRepositorySyncContext,
  ): Promise<RemoteSyncUploadResult>
  uploadAgentReviewSummary(
    summary: RemoteAgentReviewSummary,
    context: TeamRepositorySyncContext,
  ): Promise<RemoteSyncUploadResult>
  uploadCodingAgentSummary(
    summary: RemoteCodingAgentSummary,
    context: TeamRepositorySyncContext,
  ): Promise<RemoteSyncUploadResult>
  listAgentProviders(context: TeamRepositorySyncContext): Promise<AgentProviderConfig[]>
  saveAgentProviderCredential(
    metadata: ProviderCredentialMetadata,
    encryptedSecret: string,
    context: TeamRepositorySyncContext,
  ): Promise<ProviderCredentialMetadata>
  getAgentProviderCredential(
    providerId: string,
    context: TeamRepositorySyncContext,
  ): Promise<AgentProviderCredentialRecord | null>
  saveAgentReviewBundle(
    bundle: AgentReviewBundle,
    context: TeamRepositorySyncContext,
  ): Promise<AgentReviewExecutionResult>
  saveAgentEvent(
    event: AgentEvent,
    context: TeamRepositorySyncContext,
  ): Promise<AgentEvent>
  listAgentReviews(
    input: { runId?: string },
    context: TeamRepositorySyncContext,
  ): Promise<AgentReviewResult[]>
  getEnforcementPolicy(
    projectId: string,
    context: TeamRepositorySyncContext,
  ): Promise<{
    organizationPolicy: OrganizationEnforcementPolicy
    projectOverride: ProjectEnforcementPolicyOverride | null
    effectivePolicy: EffectiveEnforcementPolicy
  }>
  saveEnforcementPolicy(
    policy: OrganizationEnforcementPolicy,
    context: TeamRepositorySyncContext,
  ): Promise<OrganizationEnforcementPolicy>
  saveGateOverride(
    decision: GateOverrideDecision,
    context: TeamRepositorySyncContext,
  ): Promise<GateOverrideDecision>
  listGateOverrides(
    input: { runId?: string },
    context: TeamRepositorySyncContext,
  ): Promise<GateOverrideDecision[]>
  getRuntimeBudgetPolicy(
    projectId: string,
    context: TeamRepositorySyncContext,
  ): Promise<RuntimeBudgetPolicy | null>
  saveRuntimeBudgetPolicy(
    policy: RuntimeBudgetPolicy,
    context: TeamRepositorySyncContext,
  ): Promise<RuntimeBudgetPolicy>
  saveRuntimeBudgetApproval(
    approval: RuntimeBudgetApproval,
    context: TeamRepositorySyncContext,
  ): Promise<RuntimeBudgetApproval>
  listRuntimeBudgetApprovals(
    input: { projectId?: string },
    context: TeamRepositorySyncContext,
  ): Promise<RuntimeBudgetApproval[]>
}

export function redactAgentEventForPersistence(event: AgentEvent): AgentEvent {
  return {
    id: event.id,
    runId: event.runId,
    ...(event.nodeId ? { nodeId: event.nodeId } : {}),
    sequence: event.sequence,
    kind: event.kind,
    message: redactSensitiveText(event.message).value,
    timestamp: event.timestamp,
  }
}

export function createSeedTeamRepository(): TeamRepository {
  const teamProjects = [...projects]
  const projectOrganizationIds = new Map(
    teamProjects.map((project) => [project.id, DEMO_ORGANIZATION_ID]),
  )
  const syncedRuns = [...runs]
  const seedRunIds = new Set(runs.map((run) => run.id))
  const runOrganizationIds = new Map(runs.map((run) => [run.id, DEMO_ORGANIZATION_ID]))
  const syncedArtifacts = [...artifacts]
  const syncedEvents = [...events]
  const syncedTestEvidenceSummaries: RemoteTestEvidenceSummary[] = []
  const providerCredentials = new Map<string, AgentProviderCredentialRecord>()
  const agentReviews: AgentReviewResult[] = []
  const agentTraces: AgentTrace[] = []
  const agentTokenUsage: AgentTokenUsage[] = []
  const codingAgentSummaries: RemoteCodingAgentSummary[] = []
  let organizationPolicy = createWarnOnlyDefaultPolicy({ organizationId: DEMO_ORGANIZATION_ID })
  const projectOverrides: ProjectEnforcementPolicyOverride[] = []
  const gateOverrides: GateOverrideDecision[] = []
  const runtimeBudgetPolicies: RuntimeBudgetPolicy[] = []
  const runtimeBudgetApprovals: RuntimeBudgetApproval[] = []
  const desktopPairingCodes = new Map<string, Omit<DesktopPairingExchangeResult, 'token' | 'tokenId'>>()
  const desktopTokenSessions = new Map<string, ResolvedDesktopTokenSession>()

  function upsertSyncedRun(run: WorkflowRun) {
    const index = syncedRuns.findIndex((candidate) => candidate.id === run.id)
    if (index >= 0) {
      syncedRuns[index] = run
      return
    }

    syncedRuns.unshift(run)
  }

  function upsertSyncedEvidence(summary: RemoteTestEvidenceSummary) {
    const index = syncedTestEvidenceSummaries.findIndex((evidence) => evidence.id === summary.id)
    if (index >= 0) {
      syncedTestEvidenceSummaries[index] = summary
      return
    }

    syncedTestEvidenceSummaries.unshift(summary)
  }

  function hasSameRunProjection(run: WorkflowRun, summary: RemoteRunSummary): boolean {
    const currentNode = run.nodes.find((node) => node.id === run.currentNodeId)
    return (
      run.version === summary.version &&
      run.title === summary.title &&
      run.projectId === summary.projectId &&
      run.status === summary.status &&
      run.currentNodeId === summary.currentNodeId &&
      run.branchName === summary.branchName &&
      run.updatedAt === summary.updatedAt &&
      currentNode?.id === summary.currentNode.id &&
      currentNode.stage === summary.currentNode.stage &&
      currentNode.kind === summary.currentNode.kind &&
      currentNode.status === summary.currentNode.status &&
      currentNode.requiredRole === summary.currentNode.requiredRole
    )
  }

  function assertCanonicalRun(
    summary: { runId: string; projectId: string },
    context: TeamRepositorySyncContext,
  ) {
    const canonicalRun = syncedRuns.find(
      (run) =>
        run.id === summary.runId &&
        run.projectId === summary.projectId &&
        run.creatorId === context.userId &&
        runOrganizationIds.get(run.id) === context.organizationId,
    )
    if (!canonicalRun) {
      throw new CanonicalRunRequiredError(summary.runId, summary.projectId)
    }
  }

  function assertStableChildSummaryScope(
    existing: { id: string; runId: string; nodeId: string; projectId: string } | undefined,
    summary: { id: string; runId: string; nodeId: string; projectId: string },
    context: TeamRepositorySyncContext,
  ) {
    if (
      existing &&
      (existing.runId !== summary.runId ||
        existing.nodeId !== summary.nodeId ||
        existing.projectId !== summary.projectId ||
        runOrganizationIds.get(existing.runId) !== context.organizationId)
    ) {
      throw new RemoteChildSummaryConflictError(summary.id, summary.runId, summary.projectId)
    }
  }

  function agentProviderConfigs(context: TeamRepositoryReadContext): AgentProviderConfig[] {
    return [
      {
        id: 'fake-knowledge-review',
        name: 'Deterministic Fake Provider',
        kind: 'fake',
        model: 'fake',
        enabled: true,
        updatedAt: new Date(0).toISOString(),
      },
      ...Array.from(providerCredentials.entries())
        .filter(([key]) => key.startsWith(`${context.organizationId}:`))
        .map(([, { metadata }]) => ({
          id: metadata.providerId,
          name:
            metadata.providerId === 'openai-default'
              ? 'OpenAI Compatible'
              : metadata.providerId,
          kind: 'openai-compatible' as const,
          ...(metadata.baseUrl ? { baseUrl: metadata.baseUrl } : {}),
          model: metadata.model,
          enabled: true,
          maskedCredential: metadata.maskedCredential,
          updatedAt: metadata.updatedAt,
        })),
    ]
  }

  function upsertById<T extends { id: string }>(items: T[], item: T) {
    const index = items.findIndex((candidate) => candidate.id === item.id)
    if (index >= 0) {
      items[index] = item
      return
    }

    items.unshift(item)
  }

  function removeWhere<T>(items: T[], predicate: (item: T) => boolean) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (predicate(items[index]!)) {
        items.splice(index, 1)
      }
    }
  }

  return {
    async getAuthenticatedIdentity(input) {
      if (input.provider !== 'github' || !input.providerAccountId.startsWith('demo:')) {
        return null
      }

      const memberId = input.providerAccountId.slice('demo:'.length)
      const member = members.find((candidate) => candidate.id === memberId)
      if (!member) {
        return null
      }

      return {
        user: {
          id: member.id,
          organizationId: DEMO_ORGANIZATION_ID,
          name: member.name,
          role: member.role,
          avatarInitials: member.avatarInitials,
          focus: member.focus,
          createdAt: DEMO_IDENTITY_TIMESTAMP,
          updatedAt: DEMO_IDENTITY_TIMESTAMP,
        },
        authAccount: {
          id: `acct-demo-${member.id}`,
          userId: member.id,
          provider: 'github',
          providerAccountId: input.providerAccountId,
          username: member.id,
          createdAt: DEMO_IDENTITY_TIMESTAMP,
          updatedAt: DEMO_IDENTITY_TIMESTAMP,
        },
        projectMemberships: teamProjects.map((project) => ({
          projectId: project.id,
          userId: member.id,
          role: member.role,
        })),
      }
    },

    async resolveBrowserSession(authAccountId) {
      if (!authAccountId.startsWith('acct-demo-')) {
        return null
      }

      const memberId = authAccountId.slice('acct-demo-'.length)
      const member = members.find((candidate) => candidate.id === memberId)
      if (!member) {
        return null
      }

      return {
        source: 'authenticated',
        organizationId: DEMO_ORGANIZATION_ID,
        userId: member.id,
        role: member.role,
        authAccountId,
        projectMemberships: teamProjects
          .filter(
            (project) => projectOrganizationIds.get(project.id) === DEMO_ORGANIZATION_ID,
          )
          .map((project) => ({
            projectId: project.id,
            userId: member.id,
            role: member.role,
          })),
      }
    },

    async resolveOrBootstrapGitHubIdentity(input) {
      const existing = await this.getAuthenticatedIdentity({
        provider: 'github',
        providerAccountId: input.providerAccountId,
      })

      if (existing) {
        return { status: 'existing', identity: existing }
      }

      return {
        status: 'blocked',
        reason: 'organization_exists',
      }
    },

    async createProject(input, context) {
      const project: Project = {
        id: `p-${input.slug}`,
        name: input.name,
        slug: input.slug,
        description: input.description,
        repository: input.repository,
        defaultBranch: input.defaultBranch ?? 'main',
        health: 'on_track',
        knowledgeBasePath: input.knowledgeBasePath ?? `docs/${input.slug}/`,
        testCommand: input.testCommand ?? '',
      }
      upsertById(teamProjects, project)
      projectOrganizationIds.set(project.id, context.organizationId)
      return project
    },
    async createDesktopPairingCode(input, context) {
      if (projectOrganizationIds.get(input.projectId) !== context.organizationId) {
        throw new TeamProjectScopeError()
      }
      const createdAt = new Date(0).toISOString()
      const sessionContext = context as TeamRepositorySyncContext & Partial<TeamSession>
      const role = sessionContext.role ?? 'owner'
      const authAccountId =
        'authAccountId' in sessionContext && typeof sessionContext.authAccountId === 'string'
          ? sessionContext.authAccountId
          : `acct-demo-${context.userId}`
      const projectMembership =
        sessionContext.projectMemberships?.find(
          (membership) => membership.projectId === input.projectId,
        ) ?? { projectId: input.projectId, userId: context.userId, role }
      const tokenRole = role === 'owner' ? 'lead' : role
      const tokenMembership = { ...projectMembership, role: tokenRole }
      const code = `desktop-pairing-${input.projectId}.demo-secret`
      desktopPairingCodes.set(code, {
        organizationId: context.organizationId,
        projectId: input.projectId,
        userId: context.userId,
        role: tokenRole,
        authAccountId,
        projectMemberships: [tokenMembership],
        createdAt,
      })
      return {
        id: `desktop-pairing-${input.projectId}`,
        organizationId: context.organizationId,
        projectId: input.projectId,
        createdByUserId: context.userId,
        code,
        expiresAt: new Date(10 * 60 * 1000).toISOString(),
        createdAt,
        attemptsRemaining: 5,
      }
    },
    async exchangeDesktopPairingCode(input) {
      const projectId = input.code.split('.')[0]?.replace('desktop-pairing-', '') || 'p-payments'
      const createdAt = new Date(0).toISOString()
      const stored = desktopPairingCodes.get(input.code) ?? {
        organizationId: DEMO_ORGANIZATION_ID,
        projectId,
        userId: 'u-erich',
        role: 'lead' as const,
        authAccountId: 'acct-demo-erich',
        projectMemberships: [{ projectId, userId: 'u-erich', role: 'owner' as const }],
        createdAt,
      }
      const token = `devflow-desktop-token-${projectId}`
      const tokenId = `desktop-token-${projectId}`
      desktopTokenSessions.set(token, {
        tokenRecordId: tokenId,
        session: {
          source: 'authenticated',
          organizationId: stored.organizationId,
          userId: stored.userId,
          role: stored.role,
          authAccountId: stored.authAccountId,
          projectMemberships: stored.projectMemberships,
        },
      })
      return {
        token,
        tokenId,
        ...stored,
      }
    },
    async resolveDesktopTokenSession(token) {
      if (!token.startsWith('devflow-desktop-token-')) {
        return null
      }

      return desktopTokenSessions.get(token) ?? null
    },

    async getRunsBundle(context) {
      const runs = syncedRuns.filter(
        (run) => runOrganizationIds.get(run.id) === context.organizationId,
      )
      const runIds = new Set(runs.map((run) => run.id))
      return {
        runs,
        artifacts: syncedArtifacts.filter((artifact) => runIds.has(artifact.runId)),
        events: syncedEvents.filter((event) => runIds.has(event.runId)),
      }
    },

    async getTeamOverview(context) {
      const scopedProjects = teamProjects.filter(
        (project) => projectOrganizationIds.get(project.id) === context.organizationId,
      )
      const scopedRuns = syncedRuns.filter(
        (run) => runOrganizationIds.get(run.id) === context.organizationId,
      )
      const runIds = new Set(scopedRuns.map((run) => run.id))
      const projectIds = new Set([
        ...scopedProjects.map((project) => project.id),
        ...scopedRuns.map((run) => run.projectId),
      ])
      const scopedTestEvidence = syncedTestEvidenceSummaries.filter(
        (summary) => projectIds.has(summary.projectId) && runIds.has(summary.runId),
      )
      const scopedAgentReviews = agentReviews.filter(
        (review) => projectIds.has(review.projectId) && runIds.has(review.runId),
      )
      const scopedAgentTraces = agentTraces.filter((trace) => runIds.has(trace.runId))
      const scopedAgentTokenUsage = agentTokenUsage.filter(
        (usage) => projectIds.has(usage.projectId) && runIds.has(usage.runId),
      )
      const scopedCodingAgentSummaries = codingAgentSummaries.filter(
        (summary) => projectIds.has(summary.projectId) && runIds.has(summary.runId),
      )
      const codingTokenUsage = scopedCodingAgentSummaries
        .map((summary) => summary.costSummary)
        .filter(
          (summary): summary is NonNullable<RemoteCodingAgentSummary['costSummary']> =>
            Boolean(summary),
        )
        .map(runtimeCostSummaryToTokenUsage)
      const allTokenUsage = [
        ...tokenUsage.filter((usage) => projectIds.has(usage.projectId) && runIds.has(usage.runId)),
        ...codingTokenUsage,
      ]
      const scopedOrganizationPolicy =
        organizationPolicy.organizationId === context.organizationId
          ? organizationPolicy
          : createWarnOnlyDefaultPolicy({ organizationId: context.organizationId })
      const scopedProjectOverrides = projectOverrides.filter((override) =>
        projectIds.has(override.projectId),
      )
      const scopedGateOverrides = gateOverrides.filter(
        (override) => projectIds.has(override.projectId) && runIds.has(override.runId),
      )

      return {
        projects: scopedProjects,
        members: context.organizationId === DEMO_ORGANIZATION_ID ? members : [],
        runs: scopedRuns,
        projectCost: rollupTokenUsage(allTokenUsage, 'projectId'),
        memberCost: rollupTokenUsage(allTokenUsage, 'userId'),
        totalCost: formatUsd(allTokenUsage.reduce((sum, row) => sum + row.costUsd, 0)),
        testEvidenceSummaries: scopedTestEvidence,
        agentReviews: scopedAgentReviews,
        agentTraces: scopedAgentTraces,
        agentTokenUsage: scopedAgentTokenUsage,
        agentProviders: agentProviderConfigs(context),
        codingAgentSummaries: scopedCodingAgentSummaries,
        policyAwareDeliverySummaries: buildPolicyAwareDeliverySummaries({
          projectIds: scopedProjects.map((project) => project.id),
          testEvidenceSummaries: scopedTestEvidence,
          agentReviews: scopedAgentReviews,
          codingAgentSummaries: scopedCodingAgentSummaries,
          gateOverrides: scopedGateOverrides,
          updatedAt: new Date().toISOString(),
        }),
        enforcementPolicies: {
          organizationPolicy: scopedOrganizationPolicy,
          projectOverrides: scopedProjectOverrides,
          effectivePolicies: scopedProjects.map((project) =>
            resolveEffectivePolicy(
              scopedOrganizationPolicy,
              scopedProjectOverrides.find((override) => override.projectId === project.id) ?? null,
            ),
          ),
          gateOverrides: scopedGateOverrides,
        },
        runtimeBudgetPolicies: runtimeBudgetPolicies.filter((policy) =>
          projectIds.has(policy.projectId),
        ),
        runtimeBudgetApprovals: runtimeBudgetApprovals.filter((approval) =>
          projectIds.has(approval.projectId),
        ),
      }
    },

    async getSkills(context) {
      return context.organizationId === DEMO_ORGANIZATION_ID ? skills : []
    },

    async getMcpServers(context) {
      return context.organizationId === DEMO_ORGANIZATION_ID ? mcpServers : []
    },

    async uploadRunSummary(summary, context) {
      summary = redactRemoteRunSummaryForSync(summary)
      const existingRun = syncedRuns.find((run) => run.id === summary.runId)
      if (
        existingRun &&
        (seedRunIds.has(summary.runId) ||
          runOrganizationIds.get(summary.runId) !== context.organizationId ||
          existingRun.projectId !== summary.projectId ||
          existingRun.creatorId !== context.userId ||
          existingRun.version > summary.version)
      ) {
        throw new RemoteRunSummaryConflictError(summary.runId, summary.projectId)
      }

      if (existingRun?.version === summary.version) {
        if (!hasSameRunProjection(existingRun, summary)) {
          throw new RemoteRunSummaryConflictError(summary.runId, summary.projectId)
        }

        return {
          accepted: true,
          syncedAt: new Date().toISOString(),
          message: 'run summary accepted by seed repository',
        }
      }

      const currentNode = {
        id: summary.currentNode.id,
        stage: summary.currentNode.stage,
        title: `Synced ${summary.currentNode.stage} node`,
        subtitle: 'Canonical current node from DevFlow Electron.',
        kind: summary.currentNode.kind,
        status: summary.currentNode.status,
        ownerId: context.userId,
        ...(summary.currentNode.requiredRole
          ? { requiredRole: summary.currentNode.requiredRole }
          : {}),
        retryCount: 0,
        artifactIds: [],
      }
      const nodes =
        existingRun?.nodes
          .filter((node) => node.id !== currentNode.id)
          .map((node) =>
            node.status === 'running' || node.status === 'blocked'
              ? { ...node, status: 'success' as const }
              : node,
          ) ?? []
      nodes.push(currentNode)

      const syncedRun: WorkflowRun = existingRun
        ? {
            ...existingRun,
            version: summary.version,
            title: summary.title,
            projectId: summary.projectId,
            status: summary.status,
            currentNodeId: summary.currentNodeId,
            branchName: summary.branchName,
            updatedAt: summary.updatedAt,
            nodes,
          }
        : {
            id: summary.runId,
            version: summary.version,
            title: summary.title,
            request: 'Synced from DevFlow Electron.',
            projectId: summary.projectId,
            creatorId: context.userId,
            status: summary.status,
            currentNodeId: summary.currentNodeId,
            branchName: summary.branchName,
            createdAt: summary.updatedAt,
            updatedAt: summary.updatedAt,
            nodes,
            edges: [],
          }

      upsertSyncedRun(syncedRun)
      runOrganizationIds.set(summary.runId, context.organizationId)

      return {
        accepted: true,
        syncedAt: new Date().toISOString(),
        message: 'run summary accepted by seed repository',
      }
    },

    async deleteRun(runId) {
      if (seedRunIds.has(runId)) {
        return {
          deleted: false,
          deletedAt: new Date().toISOString(),
          message: 'Seed/preview runs cannot be deleted',
        }
      }

      const existing = syncedRuns.find((run) => run.id === runId)
      if (!existing) {
        return {
          deleted: false,
          deletedAt: new Date().toISOString(),
          message: 'run not found',
        }
      }

      removeWhere(syncedRuns, (run) => run.id === runId)
      removeWhere(syncedArtifacts, (artifact) => artifact.runId === runId)
      removeWhere(syncedEvents, (event) => event.runId === runId)
      removeWhere(syncedTestEvidenceSummaries, (summary) => summary.runId === runId)
      removeWhere(agentReviews, (review) => review.runId === runId)
      removeWhere(agentTraces, (trace) => trace.runId === runId)
      removeWhere(agentTokenUsage, (usage) => usage.runId === runId)
      removeWhere(codingAgentSummaries, (summary) => summary.runId === runId)
      removeWhere(gateOverrides, (override) => override.runId === runId)
      runOrganizationIds.delete(runId)

      return {
        deleted: true,
        deletedAt: new Date().toISOString(),
        message: 'run deleted by seed repository',
      }
    },

    async uploadTestEvidenceSummary(summary, context) {
      summary = redactRemoteTestEvidenceSummaryForSync(summary)
      assertCanonicalRun(summary, context)
      assertStableChildSummaryScope(
        syncedTestEvidenceSummaries.find((candidate) => candidate.id === summary.id),
        summary,
        context,
      )
      upsertSyncedEvidence(summary)

      return {
        accepted: true,
        syncedAt: new Date().toISOString(),
        message: 'test evidence summary accepted by seed repository',
      }
    },

    async uploadAgentReviewSummary(summary, context) {
      summary = redactRemoteAgentReviewSummaryForSync(summary)
      assertCanonicalRun(summary, context)
      assertStableChildSummaryScope(
        agentReviews.find((candidate) => candidate.id === summary.id),
        summary,
        context,
      )
      const review: AgentReviewResult = {
        id: summary.id,
        requestId: `remote-summary-${summary.id}`,
        runId: summary.runId,
        nodeId: summary.nodeId,
        projectId: summary.projectId,
        runtime: summary.runtime,
        providerId: summary.providerId,
        model: summary.model,
        conclusion: summary.conclusion,
        summary: summary.summary,
        risks: Array.from({ length: summary.riskCount }, (_, index) => `Remote summary risk ${index + 1}`),
        missingEvidence: Array.from(
          { length: summary.missingEvidenceCount },
          (_, index) => `Remote summary missing evidence ${index + 1}`,
        ),
        suggestedTests: [],
        knowledgeReferences: [],
        policyFindings: (summary.policyFindings ?? []).map((finding) => ({
          ...finding,
          evidenceIds: [],
          knowledgeReferenceIds: [],
        })),
        confidence: summary.confidence,
        gateAdvisory: {
          id: `gate-advisory-${summary.id}`,
          runId: summary.runId,
          nodeId: summary.nodeId,
          level: summary.advisoryLevel,
          blocksApproval: summary.blocksApproval,
          summary: summary.summary,
          missingEvidence: [],
          riskCount: summary.riskCount,
          createdAt: summary.createdAt,
        },
        createdAt: summary.createdAt,
      }

      upsertById(agentReviews, review)

      return {
        accepted: true,
        syncedAt: new Date().toISOString(),
        message: 'agent review summary accepted by seed repository',
      }
    },

    async uploadCodingAgentSummary(summary, context) {
      summary = redactRemoteCodingAgentSummaryForSync(summary)
      assertCanonicalRun(summary, context)
      assertStableChildSummaryScope(
        codingAgentSummaries.find((candidate) => candidate.id === summary.id),
        summary,
        context,
      )
      upsertById(codingAgentSummaries, summary)

      return {
        accepted: true,
        syncedAt: new Date().toISOString(),
        message: 'coding agent summary accepted by seed repository',
      }
    },

    async listAgentProviders(context) {
      return agentProviderConfigs(context)
    },

    async saveAgentProviderCredential(metadata, encryptedSecret, context) {
      providerCredentials.set(`${context.organizationId}:${metadata.providerId}`, {
        metadata,
        encryptedSecret,
      })
      return metadata
    },

    async getAgentProviderCredential(providerId, context) {
      return providerCredentials.get(`${context.organizationId}:${providerId}`) ?? null
    },

    async saveAgentReviewBundle(bundle) {
      upsertById(agentReviews, bundle.review)
      upsertById(agentTraces, bundle.trace)
      upsertById(agentTokenUsage, bundle.tokenUsage)
      upsertById(syncedArtifacts, bundle.artifact)
      upsertById(syncedEvents, bundle.event)
      return {
        review: bundle.review,
        trace: bundle.trace,
        tokenUsage: bundle.tokenUsage,
      }
    },

    async saveAgentEvent(event, context) {
      if (!syncedRuns.some(
        (run) => run.id === event.runId && runOrganizationIds.get(run.id) === context.organizationId,
      )) {
        throw new CanonicalRunRequiredError(event.runId, 'unknown')
      }
      const redactedEvent = redactAgentEventForPersistence(event)
      upsertById(syncedEvents, redactedEvent)
      return redactedEvent
    },

    async listAgentReviews(input) {
      return agentReviews.filter((review) => !input.runId || review.runId === input.runId)
    },

    async getEnforcementPolicy(projectId) {
      const projectOverride = projectOverrides.find((override) => override.projectId === projectId) ?? null
      return {
        organizationPolicy,
        projectOverride,
        effectivePolicy: resolveEffectivePolicy(organizationPolicy, projectOverride),
      }
    },

    async saveEnforcementPolicy(policy) {
      organizationPolicy = policy
      return organizationPolicy
    },

    async saveGateOverride(decision) {
      upsertById(gateOverrides, decision)
      return decision
    },

    async listGateOverrides(input) {
      return gateOverrides.filter((decision) => !input.runId || decision.runId === input.runId)
    },

    async getRuntimeBudgetPolicy(projectId) {
      return runtimeBudgetPolicies.find((policy) => policy.projectId === projectId) ?? null
    },

    async saveRuntimeBudgetPolicy(policy) {
      const index = runtimeBudgetPolicies.findIndex((candidate) => candidate.projectId === policy.projectId)
      if (index >= 0) {
        runtimeBudgetPolicies[index] = policy
      } else {
        runtimeBudgetPolicies.unshift(policy)
      }
      return policy
    },

    async saveRuntimeBudgetApproval(approval) {
      upsertById(runtimeBudgetApprovals, approval)
      return approval
    },

    async listRuntimeBudgetApprovals(input) {
      return runtimeBudgetApprovals.filter((approval) => !input.projectId || approval.projectId === input.projectId)
    },
  }
}
