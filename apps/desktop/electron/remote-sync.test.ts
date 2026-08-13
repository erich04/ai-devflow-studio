import { describe, expect, it, vi } from 'vitest'
import type {
  ClaimWorkRequestInput,
  CreateGateCommandAcknowledgementInput,
  DesktopPairingCredential,
  DevFlowSessionHeaders,
  GateCommand,
  GateCommandAcknowledgement,
  GateCommandReceipt,
  MaterializeWorkRequestInput,
  RemoteAgentReviewSummary,
  RemoteCodingAgentSummary,
  GateOverrideDecision,
  RemoteRunSummary,
  RemoteTestEvidenceSummary,
  WorkRequest,
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
  version: 2,
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

  it('uploads a Team Agent Runtime summary through the exact safe endpoint', async () => {
    const summary = {
      stateVersion: 1 as const,
      projectionVersion: 1 as const,
      runtimeId: 'agent-runtime-team-1',
      projectId: 'team-project-1',
      runId: 'run-1',
      nodeId: 'node-1',
      runtimeVersion: 2,
      checkpointVersion: 2,
      status: 'running' as const,
      stopReason: null,
      counters: { steps: 1, toolCalls: 0, tokens: 10, costUsd: 0.01 },
      acceptedActionCount: 1,
      contextDigest: 'a'.repeat(64),
      capabilitySetDigest: 'b'.repeat(64),
      lastObservationDigest: 'c'.repeat(64),
      lastResultDigest: null,
      startedAt: '2026-08-12T20:00:00.000Z',
      updatedAt: '2026-08-12T20:00:01.000Z',
      redacted: true as const,
    }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      accepted: true,
      syncedAt: '2026-08-12T20:00:02.000Z',
      message: 'accepted',
    }), { status: 202 }))
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'desktop-secret',
    })

    await expect(client.uploadAgentRuntimeSummary(summary)).resolves.toMatchObject({ accepted: true })
    expect(fetcher).toHaveBeenCalledWith(
      'http://api.local/api/sync/agent-runtime-summary',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(summary),
        headers: expect.objectContaining({ authorization: 'Bearer desktop-secret' }),
      }),
    )
  })

  it('uploads a metadata-only Team Agent Memory summary through the exact safe endpoint', async () => {
    const summary = {
      stateVersion: 1 as const,
      projectionVersion: 1 as const,
      memoryId: 'agent-memory-team-1',
      projectId: 'team-project-1',
      runId: 'run-1',
      nodeId: 'node-1',
      runtimeId: 'agent-runtime-team-1',
      ownerUserId: 'user-1',
      candidateId: 'agent-memory-candidate-team-1',
      currentRevision: 1,
      headVersion: 1,
      qualityVersion: 2,
      lifecycleStatus: 'active' as const,
      visibility: 'user_project' as const,
      sensitivity: 'private' as const,
      retentionClass: 'until_deleted' as const,
      provenanceDigest: 'a'.repeat(64),
      citationIds: ['citation-a'],
      retrievalCount: 1,
      acceptedContextCount: 1,
      expiresAt: null,
      deletedAt: null,
      purgeStatus: null,
      purgedAt: null,
      updatedAt: '2026-08-13T12:00:01.000Z',
      redacted: true as const,
    }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      accepted: true,
      syncedAt: '2026-08-13T12:00:02.000Z',
      message: 'accepted',
    }), { status: 202 }))
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'desktop-secret',
    })

    await expect(client.uploadAgentMemorySummary(summary)).resolves.toMatchObject({ accepted: true })
    expect(fetcher).toHaveBeenCalledWith(
      'http://api.local/api/sync/agent-memory-summary',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(summary),
        headers: expect.objectContaining({ authorization: 'Bearer desktop-secret' }),
      }),
    )
  })

  it('uploads a metadata-only Team Agent Coordination summary through the exact safe endpoint', async () => {
    const summary = {
      stateVersion: 1 as const,
      projectionVersion: 1 as const,
      coordinationId: 'coordination-team-1',
      projectId: 'team-project-1',
      runId: 'run-team-1',
      nodeId: 'run-team-1-build',
      coordinationVersion: 2,
      graphVersion: 1,
      status: 'running' as const,
      stopReason: null,
      roleCounts: [{ roleId: 'contract-reviewer', count: 1 }],
      taskStatusCounts: {
        pending: 0, ready: 0, running: 1, succeeded: 0, failed: 0, cancelled: 0, blocked: 0,
      },
      failureCategoryCounts: {
        timeout: 0, budget_exhausted: 0, policy_denied: 0, tool_error: 0,
        coding_executor_error: 0, invalid_result: 0, dependency_failed: 0,
      },
      taskCount: 1,
      edgeCount: 0,
      specialistStarts: 1,
      acceptedHandoffCount: 0,
      retryCount: 0,
      stepCount: 0,
      toolCallCount: 0,
      tokenCount: 0,
      costUsd: 0,
      singleAgentQuality: null,
      coordinationQuality: null,
      latencyMs: 1_000,
      humanInterventionCount: 0,
      authorityViolationCount: 0,
      isolationViolationCount: 0,
      terminationViolationCount: 0,
      replayViolationCount: 0,
      redactionViolationCount: 0,
      updatedAt: '2026-08-13T12:00:01.000Z',
      isolated: true as const,
      redacted: true as const,
    }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      accepted: true,
      syncedAt: '2026-08-13T12:00:02.000Z',
      message: 'accepted',
    }), { status: 202 }))
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'desktop-secret',
    })

    await expect(client.uploadAgentCoordinationSummary(summary)).resolves.toMatchObject({
      accepted: true,
    })
    expect(fetcher).toHaveBeenCalledWith(
      'http://api.local/api/sync/agent-coordination-summary',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(summary),
        headers: expect.objectContaining({ authorization: 'Bearer desktop-secret' }),
      }),
    )
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

