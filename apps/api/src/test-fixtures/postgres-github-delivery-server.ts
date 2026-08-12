import { generateKeyPairSync } from 'node:crypto'

const installationId = process.env['DEVFLOW_POSTGRES_SMOKE_GITHUB_INSTALLATION_ID']
const repositoryId = process.env['DEVFLOW_POSTGRES_SMOKE_GITHUB_REPOSITORY_ID']
const repository = process.env['DEVFLOW_POSTGRES_SMOKE_GITHUB_REPOSITORY']
const expectedHeadSha = process.env['DEVFLOW_POSTGRES_SMOKE_GITHUB_EXPECTED_HEAD_SHA']
const ephemeralCredential =
  process.env['DEVFLOW_POSTGRES_SMOKE_GITHUB_EPHEMERAL_CREDENTIAL']

if (
  !installationId ||
  !repositoryId ||
  !repository ||
  !expectedHeadSha ||
  !ephemeralCredential
) {
  throw new Error('Postgres GitHub Delivery smoke fixture is incomplete')
}

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2_048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
process.env['DEVFLOW_GITHUB_APP_ID'] = '123456'
process.env['DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64'] = Buffer.from(
  privateKey,
  'utf8',
).toString('base64')

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') {
    return {}
  }
  const parsed = JSON.parse(init.body) as unknown
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {}
}

let createdPullRequest: Record<string, unknown> | null = null

const fakeGitHubFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  )
  if (url.origin !== 'https://api.github.com') {
    throw new Error('Unexpected outbound request')
  }

  const method = init?.method ?? 'GET'
  const authorization = new Headers(init?.headers).get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse(401, { message: 'Missing fake GitHub authority' })
  }

  if (
    method === 'POST' &&
    url.pathname === `/app/installations/${installationId}/access_tokens`
  ) {
    const body = requestBody(init)
    const permissions = body['permissions']
    const repositories = body['repository_ids']
    if (
      typeof permissions !== 'object' ||
      permissions === null ||
      Array.isArray(permissions) ||
      !Array.isArray(repositories) ||
      repositories.length !== 1 ||
      String(repositories[0]) !== repositoryId
    ) {
      return jsonResponse(422, { message: 'Invalid fake GitHub scope' })
    }
    return jsonResponse(201, {
      token: ephemeralCredential,
      expires_at: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
      repository_selection: 'selected',
      permissions: {
        ...(permissions as Record<string, unknown>),
        metadata: 'read',
      },
      repositories: [{ id: Number(repositoryId) }],
    })
  }

  if (method === 'GET' && url.pathname === `/repositories/${repositoryId}`) {
    return jsonResponse(200, {
      id: Number(repositoryId),
      full_name: repository,
      default_branch: 'main',
      private: true,
      archived: false,
      disabled: false,
      visibility: 'private',
    })
  }

  if (
    method === 'GET' &&
    url.pathname.startsWith(`/repos/${repository}/git/ref/heads/`)
  ) {
    const encodedBranch = url.pathname.slice(
      `/repos/${repository}/git/ref/heads/`.length,
    )
    const branch = decodeURIComponent(encodedBranch)
    return jsonResponse(200, {
      ref: `refs/heads/${branch}`,
      object: { type: 'commit', sha: expectedHeadSha },
    })
  }

  if (url.pathname === `/repos/${repository}/pulls` && method === 'GET') {
    return jsonResponse(200, createdPullRequest ? [createdPullRequest] : [])
  }

  if (url.pathname === `/repos/${repository}/pulls` && method === 'POST') {
    const body = requestBody(init)
    const headBranch = String(body['head'] ?? '')
    const baseBranch = String(body['base'] ?? '')
    createdPullRequest = {
      id: 456789,
      number: 42,
      html_url: `https://github.com/${repository}/pull/42`,
      state: 'open',
      draft: true,
      body: String(body['body'] ?? ''),
      created_at: new Date(Date.now() - 1_000).toISOString(),
      head: {
        ref: headBranch,
        sha: expectedHeadSha,
        repo: { id: Number(repositoryId), full_name: repository },
      },
      base: {
        ref: baseBranch,
        repo: { id: Number(repositoryId), full_name: repository },
      },
    }
    return jsonResponse(201, createdPullRequest)
  }

  throw new Error('Unexpected outbound request')
}

globalThis.fetch = fakeGitHubFetch
await import('../server')
