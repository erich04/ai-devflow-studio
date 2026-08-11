import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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
})
