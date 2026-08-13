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

  it('completes and reopens one durable Local MCP Tool Agent Runtime', () => {
    expect(smoke).toContain("DEVFLOW_ENABLE_LOCAL_MCP_FIXTURE: 'true'")
    expect(smoke).toContain('startAgentRuntime')
    expect(smoke).toContain('advanceAgentRuntime')
    expect(smoke).toContain('listAgentRuntimes')
    expect(smoke).toContain("stopReason !== 'success'")
    expect(smoke).toContain('runtimeAfterRestart')
    expect(smoke).toContain('acceptedActionCount !== 1')
    expect(smoke).toContain('agent_runtime_tool_audits')
    expect(smoke).toContain('local_mcp_installations')
    expect(smoke).toContain("source !== 'mcp'")
    expect(smoke).toContain('installation_id')
    expect(smoke).toContain('installation_version')
    expect(smoke).toContain("toolId !== 'scenario.evaluate'")
    expect(smoke).toContain('schemaVersion !== 26')
    expect(smoke).toMatch(
      /startAgentRuntime\(\{\s*runId: run\.id,\s*nodeId: run\.currentNodeId,\s*localProjectId: project\.id,\s*\}\)/,
    )
    expect(smoke).toContain('expectedVersion: snapshot.runtime.version')
    expect(smoke).toContain('expectedCheckpointVersion: snapshot.runtime.checkpointVersion')
    expect(smoke).toContain('runtimeId: snapshot.runtime.runtimeId')
    expect(smoke).toMatch(
      /listAgentRuntimes\(\{\s*runId: run\.id,\s*localProjectId: project\.id,\s*\}\)/,
    )
    expect(smoke).not.toContain('.runtime.acceptedActionIds')
  })

  it('completes and reopens one bounded Native Coding run without repeated Tool effects', () => {
    expect(smoke).toContain("DEVFLOW_CODING_EXECUTOR: 'native-deterministic'")
    expect(smoke).toContain('runCodingAgent')
    expect(smoke).toContain('replyCodingPermission')
    expect(smoke).toContain('nativeCodingAfterRestart')
    expect(smoke).toContain("'devflow-native-change.txt'")
    expect(smoke).toContain("'workspace.write_text'")
    expect(smoke).toContain("'workspace.run_saved_test'")
    expect(smoke).toContain('nativeCodingRestartDuplicateEffects')
  })

  it('promotes, revises, deletes, and reopens one exact Agent Memory without repeated effects', () => {
    expect(smoke).toContain('listAgentMemoryLifecycle')
    expect(smoke).toContain('promoteAgentMemoryCandidate')
    expect(smoke).toContain('reviseAgentMemory')
    expect(smoke).toContain('deleteAgentMemory')
    expect(smoke).toContain('memoryAfterRestart')
    expect(smoke).toContain('agent_memory_candidates')
    expect(smoke).toContain('agent_memory_revisions')
    expect(smoke).toContain('agent_memory_tombstones')
    expect(smoke).toContain('memoryRestartDuplicateEffects')
  })
})
