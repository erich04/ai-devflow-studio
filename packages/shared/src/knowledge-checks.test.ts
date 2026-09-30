import { describe, expect, it } from 'vitest'
import type { KnowledgeContextManifest, KnowledgeDocument, ProjectInstructionsSnapshot } from './domain'
import { indexKnowledgeSources } from './knowledge'
import {
  checkKnowledgeDirectory,
  collectKnowledgeLinkTargetPaths,
  extractMarkdownAnchors,
  extractMarkdownLinks,
  resolveKnowledgeLink,
} from './knowledge-checks'
import { summarizeKnowledgeStageBudgets } from './knowledge-context'

const updatedAt = '2026-09-30T00:00:00.000Z'

function index(sources: Record<string, string>): KnowledgeDocument[] {
  return indexKnowledgeSources(Object.entries(sources).map(([sourcePath, markdown]) => ({ sourcePath, markdown, updatedAt }))).documents
}

const frontMatter = (extra = '') => `---\ntitle: Doc\ncategory: development_standard\nstages: [build]\n${extra}---\n`

function manifest(overrides: Partial<KnowledgeContextManifest> = {}): KnowledgeContextManifest {
  return {
    version: 1,
    stage: 'build',
    knowledgeRoot: 'docs/knowledge',
    budgetBytes: 24 * 1024,
    usedBytes: 10,
    instructions: null,
    included: [],
    catalogued: [],
    omittedCount: 0,
    ...overrides,
  }
}

describe('Markdown links and anchors', () => {
  it('reads inline links, images and reference definitions outside code', () => {
    const markdown = [
      '---',
      'title: "[not](a-link.md)"',
      '---',
      '# Title',
      'See [guide](../guide.md#setup) and ![diagram](./img/flow.png "Flow").',
      'Inline `[code](ignored.md)` is not a link.',
      '```',
      '[fenced](ignored-too.md)',
      '```',
      '[ref]: <other file.md>',
    ].join('\n')

    expect(extractMarkdownLinks(markdown)).toEqual([
      { line: 5, target: '../guide.md#setup' },
      { line: 5, target: './img/flow.png' },
      { line: 10, target: 'other file.md' },
    ])
  })

  it('derives GitHub-style heading slugs, numbers duplicates and keeps explicit anchors', () => {
    const markdown = [
      '<a id="local-test-evidence-standard"></a>',
      '# 本地测试证据规范',
      '## Setup & Run (v2)',
      '## Setup & Run (v2)',
      '## [Linked](x.md) heading ##',
      '```',
      '# not a heading',
      '```',
    ].join('\n')

    expect(extractMarkdownAnchors(markdown)).toEqual([
      'linked-heading',
      'local-test-evidence-standard',
      'setup--run-v2',
      'setup--run-v2-1',
      '本地测试证据规范',
    ])
  })

  it('resolves links relative to the document or the repository root', () => {
    expect(resolveKnowledgeLink('docs/knowledge/a.md', '../guide.md#Setup')).toEqual({ kind: 'repository', path: 'docs/guide.md', anchor: 'Setup' })
    expect(resolveKnowledgeLink('docs/knowledge/a.md', '/README.md')).toEqual({ kind: 'repository', path: 'README.md' })
    expect(resolveKnowledgeLink('docs/knowledge/a.md', '%E6%96%87%E6%A1%A3.md')).toEqual({ kind: 'repository', path: 'docs/knowledge/文档.md' })
    expect(resolveKnowledgeLink('docs/knowledge/a.md', '#%E7%AB%A0')).toEqual({ kind: 'same_document', anchor: '章' })
    expect(resolveKnowledgeLink('docs/knowledge/a.md', '../../../outside.md')).toEqual({ kind: 'outside_repository' })
    for (const external of ['https://example.com/a.md', 'mailto:someone@example.com', '//cdn.example.com/x', '#']) {
      expect(resolveKnowledgeLink('docs/knowledge/a.md', external)).toEqual({ kind: 'external' })
    }
  })

  it('collects linked repository paths that are not indexed documents', () => {
    const documents = index({
      'docs/knowledge/a.md': `${frontMatter()}[b](b.md) [adr](../adr/0001.md#context) [web](https://example.com) [same](#top)`,
      'docs/knowledge/b.md': `${frontMatter()}[a](./a.md) [adr](../adr/0001.md)`,
    })
    expect(collectKnowledgeLinkTargetPaths(documents)).toEqual(['docs/adr/0001.md'])
  })
})

