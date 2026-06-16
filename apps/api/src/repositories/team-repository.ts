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
  type AgentEvent,
  type Artifact,
  type McpServerDefinition,
  type Project,
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

export type TeamOverviewPayload = {
  projects: Project[]
  members: TeamMember[]
  runs: WorkflowRun[]
  projectCost: TokenUsageRollup[]
  memberCost: TokenUsageRollup[]
  totalCost: string
  testEvidenceSummaries: RemoteTestEvidenceSummary[]
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
}

export function createSeedTeamRepository(): TeamRepository {
  const syncedRuns = [...runs]
  const syncedTestEvidenceSummaries: RemoteTestEvidenceSummary[] = []

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

  return {
    async getRunsBundle() {
      return { runs: syncedRuns, artifacts, events }
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
  }
}
