import { describe, expect, it, vi } from 'vitest'
import {
  abortOpencodeSession,
  buildOpencodeServeArgs,
  createDefaultOpencodePermissionRules,
  createOpencodeSession,
  listOpencodeDiff,
  listOpencodePermissions,
  replyOpencodePermission,
  sendOpencodeMessage,
  type Fetcher,
  OpencodeMessageResponseError,
} from './opencode-http-adapter'

describe('opencode HTTP adapter', () => {
  it('creates sessions with ask permission rules and never uses skip-permissions flags', async () => {
    const session = {
      id: 'ses_test',
      directory: '/tmp/repo',
      permission: createDefaultOpencodePermissionRules(),
    }
    const fetcher = jsonFetcher(session)

    await expect(
      createOpencodeSession({
        baseUrl: 'http://127.0.0.1:4097',
        directory: '/tmp/repo',
        title: 'DevFlow coding run',
        model: { providerID: 'opencode', id: 'big-pickle' },
        fetcher,
      }),
    ).resolves.toEqual(session)

    expect(String(fetcher.calls[0]?.[0])).toBe(
      'http://127.0.0.1:4097/session?directory=%2Ftmp%2Frepo',
    )
    const body = JSON.parse(String(fetcher.calls[0]?.[1]?.body))
    expect(body).not.toHaveProperty('directory')
    expect(body.permission).toEqual(createDefaultOpencodePermissionRules())
    expect(JSON.stringify(fetcher.calls)).not.toContain('dangerously-skip-permissions')
  })

  it('sends text prompts, lists permissions, replies, aborts, and fetches diffs through stable endpoints', async () => {
    const fetcher = jsonFetcher({ info: {}, parts: [] })

    await listOpencodePermissions({
      baseUrl: 'http://127.0.0.1:4097',
      directory: '/tmp/repo',
      fetcher,
    })
    await replyOpencodePermission({
      baseUrl: 'http://127.0.0.1:4097',
      requestId: 'per_1',
      directory: '/tmp/repo',
      reply: 'once',
      message: 'Approved by DevFlow.',
      fetcher,
    })
    await abortOpencodeSession({
      baseUrl: 'http://127.0.0.1:4097',
      sessionId: 'ses_1',
      directory: '/tmp/repo',
      fetcher,
    })
    await sendOpencodeMessage({
      baseUrl: 'http://127.0.0.1:4097',
      sessionId: 'ses_1',
      directory: '/tmp/repo',
      model: { providerID: 'opencode', modelID: 'big-pickle' },
      text: 'Change the code.',
      fetcher,
    })
    await listOpencodeDiff({
      baseUrl: 'http://127.0.0.1:4097',
      sessionId: 'ses_1',
      directory: '/tmp/repo',
      fetcher,
    })

    expect(fetcher.calls.map((call) => String(call[0]))).toEqual([
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Frepo',
      'http://127.0.0.1:4097/permission/per_1/reply?directory=%2Ftmp%2Frepo',
      'http://127.0.0.1:4097/session/ses_1/abort?directory=%2Ftmp%2Frepo',
      'http://127.0.0.1:4097/session/ses_1/message?directory=%2Ftmp%2Frepo',
      'http://127.0.0.1:4097/session/ses_1/diff?directory=%2Ftmp%2Frepo',
    ])
    expect(JSON.parse(String(fetcher.calls[1]?.[1]?.body))).not.toHaveProperty('directory')
  })

  it('builds managed serve args without writing global auth or enabling unsafe permission bypass', () => {
    expect(buildOpencodeServeArgs({ hostname: '127.0.0.1', port: 4097 })).toEqual([
      'serve',
      '--hostname',
      '127.0.0.1',
      '--port',
      '4097',
    ])
  })

  it('reports non-success responses without exposing query paths or raw response content', async () => {
    const fetcher = vi.fn(async () =>
      new Response('RAW_RESPONSE_SENTINEL provider-key-value', { status: 500 }),
    ) as unknown as Fetcher

    const error = await createOpencodeSession({
      baseUrl: 'http://127.0.0.1:4097',
      directory: '/private/tmp/secret-worktree',
      title: 'DevFlow coding run',
      model: { providerID: 'opencode', id: 'big-pickle' },
      fetcher,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('opencode /session failed with 500')
    expect((error as Error).message).not.toContain('/private/tmp/secret-worktree')
    expect((error as Error).message).not.toContain('%2Fprivate%2Ftmp%2Fsecret-worktree')
    expect((error as Error).message).not.toContain('RAW_RESPONSE_SENTINEL')
    expect((error as Error).message).not.toContain('provider-key-value')
  })

  it('reports malformed success responses without exposing their raw content', async () => {
    const fetcher = vi.fn(async () =>
      new Response('RAW_SECRET_SENTINEL', { status: 200 }),
    ) as unknown as Fetcher

    const error = await createOpencodeSession({
      baseUrl: 'http://127.0.0.1:4097',
      directory: '/private/tmp/secret-worktree',
      title: 'DevFlow coding run',
      model: { providerID: 'opencode', id: 'big-pickle' },
      fetcher,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('opencode /session returned an invalid JSON response')
    expect((error as Error).message).not.toContain('RAW_SECRET_SENTINEL')
    expect((error as Error).message).not.toContain('/private/tmp/secret-worktree')
    expect((error as Error).message).not.toContain('%2Fprivate%2Ftmp%2Fsecret-worktree')
  })

  it('surfaces a provider error carried by a successful message response without exposing raw details', async () => {
    const fetcher = jsonFetcher({
      info: {
        error: {
          name: 'APIError',
          data: {
            message: 'RAW_PROVIDER_MESSAGE provider-key-value',
            statusCode: 401,
            isRetryable: false,
            body: 'RAW_PROVIDER_BODY',
            responseHeaders: { 'x-provider-debug': 'RAW_PROVIDER_HEADER' },
            metadata: { requestId: 'RAW_PROVIDER_METADATA' },
          },
        },
      },
      parts: [],
    })

    const error = await sendOpencodeMessage({
      baseUrl: 'http://127.0.0.1:4097',
      sessionId: 'ses-1',
      directory: '/private/tmp/secret-worktree',
      model: { providerID: 'opencode', modelID: 'big-pickle' },
      text: 'Change the code.',
      fetcher,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(OpencodeMessageResponseError)
    expect(error).toMatchObject({
      code: 'provider_api_error',
      statusCode: 401,
      retryable: false,
      message: 'opencode provider message failed',
    })
    expect(JSON.stringify(error)).not.toContain('RAW_PROVIDER_MESSAGE')
    expect(JSON.stringify(error)).not.toContain('RAW_PROVIDER_BODY')
    expect(JSON.stringify(error)).not.toContain('RAW_PROVIDER_HEADER')
    expect(JSON.stringify(error)).not.toContain('RAW_PROVIDER_METADATA')
    expect(JSON.stringify(error)).not.toContain('provider-key-value')
    expect(JSON.stringify(error)).not.toContain('/private/tmp/secret-worktree')
  })

  it.each([
    ['ProviderAuthError', 'provider_auth_error'],
    ['UnknownError', 'unknown_provider_error'],
    ['MessageOutputLengthError', 'output_length'],
    ['MessageAbortedError', 'message_aborted'],
    ['StructuredOutputError', 'structured_output'],
    ['ContextOverflowError', 'context_overflow'],
    ['ContentFilterError', 'content_filter'],
  ] as const)('classifies the %s terminal response without exposing its payload', async (name, code) => {
    const fetcher = jsonFetcher({
      info: {
        error: {
          name,
          data: {
            message: 'RAW_PROVIDER_MESSAGE provider-key-value',
            body: 'RAW_PROVIDER_BODY',
            responseHeaders: { 'x-provider-debug': 'RAW_PROVIDER_HEADER' },
            metadata: { requestId: 'RAW_PROVIDER_METADATA' },
          },
        },
      },
      parts: [],
    })

    const error = await sendOpencodeMessage({
      baseUrl: 'http://127.0.0.1:4097',
      sessionId: 'ses-1',
      directory: '/private/tmp/secret-worktree',
      model: { providerID: 'opencode', modelID: 'big-pickle' },
      text: 'Change the code.',
      fetcher,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(OpencodeMessageResponseError)
    expect(error).toMatchObject({ code })
    expect(JSON.stringify(error)).not.toContain('RAW_PROVIDER_MESSAGE')
    expect(JSON.stringify(error)).not.toContain('RAW_PROVIDER_BODY')
    expect(JSON.stringify(error)).not.toContain('RAW_PROVIDER_HEADER')
    expect(JSON.stringify(error)).not.toContain('RAW_PROVIDER_METADATA')
    expect(JSON.stringify(error)).not.toContain('provider-key-value')
    expect(JSON.stringify(error)).not.toContain('/private/tmp/secret-worktree')
  })

  it('rejects malformed message success bodies without exposing their content', async () => {
    const fetcher = jsonFetcher({
      info: { unexpected: 'RAW_SECRET_SENTINEL' },
      parts: 'not-an-array',
    })

    const error = await sendOpencodeMessage({
      baseUrl: 'http://127.0.0.1:4097',
      sessionId: 'ses-1',
      directory: '/private/tmp/secret-worktree',
      model: { providerID: 'opencode', modelID: 'big-pickle' },
      text: 'Change the code.',
      fetcher,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(OpencodeMessageResponseError)
    expect(error).toMatchObject({
      code: 'invalid_message_response',
      message: 'opencode returned an invalid message response',
    })
    expect(JSON.stringify(error)).not.toContain('RAW_SECRET_SENTINEL')
    expect(JSON.stringify(error)).not.toContain('/private/tmp/secret-worktree')
  })

  it('reports transport failures without exposing query paths or raw fetch errors', async () => {
    const directory = '/private/tmp/secret-worktree'
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0]) => {
      throw new Error(`RAW_NETWORK_SENTINEL at ${String(input)}`)
    }) as unknown as Fetcher
    const requests = [
      () => createOpencodeSession({
        baseUrl: 'http://127.0.0.1:4097',
        directory,
        title: 'DevFlow coding run',
        model: { providerID: 'opencode', id: 'big-pickle' },
        fetcher,
      }),
      () => sendOpencodeMessage({
        baseUrl: 'http://127.0.0.1:4097',
        sessionId: 'ses-1',
        directory,
        model: { providerID: 'opencode', modelID: 'big-pickle' },
        text: 'Change the code.',
        fetcher,
      }),
      () => listOpencodePermissions({
        baseUrl: 'http://127.0.0.1:4097',
        directory,
        fetcher,
      }),
      () => replyOpencodePermission({
        baseUrl: 'http://127.0.0.1:4097',
        requestId: 'per-1',
        directory,
        reply: 'once' as const,
        message: 'Approved by DevFlow.',
        fetcher,
      }),
    ]

    for (const request of requests) {
      const error = await request().catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toMatch(/^opencode \/[^?]+ request failed$/)
      expect((error as Error).message).not.toContain('RAW_NETWORK_SENTINEL')
      expect((error as Error).message).not.toContain(directory)
      expect((error as Error).message).not.toContain('%2Fprivate%2Ftmp%2Fsecret-worktree')
    }
  })
})

function jsonFetcher(body: unknown): Fetcher & { calls: Array<[Parameters<Fetcher>[0], Parameters<Fetcher>[1] | undefined]> } {
  const calls: Array<[Parameters<Fetcher>[0], Parameters<Fetcher>[1] | undefined]> = []
  const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
    calls.push([input, init])
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as Fetcher & { calls: Array<[Parameters<Fetcher>[0], Parameters<Fetcher>[1] | undefined]> }
  fetcher.calls = calls
  return fetcher
}
