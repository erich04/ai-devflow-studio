/**
 * Continue the already authorized synthetic full-chain experiment after Electron has exited.
 * Reuses its SQLite, projection bank and externally bounded model gateway; never initializes
 * or reopens a budget. A rule revision can incur one additional extraction on that same gateway.
 *
 * DEVFLOW_TODO_EVALUATION_LIVE=1 DEVFLOW_FULLCHAIN_ELECTRON_CLOSED=1
 * DEVFLOW_FULLCHAIN_REPORT=<fullchain evidence/report.json>
 * HINDSIGHT_SMOKE_ENDPOINT=http://127.0.0.1:8890
 * node --import tsx scripts/hindsight-todo-live-evaluation.mts
 */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createHindsightClient, HINDSIGHT_PROTOCOL } from '../apps/desktop/electron/hindsight-client.ts'
import { HindsightService, type HindsightScope } from '../apps/desktop/electron/hindsight-service.ts'
import { createLocalStore, type LocalStore } from '../apps/desktop/electron/local-store.ts'
import { createRepositoryKnowledgeService } from '../apps/desktop/electron/repository-knowledge.ts'
import {
  createHindsightTodoFixture, HINDSIGHT_TODO_KNOWLEDGE_PATHS, HINDSIGHT_TODO_SOURCE_COMMIT,
  loadHindsightTodoEvaluation, type HindsightTodoPhase, type HindsightTodoQuestion,
} from './hindsight-todo-fixture.ts'
import {
  scoreHindsightTodoRetrieval, type HindsightTodoRetrievalMode, type HindsightTodoRetrievalObservation,
} from './hindsight-todo-evaluation.ts'

