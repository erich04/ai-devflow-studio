import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalStore, type LocalStore } from './local-store'
import type { LocalMcpInstallation } from './local-mcp-installation'
import * as persistence from './local-store-persistence'

const directories: string[] = []
const stores: LocalStore[] = []
const operations = ['install', 'revise', 'delete'] as const

afterEach(async () => {
  vi.restoreAllMocks()
  for (const store of stores.splice(0)) store.close()
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ))
})

async function openStore(dbPath: string): Promise<LocalStore> {
  const store = await createLocalStore({ dbPath })
  stores.push(store)
  return store
}

async function fixture(operation: typeof operations[number]) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-mcp-store-'))
  directories.push(directory)
  const dbPath = path.join(directory, 'devflow.sqlite')
  const store = await openStore(dbPath)
  const installation: LocalMcpInstallation = {
    stateVersion: 1,
    id: 'local-mcp-fixture',
    version: 1,
    name: 'Fixture MCP',
    transport: 'stdio',
    executablePath: path.join(directory, 'fixture-mcp'),
    executableSha256: 'a'.repeat(64),
    args: ['--stdio'],
    allowedEnvironmentNames: [],
    workingDirectoryPolicy: { kind: 'local_project' },
    expectedServer: { name: 'devflow.fixture-mcp', version: '1.0.0' },
    expectedTools: [{
      name: 'fixture.echo',
      permissionClass: 'read',
      sideEffectClass: 'none',
      idempotency: 'idempotent',
      maxResultBytes: 1_024,
    }],
    startupDeadlineMs: 10_000,
    callDeadlineMs: 30_000,
    enabled: false,
    createdAt: '2026-08-12T21:00:00.000Z',
    updatedAt: '2026-08-12T21:00:00.000Z',
  }
  const before = operation === 'install' ? null : installation
  if (before) {
    expect(await store.commitLocalMcpInstallation({
      expectedInstallation: null,
      installation: before,
    })).toMatchObject({ committed: true })
  }
  const after = operation === 'delete' ? null : operation === 'install' ? installation : {
    ...installation,
    version: 2,
    enabled: true,
    updatedAt: '2026-08-12T21:01:00.000Z',
  }
  const mutate = (): Promise<unknown> => after === null
    ? store.deleteLocalMcpInstallation(installation)
    : store.commitLocalMcpInstallation({ expectedInstallation: before, installation: after })

  return { dbPath, store, installation, before, after, mutate }
}

function signal() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('Local MCP durable store mutations', () => {
  it.each(operations)('rolls back a failed %s and permits an exact retry across reopen', async (operation) => {
    const { dbPath, store, installation, before, after, mutate } = await fixture(operation)
    const backupPath = `${dbPath}.backup`
    await rename(dbPath, backupPath)
    await mkdir(dbPath)

    try {
      await expect(mutate()).rejects.toThrow(/EISDIR|EPERM|directory|operation not permitted/i)
      expect(await store.getLocalMcpInstallation(installation.id)).toEqual(before)
    } finally {
      await rm(dbPath, { recursive: true, force: true })
      await rename(backupPath, dbPath)
    }

    // An unrelated successful write must not persist the failed MCP change.
    await store.saveSettings({ themePreference: 'light' })
    const afterFailure = await openStore(dbPath)
    expect(await afterFailure.getLocalMcpInstallation(installation.id)).toEqual(before)

    expect(await mutate()).toMatchObject(after === null ? { deleted: true } : { committed: true })
    expect(await store.getLocalMcpInstallation(installation.id)).toEqual(after)
    const reopened = await openStore(dbPath)
    expect(await reopened.getLocalMcpInstallation(installation.id)).toEqual(after)
  })

  it.each(operations)('serializes %s after an overlapping failed settings write', async (operation) => {
    const { dbPath, store, installation, after, mutate } = await fixture(operation)
    await store.saveSettings({ themePreference: 'light' })
    const settings = await store.getSettings()
    const entered = signal()
    const released = signal()
    const failure = new Error('controlled persistence failure')
    vi.spyOn(persistence, 'persistDatabaseSnapshot').mockImplementationOnce(async () => {
      entered.resolve()
      await released.promise
      throw failure
    })

    const failedWrite = expect(store.saveSettings({ themePreference: 'dark' })).rejects.toBe(failure)
    await entered.promise
    const mcpWrite = mutate()
    released.resolve()

    const [, result] = await Promise.all([failedWrite, mcpWrite])
    expect(result).toMatchObject(after === null ? { deleted: true } : { committed: true })
    expect(await store.getSettings()).toEqual(settings)
    expect(await store.getLocalMcpInstallation(installation.id)).toEqual(after)

    const reopened = await openStore(dbPath)
    expect(await reopened.getSettings()).toEqual(settings)
    expect(await reopened.getLocalMcpInstallation(installation.id)).toEqual(after)
  })
})
