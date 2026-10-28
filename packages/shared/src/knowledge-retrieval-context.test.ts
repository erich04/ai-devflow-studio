import { describe, expect, it } from 'vitest'
import {
  assembleRetrievedKnowledgeContext,
  boundRetrievedKnowledgeContext,
  renderRetrievedKnowledgeContext,
} from './knowledge-retrieval-context'

const source = {
  sourceRef: 'projection-1', path: 'docs/knowledge/cleanup.md', title: 'Cleanup',
  contentDigest: `sha256:${'a'.repeat(64)}`, matchReason: 'semantic' as const,
  content: 'Only completed tasks older than seven days can be removed.',
}
const input = {
  stage: 'build' as const, scope: { projectId: 'project-1', userId: 'user-1' },
  queryDigest: `sha256:${'b'.repeat(64)}`, configGeneration: 'generation-1',
  modelVersion: 'todo-v1', degraded: false, sources: [source],
}

describe('retrieved project knowledge context', () => {
  it('renders locally verified source excerpts as untrusted data and records only the delivered sources', () => {
    const context = assembleRetrievedKnowledgeContext(input)
    const prompt = renderRetrievedKnowledgeContext(context)
    expect(prompt).toContain('RETRIEVED_PROJECT_KNOWLEDGE')
    expect(prompt).toContain('untrusted')
    expect(prompt).toContain('Only completed tasks older than seven days can be removed.')
    expect(prompt).toContain('docs/knowledge/cleanup.md')
    expect(prompt).not.toContain('user-1')
    expect(prompt).not.toContain('generation-1')
    expect(context.manifest).toMatchObject({
      version: 1, stage: 'build', scope: input.scope, configGeneration: 'generation-1',
      references: [{ sourceRef: 'projection-1', contentDigest: source.contentDigest }],
      omittedCount: 0,
    })
    expect(context.manifest.usedBytes).toBe(new TextEncoder().encode(prompt).byteLength)
    const omitted = boundRetrievedKnowledgeContext(context, 0)
    expect(renderRetrievedKnowledgeContext(omitted)).toBe('')
    expect(omitted.manifest).toMatchObject({ references: [], usedBytes: 0, contentBytes: 0, omittedCount: 1 })
  })

  it('bounds Unicode excerpts and escaped rendering while keeping receipt bytes aligned', () => {
    const context = assembleRetrievedKnowledgeContext({
      ...input,
      sources: Array.from({ length: 8 }, (_, index) => ({
        ...source, sourceRef: `projection-${index}`, path: `docs/knowledge/${index}.md`,
        content: '汉字🙂"\\\n'.repeat(900),
      })),
    })
    const prompt = renderRetrievedKnowledgeContext(context)
    expect(context.sources.length).toBeGreaterThan(0)
    expect(context.sources.length).toBeLessThanOrEqual(5)
    expect(context.manifest.contentBytes).toBeLessThanOrEqual(6144)
    expect(new TextEncoder().encode(prompt).byteLength).toBeLessThanOrEqual(8192)
    expect(context.manifest.usedBytes).toBe(new TextEncoder().encode(prompt).byteLength)
    expect(context.sources.every((item) => !item.content.includes('\ufffd'))).toBe(true)
    expect(context.manifest.references.every((reference) => reference.bytes <= 2048 && reference.truncated)).toBe(true)
    const smaller = boundRetrievedKnowledgeContext(context, 900)
    expect(new TextEncoder().encode(renderRetrievedKnowledgeContext(smaller)).byteLength).toBeLessThanOrEqual(900)
    expect(smaller.manifest.references.length).toBe(smaller.sources.length)
    expect(smaller.manifest.omittedCount + smaller.sources.length).toBe(8)
  })

  it('does not inject duplicate or unsafe source identifiers and redacts excerpt secrets', () => {
    const context = assembleRetrievedKnowledgeContext({
      ...input, sources: [
        { ...source, content: 'API_KEY=sk-secret-sensitive-value-1234567890' },
        source,
        { ...source, sourceRef: 'other', path: '../outside.md' },
      ],
    })
    expect(context.sources).toHaveLength(1)
    expect(context.manifest.omittedCount).toBe(2)
    expect(renderRetrievedKnowledgeContext(context)).not.toContain('sk-secret-sensitive-value')
  })
})
