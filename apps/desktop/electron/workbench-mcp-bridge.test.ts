// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createWorkbenchMcpBridge } from './workbench-mcp-bridge'

const bridges: Array<Awaited<ReturnType<typeof createWorkbenchMcpBridge>>> = []
afterEach(async () => { await Promise.all(bridges.splice(0).map((bridge) => bridge.close())) })

it('exposes only scoped read tools over authenticated loopback HTTP and rejects injected identity', async () => {
  const query = vi.fn(async () => ({ sourceId: 'evidence-1', result: { project: 'project-A' } }))
  const controller = new AbortController()
  const bridge = await createWorkbenchMcpBridge({ query, signal: controller.signal }); bridges.push(bridge)
  const rpc = (method: string, params?: unknown, headers: Record<string, string> = bridge.headers) => fetch(bridge.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  expect((await rpc('initialize', { protocolVersion: '2025-06-18' }, {})).status).toBe(401)
  expect((await rpc('initialize', {}, { ...bridge.headers, Origin: 'https://untrusted.example' })).status).toBe(403)
  const initialized = await (await rpc('initialize', { protocolVersion: '2025-06-18' })).json()
  expect(initialized.result.capabilities).toEqual({ tools: {} })
  const tools = (await (await rpc('tools/list')).json()).result.tools
  // knowledge-context K3: the directory is listed and read by path; the older keyword tool stays callable only.
  expect(tools.map((tool: { name: string }) => tool.name)).toEqual(['workflow', 'node', 'artifact', 'requirement', 'repo_list', 'repo_read', 'repo_search', 'knowledge_list', 'knowledge_search', 'knowledge_read', 'conversation_read', 'memory_search'])
  expect(tools.find((tool: { name: string }) => tool.name === 'knowledge_read').inputSchema).toMatchObject({ anyOf: [{ required: ['path'] }, { required: ['sourceRef', 'expectedDigest'] }] })
  expect(tools.every((tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint)).toBe(true)
  expect((await (await rpc('tools/call', { name: 'node', arguments: { runId: 'run-A', nodeId: 'node-A' } })).json()).result.content[0].text).toContain('project-A')
  expect(query).toHaveBeenCalledWith('node', { runId: 'run-A', nodeId: 'node-A' })
  expect((await (await rpc('tools/call', { name: 'node', arguments: { projectId: 'project-B', runId: 'run-A', nodeId: 'node-A' } })).json()).error.code).toBe(-32602)
  expect((await (await rpc('tools/call', { name: 'approve_gate', arguments: {} })).json()).error.code).toBe(-32602)
  expect(query).toHaveBeenCalledTimes(1)
  expect((await (await rpc('tools/call', { name: 'requirement', arguments: { runId: 'run-A', offset: 6000, limit: 18000 } })).json()).result.content[0].text).toContain('project-A')
  expect(query).toHaveBeenLastCalledWith('requirement', { runId: 'run-A', offset: 6000, limit: 18000 })
  expect((await (await rpc('tools/call', { name: 'artifact', arguments: { runId: 'run-A', artifactId: 'raw-A', limit: 18001 } })).json()).error.code).toBe(-32602)
  await rpc('tools/call', { name: 'knowledge_list', arguments: { stage: 'build' } })
  expect(query).toHaveBeenLastCalledWith('knowledge_list', { stage: 'build' })
  await rpc('tools/call', { name: 'knowledge_read', arguments: { path: 'docs/knowledge/a.md', offset: 0 } })
  expect(query).toHaveBeenLastCalledWith('knowledge_read', { path: 'docs/knowledge/a.md', offset: 0 })
  expect((await (await rpc('tools/call', { name: 'knowledge_read', arguments: {} })).json()).error.code).toBe(-32602)
  await rpc('tools/call', { name: 'knowledge', arguments: { query: 'health' } })
  expect(query).toHaveBeenLastCalledWith('knowledge', { query: 'health' })
  controller.abort()
  expect((await (await rpc('tools/call', { name: 'workflow', arguments: {} })).json()).result.isError).toBe(true)
  expect(query).toHaveBeenCalledTimes(5)
})

it('uses the same byte, stage and result bounds for semantic searches and accepts scoped continuations', async () => {
  const query = vi.fn(async () => ({ matches: [] }))
  const bridge = await createWorkbenchMcpBridge({ query, signal: new AbortController().signal }); bridges.push(bridge)
  const call = async (name: string, args: unknown) => (await fetch(bridge.url, { method: 'POST',
    headers: { ...bridge.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }),
  })).json()
  expect((await call('knowledge_search', { query: '退'.repeat(600), limit: 5, stage: 'test' })).result).toBeDefined()
  for (const args of [{ query: '退'.repeat(700) }, { query: 'x', limit: 6 }, { query: 'x', bank: 'other' }, { query: 'x', stage: 'root' }]) {
    expect((await call('knowledge_search', args)).error.code).toBe(-32602)
  }
  expect((await call('knowledge_read', { sourceRef: 'host-ref', expectedDigest: 'sha256:abc' })).result).toBeDefined()
  expect((await call('knowledge_read', { path: 'doc.md', sourceRef: 'host-ref' })).error.code).toBe(-32602)
  expect(query).toHaveBeenCalledTimes(2)
})

it('keeps concurrent bridges independent, bounds queries and never returns raw internal errors', async () => {
  const queryA = vi.fn(async () => { throw new Error('sensitive internal failure') })
  const a = await createWorkbenchMcpBridge({ query: queryA, signal: new AbortController().signal, maxQueries: 1 }); bridges.push(a)
  const b = await createWorkbenchMcpBridge({ query: async () => ({ project: 'project-B' }), signal: new AbortController().signal }); bridges.push(b)
  const call = async (bridge: typeof a, headers = bridge.headers) => (await fetch(bridge.url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'workflow', arguments: {} } }),
  }))
  expect((await call(b, a.headers)).status).toBe(401)
  const failed = await (await call(a)).text()
  expect(failed).not.toContain('sensitive internal failure')
  expect(failed).toContain('isError')
  await call(a)
  expect(queryA).toHaveBeenCalledTimes(1)
  await a.close()
  expect(await (await call(b)).text()).toContain('project-B')
})

it('honors the supplied investigation allowance beyond 32 reads and stops exactly at its boundary', async () => {
  const query = vi.fn(async () => ({ sourceId: 'evidence', result: {} }))
  const bridge = await createWorkbenchMcpBridge({ query, signal: new AbortController().signal, maxQueries: 40 }); bridges.push(bridge)
  const call = async () => (await fetch(bridge.url, { method: 'POST', headers: { ...bridge.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workflow', arguments: {} } }),
  })).json()
  for (let index = 0; index < 40; index++) expect((await call()).result.isError, `query ${index + 1}`).not.toBe(true)
  expect((await call()).result.isError).toBe(true)
  expect(query).toHaveBeenCalledTimes(40)
})

it('does not mint a query when the remaining allowance is zero or accept an unsafe allowance', async () => {
  const query = vi.fn(async () => ({}))
  const bridge = await createWorkbenchMcpBridge({ query, signal: new AbortController().signal, maxQueries: 0 }); bridges.push(bridge)
  const result = await (await fetch(bridge.url, { method: 'POST', headers: { ...bridge.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workflow', arguments: {} } }),
  })).json()
  expect(result.result.isError).toBe(true)
  expect(query).not.toHaveBeenCalled()
  for (const maxQueries of [-1, 1.5, Number.NaN, Infinity, 961]) {
    await expect(createWorkbenchMcpBridge({ query, signal: new AbortController().signal, maxQueries })).rejects.toThrow('查询额度')
  }
})