const digest = (bytes: Buffer | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const inside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate)
  return Boolean(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

interface FullchainEvidence {
  workspace: { tempRoot: string; userDataDir: string; repoDir: string }
  projectId: string
  runId: string
  evidence: { sourceCommit: string }
}
type DetailedObservation = HindsightTodoRetrievalObservation & {
  phase: HindsightTodoPhase
  query: string
  matches: Array<{ path: string; digest: string; reason: string; sourceRef: string }>
  citations: Array<{ path: string; sourceRef: string; digest: string; readVerified: boolean; contentBytes: number }>
  readElapsedMs: number
  note?: string
}

export async function runHindsightTodoLiveEvaluation() {
  assert.equal(process.env.DEVFLOW_TODO_EVALUATION_LIVE, '1', 'Explicit continuation of the authorized synthetic test is required')
  assert.equal(process.env.DEVFLOW_FULLCHAIN_ELECTRON_CLOSED, '1', 'Close the isolated Electron instance before opening its SQLite')
  assert(process.env.DEVFLOW_FULLCHAIN_REPORT, 'An existing isolated full-chain report is required')
  const evidencePath = path.resolve(process.env.DEVFLOW_FULLCHAIN_REPORT)
  const prior = JSON.parse(await readFile(evidencePath, 'utf8')) as FullchainEvidence
  assert.equal(prior.evidence.sourceCommit, HINDSIGHT_TODO_SOURCE_COMMIT)
  assert(prior.projectId && prior.runId)
  const root = await realpath(prior.workspace.tempRoot)
  const tempRoot = await realpath(os.tmpdir())
  assert(inside(tempRoot, root) && path.basename(root).startsWith('devflow-hindsight-fullchain-'),
    'Only a full-chain synthetic temporary workspace may be used')
  const repositoryPath = await realpath(prior.workspace.repoDir)
  const userData = await realpath(prior.workspace.userDataDir)
  assert(inside(root, repositoryPath) && inside(root, userData))
  const dbPath = path.join(userData, 'devflow.sqlite')
  assert((await lstat(dbPath)).isFile(), 'The isolated SQLite must be a regular file')
  const endpoint = new URL(process.env.HINDSIGHT_SMOKE_ENDPOINT ?? 'http://127.0.0.1:8890')
  assert.equal(endpoint.protocol, 'http:')
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))
  assert(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash)
  const baseUrl = endpoint.href.replace(/\/$/u, '')
  const output = path.join(path.dirname(evidencePath), 'retrieval-evaluation')
  await mkdir(output, { recursive: true })
  const { corpus, acceptance } = await loadHindsightTodoEvaluation()
  const originalDocuments = new Map<string, Buffer>()
  for (const file of HINDSIGHT_TODO_KNOWLEDGE_PATHS) {
    const bytes = await readFile(path.join(repositoryPath, file))
    const expected = await readFile(new URL(`./fixtures/hindsight-todo/knowledge/${path.basename(file)}`, import.meta.url))
    assert.equal(digest(bytes), digest(expected), `Unexpected baseline knowledge: ${file}`)
    originalDocuments.set(file, bytes)
  }
  const observations: Record<HindsightTodoRetrievalMode, DetailedObservation[]> = {
    'local-lexical': [], 'hindsight-hybrid': [],
  }
  const allowedSourcesByPhase: Partial<Record<HindsightTodoPhase, Record<string, string>>> = {}
  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(), priorReport: evidencePath, projectId: prior.projectId,
    sourceCommit: HINDSIGHT_TODO_SOURCE_COMMIT, protocol: HINDSIGHT_PROTOCOL,
    evidence: { realHindsight: true, realGitAndSqlite: true, electronUI: false,
      retrievalOnly: true, answerQualityEvaluated: false, independentBudgetCreated: false },
    observations, allowedSourcesByPhase, checks: [], completed: false,
    investigationBaseline: { status: 'not_evaluated', reason: 'No list/read + repo_search model investigation was run.' },
  }
  const checks = report.checks as string[]
  const save = async () => {
    report.scores = Object.fromEntries((['local-lexical', 'hindsight-hybrid'] as const).map((mode) => [
      mode, scoreHindsightTodoRetrieval({ mode, questions: corpus.questions,
        observations: observations[mode], allowedSourcesByPhase }),
    ]))
    await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  }
  let store: LocalStore | undefined
  let service: HindsightService | undefined
  let scope: HindsightScope | undefined
  let mayCleanup = false
  const banks = new Set<string>()
  const client = createHindsightClient({ endpoint: baseUrl })
  const bankEvidence = async (bank: string, suffix: string) => {
    const response = await fetch(`${baseUrl}/v1/default/banks/${encodeURIComponent(bank)}/${suffix}`, {
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    })
    assert(response.ok, `Hindsight evidence HTTP ${response.status}`)
    return response.json() as Promise<Record<string, number>>
  }
  try {
    store = await createLocalStore({ dbPath })
    const projects = await store.listProjects()
    const project = projects.find((item) => item.id === prior.projectId)
    assert(project && await realpath(project.path) === repositoryPath)
    const configs = await store.listHindsightConfigurations()
    assert(configs.every((item) => item.projectId === prior.projectId),
      'This evaluation must not process another project configuration')
    const initial = await store.getHindsightConfiguration(prior.projectId)
    assert(initial?.enabled && !initial.includeMemories, 'The existing knowledge configuration must be enabled')
    assert.equal(initial.endpoint.replace(/\/$/u, ''), baseUrl)
    assert.deepEqual([...initial.selectedPaths].sort(), [...HINDSIGHT_TODO_KNOWLEDGE_PATHS].sort())
    scope = { projectId: initial.projectId, userId: initial.ownerUserId }
    const retained = await store.listHindsightProjections()
    assert(retained.every((item) => item.projectId === prior.projectId), 'Other project projections are not permitted')
    assert.equal(retained.filter((item) => !item.revoked && item.status === 'ready' && item.kind === 'knowledge' &&
      item.configGeneration === initial.generation).length, 6,
      'Reuse six ready projections; do not silently initialize a new experiment')
    banks.add(initial.knowledgeBank)
    for (const row of retained) banks.add(row.bankId)
    report.bankIds = [...banks]
    const knowledge = createRepositoryKnowledgeService()
    const deps = { store, client: async () => client, loadKnowledge: async (projectId: string) => {
      assert.equal(projectId, project.id)
      return knowledge.index(project)
    } }
    service = new HindsightService({ ...deps, transportAvailable: true })
    const lexical = new HindsightService({ ...deps, transportAvailable: false })
    assert((await service.status(scope)).enabled)
    mayCleanup = true
    const active = service
    const owner = scope
    const currentDigests = async () => Object.fromEntries(await Promise.all(
      HINDSIGHT_TODO_KNOWLEDGE_PATHS.map(async (file) => [file, digest(await readFile(path.join(repositoryPath, file)))]),
    ))
    const pump = async (condition: () => Promise<boolean>, label: string) => {
      const deadline = Date.now() + 5 * 60_000
      while (Date.now() < deadline) {
        if (await condition()) return
        await active.tick()
        await delay(1_000)
      }
      throw new Error(`${label} did not settle within five minutes`)
    }
    const runQuestion = async (question: HindsightTodoQuestion, selectedScope = owner) => {
      for (const mode of ['local-lexical', 'hindsight-hybrid'] as const) {
        const target = mode === 'local-lexical' ? lexical : active
        const observed: DetailedObservation = { questionId: question.id, phase: question.phase,
          query: question.query, matches: [], citations: [], elapsedMs: 0, readElapsedMs: 0 }
        const started = performance.now()
        try {
          const result = await target.search(selectedScope, { query: question.query, limit: 5 }, target.createSearchTurn())
          observed.elapsedMs = performance.now() - started
          observed.degraded = result.degraded
          observed.note = result.note
          observed.matches = result.matches.map((match) => ({ path: match.path, digest: match.contentDigest,
            reason: match.matchReason, sourceRef: match.readArgs.sourceRef }))
          const readStarted = performance.now()
          for (const match of result.matches) {
            const read = await target.read(selectedScope, match.readArgs)
            const bytes = await readFile(path.join(repositoryPath, match.path))
            const verified = 'content' in read && read.content === bytes.toString('utf8') &&
              match.contentDigest === digest(bytes)
            observed.citations.push({ path: match.path, sourceRef: match.readArgs.sourceRef,
              digest: match.contentDigest, readVerified: verified,
              contentBytes: 'content' in read ? Buffer.byteLength(read.content) : 0 })
            assert(verified, `Citation failed current-source read: ${match.path}`)
          }
          observed.readElapsedMs = performance.now() - readStarted
        } catch (error) {
          observed.elapsedMs ||= performance.now() - started
          observed.error = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
        }
        observations[mode].push(observed)
        await save()
        console.log(JSON.stringify({ questionId: question.id, phase: question.phase, mode,
          paths: observed.matches.map((match) => match.path), elapsedMs: Math.round(observed.elapsedMs),
          degraded: observed.degraded, error: observed.error }))
      }
    }

    allowedSourcesByPhase.baseline = await currentDigests()
    for (const question of corpus.questions.filter((item) => item.phase === 'baseline')) await runQuestion(question)
    checks.push('24-baseline-questions-in-both-modes')
    const oldReference = await active.search(owner, { query: '清理按钮与反馈', limit: 5 }, active.createSearchTurn())
    const oldMatch = oldReference.matches.find((match) => match.path === acceptance.revision.path)
    assert(oldMatch, 'Need the pre-revision source handle for the lifecycle assertion')
    const original = originalDocuments.get(acceptance.revision.path)!
    const revised = original.toString('utf8').replace(acceptance.revision.from, acceptance.revision.to)
      .replace(acceptance.revision.versionFrom, acceptance.revision.versionTo)
    assert.notEqual(revised, original.toString('utf8'))
    await writeFile(path.join(repositoryPath, acceptance.revision.path), revised)
    const staleRead = await active.read(owner, oldMatch.readArgs)
    assert.equal(staleRead.error, 'source_changed')
    checks.push('old-source-handle-rejected-after-revision')
    await active.refresh(owner)
    await pump(async () => {
      const rows = await store!.listHindsightProjections(prior.projectId)
      return rows.filter((row) => !row.revoked && row.status === 'ready').length === 6 &&
        rows.every((row) => !row.revoked || row.status === 'cancelled')
    }, 'One-document revision and cleanup')
    allowedSourcesByPhase['rule-revised'] = await currentDigests()
    for (const question of corpus.questions.filter((item) => item.phase === 'rule-revised')) await runQuestion(question)
    checks.push('3-revision-questions-in-both-modes')

    // Unselect all sources without re-enabling or re-uploading another corpus.
    await active.configure(owner, { projectId: owner.projectId, endpoint: baseUrl, selectedPaths: [],
      includeMemories: false, enabled: true, pairedProjectConsent: true }, initial.encryptedApiKey)
    // An empty selection creates no remote bank. Only banks with actual projections need cleanup.
    allowedSourcesByPhase.unselected = {}
    await runQuestion(corpus.questions.find((item) => item.phase === 'unselected')!)
    assert(observations['hindsight-hybrid'].at(-1)?.matches.length === 0)
    await active.disable(owner)
    allowedSourcesByPhase.revoked = {}
    await runQuestion(corpus.questions.find((item) => item.phase === 'revoked')!)
    assert(observations['hindsight-hybrid'].at(-1)?.matches.length === 0)

    // A separate real local Project has no configuration/bank; never forge a bank or owner.
    const foreignFixture = await createHindsightTodoFixture(path.join(root, `unauthorized-todo-${randomUUID()}`))
    const now = new Date().toISOString()
    const foreignProject = { ...project, id: `synthetic-foreign-${randomUUID()}`,
      name: 'Unauthorized retrieval fixture', path: foreignFixture.repositoryPath, createdAt: now, updatedAt: now }
    await store.upsertProject(foreignProject)
    allowedSourcesByPhase['wrong-project'] = {}
    await runQuestion(corpus.questions.find((item) => item.phase === 'wrong-project')!,
      { projectId: foreignProject.id, userId: owner.userId })
    assert(observations['hindsight-hybrid'].at(-1)?.matches.length === 0)
    checks.push('unselected-disabled-and-foreign-project-return-no-projection-content')
    const failures = Object.values(observations).flat().filter((item) => item.error)
    report.completed = failures.length === 0 && Object.values(observations).every((items) => items.length === 30)
    report.qualityAcceptance = 'not-decided: inspect ranking, no-answer false positives and fallback counts before expanding'
  } catch (error) {
    report.failure = error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000)
  } finally {
    if (mayCleanup && service && scope && store) {
      try {
        await service.disable(scope)
        // Restore exact source bytes only after disabling, so restoration cannot enqueue paid retain.
        for (const [file, bytes] of originalDocuments) await writeFile(path.join(repositoryPath, file), bytes)
        const deadline = Date.now() + 5 * 60_000
        while (Date.now() < deadline) {
          const remaining = (await store.listHindsightProjections(prior.projectId))
            .filter((row) => row.status !== 'cancelled')
          if (!remaining.length) break
          await service.tick()
          await delay(1_000)
        }
        const remaining = (await store.listHindsightProjections(prior.projectId))
          .filter((row) => row.status !== 'cancelled')
        report.pendingCleanup = remaining.map((row) => ({ bank: row.bankId, documentId: row.documentId,
          operationId: row.operationId, status: row.status }))
        assert.equal(remaining.length, 0, 'Remote operations have not all settled and been cleaned')
        const cleanup: Record<string, unknown>[] = []
        for (const bank of banks) {
          let stats = await bankEvidence(bank, 'stats')
          const graphDeadline = Date.now() + 30_000
          while (stats.pending_operations! > 0 && Date.now() < graphDeadline) {
            await delay(1_000); stats = await bankEvidence(bank, 'stats')
          }
          const entities = await bankEvidence(bank, 'entities?limit=1')
          assert.equal(stats.total_documents, 0)
          assert.equal(stats.total_nodes, 0)
          assert.equal(stats.total_links, 0)
          assert.equal(stats.pending_operations, 0)
          assert.equal(entities.total, 0)
          cleanup.push({ bank, ...stats, entityCount: entities.total })
        }
        report.cleanup = { status: 'verified', restoredOriginalDocuments: true,
          configurationEnabled: (await service.status(scope)).enabled, banks: cleanup }
      } catch (error) {
        report.cleanup = { status: 'incomplete', error: error instanceof Error ? error.message : String(error) }
        report.completed = false
      }
    }
    store?.close()
    report.finishedAt = new Date().toISOString()
    await save()
    console.log(JSON.stringify({ completed: report.completed, failure: report.failure, output, cleanup: report.cleanup }))
  }
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runHindsightTodoLiveEvaluation()
  if (!report.completed) process.exitCode = 1
}
