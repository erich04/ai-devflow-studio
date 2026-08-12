import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Desktop pilot launch smoke contract', () => {
  const smoke = readFileSync('scripts/desktop-pilot-smoke.mjs', 'utf8')

  it('launches the packaged executable with isolated user data', () => {
    expect(smoke).toContain("import { _electron as electron } from '@playwright/test'")
    expect(smoke).toContain("'artifact-index.json'")
    expect(smoke).toContain('executablePath')
    expect(smoke).toContain('DEVFLOW_USER_DATA_DIR: userDataDirectory')
    expect(smoke).toContain('await electronApp.close()')
  })

  it('proves a packaged launch cannot navigate to VITE_DEV_SERVER_URL', () => {
    expect(smoke).toContain('hostileDevelopmentServerRequests')
    expect(smoke).toContain('VITE_DEV_SERVER_URL: hostileDevelopmentServerUrl')
    expect(smoke).toContain("loadedUrl.startsWith('file://')")
    expect(smoke).toContain('hostileDevelopmentServerRequests !== 0')
  })

  it('completes and reopens one durable Native Tool Agent Runtime', () => {
    expect(smoke).toContain('startAgentRuntime')
    expect(smoke).toContain('advanceAgentRuntime')
    expect(smoke).toContain('listAgentRuntimes')
    expect(smoke).toContain("stopReason !== 'success'")
    expect(smoke).toContain('runtimeAfterRestart')
    expect(smoke).toContain('acceptedActionIds.length !== 1')
    expect(smoke).toContain('agent_runtime_tool_audits')
    expect(smoke).toContain("nativeToolAudit?.[0] !== 'scenario.evaluate'")
    expect(smoke).toContain('schemaVersion !== 19')
  })
})
