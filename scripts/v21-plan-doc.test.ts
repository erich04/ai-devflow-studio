import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('V2.1 Evaluated Retrieval and Memory contract', () => {
  it('promotes one complete contract set through the single Roadmap before product code', () => {
    const roadmap = read('docs/roadmap.md')
    const contractPaths = [
      'docs/product/prd/v2.1-evaluated-retrieval-memory-prd.md',
      'docs/adr/0017-evaluated-hybrid-retrieval-and-citation.md',
      'docs/adr/0018-scoped-agent-memory-lifecycle.md',
      'docs/plans/v2.1-evaluated-retrieval-memory.md',
      'scripts/fixtures/v2.1-retrieval-memory-evaluation.json',
    ]

    for (const path of contractPaths) {
      expect(roadmap).toContain(path)
      expect(read(path).length).toBeGreaterThan(0)
    }

    expect(roadmap).toContain('V2.1 contract set is frozen')
    expect(roadmap).toContain('V2.1 Slice 1 is complete')
  })

  it('defines stable citation, corpus, and Memory lifecycle language without changing authority', () => {
    const context = read('CONTEXT.md')

    for (const term of [
      '## Knowledge Citation',
      '## Retrieval Evaluation Corpus',
      '## Memory Candidate',
      '## Durable Agent Memory',
      '## Memory Revision',
      '## Memory Tombstone',
    ]) {
      expect(context).toContain(term)
    }

    expect(context).toContain('Agent Memory is not Workflow State')
    expect(context).toContain('does not become Governance Evidence')
    expect(context).toContain('scope is an intersection, never a fallback')
  })

  it('keeps hybrid retrieval and citations evaluated, scoped, and advisory', () => {
    const adr = read('docs/adr/0017-evaluated-hybrid-retrieval-and-citation.md')

    expect(adr).toContain('Status: Accepted')
    expect(adr).toContain('ADR 0007')
    expect(adr).toContain('Lexical retrieval remains the stable no-cost baseline')
    expect(adr).toContain('rerank only candidates already admitted')
    expect(adr).toContain('Citation presence does not establish faithfulness')
    expect(adr).toContain('Recall@K')
    expect(adr).toContain('nDCG@K')
    expect(adr).toContain('zero forbidden-scope hits')
    expect(adr).toContain('scope and lifecycle filtering happens before embedding, ranking, reranking, or provider use')
    expect(adr).toContain('does not select a vector database')
  })

  it('makes durable Agent Memory curated, versioned, isolated, and deletion-safe', () => {
    const adr = read('docs/adr/0018-scoped-agent-memory-lifecycle.md')

    expect(adr).toContain('Status: Accepted')
    expect(adr).toContain('Agent Memory is a separate, versioned, scoped product concept')
    expect(adr).toContain('A Memory Candidate')
    expect(adr).toContain('inert until an authoritative promotion policy accepts it')
    expect(adr).toContain('optimistic concurrency rejects stale writers')
    expect(adr).toContain('Conflicting active memories are not silently merged')
    expect(adr).toContain('deleted or expired Memory is unavailable before retrieval')
    expect(adr).toContain('prevents replay or an older sync from resurrecting it')
    expect(adr).toMatch(/Team\/API may\s+store an explicitly allowed redacted Memory projection only/)
    expect(adr).toContain('Default verification uses a deterministic clock')
  })

  it('freezes a no-cost corpus covering retrieval, citation, Memory lifecycle, and isolation gates', () => {
    const corpus = JSON.parse(read('scripts/fixtures/v2.1-retrieval-memory-evaluation.json')) as {
      schemaVersion: number
      corpusId: string
      corpusVersion: number
      retrievalContractVersion: number
      memoryContractVersion: number
      defaultNoCost: boolean
      metricThresholds?: Record<string, number>
      memoryFixtures?: Array<{ id: string; status: string }>
      cases: Array<{ id: string; category: string; scope: Record<string, string> }>
    }

    expect(corpus).toMatchObject({
      schemaVersion: 1,
      corpusId: 'v2.1-evaluated-retrieval-memory',
      corpusVersion: 1,
      retrievalContractVersion: 1,
      memoryContractVersion: 1,
      defaultNoCost: true,
      metricThresholds: {
        citationPrecisionMin: 1,
        citationFaithfulnessMin: 1,
        maxIsolationViolations: 0,
        paidProviderCalls: 0,
      },
    })
    expect(new Set(corpus.cases.map((entry) => entry.category))).toEqual(new Set([
      'retrieval_baseline',
      'hybrid_improvement',
      'citation',
      'citation_staleness',
      'tenant_isolation',
      'memory_quality',
      'memory_conflict',
      'memory_expiry',
      'memory_deletion',
      'memory_isolation',
    ]))
    expect(corpus.memoryFixtures?.map((entry) => entry.status)).toEqual(
      expect.arrayContaining(['active', 'conflict', 'expired', 'deleted']),
    )
    expect(corpus.cases.every((entry) =>
      Object.keys(entry.scope).sort().join(',') === 'organizationId,projectId,sessionId,userId'
    )).toBe(true)
  })

  it('defines a measurable product gate and ordered TDD slices before implementation', () => {
    const prd = read('docs/product/prd/v2.1-evaluated-retrieval-memory-prd.md')
    const plan = read('docs/plans/v2.1-evaluated-retrieval-memory.md')

    expect(prd).toContain('Status: Approved for implementation')
    expect(prd).toContain('ADR 0007')
    expect(prd).toContain('hybrid retrieval improves the frozen aggregate quality threshold')
    expect(prd).toContain('citation precision and faithfulness')
    expect(prd).toContain('Memory improves the selected task outcomes over no-Memory')
    expect(prd).toContain('Desktop schema 22')
    expect(prd).toContain('Team schema 17')
    expect(prd).toContain('No provider credential is resolved before scope, budget, and text-transmission authority pass')
    expect(prd).toContain('V2.2 Multi-Agent')

    for (const slice of [
      'Slice 0 — Contract Freeze',
      'Slice 1 — Shared Retrieval, Citation, And Evaluation Contracts',
      'Slice 2 — Deterministic Hybrid Retrieval',
      'Slice 3 — Durable Local Retrieval Index',
      'Slice 4 — Scoped Agent Memory Lifecycle',
      'Slice 5 — Agent Runtime And Desktop UX',
      'Slice 6 — Redacted Team Projection',
      'Slice 7 — Evaluation And Completion Gate',
    ]) {
      expect(plan).toContain(slice)
    }
    expect(plan).toContain('RED → GREEN')
    expect(plan).toContain('Scope and deletion filter before embedding')
    expect(plan).toContain('Team cannot promote/delete local Memory')
    expect(plan).toContain('clean direct child')
  })

  it('keeps the single active Roadmap priority on V2.1 Slice 5 while Context integration progresses', () => {
    const roadmap = read('docs/roadmap.md')
    const plan = read('docs/plans/v2.1-evaluated-retrieval-memory.md')
    const testing = read('docs/engineering/testing-strategy.md')

    expect(plan).toContain('Status: Active — Slice 5 in progress')
    expect(plan).toContain('| Slice 1 | Complete |')
    expect(plan).toContain('| Slice 2 | Complete |')
    expect(plan).toContain('| Slice 3 | Complete |')
    expect(plan).toContain('| Slice 4 | Complete |')
    expect(plan).toContain('| Slice 5 | In progress |')
    expect(plan).toContain('Desktop schema 26')
    expect(plan).toMatch(/193 test files and 2757 tests/u)
    expect(plan).toContain('renderer projection v2')
    expect(plan).toContain('Knowledge Citation and Durable Memory counts')
    expect(plan).toContain('durable capability grant reservation')
    expect(plan).toMatch(/152\s+focused local-store\s+tests and 48\s+focused shared retrieval\/Memory tests/u)
    expect(plan).toMatch(/192 test files and 2743\s+tests/u)
    expect(roadmap).toContain('### Now — Integrate V2.1 Agent Runtime Context And Desktop UX')
    expect(roadmap).toContain('| Active milestone | V2.1 Slice 5 — Agent Runtime Context and Desktop UX |')
    expect(roadmap).toContain('| Next gate | Prove exact Context attachment, stale continuation fencing, visible provenance, and zero-repeat restart |')
    expect(testing).toContain('atomic activation preserves the previous current snapshot')
    expect(testing).toMatch(/explicit bounded rebuild restores\s+only derived index state/u)
    expect(testing).toContain('143 local-store tests and 43 shared retrieval tests')
    expect(testing).toContain('renderer projection v2')
    expect(roadmap).toContain('grant reservation')
    expect(roadmap).not.toContain('### Now — Implement V2.1 Shared Retrieval, Citation, And Evaluation Contracts')
    expect(roadmap).not.toContain('### Now — Implement V2.1 Durable Local Retrieval Index')
    expect(roadmap).not.toContain('### Now — Implement V2.1 Scoped Agent Memory Lifecycle')
    expect(roadmap.match(/^### Now —/gmu)).toHaveLength(1)
  })
})
