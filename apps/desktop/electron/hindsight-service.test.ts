// @vitest-environment node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { createLocalStore, type LocalStore } from './local-store'
import { createRepositoryKnowledgeService } from './repository-knowledge'
import { HindsightService } from './hindsight-service'
import type { HindsightClient } from './hindsight-client'
import { HindsightError } from './hindsight-client'
import { createHindsightContextService } from './hindsight-context'

const exec = promisify(execFile)
const roots: string[] = []; const stores: LocalStore[] = []
afterEach(async () => { stores.splice(0).forEach((s) => s.close()); await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))) })
async function fixture(includeMemories = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hindsight-service-')); roots.push(root)
  await exec('git', ['init', root]); await mkdir(path.join(root, 'docs/knowledge'), { recursive: true })
  await writeFile(path.join(root, 'docs/knowledge/model.json'), JSON.stringify({ version: 'refund-v1', dimensions: [{ key: 'sem_kind', type: 'text' }] }))
  await writeFile(path.join(root, 'docs/knowledge/refund.md'), '# Refund\n\n退款必须核验原订单。')
  await exec('git', ['-C', root, 'add', '.'])
  const store = await createLocalStore({ dbPath: path.join(root, 'local.db') }); stores.push(store)
  const project = { id: 'p1', name: 'test', path: root, packageManager: 'npm' as const, testCommand: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  await store.upsertProject(project)
  const docs = new Map<string, { documentId: string; metadata: Record<string, string> }>()
  const client: HindsightClient = {
    configureBank: vi.fn(async () => {}),
    configureMemoryBank: vi.fn(async () => {}),
    retainDocument: vi.fn(async () => {}),
    recallMemories: vi.fn(async () => []),
    retain: vi.fn(async (_bank, item) => { docs.set(item.documentId, item) }),
    operation: vi.fn(async () => docs.size ? 'completed' : 'not_found'),
    deleteDocument: vi.fn(async (_bank, id) => { docs.delete(id) }),
    getDocument: vi.fn(async () => { throw new Error('Projection recall never exports staging facts') }),
    listDocumentFacts: vi.fn(async () => { throw new Error('Projection recall never exports staging facts') }),
    recall: vi.fn(async () => [...docs.values()]),
  }
  let now = Date.now()
  // Mirrors Main's cached root catalogue; exact source reads must still catch file changes.
  const snapshot = await createRepositoryKnowledgeService().index(project)
  const connect = vi.fn(async () => client)
  const service = new HindsightService({ store, transportAvailable: true, client: connect,
    loadKnowledge: async () => snapshot, now: () => new Date(now += 5000).toISOString() })
  const scope = { projectId: project.id, userId: 'u1' }
  await service.configure(scope, { projectId: project.id, endpoint: 'http://127.0.0.1:8888', selectedPaths: ['docs/knowledge/refund.md'], includeMemories, enabled: true }, null)
  return { root, store, service, client, connect, scope }
}

it('searches semantic candidates using current local text, checks continuation digests and limits calls per turn', async () => {
  const { service, client, scope, root } = await fixture()
  await service.tick(); await service.tick()
  const turn = service.createSearchTurn()
  const result = await service.search(scope, { query: 'money back' }, turn)
  expect(result.matches[0]).toMatchObject({ path: 'docs/knowledge/refund.md', content: '# Refund\n\n退款必须核验原订单。', matchReason: 'semantic' })
  const args = result.matches[0]!.readArgs
  await writeFile(path.join(root, args.path), '# Refund\n\n退款规则已更新。')
  await expect(service.read(scope, args)).resolves.toMatchObject({ error: 'source_changed' })
  await service.search(scope, { query: 'second' }, turn)
  await service.search(scope, { query: 'third' }, turn)
  expect(client.recall).toHaveBeenCalledTimes(2)
  await expect(service.read({ ...scope, userId: 'foreign' }, args)).rejects.toThrow()
})

it('keeps local lexical results when the provider fails and never returns a fabricated remote source', async () => {
  const { service, client, scope } = await fixture()
  await service.tick(); await service.tick()
  vi.mocked(client.recall).mockRejectedValueOnce(new Error('provider unavailable'))
  const result = await service.search(scope, { query: '退款' }, service.createSearchTurn())
  expect(result).toMatchObject({ degraded: true, matches: [{ path: 'docs/knowledge/refund.md' }] })
  vi.mocked(client.recall).mockResolvedValueOnce([{ documentId: '../../private', metadata: {} }])
  expect((await service.search(scope, { query: 'unrelated' }, service.createSearchTurn())).matches).toEqual([])
})

it('waits for an in-flight write to finish before cleanup and stops local use immediately on disable', async () => {
  const { service, client, scope } = await fixture()
  await service.tick()
  vi.mocked(client.operation).mockResolvedValue('processing')
  await service.disable(scope)
  await service.tick()
  expect(client.deleteDocument).not.toHaveBeenCalled()
  expect((await service.search(scope, { query: '退款' }, service.createSearchTurn())).matches).toEqual([])
  vi.mocked(client.operation).mockResolvedValue('completed')
  await service.tick()
  expect(client.deleteDocument).toHaveBeenCalledTimes(1)
})

it('cancels a stale queued snapshot before any upload and permits its new revision to proceed', async () => {
  const { service, client, scope, root, store } = await fixture()
  await writeFile(path.join(root, 'docs/knowledge/refund.md'), '# Refund\n\nA new rule.')
  await service.tick()
  expect(client.retain).not.toHaveBeenCalled()
  expect((await store.listHindsightProjections(scope.projectId))[0]).toMatchObject({ status: 'cancelled', revoked: true })
  await service.refresh(scope); await service.tick()
  expect(client.retain).toHaveBeenCalledTimes(1)
})

it('bounds unknown retain replays to three attempts using the same immutable payload and UUID', async () => {
  const { service, client, store, scope } = await fixture()
  vi.mocked(client.retain).mockRejectedValue(new Error('response lost'))
  vi.mocked(client.operation).mockResolvedValue('not_found')
  for (let i = 0; i < 80; i++) await service.tick()
  expect(client.retain).toHaveBeenCalledTimes(3)
  const items = vi.mocked(client.retain).mock.calls.map(([, item]) => JSON.stringify(item))
  expect(new Set(items).size).toBe(1)
  expect((await store.listHindsightProjections(scope.projectId))[0]?.status).toBe('unknown')
})

it('classifies credential access failures as optional provider failures without hiding local integrity failures', async () => {
  const { service, connect, store, scope } = await fixture(true)
  const request = { scope: { kind: 'local' as const, organizationId: null, projectId: null, localProjectId: scope.projectId,
    userId: scope.userId, sessionId: 'session' }, runtimeId: 'run', query: '退款' }
  connect.mockRejectedValueOnce(new Error('OS credential store unavailable'))
  await expect(service.recallMemoryCandidates(request)).rejects.toBeInstanceOf(HindsightError)
  vi.spyOn(store, 'getHindsightConfiguration').mockRejectedValueOnce(new Error('local integrity'))
  await expect(service.recallMemoryCandidates(request)).rejects.toThrow('local integrity')
})

it('continues queued cleanup when refreshing an enabled project fails', async () => {
  const { service, store, scope, client } = await fixture()
  await service.tick(); await service.disable(scope)
  const config = (await store.getHindsightConfiguration(scope.projectId))!
  // Another enabled project must not prevent an old project's durable cleanup.
  vi.spyOn(store, 'listHindsightConfigurations').mockResolvedValue([{ ...config, projectId: 'unavailable-project', enabled: true }])
  vi.spyOn(service, 'refresh').mockRejectedValue(new Error('repository unavailable'))
  await service.cycle()
  expect(client.deleteDocument).toHaveBeenCalledTimes(1)
})

it('discards semantic results when consent is withdrawn during the provider request', async () => {
  const { service, scope, client } = await fixture()
  await service.tick(); await service.tick()
  vi.mocked(client.recall).mockImplementationOnce(async () => { await service.disable(scope); return [] })
  expect((await service.search(scope, { query: '退款' }, service.createSearchTurn())).matches).toEqual([])
})

it('requires fresh paired-project consent, binds the private projection to identity and excludes team memories', async () => {
  const { service, store, scope } = await fixture()
  const pairing = { tokenId: 'token-1', organizationId: 'org-1', projectId: 'team-1',
    localProjectId: scope.projectId, userId: scope.userId, role: 'member' as const,
    authAccountId: 'account-1', projectMemberships: [], createdAt: new Date().toISOString() }
  await store.saveDesktopPairingCredential(pairing, 'synthetic-token')
  expect((await service.status(scope)).enabled).toBe(false)
  const setup = { projectId: scope.projectId, endpoint: 'http://127.0.0.1:8888',
    selectedPaths: ['docs/knowledge/refund.md'], includeMemories: false, enabled: true }
  await expect(service.configure(scope, setup, null)).rejects.toThrow(/配对|paired/)
  await expect(service.configure(scope, { ...setup, pairedProjectConsent: true, includeMemories: true }, null)).rejects.toThrow(/记忆|memor/)
  await service.configure(scope, { ...setup, pairedProjectConsent: true }, null)
  const generation = (await store.getHindsightConfiguration(scope.projectId))!.generation
  expect((await service.search(scope, { query: '退款' }, service.createSearchTurn())).matches).toHaveLength(1)
  await store.saveDesktopPairingCredential({ ...pairing, tokenId: 'rotated-token' }, 'synthetic-rotated')
  expect((await store.getHindsightConfiguration(scope.projectId))!.generation).toBe(generation)
  expect((await service.status(scope)).enabled).toBe(true)
  await store.saveDesktopPairingCredential({ ...pairing, authAccountId: 'different-account' }, 'synthetic-changed')
  expect((await service.status(scope)).enabled).toBe(false)
  expect((await service.search(scope, { query: '退款' }, service.createSearchTurn())).matches).toEqual([])
})

it.each(['clarify', 'design', 'build', 'test', 'pr', 'accept'] as const)('prepares a source-bound %s context and invalidates it after a local revision', async (stage) => {
  const { service, scope, root } = await fixture()
  await writeFile(path.join(root, 'docs/knowledge/refund.md'), `---\nstages: [${stage}]\n---\n# Refund\n\n退款必须核验原订单。`)
  const context = createHindsightContextService(service)
  const prepared = await context.prepareRetrievedKnowledge({ ...scope, stage, query: '退款' })
  expect(prepared?.manifest).toMatchObject({ stage, scope, references: [
    { path: 'docs/knowledge/refund.md', contentDigest: expect.stringMatching(/^sha256:/) },
  ] })
  expect(prepared?.sources[0]?.content).toContain('核验原订单')
  await context.assertRetrievedKnowledgeCurrent(prepared!.manifest)
  await writeFile(path.join(root, 'docs/knowledge/refund.md'), '# Refund\n\n新的规则。')
  await expect(context.assertRetrievedKnowledgeCurrent(prepared!.manifest)).rejects.toThrow(/知识.*变化|知识.*失效/)
})

it('distinguishes optional absence/provider failure from revoked context and cancellation', async () => {
  const { service, scope, client, root } = await fixture()
  await writeFile(path.join(root, 'docs/knowledge/refund.md'), '---\nstages: [design]\n---\n# Refund\n\n退款必须核验原订单。')
  const context = createHindsightContextService(service)
  vi.mocked(client.recall).mockRejectedValue(new Error('offline'))
  const prepared = await context.prepareRetrievedKnowledge({ ...scope, stage: 'design', query: '退款' })
  expect(prepared?.manifest.degraded).toBe(true)
  expect(prepared?.manifest.references).toHaveLength(1)
  await service.disable(scope)
  await expect(context.assertRetrievedKnowledgeCurrent(prepared!.manifest)).rejects.toThrow(/知识.*变化|知识.*失效/)
  expect(await context.prepareRetrievedKnowledge({ ...scope, stage: 'design', query: '退款' })).toBeUndefined()
  const aborted = AbortSignal.abort(new Error('cancelled'))
  await expect(context.prepareRetrievedKnowledge({ ...scope, stage: 'design', query: '退款', signal: aborted })).rejects.toThrow('cancelled')
})
