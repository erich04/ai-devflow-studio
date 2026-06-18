import { describe, expect, it, vi } from 'vitest'
import type {
  RemoteAgentReviewSummary,
  RemoteCodingAgentSummary,
  GateOverrideDecision,
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

const agentReviewSummary: RemoteAgentReviewSummary = {
  id: 'agent-review-remote',
  runId: 'run-remote',
  nodeId: 'n-design-gate',
  projectId: 'p-remote',
  runtime: 'electron',
  providerId: 'fake-knowledge-review',
  model: 'fake',
  conclusion: 'Knowledge review completed.',
  summary: 'Warning-only advisory generated.',
  riskCount: 1,
  missingEvidenceCount: 1,
  advisoryLevel: 'warn',
  blocksApproval: false,
  confidence: 0.82,
  redacted: true,
  createdAt: '2026-06-16T00:10:00.000Z',
}

const codingAgentSummary: RemoteCodingAgentSummary = {
  id: 'coding-run-remote',
  runId: 'run-remote',
  nodeId: 'n-build',
  projectId: 'p-remote',
  requestedBy: 'u-remote',
  providerId: 'fake-coding-engine',
  engine: 'fake',
  status: 'completed',
  branchName: 'devflow/run-remote-n-build',
  summary: 'Coding agent completed with a redacted diff summary.',
  changedPaths: ['src/export.ts'],
  startedAt: '2026-06-16T00:11:00.000Z',
  completedAt: '2026-06-16T00:12:00.000Z',
  redacted: true,
}

const gateOverride: GateOverrideDecision = {
  id: 'gate-override-remote',
  runId: 'run-remote',
  nodeId: 'n-design-gate',
  projectId: 'p-remote',
  userId: 'u-remote',
  role: 'lead',
  reason: 'Reviewed missing evidence and approved a temporary exception.',
  blockedReasonIds: ['missing_agent_review:protected_gate:missing'],
  policyVersion: 2,
  provisional: false,
  status: 'accepted',
  createdAt: '2026-06-16T00:13:00.000Z',
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

  it('uploads run, test evidence, agent review, and coding agent summaries without local-only raw fields', async () => {
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
    await expect(client.uploadAgentReviewSummary(agentReviewSummary)).resolves.toMatchObject({
      accepted: true,
    })
    await expect(client.uploadCodingAgentSummary(codingAgentSummary)).resolves.toMatchObject({
      accepted: true,
    })

    const uploadedBodies = calls.map(({ init }) => JSON.parse(String(init?.body)))
    expect(uploadedBodies[1]).toEqual(evidenceSummary)
    expect(uploadedBodies[2]).toEqual(agentReviewSummary)
    expect(uploadedBodies[3]).toEqual(codingAgentSummary)
    expect(calls[0]?.init?.headers).toMatchObject({
      'x-devflow-organization-id': 'org-demo',
      'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
      'x-devflow-user-id': 'u-erich',
      'x-devflow-user-role': 'owner',
    })
    expect(JSON.stringify(uploadedBodies[1])).not.toContain('stdout')
    expect(JSON.stringify(uploadedBodies[1])).not.toContain('stderr')
    expect(JSON.stringify(uploadedBodies[1])).not.toContain('cwd')
    expect(JSON.stringify(uploadedBodies[2])).not.toContain('trace')
    expect(JSON.stringify(uploadedBodies[2])).not.toContain('prompt')
    expect(JSON.stringify(uploadedBodies[2])).not.toContain('cwd')
    expect(JSON.stringify(uploadedBodies[3])).not.toContain('patch')
    expect(JSON.stringify(uploadedBodies[3])).not.toContain('stdout')
    expect(JSON.stringify(uploadedBodies[3])).not.toContain('stderr')
    expect(JSON.stringify(uploadedBodies[3])).not.toContain('cwd')
  })

  it('submits Gate overrides through the enforcement API using the override actor session', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(JSON.stringify(gateOverride), { status: 201 })
    })
    const client = createRemoteSyncClient({ apiBaseUrl: 'http://api.local', fetcher })

    await expect(client.saveGateOverride({
      runId: gateOverride.runId,
      nodeId: gateOverride.nodeId,
      projectId: gateOverride.projectId,
      userId: gateOverride.userId,
      role: gateOverride.role,
      reason: gateOverride.reason,
      blockedReasonIds: gateOverride.blockedReasonIds,
      policyVersion: gateOverride.policyVersion,
    })).resolves.toEqual(gateOverride)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('http://api.local/api/gates/override')
    expect(calls[0]?.init?.headers).toMatchObject({
      'x-devflow-organization-id': 'org-demo',
      'x-devflow-project-roles': 'p-remote:lead',
      'x-devflow-user-id': 'u-remote',
      'x-devflow-user-role': 'lead',
    })
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      runId: gateOverride.runId,
      nodeId: gateOverride.nodeId,
      projectId: gateOverride.projectId,
      reason: gateOverride.reason,
      blockedReasonIds: gateOverride.blockedReasonIds,
      policyVersion: gateOverride.policyVersion,
    })
  })
})
