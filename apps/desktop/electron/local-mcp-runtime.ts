import { realpath, stat } from 'node:fs/promises'
import type { LocalStore } from './local-store.js'
import { createLocalMcpClient, createLocalMcpToolRegistry } from './local-mcp-client.js'
import {
  inspectLocalMcpExecutable,
  type LocalMcpInstallation,
} from './local-mcp-installation.js'
import { createLocalMcpInstallationRegistry } from './local-mcp-installation-registry.js'
import type { NativeToolRegistry } from './native-tool-registry.js'

const FIXTURE_INSTALLATION_ID = 'local-mcp-installation-runtime-fixture'

export type FixtureLocalMcpRuntime = {
  installation: LocalMcpInstallation
  nativeToolRegistry: NativeToolRegistry
  shutdown(): Promise<void>
}

function configurationProjection(installation: LocalMcpInstallation) {
  return {
    name: installation.name,
    executablePath: installation.executablePath,
    executableSha256: installation.executableSha256,
    args: installation.args,
    allowedEnvironmentNames: installation.allowedEnvironmentNames,
    workingDirectoryPolicy: installation.workingDirectoryPolicy,
    expectedServer: installation.expectedServer,
    expectedTools: installation.expectedTools,
    startupDeadlineMs: installation.startupDeadlineMs,
    callDeadlineMs: installation.callDeadlineMs,
  }
}

export async function createFixtureLocalMcpRuntime(input: {
  store: LocalStore
  localProjectPath: string
  executablePath: string
  serverPath: string
  environment: Readonly<Record<string, string | undefined>>
}): Promise<FixtureLocalMcpRuntime> {
  const [serverPath, serverMetadata, executable] = await Promise.all([
    realpath(input.serverPath),
    stat(input.serverPath),
    inspectLocalMcpExecutable(input.executablePath),
  ])
  if (!serverMetadata.isFile()) throw new Error('local_mcp_fixture_server_invalid')
  const configuration = {
    name: 'DevFlow deterministic fixture MCP',
    executablePath: executable.executablePath,
    args: [serverPath],
    allowedEnvironmentNames: Object.keys(input.environment).sort(),
    workingDirectoryPolicy: { kind: 'local_project' as const },
    expectedServer: { name: 'devflow.fixture-mcp', version: '1.0.0' },
    expectedTools: [
      {
        name: 'scenario.evaluate',
        permissionClass: 'execute' as const,
        sideEffectClass: 'none' as const,
        idempotency: 'idempotent' as const,
        maxResultBytes: 16 * 1_024,
      },
    ],
    startupDeadlineMs: 10_000,
    callDeadlineMs: 30_000,
  }
  const registry = createLocalMcpInstallationRegistry({
    store: input.store,
    createId: () => FIXTURE_INSTALLATION_ID,
  })
  let installation = await input.store.getLocalMcpInstallation(FIXTURE_INSTALLATION_ID)
  const desiredProjection = {
    name: configuration.name,
    executablePath: configuration.executablePath,
    executableSha256: executable.executableSha256,
    args: configuration.args,
    allowedEnvironmentNames: configuration.allowedEnvironmentNames,
    workingDirectoryPolicy: configuration.workingDirectoryPolicy,
    expectedServer: configuration.expectedServer,
    expectedTools: configuration.expectedTools,
    startupDeadlineMs: configuration.startupDeadlineMs,
    callDeadlineMs: configuration.callDeadlineMs,
  }
  if (!installation) {
    installation = await registry.install(configuration)
  } else if (
    JSON.stringify(configurationProjection(installation)) !== JSON.stringify(desiredProjection)
  ) {
    installation = await registry.revise({
      expectedInstallation: installation,
      configuration,
    })
  }
  if (!installation.enabled) {
    installation = await registry.setEnabled({ expectedInstallation: installation, enabled: true })
  }
  const client = await createLocalMcpClient({
    installation,
    localProjectPath: input.localProjectPath,
    environment: input.environment,
    authorizeCall: (expectedInstallation) => registry.authorizeCall(expectedInstallation),
  })
  return {
    installation,
    nativeToolRegistry: createLocalMcpToolRegistry(client, {
      persistence: {
        reserveGrant: async (grant) => {
          const result = await input.store.reserveAgentRuntimeCapabilityGrant(grant)
          return { reserved: result.reserved }
        },
        beginExecution: async (execution) => {
          const result = await input.store.beginAgentRuntimeToolExecution(execution)
          return { consumed: result.consumed }
        },
        appendAudit: (audit) => input.store.appendAgentRuntimeToolAudit(audit),
      },
    }),
    shutdown: () => client.shutdown(),
  }
}
