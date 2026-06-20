export type GitHubOAuthProfile = {
  providerAccountId: string
  username?: string
  name: string
  email?: string
  avatarUrl?: string
}

export type GitHubOAuthClient = {
  createAuthorizationUrl(input: { state: string }): string
  exchangeCodeForProfile(input: { code: string }): Promise<GitHubOAuthProfile>
}

export type CreateGitHubOAuthClientInput = {
  clientId: string
  clientSecret: string
  redirectUri: string
  fetcher?: typeof fetch
}

type GitHubUserResponse = {
  id: number | string
  login?: string
  name?: string | null
  email?: string | null
  avatar_url?: string
}

type GitHubEmailResponse = {
  email?: string
  primary?: boolean
  verified?: boolean
}

type TokenResponse = {
  access_token?: string
}

function assertRecord(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(message)
  }
}

async function readJson(response: Response, message: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${message}: ${response.status}`)
  }

  return response.json() as Promise<unknown>
}

function selectPrimaryEmail(userEmail: string | null | undefined, emails: GitHubEmailResponse[]): string | undefined {
  if (userEmail) {
    return userEmail
  }

  return (
    emails.find((email) => email.primary && email.verified && email.email)?.email ??
    emails.find((email) => email.verified && email.email)?.email
  )
}

function createClient(input: CreateGitHubOAuthClientInput): GitHubOAuthClient {
  const fetcher = input.fetcher ?? fetch

  return {
    createAuthorizationUrl({ state }) {
      const url = new URL('https://github.com/login/oauth/authorize')
      url.searchParams.set('client_id', input.clientId)
      url.searchParams.set('redirect_uri', input.redirectUri)
      url.searchParams.set('scope', 'read:user user:email')
      url.searchParams.set('state', state)
      return url.toString()
    },

    async exchangeCodeForProfile({ code }) {
      const tokenResponse = await fetcher('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code,
          redirect_uri: input.redirectUri,
        }),
      })
      const tokenJson = await readJson(tokenResponse, 'GitHub OAuth token exchange failed')
      assertRecord(tokenJson, 'GitHub OAuth token response was not an object')
      const accessToken = (tokenJson as TokenResponse).access_token
      if (!accessToken) {
        throw new Error('GitHub OAuth token response did not include an access token')
      }

      const authHeaders = {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${accessToken}`,
        'user-agent': 'AI DevFlow Studio',
      }

      const userResponse = await fetcher('https://api.github.com/user', {
        headers: authHeaders,
      })
      const userJson = await readJson(userResponse, 'GitHub user lookup failed')
      assertRecord(userJson, 'GitHub user response was not an object')
      const user = userJson as GitHubUserResponse

      const emailsResponse = await fetcher('https://api.github.com/user/emails', {
        headers: authHeaders,
      })
      const emailsJson = await readJson(emailsResponse, 'GitHub email lookup failed')
      const emails = Array.isArray(emailsJson) ? (emailsJson as GitHubEmailResponse[]) : []

      const providerAccountId = String(user.id)
      const username = user.login
      const email = selectPrimaryEmail(user.email, emails)
      const name = user.name?.trim() || username || `GitHub user ${providerAccountId}`

      const profile: GitHubOAuthProfile = {
        providerAccountId,
        name,
      }
      if (username) {
        profile.username = username
      }
      if (email) {
        profile.email = email
      }
      if (user.avatar_url) {
        profile.avatarUrl = user.avatar_url
      }

      return profile
    },
  }
}

type GitHubOAuthFactory = {
  (input: CreateGitHubOAuthClientInput): GitHubOAuthClient
  fromEnv(env?: Record<string, string | undefined>): GitHubOAuthClient | null
}

export const createGitHubOAuthClient: GitHubOAuthFactory = Object.assign(createClient, {
  fromEnv(env: Record<string, string | undefined> = process.env): GitHubOAuthClient | null {
    const clientId = env['GITHUB_OAUTH_CLIENT_ID']?.trim()
    const clientSecret = env['GITHUB_OAUTH_CLIENT_SECRET']?.trim()
    const redirectUri = env['GITHUB_OAUTH_REDIRECT_URI']?.trim()

    if (!clientId || !clientSecret || !redirectUri) {
      return null
    }

    return createClient({
      clientId,
      clientSecret,
      redirectUri,
    })
  },
})
