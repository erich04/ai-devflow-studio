import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalStore } from './local-store.js'
import { createLocalMcpInstallationRegistry } from './local-mcp-installation-registry.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })))
  tempDirs.length = 0
})

async function fixture(clockValues = [
  '2026-08-12T21:00:00.000Z',
  '2026-08-12T21:01:00.000Z',
  '2026-08-12T21:02:00.000Z',
]) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-local-mcp-registry-'))
  tempDirs.push(directory)
  const executablePath = path.join(directory, 'fixture-mcp')
  await writeFile(executablePath, '#!/bin/sh\nexit 0\n', 'utf8')
  await chmod(executablePath, 0o700)
  const store = await createLocalStore({ dbPath: path.join(directory, 'devflow.sqlite') })
  const times = [...clockValues]
  const registry = createLocalMcpInstallationRegistry({
    store,
    createId: () => 'local-mcp-installation-fixture',
    clock: () => times.shift()!,
  })
  const configuration = {
    name: 'Deterministic fixture MCP',
    executablePath,
    args: ['--stdio'],
    allowedEnvironmentNames: [],
    workingDirectoryPolicy: { kind: 'local_project' as const },
    expectedServer: { name: 'devflow.fixture-mcp', version: '1.0.0' },
    expectedTools: [
      {
        name: 'fixture.echo',
        permissionClass: 'read' as const,
        sideEffectClass: 'none' as const,
        idempotency: 'idempotent' as const,
        maxResultBytes: 1_024,
      },
    ],
    startupDeadlineMs: 10_000,
    callDeadlineMs: 30_000,
  }
  return { executablePath, store, registry, configuration }
}

describe('main-owned Local MCP installation registry', () => {
  it('refuses to enable an installation after its exact executable changes', async () => {
    const { executablePath, store, registry, configuration } = await fixture()
    const installed = await registry.install(configuration)
    expect(installed.enabled).toBe(false)

    await writeFile(executablePath, '#!/bin/sh\nexit 1\n', 'utf8')

    await expect(
      registry.setEnabled({ expectedInstallation: installed, enabled: true }),
    ).rejects.toThrow('local_mcp_executable_mismatch')
    expect(await store.getLocalMcpInstallation(installed.id)).toEqual(installed)
    store.close()
  })

  it('authorizes calls only while the exact persisted installation revision remains enabled', async () => {
    const { store, registry, configuration } = await fixture()
    const installed = await registry.install(configuration)
    const enabled = await registry.setEnabled({ expectedInstallation: installed, enabled: true })

    await expect(registry.authorizeCall(enabled)).resolves.toBeUndefined()

    const disabled = await registry.setEnabled({ expectedInstallation: enabled, enabled: false })
    await expect(registry.authorizeCall(enabled)).rejects.toThrow('local_mcp_installation_stale')
    await expect(registry.authorizeCall(disabled)).rejects.toThrow('local_mcp_installation_stale')
    store.close()
  })

  it('keeps an immediate install-and-enable revision monotonic within one clock millisecond', async () => {
    const timestamp = '2026-08-12T21:00:00.000Z'
    const { store, registry, configuration } = await fixture([timestamp, timestamp])
    const installed = await registry.install(configuration)

    const enabled = await registry.setEnabled({ expectedInstallation: installed, enabled: true })

    expect(enabled).toMatchObject({
      version: 2,
      enabled: true,
      createdAt: timestamp,
      updatedAt: '2026-08-12T21:00:00.001Z',
    })
    store.close()
  })
})
