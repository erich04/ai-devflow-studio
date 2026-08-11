import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GITHUB_GIT_PUBLISHER_REQUIRED_CREDENTIAL_LIFETIME_MS } from './github-git-publisher'

describe('Electron GitHub Delivery renderer boundary', () => {
  const main = readFileSync('apps/desktop/electron/main.ts', 'utf8')
  const contract = readFileSync('apps/desktop/electron/ipc-contract.ts', 'utf8')

  it('returns only the redacted preparation result instead of the full local state', () => {
    const handler = main.slice(
      main.indexOf('ipcMain.handle(ipcChannels.prepareGitHubDelivery'),
      main.indexOf('ipcMain.handle(ipcChannels.createAcceptanceBundle'),
    )

    expect(handler).not.toContain('store.loadState()')
    expect(handler).toMatch(
      /const result = await prepareGitHubDelivery\(input\)/,
    )

    const resultContract = contract.slice(
      contract.indexOf('export type PrepareGitHubDeliveryResult'),
      contract.indexOf('export type CreateAcceptanceBundleInput'),
    )
    expect(resultContract).not.toContain('LocalExecutionState')
    expect(resultContract).not.toMatch(/\bstate\s*:/)
  })

  it('builds one bounded processor cycle from the atomic project-bound pairing bundle', () => {
    const cycle = main.slice(
      main.indexOf('async function createCurrentGitHubDeliveryContext'),
      main.indexOf('async function processAvailableGitHubDeliveries'),
    )

    expect(main).toContain("from './github-delivery-processor.js'")
    expect(main).toContain("from './github-delivery-scheduler.js'")
    expect(cycle).toMatch(
      /getDesktopPairingCredentialBundle\(\)[\s\S]*?decryptCredential\(bundle\.encryptedToken\)[\s\S]*?createGitHubDeliveryRemoteClient\([\s\S]*?authToken[\s\S]*?signal/,
    )
    expect(cycle).toMatch(
      /createCurrentGitHubDeliveryProcessor[\s\S]*?synchronizeGitHubRepositoryBinding\([\s\S]*?status !== 'active'[\s\S]*?createActiveGitHubDeliveryProcessor/,
    )
    expect(cycle).not.toContain('saveGitHubRepositoryBinding(')
    expect(cycle).toMatch(
      /createActiveGitHubDeliveryProcessor[\s\S]*?createGitHubGitPublisher\([\s\S]*?signal[\s\S]*?createGitHubDeliveryProcessor\([\s\S]*?maxIntentsPerCycle: 1/,
    )
  })

  it('freshly synchronizes repository authority inside the exclusive Prepare operation', () => {
    const preparation = main.slice(
      main.indexOf('async function prepareGitHubDelivery'),
      main.indexOf('async function broadcastGitHubDeliveryState'),
    )

    expect(main).toContain("from './github-repository-binding-sync.js'")
    expect(preparation).toMatch(
      /runGitHubDeliveryExclusive\(async \(signal\)[\s\S]*?createCurrentGitHubDeliveryContext\(signal\)[\s\S]*?synchronizeGitHubRepositoryBinding\([\s\S]*?binding\.status !== 'active'[\s\S]*?runtime\.prepare\(input\)/,
    )
    expect(preparation).not.toContain('getGitHubRepositoryBinding(')
    expect(preparation).not.toContain('saveGitHubRepositoryBinding(')
    expect(preparation).toMatch(
      /finally \{[\s\S]*?broadcastGitHubDeliveryState\(\)/,
    )
  })

  it('settles immutable local and remote completion before repository authority can revoke pending state', () => {
    const cycle = main.slice(
      main.indexOf('async function processAvailableGitHubDeliveries'),
      main.indexOf('function safeGitHubDeliveryResult'),
    )

    expect(main).toContain('reconcileCompletedGitHubDeliveryIntents')
    expect(main).toContain('reconcileRemoteCompletedGitHubDeliveryIntents')
    expect(cycle).toMatch(
      /reconcileCompletedGitHubDeliveryIntents\([\s\S]*?createCurrentGitHubDeliveryContext\(signal\)[\s\S]*?reconcileRemoteCompletedGitHubDeliveryIntents\([\s\S]*?synchronizeGitHubRepositoryBinding\(/,
    )
    expect(cycle.indexOf('reconcileRemoteCompletedGitHubDeliveryIntents')).toBeLessThan(
      cycle.indexOf('synchronizeGitHubRepositoryBinding'),
    )
    expect(cycle).toMatch(
      /if \(!binding \|\| binding\.status !== 'active'\) return/,
    )
  })

  it('serializes scheduler and manual recovery behind one abortable operation boundary', () => {
    const exclusive = main.slice(
      main.indexOf('async function runGitHubDeliveryExclusive'),
      main.indexOf('async function createCurrentGitHubDeliveryContext'),
    )

    expect(exclusive).toContain('githubDeliveryOperationQueue')
    expect(exclusive).toContain('new AbortController()')
    expect(exclusive).toMatch(
      /setTimeout\([\s\S]*?operationAbortController\.abort\(\)[\s\S]*?GITHUB_DELIVERY_OPERATION_TIMEOUT_MS/,
    )
    expect(exclusive).toMatch(/finally \{[\s\S]*?clearTimeout\(operationTimeout\)/)
    expect(main).toContain(
      'const GITHUB_DELIVERY_OPERATION_TIMEOUT_MS = 15 * 60_000',
    )
    const operationTimeoutMinutes = Number(
      /const GITHUB_DELIVERY_OPERATION_TIMEOUT_MS = (\d+) \* 60_000/u.exec(
        main,
      )?.[1],
    )
    const operationTimeoutMs = operationTimeoutMinutes * 60_000
    expect(operationTimeoutMs).toBeGreaterThan(
      GITHUB_GIT_PUBLISHER_REQUIRED_CREDENTIAL_LIFETIME_MS,
    )
    expect(operationTimeoutMs).toBeLessThan(60 * 60_000)
    expect(main).toMatch(
      /minimumCredentialLifetimeMs:[\s\S]*?GITHUB_GIT_PUBLISHER_REQUIRED_CREDENTIAL_LIFETIME_MS/,
    )
  })

  it('exposes only exact-version resume and broadcasts canonical state after it settles', () => {
    const handler = main.slice(
      main.indexOf('ipcMain.handle(ipcChannels.resumeGitHubDelivery'),
      main.indexOf('ipcMain.handle(ipcChannels.createAcceptanceBundle'),
    )

    expect(handler).toMatch(/parseResumeGitHubDeliveryInput\(payload\)/)
    expect(handler).toMatch(/resumeGitHubDelivery\(input\)/)
    expect(handler).not.toMatch(/token|worktreePath|encryptedToken|rawError/)
    expect(main).toMatch(
      /async function resumeGitHubDelivery[\s\S]*?finally \{[\s\S]*?broadcastGitHubDeliveryState\(\)/,
    )
    expect(main).toMatch(
      /async function processAvailableGitHubDeliveries[\s\S]*?finally \{[\s\S]*?broadcastGitHubDeliveryState\(\)/,
    )
  })

  it('serializes exact-CAS Revise and Retry before waking the delivery scheduler', () => {
    const replacement = main.slice(
      main.indexOf('async function replaceGitHubDelivery'),
      main.indexOf('async function broadcastGitHubDeliveryState'),
    )
    const handlers = main.slice(
      main.indexOf('ipcMain.handle(ipcChannels.prepareGitHubDelivery'),
      main.indexOf('ipcMain.handle(ipcChannels.resumeGitHubDelivery'),
    )
    expect(replacement).toMatch(
      /runGitHubDeliveryExclusive\(async \(signal\)[\s\S]*?synchronizeGitHubRepositoryBinding\([\s\S]*?runtime\[kind\]\(input\)/,
    )
    expect(replacement).toMatch(
      /kind === 'retry'[\s\S]*?assertGitHubDeliveryRetryAuthority\([\s\S]*?runtime\[kind\]\(input\)/,
    )
    expect(replacement).toMatch(/finally \{[\s\S]*?broadcastGitHubDeliveryState\(\)/)
    expect(handlers).toMatch(
      /ipcMain\.handle\(ipcChannels\.reviseGitHubDelivery[\s\S]*?parseReviseGitHubDeliveryInput\(payload\)[\s\S]*?replaceGitHubDelivery\('revise', input\)[\s\S]*?wakeGitHubDeliveryScheduler\(\)/,
    )
    expect(handlers).toMatch(
      /ipcMain\.handle\(ipcChannels\.retryGitHubDelivery[\s\S]*?parseRetryGitHubDeliveryInput\(payload\)[\s\S]*?replaceGitHubDelivery\('retry', input\)[\s\S]*?wakeGitHubDeliveryScheduler\(\)/,
    )
    expect(handlers).not.toMatch(/token|worktreePath|deliveryAttempt|deliverySeriesKey/)
  })

  it('persists an exact Stop before aborting only its matching active fence and broadcasts state', () => {
    const stop = main.slice(
      main.indexOf('async function stopCurrentGitHubDelivery'),
      main.indexOf('async function getGitHubDeliveryScheduler'),
    )
    const handler = main.slice(
      main.indexOf('ipcMain.handle(ipcChannels.stopGitHubDelivery'),
      main.indexOf('ipcMain.handle(ipcChannels.createAcceptanceBundle'),
    )

    expect(main).toMatch(
      /onIntentOperationChange:[\s\S]*?githubDeliveryActiveIntentOperation = active/,
    )
    expect(stop).toMatch(
      /stopGitHubDelivery\([\s\S]*?stopIntent:[\s\S]*?stopGitHubDeliveryIntent[\s\S]*?getActiveOperation/,
    )
    expect(stop).not.toContain('runGitHubDeliveryExclusive')
    expect(handler).toMatch(/parseStopGitHubDeliveryInput\(payload\)/)
    expect(handler).toMatch(/stopCurrentGitHubDelivery\(input\)/)
    expect(stop).toMatch(
      /finally \{[\s\S]*?broadcastGitHubDeliveryState\(\)/,
    )
    expect(stop).not.toMatch(/token|worktreePath|encryptedToken|rawError/)
  })

  it('starts after app readiness, wakes on authority changes, and drains safely before quit', () => {
    const ready = main.slice(main.indexOf('app.whenReady()'))
    expect(ready).toMatch(
      /getGitHubDeliveryScheduler\(\)[\s\S]*?scheduler\.start\(\)/,
    )
    expect(main).toMatch(
      /ipcMain\.handle\(ipcChannels\.pairDesktop[\s\S]*?wakeGitHubDeliveryScheduler\(\)/,
    )
    expect(main).toMatch(
      /ipcMain\.handle\(ipcChannels\.prepareGitHubDelivery[\s\S]*?wakeGitHubDeliveryScheduler\(\)/,
    )

    const beforeQuit = main.slice(main.indexOf("app.on('before-quit'"))
    expect(beforeQuit).toMatch(
      /githubDeliveryStopping = true[\s\S]*?githubDeliveryScheduler\?\.stop\(\)[\s\S]*?githubDeliveryOperationAbortController\?\.abort\(\)[\s\S]*?waitForGitHubDeliveryCleanup\(\)/,
    )
  })

  it('serializes a pairing replacement behind the active GitHub Delivery operation', () => {
    const pairing = main.slice(
      main.indexOf('ipcMain.handle(ipcChannels.pairDesktop'),
      main.indexOf('ipcMain.handle(ipcChannels.loadRemoteSnapshot'),
    )

    expect(pairing).toMatch(
      /exchangeDesktopPairingCode[\s\S]*?githubDeliveryOperationAbortController\?\.abort\(\)[\s\S]*?runGitHubDeliveryExclusive\(async \(\)[\s\S]*?saveDesktopPairingCredential/,
    )
    expect(pairing.indexOf('runGitHubDeliveryExclusive')).toBeLessThan(
      pairing.indexOf('saveDesktopPairingCredential'),
    )
    expect(pairing).toMatch(
      /runGitHubDeliveryExclusive[\s\S]*?saveDesktopPairingCredential[\s\S]*?resetRemoteSyncClient/,
    )
  })
})
