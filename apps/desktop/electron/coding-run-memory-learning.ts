import { createHash } from 'node:crypto'
import {
  CODING_RUN_MEMORY_POLICY_KINDS,
  createCodingRunMemoryCandidate,
  deriveCodingRunMemoryStatements,
  findDuplicateMemory,
  parseTestFailureLocations,
  type AgentMemoryCodingRunStatementKind,
  type CodingAgentRun,
  type CodingRunMemoryFacts,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'
import { listActiveAgentMemoryRevisions } from './agent-memory-authority.js'
import { createCodingRunPolicyAuthority } from './coding-run-memory-policy.js'

/**
 * ADR 0024 §4–5: after a Coding Run completes with passing evidence, turn its observable
 * facts into fixed-template Memory candidates, and let one bounded policy save the saved
 * test command. Nothing here calls a model. Every id is derived from the Coding Run, so a
 * retry replays instead of duplicating.
 */

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
    /**
     * `duplicate`: an active Memory already holds this statement, so nothing was saved.
     * `dismissed`: a person already dismissed this candidate, so it is not proposed again.
     */
    outcome: 'proposed' | 'replayed' | 'rejected' | 'duplicate' | 'dismissed'
    reason?: string
    duplicateOf?: string
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

  const active = await listActiveAgentMemoryRevisions(store, receipt.scope, clock())
  for (const entry of statements) {
    const candidateId = `agent-memory-candidate-coding-${digest(`${codingRun.id}:${entry.kind}`).slice(0, 32)}`
    // A statement another active Memory already holds is not saved again: it could never
    // be promoted and would only crowd out candidates that need review (ADR 0024 §5).
    const duplicate = findDuplicateMemory(entry.statement, active, (revision) => revision.statement)
    const duplicateOfOther = duplicate && duplicate.item.sourceCandidateId !== candidateId ? duplicate : null
    if (duplicateOfOther?.kind === 'exact') {
      result.candidates.push({ candidateId, kind: entry.kind, outcome: 'duplicate', duplicateOf: duplicateOfOther.item.id })
      continue
    }
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
      result.candidates.push(saved.reason === 'dismissed'
        ? { candidateId, kind: entry.kind, outcome: 'dismissed' }
        : { candidateId, kind: entry.kind, outcome: 'rejected', reason: saved.reason })
      continue
    }
    result.candidates.push({ candidateId, kind: entry.kind, outcome: saved.replayed ? 'replayed' : 'proposed' })

    // Titles and model-chosen paths are untrusted; only the saved test command is promoted
    // without review.
    if (!CODING_RUN_MEMORY_POLICY_KINDS.includes(entry.kind)) {
      result.notPromoted.push({ candidateId, reason: 'human_review_required' })
      continue
    }
    if (duplicateOfOther) {
      result.notPromoted.push({ candidateId, reason: 'duplicate', duplicateOf: duplicateOfOther.item.id })
      continue
    }
    const key = digest(candidateId).slice(0, 32)
    const authorization = await store.authorizeAgentMemoryPromotion({
      candidateId,
      memoryId: `agent-memory-coding-${key}`,
      authority: createCodingRunPolicyAuthority({
        candidate, decisionId: `agent-memory-policy-promotion-${key}`, decidedAt: clock(),
      }),
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
