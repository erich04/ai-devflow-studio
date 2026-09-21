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
  expect(tools.map((tool: { name: string }) => tool.name)).toEqual(['workflow', 'node', 'artifact', 'repo_list', 'repo_read', 'repo_search', 'knowledge'])
  expect(tools.every((tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint)).toBe(true)
  expect((await (await rpc('tools/call', { name: 'node', arguments: { runId: 'run-A', nodeId: 'node-A' } })).json()).result.content[0].text).toContain('project-A')
  expect(query).toHaveBeenCalledWith('node', { runId: 'run-A', nodeId: 'node-A' })
  expect((await (await rpc('tools/call', { name: 'node', arguments: { projectId: 'project-B', runId: 'run-A', nodeId: 'node-A' } })).json()).error.code).toBe(-32602)
  expect((await (await rpc('tools/call', { name: 'approve_gate', arguments: {} })).json()).error.code).toBe(-32602)
  expect(query).toHaveBeenCalledTimes(1)
  controller.abort()
  expect((await (await rpc('tools/call', { name: 'workflow', arguments: {} })).json()).result.isError).toBe(true)
  expect(query).toHaveBeenCalledTimes(1)
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
