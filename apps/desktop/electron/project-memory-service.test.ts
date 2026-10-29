// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { PROJECT_MEMORY_MISSIONS, PROJECT_MEMORY_POLICY_VERSION, type ProjectMemoryDocumentInput } from '@ai-devflow/shared'
import { HindsightError, type HindsightClient, type HindsightMentalModel, type HindsightOperation } from './hindsight-client'
import { createLocalStore, type LocalStore } from './local-store'
import { KNOWLEDGE_PAGE_MODELS, ProjectMemoryService } from './project-memory-service'

const directories: string[] = []
const stores: LocalStore[] = []
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close())
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
const now = new Date().toISOString()
const input: ProjectMemoryDocumentInput = { documentId: 'coding-run:c1', sourceKind: 'coding_run', sourceId: 'c1', title: '删除确认',
  payload: 'Outcome: completed\nHOST_VERIFIED test run by DevFlow: `pnpm test` passed', context: 'Record of one DevFlow coding run.',
  tags: ['source:coding', 'engine:native'], occurredAt: now, notBefore: now }

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-project-memory-service-')); directories.push(directory)
  const store = await createLocalStore({ dbPath: path.join(directory, 'db.sqlite') }); stores.push(store)
  await store.upsertProject({ id: 'project', name: 'Synthetic', path: directory, packageManager: 'pnpm', testCommand: 'pnpm test', createdAt: now, updatedAt: now })
  const config = await store.configureProjectMemory({ projectId: 'project', ownerUserId: 'user-1', enabled: true,
    endpoint: 'http://127.0.0.1:8890', encryptedApiKey: null, providerId: 'deepseek' })
  const document = (await store.recordProjectMemoryDocument(config, input))!
  let operation: HindsightOperation = 'pending'
  const client = {
    configureMemoryBank: vi.fn(async () => undefined),
    retainDocument: vi.fn(async () => undefined),
    operation: vi.fn(async () => operation),
    deleteDocument: vi.fn(async () => undefined),
    deleteBank: vi.fn(async () => undefined),
    ensureMentalModel: vi.fn(async (_bank: string, _page: { id: string }) => undefined),
    clearMentalModel: vi.fn(async (_bank: string, _id: string) => undefined),
    listMentalModels: vi.fn(async (_bank: string): Promise<HindsightMentalModel[]> => []),
    refreshMentalModel: vi.fn(async (_bank: string, _id: string) => 'operation'),
  }
  let clock = Date.now()
  const service = new ProjectMemoryService({ store, client: async () => client as unknown as HindsightClient,
    now: () => new Date(clock).toISOString() })
  return { store, config, document, client, service,
    setOperation(value: HindsightOperation) { operation = value },
    advance(ms: number) { clock += ms } }
}

it('configures the bank once and sends the document with its source metadata, then marks it retained', async () => {
  const { store, config, document, client, service, setOperation, advance } = await fixture()
  expect(await service.process()).toBe(1)
  expect(client.configureMemoryBank).toHaveBeenCalledWith(config.bankId, PROJECT_MEMORY_MISSIONS)
  expect(client.retainDocument).toHaveBeenCalledWith(config.bankId, {
    documentId: 'coding-run:c1', operationId: document.operationId, content: input.payload, context: input.context,
    timestamp: now, tags: ['source:coding', 'engine:native'],
    metadata: { df_document: document.id, df_source_kind: 'coding_run', df_source_id: 'c1', df_digest: document.contentDigest, df_policy: PROJECT_MEMORY_POLICY_VERSION },
  })
  advance(6_000)
  await service.process()
  expect((await store.listProjectMemoryDocuments())[0]?.status).toBe('submitted')
  setOperation('completed'); advance(6_000)
  await service.process()
  expect((await store.listProjectMemoryDocuments())[0]?.status).toBe('retained')
  await store.recordProjectMemoryDocument(config, { ...input, documentId: 'coding-run:c2', sourceId: 'c2' })
  advance(1_000)
  await service.process()
  expect(client.configureMemoryBank).toHaveBeenCalledTimes(1)
  expect(client.retainDocument).toHaveBeenCalledTimes(2)
  // The knowledge pages are set up once per bank and app run.
  expect(client.ensureMentalModel.mock.calls.map(([bank, page]) => [bank, page.id])).toEqual(
    ['devflow-conventions', 'devflow-decisions', 'devflow-pitfalls', 'devflow-preferences'].map((id) => [config.bankId, id]))
  expect(KNOWLEDGE_PAGE_MODELS[0]!.trigger).toEqual({ mode: 'delta', refresh_after_consolidation: true,
    min_refresh_interval_seconds: 21_600, exclude_mental_models: true, budget: 'low' })
})

it('counts a rejected send, polls an uncertain one, and resends what Hindsight never received', async () => {
  const { store, client, service, setOperation, advance } = await fixture()
  client.retainDocument.mockRejectedValueOnce(new HindsightError('http', 422))
  await service.process()
  expect((await store.listProjectMemoryDocuments())[0]).toMatchObject({ status: 'queued', attempts: 1, lastError: 'hindsight_http_422' })
  advance(61_000)
  client.retainDocument.mockRejectedValueOnce(new HindsightError('timeout'))
  await service.process()
  expect((await store.listProjectMemoryDocuments())[0]).toMatchObject({ status: 'submitted', attempts: 2, lastError: 'Hindsight timeout' })
  setOperation('not_found'); advance(31_000)
  await service.process()
  const resend = (await store.listProjectMemoryDocuments())[0]!
  expect(resend).toMatchObject({ status: 'queued', attempts: 1 })
  advance(6_000)
  await service.process()
  expect(client.retainDocument).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ operationId: resend.operationId }))
})

