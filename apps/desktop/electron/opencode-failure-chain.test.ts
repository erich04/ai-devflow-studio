// @vitest-environment node
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkflowRunFromRequest, runWorkflowStageAgent, type ModelCallGovernance, type StageAgentExecutionError } from '@ai-devflow/shared'
import { createGovernedOpencodeProxy } from './governed-opencode-proxy'
import { createReadOnlyLocalStageAgentExecutor } from './stage-agent-executor'
import { withGovernedStageAgent } from './governed-stage-agent'
import { createLocalStore } from './local-store'
import { recordStageAgentFailure } from './stage-agent-failure'
import { ipcErrorMessage } from '../src/app/ipc-error'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); vi.restoreAllMocks() })
const binding = { providerId: 'test-provider', modelId: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'PRIVATE_KEY', fingerprint: 'fixture' }

async function fixture(rounds: Array<number | 'denied' | 'cancelled'>, options: { stopFails?: boolean; closeFails?: boolean; output?: string; permission?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'devflow-error-chain-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const repo = path.join(root, 'repo')
  await mkdir(repo)
  await writeFile(path.join(repo, 'README.md'), 'Fixture\n')
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'], { cwd: repo })
  let round = -1
  const governance: ModelCallGovernance = {
    pending: async () => [], persist: vi.fn(async () => {}), settle: vi.fn(async () => {}),
    reserve: vi.fn(async () => ({ accepted: rounds[++round] !== 'denied', decision: {
      status: 'unavailable' as const, blocksRun: rounds[round] === 'denied', currentSpendUsd: 0,
      projectedCostUsd: 0, reason: 'RAW_REASON PRIVATE_KEY /private/project',
    } })),
  }
  const upstream = vi.fn(async (_url: Parameters<typeof fetch>[0], options?: RequestInit) => {
    if (rounds[round] === 'cancelled') return new Promise<never>((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
    const status = rounds[round] as number
    return new Response(status === 200 ? JSON.stringify({ choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10 },
    }) : 'RAW_PROVIDER_BODY PRIVATE_KEY', { status })
  })
  const proxy = await createGovernedOpencodeProxy({ binding, projectId: 'project', governance, fetcher: upstream })
  cleanup.push(() => proxy.close().catch(() => {}))
  const assistant = { info: { id: 'assistant', role: 'assistant', providerID: binding.providerId, modelID: binding.modelId,
    tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } },
    parts: [{ type: 'text', text: options.output ?? 'invalid structured output' }],
  }
  // Deterministic OpenCode protocol fixture; sends genuine HTTP calls to the real budget relay.
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.method === 'POST' && req.url?.startsWith('/session?')) return void res.end(JSON.stringify({ id: 'session' }))
    if (req.method === 'POST' && req.url?.startsWith('/session/session/message?')) {
      for (const _ of rounds) {
        const response = await fetch(`${proxy.binding.baseUrl}/chat/completions`, {
          method: 'POST', headers: { authorization: `Bearer ${proxy.binding.apiKey}` },
          body: JSON.stringify({ model: binding.modelId, messages: [{ content: 'PRIVATE_PROMPT' }] }),
        })
        const body = await response.text()
        if (!response.ok) return void res.end(JSON.stringify({ info: { error: { name: 'APIError', data: {
          statusCode: response.status, responseHeaders: Object.fromEntries(response.headers),
          message: 'RAW_OPENCODE_ERROR', responseBody: body,
        } } }, parts: [] }))
      }
      return void res.end(JSON.stringify(assistant))
    }
    res.end(JSON.stringify(req.url?.startsWith('/session/session/message?') ? [assistant]
      : options.permission && req.url?.startsWith('/permission?') ? [{ id: 'permission', sessionID: 'session', permission: 'bash' }] : []))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) })
  const address = server.address() as { port: number }
  const local = createReadOnlyLocalStageAgentExecutor({
    projectId: 'project', projectPath: repo, binaryPath: 'controlled-opencode', providerId: binding.providerId,
    modelId: binding.modelId, detectedVersion: 'fixture', runtimeEnv: {}, billingBinding: binding,
    processManager: {
      ensure: async ({ projectId }) => ({ projectId, baseUrl: `http://127.0.0.1:${address.port}`, child: {} as never }),
      stopProject: async () => { if (options.stopFails) throw new Error('PRIVATE_STOP /private/project') },
    },
  })
  const relay = { ...proxy, close: async () => { await proxy.close(); if (options.closeFails) throw new Error('PRIVATE_CLOSE') } }
  const executor = withGovernedStageAgent(local, relay)
  const created = createWorkflowRunFromRequest({ runId: 'run', title: 'Fixture', request: 'Clarify', projectId: 'project',
    creatorId: 'user', branchName: 'main', now: '2026-10-04T10:00:00.000Z' })
  const dbPath = path.join(root, 'store.sqlite')
  const store = await createLocalStore({ dbPath })
  await store.saveRun(created.run)
  const error = await runWorkflowStageAgent({ run: created.run, node: created.run.nodes[0]!, artifacts: created.artifacts,
    executor, requestedBy: 'user', runtime: 'electron' }).catch((error: StageAgentExecutionError) => error)
  expect(error).toHaveProperty('terminalReason')
  const rejection = await recordStageAgentFailure({ store, run: created.run, nodeId: created.run.currentNodeId,
    executorKind: 'local-agent', completedAt: '2026-10-04T10:01:00.000Z', sequence: 1, error }).catch((error: Error) => error)
  const ipc = ipcErrorMessage(new Error(`Error invoking remote method 'complete-stage': Error: ${rejection.message}`), 'fallback')
  const restored = await createLocalStore({ dbPath })
  const state = await restored.loadState()
  expect(await restored.getRun(created.run.id)).toEqual(created.run)
  expect(await restored.listArtifacts(created.run.id)).toEqual([])
  expect(JSON.stringify({ error, state, ipc })).not.toMatch(/PRIVATE_KEY|PRIVATE_PROMPT|RAW_REASON|RAW_PROVIDER_BODY|RAW_OPENCODE_ERROR|PRIVATE_STOP|PRIVATE_CLOSE|\/private\/project/)
  return { error: error as StageAgentExecutionError, state, ipc, upstream, governance }
}

