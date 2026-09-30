// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createCodingRunMemoryCandidate,
  sanitizeCodingDiffArtifact,
  type AgentMemoryCandidate,
  type AgentMemoryCodingRunProvenance,
  type CodingAgentRun,
  type DesktopPairingCredential,
  type KnowledgeRetrievalScope,
  type LocalProject,
  type TestEvidence,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { createLocalStore, type LocalStore } from './local-store'
import { schemaMigrations } from './local-store-schema'
import { learnFromCompletedCodingRun, type CodingRunMemoryLearningStore } from './coding-run-memory-learning'

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

const require = createRequire(import.meta.url)
const sqlJsDist = path.dirname(require.resolve('sql.js/dist/sql-wasm.wasm'))

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function tempDbPath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-coding-memory-'))
  directories.push(directory)
  return path.join(directory, 'devflow.sqlite')
}

const project: LocalProject = {
  id: 'coding-memory-project', name: 'coding-memory', path: '/tmp/coding-memory-project',
  packageManager: 'npm', detectedTestCommand: 'npm test', testCommand: 'npm test',
  createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z',
}
const run: WorkflowRun = {
  id: 'coding-memory-run', version: 2, title: 'Filter completed tasks', request: 'Filter completed tasks.',
  projectId: project.id, creatorId: 'u-owner', status: 'testing', currentNodeId: 'coding-memory-test',
  branchName: 'devflow/coding-memory', createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:05:00.000Z',
  nodes: [
    { id: 'coding-memory-build', stage: 'build', title: 'Implement filter', subtitle: 'Change the task list', kind: 'task', status: 'success', ownerId: 'u-owner', retryCount: 0, artifactIds: [] },
    { id: 'coding-memory-test', stage: 'test', title: 'Test', subtitle: 'Saved test', kind: 'task', status: 'running', ownerId: 'u-owner', retryCount: 0, artifactIds: [] },
  ],
  edges: [],
}
const localScope: KnowledgeRetrievalScope = {
  kind: 'local', organizationId: null, projectId: null, userId: 'u-owner',
  sessionId: 'coding-session-0123456789abcdef', localProjectId: project.id,
}
const evidence: TestEvidence = {
  id: 'coding-test-passed', runId: run.id, nodeId: 'coding-memory-build', projectId: project.id,
  command: 'npm test', cwd: '<workspace>', status: 'passed', exitCode: 0, durationMs: 120,
  stdout: 'ok', stderr: '', summary: 'Tests passed.', redacted: true, createdAt: '2026-09-30T00:03:00.000Z',
}
const diff = sanitizeCodingDiffArtifact({
  id: 'coding-diff-1', runId: run.id, nodeId: 'coding-memory-build', projectId: project.id,
  changedPaths: ['src/filter.ts'], patch: '+export const filter = true\n', createdAt: '2026-09-30T00:03:30.000Z',
})
function completedCodingRun(scope: KnowledgeRetrievalScope = localScope): CodingAgentRun {
  return {
    id: 'coding-run-memory-1', runId: run.id, nodeId: 'coding-memory-build', projectId: project.id,
    requestedBy: scope.userId, providerId: 'deepseek', engine: 'native', status: 'completed',
    branchName: run.branchName, userInstruction: 'Filter completed tasks.', prompt: 'brief',
    summary: 'Done.', changedPaths: ['src/filter.ts'], startedAt: '2026-09-30T00:01:00.000Z',
    completedAt: '2026-09-30T00:04:00.000Z', diffArtifactId: diff.id, testEvidenceId: evidence.id, redacted: true,
    contextReceipt: {
      stateVersion: 1, runId: run.id, nodeId: 'coding-memory-build', runVersion: 1,
      runtimeId: 'agent-runtime-coding-coding-run-memory-1', scope, memories: [], omittedMemoryCount: 0,
      promptDigest: 'a'.repeat(64),
      compaction: { stateVersion: 1, compacted: false, originalBytes: 5, finalBytes: 5, budgetBytes: 24_000, sources: [] },
    } as unknown as NonNullable<CodingAgentRun['contextReceipt']>,
  }
}
const provenance: AgentMemoryCodingRunProvenance = {
  kind: 'coding_run', runId: run.id, nodeId: 'coding-memory-build', codingRunId: 'coding-run-memory-1',
  testEvidenceId: evidence.id, diffArtifactId: diff.id, statementKind: 'change_map',
}
const statement = 'Change map: "Filter completed tasks" (Implement filter) was implemented by changing src/filter.ts.'

