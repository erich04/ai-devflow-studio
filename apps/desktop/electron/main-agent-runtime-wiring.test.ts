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
      main.indexOf('ipcMain.handle(ipcChannels.listCoordinationSessions'),
    )
    expect(handlers).toMatch(
      /parseStartAgentRuntimeInput\(payload\)[\s\S]*?getDesktopAgentRuntime\(\)[\s\S]*?\.start\(input\)/,
    )
    expect(handlers).toMatch(
      /parseAdvanceAgentRuntimeInput\(payload\)[\s\S]*?\.advance\(input\)/,
    )
    expect(handlers).toMatch(
      /parseCancelAgentRuntimeInput\(payload\)[\s\S]*?\.cancel\(input\)/,
    )
    expect(handlers).not.toMatch(
      /worktreePath|command|capabilitySet|checkpoint|resultDigest|stopReason/,
    )
  })

  it('broadcasts only committed snapshots and lists redacted terminal summaries', () => {
    const handlers = main.slice(
      main.indexOf('ipcMain.handle(ipcChannels.startAgentRuntime'),
      main.indexOf('ipcMain.handle(ipcChannels.listCoordinationSessions'),
    )
    expect(handlers.match(/broadcastToRenderers\(ipcChannels\.agentRuntimeUpdated, snapshot\)/g))
      .toHaveLength(3)
    expect(handlers).toMatch(
      /ipcChannels\.listAgentRuntimes[\s\S]*?parseListAgentRuntimesInput\(payload\)[\s\S]*?createAgentRuntimeRendererAccess\(store\)\.list\(input\)/,
    )
    expect(handlers).toMatch(
      /ipcChannels\.getAgentRuntime[\s\S]*?parseGetAgentRuntimeInput\(payload\)[\s\S]*?createAgentRuntimeRendererAccess\(store\)\.get\(input\)/,
    )
    expect(handlers.match(/createAgentRuntimeRendererSnapshot\(runtimeSnapshot\)/g))
      .toHaveLength(3)
    expect(handlers).not.toContain('loadState()')
  })

  it('exposes Agent Coordination through one read-only metadata projection', () => {
    const handlers = main.slice(
      main.indexOf('ipcMain.handle(ipcChannels.listCoordinationSessions'),
      main.indexOf('ipcMain.handle(ipcChannels.resumeCoordinationSession'),
    )
    expect(main).toContain("from './agent-coordination-renderer-access.js'")
    expect(handlers).toMatch(
      /parseListCoordinationSessionsInput\(payload\)[\s\S]*?getStore\(\)[\s\S]*?createAgentCoordinationRendererAccess\(store\)\.list\(input\)/,
    )
    expect(handlers).toMatch(
      /parseGetCoordinationSessionInput\(payload\)[\s\S]*?getStore\(\)[\s\S]*?createAgentCoordinationRendererAccess\(store\)\.get\(input\)/,
    )
    expect(handlers).not.toMatch(
      /commitCoordination|authorizeCoordination|resume\(|start\(|cancel\(|scope|summary|sessionId/,
    )
  })

  it('routes exact Coordination commands through the main-owned authority broker', () => {
    const handlers = main.slice(
      main.indexOf('ipcMain.handle(ipcChannels.startCoordinationPlan'),
      main.indexOf('ipcMain.handle(ipcChannels.listAgentMemoryLifecycle'),
    )
    expect(main).toContain("from './agent-coordination-commands.js'")
    expect(main).toContain("from './agent-coordination-plan.js'")
    expect(main).toContain("from './specialist-task-authority.js'")
    expect(main).toContain("from './specialist-runtime-coordinator.js'")
    expect(handlers).toMatch(
      /parseStartCoordinationPlanInput\(payload\)[\s\S]*?commands\.startPlan\(input\)/,
    )
    expect(handlers).toMatch(
      /parseResumeCoordinationSessionInput\(payload\)[\s\S]*?commands\.resume\(input\)/,
    )
    expect(handlers).toMatch(
      /parseStartCoordinationTaskInput\(payload\)[\s\S]*?commands\.startTask\(input\)/,
    )
    expect(handlers).toMatch(
      /parseCancelCoordinationSessionInput\(payload\)[\s\S]*?commands\.cancel\(input\)/,
    )
    expect(handlers).not.toMatch(/graph|roleId|capabilityIds|scope|summary|transition|sessionId/)
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

  it('exposes Agent Memory lifecycle through one read-only main-owned projection', () => {
    const handlers = main.slice(
      main.indexOf('ipcMain.handle(ipcChannels.listAgentMemoryLifecycle'),
      main.indexOf('ipcMain.handle(ipcChannels.deleteRun'),
    )
    expect(main).toContain("from './agent-memory-renderer-access.js'")
    expect(handlers).toMatch(
      /parseListAgentMemoryLifecycleInput\(payload\)[\s\S]*?getStore\(\)[\s\S]*?createAgentMemoryRendererAccess\(store\)\.list\(input\)/,
    )
    expect(handlers).not.toMatch(
      /authorizeAgentMemory|commitAgentMemory|purgeAgentMemory|capability|statement|sessionId/,
    )
  })

  it('promotes one exact Candidate through main-owned authority and returns only the projection', () => {
    const handlers = main.slice(
      main.indexOf('ipcMain.handle(ipcChannels.promoteAgentMemoryCandidate'),
      main.indexOf('ipcMain.handle(ipcChannels.deleteRun'),
    )
    expect(main).toContain("from './agent-memory-human-actions.js'")
    expect(handlers).toMatch(
      /parsePromoteAgentMemoryCandidateInput\(payload\)[\s\S]*?getStore\(\)[\s\S]*?createAgentMemoryHumanActions\(\{ store \}\)\.promote\(input\)[\s\S]*?createAgentMemoryRendererAccess\(store\)\.list\(input\)/,
    )
    expect(handlers).not.toMatch(/authorityDigest|sessionId|statement|capability/)
  })

  it('revises one exact Memory through main-owned authority and returns only the projection', () => {
    const handlers = main.slice(
      main.indexOf('ipcMain.handle(ipcChannels.reviseAgentMemory'),
      main.indexOf('ipcMain.handle(ipcChannels.deleteRun'),
    )
    expect(handlers).toMatch(
      /parseReviseAgentMemoryInput\(payload\)[\s\S]*?getStore\(\)[\s\S]*?createAgentMemoryHumanActions\(\{ store \}\)\.revise\(input\)[\s\S]*?createAgentMemoryRendererAccess\(store\)\.list\(input\)/,
    )
    expect(handlers).not.toMatch(/authorityDigest|sessionId|capability/)
  })

  it('deletes one exact Memory through main-owned authority and returns only the projection', () => {
    const handlers = main.slice(
      main.indexOf('ipcMain.handle(ipcChannels.deleteAgentMemory'),
      main.indexOf('ipcMain.handle(ipcChannels.deleteRun'),
    )
    expect(handlers).toMatch(
      /parseDeleteAgentMemoryInput\(payload\)[\s\S]*?getStore\(\)[\s\S]*?createAgentMemoryHumanActions\(\{ store \}\)\.delete\(input\)[\s\S]*?createAgentMemoryRendererAccess\(store\)\.list\(input\)/,
    )
    expect(handlers).not.toMatch(/authorityDigest|sessionId|capability|purgedAt/)
  })
})
