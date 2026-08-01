import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createGitHubOAuthClient } from './auth/github-oauth'
import { resolveServerRuntimeConfig } from './server-config'
import { createTeamRepositoryRuntime } from './repositories/repository-runtime'
import {
  createCorsPreflightHeaders,
  createInternalErrorResponse,
  resolveApiRouteRequest,
} from './server-request'

const { devAuthEnabled, host, port } = resolveServerRuntimeConfig()
const sessionSecret = process.env['DEVFLOW_SESSION_SECRET'] ?? 'devflow-dev-session-secret'
const repositoryRuntime = await createTeamRepositoryRuntime()
const repository = repositoryRuntime.repository
const githubOAuth = createGitHubOAuthClient.fromEnv()

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    ...headers,
  })
  if (status === 204) {
    response.end()
    return
  }

  response.end(JSON.stringify(body, null, 2))
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim()
  if (!rawBody) {
    return undefined
  }

  return JSON.parse(rawBody) as unknown
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)

  if (request.method === 'OPTIONS') {
    response.writeHead(204, createCorsPreflightHeaders())
    response.end()
    return
  }

  if (url.pathname === '/health') {
    sendJson(response, 200, {
      status: 'ok',
      service: '@ai-devflow/api',
      timestamp: new Date().toISOString(),
    })
    return
  }

  let requestBody: unknown
  if (request.method === 'POST' || request.method === 'PUT') {
    try {
      requestBody = await readJsonBody(request)
    } catch {
      sendJson(response, 400, {
        error: 'bad_request',
        message: 'Invalid JSON body',
      })
      return
    }
  }

  let route
  try {
    route = await resolveApiRouteRequest(
      {
        method: request.method ?? 'GET',
        pathname: url.pathname,
        headers: request.headers,
        body: requestBody,
        searchParams: url.searchParams,
      },
      {
        repository,
        sessionSecret,
        devAuthEnabled,
        ...(githubOAuth ? { githubOAuth } : {}),
      },
    )
  } catch (error) {
    const internalError = createInternalErrorResponse(error)
    sendJson(response, internalError.status, internalError.body)
    return
  }

  if (route) {
    sendJson(response, route.status, route.body, route.headers)
    return
  }

  sendJson(response, 404, {
    error: 'not_found',
    path: url.pathname,
  })
})

server.listen(port, host, () => {
  console.log(`AI DevFlow API listening on http://${host}:${port}`)
})

process.once('SIGTERM', () => {
  server.close(async () => {
    await repositoryRuntime.close()
    process.exit(0)
  })
})
