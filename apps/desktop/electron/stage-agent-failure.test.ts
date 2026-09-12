import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOpenAiCompatibleAgentProvider, createWorkflowRunFromRequest, runWorkflowStageAgent,
  StageAgentExecutionError, type AgentTokenUsage,
} from '@ai-devflow/shared'
import { createLocalStore } from './local-store'
import { recordStageAgentFailure } from './stage-agent-failure'

const tempDirs: string[] = []
const now = '2026-09-07T08:00:00.000Z'
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-stage-failure-'))
  tempDirs.push(root)
  const dbPath = path.join(root, 'devflow.sqlite')
  const store = await createLocalStore({ dbPath })
  const { run } = createWorkflowRunFromRequest({
    runId: 'run-failure', title: 'Failure evidence', request: 'Change README',
    projectId: 'project', creatorId: 'member', branchName: 'ai/failure', now,
  })
  await store.saveRun(run)
  const usage: AgentTokenUsage = {
    id: 'provider-attempt', runId: run.id, nodeId: run.currentNodeId,
    userId: 'member', projectId: run.projectId, provider: 'openai', model: 'deepseek-v4-flash',
    inputTokens: 1942, outputTokens: 1953, cacheReadTokens: 0,
    costUsd: null, costStatus: 'unknown', executorKind: 'local-agent', providerId: 'deepseek',
    source: 'provider_reported', timestamp: now,
  }
  const input = {
    store, run, nodeId: run.currentNodeId, executorKind: 'local-agent' as const,
    completedAt: now, sequence: 1,
    error: new StageAgentExecutionError('schema_invalid', 'design.content is outside the allowed length', usage),
  }
  return { input, dbPath }
}

