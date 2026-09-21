// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { access } from 'node:fs/promises'
import { createWorkbenchOpencodeExecutor } from './workbench-opencode-executor'
import type { OpencodeMessage } from './opencode-http-adapter'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())) })
const binding = { providerId: 'saved', modelId: 'chosen', baseUrl: 'https://provider.example/v1', apiKey: 'synthetic-test-key', fingerprint: 'fixture' }
const message = (id: string, text: string, reasoning = ''): OpencodeMessage => ({ info: { id, role: 'assistant', providerID: 'saved', modelID: 'chosen', tokens: { input: 10, output: 3, reasoning: 2, cache: { read: 1, write: 0 } } },
  parts: [...(reasoning ? [{ type: 'reasoning', text: reasoning }] : []), ...(text ? [{ type: 'text', text }] : [])] })

it('runs through the harness, exposes scoped MCP tools, and reports only actual model usage/reasoning', async () => {
  let directory = ''
  let runtimeEnv: NodeJS.ProcessEnv = {}
  const manager = { ensure: vi.fn(async (input) => { runtimeEnv = input.env; return { baseUrl: 'http://127.0.0.1:41234' } }), stopAll: vi.fn(async () => {}) }
  const query = vi.fn(async () => ({ sourceId: 'source-1', result: { run: 'local-run' } }))
  const final = message('a2', JSON.stringify({ text: '已查到当前节点', format: 'markdown' }), '给出依据')
  const first = message('a1', '', '查询真实进展')
  const requests: Array<{ url: string; body?: Record<string, unknown> }> = []
  const fetcher: typeof fetch = async (url, options) => {
    const parsed = new URL(String(url)); directory = parsed.searchParams.get('directory') ?? directory
    const body = options?.body ? JSON.parse(String(options.body)) : undefined
    requests.push({ url: parsed.pathname, body })
    expect(new Headers(options?.headers).get('authorization')).toMatch(/^Basic /)
    if (parsed.pathname === '/session') return Response.json({ id: 'session-a', directory })
    if (options?.method === 'POST' && parsed.pathname.endsWith('/message')) {
      expect(body.agent).toBe('devflow')
      expect(body.system).toBe('system contract')
      const config = JSON.parse(runtimeEnv.OPENCODE_CONFIG_CONTENT!)
      const bridge = config.mcp.devflow
      const result = await fetch(bridge.url, { method: 'POST', headers: { ...bridge.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workflow', arguments: {} } }) })
      expect((await result.json()).result.content[0].text).toContain('local-run')
      await new Promise((resolve) => setTimeout(resolve, 30))
      return Response.json(final)
    }
    return Response.json([first, final])
  }
  const executor = await createWorkbenchOpencodeExecutor({ binaryPath: '/fixture/opencode', binding,
    signal: new AbortController().signal, query, deps: { manager, fetcher, pollMs: 5 }, baseEnv: { PATH: '/bin', DANGEROUS_SECRET: 'do-not-copy' } })
  cleanups.push(() => executor.close!())
  const deltas: string[] = []
  const output = await executor.completeStructuredJson!({ systemPrompt: 'system contract', userPrompt: 'only this conversation', maxOutputTokens: 3500, reasoning: { onDelta: (text) => { deltas.push(text) } } })
  expect(output.value.text).toBe('已查到当前节点')
  expect(output.usage).toMatchObject({ inputTokens: 22, outputTokens: 10, totalTokens: 32 })
  expect(output.reasoningContent).toContain('查询真实进展')
  expect(deltas.join('')).toContain('给出依据')
  expect(query).toHaveBeenCalledWith('workflow', {})
  expect(runtimeEnv.DANGEROUS_SECRET).toBeUndefined()
  const config = JSON.parse(runtimeEnv.OPENCODE_CONFIG_CONTENT!)
  expect(config.permission).toEqual({ '*': 'deny', question: 'deny', task: 'deny', 'devflow_*': 'allow' })
  expect(config.agent.devflow.steps).toBe(12)
  expect(config.share).toBe('disabled')
  expect(config.provider.saved.options.apiKey).not.toContain(binding.apiKey)
  expect(requests.find((request) => request.url === '/session')?.body?.permission).toContainEqual({ permission: '*', pattern: '*', action: 'deny' })
  await executor.close!(); await executor.close!()
  expect(manager.stopAll).toHaveBeenCalledTimes(1)
  await expect(access(directory)).rejects.toThrow()
})

it('cleans up its bridge and temporary directory when cancelled during runtime startup', async () => {
  const controller = new AbortController()
  let release!: () => void
  let runtimeEnv: NodeJS.ProcessEnv = {}
  const entered = vi.fn()
  const stop = vi.fn(async () => {})
  const fetcher = vi.fn<typeof fetch>()
  const pending = createWorkbenchOpencodeExecutor({ binaryPath: '/fixture/opencode', binding,
    signal: controller.signal, query: async () => ({}), deps: { fetcher, manager: {
      ensure: async (input) => { runtimeEnv = input.env; entered(); await new Promise<void>((resolve) => { release = resolve }); return { baseUrl: 'http://127.0.0.1:41234' } }, stopAll: stop,
    } } })
  const rejection = expect(pending).rejects.toThrow('startup-cancel')
  await vi.waitFor(() => expect(entered).toHaveBeenCalled())
  const bridge = JSON.parse(runtimeEnv.OPENCODE_CONFIG_CONTENT!).mcp.devflow
  controller.abort(new Error('startup-cancel'))
  release()
  await rejection
  expect(stop).toHaveBeenCalledTimes(1)
  expect(fetcher).not.toHaveBeenCalled()
  await expect(access(runtimeEnv.XDG_CONFIG_HOME! + '/..')).rejects.toThrow()
  await expect(fetch(bridge.url, { method: 'POST', headers: bridge.headers })).rejects.toThrow()
})

it('cancels its own session, cleans up, and never falls back when OpenCode returns another model', async () => {
  const controller = new AbortController()
  const stop = vi.fn(async () => {})
  const aborted: string[] = []
  const executor = await createWorkbenchOpencodeExecutor({ binaryPath: '/fixture/opencode', binding, signal: controller.signal, query: async () => ({}),
    deps: { manager: { ensure: async () => ({ baseUrl: 'http://127.0.0.1:41235' }), stopAll: stop }, fetcher: async (url, options) => {
      const path = new URL(String(url)).pathname
      if (path === '/session') return Response.json({ id: 'own-session' })
      if (path.endsWith('/abort')) { aborted.push(path); return Response.json(true) }
      if (options?.method === 'POST') return new Promise((_, reject) => options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true }))
      return Response.json([])
    } } })
  cleanups.push(() => executor.close!())
  const operation = executor.completeStructuredJson!({ systemPrompt: 'system', userPrompt: 'question', maxOutputTokens: 3500 }).catch((error) => error)
  await vi.waitFor(() => expect(executor).toBeDefined())
  controller.abort(new Error('user-cancel'))
  expect(await operation).toBeInstanceOf(Error)
  await executor.close!()
  expect(aborted).toEqual(['/session/own-session/abort'])
  expect(stop).toHaveBeenCalledTimes(1)

  const wrong = message('wrong', '{"text":"not valid for this selection"}')
  wrong.info.modelID = 'different-model'
  const mismatched = await createWorkbenchOpencodeExecutor({ binaryPath: '/fixture/opencode', binding, signal: new AbortController().signal, query: async () => ({}),
    deps: { manager: { ensure: async () => ({ baseUrl: 'http://127.0.0.1:41236' }), stopAll: async () => {} }, fetcher: async (url, options) => Response.json(new URL(String(url)).pathname === '/session' ? { id: 'wrong-session' } : options?.method === 'POST' ? wrong : [wrong]) } })
  cleanups.push(() => mismatched.close!())
  await expect(mismatched.completeStructuredJson!({ systemPrompt: 'system', userPrompt: 'question', maxOutputTokens: 3500 })).rejects.toThrow('模型')
})
