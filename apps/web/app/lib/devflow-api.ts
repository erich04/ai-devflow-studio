import type {
  DevFlowSessionHeaders,
  Project,
  RemoteTestEvidenceSummary,
  TeamMember,
  TokenUsageRollup,
  WorkflowRun,
} from '@ai-devflow/shared'
import { createDemoTeamSessionHeaders } from '@ai-devflow/shared'

export type TeamOverviewResponse = {
  projects: Project[]
  members: TeamMember[]
  runs: WorkflowRun[]
  projectCost: TokenUsageRollup[]
  memberCost: TokenUsageRollup[]
  totalCost: string
  testEvidenceSummaries: RemoteTestEvidenceSummary[]
}

export type FetchTeamOverviewOptions = {
  apiBaseUrl?: string
  fetcher?: typeof fetch
  sessionHeaders?: DevFlowSessionHeaders
}

export function resolveDevFlowApiBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const value =
    env['DEVFLOW_API_BASE_URL'] ??
    env['NEXT_PUBLIC_DEVFLOW_API_URL'] ??
    'http://127.0.0.1:4310'

  return value.replace(/\/$/, '')
}

export async function fetchTeamOverview(
  options: FetchTeamOverviewOptions = {},
): Promise<TeamOverviewResponse> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const sessionHeaders = options.sessionHeaders ?? createDemoTeamSessionHeaders()
  const response = await fetcher(`${apiBaseUrl}/api/team/overview`, {
    cache: 'no-store',
    headers: { accept: 'application/json', ...sessionHeaders },
  })

  if (!response.ok) {
    throw new Error(`DevFlow API /api/team/overview failed with ${response.status}`)
  }

  return response.json() as Promise<TeamOverviewResponse>
}
