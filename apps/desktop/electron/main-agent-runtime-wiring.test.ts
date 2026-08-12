import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Electron Agent Runtime production wiring', () => {
  const main = readFileSync('apps/desktop/electron/main.ts', 'utf8')

  it('keeps runtime construction and execution inside Electron main', () => {
    expect(main).toContain("from './agent-runtime-runtime.js'")
    expect(main).toMatch(
      /function getDesktopAgentRuntime\(\)[\s\S]*?getStore\(\)[\s\S]*?\.then\(async \(store\) =>[\s\S]*?!runtimeFlags\.localMcpFixtureEnabled[\s\S]*?createDesktopAgentRuntime\(\{ store \}\)[\s\S]*?createFixtureLocalMcpRuntime\([\s\S]*?nativeToolRegistry: fixtureLocalMcpRuntime\.nativeToolRegistry/,
    )

    const handlers = main.slice(
      main.indexOf('ipcMain.handle(ipcChannels.startAgentRuntime'),
      main.indexOf('ipcMain.handle(ipcChannels.deleteRun'),
    )
    expect(handlers).toMatch(
      /parseStartAgentRuntimeInput\(payload\)[\s\S]*?getDesktopAgentRuntime\(\)[\s\S]*?\.start\(input\)/,
    )
    expect(handlers).toMatch(
      /parseAdvanceAgentRuntimeInput\(payload\)[\s\S]*?\.advance\(input\.runtimeId\)/,
    )
    expect(handlers).toMatch(
      /parseCancelAgentRuntimeInput\(payload\)[\s\S]*?\.cancel\(input\.runtimeId\)/,
    )
    expect(handlers).not.toMatch(
      /worktreePath|command|capabilitySet|checkpoint|resultDigest|stopReason/,
    )
  })

  it('broadcasts only committed snapshots and lists redacted terminal summaries', () => {
    const handlers = main.slice(
      main.indexOf('ipcMain.handle(ipcChannels.startAgentRuntime'),
      main.indexOf('ipcMain.handle(ipcChannels.deleteRun'),
    )
    expect(handlers.match(/broadcastToRenderers\(ipcChannels\.agentRuntimeUpdated, snapshot\)/g))
      .toHaveLength(3)
    expect(handlers).toMatch(
      /ipcChannels\.listAgentRuntimes[\s\S]*?store\.listAgentRuntimes\(\)[\s\S]*?getAgentRuntimeTerminalSummary\(runtime\.id\)/,
    )
    expect(handlers).not.toContain('loadState()')
  })

  it('recovers durable nonterminal runtimes after app readiness', () => {
    const ready = main.slice(main.indexOf('app.whenReady().then'))
    expect(ready).toMatch(
      /getDesktopAgentRuntime\(\)[\s\S]*?runtime\.recover\(\)[\s\S]*?for \(const snapshot of snapshots\)[\s\S]*?agentRuntimeUpdated/,
    )
    expect(ready.indexOf('runtime.recover()')).toBeGreaterThan(
      ready.indexOf('registerIpcHandlers()'),
    )
  })
})
