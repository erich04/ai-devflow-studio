import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Electron durable remote sync wiring', () => {
  const main = readFileSync('apps/desktop/electron/main.ts', 'utf8')

  it('starts the durable scheduler only after Electron is ready', () => {
    expect(main).toContain('remoteSyncOutboxSchedulerPromise ??=')
    expect(main).toContain('.then((scheduler) => scheduler.start())')
    expect(main.indexOf('.then((scheduler) => scheduler.start())')).toBeGreaterThan(
      main.indexOf('app.whenReady()'),
    )
  })

  it('stops the scheduler before the application quits', () => {
    expect(main).toContain("app.on('before-quit'")
    expect(main).toContain('remoteSyncOutboxScheduler?.stop()')
    expect(main).toMatch(
      /app\.on\('before-quit', \(event\) => \{[\s\S]*?event\.preventDefault\(\)[\s\S]*?stopOpencodeWithRetry\(opencodeProcessManager\)[\s\S]*?quitCleanupComplete = true[\s\S]*?app\.quit\(\)/,
    )
  })

  it('shares one governed executor, coding engine, and process manager across IPC requests and shutdown', () => {
    expect(main).toMatch(
      /const opencodeProcessManager = createOpencodeProcessManager\(\)[\s\S]*?const codingEngineAdapter = createCodingEngineAdapterFromEnv\(process\.env, \{[\s\S]*?processManager: opencodeProcessManager[\s\S]*?\}\)/,
    )
    expect(main).toMatch(
      /const codingExecutor = createCodingExecutorCompatibilityAdapter\(codingEngineAdapter\)[\s\S]*?async function createCodingRuntimeForRequest[\s\S]*?return createCodingRuntime\(\{[\s\S]*?executor: codingExecutor/,
    )
    expect(main).toMatch(
      /app\.on\('before-quit'[\s\S]*?stopOpencodeWithRetry\(opencodeProcessManager\)/,
    )
  })

  it('wakes delivery after canonical review and coding state changes', () => {
    expect(main).toMatch(/publishRunStatus: \(run\) => \{[\s\S]*?wakeRemoteSyncOutbox\(\)/)
    expect(main).toMatch(
      /ipcMain\.handle\(ipcChannels\.runKnowledgeReview[\s\S]*?wakeRemoteSyncOutbox\(\)/,
    )
  })
})