const workRequestPairing: DesktopPairingCredential = {
  tokenId: 'desktop-token-record-1',
  organizationId: 'org-1',
  projectId: 'p-remote',
  localProjectId: 'local-project-1',
  userId: 'u-remote',
  role: 'lead',
  authAccountId: 'acct-remote',
  projectMemberships: [
    { projectId: 'p-remote', userId: 'u-remote', role: 'lead' },
  ],
  createdAt: '2026-08-01T00:00:00.000Z',
}

const openRemoteWorkRequest: WorkRequest = {
  id: 'wr-rollout',
  organizationId: 'org-1',
  projectId: 'p-remote',
  title: 'Prepare rollout',
  request: 'Keep the rollout reversible.',
  version: 1,
  status: 'open',
  createdByUserId: 'u-remote',
  claim: null,
  expiresAt: null,
  createdAt: '2026-08-01T01:00:00.000Z',
  updatedAt: '2026-08-01T01:00:00.000Z',
}

const claimedRemoteWorkRequest: WorkRequest = {
  ...openRemoteWorkRequest,
  version: 2,
  status: 'claim_pending',
  claim: {
    runId: 'run-rollout',
    claimedAt: '2026-08-01T01:01:00.000Z',
    materializedAt: null,
  },
  updatedAt: '2026-08-01T01:01:00.000Z',
}

const materializedRemoteWorkRequest: WorkRequest = {
  ...claimedRemoteWorkRequest,
  version: 3,
  status: 'materialized',
  claim: {
    ...claimedRemoteWorkRequest.claim!,
    materializedAt: '2026-08-01T01:02:00.000Z',
  },
  updatedAt: '2026-08-01T01:02:00.000Z',
}

const claimInput: ClaimWorkRequestInput = {
  workRequestId: 'wr-rollout',
  expectedVersion: 1,
  runId: 'run-rollout',
  idempotencyKey: 'claim:wr-rollout:run-rollout',
}

const materializeInput: MaterializeWorkRequestInput = {
  workRequestId: 'wr-rollout',
  expectedVersion: 2,
  runId: 'run-rollout',
  idempotencyKey: 'materialize:wr-rollout:run-rollout',
}

