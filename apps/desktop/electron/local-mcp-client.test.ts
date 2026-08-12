import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAgentRuntime,
  recordAgentPermissionDecision,
  requestAgentAction,
  resumeAgentRuntime,
} from '@ai-devflow/shared'
import {
  createLocalMcpClient,
  createLocalMcpToolRegistry,
  createLocalMcpToolRegistrations,
} from './local-mcp-client.js'
import type { LocalMcpInstallation } from './local-mcp-installation.js'
import { createNativeToolRegistry, digestNativeToolValue } from './native-tool-registry.js'

const tempDirs: string[] = []
const platformEnvironmentNames = process.platform === 'darwin' ? ['__CF_USER_TEXT_ENCODING'] : []
const authorizeFixtureCall = async () => undefined

afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })))
  tempDirs.length = 0
})

const fixtureServer = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import readline from 'node:readline'

if (process.argv[3]) writeFileSync(process.argv[3], 'started', 'utf8')
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
const mode = process.argv[2] ?? 'valid'
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    if (mode === 'startup-timeout') return
    if (mode === 'malformed-message') {
      process.stdout.write('not-json\\n')
      return
    }
    if (mode === 'oversized-message') {
      process.stdout.write('x'.repeat(300000))
      return
    }
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: mode === 'wrong-identity' ? 'untrusted.server' : 'devflow.fixture-mcp',
          version: '1.0.0',
        },
      },
    }) + '\\n')
  } else if (message.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: (mode === 'duplicate-tool' ? [1, 2] : [1]).map(() => ({
          name: 'fixture.echo',
          description: 'Return one bounded fixture message.',
          inputSchema: {
            type: 'object', additionalProperties: mode === 'invalid-schema',
            properties: { message: { type: 'string', minLength: 1, maxLength: 128 } },
            required: ['message'],
          },
          outputSchema: {
            type: 'object', additionalProperties: false,
            properties: {
              echoed: { type: 'string', minLength: 1, maxLength: 128 },
              environmentNames: {
                type: 'array', maxItems: 32,
                items: { type: 'string', minLength: 1, maxLength: 128 },
              },
            },
            required: ['echoed', 'environmentNames'],
          },
        })),
      },
    }) + '\\n')
  } else if (message.method === 'tools/call') {
    if (message.params.arguments.message === 'hang') return
    if (mode === 'oversized-tool-response') {
      process.stdout.write('x'.repeat(300000) + '\\n')
      return
    }
    const result = {
      echoed: mode === 'invalid-tool-output' ? 42 : message.params.arguments.message,
      environmentNames: Object.keys(process.env).sort(),
    }
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: mode === 'tool-error',
      },
    }) + '\\n')
  }
})
`

let nodeExecutableDigest: Promise<string> | undefined

async function fixtureInstallation(mode = 'valid'): Promise<{
  installation: LocalMcpInstallation
  localProjectPath: string
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-mcp-client-'))
  tempDirs.push(directory)
  const serverPath = path.join(directory, 'fixture-mcp.mjs')
  await writeFile(serverPath, fixtureServer, 'utf8')
  const executablePath = await realpath(process.execPath)
  return {
    installation: {
      stateVersion: 1,
      id: 'local-mcp-installation-fixture',
      version: 1,
      name: 'Deterministic fixture MCP',
      transport: 'stdio',
      executablePath,
      executableSha256: await (nodeExecutableDigest ??= readFile(executablePath).then((contents) =>
        createHash('sha256').update(contents).digest('hex')
      )),
      args: [serverPath, mode],
      allowedEnvironmentNames: [],
      workingDirectoryPolicy: { kind: 'local_project' },
      expectedServer: { name: 'devflow.fixture-mcp', version: '1.0.0' },
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
    },
    localProjectPath: directory,
  }
}

function runtimeWaitingForMcpTool(capabilitySetDigest: string, message = 'hello') {
  const input = { message }
  const created = createAgentRuntime({
    stateVersion: 1,
    id: 'agent-runtime-mcp-1',
    scope: {
      kind: 'local',
      organizationId: null,
      projectId: null,
      userId: 'user-mcp-1',
      sessionId: 'session-mcp-1',
      localProjectId: 'local-project-mcp-1',
    },
    authority: { runId: 'run-mcp-1', nodeId: 'node-mcp-1', runVersion: 1, policyVersion: 1 },
    contextDigest: 'a'.repeat(64),
    capabilitySetDigest,
    bounds: {
      maxSteps: 2,
      maxWallTimeMs: 60_000,
      maxToolCalls: 1,
      maxToolResultBytes: 1_024,
      maxTrajectoryMetadataBytes: 4_096,
      maxCheckpointBytes: 16_384,
      maxTokens: 1,
      maxCostUsd: Number.EPSILON,
    },
    requestedAt: '2026-08-12T21:00:00.000Z',
    deadline: '2026-08-12T21:01:00.000Z',
  })
  const running = resumeAgentRuntime({
    runtime: created.runtime,
    expectedCheckpointVersion: created.checkpoint.version,
    authority: created.runtime.authority,
    contextDigest: created.runtime.contextDigest,
    capabilitySetDigest,
    now: '2026-08-12T21:00:01.000Z',
  })
  const requested = requestAgentAction({
    runtime: running.runtime,
    expectedCheckpointVersion: running.checkpoint.version,
    action: {
      id: 'action-mcp-1',
      kind: 'tool',
      capabilityId: 'fixture.echo',
      capabilityVersion: 1,
      requestDigest: digestNativeToolValue(input),
      requiresPermission: true,
    },
    now: '2026-08-12T21:00:02.000Z',
  })
  return {
    input,
    runtime: recordAgentPermissionDecision({
      runtime: requested.runtime,
      expectedCheckpointVersion: requested.checkpoint.version,
      actionId: 'action-mcp-1',
      requestDigest: digestNativeToolValue(input),
      decision: 'approved_once',
      now: '2026-08-12T21:00:02.000Z',
    }).runtime,
  }
}

describe('main-owned local stdio MCP client', () => {
  it('rechecks installation authority immediately before spawn and creates no process on denial', async () => {
    const { installation, localProjectPath } = await fixtureInstallation()
    const markerPath = path.join(localProjectPath, 'spawned.marker')
    const outcome = await createLocalMcpClient({
      installation: { ...installation, args: [...installation.args, markerPath] },
      localProjectPath,
      environment: {},
      authorizeCall: async () => {
        throw new Error('local_mcp_installation_stale')
      },
    }).then(
      async (client) => {
        await client.shutdown()
        return 'started'
      },
      () => 'rejected',
    )

    expect(outcome).toBe('rejected')
    await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('discovers one exact installation-owned Tool and shuts the child down', async () => {
    const { installation, localProjectPath } = await fixtureInstallation()
    const client = await createLocalMcpClient({
      installation,
      localProjectPath,
      environment: {},
      authorizeCall: authorizeFixtureCall,
    })

    expect(client.serverInfo).toEqual(installation.expectedServer)
    expect(client.tools).toMatchObject([
      {
        stateVersion: 1,
        id: 'fixture.echo',
        version: 1,
        source: 'mcp',
        permissionClass: 'read',
        sideEffectClass: 'none',
        idempotency: 'idempotent',
      },
    ])
    expect(client.capabilitySetDigest).toMatch(/^[a-f0-9]{64}$/)
    await expect(
      client.callTool({ toolName: 'fixture.echo', input: { message: 'hello' } }),
    ).resolves.toEqual({ echoed: 'hello', environmentNames: platformEnvironmentNames })
    await expect(client.shutdown()).resolves.toBeUndefined()
    expect(client.closed).toBe(true)
  })

  it('rechecks main-owned installation authority immediately before every Tool call', async () => {
    const { installation, localProjectPath } = await fixtureInstallation()
    const authorizeCall = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('local_mcp_installation_stale'))
    const client = await createLocalMcpClient({
      installation,
      localProjectPath,
      environment: {},
      authorizeCall,
    })

    await expect(
      client.callTool({ toolName: 'fixture.echo', input: { message: 'must-not-run' } }),
    ).rejects.toThrow('local_mcp_installation_stale')
    expect(authorizeCall).toHaveBeenCalledTimes(2)
    expect(authorizeCall).toHaveBeenNthCalledWith(1, installation)
    expect(authorizeCall).toHaveBeenNthCalledWith(2, installation)
    await vi.waitFor(() => expect(client.closed).toBe(true))
  })

  it('executes an MCP Tool only through an exact one-shot Runtime grant and metadata audit', async () => {
    const { installation, localProjectPath } = await fixtureInstallation()
    const client = await createLocalMcpClient({
      installation,
      localProjectPath,
      environment: {},
      authorizeCall: authorizeFixtureCall,
    })
    const registry = createLocalMcpToolRegistry(client, {
      clock: (() => {
        const values = [
          '2026-08-12T21:00:03.000Z',
          '2026-08-12T21:00:04.000Z',
          '2026-08-12T21:00:05.000Z',
          '2026-08-12T21:00:06.000Z',
        ]
        return () => values.shift() ?? '2026-08-12T21:00:06.000Z'
      })(),
    })
    const { runtime, input } = runtimeWaitingForMcpTool(client.capabilitySetDigest)
    const grant = await registry.issueGrant({
      runtime,
      toolId: 'fixture.echo',
      toolVersion: 1,
      permission: {
        decision: 'approved',
        permissionClass: 'read',
        decidedAt: '2026-08-12T21:00:02.000Z',
        expiresAt: '2026-08-12T21:00:30.000Z',
      },
      resourceScope: { kind: 'local_project', localProjectId: 'local-project-mcp-1' },
      callLimit: 1,
    })

    await expect(
      registry.execute({ grant, runtime, actionId: 'action-mcp-1', input }),
    ).resolves.toMatchObject({
      value: { echoed: 'hello', environmentNames: platformEnvironmentNames },
    })
    expect(registry.listAuditRecords(runtime.id)).toMatchObject([
      {
        status: 'started',
        toolId: 'fixture.echo',
        source: 'mcp',
        installationId: installation.id,
        installationVersion: installation.version,
      },
      {
        status: 'succeeded',
        toolId: 'fixture.echo',
        source: 'mcp',
        installationId: installation.id,
        installationVersion: installation.version,
        redactionState: 'passed',
      },
    ])
    await client.shutdown()
  })

  it('rejects a Runtime checkpoint with a stale MCP discovery digest before grant issuance', async () => {
    const { installation, localProjectPath } = await fixtureInstallation()
    const client = await createLocalMcpClient({
      installation,
      localProjectPath,
      environment: {},
      authorizeCall: authorizeFixtureCall,
    })
    const registry = createLocalMcpToolRegistry(client, {
      clock: () => '2026-08-12T21:00:03.000Z',
    })
    const { runtime } = runtimeWaitingForMcpTool('b'.repeat(64))

    await expect(
      registry.issueGrant({
        runtime,
        toolId: 'fixture.echo',
        toolVersion: 1,
        permission: {
          decision: 'approved',
          permissionClass: 'read',
          decidedAt: '2026-08-12T21:00:02.000Z',
          expiresAt: '2026-08-12T21:00:30.000Z',
        },
        resourceScope: { kind: 'local_project', localProjectId: 'local-project-mcp-1' },
        callLimit: 1,
      }),
    ).rejects.toThrow('invalid_native_tool_grant')
    await client.shutdown()
  })

  it('starts from an empty environment and injects only installation-allowlisted names', async () => {
    const { installation, localProjectPath } = await fixtureInstallation()
    const allowlisted = {
      ...installation,
      allowedEnvironmentNames: ['DEVFLOW_MCP_FIXTURE'],
    }
    await expect(
      createLocalMcpClient({
        installation: allowlisted,
        localProjectPath,
        environment: { PATH: process.env.PATH },
        authorizeCall: authorizeFixtureCall,
      }),
    ).rejects.toThrow('local_mcp_environment_denied')

    const client = await createLocalMcpClient({
      installation: allowlisted,
      localProjectPath,
      environment: { DEVFLOW_MCP_FIXTURE: 'injected-without-persisting' },
      authorizeCall: authorizeFixtureCall,
    })
    await expect(
      client.callTool({ toolName: 'fixture.echo', input: { message: 'hello' } }),
    ).resolves.toEqual({
      echoed: 'hello',
      environmentNames: ['DEVFLOW_MCP_FIXTURE', ...platformEnvironmentNames].sort(),
    })
    await client.shutdown()
  })

  it('terminates the MCP process when a Tool call is cancelled', async () => {
    const { installation, localProjectPath } = await fixtureInstallation()
    const client = await createLocalMcpClient({
      installation,
      localProjectPath,
      environment: {},
      authorizeCall: authorizeFixtureCall,
    })
    const controller = new AbortController()
    const call = client.callTool({
      toolName: 'fixture.echo',
      input: { message: 'hang' },
      signal: controller.signal,
    })
    controller.abort()

    await expect(call).rejects.toThrow('local_mcp_cancelled')
    await vi.waitFor(() => expect(client.closed).toBe(true))
  })

  it('propagates Runtime cancellation through the registry into MCP shutdown and audit', async () => {
    const { installation, localProjectPath } = await fixtureInstallation()
    const client = await createLocalMcpClient({
      installation,
      localProjectPath,
      environment: {},
      authorizeCall: authorizeFixtureCall,
    })
    const registry = createNativeToolRegistry({
      tools: createLocalMcpToolRegistrations(client),
      clock: (() => {
        const values = [
          '2026-08-12T21:00:03.000Z',
          '2026-08-12T21:00:04.000Z',
          '2026-08-12T21:00:05.000Z',
          '2026-08-12T21:00:06.000Z',
        ]
        return () => values.shift() ?? '2026-08-12T21:00:06.000Z'
      })(),
    })
    const { runtime, input } = runtimeWaitingForMcpTool(client.capabilitySetDigest, 'hang')
    const grant = await registry.issueGrant({
      runtime,
      toolId: 'fixture.echo',
      toolVersion: 1,
      permission: {
        decision: 'approved',
        permissionClass: 'read',
        decidedAt: '2026-08-12T21:00:02.000Z',
        expiresAt: '2026-08-12T21:00:30.000Z',
      },
      resourceScope: { kind: 'local_project', localProjectId: 'local-project-mcp-1' },
      callLimit: 1,
    })
    const execution = registry.execute({ grant, runtime, actionId: 'action-mcp-1', input })
    await vi.waitFor(() => expect(registry.listAuditRecords(runtime.id)).toHaveLength(1))

    expect(registry.cancelRuntime(runtime.id)).toBe(1)
    await expect(execution).rejects.toMatchObject({ code: 'cancelled' })
    expect(registry.listAuditRecords(runtime.id)).toMatchObject([
      { status: 'started' },
      { status: 'cancelled', code: 'cancelled' },
    ])
    await vi.waitFor(() => expect(client.closed).toBe(true))
  })

  it.each([
    ['wrong server identity', 'wrong-identity', 'local_mcp_identity_mismatch'],
    ['duplicate Tool', 'duplicate-tool', 'local_mcp_discovery_invalid'],
    ['invalid Tool schema', 'invalid-schema', 'local_mcp_discovery_invalid'],
    ['malformed stdout message', 'malformed-message', 'local_mcp_protocol_error'],
    ['oversized stdout message', 'oversized-message', 'local_mcp_protocol_error'],
  ])('fails closed on %s before a capability can be issued', async (_label, mode, code) => {
    const { installation, localProjectPath } = await fixtureInstallation(mode)
    await expect(
      createLocalMcpClient({
        installation,
        localProjectPath,
        environment: {},
        authorizeCall: authorizeFixtureCall,
      }),
    ).rejects.toThrow(code)
  })

  it('bounds startup and terminates an MCP server that never initializes', async () => {
    const { installation, localProjectPath } = await fixtureInstallation('startup-timeout')
    await expect(
      createLocalMcpClient({
        installation: { ...installation, startupDeadlineMs: 20 },
        localProjectPath,
        environment: {},
        authorizeCall: authorizeFixtureCall,
      }),
    ).rejects.toThrow('local_mcp_deadline_exceeded')
  })

  it('bounds a Tool call and terminates an MCP server that never responds', async () => {
    const { installation, localProjectPath } = await fixtureInstallation()
    const client = await createLocalMcpClient({
      installation: { ...installation, callDeadlineMs: 20 },
      localProjectPath,
      environment: {},
      authorizeCall: authorizeFixtureCall,
    })

    await expect(
      client.callTool({ toolName: 'fixture.echo', input: { message: 'hang' } }),
    ).rejects.toThrow('local_mcp_deadline_exceeded')
    await vi.waitFor(() => expect(client.closed).toBe(true))
  })

  it('rejects an MCP Tool error result and terminates the server', async () => {
    const { installation, localProjectPath } = await fixtureInstallation('tool-error')
    const client = await createLocalMcpClient({
      installation,
      localProjectPath,
      environment: {},
      authorizeCall: authorizeFixtureCall,
    })

    await expect(
      client.callTool({ toolName: 'fixture.echo', input: { message: 'hello' } }),
    ).rejects.toThrow('local_mcp_tool_result_invalid')
    await vi.waitFor(() => expect(client.closed).toBe(true))
  })

  it('rejects an MCP Tool result outside the discovered output schema', async () => {
    const { installation, localProjectPath } = await fixtureInstallation('invalid-tool-output')
    const client = await createLocalMcpClient({
      installation,
      localProjectPath,
      environment: {},
      authorizeCall: authorizeFixtureCall,
    })

    await expect(
      client.callTool({ toolName: 'fixture.echo', input: { message: 'hello' } }),
    ).rejects.toThrow('local_mcp_tool_result_invalid')
    await vi.waitFor(() => expect(client.closed).toBe(true))
  })

  it('rejects an oversized MCP Tool response before retaining output', async () => {
    const { installation, localProjectPath } = await fixtureInstallation('oversized-tool-response')
    const client = await createLocalMcpClient({
      installation,
      localProjectPath,
      environment: {},
      authorizeCall: authorizeFixtureCall,
    })

    await expect(
      client.callTool({ toolName: 'fixture.echo', input: { message: 'hello' } }),
    ).rejects.toThrow('local_mcp_protocol_error')
    await vi.waitFor(() => expect(client.closed).toBe(true))
  })
})
