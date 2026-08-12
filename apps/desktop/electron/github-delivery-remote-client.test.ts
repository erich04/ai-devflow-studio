import { describe, expect, it, vi } from 'vitest'
import type {
  GitHubDeliveryIntent,
  GitHubRepositoryBinding,
} from '@ai-devflow/shared'
import {
  GitHubGitPublisherError,
  type GitHubGitPublisherErrorCode,
} from './github-git-publisher'
import { createGitHubDeliveryRemoteClient } from './github-delivery-remote-client'

const now = '2026-08-11T15:00:00.000Z'
const projectId = 'project-a'
const requestId = 'delivery-1'

function repositoryBinding(
  overrides: Partial<GitHubRepositoryBinding> = {},
): GitHubRepositoryBinding {
  return {
    stateVersion: 1,
    id: 'binding-1',
    version: 2,
    organizationId: 'org-a',
    teamProjectId: projectId,
    installationId: '12345',
    repositoryId: '98765',
    repository: 'example/project',
    defaultBranch: 'main',
    status: 'active',
    validatedAt: '2026-08-11T14:55:00.000Z',
    updatedAt: now,
    redacted: true,
    ...overrides,
  }
}

function deliveryIntent(
  overrides: Partial<GitHubDeliveryIntent> = {},
): GitHubDeliveryIntent {
  return {
    stateVersion: 1,
    id: 'intent-1',
    organizationId: 'org-a',
    teamProjectId: projectId,
    localProjectId: 'local-project-a',
    runId: 'run-1',
    runVersion: 7,
    nodeId: 'pr-1',
    repositoryBindingId: 'binding-1',
    repositoryBindingVersion: 1,
    installationId: '12345',
    repositoryId: '98765',
    codingRunId: 'coding-1',
    codingRunCompletedAt: '2026-08-11T13:55:00.000Z',
    workspaceId: 'workspace-1',
    deliverySeriesKey: `github-delivery:${'2'.repeat(64)}`,
    deliveryAttempt: 1,
    repository: 'example/project',
    baseBranch: 'main',
    headBranch: 'devflow/run-1-pr-1',
    baseCommitSha: 'a'.repeat(40),
    expectedCommitSha: 'b'.repeat(40),
    diffArtifactId: 'diff-1',
    diffSourceDigest: 'e'.repeat(64),
    testEvidenceId: 'test-1',
    testEvidenceCreatedAt: '2026-08-11T13:56:00.000Z',
    testEvidenceDigest: 'f'.repeat(64),
    prPackageArtifactId: 'package-1',
    prPackageUpdatedAt: '2026-08-11T13:57:00.000Z',
    prPackageDigest: '1'.repeat(64),
    changedPaths: ['apps/api/src/example.ts'],
    intentDigest: 'c'.repeat(64),
    idempotencyKey: `github-delivery:${'d'.repeat(64)}`,
    status: 'approval_required',
    createdAt: '2026-08-11T14:00:00.000Z',
    updatedAt: '2026-08-11T14:00:00.000Z',
    redacted: true,
    ...overrides,
  }
}

function deliveryRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId,
    stateVersion: 2,
    intentRevision: 1,
    organizationId: 'org-a',
    projectId,
    requestedByUserId: 'user-desktop',
    localIntentId: 'intent-1',
    localProjectId: 'local-project-a',
    runId: 'run-1',
    runVersion: 7,
    nodeId: 'pr-1',
    repositoryBindingId: 'binding-1',
    repositoryBindingVersion: 1,
    installationId: '12345',
    repositoryId: '98765',
    repository: 'example/project',
    codingRunId: 'coding-1',
    workspaceId: 'workspace-1',
    diffArtifactId: 'diff-1',
    testEvidenceId: 'test-1',
    prPackageArtifactId: 'package-1',
    status: 'approval_required',
    outcomeCode: null,
    expectedRunVersion: 7,
    baseBranch: 'main',
    headBranch: 'devflow/run-1-pr-1',
    baseCommitSha: 'a'.repeat(40),
    expectedCommitSha: 'b'.repeat(40),
    intentDigest: 'c'.repeat(64),
    deliverySeriesKey: `github-delivery:${'2'.repeat(64)}`,
    deliveryAttempt: 1,
    logicalIdempotencyKey: `github-delivery:${'d'.repeat(64)}`,
    diffDigest: 'e'.repeat(64),
    testEvidenceDigest: 'f'.repeat(64),
    packageDigest: '1'.repeat(64),
    changedPaths: ['apps/api/src/example.ts'],
    prTitle: 'Deliver the approved change',
    prBody: 'Bound to exact evidence.',
    expiresAt: '2026-08-12T14:00:00.000Z',
    createdAt: '2026-08-11T14:00:00.000Z',
    updatedAt: now,
    redacted: true,
    ...overrides,
  }
}

function credentialGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-1',
    version: 2,
    requestId,
    intentRevision: 1,
    approvalId: 'approval-1',
    attempt: 1,
    repositoryId: '98765',
    permission: 'contents:write',
    repositoryCount: 1,
    status: 'issued',
    requestedAt: now,
    issuedAt: now,
    credentialExpiresAt: '2026-08-11T16:00:00.000Z',
    consumedAt: null,
    outcomeCode: null,
    redacted: true,
    ...overrides,
  }
}

function approval(overrides: Record<string, unknown> = {}) {
  return {
    id: 'approval-1',
    requestId,
    intentRevision: 1,
    requestStateVersion: 2,
    intentDigest: 'c'.repeat(64),
    repositoryBindingId: 'binding-1',
    repositoryBindingVersion: 1,
    runId: 'run-1',
    runVersion: 7,
    nodeId: 'pr-1',
    repositoryId: '98765',
    baseBranch: 'main',
    headBranch: 'devflow/run-1-pr-1',
    expectedCommitSha: 'b'.repeat(40),
    testEvidenceDigest: 'f'.repeat(64),
    packageDigest: '1'.repeat(64),
    approvedByUserId: 'user-owner',
    approvedRole: 'owner',
    authenticationKind: 'session_cookie',
    approvedAt: now,
    redacted: true,
    ...overrides,
  }
}

function branchPublication(overrides: Record<string, unknown> = {}) {
  return {
    id: 'publication-1',
    version: 2,
    requestId,
    intentRevision: 1,
    grantId: 'grant-1',
    status: 'verified',
    reportedOutcomeCode: 'pushed',
    verifiedHeadSha: 'b'.repeat(40),
    reportedAt: now,
    verifiedAt: now,
    outcomeCode: 'branch_verified',
    redacted: true,
    ...overrides,
  }
}

