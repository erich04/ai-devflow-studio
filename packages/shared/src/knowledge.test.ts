import { describe, expect, it } from 'vitest'
import { artifacts, runs } from './fixtures'
import {
  buildKnowledgeGovernanceChecks,
  buildKnowledgeReferences,
  indexKnowledgeSources,
  lexicalKnowledgeRetriever,
  projectKnowledgeReferencesForNode,
} from './knowledge'

const sources = [
  {
    sourcePath: 'docs/knowledge/standards/api-health.md',
    markdown: `---
title: API Health Endpoint Standard
category: api_contract
ownerId: u-ling
tags: api, health, degraded
---

# API Health Endpoint Standard

Health endpoints must describe ok, degraded, and down states.
`,
    updatedAt: '2026-06-16T00:00:00.000Z',
  },
  {
    sourcePath: 'docs/knowledge/standards/testing-evidence.md',
    markdown: `---
title: Local Test Evidence Standard
category: testing_standard
ownerId: u-yu
tags: test, evidence, smoke
---

# Local Test Evidence Standard

Every Run needs command, exit code, duration, and redacted output.
`,
    updatedAt: '2026-06-16T00:00:00.000Z',
  },
]

describe('indexKnowledgeSources', () => {
  it('indexes Git Markdown files into governance documents and graph nodes', () => {
    const index = indexKnowledgeSources(sources)

    expect(index.documents).toHaveLength(2)
    expect(index.chunks).toHaveLength(2)
    expect(index.documents[0]).toMatchObject({
      id: 'knowledge-doc-api-health',
      title: 'API Health Endpoint Standard',
      category: 'api_contract',
      ownerId: 'u-ling',
      tags: ['api', 'health', 'degraded'],
      sourcePath: 'docs/knowledge/standards/api-health.md',
    })
    expect(index.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'knowledge-doc-api-health',
          label: 'API Health Endpoint Standard',
          kind: 'standard',
        }),
        expect.objectContaining({
          id: 'knowledge-tag-health',
          label: 'health',
          kind: 'term',
        }),
      ]),
    )
    expect(index.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'knowledge-doc-api-health',
          target: 'knowledge-tag-health',
          label: 'defines',
        }),
      ]),
    )
    expect(index.chunks[0]).toMatchObject({
      id: 'knowledge-chunk-api-health-1-api-health-endpoint-standard',
      documentId: 'knowledge-doc-api-health',
      sourcePath: 'docs/knowledge/standards/api-health.md',
      headingPath: ['API Health Endpoint Standard'],
      contentHash: expect.stringMatching(/^kh-[a-f0-9]{8}$/),
      tokenCount: expect.any(Number),
    })
  })

  it('changes chunk content hashes when Markdown section content changes', () => {
    const original = indexKnowledgeSources(sources)
    const changed = indexKnowledgeSources([
      {
        ...sources[0]!,
        markdown: sources[0]!.markdown.replace('ok, degraded, and down', 'ok, degraded, down, and maintenance'),
      },
    ])

    expect(changed.chunks[0]!.sourcePath).toBe(original.chunks[0]!.sourcePath)
    expect(changed.chunks[0]!.contentHash).not.toBe(original.chunks[0]!.contentHash)
  })
})