describe('checkKnowledgeDirectory', () => {
  it('reports missing front matter and stage values that are not workflow stages', () => {
    const report = checkKnowledgeDirectory({
      documents: index({
        'docs/knowledge/no-front-matter.md': '# Plain',
        'docs/knowledge/unclosed.md': '---\ntitle: Unclosed\n# Body',
        'docs/knowledge/bad-stages.md': '---\ntitle: Bad\nstages: [build, deploy, Test]\ngate: [review]\n---\n# Bad',
        'docs/knowledge/boolean-stages.md': '---\ntitle: Bool\nstages: true\ngate: false\n---\n# Bool',
        'docs/knowledge/good.md': '---\ntitle: Good\nstages:\n  - design\n  - test\ngate: true\n---\n# Good',
      }),
    })

    expect(report.findings).toEqual([
      { code: 'missing_front_matter', sourcePath: 'docs/knowledge/no-front-matter.md', reason: 'missing' },
      { code: 'missing_front_matter', sourcePath: 'docs/knowledge/unclosed.md', reason: 'unclosed' },
      { code: 'invalid_stage_value', sourcePath: 'docs/knowledge/bad-stages.md', field: 'stages', values: ['deploy'] },
      { code: 'invalid_stage_value', sourcePath: 'docs/knowledge/bad-stages.md', field: 'gate', values: ['review'] },
      { code: 'invalid_stage_value', sourcePath: 'docs/knowledge/boolean-stages.md', field: 'stages', values: ['true'] },
    ])
  })

  it('reports broken relative links and anchors, and counts targets the indexer did not resolve', () => {
    const documents = index({
      'docs/knowledge/a.md': [
        frontMatter(),
        '# Alpha',
        '[ok](b.md#beta) [bad anchor](b.md#gamma) [self](#alpha) [self bad](#nope)',
        '[missing](gone.md) [outside](../../../x.md) [adr](../adr/0001.md#context) [adr bad](../adr/0001.md#nope)',
        '[folder](../adr/) [unresolved](../unknown.md) [link](../linked.md)',
      ].join('\n'),
      'docs/knowledge/b.md': `${frontMatter()}# Beta`,
    })
    const report = checkKnowledgeDirectory({
      documents,
      linkTargets: [
        { path: 'docs/adr/0001.md', kind: 'file', anchors: ['context'] },
        { path: 'docs/adr', kind: 'directory' },
        { path: 'docs/knowledge/gone.md', kind: 'missing' },
        { path: 'docs/linked.md', kind: 'unsupported' },
      ],
    })

    expect(report.findings).toEqual([
      // Line numbers count the front matter: five lines, then an empty line.
      { code: 'broken_link', sourcePath: 'docs/knowledge/a.md', line: 9, target: 'gone.md', reason: 'missing' },
      { code: 'broken_link', sourcePath: 'docs/knowledge/a.md', line: 9, target: '../../../x.md', reason: 'outside_repository' },
      { code: 'broken_anchor', sourcePath: 'docs/knowledge/a.md', line: 8, target: 'b.md#gamma', anchor: 'gamma' },
      { code: 'broken_anchor', sourcePath: 'docs/knowledge/a.md', line: 8, target: '#nope', anchor: 'nope' },
      { code: 'broken_anchor', sourcePath: 'docs/knowledge/a.md', line: 9, target: '../adr/0001.md#nope', anchor: 'nope' },
    ])
    expect(report.checkedLinkCount).toBe(9)
    expect(report.uncheckedLinkCount).toBe(2)
  })

  it('reports stages whose applicable documents exceed the budget and truncated project instructions', () => {
    const large = 'x'.repeat(600)
    const documents = index({
      'docs/knowledge/gate.md': `---\ntitle: Gate\nstages: [test]\ngate: true\n---\n${large}`,
      'docs/knowledge/extra.md': `---\ntitle: Extra\nstages: [test, build]\n---\n${large}`,
    })
    const instructions: ProjectInstructionsSnapshot = {
      sourcePath: 'AGENTS.md', content: 'x', bytes: 40_000, contentDigest: `sha256:${'a'.repeat(64)}`, truncated: true,
    }
    const report = checkKnowledgeDirectory({ documents, projectInstructions: instructions, budgetBytes: 1_000 })
    const testBudget = report.budgets.find((budget) => budget.stage === 'test')!

    expect(testBudget).toMatchObject({
      applicablePaths: ['docs/knowledge/gate.md', 'docs/knowledge/extra.md'],
      gatePaths: ['docs/knowledge/gate.md'],
      overBudgetPaths: ['docs/knowledge/extra.md'],
      budgetBytes: 1_000,
    })
    expect(testBudget.requiredBytes).toBeGreaterThan(1_000)
    expect(report.findings).toEqual([
      { code: 'stage_over_budget', stage: 'test', budgetBytes: 1_000, requiredBytes: testBudget.requiredBytes, sourcePaths: ['docs/knowledge/extra.md'] },
      { code: 'instructions_truncated', sourcePath: 'AGENTS.md', bytes: 40_000, maxBytes: 32 * 1024 },
    ])
    expect(report.budgets.find((budget) => budget.stage === 'build')?.overBudgetPaths).toEqual([])
  })

  it('reports files listed in recorded manifests that are no longer in the knowledge directory', () => {
    const documents = index({ 'docs/knowledge/kept.md': `${frontMatter()}# Kept` })
    const digest = `sha256:${'c'.repeat(64)}`
    const report = checkKnowledgeDirectory({
      documents,
      knowledgeRoot: 'docs/knowledge',
      projectInstructions: null,
      recordedManifests: [
        {
          recordedAt: '2026-09-29T10:00:00.000Z',
          manifest: manifest({
            stage: 'design',
            instructions: { sourcePath: 'AGENTS.md', bytes: 10, contentDigest: digest, truncated: false, loadedBy: 'devflow' },
            included: [{ sourcePath: 'docs/knowledge/kept.md', contentDigest: digest, bytes: 10, gate: false }],
            catalogued: [{ sourcePath: 'docs/knowledge/removed.md', contentDigest: digest, reason: 'other_stage' }],
          }),
        },
        {
          recordedAt: '2026-09-30T08:00:00.000Z',
          manifest: manifest({ included: [{ sourcePath: 'docs/knowledge/removed.md', contentDigest: digest, bytes: 10, gate: true }] }),
        },
        // Another knowledge directory is not comparable with this index.
        { recordedAt: '2026-09-30T09:00:00.000Z', manifest: manifest({ knowledgeRoot: 'docs/other', included: [{ sourcePath: 'docs/other/x.md', contentDigest: digest, bytes: 1, gate: false }] }) },
      ],
    })

    expect(report.manifestCheck).toBe('checked')
    expect(report.checkedManifestCount).toBe(2)
    expect(report.findings).toEqual([
      { code: 'manifest_file_missing', sourcePath: 'AGENTS.md', manifestCount: 1, lastRecordedAt: '2026-09-29T10:00:00.000Z', stages: ['design'] },
      { code: 'manifest_file_missing', sourcePath: 'docs/knowledge/removed.md', manifestCount: 2, lastRecordedAt: '2026-09-30T08:00:00.000Z', stages: ['design', 'build'] },
    ])
  })

  it('skips the manifest check when the index is incomplete or nothing was recorded', () => {
    const documents = index({ 'docs/knowledge/kept.md': `${frontMatter()}# Kept` })
    const recorded = [{ recordedAt: updatedAt, manifest: manifest({ included: [{ sourcePath: 'docs/knowledge/removed.md', contentDigest: 'x', bytes: 1, gate: false }] }) }]

    expect(checkKnowledgeDirectory({ documents, knowledgeRoot: 'docs/knowledge', recordedManifests: recorded, indexTruncated: true }))
      .toMatchObject({ manifestCheck: 'index_truncated', findings: [] })
    expect(checkKnowledgeDirectory({ documents, knowledgeRoot: 'docs/knowledge' }))
      .toMatchObject({ manifestCheck: 'no_manifests', findings: [] })
  })

  it('is deterministic regardless of document order', () => {
    const sources = {
      'docs/knowledge/b.md': '# B [x](missing.md)',
      'docs/knowledge/a.md': '---\ntitle: A\nstages: [nope]\n---\n# A',
    }
    const forward = checkKnowledgeDirectory({ documents: index(sources) })
    const reversed = checkKnowledgeDirectory({ documents: index(sources).reverse() })
    expect(reversed).toEqual(forward)
    expect(summarizeKnowledgeStageBudgets(index(sources))).toEqual(summarizeKnowledgeStageBudgets(index(sources).reverse()))
  })
})
