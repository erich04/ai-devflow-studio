import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const smoke = readFileSync('scripts/native-coding-electron-smoke.mjs', 'utf8')

describe('Native Coding Electron smoke contract', () => {
  it('uses the real preload/Main boundary and a local OpenAI-compatible server', () => {
    expect(smoke).toContain("import { _electron as electron, expect } from '@playwright/test'")
    expect(smoke).toContain("request.url !== '/v1/chat/completions'")
    expect(smoke).toContain('window.aiDevFlowDesktop.saveCodingRuntimeConfiguration')
    expect(smoke).toContain('window.aiDevFlowDesktop.getCodingRuntimeReadiness')
    expect(smoke).toContain('window.aiDevFlowDesktop.getCodingChangeSetPreview')
    expect(smoke).toContain('window.aiDevFlowDesktop.runCodingAgent')
    expect(smoke).toContain('window.aiDevFlowDesktop.replyCodingPermission')
    expect(smoke).not.toContain('window.aiDevFlowDesktop =')
    expect(smoke).not.toContain("providerId: 'fake-coding-engine'")
    expect(smoke).not.toContain("DEVFLOW_CODING_ENGINE: 'fake'")
  })

  it('proves exact approval, managed-worktree-only writes, tests, evidence, trace, and cost', () => {
    expect(smoke).toContain("engine: 'native'")
    expect(smoke).toContain('changeSetDigest')
    expect(smoke).toContain("decision: 'approved'")
    expect(smoke).toContain("runtimeCostSummary: { source: 'provider_reported' }")
    expect(smoke).toContain("workspace.worktreePath, 'src/message.js'")
    expect(smoke).toContain("repositoryPath, 'src/message.js'")
    expect(smoke).toContain('completedState.testEvidence')
    expect(smoke).toContain('completedState.codingDiffArtifacts')
    expect(smoke).toContain('completedState.codingEvents')
    expect(smoke).toContain('expect(modelRequests).toHaveLength(2)')
  })
})
