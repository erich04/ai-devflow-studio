import type {
  AgentEvent,
  Artifact,
  RemoteRunSummary,
  RemoteSyncUploadResult,
  RemoteTeamSnapshot,
  RemoteTestEvidenceSummary,
  TeamMember,
  Project,
  TokenUsageRollup,
  WorkflowRun,
} from '@ai-devflow/shared'
import type { LoadRemoteSnapshotInput } from './ipc-contract'

type Fetcher = typeof fetch

export type RemoteSyncClientOptions = {
  apiBaseUrl?: string
  fetcher?: Fetcher
}

export type RemoteRunsBundleResponse = {
  runs: WorkflowRun[]
  artifacts: Artifact[]
  events: AgentEvent[]
}

export type RemoteTeamOverviewResponse = {
  projects: Project[]
  members: TeamMember[]
  runs: WorkflowRun[]
  projectCost: TokenUsageRollup[]
  memberCost: TokenUsageRollup[]
  totalCost: string
}

export type RemoteSyncClient = {
  loadRemoteSnapshot(input?: LoadRemoteSnapshotInput): Promise<RemoteTeamSnapshot>
  uploadRunSummary(summary: RemoteRunSummary): Promise<RemoteSyncUploadResult>
  uploadTestEvidenceSummary(summary: RemoteTestEvidenceSummary): Promise<RemoteSyncUploadResult>
}

export function resolveRemoteApiBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const value =
    env['DEVFLOW_API_BASE_URL'] ??
    env['NEXT_PUBLIC_DEVFLOW_API_URL'] ??
    'http://127.0.0.1:4310'

  return value.replace(/\/$/, '')
}

function buildUrl(baseUrl: string, pathname: string, input?: LoadRemoteSnapshotInput): string {
  const url = new URL(pathname, `${baseUrl}/`)
  if (input?.organizationId) {
    url.searchParams.set('organizationId', input.organizationId)
  }

  return url.toString()
}

async function readJson<T>(response: Response, path: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`DevFlow API ${path} failed with ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function postJson<T>(
  fetcher: Fetcher,
  url: string,
  body: unknown,
  path: string,
): Promise<T> {
  const response = await fetcher(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  return readJson<T>(response, path)
}

export function createRemoteSyncClient(
  options: RemoteSyncClientOptions = {},
): RemoteSyncClient {
  const apiBaseUrl = options.apiBaseUrl ?? resolveRemoteApiBaseUrl()
  const fetcher = options.fetcher ?? fetch

  return {
    async loadRemoteSnapshot(input) {
      const overviewPath = '/api/team/overview'
      const runsPath = '/api/runs'
      const [overview, runsBundle] = await Promise.all([
        fetcher(buildUrl(apiBaseUrl, overviewPath, input), {
          headers: { accept: 'application/json' },
        }).then((response) => readJson<RemoteTeamOverviewResponse>(response, overviewPath)),
        fetcher(buildUrl(apiBaseUrl, runsPath, input), {
          headers: { accept: 'application/json' },
        }).then((response) => readJson<RemoteRunsBundleResponse>(response, runsPath)),
      ])

      return {
        projects: overview.projects,
        members: overview.members,
        runs: runsBundle.runs,
        artifacts: runsBundle.artifacts,
        events: runsBundle.events,
        projectCost: overview.projectCost,
        memberCost: overview.memberCost,
        totalCost: overview.totalCost,
      }
    },

    async uploadRunSummary(summary) {
      return postJson<RemoteSyncUploadResult>(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/run-summary'),
        summary,
        '/api/sync/run-summary',
      )
    },

    async uploadTestEvidenceSummary(summary) {
      return postJson<RemoteSyncUploadResult>(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/test-evidence-summary'),
        summary,
        '/api/sync/test-evidence-summary',
      )
    },
  }
}
