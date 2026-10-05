import { describe, expect, it } from 'vitest'
import {
  indexKnowledgeSources,
  type AgentTrace,
  type AgentReviewResult,
  type CodingAgentRun,
  type KnowledgeContextManifest,
  type RepositoryKnowledgeSnapshot,
  type StageAgentExecutorProvenance,
} from '@ai-devflow/shared'
import {
  buildKnowledgeDirectoryView,
  describeKnowledgeDocumentStages,
  formatKnowledgeBytes,
  recordedKnowledgeManifests,
} from './knowledge-directory-view-model'

const indexedAt = '2026-09-30T00:00:00.000Z'

function snapshot(sources: Record<string, string>, overrides: Partial<RepositoryKnowledgeSnapshot> = {}): RepositoryKnowledgeSnapshot {
  const index = indexKnowledgeSources(Object.entries(sources).map(([sourcePath, markdown]) => ({ sourcePath, markdown, updatedAt: indexedAt })))
  return {
    projectId: 'local-project',
    contentHash: 'sha256:hash',
    documents: index.documents,
    chunks: index.chunks,
    entities: index.entities,
    relations: index.relations,
    indexedAt,
    truncated: false,
    warnings: [],
    knowledgeRoot: 'docs/knowledge',
    projectInstructions: {
      sourcePath: 'AGENTS.md', content: '# Rules', bytes: 3_003, contentDigest: `sha256:${'a'.repeat(64)}`, truncated: false,
    },
    linkTargets: [],
    ...overrides,
  }
}

const manifest: KnowledgeContextManifest = {
  version: 1,
  stage: 'design',
  knowledgeRoot: 'docs/knowledge',
  budgetBytes: 24 * 1024,
  usedBytes: 100,
  instructions: null,
  included: [{ sourcePath: 'docs/knowledge/removed.md', contentDigest: 'sha256:x', bytes: 100, gate: false }],
  catalogued: [],
  omittedCount: 0,
}

function trace(runId: string, knowledgeContext?: KnowledgeContextManifest): AgentTrace {
  return {
    id: `trace-${runId}`,
    runId,
    nodeId: 'n-design',
    reviewId: `review-${runId}`,
    runtime: 'electron',
    steps: [],
    createdAt: '2026-09-29T08:00:00.000Z',
    ...(knowledgeContext
      ? { executorProvenance: { knowledgeContext } as StageAgentExecutorProvenance }
      : {}),
  }
}

