// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { PROJECT_MEMORY_MISSIONS, PROJECT_MEMORY_POLICY_VERSION, type ProjectMemoryDocumentInput } from '@ai-devflow/shared'
import { HindsightError, type HindsightClient, type HindsightOperation } from './hindsight-client'
import { createLocalStore, type LocalStore } from './local-store'
import { ProjectMemoryService } from './project-memory-service'

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
  relay = true
  expect(await gated.process()).toBe(1)
  await store.forgetProjectMemoryDocument('project', document.id)
  setOperation('processing'); advance(1_000)
  await service.process()
  expect(client.deleteDocument).toHaveBeenCalledTimes(1)
  expect((await store.listProjectMemoryDocuments())[0]?.status).toBe('delete_pending')
  setOperation('completed'); advance(61_000)
  await service.process()
  expect((await store.listProjectMemoryDocuments())[0]).toMatchObject({ status: 'deleted', payload: '' })
  await gated.shutdown()
  expect(await gated.process()).toBe(0)
})
