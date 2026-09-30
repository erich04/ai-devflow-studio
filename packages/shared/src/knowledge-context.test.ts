import { describe, expect, it } from 'vitest'
import type { KnowledgeDocument, ProjectInstructionsSnapshot } from './domain'
import { indexKnowledgeSources } from './knowledge'
import {
  assembleKnowledgeStageContext,
  describeKnowledgeContextManifest,
  knowledgeDocumentBody,
  normalizeKnowledgeStages,
  resolveKnowledgeDocumentStages,
  truncateUtf8,
} from './knowledge-context'

const updatedAt = '2026-09-29T00:00:00.000Z'

function index(sources: Record<string, string>): KnowledgeDocument[] {
  return indexKnowledgeSources(Object.entries(sources).map(([sourcePath, markdown]) => ({ sourcePath, markdown, updatedAt }))).documents
}

const instructions: ProjectInstructionsSnapshot = {
  sourcePath: 'AGENTS.md',
  content: '# Repo rules\nUse corepack pnpm.',
  bytes: 32,
  contentDigest: `sha256:${'a'.repeat(64)}`,
  truncated: false,
}

describe('knowledge front matter stages and gate (ADR 0025)', () => {
  it('parses inline lists, block lists, booleans and inline comments', () => {
    const [inline, block, gateTrue, comment] = index({
      'docs/knowledge/a.md': '---\ntitle: A\ncategory: testing_standard\nstages: [test, pr]\ngate: [test]\n---\n# A\nBody',
      'docs/knowledge/b.md': '---\ntitle: B\ncategory: adr\nstages:\n  - design\n  - accept\ngate: true\n---\n# B',
      'docs/knowledge/c.md': '---\ntitle: C\ncategory: api_contract\ngate: true\n---\n# C',
      'docs/knowledge/d.md': '---\ntitle: D\nstages: [clarify]   # only clarify\ngate: false\ntags: [x, "y"]\n---\n# D',
    })
    expect(inline).toMatchObject({ stages: ['test', 'pr'], gateStages: ['test'] })
    expect(block).toMatchObject({ stages: ['design', 'accept'], gateStages: ['design', 'accept'] })
    // gate: true without stages uses the category default stages.
    expect(gateTrue!.stages).toBeUndefined()
    expect(gateTrue!.gateStages).toEqual(['design'])
    expect(comment).toMatchObject({ stages: ['clarify'], gateStages: [], tags: ['x', 'y'] })
  })

  it('keeps comma separated tags and ignores unknown stage values', () => {
    const [document] = index({
      'docs/knowledge/e.md': '---\ntitle: E\ncategory: review_checklist\ntags: gate, approval\nstages: [pr, deploy, PR]\n---\n# E',
    })
    expect(document).toMatchObject({ tags: ['gate', 'approval'], stages: ['pr'], gateStages: [] })
  })

  it('treats an explicit empty stage list as catalogue only and falls back to category defaults when absent', () => {
    const [empty, defaulted] = index({
      'docs/knowledge/f.md': '---\ntitle: F\nstages: []\n---\n# F',
      'docs/knowledge/g.md': '---\ntitle: G\ncategory: testing_standard\n---\n# G',
    })
    expect(resolveKnowledgeDocumentStages(empty!)).toEqual([])
    expect(resolveKnowledgeDocumentStages(defaulted!)).toEqual(['design', 'test'])
    expect(normalizeKnowledgeStages(['accept', 'clarify', 'accept', 'x'])).toEqual(['clarify', 'accept'])
  })
})