describe('OpenCode relay → adapter → executor → Main wrapper → shared stage → SQLite → IPC', () => {
  it('persists a budget denial without contacting the upstream or advancing the workflow', async () => {
    const result = await fixture(['denied'])
    expect(result.upstream).not.toHaveBeenCalled()
    expect(result.governance.settle).not.toHaveBeenCalled()
    expect(result.error).toMatchObject({ terminalReason: 'failed', failureDetails: { code: 'budget_denied', source: 'budget_relay' } })
    expect(result.state.agentTraces[0]?.failureDetails).toEqual(result.error.failureDetails)
    expect(result.ipc).toContain('本轮请求尚未发送')
    expect(result.ipc).not.toContain('cli_unavailable')
  })

  it('keeps earlier rounds, their cost and call IDs when the last round is denied', async () => {
    const result = await fixture([200, 'denied'])
    expect(result.upstream).toHaveBeenCalledTimes(1)
    expect(result.state.agentTokenUsage[0]).toMatchObject({ inputTokens: 10, outputTokens: 5, costStatus: 'estimated', budgetAttemptIds: [expect.stringMatching(/^model-call-/)] })
    expect(result.state.agentTokenUsage[0]!.costUsd).toBeGreaterThan(0)
    expect(result.error.failureDetails?.code).toBe('budget_denied')
  })

  it.each([[401, 'provider_auth'], [403, 'provider_auth'], [429, 'provider_rate_limit'], [503, 'provider_unavailable']] as const)
    ('refines relay HTTP 400 using the exact failing upstream call (%s)', async (status, code) => {
      const result = await fixture([status])
      expect(result.error.failureDetails).toMatchObject({ code, source: 'provider', httpStatus: status })
      expect(result.state.agentTraces[0]?.failureDetails).toEqual(result.error.failureDetails)
      // Classification is not permission to clear unknown charges.
      expect(result.state.agentTokenUsage[0]?.costUsd).toBeNull()
    })

  it('keeps both cleanup failures as secondary diagnostics after budget rejection', async () => {
    const result = await fixture([200, 'denied'], { stopFails: true, closeFails: true })
    expect(result.error.failureDetails).toMatchObject({ code: 'budget_denied', cleanupFailures: ['process_stop', 'relay_close'] })
    expect(result.state.agentTokenUsage[0]?.inputTokens).toBe(10)
    expect(result.ipc).toContain('清理未完成')
  })

  it('reports a cleanup failure after a valid response and preserves its usage', async () => {
    const result = await fixture([200], { stopFails: true, output: JSON.stringify({ model: binding.modelId }) })
    expect(result.error.failureDetails).toMatchObject({ code: 'cleanup_failed', cleanupFailures: ['process_stop'] })
    expect(result.state.agentTokenUsage[0]?.inputTokens).toBe(10)
  })

  it('keeps permission escalation primary when shutdown also fails', async () => {
    const result = await fixture([200], { stopFails: true, permission: true, output: '{}' })
    expect(result.error).toMatchObject({ terminalReason: 'permission_denied', failureDetails: { code: 'permission_denied', cleanupFailures: ['process_stop'] } })
    expect(result.state.agentTokenUsage[0]?.inputTokens).toBe(10)
  })

  it('retains cancellation as a terminal reason when the relay refines a generic APIError', async () => {
    const setTimer = globalThis.setTimeout
    // Trigger the relay's real abort/settlement path without waiting five minutes.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) =>
      setTimer(callback, delay === 300_000 ? 100 : delay, ...args)) as typeof setTimeout)
    const result = await fixture([200, 'cancelled'], { stopFails: true })
    expect(result.error).toMatchObject({ terminalReason: 'cancelled', failureDetails: { code: 'cancelled', cleanupFailures: ['process_stop'] } })
    expect(result.state.agentTokenUsage[0]).toMatchObject({ inputTokens: 10, costUsd: null })
    expect(result.state.agentTokenUsage[0]?.budgetAttemptIds).toHaveLength(2)
  })
})
