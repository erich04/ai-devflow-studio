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
} from './opencode-http-adapter'

describe('opencode HTTP adapter', () => {
  it('creates sessions with ask permission rules and never uses skip-permissions flags', async () => {
    const fetcher = jsonFetcher({ id: 'ses_test' })

    await expect(
      createOpencodeSession({
        baseUrl: 'http://127.0.0.1:4097',
        directory: '/tmp/repo',
        title: 'DevFlow coding run',
        model: { providerID: 'opencode', id: 'big-pickle' },
        fetcher,
      }),
    ).resolves.toEqual({ id: 'ses_test' })

    const body = JSON.parse(String(fetcher.calls[0]?.[1]?.body))
    expect(body.permission).toEqual(createDefaultOpencodePermissionRules())
    expect(JSON.stringify(fetcher.calls)).not.toContain('dangerously-skip-permissions')
  })

  it('sends text prompts, lists permissions, replies, aborts, and fetches diffs through stable endpoints', async () => {
    const fetcher = jsonFetcher([
      { id: 'per_1', sessionID: 'ses_1', permission: 'edit', metadata: { filepath: 'src/a.ts' } },
    ])

    await listOpencodePermissions({ baseUrl: 'http://127.0.0.1:4097', fetcher })
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
      'http://127.0.0.1:4097/permission',
      'http://127.0.0.1:4097/permission/per_1/reply',
      'http://127.0.0.1:4097/session/ses_1/abort?directory=%2Ftmp%2Frepo',
      'http://127.0.0.1:4097/session/ses_1/message',
      'http://127.0.0.1:4097/session/ses_1/diff?directory=%2Ftmp%2Frepo',
    ])
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
