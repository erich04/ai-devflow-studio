import { createHash } from 'node:crypto'
import type { AgentRuntimeState, NativeToolDefinition } from '@ai-devflow/shared'
import { hasSupportedCodingDiffSanitization } from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'
import type { NativeToolRegistration } from './native-tool-registry.js'

export const WORKFLOW_EVALUATION_TOOL_ID = 'workflow.evaluate'
type EvaluationStore = Pick<LocalStore, 'getRun' | 'listProjects' | 'listArtifacts' | 'listCodingAgentRuns' | 'listCodingDiffArtifacts' | 'listTestEvidence'>
type Target = { runId: string; nodeId: string; localProjectId: string; runVersion: number; codingRunId?: string }
export type WorkflowEvidenceEvaluation = {
  passed: boolean
  failures: string[]
  evidenceDigest: string
  artifactCount: number
  testEvidenceCount: number
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Read authoritative local evidence, never a model's claim that its work passed. */
export async function evaluateCurrentWorkflowEvidence(store: EvaluationStore, target: Target): Promise<WorkflowEvidenceEvaluation> {
  const run = await store.getRun(target.runId)
  const node = run?.nodes.find((candidate) => candidate.id === target.nodeId)
  if (!run || !node || run.projectId !== target.localProjectId || run.version !== target.runVersion) {
    throw new Error('Workflow evaluation target is stale')
  }
  const [artifacts, codingRuns, diffs, tests, projects] = await Promise.all([
    store.listArtifacts(run.id), store.listCodingAgentRuns(run.id),
    store.listCodingDiffArtifacts(run.id), store.listTestEvidence(run.id), store.listProjects(),
  ])
  const project = projects.find((candidate) => candidate.id === target.localProjectId)
  if (!project) throw new Error('Workflow evaluation Local Project is missing')
  const failures: string[] = []
  const sourceArtifacts = artifacts.filter((artifact) => artifact.runId === run.id &&
    run.nodes.some((candidate) => candidate.id === artifact.nodeId && candidate.stage === node.stage))
  const coding = codingRuns.filter((candidate) => candidate.runId === run.id && candidate.projectId === project.id &&
    (node.stage !== 'build' || candidate.nodeId === node.id) &&
    (target.codingRunId === undefined || candidate.id === target.codingRunId))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))[0]
  const diff = coding && diffs.find((candidate) => candidate.id === coding.diffArtifactId &&
    candidate.runId === run.id && candidate.nodeId === coding.nodeId && candidate.projectId === project.id)
  const canonicalTests = tests.filter((test) => test.runId === run.id && test.projectId === project.id &&
    test.command === project.testCommand.trim() && (!coding || test.createdAt >= coding.startedAt))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  const latestTest = canonicalTests[0]

  if (node.stage === 'clarify' || node.stage === 'design') {
    const kind = node.stage === 'clarify' ? 'clarification' : 'design'
    if (!sourceArtifacts.some((artifact) => artifact.kind === kind && artifact.content.trim().length > 0)) {
      failures.push(`insufficient_evidence:missing_${kind}_artifact`)
    }
  } else if (node.stage === 'build' || node.stage === 'test') {
    if (!coding || coding.engine === 'fake' || coding.status !== 'completed') failures.push('insufficient_evidence:completed_real_coding_run')
    if (!diff || !hasSupportedCodingDiffSanitization(diff) || diff.changedPaths.length === 0 || !diff.patch.trim()) {
      failures.push('insufficient_evidence:current_coding_diff')
    }
    if (!latestTest) failures.push('insufficient_evidence:executed_saved_test')
    else if (latestTest.status !== 'passed' || latestTest.exitCode !== 0) failures.push('test_failed:latest_saved_test')
    if (coding) {
      const codingTest = canonicalTests.find((test) => test.id === coding.testEvidenceId && test.nodeId === coding.nodeId)
      if (!codingTest) failures.push('insufficient_evidence:coding_test_provenance')
      else if (codingTest.status !== 'passed' || codingTest.exitCode !== 0) failures.push('test_failed:coding_test')
    }
  } else {
    failures.push('unsupported_stage:use_delivery_and_acceptance_gates')
  }
  const evidenceDigest = digest({
    target, requestDigest: digest(run.request), stage: node.stage, testCommand: project.testCommand,
    artifacts: sourceArtifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, updatedAt: artifact.updatedAt, digest: digest(artifact.content) })).sort((a, b) => a.id.localeCompare(b.id)),
    coding: coding ? { id: coding.id, status: coding.status, engine: coding.engine, promptDigest: coding.contextReceipt?.promptDigest, diffArtifactId: coding.diffArtifactId, testEvidenceId: coding.testEvidenceId } : null,
    diff: diff ? { id: diff.id, sourceDigest: diff.sourceDigest, digest: digest(diff.patch), paths: diff.changedPaths } : null,
    tests: canonicalTests.map((test) => ({ id: test.id, nodeId: test.nodeId, status: test.status, exitCode: test.exitCode, createdAt: test.createdAt, sourceCommitSha: test.sourceCommitSha, digest: digest([test.stdout, test.stderr]) })),
  })
  return { passed: failures.length === 0, failures, evidenceDigest, artifactCount: sourceArtifacts.length + (diff ? 1 : 0), testEvidenceCount: canonicalTests.length }
}

export function workflowEvaluationTarget(runtime: AgentRuntimeState): Target {
  return { runId: runtime.authority.runId, nodeId: runtime.authority.nodeId, runVersion: runtime.authority.runVersion, localProjectId: runtime.scope.localProjectId }
}

const definition: NativeToolDefinition = {
  stateVersion: 1, id: WORKFLOW_EVALUATION_TOOL_ID, version: 1, source: 'native',
  description: 'Read current local Artifact, Coding Diff and executed Test Evidence; check evidence completeness without granting workflow approval.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: { evidenceDigest: { type: 'string', minLength: 64, maxLength: 64 } }, required: ['evidenceDigest'],
  },
  outputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      passed: { type: 'boolean' },
      failures: { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 240 } },
      evidenceDigest: { type: 'string', minLength: 64, maxLength: 64 },
      artifactCount: { type: 'integer', minimum: 0, maximum: 100_000 },
      testEvidenceCount: { type: 'integer', minimum: 0, maximum: 100_000 },
    }, required: ['passed', 'failures', 'evidenceDigest', 'artifactCount', 'testEvidenceCount'],
  },
  permissionClass: 'execute', sideEffectClass: 'none', defaultDeadlineMs: 5_000,
  maxResultBytes: 16 * 1_024, idempotency: 'idempotent', auditPolicy: 'redacted_metadata_only',
}

export function createWorkflowEvaluationRegistration(store: EvaluationStore): NativeToolRegistration {
  return {
    definition,
    handler: async ({ runtime, resourceScope, input }) => {
      if (resourceScope.kind !== 'local_project' || resourceScope.localProjectId !== runtime.scope.localProjectId) {
        throw new Error('Workflow evaluation scope is invalid')
      }
      const result = await evaluateCurrentWorkflowEvidence(store, workflowEvaluationTarget(runtime))
      if (result.evidenceDigest !== (input as { evidenceDigest: string }).evidenceDigest) throw new Error('Workflow evidence changed before evaluation')
      return result
    },
  }
}