describe('Electron Work Request remote client', () => {
  it('lists only server-filtered, resumable desktop Work Request states with paired Bearer auth', async () => {
    const listedWorkRequests = [
      { ...openRemoteWorkRequest, id: 'wr-open' },
      { ...claimedRemoteWorkRequest, id: 'wr-recoverable' },
      { ...materializedRemoteWorkRequest, id: 'wr-materialized' },
    ]
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          workRequests: listedWorkRequests,
        }),
        { status: 200 },
      ),
    )
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'paired-bearer-secret',
      sessionHeaders: authenticatedSessionHeaders,
    })

    await expect(
      client.listWorkRequests('p-remote', workRequestPairing),
    ).resolves.toEqual(listedWorkRequests)
    expect(fetcher).toHaveBeenCalledWith(
      'http://api.local/api/team/projects/p-remote/work-requests',
      {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer paired-bearer-secret',
        },
      },
    )
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('x-devflow-user-id')
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('desktop-token-record-1')
  })

  it('claims with an exact shared input body and validates the canonical transition', async () => {
    const fetcher = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) => new Response(
        JSON.stringify({
          workRequest: claimedRemoteWorkRequest,
          replayed: false,
          outcomeCode: 'claimed',
        }),
        { status: 200 },
      ),
    )
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.claimWorkRequest(claimInput, workRequestPairing),
    ).resolves.toEqual({
      workRequest: claimedRemoteWorkRequest,
      replayed: false,
      outcomeCode: 'claimed',
    })
    expect(fetcher).toHaveBeenCalledWith(
      'http://api.local/api/desktop/work-requests/wr-rollout/claim',
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer paired-bearer-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify(claimInput),
      },
    )
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).not.toContain('token')
  })

  it('materializes with an exact shared input body and validates run, version, and status', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          workRequest: materializedRemoteWorkRequest,
          replayed: true,
          outcomeCode: 'materialized',
        }),
        { status: 200 },
      ),
    )
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.materializeWorkRequest(materializeInput, workRequestPairing),
    ).resolves.toEqual({
      workRequest: materializedRemoteWorkRequest,
      replayed: true,
      outcomeCode: 'materialized',
    })
    expect(fetcher).toHaveBeenCalledWith(
      'http://api.local/api/desktop/work-requests/wr-rollout/materialized',
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer paired-bearer-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify(materializeInput),
      },
    )
  })

  it('performs zero network I/O without both frozen pairing metadata and its Bearer token', async () => {
    const fetcher = vi.fn()
    const pairedClientWithoutToken = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      sessionHeaders: authenticatedSessionHeaders,
    })
    const tokenClientWithoutPairing = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'orphaned-bearer-secret',
    })

    await expect(
      pairedClientWithoutToken.listWorkRequests('p-remote', workRequestPairing),
    ).rejects.toThrow(
      'Pair DevFlow Studio with a Team Project before syncing remote team state.',
    )
    await expect(
      tokenClientWithoutPairing.claimWorkRequest(claimInput, null),
    ).rejects.toThrow(
      'Pair DevFlow Studio with a Team Project before syncing remote team state.',
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects project/pairing scope mismatch before network I/O', async () => {
    const fetcher = vi.fn()
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.listWorkRequests('p-other', workRequestPairing),
    ).rejects.toMatchObject({
      status: 403,
      code: 'scope_mismatch',
      path: '/api/team/projects/:projectId/work-requests',
      retryable: false,
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses shared input parsing before sending a mutation', async () => {
    const fetcher = vi.fn()
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.claimWorkRequest(
        { ...claimInput, token: 'must-not-send' } as ClaimWorkRequestInput,
        workRequestPairing,
      ),
    ).rejects.toThrow('Invalid Work Request claim input.')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'unauthorized', false],
    [403, 'forbidden', false],
    [409, 'conflict', false],
    [410, 'remote_error', false],
    [503, 'service_unavailable', true],
  ] as const)(
    'maps Work Request HTTP %i to fixed safe metadata',
    async (status, code, retryable) => {
      const fetcher = vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: 'hostile',
            message:
              'Canonical Run Summary is required before evidence sync: secret-run (secret-project) Bearer response-secret',
            token: 'response-token-secret',
          }),
          { status },
        ),
      )
      const client = createRemoteSyncClient({
        apiBaseUrl: 'http://api.local',
        fetcher,
        authToken: 'paired-bearer-secret',
      })

      const error = await client
        .claimWorkRequest(claimInput, workRequestPairing)
        .catch((reason: unknown) => reason)

      expect(error).toBeInstanceOf(RemoteSyncHttpError)
      expect(error).toMatchObject({
        status,
        code,
        path: '/api/desktop/work-requests/:workRequestId/claim',
        retryable,
      })
      expect(String(error)).not.toMatch(
        /secret-run|secret-project|response-secret|response-token-secret|paired-bearer-secret/,
      )
    },
  )

  it.each([
    ['organization', { ...claimedRemoteWorkRequest, organizationId: 'org-other' }],
    ['project', { ...claimedRemoteWorkRequest, projectId: 'p-other' }],
    ['workRequest', { ...claimedRemoteWorkRequest, id: 'wr-other' }],
    [
      'run',
      {
        ...claimedRemoteWorkRequest,
        claim: { ...claimedRemoteWorkRequest.claim!, runId: 'run-other' },
      },
    ],
    ['version', { ...claimedRemoteWorkRequest, version: 3 }],
    ['status', openRemoteWorkRequest],
  ] as const)(
    'fails closed on a claim response with mismatched %s',
    async (_field, workRequest) => {
      const client = createRemoteSyncClient({
        apiBaseUrl: 'http://api.local',
        fetcher: vi.fn(async () =>
          new Response(
            JSON.stringify({
              workRequest,
              replayed: false,
              outcomeCode: 'claimed',
            }),
            { status: 200 },
          ),
        ),
        authToken: 'paired-bearer-secret',
      })

      await expect(
        client.claimWorkRequest(claimInput, workRequestPairing),
      ).rejects.toMatchObject({
        status: 200,
        code: 'invalid_response',
        path: '/api/desktop/work-requests/:workRequestId/claim',
        retryable: true,
      })
    },
  )

  it('rejects list states that the paired desktop API must never expose', async () => {
    const expired: WorkRequest = {
      ...openRemoteWorkRequest,
      version: 2,
      status: 'expired',
      expiresAt: '2026-08-01T01:01:00.000Z',
      updatedAt: '2026-08-01T01:02:00.000Z',
    }
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify({ workRequests: [expired] }), { status: 200 }),
      ),
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.listWorkRequests('p-remote', workRequestPairing),
    ).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
      path: '/api/team/projects/:projectId/work-requests',
    })
  })

  it.each([
    {
      workRequests: [openRemoteWorkRequest],
      bearerToken: 'response-token-secret',
    },
    {
      workRequests: [
        { ...openRemoteWorkRequest, tokenId: 'desktop-token-record-1' },
      ],
    },
  ])('fails closed when a list response adds an unknown secret/token field', async (body) => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify(body), { status: 200 }),
      ),
      authToken: 'paired-bearer-secret',
    })

    const error = await client
      .listWorkRequests('p-remote', workRequestPairing)
      .catch((reason: unknown) => reason)
    expect(error).toMatchObject({ status: 200, code: 'invalid_response' })
    expect(String(error)).not.toMatch(/response-token-secret|desktop-token-record-1/)
  })

  it('fails closed when a mutation wrapper adds an unknown secret field', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(
          JSON.stringify({
            workRequest: claimedRemoteWorkRequest,
            replayed: false,
            outcomeCode: 'claimed',
            token: 'response-token-secret',
          }),
          { status: 200 },
        ),
      ),
      authToken: 'paired-bearer-secret',
    })

    const error = await client
      .claimWorkRequest(claimInput, workRequestPairing)
      .catch((reason: unknown) => reason)
    expect(error).toMatchObject({ status: 200, code: 'invalid_response' })
    expect(String(error)).not.toContain('response-token-secret')
  })
})

