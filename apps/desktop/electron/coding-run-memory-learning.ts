import { createHash } from 'node:crypto'
import {
  agentMemoryScopesMatch,
  createCodingRunMemoryCandidate,
  deriveCodingRunMemoryStatements,
  findDuplicateMemory,
  parseTestFailureLocations,
  type AgentMemoryCodingRunStatementKind,
  type AgentMemoryPromotionAuthority,
  type CodingAgentRun,
  type CodingRunMemoryFacts,
  type DurableAgentMemoryRevision,
  type KnowledgeRetrievalScope,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'

/**
 * ADR 0024 §4–5: after a Coding Run completes with passing evidence, turn its observable
 * facts into fixed-template Memory candidates, and let one bounded policy promote the
 * low-risk ones. Nothing here calls a model. Every id is derived from the Coding Run, so
 * a retry replays instead of duplicating.
 */
export const CODING_RUN_MEMORY_POLICY_ID = 'desktop-coding-run-memory-policy'
export const CODING_RUN_MEMORY_POLICY_VERSION = 1
export const CODING_RUN_MEMORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
const POLICY_PROMOTABLE_KINDS: ReadonlySet<AgentMemoryCodingRunStatementKind> = new Set(['test_command', 'change_map'])

export type CodingRunMemoryLearningStore = Pick<LocalStore,
  | 'getRun'
  | 'listProjects'
  | 'listTestEvidence'
  | 'saveAgentMemoryCandidate'
  | 'listAgentMemoryHeads'
  | 'listAgentMemoryRevisions'
  | 'getAgentMemoryTombstone'
  | 'authorizeAgentMemoryPromotion'
  | 'commitAgentMemoryPromotion'
> & Partial<Pick<LocalStore, 'listCodingChangeSets'>>

export type CodingRunMemoryLearningResult = {
  /** Why nothing was learned; absent when candidates were derived. */
  skipped?: 'not_eligible' | 'no_statements'
  candidates: Array<{
    candidateId: string
    kind: AgentMemoryCodingRunStatementKind
    outcome: 'proposed' | 'replayed' | 'rejected'
    reason?: string
  }>
  promoted: Array<{ candidateId: string; memoryId: string }>
  notPromoted: Array<{
    candidateId: string
    reason: 'human_review_required' | 'duplicate' | 'already_promoted' | 'rejected'
    duplicateOf?: string
  }>
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Stored test output replaces the worktree root with `<workspace>`; restore relative paths. */
function workspaceRelative(output: string): string {
  return output.replace(/<workspace>[\\/]/gu, '')
}

async function activeMemoriesInScope(
  store: CodingRunMemoryLearningStore,
  scope: KnowledgeRetrievalScope,
  now: string,
): Promise<DurableAgentMemoryRevision[]> {
  const heads = (await store.listAgentMemoryHeads(scope.localProjectId))
    .filter((head) => head.status === 'active' && agentMemoryScopesMatch(head.scope, scope, 'user_project'))
  const active: DurableAgentMemoryRevision[] = []
  for (const head of heads) {
    const [revisions, tombstone] = await Promise.all([
      store.listAgentMemoryRevisions(head.memoryId),
      store.getAgentMemoryTombstone(head.memoryId),
    ])
    const current = revisions.find((revision) => revision.revision === head.currentRevision)
    if (
      current?.status === 'active' && tombstone === null &&
      (current.expiresAt === null || Date.parse(current.expiresAt) > Date.parse(now))
    ) active.push(current)
  }
  return active
}

export async function learnFromCompletedCodingRun(input: {
  store: CodingRunMemoryLearningStore
  codingRun: CodingAgentRun
  /** The current-evidence evaluation recorded at completion passed. */
  evaluationPassed: boolean
  now?: () => string
}): Promise<CodingRunMemoryLearningResult> {
  const result: CodingRunMemoryLearningResult = { candidates: [], promoted: [], notPromoted: [] }
  const { store, codingRun } = input
  const clock = input.now ?? (() => new Date().toISOString())
  const receipt = codingRun.contextReceipt
  if (
    !input.evaluationPassed ||
    codingRun.status !== 'completed' ||
    codingRun.engine === 'fake' ||
    !receipt ||
    !codingRun.completedAt ||
    !codingRun.testEvidenceId ||
    !codingRun.diffArtifactId
  ) return { ...result, skipped: 'not_eligible' }

  const [workflow, projects, evidence, changeSets] = await Promise.all([
    store.getRun(codingRun.runId),
    store.listProjects(),
    store.listTestEvidence(codingRun.runId),
    store.listCodingChangeSets ? store.listCodingChangeSets(codingRun.id) : Promise.resolve([]),
  ])
  const node = workflow?.nodes.find((candidate) => candidate.id === codingRun.nodeId)
  const project = projects.find((candidate) => candidate.id === codingRun.projectId)
  const passing = evidence.find((candidate) => candidate.id === codingRun.testEvidenceId)
  if (!workflow || !node || !project || passing?.status !== 'passed') return { ...result, skipped: 'not_eligible' }

  const facts: CodingRunMemoryFacts = {
    runTitle: workflow.title,
    nodeTitle: node.title,
    testCommand: project.testCommand.trim(),
    testPassed: passing.command === project.testCommand.trim() && passing.exitCode === 0,
    changedPaths: codingRun.changedPaths,
  }
  // A repair pattern exists only when the accepted final Change Set is the repair one.
  const repair = changeSets.find((changeSet) => changeSet.phase === 'repair' && changeSet.id === codingRun.changeSetId)
  const firstFailure = evidence
    .filter((candidate) =>
      candidate.id !== passing.id && candidate.nodeId === codingRun.nodeId && candidate.projectId === project.id &&
      candidate.status !== 'passed' && candidate.createdAt >= codingRun.startedAt && candidate.createdAt <= passing.createdAt)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0]
  if (repair && firstFailure) {
    facts.repair = {
      failureSummary: firstFailure.summary.replace(/<workspace>/gu, 'the workspace'),
      failureLocations: parseTestFailureLocations(
        workspaceRelative(`${firstFailure.stdout}\n${firstFailure.stderr}`), { workspaceRoots: [] }),
      repairedPaths: repair.changes.map((change) => change.path),
    }
  }
  const statements = deriveCodingRunMemoryStatements(facts)
  if (statements.length === 0) return { ...result, skipped: 'no_statements' }

  const active = await activeMemoriesInScope(store, receipt.scope, clock())
  for (const entry of statements) {
    const candidateId = `agent-memory-candidate-coding-${digest(`${codingRun.id}:${entry.kind}`).slice(0, 32)}`
    const candidate = await createCodingRunMemoryCandidate({
      id: candidateId,
      statement: entry.statement,
      scope: receipt.scope,
      provenance: {
        kind: 'coding_run', runId: codingRun.runId, nodeId: codingRun.nodeId, codingRunId: codingRun.id,
        testEvidenceId: codingRun.testEvidenceId, diffArtifactId: codingRun.diffArtifactId, statementKind: entry.kind,
      },
      // Deterministic, so a retried completion replays the identical candidate.
      createdAt: codingRun.completedAt,
    })
    const saved = await store.saveAgentMemoryCandidate(candidate)
    if (!saved.committed) {
      result.candidates.push({ candidateId, kind: entry.kind, outcome: 'rejected', reason: saved.reason })
      continue
    }
    result.candidates.push({ candidateId, kind: entry.kind, outcome: saved.replayed ? 'replayed' : 'proposed' })

    if (!POLICY_PROMOTABLE_KINDS.has(entry.kind)) {
      result.notPromoted.push({ candidateId, reason: 'human_review_required' })
      continue
    }
    const duplicate = findDuplicateMemory(candidate.statement, active, (revision) => revision.statement)
    if (duplicate) {
      result.notPromoted.push({ candidateId, reason: 'duplicate', duplicateOf: duplicate.item.id })
      continue
    }
    const decidedAt = clock()
    const key = digest(candidateId).slice(0, 32)
    const unsigned: Omit<AgentMemoryPromotionAuthority, 'authorityDigest'> = {
      stateVersion: 1,
      decisionId: `agent-memory-policy-promotion-${key}`,
      candidateId,
      candidateContentDigest: candidate.contentDigest,
      scope: { ...candidate.scope },
      actorKind: 'policy',
      actorId: CODING_RUN_MEMORY_POLICY_ID,
      policyId: CODING_RUN_MEMORY_POLICY_ID,
      policyVersion: CODING_RUN_MEMORY_POLICY_VERSION,
      visibility: 'user_project',
      sensitivity: 'private',
      retentionClass: 'thirty_days',
      expiresAt: new Date(Date.parse(decidedAt) + CODING_RUN_MEMORY_RETENTION_MS).toISOString(),
      decidedAt,
    }
    const authorization = await store.authorizeAgentMemoryPromotion({
      candidateId,
      memoryId: `agent-memory-coding-${key}`,
      authority: { ...unsigned, authorityDigest: digest(JSON.stringify(unsigned)) },
    })
    if (!authorization.authorized) {
      result.notPromoted.push({ candidateId, reason: authorization.reason === 'already_promoted' ? 'already_promoted' : 'rejected' })
      continue
    }
    const committed = await store.commitAgentMemoryPromotion({ revision: authorization.revision }, authorization.capability)
    if (!committed.committed) {
      result.notPromoted.push({ candidateId, reason: 'rejected' })
      continue
    }
    result.promoted.push({ candidateId, memoryId: committed.revision.id })
    // Later statements from the same run are checked against this one too.
    active.push(committed.revision)
  }
  return result
}
