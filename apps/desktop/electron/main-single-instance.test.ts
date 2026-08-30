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

  it('resolves and opens the selected profile before any renderer or scheduler can mutate it', () => {
    const main = readFileSync('apps/desktop/electron/main.ts', 'utf8')
    const resolveProfile = main.indexOf('const dataProfileResolution = resolveDesktopDataProfile')
    const processLock = main.indexOf('app.requestSingleInstanceLock()')
    const blockSelection = main.indexOf("if (dataProfileResolution.status === 'blocked')")
    const openStore = main.indexOf('await getStore()', blockSelection)
    const registerHandlers = main.indexOf('registerIpcHandlers()', openStore)
    const createFirstWindow = main.indexOf('createWindow()', registerHandlers)

    expect(resolveProfile).toBeGreaterThanOrEqual(0)
    expect(resolveProfile).toBeLessThan(processLock)
    expect(blockSelection).toBeGreaterThan(processLock)
    expect(openStore).toBeGreaterThan(blockSelection)
    expect(openStore).toBeLessThan(registerHandlers)
    expect(registerHandlers).toBeLessThan(createFirstWindow)
  })

  it('quits on a profile-selection conflict before workflow handlers or Team schedulers start', () => {
    const main = readFileSync('apps/desktop/electron/main.ts', 'utf8')
    const ready = main.slice(main.indexOf('app.whenReady().then'))
    const blockedSelection = ready.indexOf("if (dataProfileResolution.status === 'blocked')")
    const blockedReturn = ready.indexOf('return', blockedSelection)
    const openStore = ready.indexOf('await getStore()', blockedReturn)
    const registerHandlers = ready.indexOf('registerIpcHandlers()', openStore)
    const remoteSyncScheduler = ready.indexOf('getRemoteSyncOutboxScheduler()', registerHandlers)
    const gateScheduler = ready.indexOf('getGateCommandScheduler()', registerHandlers)

    expect(ready.slice(blockedSelection, blockedReturn)).toContain('app.quit()')
    expect(blockedSelection).toBeGreaterThanOrEqual(0)
    expect(blockedReturn).toBeGreaterThan(blockedSelection)
    expect(openStore).toBeGreaterThan(blockedReturn)
    expect(registerHandlers).toBeGreaterThan(openStore)
    expect(remoteSyncScheduler).toBeGreaterThan(registerHandlers)
    expect(gateScheduler).toBeGreaterThan(registerHandlers)
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
      /app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*?await getStore\(\)[\s\S]*?const defaultSession = session\.defaultSession\n\s+defaultSession\.setSpellCheckerLanguages\(\[\]\)\n\s+defaultSession\.setSpellCheckerEnabled\(false\)\n\s+registerIpcHandlers\(\)\n\s+createWindow\(\)/,
    )
    expect(resolveDefaultSession).toBeGreaterThan(-1)
    expect(clearSessionSpellCheckerLanguages).toBeGreaterThan(resolveDefaultSession)
    expect(disableSessionSpellChecker).toBeGreaterThan(clearSessionSpellCheckerLanguages)
    expect(disableSessionSpellChecker).toBeLessThan(createFirstWindow)
  })

  it('keeps the native Electron window explicitly resizable', () => {
    const main = readFileSync('apps/desktop/electron/main.ts', 'utf8')
    const browserWindow = main.match(/new BrowserWindow\(\{[\s\S]*?\n  \}\)/)?.[0]

    expect(browserWindow).toBeDefined()
    expect(browserWindow).toContain('resizable: true')
    expect(browserWindow).toContain('minWidth: 1180')
    expect(browserWindow).toContain('minHeight: 760')
  })
})
