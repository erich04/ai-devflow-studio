import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalStore } from './local-store.js'
import { createFixtureLocalMcpRuntime } from './local-mcp-runtime.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

const serverSource = `
import readline from 'node:readline'
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
const tool = {
  name: 'scenario.evaluate',
  description: 'Evaluate one deterministic fixture scenario.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      scenarioJson: { type: 'string', minLength: 2, maxLength: 32768 },
      observationJson: { type: 'string', minLength: 2, maxLength: 32768 },
    },
    required: ['scenarioJson', 'observationJson'],
  },
  outputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      passed: { type: 'boolean' },
      failures: { type: 'array', maxItems: 64, items: { type: 'string', minLength: 1, maxLength: 240 } },
    },
    required: ['passed', 'failures'],
  },
}
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') send({
    jsonrpc: '2.0', id: message.id,
    result: {
      protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'devflow.fixture-mcp', version: '1.0.0' },
    },
  })
  else if (message.method === 'tools/list') send({ jsonrpc: '2.0', id: message.id, result: { tools: [tool] } })
  else if (message.method === 'tools/call') send({
    jsonrpc: '2.0', id: message.id,
    result: {
      content: [{ type: 'text', text: '{"passed":true,"failures":[]}' }],
      structuredContent: { passed: true, failures: [] }, isError: false,
    },
  })
})
`

describe('main-owned fixture Local MCP Runtime', () => {
  it('persists, enables, discovers, and reuses one exact installation across restart', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-local-mcp-runtime-'))
    directories.push(directory)
    const serverPath = path.join(directory, 'fixture-server.mjs')
    await writeFile(serverPath, serverSource, 'utf8')
    const store = await createLocalStore({ dbPath: path.join(directory, 'devflow.sqlite') })
    await store.saveMcpServers([{
      id: 'local-mcp-installation-runtime-fixture',
      name: 'Renderer lookalike',
      command: '/tmp/must-never-spawn',
      permission: 'shell',
      enabledLocally: true,
      lastAuditEvent: 'renderer metadata only',
    }])

    const first = await createFixtureLocalMcpRuntime({
      store,
      localProjectPath: directory,
      executablePath: process.execPath,
      serverPath,
      environment: {},
    })
    expect(first.installation).toMatchObject({ version: 2, enabled: true })
    expect(first.nativeToolRegistry.listDefinitions()).toMatchObject([
      { id: 'scenario.evaluate', version: 2, source: 'mcp' },
    ])
    await first.shutdown()

    const second = await createFixtureLocalMcpRuntime({
      store,
      localProjectPath: directory,
      executablePath: process.execPath,
      serverPath,
      environment: {},
    })
    expect(second.installation).toEqual(first.installation)
    expect(await store.listLocalMcpInstallations()).toEqual([first.installation])
    expect((await store.listMcpServers())[0]?.command).toBe('/tmp/must-never-spawn')
    await second.shutdown()
    store.close()
  })
})
