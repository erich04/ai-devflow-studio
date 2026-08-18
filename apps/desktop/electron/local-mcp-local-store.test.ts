import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { McpServerDefinition } from '@ai-devflow/shared'
import { createLocalStore } from './local-store.js'
import type { LocalMcpInstallation } from './local-mcp-installation.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })))
  tempDirs.length = 0
})

async function storeFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-local-mcp-store-'))
  tempDirs.push(directory)
  const dbPath = path.join(directory, 'devflow.sqlite')
  return { dbPath, store: await createLocalStore({ dbPath }) }
}

const installation: LocalMcpInstallation = {
  stateVersion: 1,
  id: 'local-mcp-installation-fixture',
  version: 1,
  name: 'Deterministic fixture MCP',
  transport: 'stdio',
  executablePath: path.resolve('/tmp/devflow-fixture-mcp'),
  executableSha256: 'a'.repeat(64),
  args: ['--stdio'],
  allowedEnvironmentNames: [],
  workingDirectoryPolicy: { kind: 'local_project' },
  expectedServer: { name: 'devflow-fixture-mcp', version: '1.0.0' },
  expectedTools: [
    {
      name: 'fixture.echo',
      permissionClass: 'read',
      sideEffectClass: 'none',
      idempotency: 'idempotent',
      maxResultBytes: 1_024,
    },
  ],
  startupDeadlineMs: 10_000,
  callDeadlineMs: 30_000,
  enabled: true,
  createdAt: '2026-08-12T21:00:00.000Z',
  updatedAt: '2026-08-12T21:00:00.000Z',
}

describe('Local MCP installation persistence', () => {
  it('persists only the main-owned installation record, independently of same-id Team metadata', async () => {
    const { dbPath, store } = await storeFixture()
    const teamDefinition: McpServerDefinition = {
      id: installation.id,
      name: 'Renderer-controlled lookalike',
      command: '/tmp/renderer-controlled-command',
      permission: 'shell',
      enabledLocally: true,
      lastAuditEvent: 'renderer enabled',
    }
    await store.saveMcpServers([teamDefinition])

    await expect(
      store.commitLocalMcpInstallation({ expectedInstallation: null, installation }),
    ).resolves.toEqual({ committed: true, installation })
    expect(await store.getLocalMcpInstallation(installation.id)).toEqual(installation)
    expect(await store.listLocalMcpInstallations()).toEqual([installation])
    store.close()

    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.getSchemaVersion()).toBe(31)
    expect(await reopened.listMcpServers()).toEqual([teamDefinition])
    expect(await reopened.listLocalMcpInstallations()).toEqual([installation])
    reopened.close()
  })

  it('revises, enables, and deletes an installation only through an exact version CAS', async () => {
    const { store } = await storeFixture()
    await store.commitLocalMcpInstallation({ expectedInstallation: null, installation })
    const disabled = {
      ...installation,
      version: 2,
      enabled: false,
      updatedAt: '2026-08-12T21:01:00.000Z',
    }

    await expect(
      store.commitLocalMcpInstallation({
        expectedInstallation: installation,
        installation: disabled,
      }),
    ).resolves.toEqual({ committed: true, installation: disabled })
    await expect(
      store.commitLocalMcpInstallation({
        expectedInstallation: installation,
        installation: {
          ...installation,
          version: 2,
          updatedAt: '2026-08-12T21:02:00.000Z',
        },
      }),
    ).resolves.toEqual({ committed: false, reason: 'version_conflict' })
    await expect(store.deleteLocalMcpInstallation(installation)).resolves.toEqual({
      deleted: false,
      reason: 'version_conflict',
    })
    await expect(store.deleteLocalMcpInstallation(disabled)).resolves.toEqual({ deleted: true })
    expect(await store.getLocalMcpInstallation(installation.id)).toBeNull()
    store.close()
  })
})
