import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkflowRunFromRequest, StageAgentExecutionError, type AgentTokenUsage } from '@ai-devflow/shared'
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
    costUsd: 0.004, source: 'provider_reported', timestamp: now,
  }
  const input = {
    store, run, nodeId: run.currentNodeId, executorKind: 'direct-provider' as const,
    completedAt: now, sequence: 1,
    error: new StageAgentExecutionError('schema_invalid', 'design.content is outside the allowed length', usage),
  }
  return { input, dbPath }
}

describe('recordStageAgentFailure', () => {
  it('persists each rejected response usage with its failure audit, without advancing the workflow', async () => {
    const { input, dbPath } = await fixture()
    for (const sequence of [1, 2]) {
      await expect(recordStageAgentFailure({ ...input, sequence })).rejects.toThrow(/design.content/)
    }
    const restored = await createLocalStore({ dbPath })
    const usages = await restored.listAgentTokenUsage(input.run.id)
    const traces = await restored.listAgentTraces(input.run.id)
    expect(usages).toHaveLength(2)
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
