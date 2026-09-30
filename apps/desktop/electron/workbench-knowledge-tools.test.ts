import { describe, expect, it } from 'vitest'
import { indexKnowledgeSources, type RepositoryKnowledgeSnapshot } from '@ai-devflow/shared'
import { listWorkbenchKnowledge, readWorkbenchKnowledge } from './workbench-knowledge-tools'

const updatedAt = '2026-09-30T00:00:00.000Z'

function snapshot(overrides: Partial<RepositoryKnowledgeSnapshot> = {}): RepositoryKnowledgeSnapshot {
  const index = indexKnowledgeSources([
    { sourcePath: 'docs/knowledge/testing.md', markdown: '---\ntitle: Testing\ncategory: testing_standard\nstages: [design, test]\ngate: [test]\nsummary: Test evidence rules.\n---\n# Testing\nEvidence must include the command. API_TOKEN=knowledge-secret-value', updatedAt },
    { sourcePath: 'docs/knowledge/adr.md', markdown: '---\ntitle: Decisions\ncategory: adr\n---\n# Decisions\nRecord trade-offs.', updatedAt },
  ])
  return {
    projectId: 'project-1',
    contentHash: 'sha256:snapshot',
    documents: index.documents.map((document) => ({ ...document, contentDigest: `sha256:${document.sourcePath.length.toString(16).padStart(64, '0')}` })),
    chunks: index.chunks,
    entities: [],
    relations: [],
    indexedAt: updatedAt,
    truncated: false,
    warnings: [],
    knowledgeRoot: 'docs/knowledge',
    projectInstructions: { sourcePath: 'AGENTS.md', content: '# Rules\nUse corepack pnpm.', bytes: 25, contentDigest: `sha256:${'a'.repeat(64)}`, truncated: false },
    ...overrides,
  }
}

describe('discussion knowledge tools (knowledge-context K3)', () => {
  it('lists the directory with stages, Gate stages and the project instructions file', () => {
    const listed = listWorkbenchKnowledge(snapshot(), {})

    expect(listed).toMatchObject({
      knowledgeRoot: 'docs/knowledge',
      totalDocuments: 2,
      nextOffset: null,
      projectInstructions: { path: 'AGENTS.md', bytes: 25, truncated: false, readWith: 'knowledge_read' },
      note: expect.stringContaining('不代表已满足 Gate'),
    })
    expect(listed.documents).toEqual([
      expect.objectContaining({ path: 'docs/knowledge/adr.md', stages: ['design', 'accept'], stagesDeclared: false, gateStages: [] }),
      expect.objectContaining({ path: 'docs/knowledge/testing.md', summary: 'Test evidence rules.', stages: ['design', 'test'], stagesDeclared: true, gateStages: ['test'] }),
    ])
    // Bodies are read with knowledge_read, not returned by the list.
    expect(JSON.stringify(listed)).not.toContain('Evidence must include')
  })

  it('filters by stage and pages the catalogue', () => {
    expect(listWorkbenchKnowledge(snapshot(), { stage: 'TEST' }).documents.map((document) => document.path)).toEqual(['docs/knowledge/testing.md'])
    expect(listWorkbenchKnowledge(snapshot(), { stage: 'build' }).documents).toEqual([])
    expect(listWorkbenchKnowledge(snapshot(), { offset: 1 })).toMatchObject({ offset: 1, nextOffset: null, documents: [expect.objectContaining({ path: 'docs/knowledge/testing.md' })] })
    expect(() => listWorkbenchKnowledge(snapshot(), { stage: 'deploy' })).toThrow('阶段取值无效')
    expect(() => listWorkbenchKnowledge(snapshot(), { offset: -1 })).toThrow('分页位置无效')
  })

  it('reads one document or the project instructions by path, redacted and paged', () => {
    const document = readWorkbenchKnowledge(snapshot(), { path: './docs/knowledge/testing.md' })
    expect(document).toMatchObject({ path: 'docs/knowledge/testing.md', kind: 'knowledge_document', gateStages: ['test'], truncated: false })
    expect(document.content).toContain('Evidence must include the command.')
    expect(document.content).not.toContain('knowledge-secret-value')

    const firstPage = readWorkbenchKnowledge(snapshot(), { path: 'docs/knowledge/testing.md', limit: 10 })
    expect(firstPage).toMatchObject({ offset: 0, endOffset: 10, truncated: true, nextOffset: 10 })

    expect(readWorkbenchKnowledge(snapshot(), { path: 'AGENTS.md' })).toMatchObject({ kind: 'project_instructions', content: '# Rules\nUse corepack pnpm.' })
  })

  it('refuses paths outside the knowledge directory and unreadable instructions with a way forward', () => {
    expect(() => readWorkbenchKnowledge(snapshot(), { path: 'src/index.ts' })).toThrow('用 repo_read 读取仓库中的其他文件')
    expect(() => readWorkbenchKnowledge(snapshot(), {})).toThrow('请提供 knowledge_list 返回的文档路径')
    const tooLarge = snapshot({ projectInstructions: { sourcePath: 'AGENTS.md', content: '', bytes: 300_000, contentDigest: 'unavailable', truncated: true } })
    expect(() => readWorkbenchKnowledge(tooLarge, { path: 'AGENTS.md' })).toThrow('过大或无法读取')
    expect(listWorkbenchKnowledge(snapshot({ projectInstructions: null }), {}).projectInstructions).toBeNull()
  })
})
