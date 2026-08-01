import { describe, expect, it, vi } from 'vitest'
import type {
  DevFlowSessionHeaders,
  RemoteAgentReviewSummary,
  RemoteCodingAgentSummary,
  GateOverrideDecision,
  RemoteRunSummary,
  RemoteTestEvidenceSummary,
} from '@ai-devflow/shared'
import {
  createRemoteSyncClient,
  RemoteSyncHttpError,
  resolveRemoteApiBaseUrl,
} from './remote-sync'

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
  currentNode: {
    id: 'n-build',
    stage: 'build',
    kind: 'task',
    status: 'running',
  },
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

const authenticatedSessionHeaders: DevFlowSessionHeaders = {
  'x-devflow-session-source': 'authenticated',
  'x-devflow-organization-id': 'org-1',
  'x-devflow-user-id': 'u-remote',
  'x-devflow-user-role': 'lead',
  'x-devflow-auth-account-id': 'acct-remote',
  'x-devflow-project-roles': 'p-remote:lead',
}

describe('Electron remote sync client', () => {
  it('resolves remote API base URL from env with a local default', () => {
    expect(resolveRemoteApiBaseUrl({ DEVFLOW_API_BASE_URL: 'http://team-api:4310/' })).toBe(
      'http://team-api:4310',
    )
    expect(resolveRemoteApiBaseUrl({})).toBe('http://127.0.0.1:4310')
  })

  it('loads a remote team snapshot by combining overview and run bundle API responses', async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
      const url = String(input)
      if (url.includes('/api/team/overview')) {
        return new Response(JSON.stringify(overview), { status: 200 })
      }

      return new Response(JSON.stringify(runsBundle), { status: 200 })
    })
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      sessionHeaders: authenticatedSessionHeaders,
    })

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
        'x-devflow-session-source': 'authenticated',
        'x-devflow-project-roles': 'p-remote:lead',
        'x-devflow-user-id': 'u-remote',
        'x-devflow-user-role': 'lead',
        'x-devflow-auth-account-id': 'acct-remote',
      },
    })
    expect(fetcher).toHaveBeenCalledWith('http://api.local/api/runs?organizationId=org-1', {
      headers: {
        accept: 'application/json',
        'x-devflow-organization-id': 'org-1',
        'x-devflow-session-source': 'authenticated',
        'x-devflow-project-roles': 'p-remote:lead',
        'x-devflow-user-id': 'u-remote',
        'x-devflow-user-role': 'lead',
        'x-devflow-auth-account-id': 'acct-remote',
      },
    })
  })

  it('does not send remote requests when no paired token or explicit session headers exist', async () => {
    const fetcher = vi.fn()
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
    })

    await expect(client.loadRemoteSnapshot()).rejects.toThrow(
      'Pair DevFlow Studio with a Team Project before syncing remote team state.',
    )
    await expect(client.uploadRunSummary(runSummary)).rejects.toThrow(
      'Pair DevFlow Studio with a Team Project before syncing remote team state.',
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses a bearer token instead of demo session headers when an authenticated desktop token is configured', async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
      const url = String(input)
      if (url.includes('/api/team/overview')) {
        return new Response(JSON.stringify(overview), { status: 200 })
      }

      return new Response(JSON.stringify(runsBundle), { status: 200 })
    })
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'devflow_desktop_token_123',
    })

    await client.loadRemoteSnapshot({ organizationId: 'org-1' })

    const headers = fetcher.mock.calls.map(([, init]) => init?.headers)
    expect(headers).toEqual([
      {
        accept: 'application/json',
        authorization: 'Bearer devflow_desktop_token_123',
      },
      {
        accept: 'application/json',
        authorization: 'Bearer devflow_desktop_token_123',
      },
    ])
    expect(JSON.stringify(headers)).not.toContain('x-devflow-user-id')
    expect(JSON.stringify(headers)).not.toContain('x-devflow-user-role')
    expect(JSON.stringify(headers)).not.toContain('x-devflow-project-roles')
  })

  it('does not fall back to demo headers when an authenticated desktop token is rejected', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'Desktop pairing expired. Reconnect DevFlow Studio.' }), {
        status: 401,
      }),
    )
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'expired_desktop_token',
    })

    await expect(client.uploadRunSummary(runSummary)).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
      path: '/api/sync/run-summary',
      retryable: false,
    })
    expect(fetcher).toHaveBeenCalledWith('http://api.local/api/sync/run-summary', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: 'Bearer expired_desktop_token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(runSummary),
    })
  })

  it('reports HTTP failures with safe structured metadata instead of the remote response message', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: 'hostile-code',
          message:
            'Bearer desktop-secret API_KEY=provider-secret failed at /Users/alice/private/repo',
        }),
        {
          status: 403,
          headers: { 'set-cookie': 'session=server-cookie-secret' },
        },
      ),
    )
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'desktop-secret',
    })

    const error = await client.uploadRunSummary(runSummary).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(RemoteSyncHttpError)
    expect(error).toMatchObject({
      status: 403,
      code: 'forbidden',
      path: '/api/sync/run-summary',
      retryable: false,
    })
    expect(String(error)).toBe('RemoteSyncHttpError: Remote sync request failed (HTTP 403, forbidden).')
    expect(String(error)).not.toMatch(
      /desktop-secret|provider-secret|server-cookie-secret|\/Users\/alice|Bearer|API_KEY/,
    )
  })

  it('classifies bad requests from status without trusting the body error code', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify({ error: 'hostile-code', message: 'bad secret body' }), {
          status: 400,
        }),
      ),
      authToken: 'desktop-secret',
    })

    await expect(client.uploadRunSummary(runSummary)).rejects.toMatchObject({
      status: 400,
      code: 'bad_request',
      retryable: false,
    })
  })

  it('classifies missing remote resources from status without copying the response body', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify({ message: '/Users/alice/private API_KEY=secret' }), {
          status: 404,
        }),
      ),
      authToken: 'desktop-secret',
    })

    const error = await client.uploadRunSummary(runSummary).catch((reason: unknown) => reason)
    expect(error).toMatchObject({ status: 404, code: 'not_found', retryable: false })
    expect(String(error)).not.toMatch(/\/Users\/alice|API_KEY|secret/)
  })

  it('reports network failures as safe retryable unavailable errors', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal)
      throw new Error(
        'fetch Bearer desktop-secret failed for /Users/alice/private/repo?api_key=provider-secret',
      )
    })
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'desktop-secret',
      signal: controller.signal,
    })

    const error = await client.uploadRunSummary(runSummary).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(RemoteSyncHttpError)
    expect(error).toMatchObject({
      status: null,
      code: 'remote_unavailable',
      path: '/api/sync/run-summary',
      retryable: true,
    })
    expect(String(error)).toBe(
      'RemoteSyncHttpError: Remote sync request failed (unavailable, remote_unavailable).',
    )
    expect(String(error)).not.toMatch(/desktop-secret|provider-secret|\/Users\/alice|Bearer|api_key/)
  })

  it('classifies an aborted summary upload as a safe retryable timeout', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal)
      controller.abort('Bearer abort-secret for http://api.local/private-body')
      throw new DOMException('aborted with private request data', 'AbortError')
    })
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'desktop-secret',
      signal: controller.signal,
    })

    const error = await client.uploadRunSummary(runSummary).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(RemoteSyncHttpError)
    expect(error).toMatchObject({
      status: null,
      code: 'request_timeout',
      path: '/api/sync/run-summary',
      retryable: true,
    })
    expect(String(error)).toBe(
      'RemoteSyncHttpError: Remote sync request failed (unavailable, request_timeout).',
    )
    expect(String(error)).not.toMatch(/abort-secret|api\.local|private-body|desktop-secret/)
  })

  it('classifies transient HTTP failures as retryable without trusting their body', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: 'service_unavailable',
            message: 'upstream at /Users/alice/private Bearer server-secret is down',
          }),
          { status: 503 },
        ),
      ),
      authToken: 'desktop-secret',
    })

    await expect(client.uploadTestEvidenceSummary(evidenceSummary)).rejects.toMatchObject({
      status: 503,
      code: 'service_unavailable',
      path: '/api/sync/test-evidence-summary',
      retryable: true,
    })
  })

  it.each([500, 501, 502, 503, 504, 599])(
    'classifies HTTP %i as a retryable service failure',
    async (status) => {
      const client = createRemoteSyncClient({
        apiBaseUrl: 'http://api.local',
        fetcher: vi.fn(async () => new Response('non-json body secret', { status })),
        authToken: 'desktop-secret',
      })

      await expect(client.uploadRunSummary(runSummary)).rejects.toMatchObject({
        status,
        code: 'service_unavailable',
        retryable: true,
      })
    },
  )

  it('classifies rate limiting as retryable from the HTTP status alone', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify({ error: 'hostile-code', message: 'try later' }), {
          status: 429,
        }),
      ),
      authToken: 'desktop-secret',
    })

    await expect(client.uploadAgentReviewSummary(agentReviewSummary)).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
      path: '/api/sync/agent-review-summary',
      retryable: true,
    })
  })

  it('classifies HTTP request timeouts as retryable', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () => new Response('upstream timeout secret', { status: 408 })),
      authToken: 'desktop-secret',
    })

    await expect(client.uploadRunSummary(runSummary)).rejects.toMatchObject({
      status: 408,
      code: 'request_timeout',
      retryable: true,
    })
  })

  it('classifies only the canonical-missing conflict needed for child-first recovery', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: 'conflict',
            message:
              'Canonical Run Summary is required before evidence sync: run-private (project-private)',
          }),
          { status: 409 },
        ),
      ),
      authToken: 'desktop-secret',
    })

    const error = await client
      .uploadTestEvidenceSummary(evidenceSummary)
      .catch((reason: unknown) => reason)

    expect(error).toMatchObject({
      status: 409,
      code: 'canonical_run_required',
      path: '/api/sync/test-evidence-summary',
      retryable: false,
    })
    expect(String(error)).not.toMatch(/run-private|project-private/)
  })

  it('keeps non-canonical conflicts terminal even when their message resembles recovery text', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: 'conflict',
            message:
              'Canonical Run Summary is required before evidence sync: attacker-controlled',
          }),
          { status: 409 },
        ),
      ),
      authToken: 'desktop-secret',
    })

    await expect(client.uploadCodingAgentSummary(codingAgentSummary)).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
      path: '/api/sync/coding-agent-summary',
      retryable: false,
    })
  })

  it('maps a malformed successful response to a safe retryable invalid-response error', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response('Bearer body-secret /Users/alice/private API_KEY=provider-secret', {
          status: 202,
        }),
      ),
      authToken: 'desktop-secret',
    })

    const error = await client.uploadRunSummary(runSummary).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(RemoteSyncHttpError)
    expect(error).toMatchObject({
      status: 202,
      code: 'invalid_response',
      path: '/api/sync/run-summary',
      retryable: true,
    })
    expect(String(error)).not.toMatch(/body-secret|provider-secret|\/Users\/alice|Bearer|API_KEY/)
  })

  it('rejects malformed JSON upload results through the shared Run and child upload path', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () => new Response(JSON.stringify({}), { status: 202 })),
      authToken: 'desktop-secret',
    })

    await expect(client.uploadRunSummary(runSummary)).rejects.toMatchObject({
      status: 202,
      code: 'invalid_response',
      path: '/api/sync/run-summary',
      retryable: true,
    })
    await expect(client.uploadTestEvidenceSummary(evidenceSummary)).rejects.toMatchObject({
      status: 202,
      code: 'invalid_response',
      path: '/api/sync/test-evidence-summary',
      retryable: true,
    })
  })

  it('uses the same safe unavailable error for snapshot GET failures', async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      if (String(input).includes('/api/team/overview')) {
        throw new Error('request failed with Cookie=session-secret at C:\\Users\\alice\\repo')
      }
      return new Response(JSON.stringify(runsBundle), { status: 200 })
    })
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'desktop-secret',
    })

    await expect(client.loadRemoteSnapshot()).rejects.toMatchObject({
      status: null,
      code: 'remote_unavailable',
      path: '/api/team/overview',
      retryable: true,
    })
  })

  it('classifies aborted snapshot GET requests with the captured client signal', async () => {
    const controller = new AbortController()
    controller.abort('Cookie=session-secret for http://api.local/private-snapshot')
    const observedSignals: Array<AbortSignal | null | undefined> = []
    const fetcher = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      observedSignals.push(init?.signal)
      throw new DOMException('aborted snapshot with private URL', 'AbortError')
    })
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'desktop-secret',
      signal: controller.signal,
    })

    const error = await client.loadRemoteSnapshot().catch((reason: unknown) => reason)

    expect(error).toMatchObject({
      status: null,
      code: 'request_timeout',
      path: '/api/team/overview',
      retryable: true,
    })
    expect(observedSignals).toHaveLength(2)
    expect(observedSignals.every((signal) => signal === controller.signal)).toBe(true)
    expect(String(error)).not.toMatch(/session-secret|api\.local|private-snapshot|desktop-secret/)
  })

  it('exchanges a desktop pairing code without sending demo session headers', async () => {
    const exchangeResult = {
      token: 'devflow-desktop-token-copy-once',
      tokenId: 'desktop-token-1',
      organizationId: 'org-demo',
      projectId: 'p-payments',
      userId: 'u-ling',
      role: 'lead',
      authAccountId: 'acct-ling',
      projectMemberships: [{ projectId: 'p-payments', userId: 'u-ling', role: 'lead' }],
      createdAt: '2026-06-20T00:00:00.000Z',
    }
    const fetcher = vi.fn(async () => new Response(JSON.stringify(exchangeResult), { status: 201 }))
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      sessionHeaders: authenticatedSessionHeaders,
    })

    await expect(client.exchangeDesktopPairingCode({ code: 'pair.code-secret' })).resolves.toEqual(
      exchangeResult,
    )
    expect(fetcher).toHaveBeenCalledWith('http://api.local/api/desktop/pairing/exchange', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ code: 'pair.code-secret' }),
    })
  })

  it('classifies an aborted pairing POST with the captured client signal', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal)
      controller.abort('pair.secret-body at http://api.local/private-pairing')
      throw new DOMException('aborted pairing request with private data', 'AbortError')
    })
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      sessionHeaders: authenticatedSessionHeaders,
      signal: controller.signal,
    })

    const error = await client
      .exchangeDesktopPairingCode({ code: 'pair.secret-body' })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(RemoteSyncHttpError)
    expect(error).toMatchObject({
      status: null,
      code: 'request_timeout',
      path: '/api/desktop/pairing/exchange',
      retryable: true,
    })
    expect(String(error)).toBe(
      'RemoteSyncHttpError: Remote sync request failed (unavailable, request_timeout).',
    )
    expect(String(error)).not.toMatch(/pair\.secret-body|api\.local|private-pairing|session-secret/)
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
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      sessionHeaders: authenticatedSessionHeaders,
    })

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
      'x-devflow-organization-id': 'org-1',
      'x-devflow-session-source': 'authenticated',
      'x-devflow-project-roles': 'p-remote:lead',
      'x-devflow-user-id': 'u-remote',
      'x-devflow-user-role': 'lead',
      'x-devflow-auth-account-id': 'acct-remote',
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

  it('treats remote run deletion not found as success-equivalent', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'Run not found' }), { status: 404 }),
    )
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'devflow_desktop_token_123',
    })

    await expect(client.deleteRun({ runId: 'run-missing' })).resolves.toMatchObject({
      deleted: false,
      message: 'remote run not found',
    })
    expect(fetcher).toHaveBeenCalledWith('http://api.local/api/runs/run-missing', {
      method: 'DELETE',
      headers: {
        accept: 'application/json',
        authorization: 'Bearer devflow_desktop_token_123',
      },
    })
  })

  it('reports delete network failures without exposing the requested Run ID', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network failed with Bearer desktop-secret')
    })
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'desktop-secret',
    })

    const error = await client
      .deleteRun({ runId: 'run-secret-customer-name' })
      .catch((reason: unknown) => reason)

    expect(error).toMatchObject({
      status: null,
      code: 'remote_unavailable',
      path: '/api/runs/:runId',
      retryable: true,
    })
    expect(String(error)).not.toContain('run-secret-customer-name')
  })

  it('submits Gate overrides using the authenticated session without renderer actor overrides', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(JSON.stringify(gateOverride), { status: 201 })
    })
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      sessionHeaders: authenticatedSessionHeaders,
    })

    await expect(client.saveGateOverride({
      runId: gateOverride.runId,
      nodeId: gateOverride.nodeId,
      projectId: gateOverride.projectId,
      reason: gateOverride.reason,
      blockedReasonIds: gateOverride.blockedReasonIds,
      policyVersion: gateOverride.policyVersion,
    })).resolves.toEqual(gateOverride)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('http://api.local/api/gates/override')
    expect(calls[0]?.init?.headers).toMatchObject({
      'x-devflow-organization-id': 'org-1',
      'x-devflow-session-source': 'authenticated',
      'x-devflow-project-roles': 'p-remote:lead',
      'x-devflow-user-id': 'u-remote',
      'x-devflow-user-role': 'lead',
      'x-devflow-auth-account-id': 'acct-remote',
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

  it('evaluates runtime budget through the team API without sending local-only context', async () => {
    const decision = {
      status: 'requires_lead_approval',
      blocksRun: true,
      currentSpendUsd: 0.019,
      projectedCostUsd: 0.004,
      limitUsd: 0.02,
      approvalRequiredRole: 'lead',
      reason: 'Project runtime budget would be exceeded.',
    }
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(input), init })
      const request = JSON.parse(String(init?.body)) as { projectedCostUsd: number }
      return new Response(JSON.stringify({ ...decision, projectedCostUsd: request.projectedCostUsd }), { status: 200 })
    })
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'devflow_desktop_token_123',
    })

    await expect(
      client.evaluateRuntimeBudget({
        projectId: 'p-remote',
        providerId: 'double',
        projectedCostUsd: 0.004,
      }),
    ).resolves.toEqual(decision)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('http://api.local/api/runtime/budget/evaluate')
    expect(calls[0]?.init?.headers).toEqual({
      accept: 'application/json',
      authorization: 'Bearer devflow_desktop_token_123',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      projectId: 'p-remote',
      providerId: 'double',
      projectedCostUsd: 0.004,
    })
    expect(String(calls[0]?.init?.body)).not.toContain('prompt')
    expect(String(calls[0]?.init?.body)).not.toContain('cwd')
    expect(String(calls[0]?.init?.body)).not.toContain('stdout')
    expect(String(calls[0]?.init?.body)).not.toContain('stderr')

    await client.evaluateRuntimeBudget({
      projectId: 'p-remote',
      providerId: 'double',
      projectedCostUsd: 0.006,
      approvalId: 'runtime-budget-approval-1',
    })
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      projectId: 'p-remote',
      providerId: 'double',
      projectedCostUsd: 0.006,
      approvalId: 'runtime-budget-approval-1',
    })
  })

  it('rejects a malformed successful runtime budget response', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify({
          status: 'disabled',
          blocksRun: false,
          reason: 'Missing authoritative spend fields.',
        }), { status: 200 }),
      ),
      authToken: 'devflow_desktop_token_123',
    })

    await expect(client.evaluateRuntimeBudget({
      projectId: 'p-remote',
      providerId: 'double',
      projectedCostUsd: 0.004,
    })).rejects.toThrow('Invalid runtime budget decision')
  })

  it('rejects a fail-open runtime budget response with contradictory status and blocking fields', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify({
          status: 'unavailable',
          blocksRun: false,
          currentSpendUsd: 0,
          projectedCostUsd: 0.004,
          reason: 'Budget authority could not be reached.',
        }), { status: 200 }),
      ),
      authToken: 'devflow_desktop_token_123',
    })

    await expect(client.evaluateRuntimeBudget({
      projectId: 'p-remote',
      providerId: 'double',
      projectedCostUsd: 0.004,
    })).rejects.toThrow('Invalid runtime budget decision')
  })

  it('rejects an over-budget approval response without an auditable approval ID', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify({
          status: 'approved_over_budget',
          blocksRun: false,
          currentSpendUsd: 0.02,
          projectedCostUsd: 0.004,
          limitUsd: 0.02,
          reason: 'Approved to continue over budget.',
        }), { status: 200 }),
      ),
      authToken: 'devflow_desktop_token_123',
    })

    await expect(client.evaluateRuntimeBudget({
      projectId: 'p-remote',
      providerId: 'double',
      projectedCostUsd: 0.004,
    })).rejects.toThrow('Invalid runtime budget decision')
  })

  it('rejects a runtime budget response for a different projected cost', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify({
          status: 'allowed',
          blocksRun: false,
          currentSpendUsd: 0,
          projectedCostUsd: 0.001,
          limitUsd: 1,
          reason: 'A decision for a different estimate must not authorize this request.',
        }), { status: 200 }),
      ),
      authToken: 'devflow_desktop_token_123',
    })

    await expect(client.evaluateRuntimeBudget({
      projectId: 'p-remote',
      providerId: 'double',
      projectedCostUsd: 0.004,
    })).rejects.toThrow('Invalid runtime budget decision')
  })
})