describe('recordStageAgentFailure', () => {
  it.each([
    { status: 401, body: '{"error":{"message":"RAW_PROVIDER_CONTENT"}}', diagnostic: 'http_4xx, HTTP 401', billing: 'not_incurred' },
    { status: 429, body: 'RAW_PROVIDER_CONTENT', diagnostic: 'http_429, HTTP 429', billing: 'not_incurred' },
    { status: 503, body: 'RAW_PROVIDER_CONTENT', diagnostic: 'http_5xx, HTTP 503', billing: 'unknown' },
    { status: 200, body: 'RAW_PROVIDER_CONTENT', diagnostic: 'invalid_response_json, HTTP 200', billing: 'unknown' },
    { status: 200, body: '{"choices":[{"message":{"content":"RAW_PROVIDER_CONTENT"}}]}', diagnostic: 'invalid_model_output, HTTP 200', billing: 'unknown' },
    { status: 0, body: '', diagnostic: 'connection_reset', billing: 'unknown' },
  ])('preserves safe direct Provider $diagnostic through the real stage and SQLite audit', async ({ status, body, diagnostic, billing }) => {
    const { input, dbPath } = await fixture()
    const server = createServer((request, response) => {
      if (!status) {
        request.socket.destroy()
        return
      }
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Provider fixture did not bind')
      const provider = createOpenAiCompatibleAgentProvider({
        id: 'test-provider', model: 'test-model', apiKey: 'PRIVATE_PROVIDER_KEY',
        baseUrl: `http://127.0.0.1:${address.port}`,
      })
      const error = await runWorkflowStageAgent({
        run: input.run, node: input.run.nodes.find((node) => node.id === input.nodeId)!,
        artifacts: [], provider, requestedBy: 'member', runtime: 'electron',
      }).catch((failure: unknown) => failure)
      await expect(recordStageAgentFailure({ ...input, executorKind: 'direct-provider', error }))
        .rejects.toThrow(diagnostic)
      const restored = await createLocalStore({ dbPath })
      const traces = await restored.listAgentTraces(input.run.id)
      const events = await restored.listEvents(input.run.id)
      expect(traces[0]?.steps[0]?.summary).toContain(diagnostic)
      expect(traces[0]?.steps[0]?.summary).toContain(`billing=${billing}`)
      expect(events[0]?.message).toContain(diagnostic)
      expect(JSON.stringify({ traces, events })).not.toMatch(/RAW_PROVIDER_CONTENT|PRIVATE_PROVIDER_KEY/)
      expect(await restored.getRun(input.run.id)).toEqual(input.run)
      expect(await restored.listArtifacts(input.run.id)).toEqual([])
      expect(await restored.listAgentTokenUsage(input.run.id)).toEqual([])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('persists each rejected response usage with its failure audit, without advancing the workflow', async () => {
    const { input, dbPath } = await fixture()
    for (const sequence of [1, 2]) {
      await expect(recordStageAgentFailure({ ...input, sequence })).rejects.toThrow(/design.content/)
    }
    const restored = await createLocalStore({ dbPath })
    const usages = await restored.listAgentTokenUsage(input.run.id)
    const traces = await restored.listAgentTraces(input.run.id)
    expect(usages).toHaveLength(2)
    expect(usages.every((usage) => usage.costUsd === null && usage.executorKind === 'local-agent')).toBe(true)
    expect(new Set(usages.map((usage) => usage.id)).size).toBe(2)
    expect(usages.every((usage) => usage.inputTokens === 1942 && usage.outputTokens === 1953)).toBe(true)
    expect(traces).toHaveLength(2)
    expect(traces.every((trace) => trace.steps[0]?.summary.includes('design.content'))).toBe(true)
    expect(await restored.listArtifacts(input.run.id)).toEqual([])
    expect(await restored.getRun(input.run.id)).toEqual(input.run)
  })

  it('reports audit persistence failure without exposing storage errors or creating evidence', async () => {
    const { input } = await fixture()
    vi.spyOn(input.store, 'commitWorkflowMutation').mockRejectedValue(new Error('secret storage detail'))
    await expect(recordStageAgentFailure(input)).rejects.toThrow('failure audit could not be persisted')
    expect(await input.store.listAgentTokenUsage(input.run.id)).toEqual([])
    expect(await input.store.listAgentTraces(input.run.id)).toEqual([])
    expect(await input.store.getRun(input.run.id)).toEqual(input.run)
  })

  it('rejects a stale failure audit atomically with its usage', async () => {
    const { input } = await fixture()
    await input.store.saveRun({ ...input.run, version: input.run.version + 1 })
    await expect(recordStageAgentFailure(input)).rejects.toThrow('failure audit was rejected (stale_run)')
    expect(await input.store.listAgentTokenUsage(input.run.id)).toEqual([])
    expect(await input.store.listAgentTraces(input.run.id)).toEqual([])
  })

  it('rolls back usage, trace and event together when the SQLite file cannot be persisted', async () => {
    const { input, dbPath } = await fixture()
    await rename(dbPath, `${dbPath}.backup`)
    await mkdir(dbPath)
    await expect(recordStageAgentFailure(input)).rejects.toThrow('failure audit could not be persisted')
    expect(await input.store.listAgentTokenUsage(input.run.id)).toEqual([])
    expect(await input.store.listAgentTraces(input.run.id)).toEqual([])
    expect(await input.store.listEvents(input.run.id)).toEqual([])
    expect(await input.store.getRun(input.run.id)).toEqual(input.run)
  })

  it('does not persist raw unknown executor errors or guess their usage', async () => {
    const { input } = await fixture()
    await expect(recordStageAgentFailure({ ...input, error: new Error('RAW_PROVIDER_CONTENT') }))
      .rejects.toThrow('executor failed before a validated response')
    const traces = await input.store.listAgentTraces(input.run.id)
    expect(JSON.stringify(traces)).not.toContain('RAW_PROVIDER_CONTENT')
    expect(await input.store.listAgentTokenUsage(input.run.id)).toEqual([])
  })
})
