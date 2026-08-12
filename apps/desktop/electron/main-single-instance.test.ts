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

  it('disables the packaged Chromium dictionary downloader', () => {
    const main = readFileSync('apps/desktop/electron/main.ts', 'utf8')
    const normalizedMain = main.replace(/\r\n/g, '\n')
    const browserWindow = main.match(/new BrowserWindow\(\{[\s\S]*?\n  \}\)/)?.[0]
    const resolveDefaultSession = main.indexOf('const defaultSession = session.defaultSession')
    const clearSessionSpellCheckerLanguages = main.indexOf(
      'defaultSession.setSpellCheckerLanguages([])',
    )
    const disableSessionSpellChecker = main.indexOf('defaultSession.setSpellCheckerEnabled(false)')
    const createFirstWindow = main.indexOf('createWindow()', main.indexOf('app.whenReady().then'))

    expect(browserWindow).toBeDefined()
    expect(browserWindow).toContain('spellcheck: false')
    expect(main).toMatch(/import \{[\s\S]*?session[\s\S]*?\} from 'electron'/)
    expect(normalizedMain).toMatch(
      /app\.whenReady\(\)\.then\(\(\) => \{\n\s+const defaultSession = session\.defaultSession\n\s+defaultSession\.setSpellCheckerLanguages\(\[\]\)\n\s+defaultSession\.setSpellCheckerEnabled\(false\)\n\s+registerIpcHandlers\(\)\n\s+createWindow\(\)/,
    )
    expect(resolveDefaultSession).toBeGreaterThan(-1)
    expect(clearSessionSpellCheckerLanguages).toBeGreaterThan(resolveDefaultSession)
    expect(disableSessionSpellChecker).toBeGreaterThan(clearSessionSpellCheckerLanguages)
    expect(disableSessionSpellChecker).toBeLessThan(createFirstWindow)
  })
})
