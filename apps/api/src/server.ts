import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { resolveRequestSession } from './auth/session'
import { createTeamRepositoryRuntime } from './repositories/repository-runtime'
import { resolveTeamRoute } from './routes/team-routes'

const port = Number(process.env['PORT'] ?? 4310)
const repositoryRuntime = await createTeamRepositoryRuntime()
const repository = repositoryRuntime.repository

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  })
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
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
      'access-control-allow-headers':
        'content-type,x-devflow-session-source,x-devflow-organization-id,x-devflow-user-id,x-devflow-user-role,x-devflow-auth-account-id,x-devflow-project-roles',
    })
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

  const session = resolveRequestSession(request.headers, {
    allowDemoFallback: process.env['DEVFLOW_REQUIRE_AUTH'] !== 'true',
  })
  let route
  try {
    route = await resolveTeamRoute(request.method ?? 'GET', url.pathname, repository, {
      body: requestBody,
      session,
      searchParams: url.searchParams,
    })
  } catch (error) {
    sendJson(response, 500, {
      error: 'internal_error',
      message: error instanceof Error ? error.message : 'Unexpected API error',
    })
    return
  }

  if (route) {
    sendJson(response, route.status, route.body)
    return
  }

  sendJson(response, 404, {
    error: 'not_found',
    path: url.pathname,
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`AI DevFlow API listening on http://127.0.0.1:${port}`)
})

process.once('SIGTERM', () => {
  server.close(async () => {
    await repositoryRuntime.close()
    process.exit(0)
  })
})
