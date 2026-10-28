// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { CODING_MEMORY_RECALL_BUDGET } from '@ai-devflow/shared'
import { HindsightError, type HindsightClient, type HindsightMemory } from './hindsight-client'
import { createLocalStore, type LocalStore } from './local-store'
import { createProjectMemoryRecall, projectMemoryStatement } from './project-memory-recall'

const directories: string[] = []
const stores: LocalStore[] = []
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close())
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
const now = new Date().toISOString()
const memories: HindsightMemory[] = [
  { id: 'o1', type: 'observation', text: '删除任务前\n要二次确认。' },
  { id: 'f1', type: 'world', text: '撤销窗口为 5 秒，密钥 sk-abcdefghijklmnopqrstuvwxyz0123456789 已轮换。', occurredAt: '2026-10-20T08:00:00.000Z', documentId: 'conversation:c1' },
]

async function fixture(options: { transport?: boolean } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-project-memory-recall-')); directories.push(directory)
  const store = await createLocalStore({ dbPath: path.join(directory, 'db.sqlite') }); stores.push(store)
  await store.upsertProject({ id: 'project', name: 'Synthetic', path: directory, packageManager: 'pnpm', testCommand: 'pnpm test', createdAt: now, updatedAt: now })
  const owner = await store.resolveLocalProjectMemoryPrincipal('project')
  if (owner.status !== 'resolved') throw new Error('No principal')
  const config = await store.configureProjectMemory({ projectId: 'project', ownerUserId: owner.userId, enabled: true,
    endpoint: 'http://127.0.0.1:8890', encryptedApiKey: null, providerId: 'deepseek' })
  const client = { recallMemories: vi.fn(async () => memories) }
  const degraded: string[] = []
  const recall = createProjectMemoryRecall({ store, transportAvailable: options.transport ?? true,
    client: async () => client as unknown as HindsightClient, onDegraded: (reason) => degraded.push(reason) })
  return { store, config, owner: owner.userId, client, recall, degraded }
}

it('recalls the project bank with a bounded query and labels each memory', async () => {
  const { recall, client, config, owner } = await fixture()
  const result = await recall.recall({ projectId: 'project', userId: owner, query: `删除确认 ${'背景'.repeat(2_000)}`, budget: CODING_MEMORY_RECALL_BUDGET })
  expect(client.recallMemories).toHaveBeenCalledWith(config.bankId, expect.objectContaining({ maxTokens: 2_000 }))
  const sent = (client.recallMemories.mock.calls[0] as unknown as [string, { query: string }])[1].query
  expect(new TextEncoder().encode(sent).byteLength).toBeLessThanOrEqual(1_500)
  expect(result).toEqual({ degraded: false, items: [
    { id: 'pm-o1', statement: '[observation] 删除任务前 要二次确认。', contentDigest: expect.stringMatching(/^sha256:/u) },
    { id: 'pm-f1', statement: expect.stringMatching(/^\[fact 2026-10-20\] 撤销窗口为 5 秒/u), contentDigest: expect.stringMatching(/^sha256:/u) },
  ] })
  expect(result!.items[1]!.statement).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789')
})

it('stays out of the way when memory is off, belongs to someone else, or the transport is closed', async () => {
  const { recall, store, config, owner } = await fixture()
  const input = { projectId: 'project', userId: owner, query: '删除', budget: CODING_MEMORY_RECALL_BUDGET }
  expect(await recall.recall({ ...input, userId: 'someone-else' })).toBeNull()
  await expect(recall.assertCurrent({ projectId: 'project', userId: owner })).resolves.toBeUndefined()
  await store.configureProjectMemory({ ...config, enabled: false })
  expect(await recall.recall(input)).toBeNull()
  expect(await recall.search({ projectId: 'project', query: '删除', limit: 5 })).toBeNull()
  await expect(recall.assertCurrent({ projectId: 'project', userId: owner })).rejects.toThrow('turned off')
  const closed = await fixture({ transport: false })
  expect(await closed.recall.recall({ ...input, userId: closed.owner })).toBeNull()
})

it('degrades to no memory when Hindsight fails, and searches with a limit', async () => {
  const { recall, client, owner, degraded } = await fixture()
  client.recallMemories.mockRejectedValueOnce(new HindsightError('timeout'))
  expect(await recall.recall({ projectId: 'project', userId: owner, query: '删除', budget: CODING_MEMORY_RECALL_BUDGET }))
    .toEqual({ degraded: true, items: [] })
  expect(degraded).toEqual(['Hindsight timeout'])
  expect(await recall.search({ projectId: 'project', query: '撤销', limit: 1 })).toEqual({
    items: [{ id: 'pm-o1', kind: 'observation', text: '删除任务前\n要二次确认。' }] })
  const controller = new AbortController(); controller.abort()
  client.recallMemories.mockRejectedValueOnce(new HindsightError('transport'))
  await expect(recall.search({ projectId: 'project', query: '撤销', limit: 5, signal: controller.signal })).rejects.toThrow()
})

it('formats a statement on one line with its kind and date', () => {
  expect(projectMemoryStatement({ id: 'x', type: 'experience', text: ' 用 pnpm\n安装依赖 ', occurredAt: '2026-10-21T00:00:00Z' }))
    .toBe('[fact 2026-10-21] 用 pnpm 安装依赖')
})