describe('knowledge directory view model (K4)', () => {
  it('formats byte counts the way the stage budget is written', () => {
    expect(formatKnowledgeBytes(915)).toBe('915 B')
    expect(formatKnowledgeBytes(1_092)).toBe('1.1 KiB')
    expect(formatKnowledgeBytes(24 * 1024)).toBe('24 KiB')
  })

  it('describes declared, inferred and empty stages and the Gate stages of a document', () => {
    expect(describeKnowledgeDocumentStages({ category: 'testing_standard', stages: ['design', 'test'], gateStages: ['test'] }))
      .toEqual({ stagesLabel: '适用阶段：方案设计、测试证据', gateLabel: 'Gate 依据：测试证据' })
    expect(describeKnowledgeDocumentStages({ category: 'adr' }))
      .toEqual({ stagesLabel: '适用阶段：方案设计、业务验收（未声明，按分类推定）', gateLabel: '不作为 Gate 依据' })
    expect(describeKnowledgeDocumentStages({ category: 'onboarding', stages: [], gateStages: [] }).stagesLabel).toBe('不注入任何阶段')
  })

  it('shows the directory, project instructions, stage usage and a clean check result', () => {
    const view = buildKnowledgeDirectoryView({
      snapshot: snapshot({
        'docs/knowledge/tests.md': '---\ntitle: Tests\ncategory: testing_standard\nstages: [design, test]\ngate: [test]\n---\n# Tests\nEvidence rules.',
      }),
      recordedManifests: [],
    })!

    expect(view.rootLabel).toBe('docs/knowledge')
    expect(view.budgetLabel).toBe('每个阶段上限 24 KiB')
    expect(view.instructions).toMatchObject({ label: 'AGENTS.md · 2.9 KiB（上限 32 KiB）', tone: 'good' })
    expect(view.stages.map((row) => [row.label, row.documentCount, row.gateCount, row.overBudgetCount])).toEqual([
      ['需求澄清', 0, 0, 0],
      ['方案设计', 1, 0, 0],
      ['开发实现', 0, 0, 0],
      ['测试证据', 1, 1, 0],
      ['PR 交付', 0, 0, 0],
      ['业务验收', 0, 0, 0],
    ])
    expect(view.findings).toEqual([])
    expect(view.summary).toBe('没有发现问题：已检查 1 份文档的 front matter、0 处链接和 6 个阶段的用量。')
    expect(view.notes).toEqual(['本项目的阶段生成和开发执行还没有记录上下文清单，未检查已删除的文件。'])
  })

  it('turns findings into Chinese rows with the raw check code kept for 详情', () => {
    const view = buildKnowledgeDirectoryView({
      snapshot: snapshot({
        'docs/knowledge/a.md': '---\ntitle: A\nstages: [build, deploy]\n---\n# A\n[gone](gone.md) [x](#nope)',
        'docs/knowledge/plain.md': '# Plain',
      }, {
        linkTargets: [{ path: 'docs/knowledge/gone.md', kind: 'missing' }],
        projectInstructions: {
          sourcePath: 'AGENTS.md', content: 'x', bytes: 40_000, contentDigest: `sha256:${'b'.repeat(64)}`, truncated: true,
        },
      }),
      recordedManifests: [{ manifest, recordedAt: '2026-09-29T08:00:00.000Z' }],
    })!

    expect(view.instructions.tone).toBe('warn')
    expect(view.findings.map((finding) => [finding.kindLabel, finding.location])).toEqual([
      ['缺少 front matter', 'docs/knowledge/plain.md'],
      ['阶段取值无效', 'docs/knowledge/a.md'],
      ['断链', 'docs/knowledge/a.md 第 6 行'],
      ['锚点失效', 'docs/knowledge/a.md 第 6 行'],
      ['超出预算', 'AGENTS.md'],
      ['文件已删除', 'docs/knowledge/removed.md'],
    ])
    expect(view.findings[1]!.message).toBe('stages 中的 deploy 不是有效阶段，已被忽略。有效取值：clarify、design、build、test、pr、accept。')
    expect(view.findings[2]!.message).toBe('链接目标 gone.md 不存在。')
    expect(view.findings[3]!.message).toBe('链接 #nope 指向的锚点「nope」不存在。')
    expect(view.findings[5]!.message).toContain('1 份上下文清单包含这个文件（方案设计）')
    expect(view.findings[0]!.details).toEqual([{ label: '检查代码', value: 'missing_front_matter:missing' }])
    expect(view.summary).toBe('发现 6 项需要处理的问题。')
    expect(view.notes).toEqual(['已对照 1 份上下文清单检查文件是否已删除。'])
  })

  it('counts only fully injected documents when applicable standards exceed the stage budget', () => {
    const view = buildKnowledgeDirectoryView({
      snapshot: snapshot({
        'docs/knowledge/01-release.md': '---\ntitle: Release\nstages: [pr, accept]\ngate: true\n---\n# Release\nReview the current test evidence.',
        'docs/knowledge/02-large.md': `---\ntitle: Large\nstages: [pr, accept]\ngate: true\n---\n# Large\n${'Large reference material. '.repeat(2_000)}`,
        'docs/knowledge/03-summary.md': '---\ntitle: Summary\nstages: [pr]\n---\n# Summary\nDescribe the change.',
      }),
      recordedManifests: [],
    })!

    expect(view.stages.find((row) => row.stage === 'pr')).toMatchObject({
      documentCount: 2, gateCount: 2, overBudgetCount: 1,
    })
    expect(view.stages.find((row) => row.stage === 'accept')).toMatchObject({
      documentCount: 1, gateCount: 2, overBudgetCount: 1,
    })
  })

  it('collects manifests recorded by stage agent calls of the current project runs only', () => {
    const traces = [trace('run-a', manifest), trace('run-b', manifest), trace('run-a')]
    expect(recordedKnowledgeManifests(traces, new Set(['run-a']))).toEqual([
      { manifest, recordedAt: '2026-09-29T08:00:00.000Z' },
    ])
  })

  it('checks files recorded by current-project PR and acceptance reviews', () => {
    const review = (runId: string) => ({ runId, createdAt: indexedAt,
      contextManifest: { knowledgeContext: manifest } as NonNullable<AgentReviewResult['contextManifest']>,
    })
    expect(recordedKnowledgeManifests([], new Set(['run-a']), [], [review('run-a'), review('run-b')])).toEqual([
      { manifest, recordedAt: indexedAt },
    ])
  })

  it('also collects the coding brief receipts of the current project runs (knowledge-context K3)', () => {
    const buildManifest: KnowledgeContextManifest = { ...manifest, stage: 'build' }
    const receipt = (knowledgeContext?: KnowledgeContextManifest) => ({
      contextReceipt: (knowledgeContext ? { knowledgeContext } : {}) as NonNullable<CodingAgentRun['contextReceipt']>,
    })
    const codingRuns: Pick<CodingAgentRun, 'runId' | 'startedAt' | 'contextReceipt'>[] = [
      { runId: 'run-a', startedAt: '2026-09-30T09:00:00.000Z', ...receipt(buildManifest) },
      { runId: 'run-b', startedAt: '2026-09-30T09:00:00.000Z', ...receipt(buildManifest) },
      // Older runs have no receipt or a receipt without a knowledge manifest.
      { runId: 'run-a', startedAt: '2026-09-28T09:00:00.000Z' },
      { runId: 'run-a', startedAt: '2026-09-28T10:00:00.000Z', ...receipt() },
    ]
    expect(recordedKnowledgeManifests([trace('run-a', manifest)], new Set(['run-a']), codingRuns)).toEqual([
      { manifest, recordedAt: '2026-09-29T08:00:00.000Z' },
      { manifest: buildManifest, recordedAt: '2026-09-30T09:00:00.000Z' },
    ])

    const view = buildKnowledgeDirectoryView({
      snapshot: snapshot({ 'docs/knowledge/kept.md': '---\ntitle: Kept\nstages: [build]\n---\n# Kept' }),
      recordedManifests: recordedKnowledgeManifests([], new Set(['run-a']), codingRuns),
    })!
    expect(view.findings.map((finding) => [finding.kindLabel, finding.location])).toEqual([['文件已删除', 'docs/knowledge/removed.md']])
    expect(view.findings[0]!.message).toContain('1 份上下文清单包含这个文件（开发实现）')
    expect(view.notes).toEqual(['已对照 1 份上下文清单检查文件是否已删除。'])
  })

  it('is absent until a snapshot exists and names the whole repository when the root is empty', () => {
    expect(buildKnowledgeDirectoryView({ snapshot: undefined, recordedManifests: [] })).toBeUndefined()
    expect(buildKnowledgeDirectoryView({ snapshot: snapshot({}, { knowledgeRoot: '', projectInstructions: null }), recordedManifests: [] }))
      .toMatchObject({ rootLabel: '整个仓库', instructions: { label: '未找到仓库根目录的 AGENTS.md 或 CLAUDE.md', tone: 'soft' } })
  })
})
