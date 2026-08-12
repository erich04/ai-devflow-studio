import { createHash } from 'node:crypto'
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { McpServerDefinition } from '@ai-devflow/shared'
import {
  parseLocalMcpInstallation,
  verifyLocalMcpExecutable,
} from './local-mcp-installation.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })))
  tempDirs.length = 0
})

const installation = {
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

describe('Local MCP installation authority', () => {
  it('accepts an exact main-owned installation but rejects Team MCP display metadata', () => {
    expect(parseLocalMcpInstallation(installation)).toEqual(installation)

    const teamDefinition: McpServerDefinition = {
      id: installation.id,
      name: installation.name,
      command: installation.executablePath,
      permission: 'shell',
      enabledLocally: true,
      lastAuditEvent: 'enabled by renderer',
    }

    expect(() => parseLocalMcpInstallation(teamDefinition)).toThrow(
      'invalid_local_mcp_installation',
    )
  })

  it('rechecks the exact executable digest immediately before process authority is used', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-mcp-executable-'))
    tempDirs.push(directory)
    const executablePath = path.join(directory, 'fixture-mcp')
    const contents = '#!/bin/sh\nexit 0\n'
    await writeFile(executablePath, contents, 'utf8')
    await chmod(executablePath, 0o700)
    const canonicalExecutablePath = await realpath(executablePath)
    const verified = {
      ...installation,
      executablePath: canonicalExecutablePath,
      executableSha256: createHash('sha256').update(contents).digest('hex'),
    }

    await expect(verifyLocalMcpExecutable(verified)).resolves.toEqual({
      executablePath: canonicalExecutablePath,
      executableSha256: verified.executableSha256,
    })
    await writeFile(executablePath, '#!/bin/sh\nexit 1\n', 'utf8')
    await expect(verifyLocalMcpExecutable(verified)).rejects.toThrow(
      'local_mcp_executable_mismatch',
    )
  })
})