const pendingGateCommand: GateCommand = {
  id: 'gate-command-1',
  organizationId: 'org-1',
  projectId: 'p-remote',
  workRequestId: 'wr-rollout',
  runId: 'run-rollout',
  nodeId: 'run-rollout-design-gate',
  action: 'approve',
  workflowCommand: 'approve_gate',
  reason: 'Approve the current design Gate.',
  requestedByUserId: 'u-review-lead',
  requestedRole: 'lead',
  idempotencyKey: 'gate-command:create:run-rollout:v3',
  requestFingerprint: 'a'.repeat(64),
  expectedRunVersion: 3,
  expectedPolicyVersion: 2,
  expectedBlockerIds: [],
  version: 1,
  evaluationStatus: 'allowed',
  evaluationBlockerIds: [],
  evaluatedAt: '2026-08-01T02:00:00.000Z',
  status: 'pending',
  outcomeCode: null,
  expiresAt: '2026-08-01T02:15:00.000Z',
  createdAt: '2026-08-01T02:00:01.000Z',
  updatedAt: '2026-08-01T02:00:01.000Z',
}

describe('Electron Gate Command remote client', () => {
  it('performs zero network I/O without both pairing metadata and its Bearer token', async () => {
    const fetcher = vi.fn()
    const pairedClientWithoutToken = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      sessionHeaders: authenticatedSessionHeaders,
    })
    const tokenClientWithoutPairing = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'orphaned-bearer-secret',
    })

    await expect(
      pairedClientWithoutToken.listGateCommandInbox(
        'p-remote',
        workRequestPairing,
      ),
    ).rejects.toThrow(
      'Pair DevFlow Studio with a Team Project before syncing remote team state.',
    )
    await expect(
      tokenClientWithoutPairing.createGateCommandReceipt(
        pendingGateCommand.id,
        null,
      ),
    ).rejects.toThrow(
      'Pair DevFlow Studio with a Team Project before syncing remote team state.',
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a project/pairing scope mismatch before network I/O', async () => {
    const fetcher = vi.fn()
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.listGateCommandInbox('p-other', workRequestPairing),
    ).rejects.toMatchObject({
      status: 403,
      code: 'scope_mismatch',
      path: '/api/desktop/projects/:projectId/gate-commands/inbox',
      retryable: false,
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('passes the captured AbortSignal and maps an aborted inbox request safely', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal)
      controller.abort()
      throw new Error('hostile timeout detail with paired-bearer-secret')
    })
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'paired-bearer-secret',
      signal: controller.signal,
    })

    const error = await client
      .listGateCommandInbox('p-remote', workRequestPairing)
      .catch((reason: unknown) => reason)
    expect(error).toMatchObject({
      status: null,
      code: 'request_timeout',
      path: '/api/desktop/projects/:projectId/gate-commands/inbox',
      retryable: true,
    })
    expect(String(error)).not.toContain('paired-bearer-secret')
  })

  it('lists the paired project inbox with Bearer auth and a strict command envelope', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ commands: [pendingGateCommand] }), {
        status: 200,
      }),
    )
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.listGateCommandInbox('p-remote', workRequestPairing),
    ).resolves.toEqual([pendingGateCommand])
    expect(fetcher).toHaveBeenCalledWith(
      'http://api.local/api/desktop/projects/p-remote/gate-commands/inbox',
      {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer paired-bearer-secret',
        },
      },
    )
  })

  it('rejects a valid inbox envelope returned with a non-200 success status', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify({ commands: [pendingGateCommand] }), {
          status: 201,
        }),
      ),
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.listGateCommandInbox('p-remote', workRequestPairing),
    ).rejects.toMatchObject({
      status: 201,
      code: 'invalid_response',
      path: '/api/desktop/projects/:projectId/gate-commands/inbox',
      retryable: true,
    })
  })

  it('accepts a delivering command that remains eligible for redelivery', async () => {
    const command: GateCommand = {
      ...pendingGateCommand,
      version: 2,
      status: 'delivering',
      updatedAt: '2026-08-01T02:01:00.000Z',
    }
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify({ commands: [command] }), { status: 200 }),
      ),
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.listGateCommandInbox('p-remote', workRequestPairing),
    ).resolves.toEqual([command])
  })

  it('fails closed when an inbox command belongs to another project', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(
          JSON.stringify({
            commands: [{ ...pendingGateCommand, projectId: 'p-other' }],
          }),
          { status: 200 },
        ),
      ),
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.listGateCommandInbox('p-remote', workRequestPairing),
    ).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
      path: '/api/desktop/projects/:projectId/gate-commands/inbox',
      retryable: true,
    })
  })

  it('fails closed when an inbox command has no Work Request identity', async () => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(
          JSON.stringify({
            commands: [{ ...pendingGateCommand, workRequestId: null }],
          }),
          { status: 200 },
        ),
      ),
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.listGateCommandInbox('p-remote', workRequestPairing),
    ).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
      path: '/api/desktop/projects/:projectId/gate-commands/inbox',
      retryable: true,
    })
  })

  it.each([
    {
      commands: [pendingGateCommand],
      bearerToken: 'response-token-secret',
    },
    {
      commands: [
        { ...pendingGateCommand, tokenId: 'desktop-token-record-secret' },
      ],
    },
  ])('rejects unknown secret fields in an inbox response', async (body) => {
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify(body), { status: 200 }),
      ),
      authToken: 'paired-bearer-secret',
    })

    const error = await client
      .listGateCommandInbox('p-remote', workRequestPairing)
      .catch((reason: unknown) => reason)
    expect(error).toMatchObject({
      status: 200,
      code: 'invalid_response',
      path: '/api/desktop/projects/:projectId/gate-commands/inbox',
    })
    expect(String(error)).not.toMatch(
      /response-token-secret|desktop-token-record-secret|paired-bearer-secret/,
    )
  })

  it('creates an exact command receipt with an empty object body', async () => {
    const deliveringCommand: GateCommand = {
      ...pendingGateCommand,
      version: 2,
      status: 'delivering',
      updatedAt: '2026-08-01T02:01:00.000Z',
    }
    const receipt = {
      id: 'gate-receipt-1',
      commandId: deliveringCommand.id,
      attempt: 1,
      leasedAt: '2026-08-01T02:01:00.000Z',
      leaseExpiresAt: '2026-08-01T02:02:00.000Z',
      acknowledgedAt: null,
    }
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          command: deliveringCommand,
          receipt,
          outcomeCode: 'receipt_created',
          replayed: false,
        }),
        { status: 201 },
      ),
    )
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.createGateCommandReceipt(
        deliveringCommand.id,
        workRequestPairing,
      ),
    ).resolves.toEqual({
      command: deliveringCommand,
      receipt,
      replayed: false,
    })
    expect(fetcher).toHaveBeenCalledWith(
      'http://api.local/api/desktop/gate-commands/gate-command-1/receipts',
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer paired-bearer-secret',
          'content-type': 'application/json',
        },
        body: '{}',
      },
    )
  })

  it('rejects a valid receipt envelope returned with a non-201 success status', async () => {
    const command: GateCommand = {
      ...pendingGateCommand,
      version: 2,
      status: 'delivering',
      updatedAt: '2026-08-01T02:01:00.000Z',
    }
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(
          JSON.stringify({
            command,
            receipt: {
              id: 'gate-receipt-1',
              commandId: command.id,
              attempt: 1,
              leasedAt: '2026-08-01T02:01:00.000Z',
              leaseExpiresAt: '2026-08-01T02:02:00.000Z',
              acknowledgedAt: null,
            },
            outcomeCode: 'receipt_created',
            replayed: false,
          }),
          { status: 200 },
        ),
      ),
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.createGateCommandReceipt(command.id, workRequestPairing),
    ).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
      path: '/api/desktop/gate-commands/:commandId/receipts',
      retryable: true,
    })
  })

  it('fails closed when a receipt response belongs to another command', async () => {
    const command: GateCommand = {
      ...pendingGateCommand,
      id: 'gate-command-other',
      version: 2,
      status: 'delivering',
      updatedAt: '2026-08-01T02:01:00.000Z',
    }
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(
          JSON.stringify({
            command,
            receipt: {
              id: 'gate-receipt-other',
              commandId: command.id,
              attempt: 1,
              leasedAt: '2026-08-01T02:01:00.000Z',
              leaseExpiresAt: '2026-08-01T02:02:00.000Z',
              acknowledgedAt: null,
            },
            outcomeCode: 'receipt_created',
            replayed: false,
          }),
          { status: 201 },
        ),
      ),
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.createGateCommandReceipt(
        pendingGateCommand.id,
        workRequestPairing,
      ),
    ).rejects.toMatchObject({
      status: 201,
      code: 'invalid_response',
      path: '/api/desktop/gate-commands/:commandId/receipts',
      retryable: true,
    })
  })

  it('fails closed when a receipt command has no Work Request identity', async () => {
    const command: GateCommand = {
      ...pendingGateCommand,
      workRequestId: null,
      version: 2,
      status: 'delivering',
      updatedAt: '2026-08-01T02:01:00.000Z',
    }
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(
          JSON.stringify({
            command,
            receipt: {
              id: 'gate-receipt-1',
              commandId: command.id,
              attempt: 1,
              leasedAt: '2026-08-01T02:01:00.000Z',
              leaseExpiresAt: '2026-08-01T02:02:00.000Z',
              acknowledgedAt: null,
            },
            outcomeCode: 'receipt_created',
            replayed: false,
          }),
          { status: 201 },
        ),
      ),
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.createGateCommandReceipt(command.id, workRequestPairing),
    ).rejects.toMatchObject({
      status: 201,
      code: 'invalid_response',
      path: '/api/desktop/gate-commands/:commandId/receipts',
      retryable: true,
    })
  })

  it.each(['wrapper', 'receipt'] as const)(
    'rejects an unknown secret field in the receipt %s',
    async (location) => {
      const command: GateCommand = {
        ...pendingGateCommand,
        version: 2,
        status: 'delivering',
        updatedAt: '2026-08-01T02:01:00.000Z',
      }
      const receipt = {
        id: 'gate-receipt-1',
        commandId: command.id,
        attempt: 1,
        leasedAt: '2026-08-01T02:01:00.000Z',
        leaseExpiresAt: '2026-08-01T02:02:00.000Z',
        acknowledgedAt: null,
        ...(location === 'receipt'
          ? { leasedToTokenId: 'receipt-token-secret' }
          : {}),
      }
      const client = createRemoteSyncClient({
        apiBaseUrl: 'http://api.local',
        fetcher: vi.fn(async () =>
          new Response(
            JSON.stringify({
              command,
              receipt,
              outcomeCode: 'receipt_created',
              replayed: false,
              ...(location === 'wrapper'
                ? { bearerToken: 'wrapper-token-secret' }
                : {}),
            }),
            { status: 201 },
          ),
        ),
        authToken: 'paired-bearer-secret',
      })

      const error = await client
        .createGateCommandReceipt(command.id, workRequestPairing)
        .catch((reason: unknown) => reason)
      expect(error).toMatchObject({
        status: 201,
        code: 'invalid_response',
        path: '/api/desktop/gate-commands/:commandId/receipts',
      })
      expect(String(error)).not.toMatch(
        /receipt-token-secret|wrapper-token-secret|paired-bearer-secret/,
      )
    },
  )

  it.each([
    [401, 'unauthorized', false],
    [403, 'forbidden', false],
    [409, 'conflict', false],
    [410, 'remote_error', false],
    [503, 'service_unavailable', true],
  ] as const)(
    'maps Gate Command HTTP %i to fixed safe metadata',
    async (status, code, retryable) => {
      const fetcher = vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: 'hostile',
            message: 'Bearer response-secret for secret-command',
            token: 'response-token-secret',
          }),
          { status },
        ),
      )
      const client = createRemoteSyncClient({
        apiBaseUrl: 'http://api.local',
        fetcher,
        authToken: 'paired-bearer-secret',
      })

      const error = await client
        .createGateCommandReceipt(
          pendingGateCommand.id,
          workRequestPairing,
        )
        .catch((reason: unknown) => reason)

      expect(error).toBeInstanceOf(RemoteSyncHttpError)
      expect(error).toMatchObject({
        status,
        code,
        path: '/api/desktop/gate-commands/:commandId/receipts',
        retryable,
      })
      expect(String(error)).not.toMatch(
        /response-secret|secret-command|response-token-secret|paired-bearer-secret/,
      )
    },
  )

  it('acknowledges an exact receipt with the shared create input', async () => {
    const command: GateCommand = {
      ...pendingGateCommand,
      version: 3,
      status: 'applied',
      outcomeCode: 'applied',
      updatedAt: '2026-08-01T02:01:30.000Z',
    }
    const receipt: GateCommandReceipt = {
      id: 'gate-receipt-1',
      commandId: command.id,
      attempt: 1,
      leasedAt: '2026-08-01T02:01:00.000Z',
      leaseExpiresAt: '2026-08-01T02:02:00.000Z',
      acknowledgedAt: '2026-08-01T02:01:31.000Z',
    }
    const input: CreateGateCommandAcknowledgementInput = {
      commandId: command.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
      evaluatedAt: '2026-08-01T02:01:30.000Z',
    }
    const acknowledgement: GateCommandAcknowledgement = {
      id: 'gate-acknowledgement-1',
      commandId: command.id,
      receiptId: receipt.id,
      outcomeCode: input.outcomeCode,
      beforeRunVersion: input.beforeRunVersion,
      afterRunVersion: input.afterRunVersion,
      evaluatedAt: input.evaluatedAt,
      createdAt: '2026-08-01T02:01:31.000Z',
    }
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          command,
          receipt,
          acknowledgement,
          outcomeCode: 'acknowledged',
          replayed: false,
        }),
        { status: 201 },
      ),
    )
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.acknowledgeGateCommandReceipt(
        receipt.id,
        input,
        workRequestPairing,
      ),
    ).resolves.toEqual({
      acknowledgement,
      replayed: false,
    })
    expect(fetcher).toHaveBeenCalledWith(
      'http://api.local/api/desktop/gate-command-receipts/gate-receipt-1/acknowledgements',
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer paired-bearer-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify(input),
      },
    )
  })

  it('rejects a valid acknowledgement envelope returned with a non-201 success status', async () => {
    const command: GateCommand = {
      ...pendingGateCommand,
      version: 3,
      status: 'applied',
      outcomeCode: 'applied',
      updatedAt: '2026-08-01T02:01:30.000Z',
    }
    const input: CreateGateCommandAcknowledgementInput = {
      commandId: command.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
      evaluatedAt: '2026-08-01T02:01:30.000Z',
    }
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(
          JSON.stringify({
            command,
            receipt: {
              id: 'gate-receipt-1',
              commandId: command.id,
              attempt: 1,
              leasedAt: '2026-08-01T02:01:00.000Z',
              leaseExpiresAt: '2026-08-01T02:02:00.000Z',
              acknowledgedAt: '2026-08-01T02:01:31.000Z',
            },
            acknowledgement: {
              id: 'gate-acknowledgement-1',
              commandId: command.id,
              receiptId: 'gate-receipt-1',
              outcomeCode: input.outcomeCode,
              beforeRunVersion: input.beforeRunVersion,
              afterRunVersion: input.afterRunVersion,
              evaluatedAt: input.evaluatedAt,
              createdAt: '2026-08-01T02:01:31.000Z',
            },
            outcomeCode: 'acknowledged',
            replayed: false,
          }),
          { status: 200 },
        ),
      ),
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.acknowledgeGateCommandReceipt(
        'gate-receipt-1',
        input,
        workRequestPairing,
      ),
    ).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
      path: '/api/desktop/gate-command-receipts/:receiptId/acknowledgements',
      retryable: true,
    })
  })

  it('fails closed when an acknowledgement command has no Work Request identity', async () => {
    const command: GateCommand = {
      ...pendingGateCommand,
      workRequestId: null,
      version: 3,
      status: 'applied',
      outcomeCode: 'applied',
      updatedAt: '2026-08-01T02:01:30.000Z',
    }
    const input: CreateGateCommandAcknowledgementInput = {
      commandId: command.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
      evaluatedAt: '2026-08-01T02:01:30.000Z',
    }
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(
          JSON.stringify({
            command,
            receipt: {
              id: 'gate-receipt-1',
              commandId: command.id,
              attempt: 1,
              leasedAt: '2026-08-01T02:01:00.000Z',
              leaseExpiresAt: '2026-08-01T02:02:00.000Z',
              acknowledgedAt: '2026-08-01T02:01:31.000Z',
            },
            acknowledgement: {
              id: 'gate-acknowledgement-1',
              commandId: command.id,
              receiptId: 'gate-receipt-1',
              outcomeCode: input.outcomeCode,
              beforeRunVersion: input.beforeRunVersion,
              afterRunVersion: input.afterRunVersion,
              evaluatedAt: input.evaluatedAt,
              createdAt: '2026-08-01T02:01:31.000Z',
            },
            outcomeCode: 'acknowledged',
            replayed: false,
          }),
          { status: 201 },
        ),
      ),
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.acknowledgeGateCommandReceipt(
        'gate-receipt-1',
        input,
        workRequestPairing,
      ),
    ).rejects.toMatchObject({
      status: 201,
      code: 'invalid_response',
      path: '/api/desktop/gate-command-receipts/:receiptId/acknowledgements',
      retryable: true,
    })
  })

  it('rejects an acknowledgement input with an unknown secret field before network I/O', async () => {
    const fetcher = vi.fn()
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher,
      authToken: 'paired-bearer-secret',
    })
    const input = {
      commandId: pendingGateCommand.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
      evaluatedAt: '2026-08-01T02:01:30.000Z',
      token: 'input-token-secret',
    } as CreateGateCommandAcknowledgementInput

    const error = await client
      .acknowledgeGateCommandReceipt(
        'gate-receipt-1',
        input,
        workRequestPairing,
      )
      .catch((reason: unknown) => reason)
    expect(error).toMatchObject({
      status: null,
      code: 'bad_request',
      path: '/api/desktop/gate-command-receipts/:receiptId/acknowledgements',
      retryable: false,
    })
    expect(String(error)).not.toMatch(
      /input-token-secret|paired-bearer-secret/,
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['wrapper', 'acknowledgement'] as const)(
    'rejects an unknown secret field in the acknowledgement %s',
    async (location) => {
      const command: GateCommand = {
        ...pendingGateCommand,
        version: 3,
        status: 'applied',
        outcomeCode: 'applied',
        updatedAt: '2026-08-01T02:01:30.000Z',
      }
      const input: CreateGateCommandAcknowledgementInput = {
        commandId: command.id,
        outcomeCode: 'applied',
        beforeRunVersion: 3,
        afterRunVersion: 4,
        evaluatedAt: '2026-08-01T02:01:30.000Z',
      }
      const receipt: GateCommandReceipt = {
        id: 'gate-receipt-1',
        commandId: command.id,
        attempt: 1,
        leasedAt: '2026-08-01T02:01:00.000Z',
        leaseExpiresAt: '2026-08-01T02:02:00.000Z',
        acknowledgedAt: '2026-08-01T02:01:31.000Z',
      }
      const acknowledgement = {
        id: 'gate-acknowledgement-1',
        commandId: command.id,
        receiptId: receipt.id,
        outcomeCode: input.outcomeCode,
        beforeRunVersion: input.beforeRunVersion,
        afterRunVersion: input.afterRunVersion,
        evaluatedAt: input.evaluatedAt,
        createdAt: '2026-08-01T02:01:31.000Z',
        ...(location === 'acknowledgement'
          ? { tokenId: 'acknowledgement-token-secret' }
          : {}),
      }
      const client = createRemoteSyncClient({
        apiBaseUrl: 'http://api.local',
        fetcher: vi.fn(async () =>
          new Response(
            JSON.stringify({
              command,
              receipt,
              acknowledgement,
              outcomeCode: 'acknowledged',
              replayed: false,
              ...(location === 'wrapper'
                ? { bearerToken: 'wrapper-token-secret' }
                : {}),
            }),
            { status: 201 },
          ),
        ),
        authToken: 'paired-bearer-secret',
      })

      const error = await client
        .acknowledgeGateCommandReceipt(receipt.id, input, workRequestPairing)
        .catch((reason: unknown) => reason)
      expect(error).toMatchObject({
        status: 201,
        code: 'invalid_response',
        path:
          '/api/desktop/gate-command-receipts/:receiptId/acknowledgements',
      })
      expect(String(error)).not.toMatch(
        /acknowledgement-token-secret|wrapper-token-secret|paired-bearer-secret/,
      )
    },
  )

  it('fails closed when an acknowledgement response belongs to another receipt', async () => {
    const command: GateCommand = {
      ...pendingGateCommand,
      version: 3,
      status: 'applied',
      outcomeCode: 'applied',
      updatedAt: '2026-08-01T02:01:30.000Z',
    }
    const input: CreateGateCommandAcknowledgementInput = {
      commandId: command.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
      evaluatedAt: '2026-08-01T02:01:30.000Z',
    }
    const client = createRemoteSyncClient({
      apiBaseUrl: 'http://api.local',
      fetcher: vi.fn(async () =>
        new Response(
          JSON.stringify({
            command,
            receipt: {
              id: 'gate-receipt-other',
              commandId: command.id,
              attempt: 1,
              leasedAt: '2026-08-01T02:01:00.000Z',
              leaseExpiresAt: '2026-08-01T02:02:00.000Z',
              acknowledgedAt: '2026-08-01T02:01:31.000Z',
            },
            acknowledgement: {
              id: 'gate-acknowledgement-other',
              commandId: command.id,
              receiptId: 'gate-receipt-other',
              outcomeCode: input.outcomeCode,
              beforeRunVersion: input.beforeRunVersion,
              afterRunVersion: input.afterRunVersion,
              evaluatedAt: input.evaluatedAt,
              createdAt: '2026-08-01T02:01:31.000Z',
            },
            outcomeCode: 'acknowledged',
            replayed: false,
          }),
          { status: 201 },
        ),
      ),
      authToken: 'paired-bearer-secret',
    })

    await expect(
      client.acknowledgeGateCommandReceipt(
        'gate-receipt-1',
        input,
        workRequestPairing,
      ),
    ).rejects.toMatchObject({
      status: 201,
      code: 'invalid_response',
      path: '/api/desktop/gate-command-receipts/:receiptId/acknowledgements',
      retryable: true,
    })
  })
})
