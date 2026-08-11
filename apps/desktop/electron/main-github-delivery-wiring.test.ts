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
      /const result = await runtime\.prepare\(input\)[\s\S]*?return result/,
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
      main.indexOf('async function createCurrentGitHubDeliveryProcessor'),
      main.indexOf('async function processAvailableGitHubDeliveries'),
    )

    expect(main).toContain("from './github-delivery-processor.js'")
    expect(main).toContain("from './github-delivery-scheduler.js'")
    expect(cycle).toMatch(
      /getDesktopPairingCredentialBundle\(\)[\s\S]*?decryptCredential\(bundle\.encryptedToken\)[\s\S]*?createGitHubDeliveryRemoteClient\([\s\S]*?authToken[\s\S]*?signal/,
    )
    expect(cycle).toMatch(
      /createGitHubGitPublisher\([\s\S]*?signal[\s\S]*?createGitHubDeliveryProcessor\([\s\S]*?maxIntentsPerCycle: 1/,
    )
  })

  it('serializes scheduler and manual recovery behind one abortable operation boundary', () => {
    const exclusive = main.slice(
      main.indexOf('async function runGitHubDeliveryExclusive'),
      main.indexOf('async function createCurrentGitHubDeliveryProcessor'),
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
})
