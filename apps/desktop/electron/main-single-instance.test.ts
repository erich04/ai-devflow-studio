import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Electron single-instance persistence boundary', () => {
  it('prevents two Electron processes from opening the same sql.js store', () => {
    const main = readFileSync('apps/desktop/electron/main.ts', 'utf8')

    expect(main).toContain('app.requestSingleInstanceLock()')
    expect(main).toContain("app.on('second-instance'")
    expect(main).toContain('if (!hasSingleInstanceLock)')
    expect(main).toContain('app.quit()')
  })

  it('applies an isolated userData path before acquiring the process lock', () => {
    const main = readFileSync('apps/desktop/electron/main.ts', 'utf8')
    const configuredUserData = main.indexOf("app.setPath('userData'")
    const processLock = main.indexOf('app.requestSingleInstanceLock()')

    expect(configuredUserData).toBeGreaterThanOrEqual(0)
    expect(configuredUserData).toBeLessThan(processLock)
  })
})