describe('lexicalKnowledgeRetriever', () => {
  it('returns scored TopK chunk hits with retrieval provenance', () => {
    const index = indexKnowledgeSources(sources)
    const hits = lexicalKnowledgeRetriever.retrieve(
      {
        id: 'query-health',
        runId: 'run-health-001',
        targetType: 'run',
        text: 'health endpoint degraded redis smoke',
        topK: 1,
        minScore: 2,
      },
      index,
    )

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      documentId: 'knowledge-doc-api-health',
      chunkId: 'knowledge-chunk-api-health-1-api-health-endpoint-standard',
      strategy: 'lexical',
      score: expect.any(Number),
      lexicalMatch: {
        rawScore: expect.any(Number),
        matchedTerms: expect.arrayContaining(['health', 'degraded']),
        normalized: false,
        crossQueryComparable: false,
        source: 'retriever',
      },
      contentHash: expect.stringMatching(/^kh-[a-f0-9]{8}$/),
      headingPath: ['API Health Endpoint Standard'],
    })
    expect(hits[0]!.score).toBeGreaterThanOrEqual(2)
    expect(hits[0]!.semanticRelevance).toBeUndefined()
    expect(hits[0]!.reason).toContain('not semantic relevance or Gate evidence')
  })

  it('uses the raw lexical threshold deterministically and does not invent semantic state', () => {
    const index = indexKnowledgeSources(sources)
    const query = {
      id: 'query-threshold',
      runId: 'run-health-001',
      targetType: 'run' as const,
      text: 'health endpoint degraded',
      topK: 3,
    }
    const scored = lexicalKnowledgeRetriever.retrieve({ ...query, minScore: 0 }, index)
    const topScore = scored[0]!.lexicalMatch!.rawScore

    expect(lexicalKnowledgeRetriever.retrieve({ ...query, minScore: topScore }, index)).not.toHaveLength(0)
    expect(lexicalKnowledgeRetriever.retrieve({ ...query, minScore: topScore + 1 }, index)).toHaveLength(0)
    expect(scored.every((hit) => hit.semanticRelevance === undefined)).toBe(true)
  })
})

describe('buildKnowledgeReferences', () => {
  it('links runs, artifacts, gate decisions, and test evidence back to relevant standards', () => {
    const index = indexKnowledgeSources(sources)
    const run = runs[0]!
    const testNode = run.nodes.find((node) => node.stage === 'test')!
    const references = buildKnowledgeReferences({
      run,
      artifacts,
      documents: index.documents,
      testEvidence: [
        {
          id: 'evidence-1',
          runId: run.id,
          nodeId: testNode.id,
          projectId: run.projectId,
          command: 'corepack pnpm test',
          cwd: '/repo',
          status: 'passed',
          exitCode: 0,
          durationMs: 1200,
          stdout: 'ok',
          stderr: '',
          summary: 'Tests passed in 1200ms',
          redacted: false,
          createdAt: '2026-06-16T00:00:00.000Z',
        },
      ],
    })

    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: 'run',
          runId: run.id,
          documentId: 'knowledge-doc-api-health',
          relation: 'cites',
        }),
        expect.objectContaining({
          targetType: 'artifact',
          artifactId: 'art-design',
          documentId: 'knowledge-doc-api-health',
          relation: 'cites',
          chunkId: 'knowledge-chunk-api-health-1-api-health-endpoint-standard',
          sourcePath: 'docs/knowledge/standards/api-health.md',
          strategy: 'lexical',
          score: expect.any(Number),
          lexicalMatch: expect.objectContaining({
            rawScore: expect.any(Number),
            normalized: false,
          }),
          gateEvidence: { status: 'retrieval_candidate' },
          contentHash: expect.stringMatching(/^kh-[a-f0-9]{8}$/),
        }),
        expect.objectContaining({
          targetType: 'gate_decision',
          nodeId: 'n-design-gate',
          documentId: 'knowledge-doc-api-health',
          relation: 'requires_evidence',
        }),
        expect.objectContaining({
          targetType: 'test_evidence',
          evidenceId: 'evidence-1',
          documentId: 'knowledge-doc-testing-evidence',
          relation: 'satisfies',
        }),
      ]),
    )
  })

  it('projects candidates to the current Gate instead of leaking high lexical hits across stages', () => {
    const crossStageIndex = indexKnowledgeSources([
      {
        sourcePath: 'README.md',
        markdown: `---
title: Mini Agent Verify
category: testing_standard
tags: mini, agent, deepseek, api, pnpm, verify
---
# Verify
Run pnpm verify for Mini Agent DeepSeek API changes.
`,
        updatedAt: '2026-08-28T00:00:00.000Z',
      },
      {
        sourcePath: 'docs/knowledge/requirements.md',
        markdown: `---
title: Requirement Scope Checklist
category: review_checklist
tags: requirement, acceptance, scope
---
# Requirement Scope Checklist
Clarify acceptance criteria, scope boundaries, assumptions, and non-goals.
`,
        updatedAt: '2026-08-28T00:00:00.000Z',
      },
    ])
    const sourceRun = runs[0]!
    const clarifyGate = sourceRun.nodes.find((node) => node.kind === 'gate' && node.stage === 'clarify')!
    const references = buildKnowledgeReferences({
      run: {
        ...sourceRun,
        title: 'Simplify Mini Agent DeepSeek API copy',
        request: 'Simplify Mini Agent and run pnpm verify.',
      },
      artifacts: artifacts.filter((artifact) => artifact.kind === 'clarification'),
      documents: crossStageIndex.documents,
      chunks: crossStageIndex.chunks,
      testEvidence: [],
      targetNode: clarifyGate,
    })

    expect(references.some((reference) => reference.category === 'testing_standard')).toBe(false)
    expect(references).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: clarifyGate.id,
        documentId: 'knowledge-doc-requirements',
        category: 'review_checklist',
      }),
    ]))
  })

  it('keeps legacy untyped references node-scoped without treating run-wide records as current Evidence', () => {
    const sourceRun = runs[0]!
    const designGate = sourceRun.nodes.find((node) => node.kind === 'gate' && node.stage === 'design')!
    const projected = projectKnowledgeReferencesForNode({
      node: designGate,
      references: [
        {
          id: 'legacy-run-only',
          runId: sourceRun.id,
          targetType: 'run',
          documentId: 'legacy-unscoped-doc',
          relation: 'cites',
          reason: 'Old score-only record.',
          strategy: 'lexical',
          score: 8,
        },
        {
          id: 'legacy-current-gate',
          runId: sourceRun.id,
          nodeId: designGate.id,
          targetType: 'gate_decision',
          documentId: 'legacy-current-doc',
          relation: 'requires_evidence',
          reason: 'Current Gate record.',
        },
      ],
    })

    expect(projected.map((reference) => reference.id)).toEqual(['legacy-current-gate'])
  })
})

