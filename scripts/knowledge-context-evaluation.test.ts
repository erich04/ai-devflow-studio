import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRepositoryKnowledgeService } from '../apps/desktop/electron/repository-knowledge'
import { evaluateKnowledgeContextScenarios, type KnowledgeContextScenario } from './knowledge-context-evaluator'

const corpus = JSON.parse(readFileSync(join(process.cwd(), 'scripts/fixtures/knowledge-context-evaluation.json'), 'utf8')) as {
  scenarios: KnowledgeContextScenario[]
}

describe('knowledge context evaluation corpus (ADR 0025, K1 completion condition)', () => {
  it('puts every required standard of this repository into the stage context and lists Gate criteria exactly', async () => {
    const snapshot = await createRepositoryKnowledgeService({ now: () => '2026-09-29T00:00:00.000Z' })
      .index({ id: 'evaluation', path: process.cwd() } as never)
    const report = evaluateKnowledgeContextScenarios({ snapshot, scenarios: corpus.scenarios, mode: 'resident-stage-context' })

    expect(corpus.scenarios.length).toBeGreaterThanOrEqual(20)
    expect(report.rows.filter((row) => row.missing.length > 0)).toEqual([])
    expect(report.requiredRecall).toBe(1)
    expect(report.availableRecall).toBe(1)
    expect(report.gateExactScenarios).toBe(corpus.scenarios.length)
    expect(report.indexedDocuments).toBe(10)
    expect(report.projectInstructions).toMatchObject({ sourcePath: 'AGENTS.md' })
    for (const bytes of Object.values(report.maxContextBytesByStage)) {
      expect(bytes).toBeLessThanOrEqual(24 * 1024)
    }
  }, 30_000)
})
