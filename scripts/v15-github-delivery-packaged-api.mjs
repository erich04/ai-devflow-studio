import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing packaged smoke environment: ${name}`)
  return value
}

const installationId = requiredEnvironment(
  'DEVFLOW_PACKAGED_SMOKE_GITHUB_INSTALLATION_ID',
)
const repositoryId = requiredEnvironment(
  'DEVFLOW_PACKAGED_SMOKE_GITHUB_REPOSITORY_ID',
)
const repository = requiredEnvironment(
  'DEVFLOW_PACKAGED_SMOKE_GITHUB_REPOSITORY',
)
const repositoryOwner = repository.split('/')[0]
if (!repositoryOwner) {
  throw new Error('Packaged smoke GitHub repository owner is missing.')
}
const bareRepositoryPath = requiredEnvironment(
  'DEVFLOW_PACKAGED_SMOKE_GIT_BARE_REPOSITORY',
)
const ephemeralCredential = requiredEnvironment(
  'DEVFLOW_PACKAGED_SMOKE_GITHUB_EPHEMERAL_CREDENTIAL',
)
const metricsPath = requiredEnvironment('DEVFLOW_PACKAGED_SMOKE_METRICS_PATH')
const githubAppPrivateKeyBase64 = requiredEnvironment(
  'DEVFLOW_PACKAGED_SMOKE_GITHUB_APP_PRIVATE_KEY_BASE64',
)

if (process.env['DEVFLOW_PACKAGED_SMOKE'] !== 'true') {
  throw new Error('The packaged GitHub boundary is test-only and fail-closed.')
}
if (process.env['DEVFLOW_PACKAGED_SMOKE_NETWORK_MODE'] !== 'offline') {
  throw new Error('The packaged GitHub boundary only supports offline mode.')
}

const metrics = {
  schemaVersion: 1,
  installationTokens: {
    contentsRead: 0,
    contentsWrite: 0,
    pullRequestsRead: 0,
    pullRequestsWrite: 0,
  },
  repositoryReads: 0,
  branchReads: 0,
  pullRequestLists: 0,
  pullRequestCreates: 0,
  unexpectedOutboundRequests: 0,
}
let createdPullRequest = null

async function persistMetrics() {
  await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, {
    mode: 0o600,
  })
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function parseBody(init) {
  if (typeof init?.body !== 'string') return {}
  const value = JSON.parse(init.body)
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}
}

function permissionCounter(permissions) {
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
    return null
  }
  const entries = Object.entries(permissions)
  if (entries.length !== 1) return null
  const [permission, level] = entries[0]
  if (permission === 'contents' && level === 'read') return 'contentsRead'
  if (permission === 'contents' && level === 'write') return 'contentsWrite'
  if (permission === 'pull_requests' && level === 'read') return 'pullRequestsRead'
  if (permission === 'pull_requests' && level === 'write') return 'pullRequestsWrite'
  return null
}

async function readBareBranch(branch) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['--git-dir', bareRepositoryPath, 'rev-parse', '--verify', `refs/heads/${branch}`],
      { timeout: 10_000, windowsHide: true },
    )
    return stdout.trim().toLowerCase()
  } catch {
    return null
  }
}

const fakeGitHubFetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  )
  if (url.origin !== 'https://api.github.com') {
    metrics.unexpectedOutboundRequests += 1
    await persistMetrics()
    throw new Error('Packaged smoke blocked an unexpected outbound request.')
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
    const body = parseBody(init)
    const repositories = body['repository_ids']
    const counter = permissionCounter(body['permissions'])
    if (
      counter === null ||
      !Array.isArray(repositories) ||
      repositories.length !== 1 ||
      String(repositories[0]) !== repositoryId
    ) {
      return jsonResponse(422, { message: 'Invalid fake GitHub scope' })
    }
    metrics.installationTokens[counter] += 1
    await persistMetrics()
    return jsonResponse(201, {
      token: ephemeralCredential,
      expires_at: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
      repository_selection: 'selected',
      permissions: {
        ...body['permissions'],
        metadata: 'read',
      },
      repositories: [{ id: Number(repositoryId) }],
    })
  }

  if (method === 'GET' && url.pathname === `/repositories/${repositoryId}`) {
    metrics.repositoryReads += 1
    await persistMetrics()
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
    const branch = decodeURIComponent(
      url.pathname.slice(`/repos/${repository}/git/ref/heads/`.length),
    )
    const sha = await readBareBranch(branch)
    metrics.branchReads += 1
    await persistMetrics()
    return sha
      ? jsonResponse(200, {
          ref: `refs/heads/${branch}`,
          object: { type: 'commit', sha },
        })
      : jsonResponse(404, { message: 'Reference does not exist' })
  }

  if (url.pathname === `/repos/${repository}/pulls` && method === 'GET') {
    metrics.pullRequestLists += 1
    await persistMetrics()
    return jsonResponse(200, createdPullRequest ? [createdPullRequest] : [])
  }

  if (url.pathname === `/repos/${repository}/pulls` && method === 'POST') {
    const body = parseBody(init)
    const ownerQualifiedHead = String(body['head'] ?? '')
    const expectedHeadPrefix = `${repositoryOwner}:`
    const headBranch = ownerQualifiedHead.startsWith(expectedHeadPrefix)
      ? ownerQualifiedHead.slice(expectedHeadPrefix.length)
      : ''
    const baseBranch = String(body['base'] ?? '')
    const headSha = await readBareBranch(headBranch)
    if (!headSha || body['draft'] !== true || baseBranch !== 'main') {
      return jsonResponse(422, { message: 'Invalid fake Draft PR authority' })
    }
    metrics.pullRequestCreates += 1
    createdPullRequest = {
      id: 456789,
      number: 42,
      html_url: `https://github.com/${repository}/pull/42`,
      state: 'open',
      draft: true,
      body: String(body['body'] ?? ''),
      created_at: new Date().toISOString(),
      head: {
        ref: headBranch,
        sha: headSha,
        repo: { id: Number(repositoryId), full_name: repository },
      },
      base: {
        ref: baseBranch,
        repo: { id: Number(repositoryId), full_name: repository },
      },
    }
    await persistMetrics()
    return jsonResponse(201, createdPullRequest)
  }

  metrics.unexpectedOutboundRequests += 1
  await persistMetrics()
  throw new Error('Packaged smoke blocked an unexpected GitHub request.')
}

process.env['DEVFLOW_GITHUB_APP_ID'] = '123456'
process.env['DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64'] = githubAppPrivateKeyBase64
globalThis.fetch = fakeGitHubFetch

await persistMetrics()
await import('../apps/api/src/server.ts')
