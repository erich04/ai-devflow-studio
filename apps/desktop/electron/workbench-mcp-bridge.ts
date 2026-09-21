import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import { redactSensitiveText } from '@ai-devflow/shared'

const fields: Record<string, { required: string[]; optional: string[]; description: string }> = {
  workflow: { required: [], optional: ['runId', 'query', 'offset'], description: '查询当前项目的真实流程与节点；支持分页。' },
  node: { required: ['runId', 'nodeId'], optional: [], description: '查询节点的执行状态、产物、测试、交付回执与 Gate 条件。' },
  artifact: { required: ['runId', 'artifactId'], optional: ['offset', 'limit'], description: '分页读取当前项目某个 Run 的产物正文；摘要不代表全文。' },
  requirement: { required: ['runId'], optional: ['offset', 'limit'], description: '分页读取指定 Run 的原始需求，未读内容不等于不存在。' },
  repo_list: { required: [], optional: ['path'], description: '列出当前项目允许读取的目录；只接受仓库相对路径。' },
  repo_read: { required: ['path'], optional: [], description: '读取当前项目的普通文本文件，拒绝敏感文件与符号链接。' },
  repo_search: { required: ['query'], optional: ['path'], description: '在当前项目允许范围内搜索文本；搜索有明确边界。' },
  knowledge: { required: ['query'], optional: [], description: '检索当前项目已配置的知识；知识不是 Gate 批准。' },
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** A temporary capability: neither project identity nor conversation history is a tool argument. */
export async function createWorkbenchMcpBridge(input: {
  query(name: string, args: Record<string, unknown>): Promise<unknown>
  signal: AbortSignal
  maxQueries?: number
}) {
  const token = randomBytes(32).toString('hex')
  const authorization = Buffer.from(`Bearer ${token}`)
  const maxQueries = Math.max(1, Math.min(32, input.maxQueries ?? 32))
  let queries = 0
  let inFlight = 0
  let closing: Promise<void> | undefined
  let expectedHost = ''
  function json(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(body))
  }
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers.origin !== undefined || request.headers.host !== expectedHost) { json(response, 403, { error: 'forbidden' }); return }
      const received = Buffer.from(request.headers.authorization ?? '')
      if (received.length !== authorization.length || !timingSafeEqual(received, authorization)) { json(response, 401, { error: 'unauthorized' }); return }
      if (request.url !== '/mcp') { json(response, 404, { error: 'not_found' }); return }
      // Stateless Streamable HTTP: JSON replies only; no server-initiated SSE.
      if (request.method !== 'POST') { json(response, 405, { error: 'method_not_allowed' }); return }
      if (!request.headers['content-type']?.startsWith('application/json')) { json(response, 415, { error: 'json_required' }); return }
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of request) {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 16_384) { json(response, 413, { error: 'request_too_large' }); return }
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      let payload: Record<string, unknown> | undefined
      try { payload = object(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { /* handled below */ }
      const id = payload?.id
      const error = (code: number, message: string) => json(response, 200, { jsonrpc: '2.0', id: id ?? null, error: { code, message } })
      const result = (value: unknown) => json(response, 200, { jsonrpc: '2.0', id, result: value })
      if (!payload || payload.jsonrpc !== '2.0' || typeof payload.method !== 'string') { error(-32600, 'Invalid Request'); return }
      if (id === undefined) { response.writeHead(202); response.end(); return }
      if (typeof id !== 'string' && typeof id !== 'number') { error(-32600, 'Invalid ID'); return }
      if (payload.method === 'initialize') {
        result({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'devflow-workbench', version: '1.0.0' } }); return
      }
      if (payload.method === 'ping') { result({}); return }
      if (payload.method === 'tools/list') {
        result({ tools: Object.entries(fields).map(([name, definition]) => ({ name, description: definition.description,
          inputSchema: { type: 'object', additionalProperties: false, required: definition.required,
            properties: Object.fromEntries([...definition.required, ...definition.optional].map((key) => [key,
              key === 'offset' ? { type: 'integer', minimum: 0 } : key === 'limit' ? { type: 'integer', minimum: 1, maximum: 18000 } : { type: 'string', maxLength: 500 }])) },
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        })) }); return
      }
      if (payload.method !== 'tools/call') { error(-32601, 'Method not found'); return }
      const params = object(payload.params)
      const name = typeof params?.name === 'string' ? params.name : ''
      const definition = Object.hasOwn(fields, name) ? fields[name] : undefined
      const args = object(params?.arguments ?? {})
      if (!definition || !args || Object.keys(args).some((key) => ![...definition.required, ...definition.optional].includes(key))
        || definition.required.some((key) => typeof args[key] !== 'string' || !(args[key] as string).trim())
        || Object.entries(args).some(([key, value]) => key === 'offset'
          ? !Number.isSafeInteger(value) || Number(value) < 0
          : key === 'limit' ? !Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 18000
          : typeof value !== 'string' || value.length > 500 || value.includes('\0'))) {
        error(-32602, 'Invalid tool arguments'); return
      }
      const failed = () => result({ isError: true, content: [{ type: 'text', text: '本次查询未完成、已停止或达到本轮上限。请检查参数，必要时稍后重试。' }] })
      if (input.signal.aborted || queries >= maxQueries || inFlight >= 4) { failed(); return }
      queries++; inFlight++
      try {
        const value = await input.query(name, args)
        if (input.signal.aborted) { failed(); return }
        const text = redactSensitiveText(JSON.stringify(value) ?? 'null').value
        result({ content: [{ type: 'text', text: text.length > 24_000 ? JSON.stringify({ truncated: true, excerpt: text.slice(0, 22_000) }) : text }] })
      } catch { failed() }
      finally { inFlight-- }
    })().catch(() => { if (!response.headersSent) json(response, 400, { error: 'invalid_request' }); else response.end() })
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') { server.close(); throw new Error('会话查询服务无法启动。') }
  expectedHost = `127.0.0.1:${address.port}`
  return {
    url: `http://${expectedHost}/mcp`, headers: { Authorization: `Bearer ${token}` },
    close() {
      closing ??= new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() })
      return closing
    },
  }
}
