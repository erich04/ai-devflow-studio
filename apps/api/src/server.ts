import { createServer, type ServerResponse } from 'node:http'
import {
  artifacts,
  events,
  formatUsd,
  mcpServers,
  members,
  projects,
  rollupTokenUsage,
  runs,
  skills,
  tokenUsage,
} from '@ai-devflow/shared'

const port = Number(process.env['PORT'] ?? 4310)

type JsonValue = Record<string, unknown> | unknown[]

function sendJson(response: ServerResponse, status: number, body: JsonValue) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  })
  response.end(JSON.stringify(body, null, 2))
}

const server = createServer((request, response) => {
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

  if (url.pathname === '/api/runs') {
    sendJson(response, 200, { runs, artifacts, events })
    return
  }

  if (url.pathname === '/api/team/overview') {
    sendJson(response, 200, {
      projects,
      members,
      runs,
      projectCost: rollupTokenUsage(tokenUsage, 'projectId'),
      memberCost: rollupTokenUsage(tokenUsage, 'userId'),
      totalCost: formatUsd(tokenUsage.reduce((sum, row) => sum + row.costUsd, 0)),
    })
    return
  }

  if (url.pathname === '/api/skills') {
    sendJson(response, 200, { skills })
    return
  }

  if (url.pathname === '/api/mcp') {
    sendJson(response, 200, { servers: mcpServers })
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
