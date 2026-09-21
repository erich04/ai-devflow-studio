import { createServer, type ServerResponse } from 'node:http'
import path from 'node:path'
import { createDiagnosticLog } from '@ai-devflow/shared/node/diagnostic-log'
import { DIAGNOSTIC_HEADER } from '@ai-devflow/shared'
import { withApiDiagnostics } from './api-diagnostics'
import { createGitHubOAuthClient } from './auth/github-oauth'
import { createGitHubAppClientFromEnv } from './github-app-auth'
import { createGitHubDeliveryService } from './github-delivery-service'
import { resolveServerRuntimeConfig } from './server-config'
import { createTeamRepositoryRuntime } from './repositories/repository-runtime'
import {
  createCorsPreflightHeaders,
  resolveApiRouteRequest,
} from './server-request'
import { readBoundedJsonBody, RequestBodyTooLargeError } from './http-json-body'

const {
  devAuthEnabled,
  host,
  localAuthEnabled,
  port,
  secureCookies,
  sessionSecret,
  webAppUrl,
} =
  resolveServerRuntimeConfig()
const repositoryRuntime = await createTeamRepositoryRuntime()
const repository = repositoryRuntime.repository
const diagnosticLog = createDiagnosticLog(process.env['DEVFLOW_API_DIAGNOSTICS_PATH'] ?? path.resolve('data/api-diagnostics.json'))
const githubOAuth = createGitHubOAuthClient.fromEnv()
const githubAppClient = createGitHubAppClientFromEnv({
  env: process.env,
  fetcher: fetch,
  clock: () => new Date(),
})
const githubDeliveryService = githubAppClient
  ? createGitHubDeliveryService({
      repository,
      client: githubAppClient,
      clock: () => new Date(),
    })
  : undefined

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

  if (url.pathname === '/ready') {
    try {
      await repositoryRuntime.checkReadiness()
      sendJson(response, 200, {
        status: 'ready',
        service: '@ai-devflow/api',
      })
    } catch {
      sendJson(response, 503, {
        status: 'unavailable',
        service: '@ai-devflow/api',
      })
    }
    return
  }

  const route = await withApiDiagnostics({
    id: request.headers[DIAGNOSTIC_HEADER], pathname: url.pathname,
    method: request.method ?? 'GET', record: diagnosticLog.append,
    run: async () => {
      let requestBody: unknown
      if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
        try { requestBody = await readBoundedJsonBody(request) }
        catch (error) {
          return error instanceof RequestBodyTooLargeError
            ? { status: 413, body: { error: 'payload_too_large', message: 'JSON request body exceeds the maximum allowed size' } }
            : { status: 400, body: { error: 'bad_request', message: 'Invalid JSON body' } }
        }
      }
      return resolveApiRouteRequest({
        method: request.method ?? 'GET', pathname: url.pathname,
        headers: request.headers, body: requestBody, searchParams: url.searchParams,
      }, {
        repository, sessionSecret, devAuthEnabled, localAuthEnabled,
        postAuthRedirectUrl: webAppUrl, secureCookies,
        ...(githubOAuth ? { githubOAuth } : {}),
        ...(githubDeliveryService ? { githubDeliveryService } : {}),
      })
    },
  })
  sendJson(response, route.status, route.body, route.headers)

})

server.listen(port, host, () => {
  console.log(`AI DevFlow API listening on http://${host}:${port}`)
})

process.once('SIGTERM', () => {
  server.close(async () => {
    await diagnosticLog.flush()
    await repositoryRuntime.close()
    process.exit(0)
  })
})
