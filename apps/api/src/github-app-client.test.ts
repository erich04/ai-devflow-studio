import { describe, expect, it, vi } from 'vitest'
import {
  GitHubAppClientError,
  createGitHubAppClient,
  createGitHubDeliveryMarker,
  type GitHubAppClient,
} from './github-app-client'

const now = '2026-08-11T12:00:00.000Z'
const expiresAt = '2026-08-11T12:59:00.000Z'
const repository = 'erich04/ai-devflow-studio'
const installationId = '123'
const repositoryId = '456'
const baseBranch = 'main'
const headBranch = 'devflow/run-123'
const headSha = 'a'.repeat(40)
const baseSha = 'b'.repeat(40)
const idempotencyKey = `github-delivery:${'c'.repeat(64)}`
const marker = `<!-- devflow-delivery:${'c'.repeat(64)} -->`
const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK'
const issuanceDeadline = '2026-08-11T12:02:00.000Z'
const providerInstallationUrl = `https://api.github.com/app/installations/${installationId}`

function tokenResponse(
  permission: 'contents' | 'pull_requests',
  access: 'read' | 'write',
  token = `ghs_${'x'.repeat(40)}`,
): Response {
  return Response.json({
    token,
    expires_at: expiresAt,
    repository_selection: 'selected',
    permissions: {
      metadata: 'read',
      [permission]: access,
    },
    repositories: [{ id: Number(repositoryId) }],
  }, { status: 201 })
}

function providerObservationResponse(input: {
  body?: unknown
  date?: string
  status?: number
  url?: string
  redirected?: boolean
} = {}): Response {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (input.date !== undefined) headers.set('date', input.date)
  const response = new Response(
    JSON.stringify(input.body ?? { id: Number(installationId), app_id: 789 }),
    { status: input.status ?? 200, headers },
  )
  Object.defineProperty(response, 'url', {
    value: input.url ?? providerInstallationUrl,
  })
  if (input.redirected !== undefined) {
    Object.defineProperty(response, 'redirected', { value: input.redirected })
  }
  return response
}

function pullRequestResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 987,
    number: 17,
    html_url: `https://github.com/${repository}/pull/17`,
    state: 'open',
    draft: true,
    created_at: now,
    body: `Delivery package\n\n${marker}`,
    head: {
      ref: headBranch,
      sha: headSha,
      repo: { id: Number(repositoryId), full_name: repository },
    },
    base: {
      ref: baseBranch,
      sha: baseSha,
      repo: { id: Number(repositoryId), full_name: repository },
    },
    ...overrides,
  }
}

function makeClient(fetcher: typeof fetch): GitHubAppClient {
  return createGitHubAppClient({
    appId: '789',
    fetcher,
    clock: () => new Date(now),
    signJwt: vi.fn(async (claims) => {
      expect(claims).toMatchObject({
        iss: '789',
        iat: Math.floor(Date.parse(now) / 1_000) - 60,
      })
      expect(claims.exp).toBeGreaterThan(Math.floor(Date.parse(now) / 1_000))
      return `app-jwt-${'j'.repeat(32)}`
    }),
  })
}

function deliveryInput() {
  return {
    installationId,
    repositoryId,
    repository,
    baseBranch,
    headBranch,
    expectedHeadSha: headSha,
    idempotencyKey,
  }
}

