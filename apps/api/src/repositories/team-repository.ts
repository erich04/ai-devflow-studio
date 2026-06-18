import {
  artifacts,
  events,
  formatUsd,
  mcpServers,
  members,
  projects,
  rollupTokenUsage,
  runs,
  skills,
  tokenUsage,
  buildPolicyAwareDeliverySummaries,
  createWarnOnlyDefaultPolicy,
  resolveEffectivePolicy,
  type AgentEvent,
  type AgentProviderConfig,
  type AgentReviewExecutionResult,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type Artifact,
  type EffectiveEnforcementPolicy,
  type GateOverrideDecision,
  type McpServerDefinition,
  type OrganizationEnforcementPolicy,
  type Project,
  type ProviderCredentialMetadata,
  type ProjectEnforcementPolicyOverride,
  type RemoteAgentReviewSummary,
  type RemoteCodingAgentSummary,
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
}

export type TeamRepositorySyncContext = Pick<TeamSession, 'organizationId' | 'userId'>

export type TeamRepository = {
  getRunsBundle(): Promise<RunsBundle>
  getTeamOverview(): Promise<TeamOverviewPayload>
  getSkills(): Promise<SkillDefinition[]>
  getMcpServers(): Promise<McpServerDefinition[]>
  uploadRunSummary(
    summary: RemoteRunSummary,
    context: TeamRepositorySyncContext,
  ): Promise<RemoteSyncUploadResult>
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
}

export function createSeedTeamRepository(): TeamRepository {
  const syncedRuns = [...runs]
  const syncedArtifacts = [...artifacts]
  const syncedEvents = [...events]
  const syncedTestEvidenceSummaries: RemoteTestEvidenceSummary[] = []
  const providerCredentials = new Map<string, AgentProviderCredentialRecord>()
  const agentReviews: AgentReviewResult[] = []
  const agentTraces: AgentTrace[] = []
  const agentTokenUsage: AgentTokenUsage[] = []
  const codingAgentSummaries: RemoteCodingAgentSummary[] = []
  let organizationPolicy = createWarnOnlyDefaultPolicy()
  const projectOverrides: ProjectEnforcementPolicyOverride[] = []
  const gateOverrides: GateOverrideDecision[] = []

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

  function agentProviderConfigs(): AgentProviderConfig[] {
    return [
      {
        id: 'fake-knowledge-review',
        name: 'Deterministic Fake Provider',
        kind: 'fake',
        model: 'fake',
        enabled: true,
        updatedAt: new Date(0).toISOString(),
      },
      ...Array.from(providerCredentials.values()).map(({ metadata }) => ({
        id: metadata.providerId,
        name: metadata.providerId === 'openai-default' ? 'OpenAI Compatible' : metadata.providerId,
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

  return {
    async getRunsBundle() {
      return { runs: syncedRuns, artifacts: syncedArtifacts, events: syncedEvents }
    },

    async getTeamOverview() {
      return {
        projects,
        members,
        runs: syncedRuns,
        projectCost: rollupTokenUsage(tokenUsage, 'projectId'),
        memberCost: rollupTokenUsage(tokenUsage, 'userId'),
        totalCost: formatUsd(tokenUsage.reduce((sum, row) => sum + row.costUsd, 0)),
        testEvidenceSummaries: syncedTestEvidenceSummaries,
        agentReviews,
        agentTraces,
        agentTokenUsage,
        agentProviders: agentProviderConfigs(),
        codingAgentSummaries,
        policyAwareDeliverySummaries: buildPolicyAwareDeliverySummaries({
          projectIds: projects.map((project) => project.id),
          testEvidenceSummaries: syncedTestEvidenceSummaries,
          agentReviews,
          codingAgentSummaries,
          gateOverrides,
          updatedAt: new Date().toISOString(),
        }),
        enforcementPolicies: {
          organizationPolicy,
          projectOverrides,
          effectivePolicies: projects.map((project) =>
            resolveEffectivePolicy(
              organizationPolicy,
              projectOverrides.find((override) => override.projectId === project.id) ?? null,
            ),
          ),
          gateOverrides,
        },
      }
    },

    async getSkills() {
      return skills
    },

    async getMcpServers() {
      return mcpServers
    },

    async uploadRunSummary(summary) {
      const existingRun = syncedRuns.find((run) => run.id === summary.runId)
      const syncedRun: WorkflowRun = existingRun
        ? {
            ...existingRun,
            title: summary.title,
            projectId: summary.projectId,
            status: summary.status,
            currentNodeId: summary.currentNodeId,
            branchName: summary.branchName,
            updatedAt: summary.updatedAt,
          }
        : {
            id: summary.runId,
            title: summary.title,
            request: 'Synced from DevFlow Electron.',
            projectId: summary.projectId,
            creatorId: 'u-erich',
            status: summary.status,
            currentNodeId: summary.currentNodeId,
            branchName: summary.branchName,
            createdAt: summary.updatedAt,
            updatedAt: summary.updatedAt,
            nodes: [],
            edges: [],
          }

      upsertSyncedRun(syncedRun)

      return {
        accepted: true,
        syncedAt: new Date().toISOString(),
        message: 'run summary accepted by seed repository',
      }
    },

    async uploadTestEvidenceSummary(summary) {
      upsertSyncedEvidence(summary)

      return {
        accepted: true,
        syncedAt: new Date().toISOString(),
        message: 'test evidence summary accepted by seed repository',
      }
    },

    async uploadAgentReviewSummary(summary) {
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
        policyFindings: [],
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

    async uploadCodingAgentSummary(summary) {
      upsertById(codingAgentSummaries, summary)

      return {
        accepted: true,
        syncedAt: new Date().toISOString(),
        message: 'coding agent summary accepted by seed repository',
      }
    },

    async listAgentProviders() {
      return agentProviderConfigs()
    },

    async saveAgentProviderCredential(metadata, encryptedSecret) {
      providerCredentials.set(metadata.providerId, { metadata, encryptedSecret })
      return metadata
    },

    async getAgentProviderCredential(providerId) {
      return providerCredentials.get(providerId) ?? null
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
  }
}
