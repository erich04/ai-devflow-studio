import { randomUUID } from 'node:crypto'
import type { LocalStore } from './local-store.js'
import {
  inspectLocalMcpExecutable,
  parseLocalMcpInstallation,
  type LocalMcpExpectedTool,
  type LocalMcpInstallation,
  verifyLocalMcpExecutable,
} from './local-mcp-installation.js'

export type LocalMcpInstallationConfiguration = {
  name: string
  executablePath: string
  args: string[]
  allowedEnvironmentNames: string[]
  workingDirectoryPolicy: { kind: 'local_project' }
  expectedServer: { name: string; version: string }
  expectedTools: LocalMcpExpectedTool[]
  startupDeadlineMs: number
  callDeadlineMs: number
}

export type LocalMcpInstallationRegistry = {
  install(configuration: LocalMcpInstallationConfiguration): Promise<LocalMcpInstallation>
  revise(input: {
    expectedInstallation: LocalMcpInstallation
    configuration: LocalMcpInstallationConfiguration
  }): Promise<LocalMcpInstallation>
  setEnabled(input: {
    expectedInstallation: LocalMcpInstallation
    enabled: boolean
  }): Promise<LocalMcpInstallation>
  authorizeCall(expectedInstallation: LocalMcpInstallation): Promise<void>
  delete(expectedInstallation: LocalMcpInstallation): Promise<void>
}

function canonicalNow(clock: () => string): string {
  const value = clock()
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error('local_mcp_clock_invalid')
  }
  return value
}

function canonicalNext(clock: () => string, previous: string): string {
  const value = canonicalNow(clock)
  if (value > previous) return value
  return new Date(Date.parse(previous) + 1).toISOString()
}

export function createLocalMcpInstallationRegistry(input: {
  store: LocalStore
  clock?: () => string
  createId?: () => string
}): LocalMcpInstallationRegistry {
  const clock = input.clock ?? (() => new Date().toISOString())
  const createId = input.createId ?? (() => `local-mcp-installation-${randomUUID()}`)

  async function createRecord(inputRecord: {
    id: string
    version: number
    createdAt: string
    updatedAt: string
    enabled: boolean
    configuration: LocalMcpInstallationConfiguration
  }): Promise<LocalMcpInstallation> {
    const executable = await inspectLocalMcpExecutable(inputRecord.configuration.executablePath)
    return parseLocalMcpInstallation({
      stateVersion: 1,
      id: inputRecord.id,
      version: inputRecord.version,
      name: inputRecord.configuration.name,
      transport: 'stdio',
      executablePath: executable.executablePath,
      executableSha256: executable.executableSha256,
      args: inputRecord.configuration.args,
      allowedEnvironmentNames: inputRecord.configuration.allowedEnvironmentNames,
      workingDirectoryPolicy: inputRecord.configuration.workingDirectoryPolicy,
      expectedServer: inputRecord.configuration.expectedServer,
      expectedTools: inputRecord.configuration.expectedTools,
      startupDeadlineMs: inputRecord.configuration.startupDeadlineMs,
      callDeadlineMs: inputRecord.configuration.callDeadlineMs,
      enabled: inputRecord.enabled,
      createdAt: inputRecord.createdAt,
      updatedAt: inputRecord.updatedAt,
    })
  }

  return {
    async install(configuration) {
      const now = canonicalNow(clock)
      const installation = await createRecord({
        id: createId(),
        version: 1,
        createdAt: now,
        updatedAt: now,
        enabled: false,
        configuration,
      })
      const committed = await input.store.commitLocalMcpInstallation({
        expectedInstallation: null,
        installation,
      })
      if (!committed.committed) throw new Error('local_mcp_installation_conflict')
      return committed.installation
    },

    async revise({ expectedInstallation, configuration }) {
      const expected = parseLocalMcpInstallation(expectedInstallation)
      const installation = await createRecord({
        id: expected.id,
        version: expected.version + 1,
        createdAt: expected.createdAt,
        updatedAt: canonicalNext(clock, expected.updatedAt),
        enabled: false,
        configuration,
      })
      const committed = await input.store.commitLocalMcpInstallation({
        expectedInstallation: expected,
        installation,
      })
      if (!committed.committed) throw new Error('local_mcp_installation_conflict')
      return committed.installation
    },

    async setEnabled({ expectedInstallation, enabled }) {
      const expected = parseLocalMcpInstallation(expectedInstallation)
      if (enabled) await verifyLocalMcpExecutable(expected)
      const installation = parseLocalMcpInstallation({
        ...expected,
        version: expected.version + 1,
        enabled,
        updatedAt: canonicalNext(clock, expected.updatedAt),
      })
      const committed = await input.store.commitLocalMcpInstallation({
        expectedInstallation: expected,
        installation,
      })
      if (!committed.committed) throw new Error('local_mcp_installation_conflict')
      return committed.installation
    },

    async authorizeCall(expectedInstallation) {
      try {
        const expected = parseLocalMcpInstallation(expectedInstallation)
        if (!expected.enabled) throw new Error('disabled')
        const current = await input.store.getLocalMcpInstallation(expected.id)
        if (!current || JSON.stringify(current) !== JSON.stringify(expected)) {
          throw new Error('stale')
        }
        await verifyLocalMcpExecutable(current)
        const rechecked = await input.store.getLocalMcpInstallation(expected.id)
        if (!rechecked || JSON.stringify(rechecked) !== JSON.stringify(expected)) {
          throw new Error('stale')
        }
      } catch {
        throw new Error('local_mcp_installation_stale')
      }
    },

    async delete(expectedInstallation) {
      const deleted = await input.store.deleteLocalMcpInstallation(
        parseLocalMcpInstallation(expectedInstallation),
      )
      if (!deleted.deleted) throw new Error('local_mcp_installation_conflict')
    },
  }
}