describe('assembleKnowledgeStageContext', () => {
  const documents = index({
    'docs/knowledge/z-background.md': '---\ntitle: Background\nstages: [design]\n---\n<a id="bg"></a>\n# Background\nBackground body.',
    'docs/knowledge/a-gate.md': '---\ntitle: Gate rule\nstages: [design]\ngate: true\n---\n# Gate rule\nGate body.',
    'docs/knowledge/other.md': '---\ntitle: Other stage\nstages: [pr]\nsummary: PR only.\n---\n# Other\nOther body.',
  })

  it('includes applicable documents in full with Gate criteria first and lists the rest', () => {
    const context = assembleKnowledgeStageContext({
      stage: 'design', documents, knowledgeRoot: 'docs/knowledge', projectInstructions: instructions,
      injectInstructions: true, canReadFiles: false,
    })
    expect(context.manifest.included.map((entry) => [entry.sourcePath, entry.gate])).toEqual([
      ['docs/knowledge/a-gate.md', true],
      ['docs/knowledge/z-background.md', false],
    ])
    expect(context.manifest.catalogued).toEqual([
      expect.objectContaining({ sourcePath: 'docs/knowledge/other.md', reason: 'other_stage' }),
    ])
    expect(context.knowledgeSection).toContain('### Gate rule — docs/knowledge/a-gate.md [Gate criteria]')
    expect(context.knowledgeSection).toContain('Background body.')
    expect(context.knowledgeSection).not.toContain('<a id=')
    expect(context.knowledgeSection).not.toContain('Other body.')
    expect(context.knowledgeSection).toContain('not readable by this executor')
    expect(context.instructionsSection).toContain('PROJECT_INSTRUCTIONS (AGENTS.md')
    expect(context.instructionsSection).toContain('Use corepack pnpm.')
    expect(context.manifest.instructions).toMatchObject({ sourcePath: 'AGENTS.md', loadedBy: 'devflow' })
  })

  it('is deterministic for the same inputs regardless of document order', () => {
    const input = { stage: 'design' as const, knowledgeRoot: 'docs/knowledge', projectInstructions: instructions, injectInstructions: true, canReadFiles: true }
    const first = assembleKnowledgeStageContext({ ...input, documents })
    const second = assembleKnowledgeStageContext({ ...input, documents: [...documents].reverse() })
    expect(second).toEqual(first)
    expect(describeKnowledgeContextManifest(first.manifest)).toContain('included=2')
  })

  it('does not inject instructions the executor loads itself but still records them', () => {
    const context = assembleKnowledgeStageContext({
      stage: 'design', documents, projectInstructions: instructions, injectInstructions: false, canReadFiles: true,
    })
    expect(context.instructionsSection).toBe('')
    expect(context.manifest.instructions).toMatchObject({ loadedBy: 'executor', contentDigest: instructions.contentDigest })
    expect(context.knowledgeSection).toContain('read the file when it is relevant')
  })

  it('moves documents that exceed the budget into the catalogue and caps the catalogue', () => {
    const large = index({
      'docs/knowledge/a.md': `---\ntitle: Large\nstages: [test]\nsummary: Large doc.\n---\n# Large\n${'x'.repeat(2_000)}`,
      'docs/knowledge/b.md': '---\ntitle: Small\nstages: [test]\n---\n# Small\nsmall',
      'docs/knowledge/c.md': '---\ntitle: C\nstages: [pr]\n---\n# C',
      'docs/knowledge/d.md': '---\ntitle: D\nstages: [pr]\n---\n# D',
    })
    const context = assembleKnowledgeStageContext({
      stage: 'test', documents: large, injectInstructions: true, canReadFiles: false, budgetBytes: 500, catalogLimit: 2,
    })
    expect(context.manifest.included.map((entry) => entry.sourcePath)).toEqual(['docs/knowledge/b.md'])
    expect(context.manifest.catalogued).toEqual([
      expect.objectContaining({ sourcePath: 'docs/knowledge/a.md', reason: 'budget' }),
      expect.objectContaining({ sourcePath: 'docs/knowledge/c.md', reason: 'other_stage' }),
    ])
    expect(context.manifest.omittedCount).toBe(1)
    expect(context.manifest.usedBytes).toBeLessThanOrEqual(500)
    expect(context.knowledgeSection).toContain('not loaded because of the context budget')
    expect(context.knowledgeSection).toContain('1 more document(s) omitted.')
  })

  it('returns empty sections when there is no knowledge and no instruction file', () => {
    const context = assembleKnowledgeStageContext({ stage: 'clarify', documents: [], injectInstructions: true, canReadFiles: false })
    expect(context).toMatchObject({ instructionsSection: '', knowledgeSection: '' })
    expect(context.manifest).toMatchObject({ included: [], catalogued: [], instructions: null, usedBytes: 0 })
  })
})

describe('knowledge context helpers', () => {
  it('truncates UTF-8 without splitting characters', () => {
    expect(truncateUtf8('知识目录', 7)).toEqual({ value: '知识', truncated: true })
    expect(truncateUtf8('abc', 3)).toEqual({ value: 'abc', truncated: false })
  })

  it('strips front matter and anchors from the rendered body', () => {
    expect(knowledgeDocumentBody('---\ntitle: T\n---\n<a id="t"></a>\n# T\nBody')).toBe('# T\nBody')
  })
})
