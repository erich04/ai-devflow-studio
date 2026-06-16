import { createServer, type ServerResponse } from 'node:http'
import { createSeedTeamRepository } from './repositories/team-repository'
import { resolveTeamRoute } from './routes/team-routes'

const port = Number(process.env['PORT'] ?? 4310)
const repository = createSeedTeamRepository()

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  })
  response.end(JSON.stringify(body, null, 2))
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
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

  const route = await resolveTeamRoute(request.method ?? 'GET', url.pathname, repository)
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
