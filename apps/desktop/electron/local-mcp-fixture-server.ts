import readline from 'node:readline'
import {
  evaluateLocalMcpFixtureTool,
  LOCAL_MCP_FIXTURE_SERVER_INFO,
  LOCAL_MCP_FIXTURE_TOOL,
} from './local-mcp-fixture.js'

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`, 'utf8')
}

lines.on('line', (line) => {
  try {
    const message = JSON.parse(line) as {
      jsonrpc?: unknown
      id?: unknown
      method?: unknown
      params?: unknown
    }
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      throw new Error('invalid_request')
    }
    if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') {
      return
    }
    if (!Number.isInteger(message.id)) throw new Error('invalid_request')
    if (message.method === 'initialize') {
      write({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: { listChanged: false } },
          serverInfo: LOCAL_MCP_FIXTURE_SERVER_INFO,
        },
      })
      return
    }
    if (message.method === 'tools/list') {
      write({ jsonrpc: '2.0', id: message.id, result: { tools: [LOCAL_MCP_FIXTURE_TOOL] } })
      return
    }
    if (
      message.method === 'tools/call' &&
      typeof message.params === 'object' &&
      message.params !== null &&
      !Array.isArray(message.params) &&
      (message.params as { name?: unknown }).name === LOCAL_MCP_FIXTURE_TOOL.name
    ) {
      const result = evaluateLocalMcpFixtureTool(
        (message.params as { arguments?: unknown }).arguments,
      )
      write({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        },
      })
      return
    }
    throw new Error('method_not_found')
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } })
  }
})
