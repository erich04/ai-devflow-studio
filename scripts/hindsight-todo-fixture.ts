import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const assetRoot = fileURLToPath(new URL('./fixtures/hindsight-todo/', import.meta.url))
const execute = promisify(execFile)
export const HINDSIGHT_TODO_SOURCE_COMMIT = 'c2be68d6c4a03fc219c483acc79a90fdf6e11ab6'
export const HINDSIGHT_TODO_KNOWLEDGE_PATHS = [
  'docs/knowledge/task-domain.md',
  'docs/knowledge/cleanup-rules.md',
  'docs/knowledge/storage-compatibility.md',
  'docs/knowledge/interaction-rules.md',
  'docs/knowledge/engineering-rules.md',
  'docs/knowledge/testing-evidence.md',
] as const

export type HindsightTodoPhase = 'baseline' | 'rule-revised' | 'unselected' | 'revoked' | 'wrong-project'
export interface HindsightTodoQuestion {
  id: string
  kind: 'direct' | 'cross-document' | 'english' | 'no-answer' | 'revision' | 'boundary'
  phase: HindsightTodoPhase
  query: string
  expectedPaths: string[]
  /** For a separate answer evaluation; the retrieval scorer never claims to assess these. */
  expectedAnswerTerms: string[]
}
export interface HindsightTodoCorpus {
  schemaVersion: 1
  id: string
  description: string
  questions: HindsightTodoQuestion[]
}
export interface HindsightTodoAcceptance {
  schemaVersion: 1
  request: string
  targetImplementedInBaseline: false
  expectedBehaviour: string[]
  stages: { stage: string; checks: string[] }[]
  revision: { path: string; from: string; to: string; versionFrom: string; versionTo: string }
  evidenceKinds: string[]
  notEvidence: string[]
}

/** Evaluator-only material: do not pass this object to a model or copy it into the project. */
export async function loadHindsightTodoEvaluation() {
  const corpus = JSON.parse(await readFile(path.join(assetRoot, 'questions.json'), 'utf8')) as HindsightTodoCorpus
  const acceptance = JSON.parse(await readFile(path.join(assetRoot, 'acceptance.json'), 'utf8')) as HindsightTodoAcceptance
  return { corpus, acceptance }
}

/** Materialize a new, isolated Git repository. Never read or modify the original Todo checkout. */
export async function createHindsightTodoFixture(destination: string) {
  const source = JSON.parse(await readFile(path.join(assetRoot, 'source.json'), 'utf8')) as {
    commit: string; files: { path: string; sha256: string }[]
  }
  if (source.commit !== HINDSIGHT_TODO_SOURCE_COMMIT) throw new Error('Unexpected Todo baseline commit')
  const repositoryPath = path.resolve(destination)
  // Exclusive directory creation deliberately refuses every existing destination.
  await mkdir(repositoryPath)
  for (const file of source.files) {
    if (path.isAbsolute(file.path) || file.path.split(/[\\/]/u).includes('..')) throw new Error('Invalid baseline path')
    const bytes = await readFile(path.join(assetRoot, 'baseline', file.path))
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Changed Todo baseline: ${file.path}`)
    await mkdir(path.dirname(path.join(repositoryPath, file.path)), { recursive: true })
    await writeFile(path.join(repositoryPath, file.path), bytes, { flag: 'wx' })
  }
  const selectedPaths = [...HINDSIGHT_TODO_KNOWLEDGE_PATHS]
  const modelPath = 'docs/knowledge/model.json'
  await mkdir(path.join(repositoryPath, 'docs/knowledge'), { recursive: true })
  for (const relative of [...selectedPaths, modelPath]) {
    await writeFile(path.join(repositoryPath, relative),
      await readFile(path.join(assetRoot, 'knowledge', path.basename(relative))), { flag: 'wx' })
  }
  await execute('git', ['init', '-b', 'main'], { cwd: repositoryPath })
  await execute('git', ['add', '.'], { cwd: repositoryPath })
  await execute('git', ['-c', 'user.name=Hindsight synthetic fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-m', 'Original Todo baseline and synthetic knowledge'], { cwd: repositoryPath })
  const evaluation = await loadHindsightTodoEvaluation()
  return { repositoryPath, sourceCommit: source.commit, selectedPaths, modelPath,
    request: evaluation.acceptance.request, ...evaluation }
}