function candidateFor(scope: KnowledgeRetrievalScope = localScope, overrides: Partial<AgentMemoryCodingRunProvenance> = {}) {
  return createCodingRunMemoryCandidate({
    id: `agent-memory-candidate-coding-${overrides.statementKind ?? 'change_map'}`,
    statement, scope, provenance: { ...provenance, ...overrides }, createdAt: '2026-09-30T00:04:01.000Z',
  })
}

async function seed(store: LocalStore, codingRun: CodingAgentRun = completedCodingRun(), test: TestEvidence = evidence) {
  await store.upsertProject(project)
  await store.saveRun(run)
  await store.saveTestEvidence(test)
  await store.saveCodingDiffArtifact(diff)
  await store.saveCodingAgentRun(codingRun)
}

describe('Coding Run Memory candidates in the local store (ADR 0024 §4)', () => {
  it('accepts a candidate from a completed, test-passing Coding Run once and replays it after restart', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await seed(store)
    const candidate = await candidateFor()
    expect(candidate.provenance).toEqual(provenance)
    await expect(store.saveAgentMemoryCandidate(candidate)).resolves.toEqual({ committed: true, replayed: false, candidate })
    store.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(reopened.listAgentMemoryCandidates(project.id)).resolves.toEqual([candidate])
    await expect(reopened.saveAgentMemoryCandidate(candidate)).resolves.toEqual({ committed: true, replayed: true, candidate })
    reopened.close()

    const SQL = await initSqlJs({ locateFile: (fileName) => path.join(sqlJsDist, fileName) })
    const inspected = new SQL.Database(await readFile(dbPath))
    expect(inspected.exec('select provenance_kind, runtime_id, coding_run_id from agent_memory_candidates')[0]?.values)
      .toEqual([['coding_run', null, 'coding-run-memory-1']])
    inspected.close()
  })

  it.each([
    ['a Coding Run that is not completed', { status: 'failed' as const }, undefined],
    ['a fake Coding Run', { engine: 'fake' as const }, undefined],
    ['a Coding Run whose saved test failed', {}, { status: 'failed' as const, exitCode: 1 }],
    ['evidence from another command', {}, { command: 'npm run lint' }],
  ])('rejects %s', async (_label, runOverrides, testOverrides) => {
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    await seed(store, { ...completedCodingRun(), ...runOverrides }, { ...evidence, ...testOverrides })
    await expect(store.saveAgentMemoryCandidate(await candidateFor())).resolves
      .toEqual({ committed: false, reason: 'source_not_found' })
    await expect(store.listAgentMemoryCandidates(project.id)).resolves.toEqual([])
    store.close()
  })

  it('rejects provenance that does not match the Coding Run and a scope other than its Context receipt', async () => {
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    await seed(store)
    await expect(store.saveAgentMemoryCandidate(await candidateFor(localScope, { diffArtifactId: 'coding-diff-other' })))
      .resolves.toEqual({ committed: false, reason: 'source_not_found' })
    await expect(store.saveAgentMemoryCandidate(await candidateFor({ ...localScope, userId: 'u-other' })))
      .resolves.toEqual({ committed: false, reason: 'scope_mismatch' })
    store.close()
  })

  it('never enqueues a Team summary for Team-scoped Memory learned from a Coding Run', async () => {
    const pairing: DesktopPairingCredential = {
      tokenId: 'pairing-token', organizationId: 'org-1', projectId: 'team-project-1', localProjectId: project.id,
      userId: 'u-owner', role: 'member', authAccountId: 'account-1', projectMemberships: [], createdAt: '2026-09-30T00:00:00.000Z',
    }
    const teamScope: KnowledgeRetrievalScope = {
      kind: 'team', organizationId: 'org-1', projectId: 'team-project-1', userId: 'u-owner',
      sessionId: 'pairing-token', localProjectId: project.id,
    }
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    await store.saveDesktopPairingCredential(pairing, 'encrypted-test-token')
    await seed(store, completedCodingRun(teamScope))
    const candidate: AgentMemoryCandidate = await candidateFor(teamScope)
    await expect(store.saveAgentMemoryCandidate(candidate)).resolves.toMatchObject({ committed: true })
    const before = (await store.listRemoteSyncOperations()).filter((operation) => operation.kind === 'agent-memory-summary')
    const authorization = await store.authorizeAgentMemoryPromotion({
      candidateId: candidate.id, memoryId: 'agent-memory-coding-team',
      authority: {
        stateVersion: 1, decisionId: 'agent-memory-coding-team-promotion', candidateId: candidate.id,
        candidateContentDigest: candidate.contentDigest, scope: teamScope, actorKind: 'policy',
        actorId: 'desktop-coding-run-memory-policy', policyId: 'desktop-coding-run-memory-policy', policyVersion: 1,
        visibility: 'user_project', sensitivity: 'private', retentionClass: 'thirty_days',
        expiresAt: '2026-10-30T00:04:02.000Z', authorityDigest: 'e'.repeat(64), decidedAt: '2026-09-30T00:04:02.000Z',
      },
    })
    if (!authorization.authorized) throw new Error(`expected promotion authority: ${authorization.reason}`)
    await expect(store.commitAgentMemoryPromotion({ revision: authorization.revision }, authorization.capability))
      .resolves.toMatchObject({ committed: true, replayed: false })
    const after = (await store.listRemoteSyncOperations()).filter((operation) => operation.kind === 'agent-memory-summary')
    expect(after).toEqual(before)
    await expect(store.getAgentMemoryTeamProjectionInput('agent-memory-coding-team')).resolves.toBeNull()
    store.close()
  })

  it('migrates retained schema 36 candidates to observation provenance and keeps revision references', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    await initial.upsertProject(project)
    initial.close()
    const SQL = await initSqlJs({ locateFile: (fileName) => path.join(sqlJsDist, fileName) })
    const retained = new SQL.Database(await readFile(dbPath))
    // Recreate the exact schema 23–36 candidate table and one observation row in it.
    retained.run('drop index idx_agent_memory_candidates_scope; drop index idx_agent_memory_candidates_coding_run; drop table agent_memory_candidates')
    schemaMigrations.find((migration) => migration.version === 23)!.migrate(retained, {
      migrateWorkflowRunsIntoRelationalTables: () => undefined, afterMigrations: () => undefined,
    })
    const legacyProvenance = {
      kind: 'agent_observation', runtimeId: 'agent-runtime-legacy', actionId: 'action-legacy',
      checkpointVersion: 3, sequence: 5, resultDigest: 'b'.repeat(64),
    }
    const legacyStatement = 'The saved health test is the regression check.'
    const legacy = {
      stateVersion: 1, id: 'memory-candidate-legacy', status: 'candidate', scope: localScope,
      statement: legacyStatement, contentDigest: sha256(legacyStatement), provenance: legacyProvenance,
      provenanceDigest: sha256(JSON.stringify(legacyProvenance)), createdAt: '2026-09-29T00:00:00.000Z',
    }
    retained.run(
      `insert into agent_memory_candidates (id, scope_kind, local_project_id, organization_id, team_project_id,
         user_id, session_id, runtime_id, action_id, checkpoint_version, observation_sequence, result_digest,
         statement, content_digest, provenance_digest, status, state_version, json, created_at)
       values (?, 'local', ?, null, null, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', 1, ?, ?)`,
      [legacy.id, project.id, localScope.userId, localScope.sessionId, legacyProvenance.runtimeId,
        legacyProvenance.actionId, 3, 5, legacyProvenance.resultDigest, legacyStatement, legacy.contentDigest,
        legacy.provenanceDigest, JSON.stringify(legacy), legacy.createdAt],
    )
    retained.run("update schema_meta set value = '36' where key = 'schema_version'")
    await writeFile(dbPath, Buffer.from(retained.export()))
    retained.close()

    const migrated = await createLocalStore({ dbPath })
    await expect(migrated.getSchemaVersion()).resolves.toBe(37)
    await expect(migrated.listAgentMemoryCandidates(project.id)).resolves.toEqual([legacy])
    migrated.close()
    const inspected = new SQL.Database(await readFile(dbPath))
    expect(inspected.exec('select provenance_kind, coding_run_id from agent_memory_candidates')[0]?.values)
      .toEqual([['agent_observation', null]])
    const columns = inspected.exec('pragma table_info(agent_memory_candidates)')[0]?.values
      .map((row) => [String(row[1]), Number(row[3])]) ?? []
    expect(columns).toEqual(expect.arrayContaining([['provenance_kind', 1], ['runtime_id', 0], ['coding_run_id', 0]]))
    const parents = inspected.exec('pragma foreign_key_list(agent_memory_revisions)')[0]?.values.map((row) => String(row[2])) ?? []
    expect(parents).toContain('agent_memory_candidates')
    expect(parents).not.toContain('agent_memory_candidates_v36')
    expect(inspected.exec("select name from sqlite_master where name = 'agent_memory_candidates_v36'")).toEqual([])
    inspected.close()
  })
})