it('holds new sends while the relay is down and removes a forgotten document only after its retain ends', async () => {
  const { store, document, client, service, setOperation, advance } = await fixture()
  let relay = false
  const gated = new ProjectMemoryService({ store, client: async () => client as unknown as HindsightClient, canSubmit: () => relay })
  expect(await gated.process()).toBe(0)
  // Creating pages in a bank that has memories writes them at once, so that waits for the relay too.
  expect(client.ensureMentalModel).not.toHaveBeenCalled()
  relay = true
  expect(await gated.process()).toBe(1)
  await store.forgetProjectMemoryDocument('project', document.id)
  setOperation('processing'); advance(1_000)
  await service.process()
  expect(client.deleteDocument).toHaveBeenCalledTimes(1)
  expect((await store.listProjectMemoryDocuments())[0]?.status).toBe('delete_pending')
  expect(client.clearMentalModel).not.toHaveBeenCalled()
  setOperation('completed'); advance(61_000)
  await service.process()
  expect((await store.listProjectMemoryDocuments())[0]).toMatchObject({ status: 'deleted', payload: '' })
  // Pages rewritten while the document still existed are emptied once it is gone.
  expect(client.clearMentalModel.mock.calls.map(([, id]) => id)).toEqual(KNOWLEDGE_PAGE_MODELS.map((page) => page.id))
  await gated.shutdown()
  expect(await gated.process()).toBe(0)
})

it('deletes the banks of cleared generations and retries when Hindsight is unavailable', async () => {
  const { store, config, client, service, advance } = await fixture()
  await store.clearProjectMemory('project')
  client.deleteBank.mockRejectedValueOnce(new HindsightError('transport'))
  advance(1_000)
  await service.process()
  expect(client.deleteBank).toHaveBeenCalledWith(config.bankId)
  expect((await store.getProjectMemoryConfiguration('project'))?.pendingBankDeletions).toEqual([config.bankId])
  advance(1_000)
  await service.process()
  expect(client.deleteBank).toHaveBeenCalledTimes(2)
  expect((await store.getProjectMemoryConfiguration('project'))?.pendingBankDeletions).toBeUndefined()
  // The cleared document is never sent to the new bank.
  expect(client.retainDocument).not.toHaveBeenCalled()
})

it('writes empty pages of a bank that has memories, but not while a source is being forgotten, and not twice in ten minutes', async () => {
  const { store, config, document, client, service, setOperation, advance } = await fixture()
  const old = new Date(Date.now() - 3_600_000).toISOString()
  let pages: HindsightMentalModel[] = KNOWLEDGE_PAGE_MODELS.map((page) => ({ id: page.id, content: '', stale: false, refreshedAt: old }))
  client.listMentalModels.mockImplementation(async () => pages)
  await service.process()
  // Nothing is retained yet: an empty bank has nothing to write about.
  expect(client.refreshMentalModel).not.toHaveBeenCalled()
  setOperation('completed'); advance(6_000)
  await service.process()
  expect((await store.listProjectMemoryDocuments())[0]?.status).toBe('retained')
  advance(1_000)
  await service.process()
  expect(client.refreshMentalModel.mock.calls.map(([bank, id]) => [bank, id])).toEqual(KNOWLEDGE_PAGE_MODELS.map((page) => [config.bankId, page.id]))
  // Asked already: the next cycles wait, even though the pages are still empty.
  advance(60_000)
  await service.process()
  expect(client.refreshMentalModel).toHaveBeenCalledTimes(4)
  // A written page is left alone; a failed one waits an hour.
  pages = pages.map((page, index) => index === 0 ? { ...page, content: '## 命令' } : index === 1 ? { ...page, failedAt: new Date(Date.now() + 61_000).toISOString() } : page)
  advance(10 * 60_000)
  await service.process()
  expect(client.refreshMentalModel.mock.calls.slice(4).map(([, id]) => id)).toEqual(KNOWLEDGE_PAGE_MODELS.slice(2).map((page) => page.id))
  // While a forgotten source is still being deleted, a rewrite could keep it; wait.
  await store.forgetProjectMemoryDocument('project', document.id)
  setOperation('processing'); advance(11 * 60_000)
  await service.process()
  expect(client.refreshMentalModel).toHaveBeenCalledTimes(6)
})

it('leaves an empty page written after the last change, and writes it again once memory was edited', async () => {
  const { store, client, service, setOperation, advance } = await fixture()
  setOperation('completed')
  await service.process(); advance(6_000); await service.process()
  expect((await store.listProjectMemoryDocuments())[0]?.status).toBe('retained')
  // Hindsight already wrote these pages after everything was learned and found nothing to say.
  const later = new Date(Date.now() + 3_600_000).toISOString()
  client.listMentalModels.mockImplementation(async () => KNOWLEDGE_PAGE_MODELS.map((page) => ({ id: page.id, content: '', stale: false, refreshedAt: later })))
  advance(1_000); await service.process()
  expect(client.refreshMentalModel).not.toHaveBeenCalled()
  // Editing a memory empties the pages; they are written again.
  await store.markProjectMemoryChanged('project', 'o1')
  const edited = (await store.getProjectMemoryConfiguration('project'))!.changedMemories!.o1!
  client.listMentalModels.mockImplementation(async () => KNOWLEDGE_PAGE_MODELS.map((page) => ({ id: page.id, content: '', stale: false,
    refreshedAt: new Date(Date.parse(edited) - 1_000).toISOString() })))
  advance(1_000); await service.process()
  expect(client.refreshMentalModel).toHaveBeenCalledTimes(KNOWLEDGE_PAGE_MODELS.length)
})
