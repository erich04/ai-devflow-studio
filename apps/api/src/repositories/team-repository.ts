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
  type SkillDefinition,
  type TeamMember,
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
}

export type TeamRepository = {
  getRunsBundle(): Promise<RunsBundle>
  getTeamOverview(): Promise<TeamOverviewPayload>
  getSkills(): Promise<SkillDefinition[]>
  getMcpServers(): Promise<McpServerDefinition[]>
}

export function createSeedTeamRepository(): TeamRepository {
  return {
    async getRunsBundle() {
      return { runs, artifacts, events }
    },

    async getTeamOverview() {
      return {
        projects,
        members,
        runs,
        projectCost: rollupTokenUsage(tokenUsage, 'projectId'),
        memberCost: rollupTokenUsage(tokenUsage, 'userId'),
        totalCost: formatUsd(tokenUsage.reduce((sum, row) => sum + row.costUsd, 0)),
      }
    },

    async getSkills() {
      return skills
    },

    async getMcpServers() {
      return mcpServers
    },
  }
}