describe('learning Memory from a completed Coding Run (ADR 0024 §4–5)', () => {
  const now = () => '2026-09-30T00:05:00.000Z'
  function withRepair(store: LocalStore, codingRun: CodingAgentRun): CodingRunMemoryLearningStore {
    // A stored repair Change Set needs a real worktree digest; the learning step reads only these fields.
    const repair = { id: 'coding-change-set-repair', phase: 'repair', changes: [{ path: 'src/filter.ts' }] }
    return {
      getRun: (id) => store.getRun(id), listProjects: () => store.listProjects(),
      listTestEvidence: (runId) => store.listTestEvidence(runId),
      saveAgentMemoryCandidate: (candidate) => store.saveAgentMemoryCandidate(candidate),
      listAgentMemoryHeads: (projectId) => store.listAgentMemoryHeads(projectId),
      listAgentMemoryRevisions: (memoryId) => store.listAgentMemoryRevisions(memoryId),
      getAgentMemoryTombstone: (memoryId) => store.getAgentMemoryTombstone(memoryId),
      authorizeAgentMemoryPromotion: (input) => store.authorizeAgentMemoryPromotion(input),
      commitAgentMemoryPromotion: (input, capability) => store.commitAgentMemoryPromotion(input, capability),
      listCodingChangeSets: async (codingRunId) => codingRunId === codingRun.id
        ? [repair as unknown as Awaited<ReturnType<LocalStore['listCodingChangeSets']>>[number]] : [],
    }
  }

  it('proposes fixed-template candidates, promotes the low-risk ones for 30 days and replays on retry', async () => {
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    const codingRun = completedCodingRun()
    await seed(store, codingRun)
    const learned = await learnFromCompletedCodingRun({ store, codingRun, evaluationPassed: true, now })
    expect(learned.candidates.map(({ kind, outcome }) => [kind, outcome])).toEqual([
      ['test_command', 'proposed'], ['change_map', 'proposed'],
    ])
    expect(learned.promoted).toHaveLength(2)
    const revisions = await Promise.all(learned.promoted.map(async ({ memoryId }) => (await store.listAgentMemoryRevisions(memoryId))[0]!))
    for (const revision of revisions) {
      expect(revision).toMatchObject({
        visibility: 'user_project', sensitivity: 'private', retentionClass: 'thirty_days',
        expiresAt: '2026-10-30T00:05:00.000Z', promotionActorKind: 'policy',
        promotionPolicyId: 'desktop-coding-run-memory-policy', promotionPolicyVersion: 1,
      })
    }
    // A later Coding Run with its own local session recalls the learned facts.
    const recalled = await store.retrieveAgentMemoryRevisions({
      stateVersion: 1, id: 'later-coding-run-recall', runtimeId: 'agent-runtime-coding-later',
      scope: { ...localScope, sessionId: 'coding-session-later' }, limit: 8, requestedAt: '2026-10-01T00:00:00.000Z',
    })
    expect(recalled.map((revision) => revision.id).sort()).toEqual(learned.promoted.map(({ memoryId }) => memoryId).sort())

    const retried = await learnFromCompletedCodingRun({ store, codingRun, evaluationPassed: true, now })
    expect(retried.candidates.map(({ outcome }) => outcome)).toEqual(['replayed', 'replayed'])
    expect(retried.promoted).toEqual([])
    expect(retried.notPromoted.map(({ reason }) => reason)).toEqual(['duplicate', 'duplicate'])
    expect(await store.listAgentMemoryCandidates(project.id)).toHaveLength(2)
    store.close()
  })

  it('records a repair pattern for human review with the first failure location', async () => {
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    const codingRun = { ...completedCodingRun(), changeSetId: 'coding-change-set-repair' }
    await seed(store, codingRun)
    await store.saveTestEvidence({
      ...evidence, id: 'coding-test-failed', status: 'failed', exitCode: 1, createdAt: '2026-09-30T00:02:00.000Z',
      summary: 'Coding worktree tests failed in <workspace>.',
      stdout: 'FAIL src/filter.test.ts\n ❯ <workspace>/src/filter.test.ts:12:5\n ❯ [REDACTED:local_absolute_path]:3:1',
    })
    const learned = await learnFromCompletedCodingRun({ store: withRepair(store, codingRun), codingRun, evaluationPassed: true, now })
    expect(learned.candidates.map(({ kind }) => kind)).toEqual(['test_command', 'change_map', 'repair_pattern'])
    expect(learned.notPromoted).toEqual([expect.objectContaining({ reason: 'human_review_required' })])
    const repair = (await store.listAgentMemoryCandidates(project.id)).find((candidate) =>
      candidate.provenance.kind === 'coding_run' && candidate.provenance.statementKind === 'repair_pattern')!
    expect(repair.statement).toContain('first reported at src/filter.test.ts:12')
    expect(repair.statement).toContain('the accepted repair changed src/filter.ts')
    expect(repair.statement).not.toContain('<workspace>')
    store.close()
  })

  it('learns nothing when the evaluation failed or the run is not eligible', async () => {
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    const codingRun = completedCodingRun()
    await seed(store, codingRun)
    await expect(learnFromCompletedCodingRun({ store, codingRun, evaluationPassed: false, now }))
      .resolves.toMatchObject({ skipped: 'not_eligible', candidates: [] })
    const { contextReceipt: _receipt, ...withoutReceipt } = codingRun
    await expect(learnFromCompletedCodingRun({ store, codingRun: withoutReceipt, evaluationPassed: true, now }))
      .resolves.toMatchObject({ skipped: 'not_eligible', candidates: [] })
    await expect(store.listAgentMemoryCandidates(project.id)).resolves.toEqual([])
    store.close()
  })
})
