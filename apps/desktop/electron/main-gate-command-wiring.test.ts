import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Electron Gate Command production wiring', () => {
  const main = readFileSync('apps/desktop/electron/main.ts', 'utf8')

  it('builds each poll from the atomic pairing bundle and its decrypted token', () => {
    expect(main).toContain("from './gate-command-processor.js'")
    expect(main).toContain("from './gate-command-scheduler.js'")
    expect(main).toMatch(
      /async function processAvailableGateCommands[\s\S]*?getDesktopPairingCredentialBundle\(\)[\s\S]*?decryptCredential\(bundle\.encryptedToken\)[\s\S]*?createRemoteSyncClient\([\s\S]*?authToken[\s\S]*?createGateCommandProcessor\([\s\S]*?processAvailable\(binding\)/,
    )
  })

  it('idles before decrypting or calling Team when the stored binding is incomplete', () => {
    const cycle = main.slice(
      main.indexOf('async function processAvailableGateCommands'),
      main.indexOf('async function getGateCommandScheduler'),
    )
    const guard = cycle.indexOf('!bundle ||')
    const idleReturn = cycle.indexOf('return', guard)
    const decrypt = cycle.indexOf('decryptCredential(bundle.encryptedToken)')
    expect(guard).toBeGreaterThan(-1)
    expect(idleReturn).toBeGreaterThan(guard)
    expect(idleReturn).toBeLessThan(decrypt)
  })

  it('fails closed when the live Team policy cannot be refreshed authoritatively', () => {
    expect(main).toContain('requireFreshPolicy?: boolean')
    expect(main).toMatch(
      /evaluateLocalGateEnforcement\([\s\S]*?refreshPolicy: true[\s\S]*?requireFreshPolicy: true[\s\S]*?remoteSync: gateRemoteSync/,
    )
    expect(main).toMatch(
      /options\.requireFreshPolicy && !policyRefreshSucceeded[\s\S]*?source: 'unavailable'/,
    )
    expect(main).toMatch(
      /effectivePolicies\.some\([\s\S]*?policy\.projectId === projectId/,
    )
  })

  it('starts after Electron is ready and aborts then stops before quit', () => {
    const ready = main.slice(main.indexOf('app.whenReady()'))
    expect(ready).toMatch(
      /getGateCommandScheduler\(\)[\s\S]*?scheduler\.start\(\)/,
    )

    const beforeQuit = main.slice(main.indexOf("app.on('before-quit'"))
    expect(beforeQuit).toMatch(
      /gateCommandCycleAbortController\?\.abort\(\)[\s\S]*?gateCommandScheduler\?\.stop\(\)/,
    )
  })

  it('bounds every active Gate cycle below the receipt lease and clears its abort timer', () => {
    expect(main).toContain('const GATE_COMMAND_CYCLE_TIMEOUT_MS = 30_000')
    const cycle = main.slice(
      main.indexOf('async function processAvailableGateCommands'),
      main.indexOf('async function getGateCommandScheduler'),
    )
    expect(cycle).toMatch(
      /setTimeout\([\s\S]*?cycleAbortController\.abort\(\)[\s\S]*?GATE_COMMAND_CYCLE_TIMEOUT_MS/,
    )
    expect(cycle).toMatch(
      /finally \{[\s\S]*?clearTimeout\(cycleTimeout\)/,
    )
  })

  it('wakes after pairing and after Work Request materialization settles', () => {
    expect(main).toMatch(
      /ipcMain\.handle\(ipcChannels\.pairDesktop[\s\S]*?wakeGateCommandScheduler\(\)[\s\S]*?return \{ credential: boundCredential \}/,
    )
    expect(main).toMatch(
      /ipcChannels\.materializeWorkRequest[\s\S]*?finally \{[\s\S]*?wakeGateCommandScheduler\(\)/,
    )
  })

  it('turns known local project or knowledge unavailability into a fail-closed evaluation', () => {
    expect(main).toContain('isKnownGateCommandEvaluationUnavailable')
    expect(main).toContain("id: 'gate-command-local-evidence-unavailable'")
    expect(main).toMatch(
      /catch \(error\) \{[\s\S]*?isKnownGateCommandEvaluationUnavailable\(error\)[\s\S]*?throw error[\s\S]*?buildUnavailableGateCommandEvaluation/,
    )
    expect(main).toMatch(
      /status:[\s\S]*?'blocked_policy_unavailable'[\s\S]*?'hard_blocked'/,
    )
  })
})