function pullRequestOutcome(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pull-request-outcome-1',
    version: 2,
    requestId,
    intentRevision: 1,
    publicationId: 'publication-1',
    status: 'completed',
    pullRequestId: '456789',
    pullRequestNumber: 42,
    safeUrl: 'https://github.com/example/project/pull/42',
    draft: true,
    headBranch: 'devflow/run-1-pr-1',
    baseBranch: 'main',
    headSha: 'b'.repeat(40),
    providerCreatedAt: now,
    recordedAt: now,
    outcomeCode: 'draft_pr_created',
    redacted: true,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('GitHub Delivery remote client', () => {
  it.each(['active', 'revoked'] as const)(
    'reads a strict %s repository binding with Desktop Bearer authority',
    async (status) => {
      const expected = repositoryBinding({ status })
      const fetcher = vi.fn(async () => jsonResponse({ binding: expected }))
      const client = createGitHubDeliveryRemoteClient({
        apiBaseUrl: 'https://api.devflow.test',
        authToken: 'desktop-secret-token',
        fetcher,
      })

      await expect(client.getRepositoryBinding(projectId)).resolves.toEqual(
        expected,
      )
      expect(fetcher).toHaveBeenCalledWith(
        'https://api.devflow.test/api/desktop/projects/project-a/github-repository-binding',
        expect.objectContaining({
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: {
            accept: 'application/json',
            authorization: 'Bearer desktop-secret-token',
          },
        }),
      )
    },
  )

  it('accepts the exact null repository-binding observation', async () => {
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () => jsonResponse({ binding: null })),
    })

    await expect(client.getRepositoryBinding(projectId)).resolves.toBeNull()
  })

  it.each([
    ['unknown secret field', { ...repositoryBinding(), token: 'ghs_secret' }],
    [
      'unknown local path field',
      { ...repositoryBinding(), path: '/private/repo' },
    ],
    [
      'cross-project scope',
      repositoryBinding({ teamProjectId: 'project-other' }),
    ],
    [
      'non-canonical repository',
      repositoryBinding({ repository: 'Example/Project' }),
    ],
    ['unsafe branch', repositoryBinding({ defaultBranch: '../main' })],
    ['invalid version', repositoryBinding({ version: 0 })],
    [
      'timestamp regression',
      repositoryBinding({
        validatedAt: '2026-08-11T15:01:00.000Z',
        updatedAt: now,
      }),
    ],
  ])('rejects a malformed repository binding: %s', async (_label, binding) => {
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () => jsonResponse({ binding })),
    })

    const error = await client
      .getRepositoryBinding(projectId)
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      code: 'invalid_response',
      operation: 'repository_binding',
      retryable: true,
    })
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(
      /ghs_secret|\/private\/repo/u,
    )
  })

  it('returns only a safe repository-binding error when the API is unavailable', async () => {
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () => {
        throw new Error('private upstream details')
      }),
    })

    const error = await client
      .getRepositoryBinding(projectId)
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      code: 'remote_unavailable',
      operation: 'repository_binding',
      retryable: true,
      operatorOutcomeCode: null,
    })
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(
      'private upstream details',
    )
  })

  it('submits an exact intent with Desktop Bearer authority and returns a strict redacted request', async () => {
    const intent = deliveryIntent()
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          request: deliveryRequest(),
          outcomeCode: 'delivery_created',
          replayed: false,
        },
        201,
      ),
    )
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher,
    })

    await expect(
      client.submit({
        projectId,
        intent,
        prTitle: 'Deliver the approved change',
        prBody: 'Bound to exact evidence.',
        expectedStateVersion: 0,
      }),
    ).resolves.toEqual({
      request: deliveryRequest(),
      outcomeCode: 'delivery_created',
      replayed: false,
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.devflow.test/api/desktop/projects/project-a/github-deliveries',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer desktop-secret-token',
          'content-type': 'application/json',
        },
      }),
    )
  })

  it('rejects a response from a different immutable delivery attempt', async () => {
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () =>
        jsonResponse(
          {
            request: deliveryRequest({ deliveryAttempt: 2 }),
            outcomeCode: 'delivery_created',
            replayed: false,
          },
          201,
        ),
      ),
    })

    await expect(
      client.submit({
        projectId,
        intent: deliveryIntent(),
        prTitle: 'Deliver the approved change',
        prBody: 'Bound to exact evidence.',
        expectedStateVersion: 0,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_response',
      operation: 'submit',
      retryable: true,
    })
  })

  it('lists the paired project inbox with the exact GET response envelope', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ requests: [deliveryRequest({ status: 'approved' })] }),
    )
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test/',
      authToken: 'desktop-secret-token',
      fetcher,
    })

    await expect(client.listInbox(projectId)).resolves.toEqual([
      deliveryRequest({ status: 'approved' }),
    ])
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.devflow.test/api/desktop/projects/project-a/github-deliveries/inbox',
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer desktop-secret-token',
        },
      }),
    )
  })

  it('keeps the ephemeral credential inside one exact-publisher callback', async () => {
    const ephemeralToken = 'ghs_ephemeral_desktop_only'
    const fetcher = vi.fn(async () =>
      jsonResponse({
        request: deliveryRequest({ stateVersion: 4, status: 'publishing_branch' }),
        grant: credentialGrant(),
        credential: {
          grantId: 'grant-1',
          username: 'x-access-token',
          token: ephemeralToken,
          expiresAt: '2026-08-11T16:00:00.000Z',
          repositoryId: '98765',
          canonicalHttpsUrl: 'https://github.com/example/project.git',
        },
        outcomeCode: 'grant_finalized',
        replayed: false,
      }),
    )
    const publishExactCommit = vi.fn(async (credential) => {
      expect(credential).toEqual({
        grantId: 'grant-1',
        username: 'x-access-token',
        token: ephemeralToken,
        expiresAt: '2026-08-11T16:00:00.000Z',
        repositoryId: '98765',
        canonicalHttpsUrl: 'https://github.com/example/project.git',
        repository: 'example/project',
        headBranch: 'devflow/run-1-pr-1',
        expectedCommitSha: 'b'.repeat(40),
      })
      return {
        outcome: 'pushed' as const,
        expectedCommitSha: 'b'.repeat(40),
        repository: 'example/project',
        headBranch: 'devflow/run-1-pr-1',
      }
    })
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher,
    })

    const result = await client.withCredentialGrant(
      { projectId, requestId, expectedStateVersion: 3 },
      publishExactCommit,
    )

    expect(result).toEqual({
      request: deliveryRequest({ stateVersion: 4, status: 'publishing_branch' }),
      grant: credentialGrant(),
      outcomeCode: 'grant_finalized',
      replayed: false,
      publisherResult: {
        outcome: 'pushed',
        expectedCommitSha: 'b'.repeat(40),
        repository: 'example/project',
        headBranch: 'devflow/run-1-pr-1',
      },
    })
    expect(publishExactCommit).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain(ephemeralToken)
    expect(JSON.stringify(result)).not.toContain('token')
  })

  it('proves a revoked binding only from the exact credential rejection', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          error: 'conflict',
          message: 'The Project GitHub repository binding is not active.',
          outcomeCode: 'binding_inactive',
          replayed: false,
        },
        409,
      ),
    )
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher,
    })

    await expect(
      client.verifyCredentialGrantBlocked({
        projectId,
        requestId,
        expectedStateVersion: 8,
      }),
    ).resolves.toEqual({
      status: 'blocked',
      outcomeCode: 'binding_inactive',
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.devflow.test/api/desktop/projects/project-a/github-deliveries/delivery-1/credential-grant',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer desktop-secret-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ expectedStateVersion: 8 }),
      }),
    )
  })

  it('cancels an unexpected credential response without reading or exposing its body', async () => {
    const credentialSentinel =
      'ghs_unexpected_secret_from_/Users/alice/private-worktree'
    let cancelled = false
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ credential: { token: credentialSentinel } }),
            ),
          )
        },
        cancel() {
          cancelled = true
        },
      }),
      { status: 200 },
    )
    const json = vi.spyOn(response, 'json')
    const text = vi.spyOn(response, 'text')
    const arrayBuffer = vi.spyOn(response, 'arrayBuffer')
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () => response),
    })

    const error = await client
      .verifyCredentialGrantBlocked({
        projectId,
        requestId,
        expectedStateVersion: 8,
      })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'GitHubDeliveryRemoteError',
      status: 200,
      code: 'credential_unexpectedly_issued',
      operation: 'credential_grant',
      retryable: false,
      outcomeCode: null,
    })
    expect(cancelled).toBe(true)
    expect(json).not.toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(
      credentialSentinel,
    )
  })

  it('fails immediately on 2xx even when stream cancellation never settles', async () => {
    let cancelStarted = false
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelStarted = true
          return new Promise<void>(() => undefined)
        },
      }),
      { status: 201 },
    )
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () => response),
    })

    await expect(
      client.verifyCredentialGrantBlocked({
        projectId,
        requestId,
        expectedStateVersion: 8,
      }),
    ).rejects.toMatchObject({
      status: 201,
      code: 'credential_unexpectedly_issued',
      retryable: false,
    })
    expect(cancelStarted).toBe(true)
  })

  it.each([
    [
      'extra field',
      {
        error: 'conflict',
        message: 'The Project GitHub repository binding is not active.',
        outcomeCode: 'binding_inactive',
        replayed: false,
        token: 'ghs_untrusted_extra',
      },
    ],
    [
      'wrong message',
      {
        error: 'conflict',
        message: 'Bearer raw-secret at /Users/alice/private',
        outcomeCode: 'binding_inactive',
        replayed: false,
      },
    ],
    [
      'replayed rejection',
      {
        error: 'conflict',
        message: 'The Project GitHub repository binding is not active.',
        outcomeCode: 'binding_inactive',
        replayed: true,
      },
    ],
    [
      'wrong outcome',
      {
        error: 'conflict',
        message: 'The Project GitHub repository binding is not active.',
        outcomeCode: 'stale_version',
        replayed: false,
      },
    ],
    [
      'malformed envelope',
      {
        error: 'conflict',
        message: 'The Project GitHub repository binding is not active.',
        outcomeCode: 'binding_inactive',
      },
    ],
  ])('rejects a non-exact revocation response: %s', async (_label, body) => {
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () => jsonResponse(body, 409)),
    })

    const error = await client
      .verifyCredentialGrantBlocked({
        projectId,
        requestId,
        expectedStateVersion: 8,
      })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'GitHubDeliveryRemoteError',
      status: 409,
      code: 'invalid_response',
      operation: 'credential_grant',
      retryable: false,
      outcomeCode: null,
    })
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(
      /ghs_untrusted_extra|raw-secret|\/Users\/alice/u,
    )
  })

  it('rejects malformed revocation JSON without reflecting its bytes', async () => {
    const rawSentinel =
      'Bearer malformed-secret at /Users/alice/private-worktree'
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () =>
        new Response(`{"outcomeCode":"binding_inactive",${rawSentinel}`, {
          status: 409,
        }),
      ),
    })

    const error = await client
      .verifyCredentialGrantBlocked({
        projectId,
        requestId,
        expectedStateVersion: 8,
      })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      status: 409,
      code: 'invalid_response',
      operation: 'credential_grant',
      retryable: true,
    })
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(
      rawSentinel,
    )
  })

  it('bounds an oversized revocation rejection without reflecting its body', async () => {
    const rawSentinel =
      'Bearer oversized-secret at /Users/alice/private-worktree'
    const response = new Response(
      JSON.stringify({
        error: 'conflict',
        message: rawSentinel,
        outcomeCode: 'binding_inactive',
        replayed: false,
      }),
      {
        status: 409,
        headers: { 'content-length': '1100000' },
      },
    )
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () => response),
    })

    const error = await client
      .verifyCredentialGrantBlocked({
        projectId,
        requestId,
        expectedStateVersion: 8,
      })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      status: 409,
      code: 'response_too_large',
      operation: 'credential_grant',
      retryable: true,
    })
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(
      rawSentinel,
    )
    expect(response.bodyUsed).toBe(true)
  })

  it('classifies a non-409 revocation response without leaking its raw message', async () => {
    const rawMessage =
      'forbidden Bearer remote-secret at /Users/alice/private-worktree'
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () =>
        jsonResponse(
          {
            error: 'forbidden',
            message: rawMessage,
            outcomeCode: 'project_forbidden',
            replayed: false,
          },
          403,
        ),
      ),
    })

    const error = await client
      .verifyCredentialGrantBlocked({
        projectId,
        requestId,
        expectedStateVersion: 8,
      })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      status: 403,
      code: 'forbidden',
      operation: 'credential_grant',
      retryable: false,
      outcomeCode: 'project_forbidden',
    })
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(rawMessage)
  })

  it('enforces a bounded timeout for the raw revocation probe', async () => {
    vi.useFakeTimers()
    try {
      const rawFailure =
        'aborted Bearer desktop-secret-token at /Users/alice/private'
      const fetcher = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new Error(rawFailure)),
              { once: true },
            )
          }),
      ) as typeof fetch
      const client = createGitHubDeliveryRemoteClient({
        apiBaseUrl: 'https://api.devflow.test',
        authToken: 'desktop-secret-token',
        fetcher,
        timeoutMs: 5,
      })

      const result = client
        .verifyCredentialGrantBlocked({
          projectId,
          requestId,
          expectedStateVersion: 8,
        })
        .catch((caught: unknown) => caught)
      await vi.advanceTimersByTimeAsync(5)
      const error = await result

      expect(error).toMatchObject({
        status: null,
        code: 'request_timeout',
        operation: 'credential_grant',
        retryable: true,
      })
      expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(
        rawFailure,
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('honors caller cancellation without exposing the fetch failure', async () => {
    const controller = new AbortController()
    const rawFailure =
      'cancelled Bearer desktop-secret-token at /Users/alice/private'
    const fetcher = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error(rawFailure)),
            { once: true },
          )
        }),
    ) as typeof fetch
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher,
      signal: controller.signal,
    })

    const result = client
      .verifyCredentialGrantBlocked({
        projectId,
        requestId,
        expectedStateVersion: 8,
      })
      .catch((caught: unknown) => caught)
    controller.abort()
    const error = await result

    expect(error).toMatchObject({
      status: null,
      code: 'request_cancelled',
      operation: 'credential_grant',
      retryable: false,
    })
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(rawFailure)
  })

  it.each([
    ['operation_cancelled', true],
    ['remote_branch_diverged', true],
    ['remote_unavailable', true],
    ['push_result_unknown', true],
    ['publisher_cleanup_failed', true],
    ['workspace_dirty', false],
    ['workspace_mismatch', false],
    ['repository_mismatch', false],
    ['invalid_delivery_source', false],
  ] satisfies Array<[GitHubGitPublisherErrorCode, boolean]>) (
    'preserves the safe publisher outcome %s without raw git output',
    async (code, retryable) => {
      const fetcher = vi.fn(async () =>
        jsonResponse({
          request: deliveryRequest({ stateVersion: 4, status: 'publishing_branch' }),
          grant: credentialGrant(),
          credential: {
            grantId: 'grant-1',
            username: 'x-access-token',
            token: 'ghs_ephemeral_desktop_only',
            expiresAt: '2026-08-11T16:00:00.000Z',
            repositoryId: '98765',
            canonicalHttpsUrl: 'https://github.com/example/project.git',
          },
          outcomeCode: 'grant_finalized',
          replayed: false,
        }),
      )
      const client = createGitHubDeliveryRemoteClient({
        apiBaseUrl: 'https://api.devflow.test',
        authToken: 'desktop-secret-token',
        fetcher,
      })

      const error = await client.withCredentialGrant(
        { projectId, requestId, expectedStateVersion: 3 },
        async () => {
          throw new GitHubGitPublisherError(code)
        },
      ).catch((caught: unknown) => caught)

      expect(error).toMatchObject({
        name: 'GitHubDeliveryRemoteError',
        code,
        operation: 'credential_grant',
        retryable,
        outcomeCode: null,
        operatorOutcomeCode: code,
      })
      expect(JSON.stringify(error)).not.toContain('ghs_ephemeral_desktop_only')
      expect(JSON.stringify(error)).not.toContain('/Users/')
    },
  )

  it('reports a bounded publisher outcome and accepts only API-verified branch state', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        request: deliveryRequest({ stateVersion: 6, status: 'branch_published' }),
        publication: branchPublication(),
        outcomeCode: 'publication_verified',
        replayed: false,
      }),
    )
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher,
    })

    await expect(
      client.reportBranchPublication({
        projectId,
        requestId,
        grantId: 'grant-1',
        expectedStateVersion: 4,
        expectedGrantVersion: 2,
        reportedOutcomeCode: 'pushed',
      }),
    ).resolves.toEqual({
      request: deliveryRequest({ stateVersion: 6, status: 'branch_published' }),
      publication: branchPublication(),
      outcomeCode: 'publication_verified',
      replayed: false,
    })
    const requestInit = vi.mocked(fetcher as typeof fetch).mock.calls[0]?.[1]
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      grantId: 'grant-1',
      expectedStateVersion: 4,
      expectedGrantVersion: 2,
      reportedOutcomeCode: 'pushed',
    })
  })

  it('creates or reconciles only an exact Draft pull request outcome', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        request: deliveryRequest({
          stateVersion: 8,
          status: 'completed',
          outcomeCode: 'draft_pr_created',
        }),
        pullRequest: pullRequestOutcome(),
        outcomeCode: 'pull_request_completed',
        replayed: false,
      }),
    )
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher,
    })

    await expect(
      client.createDraftPullRequest({
        projectId,
        requestId,
        publicationId: 'publication-1',
        expectedStateVersion: 6,
      }),
    ).resolves.toEqual({
      request: deliveryRequest({
        stateVersion: 8,
        status: 'completed',
        outcomeCode: 'draft_pr_created',
      }),
      pullRequest: pullRequestOutcome(),
      outcomeCode: 'pull_request_completed',
      replayed: false,
    })
  })

  it('rejects an oversized response before parsing or reflecting its body', async () => {
    const responseSentinel = 'Bearer oversized-response-secret /Users/alice/private'
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          responseSentinel,
          padding: 'x'.repeat(1_100_000),
        }),
        { status: 200 },
      ),
    )
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher,
    })

    const error = await client.listInbox(projectId).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'GitHubDeliveryRemoteError',
      code: 'response_too_large',
      operation: 'inbox',
      retryable: true,
    })
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(responseSentinel)
  })

  it('preserves only an allowlisted rejection outcome from a non-2xx response', async () => {
    const rawMessage =
      'stale request leaked Authorization: Bearer remote-secret /Users/alice/private'
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          error: 'conflict',
          message: rawMessage,
          outcomeCode: 'stale_version',
          replayed: false,
        },
        409,
      ),
    )
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher,
    })

    const error = await client.listInbox(projectId).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'GitHubDeliveryRemoteError',
      status: 409,
      code: 'conflict',
      operation: 'inbox',
      retryable: false,
      outcomeCode: 'stale_version',
    })
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(rawMessage)
  })

  it.each([
    {
      status: 409,
      error: 'conflict',
      code: 'github_delivery_state_conflict',
      retryable: true,
      phase: 'credential',
      operation: 'credential_grant',
      expectedCode: 'conflict',
    },
    {
      status: 409,
      error: 'conflict',
      code: 'github_delivery_state_conflict',
      retryable: false,
      phase: 'publication',
      operation: 'branch_publication',
      expectedCode: 'conflict',
    },
    {
      status: 502,
      error: 'bad_gateway',
      code: 'github_authentication_failed',
      retryable: false,
      phase: 'credential',
      operation: 'credential_grant',
      expectedCode: 'service_unavailable',
    },
  ])(
    'preserves the trusted service retryability contract for $code ($retryable)',
    async ({ status, error, code, retryable, phase, operation, expectedCode }) => {
      const rawMessage =
        'GitHub failure leaked Authorization: Bearer remote-secret /Users/alice/private'
      const client = createGitHubDeliveryRemoteClient({
        apiBaseUrl: 'https://api.devflow.test',
        authToken: 'desktop-secret-token',
        fetcher: vi.fn(async () =>
          jsonResponse(
            {
              error,
              message: rawMessage,
              code,
              retryable,
              phase,
            },
            status,
          ),
        ),
      })

      const remoteError = await (operation === 'branch_publication'
        ? client.reportBranchPublication({
            projectId,
            requestId,
            grantId: 'grant-1',
            expectedStateVersion: 3,
            expectedGrantVersion: 1,
            reportedOutcomeCode: 'pushed',
          })
        : client.withCredentialGrant(
            { projectId, requestId, expectedStateVersion: 2 },
            async () => {
              throw new Error('publisher must not run for a failed credential request')
            },
          )
      ).catch((caught: unknown) => caught)

      expect(remoteError).toMatchObject({
        name: 'GitHubDeliveryRemoteError',
        status,
        code: expectedCode,
        operation,
        retryable,
        outcomeCode: null,
      })
      expect(`${String(remoteError)} ${JSON.stringify(remoteError)}`).not.toContain(
        rawMessage,
      )
    },
  )

  it('does not trust malformed or secret-bearing service error envelopes', async () => {
    const secretMessage =
      'Authorization: Bearer remote-secret at /Users/alice/private'
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'conflict',
            message: secretMessage,
            code: 'github_delivery_state_conflict',
            retryable: true,
            phase: 'credential',
            token: 'ghs_must-not-be-trusted',
          },
          409,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'bad_gateway',
            message: secretMessage,
            code: 'github_timeout',
            retryable: false,
            phase: 'credential',
          },
          502,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'conflict',
            message: secretMessage,
            code: 'github_delivery_state_conflict',
            retryable: true,
            phase: 'credential',
          },
          409,
        ),
      )
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher,
    })

    const extraField = await client
      .listInbox(projectId)
      .catch((caught: unknown) => caught)
    const inconsistentStatus = await client
      .listInbox(projectId)
      .catch((caught: unknown) => caught)
    const inconsistentPhase = await client
      .listInbox(projectId)
      .catch((caught: unknown) => caught)

    expect(extraField).toMatchObject({
      status: 409,
      code: 'conflict',
      retryable: false,
    })
    expect(inconsistentStatus).toMatchObject({
      status: 502,
      code: 'service_unavailable',
      retryable: true,
    })
    expect(inconsistentPhase).toMatchObject({
      status: 409,
      code: 'conflict',
      retryable: false,
    })
    expect(
      `${String(extraField)} ${JSON.stringify(extraField)} ${String(inconsistentStatus)} ${JSON.stringify(inconsistentStatus)} ${String(inconsistentPhase)} ${JSON.stringify(inconsistentPhase)}`,
    ).not.toContain(secretMessage)
  })

  it('enforces its own bounded timeout and sanitizes the aborted fetch failure', async () => {
    vi.useFakeTimers()
    try {
      const rawFailure =
        'fetch aborted with Bearer desktop-secret-token at /Users/alice/private'
      const fetcher = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new Error(rawFailure)),
              { once: true },
            )
            setTimeout(() => reject(new Error(rawFailure)), 50)
          }),
      ) as typeof fetch
      const client = createGitHubDeliveryRemoteClient({
        apiBaseUrl: 'https://api.devflow.test',
        authToken: 'desktop-secret-token',
        fetcher,
        timeoutMs: 5,
      })

      const result = client.listInbox(projectId).catch((caught: unknown) => caught)
      await vi.advanceTimersByTimeAsync(5)
      await vi.advanceTimersByTimeAsync(45)
      const error = await result

      expect(error).toMatchObject({
        name: 'GitHubDeliveryRemoteError',
        status: null,
        code: 'request_timeout',
        operation: 'inbox',
        retryable: true,
      })
      expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(rawFailure)
      expect(vi.mocked(fetcher).mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('turns malformed JSON and raw network failures into fixed non-reflective errors', async () => {
    const responseSentinel =
      'Authorization: Bearer response-secret at /Users/alice/private'
    const networkSentinel =
      'fetch failed with Bearer network-secret at /Users/bob/private'
    const malformedClient = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () => new Response(`{"requests": [${responseSentinel}`)),
    })
    const unavailableClient = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () => {
        throw new Error(networkSentinel)
      }),
    })

    const malformed = await malformedClient
      .listInbox(projectId)
      .catch((caught: unknown) => caught)
    const unavailable = await unavailableClient
      .listInbox(projectId)
      .catch((caught: unknown) => caught)

    expect(malformed).toMatchObject({
      code: 'invalid_response',
      operation: 'inbox',
    })
    expect(unavailable).toMatchObject({
      code: 'remote_unavailable',
      operation: 'inbox',
    })
    const serialized = `${String(malformed)} ${JSON.stringify(malformed)} ${String(unavailable)} ${JSON.stringify(unavailable)}`
    expect(serialized).not.toContain(responseSentinel)
    expect(serialized).not.toContain(networkSentinel)
  })

  it('fails closed on unknown envelope and nested projection fields', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          requests: [deliveryRequest()],
          token: 'must-not-be-accepted',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          requests: [
            {
              ...deliveryRequest(),
              authorizationHeader: 'Bearer must-not-be-accepted',
            },
          ],
        }),
      )
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher,
    })

    await expect(client.listInbox(projectId)).rejects.toMatchObject({
      code: 'invalid_response',
    })
    await expect(client.listInbox(projectId)).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })

  it('keeps the deadline active while a response body is still streaming', async () => {
    vi.useFakeTimers()
    try {
      const encoder = new TextEncoder()
      let cancelled = false
      const fetcher = vi.fn(async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true
            },
            start(controller) {
              setTimeout(() => {
                if (cancelled) return
                controller.enqueue(
                  encoder.encode(JSON.stringify({ requests: [deliveryRequest()] })),
                )
                controller.close()
              }, 50)
            },
          }),
        ),
      )
      const client = createGitHubDeliveryRemoteClient({
        apiBaseUrl: 'https://api.devflow.test',
        authToken: 'desktop-secret-token',
        fetcher,
        timeoutMs: 5,
      })

      const result = client.listInbox(projectId).catch((caught: unknown) => caught)
      await vi.advanceTimersByTimeAsync(50)
      const error = await result

      expect(error).toMatchObject({
        code: 'request_timeout',
        operation: 'inbox',
        retryable: true,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects unknown or secret-bearing submit intent fields before network I/O', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher,
    })

    await expect(
      client.submit({
        projectId,
        intent: {
          ...deliveryIntent(),
          token: 'ghs_must_not_be_sent',
        } as GitHubDeliveryIntent,
        prTitle: 'Deliver the approved change',
        prBody: 'Bound to exact evidence.',
        expectedStateVersion: 0,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
      operation: 'submit',
      retryable: false,
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('loads one complete redacted recovery snapshot for the exact request', async () => {
    const snapshot = {
      request: deliveryRequest({
        stateVersion: 8,
        status: 'completed',
        outcomeCode: 'draft_pr_created',
      }),
      approval: approval(),
      grant: credentialGrant({ status: 'consumed', consumedAt: now }),
      publication: branchPublication(),
      pullRequest: pullRequestOutcome(),
    }
    const fetcher = vi.fn(async () => jsonResponse({ snapshot }))
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher,
    })

    await expect(
      client.getRecoverySnapshot({ projectId, requestId }),
    ).resolves.toEqual(snapshot)
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.devflow.test/api/desktop/projects/project-a/github-deliveries/delivery-1',
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer desktop-secret-token',
        },
      }),
    )
  })

  it('accepts an approval-pending recovery snapshot with every later record null', async () => {
    const snapshot = {
      request: deliveryRequest(),
      approval: null,
      grant: null,
      publication: null,
      pullRequest: null,
    }
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () => jsonResponse({ snapshot })),
    })

    await expect(
      client.getRecoverySnapshot({ projectId, requestId }),
    ).resolves.toEqual(snapshot)
  })

  it('recovers the credential-issued crash window without inventing publication state', async () => {
    const snapshot = {
      request: deliveryRequest({ stateVersion: 4, status: 'publishing_branch' }),
      approval: approval(),
      grant: credentialGrant(),
      publication: null,
      pullRequest: null,
    }
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () => jsonResponse({ snapshot })),
    })

    await expect(
      client.getRecoverySnapshot({ projectId, requestId }),
    ).resolves.toEqual(snapshot)
  })

  it('recovers a replacement grant after an earlier publication required reconciliation', async () => {
    const snapshot = {
      request: deliveryRequest({ stateVersion: 6, status: 'publishing_branch' }),
      approval: approval(),
      grant: credentialGrant({ id: 'grant-2', version: 1, attempt: 2 }),
      publication: branchPublication({
        status: 'recovery_required',
        verifiedHeadSha: null,
        verifiedAt: null,
        outcomeCode: 'branch_verification_failed',
      }),
      pullRequest: null,
    }
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () => jsonResponse({ snapshot })),
    })

    await expect(
      client.getRecoverySnapshot({ projectId, requestId }),
    ).resolves.toEqual(snapshot)
  })

  it('parses the bounded credential-superseded recovery outcome', async () => {
    const snapshot = {
      request: deliveryRequest({
        stateVersion: 5,
        status: 'recovery_required',
        outcomeCode: 'credential_issue_failed',
      }),
      approval: approval(),
      grant: credentialGrant({
        version: 3,
        status: 'failed',
        outcomeCode: 'credential_superseded',
      }),
      publication: null,
      pullRequest: null,
    }
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () => jsonResponse({ snapshot })),
    })

    await expect(
      client.getRecoverySnapshot({ projectId, requestId }),
    ).resolves.toEqual(snapshot)
  })

  it.each([
    [
      'malformed snapshot envelope',
      { snapshot: { request: deliveryRequest() } },
    ],
    [
      'secret and local path fields',
      {
        snapshot: {
          request: deliveryRequest(),
          approval: null,
          grant: null,
          publication: null,
          pullRequest: null,
          token: 'ghs_snapshot_secret',
          workspacePath: '/Users/alice/private',
        },
      },
    ],
    [
      'cross-request approval',
      {
        snapshot: {
          request: deliveryRequest({ status: 'approved' }),
          approval: approval({ requestId: 'delivery-other' }),
          grant: null,
          publication: null,
          pullRequest: null,
        },
      },
    ],
    [
      'cross-revision grant',
      {
        snapshot: {
          request: deliveryRequest({ status: 'publishing_branch' }),
          approval: approval(),
          grant: credentialGrant({ intentRevision: 2 }),
          publication: null,
          pullRequest: null,
        },
      },
    ],
    [
      'cross-grant publication',
      {
        snapshot: {
          request: deliveryRequest({ status: 'branch_published' }),
          approval: approval(),
          grant: credentialGrant({ status: 'consumed', consumedAt: now }),
          publication: branchPublication({ grantId: 'grant-other' }),
          pullRequest: null,
        },
      },
    ],
    [
      'cross-grant publication outside the narrow replacement window',
      {
        snapshot: {
          request: deliveryRequest({ status: 'publishing_branch' }),
          approval: approval(),
          grant: credentialGrant({ id: 'grant-2', attempt: 2 }),
          publication: branchPublication(),
          pullRequest: null,
        },
      },
    ],
    [
      'cross-publication pull request',
      {
        snapshot: {
          request: deliveryRequest({
            status: 'completed',
            outcomeCode: 'draft_pr_created',
          }),
          approval: approval(),
          grant: credentialGrant({ status: 'consumed', consumedAt: now }),
          publication: branchPublication(),
          pullRequest: pullRequestOutcome({ publicationId: 'publication-other' }),
        },
      },
    ],
  ])('rejects %s in a recovery snapshot', async (_label, body) => {
    const client = createGitHubDeliveryRemoteClient({
      apiBaseUrl: 'https://api.devflow.test',
      authToken: 'desktop-secret-token',
      fetcher: vi.fn(async () => jsonResponse(body)),
    })

    const error = await client
      .getRecoverySnapshot({ projectId, requestId })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      code: 'invalid_response',
      operation: 'recovery_snapshot',
      retryable: true,
    })
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(
      /snapshot_secret|\/Users\/alice\/private/u,
    )
  })
})
