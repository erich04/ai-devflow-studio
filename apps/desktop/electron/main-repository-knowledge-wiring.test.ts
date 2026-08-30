import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Electron repository knowledge wiring', () => {
  const main = readFileSync('apps/desktop/electron/main.ts', 'utf8')

  it('resolves repository knowledge from the trusted local project store', () => {
    expect(main).toContain('createRepositoryKnowledgeCache')
    expect(main).toContain('createRepositoryKnowledgeService')
    expect(main).toMatch(
      /createRepositoryKnowledgeResolver\(\{[\s\S]*?getStore,[\s\S]*?cache: repositoryKnowledgeCache/,
    )
    expect(main).toMatch(
      /async function loadTrustedRepositoryKnowledge[\s\S]*?repositoryKnowledgeResolver\.loadProject\(projectId, options\)/,
    )
  })

  it('injects one captured snapshot into gate evaluation', () => {
    expect(main).toMatch(
      /async function evaluateLocalGateEnforcement[\s\S]*?knowledgeSnapshot[\s\S]*?documents: knowledgeSnapshot\.documents[\s\S]*?chunks: knowledgeSnapshot\.chunks[\s\S]*?documents: knowledgeSnapshot\.documents[\s\S]*?chunks: knowledgeSnapshot\.chunks/,
    )
  })

  it('injects canonical run knowledge into review and coding executions', () => {
    expect(main).toMatch(
      /ipcMain\.handle\(ipcChannels\.runCodingAgent[\s\S]*?loadTrustedRunKnowledge[\s\S]*?createCodingRuntimeForRequest\(knowledgeSnapshot, input\.projectId\)/,
    )
    expect(main).toMatch(
      /ipcMain\.handle\(ipcChannels\.runKnowledgeReview[\s\S]*?loadTrustedRunKnowledge[\s\S]*?createKnowledgeReviewRuntimeForRequest\(knowledgeSnapshot\)/,
    )
  })

  it('uses the same captured snapshot for retry remediation and coding', () => {
    expect(main).toMatch(
      /ipcMain\.handle\(ipcChannels\.startRetryAttempt[\s\S]*?loadTrustedRunKnowledge[\s\S]*?createCodingRuntimeForRequest\(knowledgeSnapshot, input\.projectId\)[\s\S]*?evaluateLocalGateEnforcement\([\s\S]*?knowledgeSnapshot/,
    )
  })

  it('exposes only identifier-based load and refresh IPC handlers', () => {
    expect(main).toMatch(
      /ipcMain\.handle\(ipcChannels\.loadRepositoryKnowledge[\s\S]*?parseLoadRepositoryKnowledgeInput\(payload\)[\s\S]*?loadTrustedRepositoryKnowledge\(input\.projectId\)/,
    )
    expect(main).toMatch(
      /ipcMain\.handle\(ipcChannels\.refreshRepositoryKnowledge[\s\S]*?parseRefreshRepositoryKnowledgeInput\(payload\)[\s\S]*?refresh: true/,
    )
  })
})
