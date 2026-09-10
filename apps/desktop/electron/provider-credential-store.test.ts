import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodingAgentRun } from '@ai-devflow/shared'
import type { LocalStore } from './local-store'
import { createLocalStore } from './local-store'
import * as persistence from './local-store-persistence'

const directories: string[] = []
const stores: LocalStore[] = []
const metadata = { providerId: 'test-provider', name: 'QA Provider', model: 'fixture', maskedCredential: 'fi...ure', updatedAt: '2026-09-10T12:00:00.000Z' }
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-provider-removal-'))
  directories.push(directory)
  const dbPath = path.join(directory, 'local.sqlite')
  const store = await createLocalStore({ dbPath })
  stores.push(store)
  await store.saveProviderCredential(metadata, 'encrypted-fixture-must-be-removed')
  return { store, dbPath }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const store of stores.splice(0)) store.close()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe('durable Provider removal', () => {
  it('blocks active Coding but preserves completed history after removing an unused credential', async () => {
    const { store } = await fixture()
    const run: CodingAgentRun = {
      id: 'coding-qa', runId: 'run-qa', nodeId: 'build', projectId: 'p-test', requestedBy: 'local-user',
      providerId: metadata.providerId, engine: 'fake', status: 'waiting_permission', branchName: 'devflow/qa',
      userInstruction: 'fixture', prompt: 'fixture', summary: 'fixture', changedPaths: [], startedAt: metadata.updatedAt, redacted: true,
    }
    await store.saveCodingAgentRun(run)
    expect(await store.removeProviderCredential(metadata.providerId, metadata.updatedAt)).toMatchObject({ status: 'blocked', check: { references: [{ kind: 'coding_run', id: run.id }] } })
    await store.saveCodingAgentRun({ ...run, status: 'completed', completedAt: '2026-09-10T12:01:00.000Z' })
    expect((await store.inspectProviderRemoval(metadata.providerId)).historicalRecordCount).toBe(1)
    expect((await store.removeProviderCredential(metadata.providerId, metadata.updatedAt)).status).toBe('deleted')
    expect(await store.listCodingAgentRuns()).toHaveLength(1)
    expect(await store.getSettings()).toMatchObject({ selectedAgentProviderId: '' })
  })

  it('removes metadata and encrypted secret, persisting an empty selection across reopen', async () => {
    const { store, dbPath } = await fixture()
    await store.saveProviderCredential({ ...metadata, providerId: 'other' }, 'other-encrypted-fixture')
    await store.saveSettings({ selectedAgentProviderId: metadata.providerId })
    expect(await store.removeProviderCredential(metadata.providerId, metadata.updatedAt)).toEqual({ status: 'deleted', providerId: metadata.providerId })
    expect(await store.getProviderEncryptedSecret(metadata.providerId)).toBeNull()
    expect((await readFile(dbPath)).includes(Buffer.from('encrypted-fixture-must-be-removed'))).toBe(false)
    const reopened = await createLocalStore({ dbPath })
    stores.push(reopened)
    expect((await reopened.listProviderCredentials()).map((item) => item.providerId)).toEqual(['other'])
    expect(await reopened.getSettings()).toMatchObject({ selectedAgentProviderId: '' })
  })

  it('rechecks a configuration added after the preview, including the serialized write race', async () => {
    const { store } = await fixture()
    await store.upsertProject({ id: 'p-test', name: 'QA', path: '/fixture', packageManager: 'pnpm', detectedTestCommand: '', testCommand: '', createdAt: metadata.updatedAt, updatedAt: metadata.updatedAt })
    expect((await store.inspectProviderRemoval(metadata.providerId)).references).toEqual([])
    const [_, removal] = await Promise.all([
      store.saveCodingRuntimeConfiguration({ projectId: 'p-test', executor: 'native-model', providerId: metadata.providerId, version: 1, updatedAt: metadata.updatedAt }),
      store.removeProviderCredential(metadata.providerId, metadata.updatedAt),
    ])
    expect(removal).toMatchObject({ status: 'blocked', check: { references: [{ kind: 'coding_configuration', projectId: 'p-test', label: '项目配置：QA' }] } })
    expect(await store.getProviderEncryptedSecret(metadata.providerId)).not.toBeNull()
  })

  it('requires a new confirmation after a credential update', async () => {
    const { store } = await fixture()
    await store.saveProviderCredential({ ...metadata, model: 'updated', updatedAt: '2026-09-10T12:01:00.000Z' }, 'rotated-fixture')
    expect(await store.removeProviderCredential(metadata.providerId, metadata.updatedAt)).toMatchObject({ status: 'changed' })
    expect(await store.getProviderEncryptedSecret(metadata.providerId)).toBe('rotated-fixture')
  })

  it('rolls back the credential and selection together if persistence fails', async () => {
    const { store, dbPath } = await fixture()
    await store.saveSettings({ selectedAgentProviderId: metadata.providerId })
    const before = await readFile(dbPath)
    vi.spyOn(persistence, 'persistDatabaseSnapshot').mockRejectedValueOnce(new Error('fixture disk failure'))
    await expect(store.removeProviderCredential(metadata.providerId, metadata.updatedAt)).rejects.toThrow('fixture disk failure')
    expect(await store.getProviderEncryptedSecret(metadata.providerId)).not.toBeNull()
    expect(await store.getSettings()).toMatchObject({ selectedAgentProviderId: metadata.providerId })
    // Compare the complete snapshot as bytes without Vitest recursively visiting every Buffer entry.
    expect((await readFile(dbPath)).equals(before)).toBe(true)
  })
})