describe('GitHub App client', () => {
  it('issues one short-lived repository-scoped Contents write token', async () => {
    const token = `ghs_${secretSentinel}_${'x'.repeat(24)}`
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        tokenResponse('contents', 'write', token),
    )
    const client = makeClient(fetcher)

    await expect(
      client.issueContentsWriteToken({
        installationId,
        repositoryId,
        issuanceDeadline,
      }),
    ).resolves.toEqual({
      token,
      expiresAt,
      providerExpiresAt: expiresAt,
      installationId,
      repositoryId,
      permissions: { contents: 'write' },
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe(`https://api.github.com/app/installations/${installationId}/access_tokens`)
    expect(init).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: expect.stringMatching(/^Bearer app-jwt-/u),
      }),
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      repository_ids: [Number(repositoryId)],
      permissions: { contents: 'write' },
    })
  })

  it('rejects a non-201 mint response as ambiguous after crossing the provider boundary', async () => {
    const response = tokenResponse('contents', 'write')
    const body = await response.json()
    const fetcher = vi.fn(async () => Response.json(body, { status: 200 }))
    const client = createGitHubAppClient({
      appId: '789',
      fetcher,
      clock: () => new Date(now),
      signJwt: vi.fn(async () => `app-jwt-${'j'.repeat(32)}`),
    })

    await expect(
      client.issueContentsWriteToken({
        installationId,
        repositoryId,
        issuanceDeadline,
      }),
    ).rejects.toMatchObject({
      code: 'github_request_rejected',
      providerCredentialAbsentConfirmed: false,
      credentialRevocationConfirmed: false,
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('clamps the mint App JWT to the absolute issuance deadline', async () => {
    const signJwt = vi.fn(async () => `app-jwt-${'j'.repeat(32)}`)
    const fetcher = vi.fn(async () => tokenResponse('contents', 'write'))
    const client = createGitHubAppClient({
      appId: '789',
      fetcher,
      clock: () => new Date(now),
      signJwt,
    })

    await client.issueContentsWriteToken({
      installationId,
      repositoryId,
      issuanceDeadline,
    })

    expect(signJwt).toHaveBeenCalledWith({
      iss: '789',
      iat: Math.floor(Date.parse(now) / 1_000) - 60,
      exp: Math.floor(Date.parse(issuanceDeadline) / 1_000),
    })
  })

  it('does not POST when asynchronous signing crosses the absolute issuance deadline', async () => {
    let current = new Date(now)
    const fetcher = vi.fn()
    const client = createGitHubAppClient({
      appId: '789',
      fetcher,
      clock: () => current,
      signJwt: vi.fn(async () => {
        current = new Date(issuanceDeadline)
        return `app-jwt-${'j'.repeat(32)}`
      }),
    })

    await expect(
      client.issueContentsWriteToken({
        installationId,
        repositoryId,
        issuanceDeadline,
      }),
    ).rejects.toMatchObject({
      code: 'github_invalid_request',
      providerCredentialAbsentConfirmed: true,
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not sign or POST at the absolute issuance deadline', async () => {
    const signJwt = vi.fn()
    const fetcher = vi.fn()
    const client = createGitHubAppClient({
      appId: '789',
      fetcher,
      clock: () => new Date(issuanceDeadline),
      signJwt,
    })

    await expect(
      client.issueContentsWriteToken({
        installationId,
        repositoryId,
        issuanceDeadline,
      }),
    ).rejects.toMatchObject({
      code: 'github_invalid_request',
      providerCredentialAbsentConfirmed: true,
    })
    expect(signJwt).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('allows the provider POST at the last representable millisecond before the deadline', async () => {
    const signJwt = vi.fn(async () => `app-jwt-${'j'.repeat(32)}`)
    const fetcher = vi.fn(async () => tokenResponse('contents', 'write'))
    const client = createGitHubAppClient({
      appId: '789',
      fetcher,
      clock: () => new Date('2026-08-11T12:01:59.999Z'),
      signJwt,
    })

    await expect(
      client.issueContentsWriteToken({
        installationId,
        repositoryId,
        issuanceDeadline,
      }),
    ).resolves.toMatchObject({
      repositoryId,
      permissions: { contents: 'write' },
    })
    expect(signJwt).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['missing', { installationId, repositoryId }],
    [
      'non-canonical',
      {
        installationId,
        repositoryId,
        issuanceDeadline: '2026-08-11T12:02:00Z',
      },
    ],
  ])('rejects a %s issuance deadline before signing or POSTing', async (_label, authority) => {
    const signJwt = vi.fn()
    const fetcher = vi.fn()
    const client = createGitHubAppClient({
      appId: '789',
      fetcher,
      clock: () => new Date(now),
      signJwt,
    })

    await expect(
      Reflect.apply(client.issueContentsWriteToken, client, [authority]),
    ).rejects.toMatchObject({
      code: 'github_invalid_request',
      providerCredentialAbsentConfirmed: true,
    })
    expect(signJwt).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    ['null authority', null],
    [
      'throwing deadline getter',
      Object.defineProperty(
        { installationId, repositoryId },
        'issuanceDeadline',
        { get: () => { throw new Error(secretSentinel) } },
      ),
    ],
  ])('turns a runtime %s failure into a safe confirmed absence', async (_label, authority) => {
    const fetcher = vi.fn()
    const client = makeClient(fetcher)

    const error = await Reflect.apply(client.issueContentsWriteToken, client, [authority])
      .catch((reason: unknown) => reason)

    expect(error).toMatchObject({
      code: 'github_invalid_request',
      providerCredentialAbsentConfirmed: true,
    })
    expect(String(error)).not.toContain(secretSentinel)
    expect(JSON.stringify(error)).not.toContain(secretSentinel)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fails closed when a sub-second deadline cannot produce a future JWT exp', async () => {
    const signJwt = vi.fn()
    const fetcher = vi.fn()
    const client = createGitHubAppClient({
      appId: '789',
      fetcher,
      clock: () => new Date('2026-08-11T12:02:00.500Z'),
      signJwt,
    })

    await expect(
      client.issueContentsWriteToken({
        installationId,
        repositoryId,
        issuanceDeadline: '2026-08-11T12:02:00.900Z',
      }),
    ).rejects.toMatchObject({
      code: 'github_invalid_request',
      providerCredentialAbsentConfirmed: true,
    })
    expect(signJwt).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('revokes one installation access token only through strict no-content success', async () => {
    const token = `ghs_${secretSentinel}_${'r'.repeat(24)}`
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    )
    const client = makeClient(fetcher)

    await expect(client.revokeInstallationAccessToken(token)).resolves.toBeUndefined()

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/installation/token',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ authorization: `Bearer ${token}` }),
        signal: expect.any(AbortSignal),
      }),
    )
    const [, init] = fetcher.mock.calls[0]!
    expect(init?.body).toBeUndefined()
  })

  it.each([200, 202, 401, 500])(
    'fails closed with a fixed non-retryable error when token revocation returns %i',
    async (status) => {
      const token = `ghs_${secretSentinel}_${'r'.repeat(24)}`
      const client = makeClient(
        vi.fn(async () => new Response(secretSentinel, { status })),
      )

      const error = await client
        .revokeInstallationAccessToken(token)
        .catch((reason: unknown) => reason)

      expect(error).toBeInstanceOf(GitHubAppClientError)
      if (!(error instanceof GitHubAppClientError)) {
        throw new Error('expected a typed GitHub App client error')
      }
      expect(error).toMatchObject({
        code: 'github_credential_revocation_unconfirmed',
        retryable: false,
      })
      expect(error.status).toBeUndefined()
      expect(error).not.toHaveProperty('cause')
      expect(String(error)).not.toContain(secretSentinel)
      expect(JSON.stringify(error)).not.toContain(secretSentinel)
    },
  )

  it('bounds token revocation independently when the fetcher ignores AbortSignal', async () => {
    const token = `ghs_${secretSentinel}_${'r'.repeat(24)}`
    let signal: AbortSignal | undefined
    const client = createGitHubAppClient({
      appId: '789',
      fetcher: vi.fn(async (_url, init) => {
        signal = init?.signal ?? undefined
        return new Promise<Response>(() => undefined)
      }),
      clock: () => new Date(now),
      signJwt: async () => `app-jwt-${'j'.repeat(32)}`,
      requestTimeoutMs: 10,
    })

    await expect(client.revokeInstallationAccessToken(token)).rejects.toMatchObject({
      code: 'github_credential_revocation_unconfirmed',
      retryable: false,
    })
    expect(signal?.aborted).toBe(true)
  })

  it('maps an aborted token revocation request to the fixed unconfirmed result', async () => {
    const token = `ghs_${secretSentinel}_${'r'.repeat(24)}`
    const client = makeClient(
      vi.fn(async () => {
        throw new DOMException(secretSentinel, 'AbortError')
      }),
    )

    const error = await client
      .revokeInstallationAccessToken(token)
      .catch((reason: unknown) => reason)

    expect(error).toMatchObject({
      code: 'github_credential_revocation_unconfirmed',
      retryable: false,
    })
    expect(String(error)).not.toContain(secretSentinel)
    expect(JSON.stringify(error)).not.toContain(secretSentinel)
  })

  it('rejects an invalid token before attempting revocation network access', async () => {
    const fetcher = vi.fn()
    const client = makeClient(fetcher)

    await expect(
      client.revokeInstallationAccessToken('bad token\nAuthorization: secret'),
    ).rejects.toMatchObject({ code: 'github_invalid_request', retryable: false })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not attempt compensation for a malformed provider token', async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          token: `bad token\n${secretSentinel}`,
          expires_at: expiresAt,
          repository_selection: 'selected',
          permissions: { metadata: 'read', contents: 'write' },
          repositories: [{ id: Number(repositoryId) }],
        },
        { status: 201 },
      ),
    )
    const client = makeClient(fetcher)

    const error = await client
      .issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline })
      .catch((reason: unknown) => reason)

    expect(error).toMatchObject({ code: 'github_malformed_response', retryable: false })
    expect(String(error)).not.toContain(secretSentinel)
    expect(JSON.stringify(error)).not.toContain(secretSentinel)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects an over-broad installation token grant', async () => {
    const broadFetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            token: `ghs_${'x'.repeat(40)}`,
            expires_at: expiresAt,
            repository_selection: 'selected',
            permissions: { metadata: 'read', contents: 'write', pull_requests: 'write' },
            repositories: [{ id: Number(repositoryId) }],
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const broad = makeClient(broadFetcher)
    await expect(
      broad.issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline }),
    ).rejects.toMatchObject({ code: 'github_scope_mismatch' })
    expect(broadFetcher).toHaveBeenCalledTimes(2)
  })

  it('clamps a valid provider expiry that is one millisecond beyond the local receipt hour', async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          token: `ghs_${'x'.repeat(40)}`,
          expires_at: '2026-08-11T13:00:00.001Z',
          repository_selection: 'selected',
          permissions: { metadata: 'read', contents: 'write' },
          repositories: [{ id: Number(repositoryId) }],
        },
        { status: 201 },
      ),
    )

    await expect(
      makeClient(fetcher).issueContentsWriteToken({
        installationId,
        repositoryId,
        issuanceDeadline,
      }),
    ).resolves.toMatchObject({
      expiresAt: '2026-08-11T13:00:00.000Z',
      providerExpiresAt: '2026-08-11T13:00:00.001Z',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('accepts GitHub provider expiry at official whole-second precision and canonicalizes it', async () => {
    const token = `ghs_${'x'.repeat(40)}`
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          token,
          expires_at: '2026-08-11T12:59:00Z',
          repository_selection: 'selected',
          permissions: { metadata: 'read', contents: 'write' },
          repositories: [{ id: Number(repositoryId) }],
        },
        { status: 201 },
      ),
    )

    await expect(
      makeClient(fetcher).issueContentsWriteToken({
        installationId,
        repositoryId,
        issuanceDeadline,
      }),
    ).resolves.toMatchObject({
      expiresAt: '2026-08-11T12:59:00.000Z',
      providerExpiresAt: '2026-08-11T12:59:00.000Z',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['non-exact fractional precision', '2026-08-11T12:59:00.00Z'],
    ['numeric offset', '2026-08-11T12:59:00+00:00'],
    ['impossible calendar date', '2026-02-31T12:59:00Z'],
    ['trailing data', '2026-08-11T12:59:00Z junk'],
  ])('revokes a minted credential with %s in provider expiry', async (_label, expires_at) => {
    const token = `ghs_${'x'.repeat(40)}`
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            token,
            expires_at,
            repository_selection: 'selected',
            permissions: { metadata: 'read', contents: 'write' },
            repositories: [{ id: Number(repositoryId) }],
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(
      makeClient(fetcher).issueContentsWriteToken({
        installationId,
        repositoryId,
        issuanceDeadline,
      }),
    ).rejects.toMatchObject({
      code: 'github_malformed_response',
      credentialRevocationConfirmed: true,
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('observes provider credential expiry at the exact two-second safety boundary', async () => {
    const response = Response.json(
      { id: Number(installationId), app_id: 789 },
      {
        status: 200,
        headers: { date: 'Tue, 11 Aug 2026 13:00:02 GMT' },
      },
    )
    Object.defineProperty(response, 'url', { value: providerInstallationUrl })
    const fetcher = vi.fn(async () => response)

    await expect(
      makeClient(fetcher).observeProviderCredentialExpiry({
        installationId,
        providerExpiresAt: '2026-08-11T13:00:00.000Z',
      }),
    ).resolves.toEqual({
      installationId,
      providerExpiresAt: '2026-08-11T13:00:00.000Z',
      providerObservedAt: '2026-08-11T13:00:02.000Z',
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(
      providerInstallationUrl,
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        headers: expect.objectContaining({
          authorization: expect.stringMatching(/^Bearer app-jwt-/u),
          'cache-control': 'no-store',
        }),
      }),
    )
  })

  it('rejects a provider observation only 1.999 seconds beyond expiry', async () => {
    const response = Response.json(
      { id: Number(installationId), app_id: 789 },
      {
        status: 200,
        headers: { date: 'Tue, 11 Aug 2026 13:00:02 GMT' },
      },
    )
    Object.defineProperty(response, 'url', { value: providerInstallationUrl })
    const fetcher = vi.fn(async () => response)

    await expect(
      makeClient(fetcher).observeProviderCredentialExpiry({
        installationId,
        providerExpiresAt: '2026-08-11T13:00:00.001Z',
      }),
    ).rejects.toMatchObject({ code: 'github_conflict', retryable: false })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['missing', undefined],
    ['obsolete RFC 850', 'Tuesday, 11-Aug-26 13:00:02 GMT'],
    ['wrong weekday', 'Mon, 11 Aug 2026 13:00:02 GMT'],
    ['impossible date', 'Tue, 31 Feb 2026 13:00:02 GMT'],
    ['invalid hour', 'Tue, 11 Aug 2026 24:00:02 GMT'],
    ['trailing data', 'Tue, 11 Aug 2026 13:00:02 GMT junk'],
  ])('rejects a %s provider Date header', async (_label, date) => {
    const fetcher = vi.fn(async () =>
      providerObservationResponse(date === undefined ? {} : { date }),
    )

    await expect(
      makeClient(fetcher).observeProviderCredentialExpiry({
        installationId,
        providerExpiresAt: '2026-08-11T13:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'github_malformed_response', retryable: false })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects comma-combined duplicate provider Date headers', async () => {
    const date = 'Tue, 11 Aug 2026 13:00:02 GMT'
    const response = providerObservationResponse({ date })
    response.headers.append('date', date)
    const fetcher = vi.fn(async () => response)

    await expect(
      makeClient(fetcher).observeProviderCredentialExpiry({
        installationId,
        providerExpiresAt: '2026-08-11T13:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'github_malformed_response', retryable: false })
  })

  it.each([
    ['far behind', '2001-01-01T00:00:00.000Z'],
    ['far ahead', '2099-01-01T00:00:00.000Z'],
  ])('does not use a local clock that is %s to prove provider expiry', async (_label, localNow) => {
    const fetcher = vi.fn(async () =>
      providerObservationResponse({ date: 'Tue, 11 Aug 2026 13:00:02 GMT' }),
    )
    const client = createGitHubAppClient({
      appId: '789',
      fetcher,
      clock: () => new Date(localNow),
      signJwt: async () => `app-jwt-${'j'.repeat(32)}`,
    })

    await expect(
      client.observeProviderCredentialExpiry({
        installationId,
        providerExpiresAt: '2026-08-11T13:00:00.000Z',
      }),
    ).resolves.toMatchObject({ providerObservedAt: '2026-08-11T13:00:02.000Z' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['missing installation id', { app_id: 789 }, 'github_malformed_response'],
    ['missing app id', { id: Number(installationId) }, 'github_malformed_response'],
    ['wrong installation id', { id: 124, app_id: 789 }, 'github_conflict'],
    ['wrong app id', { id: Number(installationId), app_id: 790 }, 'github_conflict'],
    [
      'non-canonical app id',
      { id: Number(installationId), app_id: '0789' },
      'github_malformed_response',
    ],
  ])('rejects a provider observation body with %s', async (_label, body, code) => {
    const fetcher = vi.fn(async () =>
      providerObservationResponse({
        body,
        date: 'Tue, 11 Aug 2026 13:00:02 GMT',
      }),
    )

    await expect(
      makeClient(fetcher).observeProviderCredentialExpiry({
        installationId,
        providerExpiresAt: '2026-08-11T13:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code, retryable: false })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['an unavailable final URL', { url: '' }],
    ['a mismatched final URL', { url: `${providerInstallationUrl}/redirected` }],
    ['a redirected response', { redirected: true }],
  ])('rejects %s for a provider observation', async (_label, responseOverrides) => {
    const fetcher = vi.fn(async () =>
      providerObservationResponse({
        date: 'Tue, 11 Aug 2026 13:00:02 GMT',
        ...responseOverrides,
      }),
    )

    await expect(
      makeClient(fetcher).observeProviderCredentialExpiry({
        installationId,
        providerExpiresAt: '2026-08-11T13:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'github_malformed_response', retryable: false })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('requires exact HTTP 200 for a provider observation', async () => {
    const fetcher = vi.fn(async () =>
      providerObservationResponse({
        date: 'Tue, 11 Aug 2026 13:00:02 GMT',
        status: 201,
      }),
    )

    await expect(
      makeClient(fetcher).observeProviderCredentialExpiry({
        installationId,
        providerExpiresAt: '2026-08-11T13:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'github_request_rejected', status: 201 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('bounds a provider observation when the fetcher ignores AbortSignal', async () => {
    let signal: AbortSignal | undefined
    const fetcher = vi.fn(async (_url, init) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => undefined)
    })
    const client = createGitHubAppClient({
      appId: '789',
      fetcher,
      clock: () => new Date(now),
      signJwt: async () => `app-jwt-${'j'.repeat(32)}`,
      requestTimeoutMs: 10,
    })

    await expect(
      client.observeProviderCredentialExpiry({
        installationId,
        providerExpiresAt: '2026-08-11T13:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'github_timeout', retryable: true })
    expect(signal?.aborted).toBe(true)
  })

  it('rejects an oversized provider observation body', async () => {
    const fetcher = vi.fn(async () =>
      providerObservationResponse({
        body: { padding: 'x'.repeat(300_000) },
        date: 'Tue, 11 Aug 2026 13:00:02 GMT',
      }),
    )

    await expect(
      makeClient(fetcher).observeProviderCredentialExpiry({
        installationId,
        providerExpiresAt: '2026-08-11T13:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'github_response_too_large', retryable: false })
  })

  it('never leaks provider observation response or transport secrets', async () => {
    const responseSecret = `ghs_${secretSentinel}_${'s'.repeat(24)}`
    const bodyFailure = makeClient(
      vi.fn(async () =>
        providerObservationResponse({
          body: { id: 124, app_id: 789, token: responseSecret },
          date: 'Tue, 11 Aug 2026 13:00:02 GMT',
        }),
      ),
    )
    const bodyError = await bodyFailure
      .observeProviderCredentialExpiry({
        installationId,
        providerExpiresAt: '2026-08-11T13:00:00.000Z',
      })
      .catch((reason: unknown) => reason)
    expect(bodyError).toMatchObject({ code: 'github_conflict' })
    expect(String(bodyError)).not.toContain(secretSentinel)
    expect(JSON.stringify(bodyError)).not.toContain(secretSentinel)

    const transportFailure = makeClient(
      vi.fn(async () => {
        throw new Error(secretSentinel)
      }),
    )
    const transportError = await transportFailure
      .observeProviderCredentialExpiry({
        installationId,
        providerExpiresAt: '2026-08-11T13:00:00.000Z',
      })
      .catch((reason: unknown) => reason)
    expect(transportError).toMatchObject({ code: 'github_unavailable' })
    expect(String(transportError)).not.toContain(secretSentinel)
    expect(JSON.stringify(transportError)).not.toContain(secretSentinel)
  })

  it.each([5_001, 8_192])(
    'accepts one valid provider credential with %i characters',
    async (length) => {
      const token = `g${'x'.repeat(length - 1)}`
      const fetcher = vi.fn(async () =>
        Response.json(
          {
            token,
            expires_at: expiresAt,
            repository_selection: 'selected',
            permissions: { metadata: 'read', contents: 'write' },
            repositories: [{ id: Number(repositoryId) }],
          },
          { status: 201 },
        ),
      )
      const client = makeClient(fetcher)

      await expect(
        client.issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline }),
      ).resolves.toMatchObject({ token })
      expect(fetcher).toHaveBeenCalledTimes(1)
    },
  )

  it('deletes an 8193-character provider credential before rejecting it', async () => {
    const token = `g${'x'.repeat(8_192)}`
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            token,
            expires_at: expiresAt,
            repository_selection: 'selected',
            permissions: { metadata: 'read', contents: 'write' },
            repositories: [{ id: Number(repositoryId) }],
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const client = makeClient(fetcher)

    const error = await client
      .issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline })
      .catch((reason: unknown) => reason)

    expect(error).toMatchObject({
      code: 'github_malformed_response',
      retryable: false,
      credentialRevocationConfirmed: true,
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1]).toEqual([
      'https://api.github.com/installation/token',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ authorization: `Bearer ${token}` }),
      }),
    ])
  })

  it('returns only a typed confirmed failure when post-token clock validation throws', async () => {
    const token = `ghs_${secretSentinel}_${'c'.repeat(24)}`
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            token,
            expires_at: expiresAt,
            repository_selection: 'selected',
            permissions: { metadata: 'read', contents: 'write' },
            repositories: [{ id: Number(repositoryId) }],
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    let clockCalls = 0
    const client = createGitHubAppClient({
      appId: '789',
      fetcher,
      clock: () => {
        clockCalls += 1
        if (clockCalls <= 2) return new Date(now)
        throw new Error(`RAW_CLOCK_${secretSentinel}`)
      },
      signJwt: async () => `app-jwt-${'j'.repeat(32)}`,
    })

    const error = await client
      .issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(GitHubAppClientError)
    expect(error).toMatchObject({
      code: 'github_invalid_request',
      retryable: false,
      credentialRevocationConfirmed: true,
    })
    expect(error).not.toHaveProperty('cause')
    expect(String(error)).not.toContain(secretSentinel)
    expect(JSON.stringify(error)).not.toContain(secretSentinel)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1]).toEqual([
      'https://api.github.com/installation/token',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ authorization: `Bearer ${token}` }),
      }),
    ])
  })

  it('revokes a valid provider token before rejecting its invalid expiry', async () => {
    const token = `ghs_${secretSentinel}_${'e'.repeat(24)}`
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            token,
            expires_at: now,
            repository_selection: 'selected',
            permissions: { metadata: 'read', contents: 'write' },
            repositories: [{ id: Number(repositoryId) }],
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const client = makeClient(fetcher)

    const error = await client
      .issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline })
      .catch((reason: unknown) => reason)

    expect(error).toMatchObject({ code: 'github_scope_mismatch', retryable: false })
    expect(String(error)).not.toContain(token)
    expect(JSON.stringify(error)).not.toContain(token)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1]).toEqual([
      'https://api.github.com/installation/token',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ authorization: `Bearer ${token}` }),
      }),
    ])
  })

  it('masks provider validation failure when compensation cannot be confirmed', async () => {
    const token = `ghs_${secretSentinel}_${'u'.repeat(24)}`
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            token,
            expires_at: now,
            repository_selection: 'selected',
            permissions: { metadata: 'read', contents: 'write' },
            repositories: [{ id: Number(repositoryId) }],
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(secretSentinel, { status: 401 }))
    const client = makeClient(fetcher)

    const error = await client
      .issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(GitHubAppClientError)
    expect(error).toMatchObject({
      code: 'github_credential_revocation_unconfirmed',
      retryable: false,
    })
    expect(error).not.toHaveProperty('cause')
    expect(String(error)).not.toContain(token)
    expect(JSON.stringify(error)).not.toContain(token)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['repository selection', { repository_selection: 'all' }],
    [
      'over-broad permissions',
      { permissions: { metadata: 'read', contents: 'write', pull_requests: 'write' } },
    ],
    ['wrong repository', { repositories: [{ id: 999 }] }],
    [
      'duplicate repositories',
      { repositories: [{ id: Number(repositoryId) }, { id: Number(repositoryId) }] },
    ],
  ])('revokes a valid provider token before rejecting %s', async (_label, override) => {
    const token = `ghs_${secretSentinel}_${'s'.repeat(24)}`
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            token,
            expires_at: expiresAt,
            repository_selection: 'selected',
            permissions: { metadata: 'read', contents: 'write' },
            repositories: [{ id: Number(repositoryId) }],
            ...override,
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const client = makeClient(fetcher)

    const error = await client
      .issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline })
      .catch((reason: unknown) => reason)

    expect(error).toMatchObject({ code: 'github_scope_mismatch', retryable: false })
    expect(String(error)).not.toContain(token)
    expect(JSON.stringify(error)).not.toContain(token)
    expect(fetcher).toHaveBeenCalledTimes(2)
    const [url, init] = fetcher.mock.calls[1]!
    expect(url).toBe('https://api.github.com/installation/token')
    expect(init).toMatchObject({
      method: 'DELETE',
      headers: expect.objectContaining({ authorization: `Bearer ${token}` }),
    })
    expect(init?.body).toBeUndefined()
  })

  it('verifies the exact installation repository through a narrowed read token', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('contents', 'read'))
      .mockResolvedValueOnce(
        Response.json({
          id: Number(repositoryId),
          full_name: repository,
          default_branch: baseBranch,
          private: true,
          archived: false,
          disabled: false,
          visibility: 'private',
        }),
      )
    const client = makeClient(fetcher)

    await expect(
      client.verifyRepository({ installationId, repositoryId }),
    ).resolves.toEqual({
      installationId,
      repositoryId,
      repository,
      defaultBranch: baseBranch,
      private: true,
      visibility: 'private',
      verifiedAt: now,
    })
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      `https://api.github.com/repositories/${repositoryId}`,
    )
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({ authorization: expect.stringMatching(/^Bearer ghs_/u) }),
    })
  })

  it('strictly parses the exact branch head commit', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('contents', 'read'))
      .mockResolvedValueOnce(
        Response.json({
          ref: `refs/heads/${headBranch}`,
          object: { type: 'commit', sha: headSha },
        }),
      )
    const client = makeClient(fetcher)

    await expect(
      client.getBranchHead({ installationId, repositoryId, repository, branch: headBranch }),
    ).resolves.toEqual({ repository, branch: headBranch, sha: headSha, verifiedAt: now })
    expect(String(fetcher.mock.calls[1]?.[0])).toContain(
      `/repos/${repository}/git/ref/heads/${encodeURIComponent(headBranch)}`,
    )
  })

  it('finds only the matching open Draft PR marker, refs, repository, and commit', async () => {
    const internalToken = `ghs_${secretSentinel}_${'p'.repeat(24)}`
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('pull_requests', 'write', internalToken))
      .mockResolvedValueOnce(Response.json([pullRequestResponse()]))
    const client = makeClient(fetcher)

    const result = await client.findDraftPullRequest(deliveryInput())
    expect(result).toEqual({
      id: '987',
      number: 17,
      url: `https://github.com/${repository}/pull/17`,
      repository,
      baseBranch,
      headBranch,
      headSha,
      state: 'open',
      draft: true,
      marker,
      createdAt: now,
    })
    expect(JSON.stringify(result)).not.toContain(internalToken)
    const listUrl = new URL(String(fetcher.mock.calls[1]?.[0]))
    expect(listUrl.pathname).toBe(`/repos/${repository}/pulls`)
    expect(listUrl.searchParams.get('state')).toBe('all')
    expect(listUrl.searchParams.get('base')).toBe(baseBranch)
    expect(listUrl.searchParams.get('head')).toBe(`erich04:${headBranch}`)
  })

  it('creates only a Draft PR and appends the deterministic marker itself', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('pull_requests', 'write'))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json(pullRequestResponse(), { status: 201 }))
    const client = makeClient(fetcher)

    await expect(
      client.findOrCreateDraftPullRequest({
        ...deliveryInput(),
        title: 'Deliver the approved change',
        body: 'Delivery package',
      }),
    ).resolves.toMatchObject({
      disposition: 'created',
      pullRequest: { number: 17, draft: true, marker },
    })

    expect(fetcher).toHaveBeenCalledTimes(3)
    const [url, init] = fetcher.mock.calls[2]!
    expect(url).toBe(`https://api.github.com/repos/${repository}/pulls`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      title: 'Deliver the approved change',
      body: `Delivery package\n\n${marker}`,
      head: headBranch,
      base: baseBranch,
      draft: true,
    })
  })

  it('reconciles an ambiguous create by marker without repeating the write', async () => {
    let listCount = 0
    let createCount = 0
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      if (target.includes('/access_tokens')) {
        return tokenResponse('pull_requests', 'write')
      }
      if (init?.method === 'POST' && target.endsWith('/pulls')) {
        createCount += 1
        return new Response(JSON.stringify({ message: secretSentinel }), {
          status: 503,
          headers: { 'x-secret-debug': secretSentinel },
        })
      }
      listCount += 1
      return Response.json(listCount === 1 ? [] : [pullRequestResponse()])
    })
    const client = makeClient(fetcher)

    await expect(
      client.findOrCreateDraftPullRequest({
        ...deliveryInput(),
        title: 'Deliver the approved change',
        body: 'Delivery package',
      }),
    ).resolves.toMatchObject({ disposition: 'reconciled', pullRequest: { number: 17 } })
    expect(createCount).toBe(1)
    expect(listCount).toBe(2)
  })

  it('treats a Retry-After 422 from Draft PR creation as recoverable rate limiting', async () => {
    let listCount = 0
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      if (target.includes('/access_tokens')) {
        return tokenResponse('pull_requests', 'write')
      }
      if (init?.method === 'POST' && target.endsWith('/pulls')) {
        return new Response(JSON.stringify({ message: secretSentinel }), {
          status: 422,
          headers: { 'retry-after': '60', 'x-secret-debug': secretSentinel },
        })
      }
      listCount += 1
      return Response.json([])
    })

    const error = await makeClient(fetcher)
      .findOrCreateDraftPullRequest({
        ...deliveryInput(),
        title: 'Deliver the approved change',
        body: 'Delivery package',
      })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(GitHubAppClientError)
    expect(error).toMatchObject({
      code: 'github_rate_limited',
      status: 422,
      retryable: true,
      retryAfterSeconds: 60,
    })
    expect(String(error)).not.toContain(secretSentinel)
    expect(JSON.stringify(error)).not.toContain(secretSentinel)
    expect(listCount).toBe(2)
  })

  it('treats a canonical Retry-After 403 as recoverable rate limiting', async () => {
    const client = makeClient(
      vi.fn(async () =>
        new Response(JSON.stringify({ message: secretSentinel }), {
          status: 403,
          headers: { 'retry-after': '120', 'x-secret-debug': secretSentinel },
        }),
      ),
    )

    const error = await client
      .issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(GitHubAppClientError)
    expect(error).toMatchObject({
      code: 'github_rate_limited',
      status: 403,
      retryable: true,
      retryAfterSeconds: 120,
    })
    expect(String(error)).not.toContain(secretSentinel)
    expect(JSON.stringify(error)).not.toContain(secretSentinel)
  })

  it.each([
    ['0', 'github_validation_failed'],
    ['86401', 'github_validation_failed'],
    ['60.0', 'github_validation_failed'],
    ['Wed, 12 Aug 2026 12:00:00 GMT', 'github_validation_failed'],
  ] as const)(
    'does not trust malformed or out-of-range Retry-After %s on a 422',
    async (retryAfter, code) => {
      const client = makeClient(
        vi.fn(async () =>
          new Response(JSON.stringify({ message: secretSentinel }), {
            status: 422,
            headers: { 'retry-after': retryAfter },
          }),
        ),
      )

      await expect(
        client.issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline }),
      ).rejects.toMatchObject({ code, retryable: false })
    },
  )

  it('fails closed when the same branch already has an incompatible PR marker', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('pull_requests', 'write'))
      .mockResolvedValueOnce(
        Response.json([pullRequestResponse({ body: '<!-- devflow-delivery:deadbeef -->' })]),
      )
    const client = makeClient(fetcher)

    await expect(client.findDraftPullRequest(deliveryInput())).rejects.toMatchObject({
      code: 'github_pull_request_conflict',
    })
  })

  it('rejects a non-DevFlow head branch before issuing authority', async () => {
    const fetcher = vi.fn()
    await expect(
      makeClient(fetcher).findDraftPullRequest({
        ...deliveryInput(),
        headBranch: 'feature/unmanaged',
      }),
    ).rejects.toMatchObject({ code: 'github_invalid_request' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('treats a closed matching PR as a conflict instead of creating a duplicate', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('pull_requests', 'write'))
      .mockResolvedValueOnce(Response.json([pullRequestResponse({ state: 'closed' })]))

    await expect(
      makeClient(fetcher).findOrCreateDraftPullRequest({
        ...deliveryInput(),
        title: 'Do not duplicate a closed delivery',
        body: 'Delivery package',
      }),
    ).rejects.toMatchObject({ code: 'github_pull_request_conflict' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('fails closed on a mismatched or unavailable repository binding', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('contents', 'read'))
      .mockResolvedValueOnce(
        Response.json({
          id: 999,
          full_name: repository,
          default_branch: baseBranch,
          private: true,
          archived: false,
          disabled: false,
          visibility: 'private',
          debug: secretSentinel,
        }),
      )
    const error = await makeClient(fetcher)
      .verifyRepository({ installationId, repositoryId })
      .catch((reason: unknown) => reason)
    expect(error).toMatchObject({ code: 'github_repository_mismatch' })
    expect(String(error)).not.toContain(secretSentinel)
    expect(JSON.stringify(error)).not.toContain(secretSentinel)
  })

  it.each([
    ['non-Draft', { draft: false }],
    [
      'wrong-commit',
      {
        head: {
          ref: headBranch,
          sha: 'd'.repeat(40),
          repo: { id: 456, full_name: repository },
        },
      },
    ],
  ])('rejects a %s pull request as a delivery conflict', async (_label, override) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('pull_requests', 'write'))
      .mockResolvedValueOnce(Response.json([pullRequestResponse(override)]))
    await expect(makeClient(fetcher).findDraftPullRequest(deliveryInput())).rejects.toMatchObject({
      code: 'github_pull_request_conflict',
    })
  })

  it.each([
    [401, 'github_unauthorized'],
    [403, 'github_forbidden'],
    [404, 'github_not_found'],
    [409, 'github_conflict'],
    [422, 'github_validation_failed'],
    [429, 'github_rate_limited'],
    [500, 'github_unavailable'],
    [503, 'github_unavailable'],
  ] as const)('maps GitHub HTTP %s to the fixed safe code %s', async (status, code) => {
    const client = makeClient(
      vi.fn(async () =>
        new Response(JSON.stringify({ message: secretSentinel }), {
          status,
          headers: { authorization: `Bearer ${secretSentinel}` },
        }),
      ),
    )

    const error = await client
      .issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline })
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(GitHubAppClientError)
    expect(error).toMatchObject({ code, status })
    expect(String(error)).not.toContain(secretSentinel)
    expect(JSON.stringify(error)).not.toContain(secretSentinel)
  })

  it('rejects malformed and oversized JSON with fixed codes', async () => {
    const malformed = makeClient(vi.fn(async () => new Response('{not-json', { status: 201 })))
    await expect(
      malformed.issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline }),
    ).rejects.toMatchObject({ code: 'github_malformed_response' })

    const oversized = makeClient(
      vi.fn(async () =>
        new Response(JSON.stringify({ padding: 'x'.repeat(300_000) }), { status: 201 }),
      ),
    )
    await expect(
      oversized.issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline }),
    ).rejects.toMatchObject({ code: 'github_response_too_large' })
  })

  it('never leaks thrown fetch or JWT signer details', async () => {
    const fetchFailure = makeClient(
      vi.fn(async () => {
        throw new Error(secretSentinel)
      }),
    )
    const fetchError = await fetchFailure
      .issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline })
      .catch((reason: unknown) => reason)
    expect(fetchError).toMatchObject({
      code: 'github_unavailable',
      providerCredentialAbsentConfirmed: false,
    })
    expect(String(fetchError)).not.toContain(secretSentinel)
    expect(JSON.stringify(fetchError)).not.toContain(secretSentinel)

    const signerFailure = createGitHubAppClient({
      appId: '789',
      fetcher: vi.fn(),
      clock: () => new Date(now),
      signJwt: async () => {
        throw new Error(secretSentinel)
      },
    })
    const signerError = await signerFailure
      .issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline })
      .catch((reason: unknown) => reason)
    expect(signerError).toMatchObject({
      code: 'github_authentication_failed',
      providerCredentialAbsentConfirmed: true,
    })
    expect(String(signerError)).not.toContain(secretSentinel)
    expect(JSON.stringify(signerError)).not.toContain(secretSentinel)
  })

  it('bounds a fetcher that ignores AbortSignal with a safe typed timeout', async () => {
    let signal: AbortSignal | undefined
    const client = createGitHubAppClient({
      appId: '789',
      fetcher: vi.fn(async (_url, init) => {
        signal = init?.signal ?? undefined
        return new Promise<Response>(() => undefined)
      }),
      clock: () => new Date(now),
      signJwt: async () => `app-jwt-${'j'.repeat(32)}`,
      requestTimeoutMs: 10,
    })

    await expect(
      client.issueContentsWriteToken({ installationId, repositoryId, issuanceDeadline }),
    ).rejects.toMatchObject({ code: 'github_timeout', retryable: true })
    expect(signal?.aborted).toBe(true)
  })

  it('exposes no merge, force-push, tag, branch-delete, or arbitrary request API', () => {
    const client = makeClient(vi.fn())
    expect(Object.keys(client).sort()).toEqual([
      'findDraftPullRequest',
      'findOrCreateDraftPullRequest',
      'getBranchHead',
      'issueContentsWriteToken',
      'observeProviderCredentialExpiry',
      'revokeInstallationAccessToken',
      'verifyRepository',
    ])
    expect(Object.keys(client).join(' ')).not.toMatch(/merge|force|delete|tag|rawRequest/iu)
  })

  it('requires an injected fetcher instead of falling back to real network access', () => {
    expect(() =>
      createGitHubAppClient({
        appId: '789',
        fetcher: undefined as never,
        clock: () => new Date(now),
        signJwt: async () => `app-jwt-${'j'.repeat(32)}`,
      }),
    ).toThrowError(expect.objectContaining({ code: 'github_invalid_request' }))
  })
})

describe('GitHub delivery marker', () => {
  it('derives a stable opaque marker only from the canonical idempotency key', () => {
    expect(createGitHubDeliveryMarker(idempotencyKey)).toBe(marker)
    expect(() => createGitHubDeliveryMarker(`github-delivery:${secretSentinel}`)).toThrow(
      GitHubAppClientError,
    )
  })
})
