import { describe, expect, it, vi } from 'vitest'
import { createGitHubOAuthClient } from './github-oauth'

describe('GitHub OAuth client', () => {
  it('builds an authorization URL with a state token', () => {
    const client = createGitHubOAuthClient({
      clientId: 'client-1',
      clientSecret: 'secret-1',
      redirectUri: 'http://127.0.0.1:4310/api/auth/github/callback',
    })

    expect(client.createAuthorizationUrl({ state: 'state-1' })).toBe(
      'https://github.com/login/oauth/authorize?client_id=client-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A4310%2Fapi%2Fauth%2Fgithub%2Fcallback&scope=read%3Auser+user%3Aemail&state=state-1',
    )
  })

  it('exchanges a code for a normalized GitHub identity profile', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'github-token-1' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 123456,
            login: 'erich04',
            name: 'Erich',
            email: null,
            avatar_url: 'https://avatars.example/erich.png',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              email: 'erich@example.com',
              primary: true,
              verified: true,
            },
          ]),
          { status: 200 },
        ),
      )

    const client = createGitHubOAuthClient({
      clientId: 'client-1',
      clientSecret: 'secret-1',
      redirectUri: 'http://127.0.0.1:4310/api/auth/github/callback',
      fetcher,
    })

    await expect(client.exchangeCodeForProfile({ code: 'code-1' })).resolves.toEqual({
      providerAccountId: '123456',
      username: 'erich04',
      name: 'Erich',
      email: 'erich@example.com',
      avatarUrl: 'https://avatars.example/erich.png',
    })
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          accept: 'application/json',
          'content-type': 'application/json',
        }),
      }),
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer github-token-1',
        }),
      }),
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      'https://api.github.com/user/emails',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer github-token-1',
        }),
      }),
    )
  })

  it('returns null when GitHub OAuth environment is incomplete', () => {
    expect(
      createGitHubOAuthClient.fromEnv({
        GITHUB_OAUTH_CLIENT_ID: 'client-1',
      }),
    ).toBeNull()
  })
})
