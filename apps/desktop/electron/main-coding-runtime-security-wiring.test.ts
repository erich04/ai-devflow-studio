import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Electron Coding Runtime trust-boundary wiring', () => {
  const main = readFileSync('apps/desktop/electron/main.ts', 'utf8')

  it('discovers OpenCode without a renderer-controlled binary override and persists the Main candidate', () => {
    const handler = sliceBetween(
      main,
      'ipcMain.handle(ipcChannels.saveCodingRuntimeConfiguration',
      'ipcMain.handle(ipcChannels.detectCodingRuntimeEngines',
    )

    expect(handler).toContain('detectCodingRuntimeEngines({ projectId: input.projectId })')
    expect(handler).not.toContain('DEVFLOW_OPENCODE_BIN')
    expect(handler).toMatch(/binaryPath: trustedOpencodeCandidate!?\.binaryPath/u)
    expect(handler).toMatch(/detectedVersion: trustedOpencodeCandidate!?\.version/u)
    expect(handler.indexOf('opencodeProcessManager.stopProject(input.projectId)')).toBeLessThan(
      handler.indexOf('store.saveCodingRuntimeConfiguration('),
    )
  })

  it('checks readiness against Main discovery without replaying the saved binary as an env override', () => {
    const readiness = sliceBetween(
      main,
      'async function getCodingReadiness',
      'async function createKnowledgeReviewRuntimeForRequest',
    )

    expect(readiness).toContain('detectCodingRuntimeEngines({ projectId: input.projectId })')
    expect(readiness).not.toContain('DEVFLOW_OPENCODE_BIN')
    expect(readiness).toContain('await inspectOpencodeRuntimeProfile({')
    expect(readiness).not.toContain('process.env.HOME')
    expect(readiness).toContain('authAvailable: runtimeProfile.authAvailable')
    expect(readiness).toContain('profileAvailable: runtimeProfile.profileAvailable')
    expect(readiness).toContain('modelAvailable: runtimeProfile.modelAvailable')
  })

  it('replaces the renderer permission identity with the trusted project pairing', () => {
    const handler = sliceBetween(
      main,
      'ipcMain.handle(ipcChannels.replyCodingPermission',
      'ipcMain.handle(ipcChannels.subscribeCodingRun',
    )

    expect(handler).toContain('store.getDesktopPairingCredential()')
    expect(handler).toContain('resolveTrustedCodingPermissionReply({')
    expect(handler).toContain('return runtime.replyCodingPermission(trustedInput)')
    expect(handler).not.toContain('return runtime.replyCodingPermission(input)')
  })

  it.each([
    {
      channel: 'getCodingRuntimeReadiness',
      endChannel: 'getCodingChangeSetPreview',
      parser: 'parseGetCodingRuntimeReadinessInput(payload)',
      runtimeCall: 'getCodingReadiness(input)',
    },
    {
      channel: 'runCodingAgent',
      endChannel: 'startRetryAttempt',
      parser: 'parseRunCodingAgentInput(payload)',
      runtimeCall: 'runtime.runCodingAgent(input)',
    },
    {
      channel: 'startRetryAttempt',
      endChannel: 'cancelCodingAgentRun',
      parser: 'parseStartRetryAttemptInput(payload)',
      runtimeCall: 'runtime.startRetryAttempt({',
    },
  ])('resolves trusted requestedBy before $channel readiness and runtime work', ({
    channel,
    endChannel,
    parser,
    runtimeCall,
  }) => {
    const handler = sliceBetween(
      main,
      `ipcMain.handle(ipcChannels.${channel}`,
      `ipcMain.handle(ipcChannels.${endChannel}`,
    )

    expect(handler).toContain('resolveTrustedCodingRequestForMain(')
    expect(handler).toContain(parser)
    const readinessIndex = handler.indexOf('getCodingReadiness(input)')
    if (readinessIndex >= 0) {
      expect(handler.indexOf('resolveTrustedCodingRequestForMain(')).toBeLessThan(readinessIndex)
    }
    expect(handler).toContain(runtimeCall)
  })
})

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}