describe('buildKnowledgeGovernanceChecks', () => {
  it('keeps retrieval-matched artifacts contextual instead of treating search as governance proof', () => {
    const index = indexKnowledgeSources(sources)
    const run = runs[0]!
    const designGate = run.nodes.find((node) => node.id === 'n-design-gate')!
    const references = buildKnowledgeReferences({
      run,
      artifacts,
      documents: index.documents,
      chunks: index.chunks,
      testEvidence: [],
    })
    const checks = buildKnowledgeGovernanceChecks({
      run,
      node: designGate,
      artifacts,
      documents: index.documents,
      chunks: index.chunks,
      testEvidence: [],
    })

    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: 'artifact',
          artifactId: 'art-design',
          documentId: 'knowledge-doc-api-health',
          relation: 'cites',
        }),
      ]),
    )
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: 'knowledge-doc-api-health',
          status: 'needs_evidence',
        }),
      ]),
    )
  })

  it('summarizes selected-node standards without promoting retrieved artifacts to evidence', () => {
    const index = indexKnowledgeSources(sources)
    const run = runs[0]!
    const designGate = run.nodes.find((node) => node.id === 'n-design-gate')!
    const checks = buildKnowledgeGovernanceChecks({
      run,
      node: designGate,
      artifacts,
      documents: index.documents,
      testEvidence: [],
    })

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: 'knowledge-doc-api-health',
          title: 'API Health Endpoint Standard',
          status: 'needs_evidence',
        }),
        expect.objectContaining({
          documentId: 'knowledge-doc-testing-evidence',
          title: 'Local Test Evidence Standard',
          status: 'needs_evidence',
        }),
      ]),
    )
  })

  it('does not treat retrieval-only run citations as governance evidence', () => {
    const index = indexKnowledgeSources(sources)
    const run = runs[0]!
    const designGate = run.nodes.find((node) => node.id === 'n-design-gate')!
    const checks = buildKnowledgeGovernanceChecks({
      run,
      node: designGate,
      artifacts: [],
      documents: index.documents,
      testEvidence: [],
    })

    expect(buildKnowledgeReferences({
      run,
      artifacts: [],
      documents: index.documents,
      testEvidence: [],
    })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: 'run',
          documentId: 'knowledge-doc-api-health',
          relation: 'cites',
          strategy: 'lexical',
        }),
      ]),
    )
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: 'knowledge-doc-api-health',
          status: 'needs_evidence',
        }),
      ]),
    )
  })
})
