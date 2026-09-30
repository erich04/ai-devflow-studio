// Knowledge context evaluation (docs/plans/knowledge-context-redesign-2026-09-29.zh-CN.md §6).
// Deterministic, no model calls. Indexes this repository the same way the desktop
// main process does and scores each Chinese scenario in
// scripts/fixtures/knowledge-context-evaluation.json.
//
//   corepack pnpm exec tsx scripts/knowledge-context-evaluation.mts [--baseline] [--out file.json]
//
// Default mode scores the resident stage context (ADR 0025). --baseline reproduces
// the previous behaviour: whole-repository index and lexical retrieval.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRepositoryKnowledgeService } from '../apps/desktop/electron/repository-knowledge.ts'
import { evaluateKnowledgeContextScenarios, type KnowledgeContextScenario } from './knowledge-context-evaluator.ts'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const corpus = JSON.parse(await readFile(path.join(repoRoot, 'scripts/fixtures/knowledge-context-evaluation.json'), 'utf8')) as {
  scenarios: KnowledgeContextScenario[]
}
const baseline = process.argv.includes('--baseline')
const snapshot = await createRepositoryKnowledgeService(baseline ? { knowledgeRoot: '' } : {})
  .index({ id: 'evaluation', path: repoRoot } as never)
const report = evaluateKnowledgeContextScenarios({ snapshot, scenarios: corpus.scenarios, mode: baseline ? 'baseline-lexical' : 'resident-stage-context' })

const outIndex = process.argv.indexOf('--out')
if (outIndex !== -1 && process.argv[outIndex + 1]) {
  await writeFile(path.resolve(process.argv[outIndex + 1]!), `${JSON.stringify(report, null, 2)}\n`)
}
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2))
