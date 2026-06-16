import { describe, expect, it, vi } from 'vitest'
import type {
  RemoteRunSummary,
  RemoteTestEvidenceSummary,
} from '@ai-devflow/shared'
import { createRemoteSyncClient, resolveRemoteApiBaseUrl } from './remote-sync'

const overview = {
  projects: [
    {
      id: 'p-remote',
      name: 'Remote API',
      repository: 'erich/remote-api',
      defaultBranch: 'main',
      health: 'on_track',
      knowledgeBasePath: 'docs/remote',
      testCommand: 'pnpm test',
    },
  ],
  members: [
    {
      id: 'u-remote',
      name: 'Remote Lead',
      role: 'lead',
      avatarInitials: 'RL',
      focus: 'Delivery',
    },
  ],
  runs: [],
  projectCost: [],
  memberCost: [],
  totalCost: '$0.000',
}

const runsBundle = {
  runs: [
    {
      id: 'run-remote',
      title: 'Remote run',
      request: 'Loaded from API.',
      projectId: 'p-remote',
      creatorId: 'u-remote',
      status: 'building',
      currentNodeId: 'n-build',
      branchName: 'ai/remote-run',
      createdAt: '2026-06-16T00:00:00.000Z',
      updatedAt: '2026-06-16T00:05:00.000Z',
      nodes: [],
      edges: [],
    },
  ],
  artifacts: [],
  events: [],
}

const runSummary: RemoteRunSummary = {
  kind: 'approval',
  runId: 'run-remote',
  projectId: 'p-remote',
  title: 'Remote run',
  status: 'building',
  currentNodeId: 'n-build',
  branchName: 'ai/remote-run',
  updatedAt: '2026-06-16T00:05:00.000Z',
}

const evidenceSummary: RemoteTestEvidenceSummary = {
  id: 'evidence-remote',
  runId: 'run-remote',
  nodeId: 'n-test',
  projectId: 'p-remote',
  command: 'pnpm test',
  status: 'passed',
  exitCode: 0,
  durationMs: 500,
  summary: 'Tests passed',
  redacted: true,
  createdAt: '2026-06-16T00:08:00.000Z',
}

describe('Electron remote sync client', () => {
  it('resolves remote API base URL from env with a local default', () => {
    expect(resolveRemoteApiBaseUrl({ DEVFLOW_API_BASE_URL: 'http://team-api:4310/' })).toBe(
      'http://team-api:4310',
    )
    expect(resolveRemoteApiBaseUrl({})).toBe('http://127.0.0.1:4310')
  })

  it('loads a remote team snapshot by combining overview and run bundle API responses', async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input)
      if (url.includes('/api/team/overview')) {
        return new Response(JSON.stringify(overview), { status: 200 })
      }

      return new Response(JSON.stringify(runsBundle), { status: 200 })
    })
    const client = createRemoteSyncClient({ apiBaseUrl: 'http://api.local', fetcher })

    await expect(client.loadRemoteSnapshot({ organizationId: 'org-1' })).resolves.toEqual({
      ...overview,
      runs: runsBundle.runs,
      artifacts: [],
      events: [],
    })
    expect(fetcher).toHaveBeenCalledWith('http://api.local/api/team/overview?organizationId=org-1', {
      headers: {
        accept: 'application/json',
        'x-devflow-organization-id': 'org-1',
        'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
        'x-devflow-user-id': 'u-erich',
        'x-devflow-user-role': 'owner',
      },
    })
    expect(fetcher).toHaveBeenCalledWith('http://api.local/api/runs?organizationId=org-1', {
      headers: {
        accept: 'application/json',
        'x-devflow-organization-id': 'org-1',
        'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
        'x-devflow-user-id': 'u-erich',
        'x-devflow-user-role': 'owner',
      },
    })
  })

  it('uploads run and test evidence summaries without local-only raw evidence fields', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return (
      new Response(
        JSON.stringify({
          accepted: true,
          syncedAt: '2026-06-16T00:09:00.000Z',
          message: 'accepted',
        }),
        { status: 202 },
      )
      )
    })
    const client = createRemoteSyncClient({ apiBaseUrl: 'http://api.local', fetcher })

    await expect(client.uploadRunSummary(runSummary)).resolves.toMatchObject({ accepted: true })
    await expect(client.uploadTestEvidenceSummary(evidenceSummary)).resolves.toMatchObject({
      accepted: true,
    })

    const uploadedBodies = calls.map(({ init }) => JSON.parse(String(init?.body)))
    expect(uploadedBodies[1]).toEqual(evidenceSummary)
    expect(calls[0]?.init?.headers).toMatchObject({
      'x-devflow-organization-id': 'org-demo',
      'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
      'x-devflow-user-id': 'u-erich',
      'x-devflow-user-role': 'owner',
    })
    expect(JSON.stringify(uploadedBodies[1])).not.toContain('stdout')
    expect(JSON.stringify(uploadedBodies[1])).not.toContain('stderr')
    expect(JSON.stringify(uploadedBodies[1])).not.toContain('cwd')
  })
})
