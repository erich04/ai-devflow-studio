import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import {
  applyWorkflowCommand,
  acceptAgentActionResult,
  cancelAgentRuntime,
  createAgentMemoryCandidate,
  createAgentRuntime,
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  createRemoteSyncOperation,
  createWorkflowRunFromRequest,
  createWarnOnlyDefaultPolicy,
  parseCurrentKnowledgeCitation,
  redactTestEvidenceForStorage,
  requestAgentAction,
  resumeAgentRuntime,
  resolveEffectivePolicy,
} from '@ai-devflow/shared'
import type {
  AgentEvent,
  AgentReviewResult,
  AgentTrace,
  AgentTokenUsage,
  AgentRuntimeStartRequest,
  AgentMemoryPromotionAuthority,
  Artifact,
  CodingAgentEvent,
  CodingAgentRun,
  CodingDiffArtifact,
  CodingPermissionDecision,
  CodingPermissionRequest,
  DependencyBootstrapEvidence,
  DesktopPairingCredential,
  GateCommand,
  GateCommandAcknowledgement,
  GateEnforcementDecision,
  GateOverrideDecision,
  GateCommandReceipt,
  GateAdvisory,
  LocalProject,
  KnowledgeCitation,
  KnowledgeRetrievalCandidateSet,
  KnowledgeRetrievalRequest,
  McpServerDefinition,
  ManagedCodingWorkspace,
  PolicySnapshot,
  RetryAttempt,
  TestEvidence,
  WorkRequest,
  WorkflowEvidenceSnapshot,
  WorkflowRun,
} from '@ai-devflow/shared'
import {
  createLocalStore,
  gateCommandExecutionFingerprint,
  KNOWLEDGE_INDEX_CHUNK_COUNT_MAX,
  type ActivateKnowledgeIndexSnapshotInput,
  type LocalStore,
  type WorkRequestMaterializationExpectedPairing,
  type SettleRemoteSyncOperationInput,
} from './local-store'

let tempDirs: string[] = []
const persistenceFailurePattern = /EISDIR|EPERM|directory|operation not permitted/i

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

async function tempDbPath() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'devflow-store-'))
  tempDirs.push(dir)
  return path.join(dir, 'devflow.sqlite')
}

const require = createRequire(import.meta.url)
const sqlJsDist = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'))
const dropAgentRuntimeSchemaSql = `
  drop table if exists local_mcp_installations;
  drop table if exists agent_runtime_tool_audits;
  drop table if exists agent_runtime_terminal_summaries;
  drop table if exists agent_runtime_capability_grants;
  drop table if exists agent_runtime_evaluations;
  drop table if exists agent_runtime_checkpoints;
  drop table if exists agent_runtime_events;
  drop table if exists agent_runtimes;
`
const dropKnowledgeIndexSchemaSql = `
  drop table if exists knowledge_citations;
  drop table if exists knowledge_index_vectors;
  drop table if exists knowledge_index_chunks;
  drop table if exists knowledge_index_snapshots;
`
const dropAgentMemorySchemaSql = `
  drop table if exists agent_memory_audits;
  drop table if exists agent_memory_index_entries;
  drop table if exists agent_memory_tombstones;
  drop table if exists agent_memory_heads;
  drop table if exists agent_memory_revisions;
  drop table if exists agent_memory_candidates;
`

async function writeLegacyV1Database(dbPath: string) {
  const SQL = await initSqlJs({
    locateFile: (fileName) => path.join(sqlJsDist, fileName),
  })
  const db = new SQL.Database()
  db.run(`
    create table schema_meta (
      key text primary key,
      value text not null
    );

    create table local_projects (
      id text primary key,
      json text not null,
      created_at text not null,
      updated_at text not null
    );

    create table workflow_runs (
      id text primary key,
      json text not null,
      created_at text not null,
      updated_at text not null
    );

    create table artifacts (
      id text primary key,
      run_id text not null,
      json text not null,
      updated_at text not null
    );

    create table agent_events (
      id text primary key,
      run_id text not null,
      sequence integer not null,
      json text not null,
      timestamp text not null
    );

    create table test_evidence (
      id text primary key,
      run_id text not null,
      node_id text not null,
      project_id text not null,
      json text not null,
      created_at text not null
    );
  `)
  db.run("insert into schema_meta (key, value) values ('schema_version', '1')")
  db.run(
    'insert into local_projects (id, json, created_at, updated_at) values (?, ?, ?, ?)',
    [project.id, JSON.stringify(project), project.createdAt, project.updatedAt],
  )
  const { version: _version, ...legacyRun } = run
  db.run(
    'insert into workflow_runs (id, json, created_at, updated_at) values (?, ?, ?, ?)',
    [run.id, JSON.stringify(legacyRun), run.createdAt, run.updatedAt],
  )
  await writeFile(dbPath, Buffer.from(db.export()))
  db.close()
}

const project: LocalProject = {
  id: 'project-1',
  name: 'fixture-project',
  path: '/tmp/fixture-project',
  packageManager: 'pnpm',
  detectedTestCommand: 'pnpm test',
  testCommand: 'pnpm test -- --run',
  createdAt: '2026-06-15T00:00:00.000Z',
  updatedAt: '2026-06-15T00:00:00.000Z',
}

const run: WorkflowRun = {
  id: 'run-1',
  version: 1,
  title: 'Run local tests',
  request: 'Archive local test evidence.',
  projectId: 'project-1',
  creatorId: 'user-1',
  status: 'testing',
  currentNodeId: 'node-test',
  branchName: 'ai/local-tests',
  createdAt: '2026-06-15T00:00:00.000Z',
  updatedAt: '2026-06-15T00:00:00.000Z',
  nodes: [],
  edges: [],
}

const evidence: TestEvidence = {
  id: 'evidence-1',
  runId: 'run-1',
  nodeId: 'node-test',
  projectId: 'project-1',
  command: 'pnpm test',
  cwd: '/tmp/fixture-project',
  status: 'passed',
  exitCode: 0,
  durationMs: 1200,
  stdout: 'tests passed',
  stderr: '',
  summary: 'Tests passed in 1.2s',
  redacted: false,
  createdAt: '2026-06-15T00:01:00.000Z',
}

const artifact: Artifact = {
  id: 'artifact-evidence-1',
  runId: 'run-1',
  nodeId: 'node-test',
  kind: 'test_report',
  title: 'Local test evidence',
  summary: 'Tests passed in 1.2s',
  content: 'tests passed',
  redacted: false,
  updatedAt: '2026-06-15T00:01:00.000Z',
}

const event: AgentEvent = {
  id: 'event-evidence-1',
  runId: 'run-1',
  nodeId: 'node-test',
  sequence: 1,
  kind: 'test_result',
  message: 'Tests passed in 1.2s',
  timestamp: '2026-06-15T00:01:00.000Z',
}

const mcpServer: McpServerDefinition = {
  id: 'mcp-filesystem',
  name: 'Filesystem',
  command: 'npx @modelcontextprotocol/server-filesystem',
  permission: 'read',
  enabledLocally: false,
  lastAuditEvent: 'Disabled for smoke test',
}

const gateAdvisory: GateAdvisory = {
  id: 'gate-advisory-review-1',
  runId: 'run-1',
  nodeId: 'node-test',
  level: 'warn',
  blocksApproval: false,
  summary: 'Review has non-blocking evidence gaps.',
  missingEvidence: ['Attach local test evidence.'],
  riskCount: 1,
  createdAt: '2026-06-15T00:02:00.000Z',
}

const agentReview: AgentReviewResult = {
  id: 'agent-review-1',
  requestId: 'request-1',
  runId: 'run-1',
  nodeId: 'node-test',
  projectId: 'project-1',
  runtime: 'electron',
  providerId: 'fake-knowledge-review',
  model: 'fake',
  conclusion: 'Knowledge review completed.',
  summary: 'Review has non-blocking evidence gaps.',
  risks: ['Gate requires evidence.'],
  missingEvidence: ['Attach local test evidence.'],
  suggestedTests: ['Run pnpm test.'],
  knowledgeReferences: [],
  policyFindings: [],
  confidence: 0.82,
  gateAdvisory,
  createdAt: '2026-06-15T00:02:00.000Z',
}

const agentTrace: AgentTrace = {
  id: 'agent-trace-1',
  runId: 'run-1',
  nodeId: 'node-test',
  reviewId: 'agent-review-1',
  runtime: 'electron',
  createdAt: '2026-06-15T00:02:00.000Z',
  steps: [
    {
      id: 'agent-trace-step-1',
      kind: 'context',
      label: 'Build redacted context',
      summary: 'Context prepared.',
      timestamp: '2026-06-15T00:02:00.000Z',
    },
  ],
}

const agentTokenUsage: AgentTokenUsage = {
  id: 'agent-token-usage-1',
  runId: 'run-1',
  nodeId: 'node-test',
  userId: 'user-1',
  projectId: 'project-1',
  provider: 'local',
  model: 'fake',
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  costUsd: 0,
  timestamp: '2026-06-15T00:02:00.000Z',
  source: 'provider_reported',
}

const desktopPairingCredential: DesktopPairingCredential = {
  tokenId: 'desktop-token-1',
  organizationId: 'org-demo',
  projectId: 'p-payments',
  userId: 'u-ling',
  role: 'lead',
  authAccountId: 'acct-ling',
  projectMemberships: [{ projectId: 'p-payments', userId: 'u-ling', role: 'lead' }],
  createdAt: '2026-06-20T00:00:00.000Z',
}

const workRequestPairing: WorkRequestMaterializationExpectedPairing = {
  tokenId: desktopPairingCredential.tokenId,
  organizationId: desktopPairingCredential.organizationId,
  projectId: desktopPairingCredential.projectId,
  localProjectId: project.id,
}

const gateWorkflowCreation = createWorkflowRunFromRequest({
  runId: run.id,
  title: run.title,
  request: run.request,
  projectId: project.id,
  creatorId: run.creatorId,
  branchName: run.branchName,
  now: '2026-08-01T01:58:00.000Z',
})
const gateClarificationArtifact: Artifact = {
  id: 'artifact-gate-command-clarification',
  runId: gateWorkflowCreation.run.id,
  nodeId: gateWorkflowCreation.run.currentNodeId,
  kind: 'clarification',
  title: 'Clarified Gate Command scope',
  summary: 'The bounded collaboration intent is ready for approval.',
  content: 'Apply the shared workflow transition over canonical local evidence.',
  redacted: true,
  updatedAt: '2026-08-01T01:59:00.000Z',
}
const gateCompletion = applyWorkflowCommand({
  run: gateWorkflowCreation.run,
  command: {
    type: 'complete_agent',
    nodeId: gateWorkflowCreation.run.currentNodeId,
    artifactId: gateClarificationArtifact.id,
  },
  evidence: {
    artifacts: [gateClarificationArtifact],
    codingRuns: [],
    codingDiffs: [],
    testEvidence: [],
    agentReviews: [],
  },
  now: gateClarificationArtifact.updatedAt,
})
if (!gateCompletion.applied) {
  throw new Error('Gate Command fixture did not reach its clarification Gate.')
}
const gateRunBefore: WorkflowRun = {
  ...gateCompletion.run,
  version: 3,
  updatedAt: '2026-08-01T02:00:00.000Z',
}
const gateTransition = applyWorkflowCommand({
  run: gateRunBefore,
  command: { type: 'approve_gate', nodeId: gateRunBefore.currentNodeId },
  evidence: {
    artifacts: [gateClarificationArtifact],
    codingRuns: [],
    codingDiffs: [],
    testEvidence: [],
    agentReviews: [],
    approval: {
      roleAllowed: true,
      policy: { blocksApproval: false },
      review: 'not_required',
      budget: 'not_required',
    },
  },
  now: '2026-08-01T02:01:30.000Z',
})
if (!gateTransition.applied) {
  throw new Error('Gate Command fixture did not apply its shared transition.')
}
const gateRunAfter = gateTransition.run

const deliveringGateCommand: GateCommand = {
  id: 'gate-command-local-1',
  organizationId: desktopPairingCredential.organizationId,
  projectId: desktopPairingCredential.projectId,
  workRequestId: null,
  runId: gateRunBefore.id,
  nodeId: gateRunBefore.currentNodeId,
  action: 'approve',
  workflowCommand: 'approve_gate',
  reason: 'Approve the current Design Gate.',
  requestedByUserId: 'u-review-lead',
  requestedRole: 'lead',
  idempotencyKey: 'gate-command:create:run-1:v3',
  requestFingerprint: 'b'.repeat(64),
  expectedRunVersion: gateRunBefore.version,
  expectedPolicyVersion: 2,
  expectedBlockerIds: [],
  version: 2,
  evaluationStatus: 'allowed',
  evaluationBlockerIds: [],
  evaluatedAt: '2026-08-01T02:00:00.000Z',
  status: 'delivering',
  outcomeCode: null,
  expiresAt: '2026-08-01T02:15:00.000Z',
  createdAt: '2026-08-01T02:00:00.000Z',
  updatedAt: '2026-08-01T02:01:00.000Z',
}

const gateCommandReceipt: GateCommandReceipt = {
  id: 'gate-command-receipt-local-1',
  commandId: deliveringGateCommand.id,
  attempt: 1,
  leasedAt: '2026-08-01T02:01:00.000Z',
  leaseExpiresAt: '2026-08-01T02:02:00.000Z',
  acknowledgedAt: null,
}

const gateApprovalEvent: AgentEvent = {
  id: 'event-gate-command-local-1',
  runId: gateRunBefore.id,
  nodeId: gateRunBefore.currentNodeId,
  sequence: 1,
  kind: 'approval',
  message: 'Remote Gate Command applied.',
  timestamp: gateRunAfter.updatedAt,
}

const gateOrganizationPolicyV2 = {
  ...createWarnOnlyDefaultPolicy({
    organizationId: desktopPairingCredential.organizationId,
    updatedAt: '2026-08-01T01:59:00.000Z',
  }),
  version: 2,
}
const gatePolicySnapshotV2: PolicySnapshot = {
  projectId: desktopPairingCredential.projectId,
  organizationPolicy: gateOrganizationPolicyV2,
  projectOverride: null,
  effectivePolicy: resolveEffectivePolicy(gateOrganizationPolicyV2, null),
  version: 2,
  updatedAt: gateOrganizationPolicyV2.updatedAt,
  syncedAt: '2026-08-01T01:59:30.000Z',
  source: 'remote_cache',
}
const gateEnforcementV2: GateEnforcementDecision = {
  status: 'pass',
  blocksApproval: false,
  blockingReasons: [],
  warningReasons: [],
  requiredActions: [],
  canOverride: false,
  overrideRoleRequired: 'lead',
  policySource: 'remote_cache',
  policyVersion: 2,
  provisional: false,
}
const gatePersistedEvidence: WorkflowEvidenceSnapshot = {
  artifacts: [gateClarificationArtifact],
  codingRuns: [],
  codingDiffs: [],
  testEvidence: [],
  agentReviews: [],
}
const gateKnowledgeFingerprint = `sha256:${'a'.repeat(64)}`
const gateEvaluationBinding = {
  policySnapshot: gatePolicySnapshotV2,
  enforcement: gateEnforcementV2,
  overrides: [] as GateOverrideDecision[],
  selectedOverrideId: null,
  evidence: gatePersistedEvidence,
  repositoryKnowledge: {
    projectId: project.id,
    evaluatedFingerprint: gateKnowledgeFingerprint,
    observedFingerprint: gateKnowledgeFingerprint,
  },
}

const claimedWorkRequest: WorkRequest = {
  id: 'wr-local-materialization',
  organizationId: desktopPairingCredential.organizationId,
  projectId: desktopPairingCredential.projectId,
  title: 'Prepare a reversible rollout',
  request: 'Build the rollout locally and retain evidence.',
  version: 2,
  status: 'claim_pending',
  createdByUserId: 'u-manager',
  claim: {
    runId: 'run-work-request-materialization',
    claimedAt: '2026-08-01T12:00:00.000Z',
    materializedAt: null,
  },
  expiresAt: '2026-08-02T12:00:00.000Z',
  createdAt: '2026-08-01T11:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
}

const claimedWorkRequestCreation = createWorkflowRunFromRequest({
  runId: claimedWorkRequest.claim!.runId,
  title: claimedWorkRequest.title,
  request: claimedWorkRequest.request,
  projectId: project.id,
  creatorId: desktopPairingCredential.userId,
  branchName: 'devflow/run-work-request-materialization',
  now: claimedWorkRequest.claim!.claimedAt,
})

const claimedWorkRequestFingerprint = 'a'.repeat(64)

const materializeIdempotencyKey =
  'work-request-materialize:wr-local-materialization:run-work-request-materialization'

const codingRun: CodingAgentRun = {
  id: 'coding-run-1',
  runId: 'run-1',
  nodeId: 'node-build',
  projectId: 'project-1',
  requestedBy: 'user-1',
  providerId: 'fake-coding-engine',
  engine: 'fake',
  status: 'completed',
  managedWorkspaceId: 'workspace-1',
  branchName: 'devflow/run-1-node-build',
  userInstruction: 'Keep the change minimal.',
  prompt: 'DevFlow assembled prompt stays local.',
  summary: 'Fake coding run produced a diff and test evidence.',
  changedPaths: ['src/export.ts'],
  startedAt: '2026-06-15T00:03:00.000Z',
  completedAt: '2026-06-15T00:04:00.000Z',
  tokenUsageId: 'agent-token-usage-1',
  diffArtifactId: 'coding-diff-1',
  bootstrapEvidenceId: 'bootstrap-1',
  testEvidenceId: 'evidence-1',
  redacted: true,
}

const codingEvent: CodingAgentEvent = {
  id: 'coding-event-1',
  codingRunId: 'coding-run-1',
  runId: 'run-1',
  nodeId: 'node-build',
  sequence: 1,
  kind: 'permission',
  message: 'Permission approved.',
  timestamp: '2026-06-15T00:03:10.000Z',
  metadata: { requestId: 'permission-1' },
  redacted: true,
}

const permissionRequest: CodingPermissionRequest = {
  id: 'permission-1',
  codingRunId: 'coding-run-1',
  runId: 'run-1',
  nodeId: 'node-build',
  permission: 'edit',
  title: 'Edit src/export.ts',
  filePath: 'src/export.ts',
  diffPreview: '+export const ok = true',
  risk: 'warn',
  reasons: ['Editing source code requires approval.'],
  status: 'approved',
  requestedAt: '2026-06-15T00:03:05.000Z',
  expiresAt: '2026-06-15T00:04:05.000Z',
}

const permissionDecision: CodingPermissionDecision = {
  id: 'permission-decision-1',
  requestId: 'permission-1',
  codingRunId: 'coding-run-1',
  decidedBy: 'user-1',
  decision: 'approved',
  comment: 'Allow fake harness edit.',
  decidedAt: '2026-06-15T00:03:08.000Z',
}

const workspace: ManagedCodingWorkspace = {
  id: 'workspace-1',
  projectId: 'project-1',
  codingRunId: 'coding-run-1',
  sourcePath: '/tmp/fixture-project',
  worktreePath: '/tmp/devflow-worktrees/run-1',
  branchName: 'devflow/run-1-node-build',
  baseBranch: 'main',
  createdAt: '2026-06-15T00:03:00.000Z',
}

const bootstrapEvidence: DependencyBootstrapEvidence = {
  id: 'bootstrap-1',
  codingRunId: 'coding-run-1',
  runId: 'run-1',
  nodeId: 'node-build',
  projectId: 'project-1',
  command: '',
  status: 'skipped',
  exitCode: 0,
  durationMs: 0,
  stdout: '',
  stderr: '',
  summary: 'Dependency bootstrap skipped.',
  dependencyHash: 'fnv1a-test',
  redacted: true,
  createdAt: '2026-06-15T00:03:20.000Z',
}

const codingDiff: CodingDiffArtifact = {
  id: 'coding-diff-1',
  runId: 'run-1',
  nodeId: 'node-build',
  projectId: 'project-1',
  changedPaths: ['src/export.ts'],
  patch: '+export const ok = true',
  truncated: false,
  redacted: true,
  createdAt: '2026-06-15T00:03:30.000Z',
}

const enforcementPolicy = createWarnOnlyDefaultPolicy({
  organizationId: 'org-local',
  updatedAt: '2026-06-15T00:04:00.000Z',
})
const policySnapshot = {
  projectId: 'project-1',
  organizationPolicy: enforcementPolicy,
  projectOverride: null,
  effectivePolicy: resolveEffectivePolicy(enforcementPolicy, null),
  version: enforcementPolicy.version,
  updatedAt: enforcementPolicy.updatedAt,
  syncedAt: '2026-06-15T00:04:10.000Z',
  source: 'remote_cache' as const,
}
const gateOverride = {
  id: 'gate-override-1',
  runId: 'run-1',
  nodeId: 'node-test',
  projectId: 'project-1',
  userId: 'user-lead',
  role: 'lead' as const,
  reason: 'Emergency release with test evidence attached.',
  blockedReasonIds: ['reason-1'],
  policyVersion: 1,
  provisional: true,
  status: 'provisional' as const,
  createdAt: '2026-06-15T00:04:30.000Z',
}
const retryAttempt: RetryAttempt = {
  id: 'retry-1',
  runId: 'run-1',
  nodeId: 'node-build',
  projectId: 'project-1',
  remediationPlanId: 'remediation-run-1-node-build',
  candidateIds: ['candidate-api'],
  requestedBy: 'user-lead',
  userInstruction: 'Apply the selected policy remediation.',
  status: 'started',
  codingRunId: 'coding-run-1',
  createdAt: '2026-06-15T00:05:00.000Z',
}

const agentRuntimeStartRequest: AgentRuntimeStartRequest = {
  stateVersion: 1,
  id: 'agent-runtime-local-store-1',
  scope: {
    kind: 'local',
    organizationId: null,
    projectId: null,
    userId: gateWorkflowCreation.run.creatorId,
    sessionId: 'desktop-session-1',
    localProjectId: project.id,
  },
  authority: {
    runId: gateWorkflowCreation.run.id,
    nodeId: gateWorkflowCreation.run.currentNodeId,
    runVersion: gateWorkflowCreation.run.version,
    policyVersion: 1,
  },
  contextDigest: 'a'.repeat(64),
  capabilitySetDigest: 'b'.repeat(64),
  bounds: {
    maxSteps: 4,
    maxWallTimeMs: 60_000,
    maxToolCalls: 4,
    maxToolResultBytes: 64 * 1_024,
    maxTrajectoryMetadataBytes: 16 * 1_024,
    maxCheckpointBytes: 128 * 1_024,
    maxTokens: 10_000,
    maxCostUsd: 1,
  },
  requestedAt: '2026-08-12T20:30:00.000Z',
  deadline: '2026-08-12T20:31:00.000Z',
}

const teamAgentRuntimeStartRequest: AgentRuntimeStartRequest = {
  ...agentRuntimeStartRequest,
  id: 'agent-runtime-team-sync-1',
  scope: {
    kind: 'team',
    organizationId: desktopPairingCredential.organizationId,
    projectId: desktopPairingCredential.projectId,
    userId: desktopPairingCredential.userId,
    sessionId: desktopPairingCredential.tokenId,
    localProjectId: project.id,
  },
}

async function persistAcceptedMemoryCandidate(store: LocalStore) {
  await store.upsertProject(project)
  await store.saveRun(gateWorkflowCreation.run)

  const created = createAgentRuntime(agentRuntimeStartRequest)
  const resumed = resumeAgentRuntime({
    runtime: created.runtime,
    expectedCheckpointVersion: created.runtime.checkpointVersion,
    authority: created.runtime.authority,
    contextDigest: created.runtime.contextDigest,
    capabilitySetDigest: created.runtime.capabilitySetDigest,
    now: '2026-08-12T20:30:01.000Z',
  })
  const requested = requestAgentAction({
    runtime: resumed.runtime,
    expectedCheckpointVersion: resumed.runtime.checkpointVersion,
    now: '2026-08-12T20:30:02.000Z',
    action: {
      id: 'memory-observation-action-1',
      kind: 'tool',
      capabilityId: 'test.observe',
      capabilityVersion: 1,
      requestDigest: 'c'.repeat(64),
      requiresPermission: false,
    },
  })
  const accepted = acceptAgentActionResult({
    runtime: requested.runtime,
    expectedCheckpointVersion: requested.runtime.checkpointVersion,
    actionId: 'memory-observation-action-1',
    requestDigest: 'c'.repeat(64),
    result: {
      outcome: 'success',
      resultDigest: 'd'.repeat(64),
      resultBytes: 128,
      tokens: 0,
      costUsd: 0,
      evaluation: 'continue',
      evaluationSummary: 'The accepted observation can propose one inert Memory candidate.',
    },
    now: '2026-08-12T20:30:03.000Z',
  })
  await store.commitAgentRuntimeTransition({ expectedRuntime: null, transition: created })
  await store.commitAgentRuntimeTransition({ expectedRuntime: created.runtime, transition: resumed })
  await store.commitAgentRuntimeTransition({ expectedRuntime: resumed.runtime, transition: requested })
  await store.commitAgentRuntimeTransition({ expectedRuntime: requested.runtime, transition: accepted })
  const candidate = await createAgentMemoryCandidate({
    id: 'memory-candidate-local-store-1',
    statement: 'The saved health test is the regression check for dependency degradation.',
    previousRuntime: requested.runtime,
    acceptedTransition: accepted,
    createdAt: '2026-08-12T20:30:04.000Z',
  })
  const firstSave = await store.saveAgentMemoryCandidate(candidate)
  return { candidate, firstSave }
}

describe('createLocalStore', () => {
  it('initializes schema version 25 and keeps it stable across reopen', async () => {
    const dbPath = await tempDbPath()

    const first = await createLocalStore({ dbPath })
    expect(await first.getSchemaVersion()).toBe(25)
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.getSchemaVersion()).toBe(25)
    second.close()
  })

  it('migrates retained schema 21 to 22 without fabricating retrieval index rows', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    await initial.upsertProject(project)
    await initial.saveRun(run)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const retained = new SQL.Database(await readFile(dbPath))
    retained.run(`
      ${dropAgentMemorySchemaSql}
      ${dropKnowledgeIndexSchemaSql}
      update schema_meta set value = '21' where key = 'schema_version';
    `)
    await writeFile(dbPath, Buffer.from(retained.export()))
    retained.close()

    const migrated = await createLocalStore({ dbPath })
    await expect(migrated.getSchemaVersion()).resolves.toBe(25)
    await expect(migrated.listProjects()).resolves.toEqual([project])
    await expect(migrated.listRuns()).resolves.toEqual([run])
    migrated.close()

    const inspected = new SQL.Database(await readFile(dbPath))
    for (const table of [
      'knowledge_index_snapshots',
      'knowledge_index_chunks',
      'knowledge_index_vectors',
      'knowledge_citations',
    ]) {
      expect(inspected.exec(`select count(*) from ${table}`)[0]?.values[0]?.[0]).toBe(0)
    }
    inspected.close()
  })

  it('migrates retained schema 22 to 23 without fabricating Memory candidates', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    await initial.upsertProject(project)
    await initial.saveRun(run)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const retained = new SQL.Database(await readFile(dbPath))
    retained.run(`
      ${dropAgentMemorySchemaSql}
      update schema_meta set value = '22' where key = 'schema_version';
    `)
    await writeFile(dbPath, Buffer.from(retained.export()))
    retained.close()

    const migrated = await createLocalStore({ dbPath })
    await expect(migrated.getSchemaVersion()).resolves.toBe(25)
    await expect(migrated.listProjects()).resolves.toEqual([project])
    await expect(migrated.listRuns()).resolves.toEqual([run])
    migrated.close()

    const inspected = new SQL.Database(await readFile(dbPath))
    expect(
      inspected.exec('select count(*) from agent_memory_candidates')[0]?.values[0]?.[0],
    ).toBe(0)
    inspected.close()
  })

  it('migrates retained schema 23 to 24 without fabricating durable Memory lifecycle rows', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    await initial.upsertProject(project)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const retained = new SQL.Database(await readFile(dbPath))
    retained.run(`
      drop table if exists agent_memory_audits;
      drop table if exists agent_memory_index_entries;
      drop table if exists agent_memory_tombstones;
      drop table if exists agent_memory_heads;
      drop table if exists agent_memory_revisions;
      update schema_meta set value = '23' where key = 'schema_version';
    `)
    await writeFile(dbPath, Buffer.from(retained.export()))
    retained.close()

    const migrated = await createLocalStore({ dbPath })
    await expect(migrated.getSchemaVersion()).resolves.toBe(25)
    await expect(migrated.listProjects()).resolves.toEqual([project])
    migrated.close()

    const inspected = new SQL.Database(await readFile(dbPath))
    for (const table of [
      'agent_memory_revisions',
      'agent_memory_heads',
      'agent_memory_tombstones',
      'agent_memory_index_entries',
      'agent_memory_audits',
    ]) {
      expect(inspected.exec(`select count(*) from ${table}`)[0]?.values[0]?.[0]).toBe(0)
    }
    inspected.close()
  })

  it('migrates retained schema 24 promotion history without preserving source uniqueness', async () => {
    const dbPath = await tempDbPath()
    const retained = await createLocalStore({ dbPath })
    const { candidate } = await persistAcceptedMemoryCandidate(retained)
    const authorization = await retained.authorizeAgentMemoryPromotion({
      candidateId: candidate.id,
      memoryId: 'memory-retained-schema-24',
      authority: {
        stateVersion: 1,
        decisionId: 'memory-retained-schema-24-promotion',
        candidateId: candidate.id,
        candidateContentDigest: candidate.contentDigest,
        scope: candidate.scope,
        actorKind: 'human',
        actorId: candidate.scope.userId,
        policyId: 'memory-policy-local-store-1',
        policyVersion: 1,
        visibility: 'user_project',
        sensitivity: 'private',
        retentionClass: 'until_deleted',
        expiresAt: null,
        authorityDigest: '9'.repeat(64),
        decidedAt: '2026-08-12T20:30:05.000Z',
      },
    })
    expect(authorization.authorized).toBe(true)
    if (!authorization.authorized) throw new Error('expected promotion authority')
    await expect(retained.commitAgentMemoryPromotion(
      { revision: authorization.revision },
      authorization.capability,
    )).resolves.toMatchObject({ committed: true, replayed: false })
    retained.close()

    const migrated = await createLocalStore({ dbPath })
    await expect(migrated.getSchemaVersion()).resolves.toBe(25)
    await expect(migrated.listAgentMemoryRevisions('memory-retained-schema-24')).resolves.toEqual([
      authorization.revision,
    ])
    await expect(migrated.getAgentMemoryHead('memory-retained-schema-24')).resolves.toMatchObject({
      memoryId: 'memory-retained-schema-24',
      currentRevision: 1,
      version: 1,
    })
    migrated.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const inspected = new SQL.Database(await readFile(dbPath))
    inspected.run(`
      insert into agent_memory_revisions (
        memory_id, revision, local_project_id, scope_kind, organization_id,
        team_project_id, user_id, session_id, visibility, statement,
        content_digest, provenance_digest, source_candidate_id, supersedes_revision,
        sensitivity, retention_class, expires_at, promotion_decision_id,
        promotion_actor_kind, promotion_actor_id, promotion_policy_id,
        promotion_policy_version, promotion_authority_digest, status,
        state_version, json, created_at
      )
      select
        memory_id, 2, local_project_id, scope_kind, organization_id,
        team_project_id, user_id, session_id, visibility, statement,
        content_digest, provenance_digest, source_candidate_id, 1,
        sensitivity, retention_class, expires_at, 'memory-retained-schema-24-revision-2',
        promotion_actor_kind, promotion_actor_id, promotion_policy_id,
        promotion_policy_version, promotion_authority_digest, status,
        state_version,
        json_set(
          json,
          '$.revision', 2,
          '$.supersedesRevision', 1,
          '$.promotionDecisionId', 'memory-retained-schema-24-revision-2',
          '$.createdAt', '2026-08-12T20:30:06.000Z'
        ),
        '2026-08-12T20:30:06.000Z'
      from agent_memory_revisions
      where memory_id = 'memory-retained-schema-24' and revision = 1;
    `)
    expect(inspected.exec(
      "select count(*) from agent_memory_revisions where memory_id = 'memory-retained-schema-24'",
    )[0]?.values[0]?.[0]).toBe(2)
    expect(inspected.exec(
      "select count(*) from agent_memory_audits where memory_id = 'memory-retained-schema-24'",
    )[0]?.values[0]?.[0]).toBe(1)
    for (const childTable of [
      'agent_memory_heads',
      'agent_memory_tombstones',
      'agent_memory_index_entries',
      'agent_memory_audits',
    ]) {
      const parentTables = inspected.exec(`pragma foreign_key_list(${childTable})`)[0]?.values
        .map((row) => String(row[2])) ?? []
      expect(parentTables).toContain('agent_memory_revisions')
      expect(parentTables).not.toContain('agent_memory_revisions_v24')
    }
    inspected.close()
  })

  it('persists one accepted inert Memory candidate exactly once across restart', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const { candidate, firstSave } = await persistAcceptedMemoryCandidate(store)

    expect(firstSave).toEqual({
      committed: true,
      replayed: false,
      candidate,
    })
    await expect(store.listAgentMemoryCandidates(project.id)).resolves.toEqual([candidate])
    store.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(reopened.listAgentMemoryCandidates(project.id)).resolves.toEqual([candidate])
    await expect(reopened.saveAgentMemoryCandidate(candidate)).resolves.toEqual({
      committed: true,
      replayed: true,
      candidate,
    })
    reopened.close()
  })

  it('promotes one candidate through an exact main-owned capability and rejects its clone', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const { candidate } = await persistAcceptedMemoryCandidate(store)
    const authority: AgentMemoryPromotionAuthority = {
      stateVersion: 1,
      decisionId: 'memory-promotion-local-store-1',
      candidateId: candidate.id,
      candidateContentDigest: candidate.contentDigest,
      scope: candidate.scope,
      actorKind: 'human',
      actorId: candidate.scope.userId,
      policyId: 'memory-policy-local-store-1',
      policyVersion: 1,
      visibility: 'user_project',
      sensitivity: 'private',
      retentionClass: 'until_deleted',
      expiresAt: null,
      authorityDigest: 'e'.repeat(64),
      decidedAt: '2026-08-12T20:30:05.000Z',
    }
    const authorization = await store.authorizeAgentMemoryPromotion({
      candidateId: candidate.id,
      memoryId: 'memory-local-store-1',
      authority,
    })
    expect(authorization.authorized).toBe(true)
    if (!authorization.authorized) throw new Error('expected promotion authority')
    expect(Object.keys(authorization.capability)).toEqual([])
    expect(Object.isFrozen(authorization.capability)).toBe(true)
    expect(() => structuredClone(authorization.capability)).toThrow()
    const concurrentAuthorization = await store.authorizeAgentMemoryPromotion({
      candidateId: candidate.id,
      memoryId: 'memory-local-store-1',
      authority,
    })
    expect(concurrentAuthorization.authorized).toBe(true)
    if (!concurrentAuthorization.authorized) throw new Error('expected concurrent promotion authority')
    const mutatedAuthorization = await store.authorizeAgentMemoryPromotion({
      candidateId: candidate.id,
      memoryId: 'memory-local-store-1',
      authority,
    })
    expect(mutatedAuthorization.authorized).toBe(true)
    if (!mutatedAuthorization.authorized) throw new Error('expected mutation-test authority')
    mutatedAuthorization.revision.sensitivity = 'internal'
    await expect(store.commitAgentMemoryPromotion(
      { revision: mutatedAuthorization.revision },
      mutatedAuthorization.capability,
    )).resolves.toEqual({ committed: false, reason: 'invalid_revision' })

    await expect(store.commitAgentMemoryPromotion(
      { revision: authorization.revision },
      { ...authorization.capability },
    )).resolves.toEqual({ committed: false, reason: 'invalid_authority' })
    await expect(store.commitAgentMemoryPromotion(
      { revision: authorization.revision },
      authorization.capability,
    )).resolves.toEqual({
      committed: true,
      replayed: false,
      revision: authorization.revision,
    })
    await expect(store.commitAgentMemoryPromotion(
      { revision: authorization.revision },
      authorization.capability,
    )).resolves.toEqual({ committed: false, reason: 'invalid_authority' })
    await expect(store.commitAgentMemoryPromotion(
      { revision: concurrentAuthorization.revision },
      concurrentAuthorization.capability,
    )).resolves.toEqual({
      committed: true,
      replayed: true,
      revision: authorization.revision,
    })
    store.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(reopened.listAgentMemoryRevisions('memory-local-store-1')).resolves.toEqual([
      authorization.revision,
    ])
    await expect(reopened.getAgentMemoryHead('memory-local-store-1')).resolves.toEqual({
      memoryId: 'memory-local-store-1',
      currentRevision: 1,
      scope: candidate.scope,
      status: 'active',
      version: 1,
      updatedAt: '2026-08-12T20:30:05.000Z',
    })
    reopened.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const inspected = new SQL.Database(await readFile(dbPath))
    const metadataJson = inspected.exec(
      "select metadata_json from agent_memory_audits where event_kind = 'candidate_promoted'",
    )[0]?.values[0]?.[0]
    expect(inspected.exec(
      "select count(*) from agent_memory_audits where event_kind = 'candidate_promoted'",
    )[0]?.values[0]?.[0]).toBe(1)
    expect(JSON.parse(String(metadataJson))).toEqual({
      candidateId: candidate.id,
      contentDigest: candidate.contentDigest,
      provenanceDigest: candidate.provenanceDigest,
      visibility: 'user_project',
      sensitivity: 'private',
      retentionClass: 'until_deleted',
      expiresAt: null,
      status: 'active',
      policyId: 'memory-policy-local-store-1',
      policyVersion: 1,
    })
    expect(String(metadataJson)).not.toContain(candidate.statement)
    inspected.close()
  })

  it('restores candidate-only state when Memory promotion persistence fails', async () => {
    const dbPath = await tempDbPath()
    const backupPath = `${dbPath}.backup`
    const store = await createLocalStore({ dbPath })
    const { candidate } = await persistAcceptedMemoryCandidate(store)
    const authorization = await store.authorizeAgentMemoryPromotion({
      candidateId: candidate.id,
      memoryId: 'memory-local-store-persistence-failure',
      authority: {
        stateVersion: 1,
        decisionId: 'memory-promotion-persistence-failure',
        candidateId: candidate.id,
        candidateContentDigest: candidate.contentDigest,
        scope: candidate.scope,
        actorKind: 'human',
        actorId: candidate.scope.userId,
        policyId: 'memory-policy-local-store-1',
        policyVersion: 1,
        visibility: 'user_project',
        sensitivity: 'private',
        retentionClass: 'until_deleted',
        expiresAt: null,
        authorityDigest: 'f'.repeat(64),
        decidedAt: '2026-08-12T20:30:05.000Z',
      },
    })
    expect(authorization.authorized).toBe(true)
    if (!authorization.authorized) throw new Error('expected promotion authority')

    await rename(dbPath, backupPath)
    await mkdir(dbPath)
    await expect(store.commitAgentMemoryPromotion(
      { revision: authorization.revision },
      authorization.capability,
    )).rejects.toThrow(persistenceFailurePattern)
    await expect(store.listAgentMemoryRevisions(authorization.revision.id)).resolves.toEqual([])
    await expect(store.getAgentMemoryHead(authorization.revision.id)).resolves.toBeNull()
    await rm(dbPath, { recursive: true })
    await rename(backupPath, dbPath)
    store.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(reopened.listAgentMemoryCandidates(project.id)).resolves.toEqual([candidate])
    await expect(reopened.listAgentMemoryRevisions(authorization.revision.id)).resolves.toEqual([])
    reopened.close()
  })

  it('keeps the prior Knowledge index snapshot current when replacement persistence fails', async () => {
    const dbPath = await tempDbPath()
    const backupPath = `${dbPath}.backup`
    const store = await createLocalStore({ dbPath })
    await store.upsertProject(project)
    const firstActivation = {
      expectedCurrentSnapshotId: null,
      snapshot: {
        stateVersion: 1 as const,
        id: 'knowledge-snapshot-1',
        scope: {
          kind: 'local' as const,
          organizationId: null,
          projectId: null,
          localProjectId: project.id,
        },
        knowledgeSnapshotHash: `sha256:${'1'.repeat(64)}`,
        embedding: {
          modelId: 'fixture-embedding',
          modelVersion: '1',
          dimensions: 3,
        },
        createdAt: '2026-08-13T08:00:00.000Z',
      },
      chunks: [
        {
          stateVersion: 1 as const,
          documentId: 'knowledge-document-1',
          chunkId: 'knowledge-chunk-1',
          sourcePath: 'docs/knowledge.md',
          headingPath: ['Knowledge', 'Atomic refresh'],
          contentHash: `sha256:${'a'.repeat(64)}`,
          content: 'The current index changes only after the replacement is durable.',
          ordinal: 0,
          vector: {
            modelId: 'fixture-embedding',
            modelVersion: '1',
            dimensions: 3,
            values: [1, 0, 0],
            createdAt: '2026-08-13T08:00:00.000Z',
          },
        },
      ],
      activatedAt: '2026-08-13T08:00:01.000Z',
    }
    const firstSnapshot = {
      ...firstActivation.snapshot,
      status: 'current' as const,
      updatedAt: firstActivation.activatedAt,
      activatedAt: firstActivation.activatedAt,
      chunks: firstActivation.chunks,
    }

    await expect(store.activateKnowledgeIndexSnapshot(firstActivation)).resolves.toEqual({
      activated: true,
      replayed: false,
      snapshot: firstSnapshot,
    })
    await expect(store.getCurrentKnowledgeIndexSnapshot(project.id)).resolves.toEqual(firstSnapshot)

    const firstChunk = firstActivation.chunks[0]!
    const secondActivation = {
      ...firstActivation,
      expectedCurrentSnapshotId: firstSnapshot.id,
      snapshot: {
        ...firstActivation.snapshot,
        id: 'knowledge-snapshot-2',
        knowledgeSnapshotHash: `sha256:${'2'.repeat(64)}`,
        createdAt: '2026-08-13T08:01:00.000Z',
      },
      chunks: [
        {
          ...firstChunk,
          chunkId: 'knowledge-chunk-2',
          contentHash: `sha256:${'b'.repeat(64)}`,
          content: 'A failed replacement cannot displace the prior current snapshot.',
          vector: {
            ...firstChunk.vector,
            values: [0, 1, 0],
            createdAt: '2026-08-13T08:01:00.000Z',
          },
        },
      ],
      activatedAt: '2026-08-13T08:01:01.000Z',
    }

    await rename(dbPath, backupPath)
    await mkdir(dbPath)
    await expect(store.activateKnowledgeIndexSnapshot(secondActivation)).rejects.toThrow(
      persistenceFailurePattern,
    )
    await expect(store.getCurrentKnowledgeIndexSnapshot(project.id)).resolves.toEqual(firstSnapshot)

    await rm(dbPath, { recursive: true, force: true })
    await rename(backupPath, dbPath)
    store.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(reopened.getCurrentKnowledgeIndexSnapshot(project.id)).resolves.toEqual(firstSnapshot)
    reopened.close()
  })

  it('invalidates updated and deleted Knowledge identities before later citation use', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.upsertProject(project)
    const scope = {
      kind: 'local' as const,
      organizationId: null,
      projectId: null,
      userId: 'user-1',
      sessionId: 'session-1',
      localProjectId: project.id,
    }
    const firstSnapshotHash = `sha256:${'3'.repeat(64)}`
    const updatedChunk = {
      stateVersion: 1 as const,
      documentId: 'knowledge-document-update',
      chunkId: 'knowledge-chunk-update',
      sourcePath: 'docs/update.md',
      headingPath: ['Update'],
      contentHash: `sha256:${'c'.repeat(64)}`,
      content: 'This content will be replaced by the next source snapshot.',
      ordinal: 0,
      vector: {
        modelId: 'fixture-embedding',
        modelVersion: '1',
        dimensions: 3,
        values: [1, 0, 0],
        createdAt: '2026-08-13T09:00:00.000Z',
      },
    }
    const deletedChunk = {
      ...updatedChunk,
      documentId: 'knowledge-document-delete',
      chunkId: 'knowledge-chunk-delete',
      sourcePath: 'docs/delete.md',
      headingPath: ['Delete'],
      contentHash: `sha256:${'d'.repeat(64)}`,
      content: 'This source will be deleted before the next retrieval.',
      ordinal: 1,
      vector: {
        ...updatedChunk.vector,
        values: [0, 1, 0],
      },
    }
    const firstActivation = {
      expectedCurrentSnapshotId: null,
      snapshot: {
        stateVersion: 1 as const,
        id: 'knowledge-snapshot-before-refresh',
        scope: {
          kind: 'local' as const,
          organizationId: null,
          projectId: null,
          localProjectId: project.id,
        },
        knowledgeSnapshotHash: firstSnapshotHash,
        embedding: {
          modelId: 'fixture-embedding',
          modelVersion: '1',
          dimensions: 3,
        },
        createdAt: '2026-08-13T09:00:00.000Z',
      },
      chunks: [updatedChunk, deletedChunk],
      activatedAt: '2026-08-13T09:00:01.000Z',
    }
    await expect(store.activateKnowledgeIndexSnapshot(firstActivation)).resolves.toMatchObject({
      activated: true,
      replayed: false,
    })

    const request: KnowledgeRetrievalRequest = {
      stateVersion: 1,
      id: 'knowledge-request-before-refresh',
      scope,
      target: { runId: run.id, nodeId: 'node-build', runVersion: 1 },
      knowledgeSnapshotHash: firstSnapshotHash,
      query: { text: 'deleted source', categories: [], tags: [], topK: 1 },
      requestedAt: '2026-08-13T09:00:02.000Z',
    }
    const candidates: KnowledgeRetrievalCandidateSet = {
      stateVersion: 1,
      requestId: request.id,
      scope,
      knowledgeSnapshotHash: firstSnapshotHash,
      strategy: 'lexical',
      embedding: null,
      candidates: [{
        documentId: deletedChunk.documentId,
        chunkId: deletedChunk.chunkId,
        organizationId: null,
        projectId: null,
        localProjectId: project.id,
        sourcePath: deletedChunk.sourcePath,
        headingPath: deletedChunk.headingPath,
        contentHash: deletedChunk.contentHash,
        score: 1,
        vectorDimensions: null,
      }],
      evaluatedAt: '2026-08-13T09:00:03.000Z',
    }
    const citation: KnowledgeCitation = {
      stateVersion: 1,
      requestId: request.id,
      scope,
      knowledgeSnapshotHash: firstSnapshotHash,
      documentId: deletedChunk.documentId,
      chunkId: deletedChunk.chunkId,
      sourcePath: deletedChunk.sourcePath,
      headingPath: deletedChunk.headingPath,
      contentHash: deletedChunk.contentHash,
      strategyChain: ['lexical'],
      rank: 1,
      score: 1,
      citedAt: '2026-08-13T09:00:04.000Z',
    }
    const beforeRefresh = await store.getCurrentKnowledgeSnapshotIdentitySet(scope)
    expect(parseCurrentKnowledgeCitation(citation, request, candidates, beforeRefresh)).toEqual(
      citation,
    )

    const replacementChunk = {
      ...updatedChunk,
      contentHash: `sha256:${'e'.repeat(64)}`,
      content: 'This is the only current source content after refresh.',
      vector: {
        ...updatedChunk.vector,
        values: [0, 0, 1],
        createdAt: '2026-08-13T09:01:00.000Z',
      },
    }
    await expect(store.activateKnowledgeIndexSnapshot({
      expectedCurrentSnapshotId: firstActivation.snapshot.id,
      snapshot: {
        ...firstActivation.snapshot,
        id: 'knowledge-snapshot-after-refresh',
        knowledgeSnapshotHash: `sha256:${'4'.repeat(64)}`,
        createdAt: '2026-08-13T09:01:00.000Z',
      },
      chunks: [replacementChunk],
      activatedAt: '2026-08-13T09:01:01.000Z',
    })).resolves.toMatchObject({ activated: true, replayed: false })

    const current = await store.getCurrentKnowledgeIndexSnapshot(project.id)
    expect(current?.chunks).toEqual([replacementChunk])
    const afterRefresh = await store.getCurrentKnowledgeSnapshotIdentitySet(scope)
    expect(() => parseCurrentKnowledgeCitation(citation, request, candidates, afterRefresh))
      .toThrowError('invalid_knowledge_retrieval_request')
    store.close()
  })

  it('keeps a valid current index through corrupt, mismatched, and unbounded rebuilds', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.upsertProject(project)
    const baseChunk = {
      stateVersion: 1 as const,
      documentId: 'knowledge-document-bounded',
      chunkId: 'knowledge-chunk-bounded',
      sourcePath: 'docs/bounded.md',
      headingPath: ['Bounded rebuild'],
      contentHash: `sha256:${'5'.repeat(64)}`,
      content: 'Only a valid bounded replacement may become current.',
      ordinal: 0,
      vector: {
        modelId: 'fixture-embedding',
        modelVersion: '1',
        dimensions: 3,
        values: [1, 0, 0],
        createdAt: '2026-08-13T10:00:00.000Z',
      },
    }
    const baseActivation: ActivateKnowledgeIndexSnapshotInput = {
      expectedCurrentSnapshotId: null,
      snapshot: {
        stateVersion: 1,
        id: 'knowledge-snapshot-bounded-base',
        scope: {
          kind: 'local',
          organizationId: null,
          projectId: null,
          localProjectId: project.id,
        },
        knowledgeSnapshotHash: `sha256:${'6'.repeat(64)}`,
        embedding: {
          modelId: 'fixture-embedding',
          modelVersion: '1',
          dimensions: 3,
        },
        createdAt: '2026-08-13T10:00:00.000Z',
      },
      chunks: [baseChunk],
      activatedAt: '2026-08-13T10:00:01.000Z',
    }
    const activated = await store.activateKnowledgeIndexSnapshot(baseActivation)
    expect(activated).toMatchObject({ activated: true, replayed: false })
    const expectedCurrent = await store.getCurrentKnowledgeIndexSnapshot(project.id)

    const replacement = (id: string): ActivateKnowledgeIndexSnapshotInput => ({
      ...baseActivation,
      expectedCurrentSnapshotId: baseActivation.snapshot.id,
      snapshot: {
        ...baseActivation.snapshot,
        id,
        knowledgeSnapshotHash: `sha256:${'7'.repeat(64)}`,
        createdAt: '2026-08-13T10:01:00.000Z',
      },
      chunks: [{
        ...baseChunk,
        chunkId: `${baseChunk.chunkId}-${id}`,
        vector: {
          ...baseChunk.vector,
          createdAt: '2026-08-13T10:01:00.000Z',
        },
      }],
      activatedAt: '2026-08-13T10:01:01.000Z',
    })
    const modelMismatch = replacement('model-mismatch')
    modelMismatch.chunks[0]!.vector.modelId = 'other-embedding'
    const dimensionMismatch = replacement('dimension-mismatch')
    dimensionMismatch.chunks[0]!.vector.dimensions = 2
    dimensionMismatch.chunks[0]!.vector.values = [1, 0]
    const nonFiniteVector = replacement('non-finite-vector')
    nonFiniteVector.chunks[0]!.vector.values = [1, Number.NaN, 0]
    const scopeMismatch = replacement('scope-mismatch')
    scopeMismatch.snapshot.scope = {
      kind: 'team',
      organizationId: 'other-organization',
      projectId: 'other-project',
      localProjectId: project.id,
    }
    const unbounded = replacement('unbounded-rebuild')
    unbounded.chunks = Array.from(
      { length: KNOWLEDGE_INDEX_CHUNK_COUNT_MAX + 1 },
      (_, index) => ({
        ...unbounded.chunks[0]!,
        documentId: `knowledge-document-${index}`,
        chunkId: `knowledge-chunk-${index}`,
        ordinal: index,
      }),
    )

    for (const [input, reason] of [
      [modelMismatch, 'invalid_input'],
      [dimensionMismatch, 'invalid_input'],
      [nonFiniteVector, 'invalid_input'],
      [scopeMismatch, 'scope_mismatch'],
      [unbounded, 'invalid_input'],
    ] as const) {
      const result = await store.activateKnowledgeIndexSnapshot(input)
      expect(result.activated).toBe(false)
      if (!result.activated) expect(result.reason).toBe(reason)
      await expect(store.getCurrentKnowledgeIndexSnapshot(project.id)).resolves.toEqual(
        expectedCurrent,
      )
    }

    const validReplacement = replacement('knowledge-snapshot-bounded-replacement')
    await expect(store.activateKnowledgeIndexSnapshot(validReplacement)).resolves.toMatchObject({
      activated: true,
      replayed: false,
      snapshot: { id: validReplacement.snapshot.id, status: 'current' },
    })
    store.close()
  })

  it('fails closed on corrupt durable index state and rebuilds only derived project data', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.upsertProject(project)
    await store.saveRun(run)
    const activation: ActivateKnowledgeIndexSnapshotInput = {
      expectedCurrentSnapshotId: null,
      snapshot: {
        stateVersion: 1,
        id: 'knowledge-snapshot-corrupt',
        scope: {
          kind: 'local',
          organizationId: null,
          projectId: null,
          localProjectId: project.id,
        },
        knowledgeSnapshotHash: `sha256:${'8'.repeat(64)}`,
        embedding: {
          modelId: 'fixture-embedding',
          modelVersion: '1',
          dimensions: 3,
        },
        createdAt: '2026-08-13T11:00:00.000Z',
      },
      chunks: [{
        stateVersion: 1,
        documentId: 'knowledge-document-corrupt',
        chunkId: 'knowledge-chunk-corrupt',
        sourcePath: 'docs/corrupt.md',
        headingPath: ['Corrupt recovery'],
        contentHash: `sha256:${'9'.repeat(64)}`,
        content: 'Corrupt derived state must not become retrieval context.',
        ordinal: 0,
        vector: {
          modelId: 'fixture-embedding',
          modelVersion: '1',
          dimensions: 3,
          values: [1, 0, 0],
          createdAt: '2026-08-13T11:00:00.000Z',
        },
      }],
      activatedAt: '2026-08-13T11:00:01.000Z',
    }
    await store.activateKnowledgeIndexSnapshot(activation)
    store.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const corrupted = new SQL.Database(await readFile(dbPath))
    corrupted.run(
      "update knowledge_index_vectors set model_version = 'corrupt' where snapshot_id = ?",
      [activation.snapshot.id],
    )
    await writeFile(dbPath, Buffer.from(corrupted.export()))
    corrupted.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(reopened.getCurrentKnowledgeIndexSnapshot(project.id)).rejects.toThrow(
      'Stored Knowledge index snapshot is invalid',
    )
    const replacement: ActivateKnowledgeIndexSnapshotInput = {
      ...activation,
      expectedCurrentSnapshotId: activation.snapshot.id,
      snapshot: {
        ...activation.snapshot,
        id: 'knowledge-snapshot-rebuilt',
        knowledgeSnapshotHash: `sha256:${'a'.repeat(64)}`,
        createdAt: '2026-08-13T11:01:00.000Z',
      },
      chunks: [{
        ...activation.chunks[0]!,
        chunkId: 'knowledge-chunk-rebuilt',
        contentHash: `sha256:${'b'.repeat(64)}`,
        content: 'The bounded rebuild restores a valid current index.',
        vector: {
          ...activation.chunks[0]!.vector,
          values: [0, 1, 0],
          createdAt: '2026-08-13T11:01:00.000Z',
        },
      }],
      activatedAt: '2026-08-13T11:01:01.000Z',
    }
    await expect(reopened.rebuildKnowledgeIndexSnapshot(replacement)).resolves.toMatchObject({
      activated: true,
      replayed: false,
      snapshot: { id: replacement.snapshot.id, status: 'current' },
    })
    await expect(reopened.listProjects()).resolves.toEqual([project])
    await expect(reopened.listRuns()).resolves.toEqual([run])
    await expect(reopened.getCurrentKnowledgeIndexSnapshot(project.id)).resolves.toMatchObject({
      id: replacement.snapshot.id,
      chunks: [{ chunkId: 'knowledge-chunk-rebuilt' }],
    })
    reopened.close()
  })

  it('migrates Desktop schema 19 without promoting Team MCP metadata into local authority', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    await initial.saveMcpServers([mcpServer])
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const legacy = new SQL.Database(await readFile(dbPath))
    legacy.run(`
      alter table agent_runtime_tool_audits drop column installation_version;
      alter table agent_runtime_tool_audits drop column installation_id;
      alter table agent_runtime_tool_audits drop column source;
      update agent_runtime_tool_audits
         set json = json_remove(json, '$.source', '$.installationId', '$.installationVersion');
    `)
    legacy.run('drop index idx_local_mcp_installations_enabled')
    legacy.run('drop table local_mcp_installations')
    legacy.run(dropAgentMemorySchemaSql)
    legacy.run(dropKnowledgeIndexSchemaSql)
    legacy.run("update schema_meta set value = '19' where key = 'schema_version'")
    await writeFile(dbPath, Buffer.from(legacy.export()))
    legacy.close()

    const migrated = await createLocalStore({ dbPath })
    expect(await migrated.getSchemaVersion()).toBe(25)
    expect(await migrated.listMcpServers()).toEqual([mcpServer])
    expect(await migrated.listLocalMcpInstallations()).toEqual([])
    migrated.close()
  })

  it('migrates Desktop schema 17 without changing 1.x state or inventing runtime rows', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    await initial.upsertProject(project)
    await initial.saveRun(run)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const legacy = new SQL.Database(await readFile(dbPath))
    for (const table of [
      'local_mcp_installations',
      'agent_runtime_tool_audits',
      'agent_runtime_terminal_summaries',
      'agent_runtime_capability_grants',
      'agent_runtime_evaluations',
      'agent_runtime_checkpoints',
      'agent_runtime_events',
      'agent_runtimes',
    ]) {
      legacy.run(`drop table if exists ${table}`)
    }
    legacy.run(dropAgentMemorySchemaSql)
    legacy.run(dropKnowledgeIndexSchemaSql)
    legacy.run("update schema_meta set value = '17' where key = 'schema_version'")
    await writeFile(dbPath, Buffer.from(legacy.export()))
    legacy.close()

    const migrated = await createLocalStore({ dbPath })
    expect(await migrated.getSchemaVersion()).toBe(25)
    expect(await migrated.listProjects()).toEqual([project])
    expect(await migrated.listRuns()).toEqual([run])
    migrated.close()

    const inspected = new SQL.Database(await readFile(dbPath))
    for (const table of [
      'agent_runtimes',
      'agent_runtime_events',
      'agent_runtime_checkpoints',
      'agent_runtime_evaluations',
      'agent_runtime_capability_grants',
      'agent_runtime_terminal_summaries',
      'agent_runtime_tool_audits',
    ]) {
      expect(
        inspected.exec(`select count(*) from ${table}`)[0]?.values[0]?.[0],
      ).toBe(0)
    }
    inspected.close()
  })

  it('migrates Desktop schema 18 by binding durable grants to exact permission and resource scope', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    await initial.upsertProject(project)
    await initial.saveRun(run)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const legacy = new SQL.Database(await readFile(dbPath))
    legacy.run(`
      ${dropAgentMemorySchemaSql}
      ${dropKnowledgeIndexSchemaSql}
      drop table local_mcp_installations;
      drop table agent_runtime_tool_audits;
      drop index idx_agent_runtime_capability_grants_active;
      alter table agent_runtime_capability_grants rename to agent_runtime_capability_grants_v19;
      create table agent_runtime_capability_grants (
        id text primary key,
        runtime_id text not null,
        capability_id text not null,
        capability_version integer not null,
        request_digest text not null,
        status text not null,
        granted_at text not null,
        expires_at text not null,
        settled_at text,
        foreign key (runtime_id) references agent_runtimes(id) on delete cascade,
        check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
        check (length(trim(capability_id)) > 0 and length(capability_id) <= 200 and trim(capability_id) = capability_id),
        check (capability_version between 1 and 2147483647),
        check (length(request_digest) = 64 and request_digest not glob '*[^0-9a-f]*'),
        check (status in ('active', 'consumed', 'denied', 'expired', 'cancelled')),
        check (expires_at > granted_at),
        check ((status = 'active') = (settled_at is null))
      );
      create unique index idx_agent_runtime_capability_grants_active
        on agent_runtime_capability_grants(runtime_id, capability_id)
        where status = 'active';
      drop table agent_runtime_capability_grants_v19;
      update schema_meta set value = '18' where key = 'schema_version';
    `)
    await writeFile(dbPath, Buffer.from(legacy.export()))
    legacy.close()

    const migrated = await createLocalStore({ dbPath })
    expect(await migrated.getSchemaVersion()).toBe(25)
    expect(await migrated.listProjects()).toEqual([project])
    expect(await migrated.listRuns()).toEqual([run])
    expect(await migrated.listAgentRuntimeCapabilityGrants()).toEqual([])
    expect(await migrated.listAgentRuntimeToolAudits()).toEqual([])
    migrated.close()

    const inspected = new SQL.Database(await readFile(dbPath))
    expect(
      inspected.exec('pragma table_info(agent_runtime_capability_grants)')[0]?.values.map(
        (row) => String(row[1]),
      ),
    ).toEqual(expect.arrayContaining(['permission_class', 'resource_kind', 'resource_id']))
    inspected.close()
  })

  it('atomically persists exact Agent Runtime events and checkpoints across restart', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.upsertProject(project)
    await store.saveRun(gateWorkflowCreation.run)

    const created = createAgentRuntime(agentRuntimeStartRequest)
    await expect(
      store.commitAgentRuntimeTransition({ expectedRuntime: null, transition: created }),
    ).resolves.toEqual({ committed: true, replayed: false, runtime: created.runtime })

    const resumed = resumeAgentRuntime({
      runtime: created.runtime,
      expectedCheckpointVersion: created.checkpoint.version,
      authority: agentRuntimeStartRequest.authority,
      contextDigest: agentRuntimeStartRequest.contextDigest,
      capabilitySetDigest: agentRuntimeStartRequest.capabilitySetDigest,
      now: '2026-08-12T20:30:01.000Z',
    })
    await expect(
      store.commitAgentRuntimeTransition({
        expectedRuntime: created.runtime,
        transition: resumed,
      }),
    ).resolves.toEqual({ committed: true, replayed: false, runtime: resumed.runtime })
    await expect(
      store.commitAgentRuntimeTransition({
        expectedRuntime: created.runtime,
        transition: resumed,
      }),
    ).resolves.toEqual({ committed: true, replayed: true, runtime: resumed.runtime })

    const staleCancellation = cancelAgentRuntime({
      runtime: created.runtime,
      expectedCheckpointVersion: created.checkpoint.version,
      now: '2026-08-12T20:30:02.000Z',
    })
    await expect(
      store.commitAgentRuntimeTransition({
        expectedRuntime: created.runtime,
        transition: staleCancellation,
      }),
    ).resolves.toEqual({ committed: false, reason: 'stale_checkpoint' })

    expect(await store.getAgentRuntime(agentRuntimeStartRequest.id)).toEqual(resumed.runtime)
    expect(await store.listAgentRuntimeEvents(agentRuntimeStartRequest.id)).toEqual([
      ...created.events,
      ...resumed.events,
    ])
    expect(await store.listAgentRuntimeCheckpoints(agentRuntimeStartRequest.id)).toEqual([
      created.checkpoint,
      resumed.checkpoint,
    ])
    expect(await store.listRecoverableAgentRuntimes()).toEqual([resumed.runtime])
    store.close()

    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.getAgentRuntime(agentRuntimeStartRequest.id)).toEqual(resumed.runtime)
    expect(await reopened.listAgentRuntimeEvents(agentRuntimeStartRequest.id)).toEqual([
      ...created.events,
      ...resumed.events,
    ])
    expect(await reopened.listAgentRuntimeCheckpoints(agentRuntimeStartRequest.id)).toEqual([
      created.checkpoint,
      resumed.checkpoint,
    ])
    reopened.close()
  })

  it('atomically coalesces one metadata-only Team Runtime outbox operation per transition', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.upsertProject(project)
    await store.saveRun(gateWorkflowCreation.run)
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )

    const created = createAgentRuntime(teamAgentRuntimeStartRequest)
    await expect(store.commitAgentRuntimeTransition({
      expectedRuntime: null,
      transition: created,
    })).resolves.toMatchObject({ committed: true, replayed: false })
    const first = (await store.listRemoteSyncOperations()).filter(
      (operation) => operation.kind === 'agent-runtime-summary',
    )
    expect(first).toMatchObject([{
      localProjectId: project.id,
      organizationId: desktopPairingCredential.organizationId,
      teamProjectId: desktopPairingCredential.projectId,
      runId: gateWorkflowCreation.run.id,
      entityId: teamAgentRuntimeStartRequest.id,
      generation: 1,
      status: 'pending',
    }])
    expect(JSON.stringify(first)).not.toMatch(/encrypted-token|payload|source|output|checkpoint/i)

    const resumed = resumeAgentRuntime({
      runtime: created.runtime,
      expectedCheckpointVersion: created.runtime.checkpointVersion,
      authority: created.runtime.authority,
      contextDigest: created.runtime.contextDigest,
      capabilitySetDigest: created.runtime.capabilitySetDigest,
      now: '2026-08-12T20:30:01.000Z',
    })
    await store.commitAgentRuntimeTransition({
      expectedRuntime: created.runtime,
      transition: resumed,
    })
    await expect(store.commitAgentRuntimeTransition({
      expectedRuntime: created.runtime,
      transition: resumed,
    })).resolves.toMatchObject({ committed: true, replayed: true })
    expect((await store.listRemoteSyncOperations()).filter(
      (operation) => operation.kind === 'agent-runtime-summary',
    )).toMatchObject([{ generation: 2, status: 'pending' }])
    store.close()
  })

  it('rejects a structurally valid transition that was not produced by the runtime kernel', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.upsertProject(project)
    await store.saveRun(gateWorkflowCreation.run)
    const created = createAgentRuntime(agentRuntimeStartRequest)
    await store.commitAgentRuntimeTransition({ expectedRuntime: null, transition: created })
    const resumed = resumeAgentRuntime({
      runtime: created.runtime,
      expectedCheckpointVersion: created.checkpoint.version,
      authority: agentRuntimeStartRequest.authority,
      contextDigest: agentRuntimeStartRequest.contextDigest,
      capabilitySetDigest: agentRuntimeStartRequest.capabilitySetDigest,
      now: '2026-08-12T20:30:01.000Z',
    })
    const forged = {
      ...resumed,
      runtime: {
        ...resumed.runtime,
        counters: { ...resumed.runtime.counters, tokens: 1 },
      },
      checkpoint: {
        ...resumed.checkpoint,
        counters: { ...resumed.checkpoint.counters, tokens: 1 },
      },
    }

    await expect(
      store.commitAgentRuntimeTransition({
        expectedRuntime: created.runtime,
        transition: forged,
      }),
    ).resolves.toEqual({ committed: false, reason: 'invalid_transition' })
    await expect(store.getAgentRuntime(agentRuntimeStartRequest.id)).resolves.toEqual(
      created.runtime,
    )
    store.close()
  })

  it('restores the prior Agent Runtime snapshot when durable persistence fails', async () => {
    const dbPath = await tempDbPath()
    const backupPath = `${dbPath}.backup`
    const store = await createLocalStore({ dbPath })
    await store.upsertProject(project)
    await store.saveRun(gateWorkflowCreation.run)
    const created = createAgentRuntime(agentRuntimeStartRequest)

    await rename(dbPath, backupPath)
    await mkdir(dbPath)
    await expect(
      store.commitAgentRuntimeTransition({ expectedRuntime: null, transition: created }),
    ).rejects.toThrow(persistenceFailurePattern)
    await expect(store.getAgentRuntime(agentRuntimeStartRequest.id)).resolves.toBeNull()

    await rm(dbPath, { recursive: true, force: true })
    await rename(backupPath, dbPath)
    store.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(reopened.getAgentRuntime(agentRuntimeStartRequest.id)).resolves.toBeNull()
    reopened.close()
  })

  it('commits result, evaluation, counters, checkpoint, and terminal summary in one transaction', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.upsertProject(project)
    await store.saveRun(gateWorkflowCreation.run)

    const created = createAgentRuntime(agentRuntimeStartRequest)
    const resumed = resumeAgentRuntime({
      runtime: created.runtime,
      expectedCheckpointVersion: created.checkpoint.version,
      authority: agentRuntimeStartRequest.authority,
      contextDigest: agentRuntimeStartRequest.contextDigest,
      capabilitySetDigest: agentRuntimeStartRequest.capabilitySetDigest,
      now: '2026-08-12T20:30:01.000Z',
    })
    const requested = requestAgentAction({
      runtime: resumed.runtime,
      expectedCheckpointVersion: resumed.checkpoint.version,
      now: '2026-08-12T20:30:02.000Z',
      action: {
        id: 'agent-runtime-action-1',
        kind: 'tool',
        capabilityId: 'runtime.fake.observe',
        capabilityVersion: 1,
        requestDigest: 'c'.repeat(64),
        requiresPermission: false,
      },
    })
    const completed = acceptAgentActionResult({
      runtime: requested.runtime,
      expectedCheckpointVersion: requested.checkpoint.version,
      actionId: 'agent-runtime-action-1',
      requestDigest: 'c'.repeat(64),
      result: {
        outcome: 'success',
        resultDigest: 'd'.repeat(64),
        resultBytes: 32,
        tokens: 0,
        costUsd: 0,
        evaluation: 'success',
        evaluationSummary: 'The deterministic fake observation satisfied the scenario.',
      },
      now: '2026-08-12T20:30:03.000Z',
    })

    for (const [expectedRuntime, transition] of [
      [null, created],
      [created.runtime, resumed],
      [resumed.runtime, requested],
      [requested.runtime, completed],
    ] as const) {
      await expect(
        store.commitAgentRuntimeTransition({ expectedRuntime, transition }),
      ).resolves.toMatchObject({ committed: true, replayed: false })
    }

    expect(await store.getAgentRuntime(agentRuntimeStartRequest.id)).toEqual(completed.runtime)
    expect(await store.listRecoverableAgentRuntimes()).toEqual([])
    expect(await store.getAgentRuntimeTerminalSummary(agentRuntimeStartRequest.id)).toEqual({
      stateVersion: 1,
      runtimeId: agentRuntimeStartRequest.id,
      checkpointVersion: completed.checkpoint.version,
      stopReason: 'success',
      counters: { steps: 1, toolCalls: 1, tokens: 0, costUsd: 0 },
      acceptedActionCount: 1,
      lastObservationDigest: 'd'.repeat(64),
      lastResultDigest: 'd'.repeat(64),
      completedAt: '2026-08-12T20:30:03.000Z',
      redacted: true,
    })
    store.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const inspected = new SQL.Database(await readFile(dbPath))
    expect(inspected.exec('select count(*) from agent_runtime_evaluations')[0]?.values[0]?.[0]).toBe(1)
    expect(inspected.exec('select count(*) from agent_runtime_terminal_summaries')[0]?.values[0]?.[0]).toBe(1)
    expect(inspected.exec('select count(*) from agent_runtime_capability_grants')[0]?.values[0]?.[0]).toBe(0)
    inspected.close()
  })

  it('serializes competing checkpoint owners so only one continuation commits', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.upsertProject(project)
    await store.saveRun(gateWorkflowCreation.run)
    const created = createAgentRuntime(agentRuntimeStartRequest)
    await store.commitAgentRuntimeTransition({ expectedRuntime: null, transition: created })

    const resumed = resumeAgentRuntime({
      runtime: created.runtime,
      expectedCheckpointVersion: created.checkpoint.version,
      authority: agentRuntimeStartRequest.authority,
      contextDigest: agentRuntimeStartRequest.contextDigest,
      capabilitySetDigest: agentRuntimeStartRequest.capabilitySetDigest,
      now: '2026-08-12T20:30:01.000Z',
    })
    const cancelled = cancelAgentRuntime({
      runtime: created.runtime,
      expectedCheckpointVersion: created.checkpoint.version,
      now: '2026-08-12T20:30:01.000Z',
    })
    const results = await Promise.all([
      store.commitAgentRuntimeTransition({ expectedRuntime: created.runtime, transition: resumed }),
      store.commitAgentRuntimeTransition({ expectedRuntime: created.runtime, transition: cancelled }),
    ])

    expect(results.filter((result) => result.committed)).toHaveLength(1)
    expect(results.filter((result) => !result.committed)).toEqual([
      { committed: false, reason: 'stale_checkpoint' },
    ])
    expect(await store.listAgentRuntimeCheckpoints(agentRuntimeStartRequest.id)).toHaveLength(2)
    store.close()
  })

  it('fails closed when an Agent Runtime row is corrupt', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.upsertProject(project)
    await store.saveRun(gateWorkflowCreation.run)
    const created = createAgentRuntime(agentRuntimeStartRequest)
    await store.commitAgentRuntimeTransition({ expectedRuntime: null, transition: created })
    store.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const corrupt = new SQL.Database(await readFile(dbPath))
    corrupt.run('pragma ignore_check_constraints = on')
    corrupt.run("update agent_runtimes set json = '{\"stateVersion\":1}' where id = ?", [
      agentRuntimeStartRequest.id,
    ])
    await writeFile(dbPath, Buffer.from(corrupt.export()))
    corrupt.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(reopened.getAgentRuntime(agentRuntimeStartRequest.id)).rejects.toThrow(
      'Stored Agent Runtime state is invalid',
    )
    reopened.close()
  })

  it('refuses to delete a Run that owns durable Agent Runtime history', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.upsertProject(project)
    await store.saveRun(gateWorkflowCreation.run)
    const created = createAgentRuntime(agentRuntimeStartRequest)
    await store.commitAgentRuntimeTransition({ expectedRuntime: null, transition: created })

    await expect(store.deleteRun(gateWorkflowCreation.run.id)).rejects.toThrow(
      'Run is bound to an Agent Runtime.',
    )
    await expect(store.getRun(gateWorkflowCreation.run.id)).resolves.toEqual(
      gateWorkflowCreation.run,
    )
    await expect(store.getAgentRuntime(agentRuntimeStartRequest.id)).resolves.toEqual(
      created.runtime,
    )
    store.close()
  })

  it('creates metadata-only Gate Command execution, receipt, and acknowledgement tables', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    store.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const db = new SQL.Database(await readFile(dbPath))
    const columns = (table: string) =>
      db.exec(`pragma table_info(${table})`)[0]?.values.map((row) => String(row[1])) ?? []

    expect(columns('gate_command_executions')).toEqual([
      'command_id',
      'organization_id',
      'team_project_id',
      'local_project_id',
      'claim_token_id',
      'work_request_id',
      'run_id',
      'node_id',
      'action',
      'workflow_command',
      'requested_by_user_id',
      'requested_role',
      'server_request_fingerprint',
      'execution_fingerprint',
      'expected_run_version',
      'expected_policy_version',
      'expected_blocker_ids_hash',
      'outcome_code',
      'before_run_version',
      'after_run_version',
      'evaluated_at',
      'command_expires_at',
      'created_at',
    ])
    expect(columns('gate_command_receipts')).toEqual([
      'receipt_id',
      'command_id',
      'attempt',
      'leased_at',
      'lease_expires_at',
      'acknowledged_at',
      'received_at',
    ])
    expect(columns('gate_command_acknowledgements')).toEqual([
      'receipt_id',
      'command_id',
      'outcome_code',
      'before_run_version',
      'after_run_version',
      'evaluated_at',
      'status',
      'remote_acknowledgement_id',
      'remote_created_at',
      'remote_replayed',
      'created_at',
      'acknowledged_at',
      'failure_code',
      'failed_at',
    ])
    expect(columns('gate_command_receipt_observations')).toEqual([
      'receipt_id',
      'command_id',
      'attempt',
      'leased_at',
      'lease_expires_at',
      'received_at',
      'organization_id',
      'team_project_id',
      'local_project_id',
      'work_request_id',
      'run_id',
      'node_id',
      'claim_token_id',
      'execution_fingerprint',
      'status',
      'outcome_code',
      'evaluated_at',
    ])
    for (const table of [
      'gate_command_executions',
      'gate_command_receipts',
      'gate_command_acknowledgements',
      'gate_command_receipt_observations',
    ]) {
      expect(columns(table)).not.toEqual(
        expect.arrayContaining([
          'json',
          'raw_json',
          'reason',
          'token',
          'token_id',
          'secret',
        ]),
      )
    }
    db.close()
  })

  it('persists a received Gate Command receipt observation before evaluation and across reopen', async () => {
    const dbPath = await tempDbPath()
    const first = await createLocalStore({ dbPath })
    await first.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )

    await expect(
      first.recordGateCommandReceiptObservation({
        command: deliveringGateCommand,
        receipt: gateCommandReceipt,
        expectedPairing: workRequestPairing,
        receivedAt: '2026-08-01T02:01:10.000Z',
      }),
    ).resolves.toEqual({
      recorded: true,
      replayed: false,
      observation: {
        receiptId: gateCommandReceipt.id,
        commandId: deliveringGateCommand.id,
        attempt: gateCommandReceipt.attempt,
        leasedAt: gateCommandReceipt.leasedAt,
        leaseExpiresAt: gateCommandReceipt.leaseExpiresAt,
        receivedAt: '2026-08-01T02:01:10.000Z',
        organizationId: deliveringGateCommand.organizationId,
        teamProjectId: deliveringGateCommand.projectId,
        localProjectId: project.id,
        workRequestId: null,
        runId: deliveringGateCommand.runId,
        nodeId: deliveringGateCommand.nodeId,
        claimTokenId: desktopPairingCredential.tokenId,
        executionFingerprint: gateCommandExecutionFingerprint(deliveringGateCommand),
        status: 'received',
        outcomeCode: null,
        evaluatedAt: null,
      },
    })
    first.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(
      reopened.getGateCommandReceiptObservation(gateCommandReceipt.id),
    ).resolves.toMatchObject({
      receiptId: gateCommandReceipt.id,
      commandId: deliveringGateCommand.id,
      status: 'received',
      outcomeCode: null,
      evaluatedAt: null,
    })
    reopened.close()
  })

  it('replays exact receipt observations, accepts a new attempt, and rejects changed authority', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    const initial = {
      command: deliveringGateCommand,
      receipt: gateCommandReceipt,
      expectedPairing: workRequestPairing,
      receivedAt: '2026-08-01T02:01:10.000Z',
    }
    await expect(
      store.recordGateCommandReceiptObservation(initial),
    ).resolves.toMatchObject({ recorded: true, replayed: false })
    await expect(
      store.recordGateCommandReceiptObservation({
        ...initial,
        receivedAt: '2026-08-01T02:01:20.000Z',
      }),
    ).resolves.toMatchObject({
      recorded: true,
      replayed: true,
      observation: { receivedAt: initial.receivedAt },
    })

    await expect(
      store.recordGateCommandReceiptObservation({
        ...initial,
        receipt: {
          ...gateCommandReceipt,
          id: 'gate-command-receipt-local-2',
          attempt: 2,
          leasedAt: '2026-08-01T02:02:00.000Z',
          leaseExpiresAt: '2026-08-01T02:03:00.000Z',
        },
        receivedAt: '2026-08-01T02:02:10.000Z',
      }),
    ).resolves.toMatchObject({
      recorded: true,
      replayed: false,
      observation: { attempt: 2, status: 'received' },
    })

    await expect(
      store.recordGateCommandReceiptObservation({
        ...initial,
        receipt: {
          ...gateCommandReceipt,
          leaseExpiresAt: '2026-08-01T02:01:59.000Z',
        },
      }),
    ).resolves.toEqual({ recorded: false, reason: 'receipt_conflict' })
    await expect(
      store.recordGateCommandReceiptObservation({
        ...initial,
        receivedAt: gateCommandReceipt.leaseExpiresAt,
      }),
    ).resolves.toEqual({ recorded: false, reason: 'invalid_input' })
    await expect(
      store.recordGateCommandReceiptObservation({
        ...initial,
        receipt: { ...gateCommandReceipt, id: 'colliding-receipt-id' },
      }),
    ).resolves.toEqual({ recorded: false, reason: 'receipt_conflict' })
    await expect(
      store.recordGateCommandReceiptObservation({
        ...initial,
        command: {
          ...deliveringGateCommand,
          reason: 'Changed signed execution payload.',
        },
      }),
    ).resolves.toEqual({ recorded: false, reason: 'fingerprint_conflict' })
    await expect(
      store.recordGateCommandReceiptObservation({
        ...initial,
        command: { ...deliveringGateCommand, organizationId: 'other-org' },
      }),
    ).resolves.toEqual({ recorded: false, reason: 'pairing_scope_mismatch' })
    await expect(
      store.recordGateCommandReceiptObservation({
        ...initial,
        expectedPairing: { ...workRequestPairing, tokenId: 'other-token' },
      }),
    ).resolves.toEqual({ recorded: false, reason: 'pairing_scope_mismatch' })
    store.close()
  })

  it('marks the pre-observed receipt evaluated in the final Gate execution commit', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    const command: GateCommand = {
      ...deliveringGateCommand,
      id: 'gate-command-observed-reject',
      action: 'reject',
      workflowCommand: null,
      reason: 'Reject after durable receipt observation.',
      idempotencyKey: 'gate-command:observed-reject:run-1:v3',
      requestFingerprint: '8'.repeat(64),
    }
    const receipt: GateCommandReceipt = {
      ...gateCommandReceipt,
      id: 'gate-command-receipt-observed-reject',
      commandId: command.id,
    }
    const receivedAt = '2026-08-01T02:01:10.000Z'

    await store.recordGateCommandReceiptObservation({
      command,
      receipt,
      expectedPairing: workRequestPairing,
      receivedAt,
    })
    await expect(
      store.commitGateCommandExecution({
        command,
        receipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'human_rejected',
        evaluatedAt: gateRunAfter.updatedAt,
      }),
    ).resolves.toMatchObject({
      committed: true,
      execution: { outcomeCode: 'human_rejected' },
    })
    await expect(
      store.getGateCommandReceiptObservation(receipt.id),
    ).resolves.toMatchObject({
      receiptId: receipt.id,
      commandId: command.id,
      receivedAt,
      status: 'evaluated',
      outcomeCode: 'human_rejected',
      evaluatedAt: gateRunAfter.updatedAt,
    })
    await expect(
      store.recordGateCommandReceiptObservation({
        command,
        receipt,
        expectedPairing: workRequestPairing,
        receivedAt: '2026-08-01T02:01:40.000Z',
      }),
    ).resolves.toMatchObject({
      recorded: true,
      replayed: true,
      observation: {
        receivedAt,
        status: 'evaluated',
        outcomeCode: 'human_rejected',
        evaluatedAt: gateRunAfter.updatedAt,
      },
    })
    store.close()
  })

  it('restores a pre-evaluation receipt observation when durable persistence fails', async () => {
    const dbPath = await tempDbPath()
    const backupPath = `${dbPath}.backup`
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await rename(dbPath, backupPath)
    await mkdir(dbPath)

    await expect(
      store.recordGateCommandReceiptObservation({
        command: deliveringGateCommand,
        receipt: gateCommandReceipt,
        expectedPairing: workRequestPairing,
        receivedAt: '2026-08-01T02:01:10.000Z',
      }),
    ).rejects.toThrow(persistenceFailurePattern)
    await expect(
      store.getGateCommandReceiptObservation(gateCommandReceipt.id),
    ).resolves.toBeNull()
    store.close()
  })

  it('enforces the shared 15-minute command TTL and 60-second receipt lease in SQLite', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    store.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const db = new SQL.Database(await readFile(dbPath))
    const insertExecution = (
      commandId: string,
      expiresAt: string,
      claimTokenId = 'claim-token-1',
    ) =>
      db.run(
        `insert into gate_command_executions (
           command_id, organization_id, team_project_id, local_project_id,
           claim_token_id,
           work_request_id, run_id, node_id, action, workflow_command,
           requested_by_user_id, requested_role, server_request_fingerprint,
           execution_fingerprint, expected_run_version, expected_policy_version,
           expected_blocker_ids_hash, outcome_code, before_run_version,
           after_run_version, evaluated_at, command_expires_at, created_at
         ) values (?, 'org-1', 'team-project-1', 'local-project-1', ?, null,
           'run-1', 'node-1', 'approve', 'approve_gate', 'user-1', 'lead',
           ?, ?, 3, 2, ?, 'stale_policy', 3, 3,
           '2026-08-01T02:01:00.000Z', ?, '2026-08-01T02:00:00.000Z')`,
        [commandId, claimTokenId, 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), expiresAt],
      )

    expect(() =>
      insertExecution('gate-command-too-long', '2026-08-01T02:15:00.001Z'),
    ).toThrow(/constraint/i)
    insertExecution('gate-command-valid-ttl', '2026-08-01T02:15:00.000Z')
    expect(() =>
      insertExecution(
        'gate-command-invalid-claim-token',
        '2026-08-01T02:15:00.000Z',
        ` ${'x'.repeat(200)}`,
      ),
    ).toThrow(/constraint/i)
    expect(() =>
      db.run(
        `insert into gate_command_receipts (
           receipt_id, command_id, attempt, leased_at, lease_expires_at, received_at
         ) values ('receipt-too-long', 'gate-command-valid-ttl', 1,
           '2026-08-01T02:01:00.000Z', '2026-08-01T02:02:00.001Z',
           '2026-08-01T02:01:30.000Z')`,
      ),
    ).toThrow(/constraint/i)
    db.close()
  })

  it('enforces receipt observation identity, fingerprint, lease, and lifecycle state in SQLite', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    store.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const db = new SQL.Database(await readFile(dbPath))
    const insert = (overrides: {
      receiptId?: string
      commandId?: string
      attempt?: number
      leaseExpiresAt?: string
      receivedAt?: string
      executionFingerprint?: string
      status?: string
      outcomeCode?: string | null
      evaluatedAt?: string | null
    } = {}) =>
      db.run(
        `insert into gate_command_receipt_observations (
           receipt_id, command_id, attempt, leased_at, lease_expires_at, received_at,
           organization_id, team_project_id, local_project_id, work_request_id,
           run_id, node_id, claim_token_id, execution_fingerprint,
           status, outcome_code, evaluated_at
         ) values (?, ?, ?, '2026-08-01T02:01:00.000Z', ?, ?,
           'org-1', 'team-1', 'local-1', null, 'run-1', 'node-1', 'token-1',
           ?, ?, ?, ?)`,
        [
          overrides.receiptId ?? 'observation-receipt',
          overrides.commandId ?? 'observation-command',
          overrides.attempt ?? 1,
          overrides.leaseExpiresAt ?? '2026-08-01T02:02:00.000Z',
          overrides.receivedAt ?? '2026-08-01T02:01:10.000Z',
          overrides.executionFingerprint ?? 'a'.repeat(64),
          overrides.status ?? 'received',
          overrides.outcomeCode ?? null,
          overrides.evaluatedAt ?? null,
        ],
      )

    expect(() => insert({ executionFingerprint: 'not-a-fingerprint' })).toThrow(
      /constraint/i,
    )
    expect(() => insert({ leaseExpiresAt: '2026-08-01T02:02:00.001Z' })).toThrow(
      /constraint/i,
    )
    expect(() => insert({ receivedAt: '2026-08-01T02:00:59.999Z' })).toThrow(
      /constraint/i,
    )
    expect(() => insert({ outcomeCode: 'applied' })).toThrow(/constraint/i)
    expect(() =>
      insert({ status: 'evaluated', outcomeCode: 'applied' }),
    ).toThrow(/constraint/i)
    insert()
    expect(() =>
      insert({ receiptId: 'other-receipt-same-attempt' }),
    ).toThrow(/constraint/i)
    insert({
      receiptId: 'evaluated-observation-receipt',
      commandId: 'evaluated-observation-command',
      status: 'evaluated',
      outcomeCode: 'human_rejected',
      evaluatedAt: '2026-08-01T02:01:30.000Z',
    })
    db.close()
  })

  it('atomically applies an approved Gate Command with its receipt, event, and Run summary', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    await store.saveArtifact(gateClarificationArtifact)
    await store.savePolicySnapshot(gatePolicySnapshotV2)

    await expect(
      store.commitGateCommandExecution({
        command: deliveringGateCommand,
        receipt: gateCommandReceipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'applied',
        evaluatedAt: gateRunAfter.updatedAt,
        expectedRun: gateRunBefore,
        run: gateRunAfter,
        event: gateApprovalEvent,
        evaluationBinding: gateEvaluationBinding,
      }),
    ).resolves.toMatchObject({
      committed: true,
      replayed: false,
      acknowledgement: {
        receiptId: gateCommandReceipt.id,
        commandId: deliveringGateCommand.id,
        outcomeCode: 'applied',
        beforeRunVersion: 3,
        afterRunVersion: 4,
        evaluatedAt: gateRunAfter.updatedAt,
        status: 'pending',
        remoteAcknowledgementId: null,
      },
    })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunAfter)
    await expect(store.listEvents(gateRunBefore.id)).resolves.toEqual([
      gateApprovalEvent,
    ])
    await expect(store.listRemoteSyncOperations(gateRunBefore.id)).resolves.toEqual([
      expect.objectContaining({
        kind: 'run-summary',
        generation: 2,
        status: 'pending',
      }),
    ])
    await expect(
      store.getGateCommandExecution(deliveringGateCommand.id),
    ).resolves.toMatchObject({
      commandId: deliveringGateCommand.id,
      runId: gateRunBefore.id,
      claimTokenId: desktopPairingCredential.tokenId,
      action: 'approve',
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
      executionFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      expectedBlockerIdsHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    store.close()
  })

  it('rejects an applied Gate commit that omits its enforcement evaluation binding', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    await store.saveArtifact(gateClarificationArtifact)
    await store.savePolicySnapshot(gatePolicySnapshotV2)

    await expect(
      store.commitGateCommandExecution({
        command: deliveringGateCommand,
        receipt: gateCommandReceipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'applied',
        evaluatedAt: gateRunAfter.updatedAt,
        expectedRun: gateRunBefore,
        run: gateRunAfter,
        event: gateApprovalEvent,
      }),
    ).resolves.toEqual({ committed: false, reason: 'invalid_input' })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
    await expect(store.getGateCommandExecution(deliveringGateCommand.id)).resolves.toBeNull()
    store.close()
  })

  it('records stale_policy without applying when policy changes after a version-3 Run was evaluated', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    await store.saveArtifact(gateClarificationArtifact)
    await store.savePolicySnapshot(gatePolicySnapshotV2)
    await store.savePolicySnapshot({
      ...gatePolicySnapshotV2,
      organizationPolicy: {
        ...gateOrganizationPolicyV2,
        version: 3,
        updatedAt: '2026-08-01T02:01:00.000Z',
      },
      effectivePolicy: {
        ...gatePolicySnapshotV2.effectivePolicy!,
        version: 3,
        updatedAt: '2026-08-01T02:01:00.000Z',
      },
      version: 3,
      updatedAt: '2026-08-01T02:01:00.000Z',
      syncedAt: '2026-08-01T02:01:01.000Z',
    })

    await expect(
      store.commitGateCommandExecution({
        command: deliveringGateCommand,
        receipt: gateCommandReceipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'applied',
        evaluatedAt: gateRunAfter.updatedAt,
        expectedRun: gateRunBefore,
        run: gateRunAfter,
        event: gateApprovalEvent,
        evaluationBinding: gateEvaluationBinding,
      }),
    ).resolves.toMatchObject({
      committed: true,
      replayed: false,
      execution: {
        outcomeCode: 'stale_policy',
        beforeRunVersion: 3,
        afterRunVersion: 3,
      },
      acknowledgement: {
        outcomeCode: 'stale_policy',
        beforeRunVersion: 3,
        afterRunVersion: 3,
      },
    })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
    await expect(store.listEvents(gateRunBefore.id)).resolves.toEqual([])
    store.close()
  })

  it('records evidence_blocked without applying when the evaluated exact override is revoked', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const blockerId = 'governance_check:testing_standard:needs_evidence'
    const command: GateCommand = {
      ...deliveringGateCommand,
      id: 'gate-command-override-revoked',
      idempotencyKey: 'gate-command:override-revoked:run-1:v3',
      requestFingerprint: '7'.repeat(64),
      expectedBlockerIds: [blockerId],
      evaluationStatus: 'allowed',
      evaluationBlockerIds: [blockerId],
    }
    const receipt: GateCommandReceipt = {
      ...gateCommandReceipt,
      id: 'gate-command-receipt-override-revoked',
      commandId: command.id,
    }
    const enforcement: GateEnforcementDecision = {
      ...gateEnforcementV2,
      status: 'blocked',
      blocksApproval: true,
      blockingReasons: [{
        id: blockerId,
        target: 'governance_check',
        ruleKey: 'testing-standard-needs-evidence',
        action: 'block',
        summary: 'Passing test evidence is required.',
      }],
      canOverride: true,
    }
    const acceptedOverride: GateOverrideDecision = {
      id: 'gate-override-command-revoked',
      runId: gateRunBefore.id,
      nodeId: gateRunBefore.currentNodeId,
      projectId: project.id,
      userId: command.requestedByUserId,
      role: 'lead',
      reason: 'Lead accepts this bounded policy exception.',
      blockedReasonIds: [blockerId],
      policyVersion: command.expectedPolicyVersion,
      provisional: false,
      status: 'accepted',
      createdAt: '2026-08-01T02:00:30.000Z',
    }
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    await store.saveArtifact(gateClarificationArtifact)
    await store.savePolicySnapshot(gatePolicySnapshotV2)
    await store.saveGateOverride(acceptedOverride)
    await store.saveGateOverride({ ...acceptedOverride, status: 'rejected' })

    await expect(
      store.commitGateCommandExecution({
        command,
        receipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'applied',
        evaluatedAt: gateRunAfter.updatedAt,
        expectedRun: gateRunBefore,
        run: gateRunAfter,
        event: { ...gateApprovalEvent, id: 'event-gate-override-revoked' },
        evaluationBinding: {
          ...gateEvaluationBinding,
          enforcement,
          overrides: [acceptedOverride],
          selectedOverrideId: acceptedOverride.id,
        },
      }),
    ).resolves.toMatchObject({
      committed: true,
      execution: {
        outcomeCode: 'evidence_blocked',
        beforeRunVersion: 3,
        afterRunVersion: 3,
      },
      acknowledgement: {
        outcomeCode: 'evidence_blocked',
        beforeRunVersion: 3,
        afterRunVersion: 3,
      },
    })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
    await expect(store.listEvents(gateRunBefore.id)).resolves.toEqual([])
    store.close()
  })

  it('accepts an exact local-project override when the Team project id is different', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const blockerId = 'governance_check:testing_standard:needs_evidence'
    const command: GateCommand = {
      ...deliveringGateCommand,
      id: 'gate-command-local-project-override',
      idempotencyKey: 'gate-command:local-project-override:run-1:v3',
      requestFingerprint: '5'.repeat(64),
      expectedBlockerIds: [blockerId],
      evaluationBlockerIds: [blockerId],
    }
    const receipt: GateCommandReceipt = {
      ...gateCommandReceipt,
      id: 'gate-command-receipt-local-project-override',
      commandId: command.id,
    }
    const override: GateOverrideDecision = {
      id: 'gate-override-local-project',
      runId: gateRunBefore.id,
      nodeId: gateRunBefore.currentNodeId,
      projectId: project.id,
      userId: command.requestedByUserId,
      role: 'lead',
      reason: 'Lead accepts this exact bounded exception.',
      blockedReasonIds: [blockerId],
      policyVersion: command.expectedPolicyVersion,
      provisional: false,
      status: 'accepted',
      createdAt: '2026-08-01T02:00:30.000Z',
    }
    const enforcement: GateEnforcementDecision = {
      ...gateEnforcementV2,
      status: 'overridden',
      blockingReasons: [{
        id: blockerId,
        target: 'governance_check',
        ruleKey: 'testing-standard-needs-evidence',
        action: 'block',
        summary: 'Passing test evidence is required.',
      }],
      canOverride: true,
    }
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    await store.saveArtifact(gateClarificationArtifact)
    await store.savePolicySnapshot(gatePolicySnapshotV2)
    await store.saveGateOverride(override)

    await expect(
      store.commitGateCommandExecution({
        command,
        receipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'applied',
        evaluatedAt: gateRunAfter.updatedAt,
        expectedRun: gateRunBefore,
        run: gateRunAfter,
        event: { ...gateApprovalEvent, id: 'event-gate-local-project-override' },
        evaluationBinding: {
          ...gateEvaluationBinding,
          enforcement,
          overrides: [override],
          selectedOverrideId: override.id,
        },
      }),
    ).resolves.toMatchObject({
      committed: true,
      execution: { outcomeCode: 'applied', afterRunVersion: 4 },
    })
    expect(command.projectId).not.toBe(override.projectId)
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunAfter)
    store.close()
  })

  it('rechecks enforcement authorization and refuses a blocked evaluation without an exact override', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const blockerId = 'governance_check:testing_standard:needs_evidence'
    const command: GateCommand = {
      ...deliveringGateCommand,
      id: 'gate-command-missing-exact-override',
      idempotencyKey: 'gate-command:missing-exact-override:run-1:v3',
      requestFingerprint: '6'.repeat(64),
      expectedBlockerIds: [blockerId],
      evaluationBlockerIds: [blockerId],
    }
    const receipt: GateCommandReceipt = {
      ...gateCommandReceipt,
      id: 'gate-command-receipt-missing-exact-override',
      commandId: command.id,
    }
    const enforcement: GateEnforcementDecision = {
      ...gateEnforcementV2,
      status: 'blocked',
      blocksApproval: true,
      blockingReasons: [{
        id: blockerId,
        target: 'governance_check',
        ruleKey: 'testing-standard-needs-evidence',
        action: 'block',
        summary: 'Passing test evidence is required.',
      }],
      canOverride: true,
    }
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    await store.saveArtifact(gateClarificationArtifact)
    await store.savePolicySnapshot(gatePolicySnapshotV2)

    await expect(
      store.commitGateCommandExecution({
        command,
        receipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'applied',
        evaluatedAt: gateRunAfter.updatedAt,
        expectedRun: gateRunBefore,
        run: gateRunAfter,
        event: { ...gateApprovalEvent, id: 'event-gate-missing-exact-override' },
        evaluationBinding: {
          ...gateEvaluationBinding,
          enforcement,
        },
      }),
    ).resolves.toMatchObject({
      committed: true,
      execution: { outcomeCode: 'evidence_blocked', afterRunVersion: 3 },
      acknowledgement: { outcomeCode: 'evidence_blocked', afterRunVersion: 3 },
    })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
    await expect(store.listEvents(gateRunBefore.id)).resolves.toEqual([])
    store.close()
  })

  it('records evidence_blocked without applying when persisted evidence changes after evaluation', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    await store.saveArtifact(gateClarificationArtifact)
    await store.savePolicySnapshot(gatePolicySnapshotV2)
    await store.saveArtifact({
      ...gateClarificationArtifact,
      id: 'artifact-added-after-gate-evaluation',
      title: 'Changed evidence after evaluation',
      updatedAt: '2026-08-01T02:01:00.000Z',
    })

    await expect(
      store.commitGateCommandExecution({
        command: deliveringGateCommand,
        receipt: gateCommandReceipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'applied',
        evaluatedAt: gateRunAfter.updatedAt,
        expectedRun: gateRunBefore,
        run: gateRunAfter,
        event: gateApprovalEvent,
        evaluationBinding: gateEvaluationBinding,
      }),
    ).resolves.toMatchObject({
      committed: true,
      execution: {
        outcomeCode: 'evidence_blocked',
        beforeRunVersion: 3,
        afterRunVersion: 3,
      },
      acknowledgement: {
        outcomeCode: 'evidence_blocked',
        beforeRunVersion: 3,
        afterRunVersion: 3,
      },
    })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
    await expect(store.listEvents(gateRunBefore.id)).resolves.toEqual([])
    store.close()
  })

  it('records evidence_blocked when the optimistic repository knowledge fingerprint changes', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    await store.saveArtifact(gateClarificationArtifact)
    await store.savePolicySnapshot(gatePolicySnapshotV2)

    await expect(
      store.commitGateCommandExecution({
        command: deliveringGateCommand,
        receipt: gateCommandReceipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'applied',
        evaluatedAt: gateRunAfter.updatedAt,
        expectedRun: gateRunBefore,
        run: gateRunAfter,
        event: gateApprovalEvent,
        evaluationBinding: {
          ...gateEvaluationBinding,
          repositoryKnowledge: {
            ...gateEvaluationBinding.repositoryKnowledge,
            observedFingerprint: `sha256:${'b'.repeat(64)}`,
          },
        },
      }),
    ).resolves.toMatchObject({
      committed: true,
      execution: { outcomeCode: 'evidence_blocked', afterRunVersion: 3 },
      acknowledgement: { outcomeCode: 'evidence_blocked', afterRunVersion: 3 },
    })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
    await expect(store.listEvents(gateRunBefore.id)).resolves.toEqual([])
    store.close()
  })

  it('fails closed instead of overwriting an existing workflow event during Gate apply', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    await store.saveArtifact(gateClarificationArtifact)
    const existingEvent = {
      ...gateApprovalEvent,
      message: 'Existing immutable workflow event.',
    }
    await store.saveEvent(existingEvent)

    await expect(
      store.commitGateCommandExecution({
        command: deliveringGateCommand,
        receipt: gateCommandReceipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'applied',
        evaluatedAt: gateRunAfter.updatedAt,
        expectedRun: gateRunBefore,
        run: gateRunAfter,
        event: gateApprovalEvent,
      }),
    ).resolves.toEqual({ committed: false, reason: 'invalid_input' })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
    await expect(store.listEvents(gateRunBefore.id)).resolves.toEqual([
      existingEvent,
    ])
    await expect(
      store.getGateCommandExecution(deliveringGateCommand.id),
    ).resolves.toBeNull()
    store.close()
  })

  it('fails closed when an applied Gate candidate is not the exact shared workflow transition', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    await store.saveArtifact(gateClarificationArtifact)
    const forgedRun: WorkflowRun = {
      ...gateRunBefore,
      version: gateRunBefore.version + 1,
      updatedAt: gateRunAfter.updatedAt,
    }

    await expect(
      store.commitGateCommandExecution({
        command: deliveringGateCommand,
        receipt: gateCommandReceipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'applied',
        evaluatedAt: gateRunAfter.updatedAt,
        expectedRun: gateRunBefore,
        run: forgedRun,
        event: gateApprovalEvent,
      }),
    ).resolves.toEqual({ committed: false, reason: 'invalid_input' })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
    await expect(store.listEvents(gateRunBefore.id)).resolves.toEqual([])
    await expect(
      store.getGateCommandExecution(deliveringGateCommand.id),
    ).resolves.toBeNull()
    store.close()
  })

  it('rejects apply exactly at the receipt or command expiry boundary', async () => {
    const cases = [
      {
        suffix: 'receipt-boundary',
        command: deliveringGateCommand,
        receipt: gateCommandReceipt,
        evaluatedAt: gateCommandReceipt.leaseExpiresAt,
      },
      {
        suffix: 'command-boundary',
        command: {
          ...deliveringGateCommand,
          id: 'gate-command-command-boundary',
          idempotencyKey: 'gate-command:command-boundary:run-1:v3',
          requestFingerprint: '8'.repeat(64),
          updatedAt: '2026-08-01T02:14:00.000Z',
        },
        receipt: {
          ...gateCommandReceipt,
          id: 'gate-command-receipt-command-boundary',
          commandId: 'gate-command-command-boundary',
          leasedAt: '2026-08-01T02:14:00.000Z',
          leaseExpiresAt: '2026-08-01T02:15:00.000Z',
        },
        evaluatedAt: deliveringGateCommand.expiresAt,
      },
    ] satisfies Array<{
      suffix: string
      command: GateCommand
      receipt: GateCommandReceipt
      evaluatedAt: string
    }>

    for (const testCase of cases) {
      const dbPath = await tempDbPath()
      const store = await createLocalStore({ dbPath })
      await store.saveDesktopPairingCredential(
        { ...desktopPairingCredential, localProjectId: project.id },
        'encrypted-token',
      )
      await store.saveRun(gateRunBefore)
      await store.saveArtifact(gateClarificationArtifact)
      const boundaryTransition = applyWorkflowCommand({
        run: gateRunBefore,
        command: { type: 'approve_gate', nodeId: gateRunBefore.currentNodeId },
        evidence: {
          artifacts: [gateClarificationArtifact],
          codingRuns: [],
          codingDiffs: [],
          testEvidence: [],
          agentReviews: [],
          approval: {
            roleAllowed: true,
            policy: { blocksApproval: false },
            review: 'not_required',
            budget: 'not_required',
          },
        },
        now: testCase.evaluatedAt,
      })
      if (!boundaryTransition.applied) {
        throw new Error(`Invalid boundary fixture: ${testCase.suffix}`)
      }

      await expect(
        store.commitGateCommandExecution({
          command: testCase.command,
          receipt: testCase.receipt,
          expectedPairing: workRequestPairing,
          outcomeCode: 'applied',
          evaluatedAt: testCase.evaluatedAt,
          expectedRun: gateRunBefore,
          run: boundaryTransition.run,
          event: {
            ...gateApprovalEvent,
            id: `event-${testCase.suffix}`,
            timestamp: testCase.evaluatedAt,
          },
        }),
      ).resolves.toEqual({ committed: false, reason: 'invalid_input' })
      await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
      store.close()
    }
  })

  it('records a human rejection without mutating the Run, events, or Run-summary outbox', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    const rejectCommand: GateCommand = {
      ...deliveringGateCommand,
      id: 'gate-command-local-reject',
      action: 'reject',
      workflowCommand: null,
      reason: 'Reject until the rollout plan is clearer.',
      idempotencyKey: 'gate-command:reject:run-1:v3',
      requestFingerprint: 'c'.repeat(64),
    }
    const rejectReceipt: GateCommandReceipt = {
      ...gateCommandReceipt,
      id: 'gate-command-receipt-local-reject',
      commandId: rejectCommand.id,
    }

    await expect(
      store.commitGateCommandExecution({
        command: rejectCommand,
        receipt: rejectReceipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'human_rejected',
        evaluatedAt: gateRunAfter.updatedAt,
      }),
    ).resolves.toMatchObject({
      committed: true,
      replayed: false,
      execution: {
        outcomeCode: 'human_rejected',
        beforeRunVersion: 3,
        afterRunVersion: 3,
      },
      acknowledgement: {
        outcomeCode: 'human_rejected',
        beforeRunVersion: 3,
        afterRunVersion: 3,
        status: 'pending',
      },
    })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
    await expect(store.listEvents(gateRunBefore.id)).resolves.toEqual([])
    await expect(store.listRemoteSyncOperations(gateRunBefore.id)).resolves.toEqual([
      expect.objectContaining({
        kind: 'run-summary',
        generation: 1,
        status: 'pending',
      }),
    ])
    await expect(
      store.getGateCommandReceiptObservation(rejectReceipt.id),
    ).resolves.toMatchObject({
      receiptId: rejectReceipt.id,
      status: 'evaluated',
      outcomeCode: 'human_rejected',
      receivedAt: gateRunAfter.updatedAt,
      evaluatedAt: gateRunAfter.updatedAt,
    })
    store.close()
  })

  it('records a deterministic Gate failure without mutating canonical workflow state', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    const command = {
      ...deliveringGateCommand,
      id: 'gate-command-local-stale-policy',
      idempotencyKey: 'gate-command:stale-policy:run-1:v3',
      requestFingerprint: 'd'.repeat(64),
    }
    const receipt = {
      ...gateCommandReceipt,
      id: 'gate-command-receipt-local-stale-policy',
      commandId: command.id,
    }

    await expect(
      store.commitGateCommandExecution({
        command,
        receipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'stale_policy',
        evaluatedAt: gateRunAfter.updatedAt,
      }),
    ).resolves.toMatchObject({
      committed: true,
      replayed: false,
      execution: {
        outcomeCode: 'stale_policy',
        beforeRunVersion: 3,
        afterRunVersion: 3,
      },
    })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
    await expect(store.listEvents(gateRunBefore.id)).resolves.toEqual([])
    await expect(store.listRemoteSyncOperations(gateRunBefore.id)).resolves.toEqual([
      expect.objectContaining({ generation: 1 }),
    ])
    store.close()
  })

  it('deduplicates an applied command across a later delivery receipt without applying twice', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    await store.saveArtifact(gateClarificationArtifact)
    await store.savePolicySnapshot(gatePolicySnapshotV2)
    const initial = {
      command: deliveringGateCommand,
      receipt: gateCommandReceipt,
      expectedPairing: workRequestPairing,
      outcomeCode: 'applied' as const,
      evaluatedAt: gateRunAfter.updatedAt,
      expectedRun: gateRunBefore,
      run: gateRunAfter,
      event: gateApprovalEvent,
      evaluationBinding: gateEvaluationBinding,
    }
    await store.commitGateCommandExecution(initial)

    const redeliveryReceipt: GateCommandReceipt = {
      ...gateCommandReceipt,
      id: 'gate-command-receipt-local-redelivery',
      attempt: 2,
      leasedAt: '2026-08-01T02:03:00.000Z',
      leaseExpiresAt: '2026-08-01T02:04:00.000Z',
    }
    const redelivery = {
      ...initial,
      receipt: redeliveryReceipt,
      evaluatedAt: '2026-08-01T02:03:30.000Z',
    }
    const expectedReplay = {
      committed: true,
      replayed: true,
      execution: {
        evaluatedAt: gateRunAfter.updatedAt,
        outcomeCode: 'applied',
        beforeRunVersion: 3,
        afterRunVersion: 4,
      },
      acknowledgement: {
        receiptId: gateCommandReceipt.id,
        evaluatedAt: gateRunAfter.updatedAt,
        outcomeCode: 'applied',
        beforeRunVersion: 3,
        afterRunVersion: 4,
      },
    }
    await expect(store.commitGateCommandExecution(redelivery)).resolves.toMatchObject(
      expectedReplay,
    )
    await expect(store.commitGateCommandExecution(redelivery)).resolves.toMatchObject(
      expectedReplay,
    )
    await expect(store.listPendingGateCommandAcknowledgements()).resolves.toEqual([
      expect.objectContaining({
        receiptId: gateCommandReceipt.id,
        evaluatedAt: gateRunAfter.updatedAt,
        status: 'pending',
      }),
    ])
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunAfter)
    await expect(store.listEvents(gateRunBefore.id)).resolves.toEqual([
      gateApprovalEvent,
    ])
    await expect(store.listRemoteSyncOperations(gateRunBefore.id)).resolves.toEqual([
      expect.objectContaining({ generation: 2 }),
    ])
    await expect(
      store.getGateCommandReceiptObservation(redeliveryReceipt.id),
    ).resolves.toMatchObject({
      receiptId: redeliveryReceipt.id,
      attempt: 2,
      status: 'evaluated',
      outcomeCode: 'applied',
      receivedAt: redelivery.evaluatedAt,
      evaluatedAt: redelivery.evaluatedAt,
    })
    store.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const inspected = new SQL.Database(await readFile(dbPath))
    expect(
      inspected.exec(
        `select
           (select count(*) from gate_command_receipts where command_id = ?),
           (select count(*) from gate_command_acknowledgements where command_id = ?)`,
        [deliveringGateCommand.id, deliveringGateCommand.id],
      )[0]?.values[0],
    ).toEqual([2, 1])
    inspected.close()
  })

  it('refuses to attach a redelivery receipt after pairing changes to a new token record', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    await store.saveArtifact(gateClarificationArtifact)
    await store.savePolicySnapshot(gatePolicySnapshotV2)
    const initial = await store.commitGateCommandExecution({
      command: deliveringGateCommand,
      receipt: gateCommandReceipt,
      expectedPairing: workRequestPairing,
      outcomeCode: 'applied',
      evaluatedAt: gateRunAfter.updatedAt,
      expectedRun: gateRunBefore,
      run: gateRunAfter,
      event: gateApprovalEvent,
      evaluationBinding: gateEvaluationBinding,
    })
    expect(initial).toMatchObject({ committed: true, replayed: false })
    const replacementTokenId = 'desktop-token-replacement'
    await store.saveDesktopPairingCredential(
      {
        ...desktopPairingCredential,
        tokenId: replacementTokenId,
        localProjectId: project.id,
      },
      'encrypted-replacement-token',
    )
    const repairedReceipt: GateCommandReceipt = {
      ...gateCommandReceipt,
      id: 'gate-command-receipt-after-repair',
      attempt: 2,
      leasedAt: '2026-08-01T02:03:00.000Z',
      leaseExpiresAt: '2026-08-01T02:04:00.000Z',
    }
    const replacementPairing = {
      ...workRequestPairing,
      tokenId: replacementTokenId,
    }

    await expect(
      store.recordGateCommandReceiptObservation({
        command: deliveringGateCommand,
        receipt: repairedReceipt,
        expectedPairing: replacementPairing,
        receivedAt: '2026-08-01T02:03:10.000Z',
      }),
    ).resolves.toEqual({ recorded: false, reason: 'pairing_scope_mismatch' })

    await expect(
      store.commitGateCommandExecution({
        command: deliveringGateCommand,
        receipt: repairedReceipt,
        expectedPairing: replacementPairing,
        outcomeCode: 'applied',
        evaluatedAt: '2026-08-01T02:03:30.000Z',
        expectedRun: gateRunBefore,
        run: gateRunAfter,
        event: gateApprovalEvent,
        evaluationBinding: gateEvaluationBinding,
      }),
    ).resolves.toEqual({ committed: false, reason: 'pairing_scope_mismatch' })
    await expect(store.getGateCommandExecution(deliveringGateCommand.id)).resolves.toMatchObject({
      claimTokenId: desktopPairingCredential.tokenId,
    })
    await expect(
      store.getGateCommandAcknowledgement('gate-command-receipt-after-repair'),
    ).resolves.toBeNull()
    store.close()
  })

  it('fails closed when the same command ID changes canonical execution fields', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    const initial = {
      command: deliveringGateCommand,
      receipt: gateCommandReceipt,
      expectedPairing: workRequestPairing,
      outcomeCode: 'stale_policy' as const,
      evaluatedAt: gateRunAfter.updatedAt,
    }
    await store.commitGateCommandExecution(initial)
    const conflictingReceipt = {
      ...gateCommandReceipt,
      id: 'gate-command-receipt-local-conflict',
      attempt: 2,
      leasedAt: '2026-08-01T02:03:00.000Z',
      leaseExpiresAt: '2026-08-01T02:04:00.000Z',
    }

    await expect(
      store.commitGateCommandExecution({
        ...initial,
        command: {
          ...deliveringGateCommand,
          expectedPolicyVersion: 3,
        },
        receipt: conflictingReceipt,
        evaluatedAt: '2026-08-01T02:03:30.000Z',
      }),
    ).resolves.toEqual({
      committed: false,
      reason: 'fingerprint_conflict',
    })
    await expect(
      store.getGateCommandAcknowledgement(conflictingReceipt.id),
    ).resolves.toBeNull()
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
    store.close()
  })

  it('never persists Gate reason text or idempotency material in the execution audit tables', async () => {
    const dbPath = await tempDbPath()
    const reasonSentinel = 'never-persist-gate-reason-sentinel'
    const idempotencySentinel = 'never-persist-gate-idempotency-sentinel'
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    await store.commitGateCommandExecution({
      command: {
        ...deliveringGateCommand,
        id: 'gate-command-local-data-minimization',
        reason: reasonSentinel,
        idempotencyKey: idempotencySentinel,
        requestFingerprint: '9'.repeat(64),
      },
      receipt: {
        ...gateCommandReceipt,
        id: 'gate-command-receipt-local-data-minimization',
        commandId: 'gate-command-local-data-minimization',
      },
      expectedPairing: workRequestPairing,
      outcomeCode: 'stale_policy',
      evaluatedAt: gateRunAfter.updatedAt,
    })
    store.close()

    const persisted = (await readFile(dbPath)).toString()
    expect(persisted).not.toContain(reasonSentinel)
    expect(persisted).not.toContain(idempotencySentinel)
  })

  it('atomically records stale_run when the approved Run CAS loses a race', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    const concurrentRun = {
      ...gateRunBefore,
      version: 4,
      updatedAt: '2026-08-01T02:01:15.000Z',
    }
    await store.saveRun(concurrentRun)

    await expect(
      store.commitGateCommandExecution({
        command: deliveringGateCommand,
        receipt: gateCommandReceipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'applied',
        evaluatedAt: gateRunAfter.updatedAt,
        expectedRun: gateRunBefore,
        run: gateRunAfter,
        event: gateApprovalEvent,
        evaluationBinding: gateEvaluationBinding,
      }),
    ).resolves.toMatchObject({
      committed: true,
      replayed: false,
      execution: {
        outcomeCode: 'stale_run',
        beforeRunVersion: 4,
        afterRunVersion: 4,
      },
      acknowledgement: {
        outcomeCode: 'stale_run',
        beforeRunVersion: 4,
        afterRunVersion: 4,
      },
    })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(concurrentRun)
    await expect(store.listEvents(gateRunBefore.id)).resolves.toEqual([])
    await expect(store.listRemoteSyncOperations(gateRunBefore.id)).resolves.toEqual([
      expect.objectContaining({ generation: 2 }),
    ])
    store.close()
  })

  it('atomically records the actual stale Run version when a deterministic outcome loses its CAS', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    const concurrentRun = {
      ...gateRunBefore,
      version: 4,
      updatedAt: '2026-08-01T02:01:15.000Z',
    }
    await store.saveRun(concurrentRun)
    const command: GateCommand = {
      ...deliveringGateCommand,
      id: 'gate-command-local-deterministic-stale-run',
      idempotencyKey: 'gate-command:deterministic-stale-run:run-1:v3',
      requestFingerprint: 'f'.repeat(64),
    }
    const receipt: GateCommandReceipt = {
      ...gateCommandReceipt,
      id: 'gate-command-receipt-local-deterministic-stale-run',
      commandId: command.id,
    }

    await expect(
      store.commitGateCommandExecution({
        command,
        receipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'stale_policy',
        evaluatedAt: gateRunAfter.updatedAt,
      }),
    ).resolves.toMatchObject({
      committed: true,
      replayed: false,
      execution: {
        outcomeCode: 'stale_run',
        beforeRunVersion: 4,
        afterRunVersion: 4,
      },
      acknowledgement: {
        outcomeCode: 'stale_run',
        beforeRunVersion: 4,
        afterRunVersion: 4,
      },
    })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(concurrentRun)
    await expect(store.listEvents(gateRunBefore.id)).resolves.toEqual([])
    await expect(store.listRemoteSyncOperations(gateRunBefore.id)).resolves.toEqual([
      expect.objectContaining({ generation: 1 }),
    ])
    store.close()
  })

  it('records run_not_found with the expected version placeholder when a deterministic outcome loses its Run', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    const command: GateCommand = {
      ...deliveringGateCommand,
      id: 'gate-command-local-deterministic-run-not-found',
      idempotencyKey: 'gate-command:deterministic-run-not-found:run-1:v3',
      requestFingerprint: '1'.repeat(64),
    }
    const receipt: GateCommandReceipt = {
      ...gateCommandReceipt,
      id: 'gate-command-receipt-local-deterministic-run-not-found',
      commandId: command.id,
    }

    await expect(
      store.commitGateCommandExecution({
        command,
        receipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'stale_policy',
        evaluatedAt: gateRunAfter.updatedAt,
      }),
    ).resolves.toMatchObject({
      committed: true,
      replayed: false,
      execution: {
        outcomeCode: 'run_not_found',
        beforeRunVersion: 3,
        afterRunVersion: 3,
      },
      acknowledgement: {
        outcomeCode: 'run_not_found',
        beforeRunVersion: 3,
        afterRunVersion: 3,
      },
    })
    await expect(store.listEvents(gateRunBefore.id)).resolves.toEqual([])
    await expect(store.listRemoteSyncOperations(gateRunBefore.id)).resolves.toEqual([])
    store.close()
  })

  it('records expiry after the command deadline without treating the old lease as transition authority', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    const expiringCommand: GateCommand = {
      ...deliveringGateCommand,
      id: 'gate-command-local-expired',
      idempotencyKey: 'gate-command:expired:run-1:v3',
      requestFingerprint: 'e'.repeat(64),
      updatedAt: '2026-08-01T02:14:30.000Z',
    }
    const expiringReceipt: GateCommandReceipt = {
      id: 'gate-command-receipt-local-expired',
      commandId: expiringCommand.id,
      attempt: 1,
      leasedAt: '2026-08-01T02:14:30.000Z',
      leaseExpiresAt: expiringCommand.expiresAt,
      acknowledgedAt: null,
    }

    await expect(
      store.commitGateCommandExecution({
        command: expiringCommand,
        receipt: expiringReceipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'expired',
        evaluatedAt: '2026-08-01T02:15:01.000Z',
      }),
    ).resolves.toMatchObject({
      committed: true,
      execution: {
        outcomeCode: 'expired',
        beforeRunVersion: 3,
        afterRunVersion: 3,
      },
    })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
    await expect(store.listRemoteSyncOperations(gateRunBefore.id)).resolves.toEqual([
      expect.objectContaining({ generation: 1 }),
    ])
    store.close()
  })

  it('keeps expired precedence when scope also changes at the command deadline', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    const command: GateCommand = {
      ...deliveringGateCommand,
      id: 'gate-command-expired-and-scope-mismatch',
      projectId: 'p-other',
      idempotencyKey: 'gate-command:expired-and-scope-mismatch:run-1:v3',
      requestFingerprint: '4'.repeat(64),
      updatedAt: '2026-08-01T02:14:30.000Z',
    }
    const receipt: GateCommandReceipt = {
      id: 'gate-command-receipt-expired-and-scope-mismatch',
      commandId: command.id,
      attempt: 1,
      leasedAt: '2026-08-01T02:14:30.000Z',
      leaseExpiresAt: command.expiresAt,
      acknowledgedAt: null,
    }

    await expect(
      store.commitGateCommandExecution({
        command,
        receipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'expired',
        evaluatedAt: command.expiresAt,
      }),
    ).resolves.toMatchObject({
      committed: true,
      execution: { outcomeCode: 'expired', beforeRunVersion: 3, afterRunVersion: 3 },
      acknowledgement: { outcomeCode: 'expired' },
    })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
    store.close()
  })

  it('records scope_mismatch without touching a Run when a delivered command escapes the pairing scope', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    const escapedCommand: GateCommand = {
      ...deliveringGateCommand,
      id: 'gate-command-local-scope-mismatch',
      projectId: 'p-other',
      idempotencyKey: 'gate-command:scope-mismatch:run-1:v3',
      requestFingerprint: 'f'.repeat(64),
    }
    const escapedReceipt: GateCommandReceipt = {
      ...gateCommandReceipt,
      id: 'gate-command-receipt-local-scope-mismatch',
      commandId: escapedCommand.id,
    }

    await expect(
      store.commitGateCommandExecution({
        command: escapedCommand,
        receipt: escapedReceipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'scope_mismatch',
        evaluatedAt: gateRunAfter.updatedAt,
      }),
    ).resolves.toMatchObject({
      committed: true,
      execution: {
        teamProjectId: 'p-other',
        localProjectId: project.id,
        outcomeCode: 'scope_mismatch',
        beforeRunVersion: 3,
        afterRunVersion: 3,
      },
    })
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
    await expect(store.listRemoteSyncOperations(gateRunBefore.id)).resolves.toEqual([
      expect.objectContaining({ generation: 1 }),
    ])
    store.close()
  })

  it('persists a pending acknowledgement and seals it with the real replayed server acknowledgement', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    const committed = await store.commitGateCommandExecution({
      command: deliveringGateCommand,
      receipt: gateCommandReceipt,
      expectedPairing: workRequestPairing,
      outcomeCode: 'stale_policy',
      evaluatedAt: gateRunAfter.updatedAt,
    })
    if (!committed.committed) throw new Error('Expected local Gate execution')
    await expect(store.listPendingGateCommandAcknowledgements()).resolves.toEqual([
      committed.acknowledgement,
    ])
    const remoteAcknowledgement: GateCommandAcknowledgement = {
      id: 'gate-ack-server-1',
      commandId: deliveringGateCommand.id,
      receiptId: gateCommandReceipt.id,
      outcomeCode: 'stale_policy',
      beforeRunVersion: 3,
      afterRunVersion: 3,
      evaluatedAt: gateRunAfter.updatedAt,
      createdAt: '2026-08-01T02:01:40.000Z',
    }

    await expect(
      store.recordGateCommandAcknowledgement({
        receiptId: gateCommandReceipt.id,
        acknowledgement: remoteAcknowledgement,
        replayed: true,
        acknowledgedAt: '2026-08-01T02:01:41.000Z',
      }),
    ).resolves.toMatchObject({
      recorded: true,
      replayed: false,
      acknowledgement: {
        status: 'acknowledged',
        remoteAcknowledgementId: remoteAcknowledgement.id,
        remoteCreatedAt: remoteAcknowledgement.createdAt,
        remoteReplayed: true,
        acknowledgedAt: '2026-08-01T02:01:41.000Z',
      },
    })
    await expect(store.listPendingGateCommandAcknowledgements()).resolves.toEqual([])
    await expect(
      store.terminalizeGateCommandAcknowledgement({
        receiptId: gateCommandReceipt.id,
        failureCode: 'forbidden',
        failedAt: '2026-08-01T02:01:42.000Z',
      }),
    ).resolves.toEqual({ terminalized: false, reason: 'conflict' })
    store.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(
      reopened.getGateCommandAcknowledgement(gateCommandReceipt.id),
    ).resolves.toMatchObject({
      status: 'acknowledged',
      remoteAcknowledgementId: remoteAcknowledgement.id,
      remoteReplayed: true,
    })
    reopened.close()
  })

  it('terminalizes a non-retryable scope mismatch with safe metadata and replays it idempotently', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    const committed = await store.commitGateCommandExecution({
      command: deliveringGateCommand,
      receipt: gateCommandReceipt,
      expectedPairing: workRequestPairing,
      outcomeCode: 'stale_policy',
      evaluatedAt: gateRunAfter.updatedAt,
    })
    if (!committed.committed) throw new Error('Expected local Gate execution')
    const failure = {
      receiptId: gateCommandReceipt.id,
      failureCode: 'scope_mismatch' as const,
      failedAt: '2026-08-01T02:01:42.000Z',
    }

    await expect(
      store.terminalizeGateCommandAcknowledgement(failure),
    ).resolves.toMatchObject({
      terminalized: true,
      replayed: false,
      acknowledgement: {
        receiptId: gateCommandReceipt.id,
        status: 'terminal',
        remoteAcknowledgementId: null,
        remoteCreatedAt: null,
        remoteReplayed: null,
        acknowledgedAt: null,
        failureCode: 'scope_mismatch',
        failedAt: failure.failedAt,
      },
    })
    await expect(
      store.terminalizeGateCommandAcknowledgement(failure),
    ).resolves.toMatchObject({ terminalized: true, replayed: true })
    await expect(
      store.terminalizeGateCommandAcknowledgement({
        ...failure,
        failureCode: 'not_found',
      }),
    ).resolves.toEqual({ terminalized: false, reason: 'conflict' })
    await expect(
      store.terminalizeGateCommandAcknowledgement({
        ...failure,
        failureCode: 'network',
      }),
    ).resolves.toEqual({ terminalized: false, reason: 'invalid_input' })
    await expect(
      store.recordGateCommandAcknowledgement({
        receiptId: gateCommandReceipt.id,
        acknowledgement: {
          id: 'gate-ack-server-after-terminal',
          commandId: deliveringGateCommand.id,
          receiptId: gateCommandReceipt.id,
          outcomeCode: 'stale_policy',
          beforeRunVersion: 3,
          afterRunVersion: 3,
          evaluatedAt: gateRunAfter.updatedAt,
          createdAt: '2026-08-01T02:01:43.000Z',
        },
        replayed: false,
        acknowledgedAt: '2026-08-01T02:01:44.000Z',
      }),
    ).resolves.toEqual({
      recorded: false,
      reason: 'acknowledgement_conflict',
    })
    await expect(store.listPendingGateCommandAcknowledgements()).resolves.toEqual([])
    store.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(
      reopened.getGateCommandAcknowledgement(gateCommandReceipt.id),
    ).resolves.toMatchObject({
      status: 'terminal',
      failureCode: 'scope_mismatch',
      failedAt: failure.failedAt,
    })
    await expect(
      reopened.listPendingGateCommandAcknowledgements(),
    ).resolves.toEqual([])
    reopened.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const inspected = new SQL.Database(await readFile(dbPath))
    expect(() =>
      inspected.run(
        `update gate_command_acknowledgements
         set failure_code = 'network' where receipt_id = ?`,
        [gateCommandReceipt.id],
      ),
    ).toThrow(/constraint/i)
    expect(() =>
      inspected.run(
        `update gate_command_acknowledgements
         set failure_code = null where receipt_id = ?`,
        [gateCommandReceipt.id],
      ),
    ).toThrow(/constraint/i)
    inspected.close()
  })

  it('restores a pending acknowledgement when terminal failure persistence fails', async () => {
    const dbPath = await tempDbPath()
    const backupPath = `${dbPath}.backup`
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    const committed = await store.commitGateCommandExecution({
      command: deliveringGateCommand,
      receipt: gateCommandReceipt,
      expectedPairing: workRequestPairing,
      outcomeCode: 'stale_policy',
      evaluatedAt: gateRunAfter.updatedAt,
    })
    if (!committed.committed) throw new Error('Expected local Gate execution')
    await rename(dbPath, backupPath)
    await mkdir(dbPath)

    await expect(
      store.terminalizeGateCommandAcknowledgement({
        receiptId: gateCommandReceipt.id,
        failureCode: 'forbidden',
        failedAt: '2026-08-01T02:01:42.000Z',
      }),
    ).rejects.toThrow(persistenceFailurePattern)
    await expect(
      store.getGateCommandAcknowledgement(gateCommandReceipt.id),
    ).resolves.toEqual(committed.acknowledgement)
    await expect(store.listPendingGateCommandAcknowledgements()).resolves.toEqual([
      committed.acknowledgement,
    ])
    store.close()
  })

  it('restores Run, event, receipt observation, execution, acknowledgement, and outbox when Gate persistence fails', async () => {
    const dbPath = await tempDbPath()
    const backupPath = `${dbPath}.backup`
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(gateRunBefore)
    await store.saveArtifact(gateClarificationArtifact)
    await store.savePolicySnapshot(gatePolicySnapshotV2)
    await rename(dbPath, backupPath)
    await mkdir(dbPath)

    await expect(
      store.commitGateCommandExecution({
        command: deliveringGateCommand,
        receipt: gateCommandReceipt,
        expectedPairing: workRequestPairing,
        outcomeCode: 'applied',
        evaluatedAt: gateRunAfter.updatedAt,
        expectedRun: gateRunBefore,
        run: gateRunAfter,
        event: gateApprovalEvent,
        evaluationBinding: gateEvaluationBinding,
      }),
    ).rejects.toThrow(persistenceFailurePattern)
    await expect(store.getRun(gateRunBefore.id)).resolves.toEqual(gateRunBefore)
    await expect(
      store.getGateCommandExecution(deliveringGateCommand.id),
    ).resolves.toBeNull()
    await expect(
      store.getGateCommandAcknowledgement(gateCommandReceipt.id),
    ).resolves.toBeNull()
    await expect(
      store.getGateCommandReceiptObservation(gateCommandReceipt.id),
    ).resolves.toBeNull()
    await expect(store.listEvents(gateRunBefore.id)).resolves.toEqual([])
    await expect(store.listRemoteSyncOperations(gateRunBefore.id)).resolves.toEqual([
      expect.objectContaining({ generation: 1 }),
    ])
    store.close()
  })

  it('creates a constrained metadata-only Work Request materialization schema', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    store.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const db = new SQL.Database(await readFile(dbPath))
    const columns =
      db.exec('pragma table_info(work_request_materializations)')[0]?.values.map(
        (row) => String(row[1]),
      ) ?? []
    expect(columns).toEqual([
      'work_request_id',
      'organization_id',
      'team_project_id',
      'local_project_id',
      'run_id',
      'claim_version',
      'source_fingerprint',
      'materialize_idempotency_key',
      'status',
      'acknowledged_version',
      'created_at',
      'updated_at',
      'acknowledged_at',
    ])
    expect(columns).not.toEqual(
      expect.arrayContaining([
        'token_id',
        'token',
        'secret',
        'title',
        'request_json',
        'work_request_json',
        'json',
      ]),
    )
    const indexes =
      db.exec("select name from sqlite_master where type = 'index' and tbl_name = 'work_request_materializations'")[0]
        ?.values.map((row) => String(row[0])) ?? []
    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_work_request_materializations_pending',
        'idx_work_request_materializations_run_id',
      ]),
    )
    db.close()
  })

  it('persists only remote-sync operation metadata across reopen', async () => {
    const dbPath = await tempDbPath()
    const sentinel = 'never-persist-outbox-payload-sentinel'
    const operation = {
      ...createRemoteSyncOperation({
        id: 'sync-1',
        kind: 'test-evidence-summary',
        localProjectId: project.id,
        runId: run.id,
        entityId: evidence.id,
        createdAt: '2026-08-01T00:00:00.000Z',
      }),
      payload: sentinel,
      prompt: sentinel,
      stdout: sentinel,
      stderr: sentinel,
      patch: sentinel,
    }

    const first = await createLocalStore({ dbPath })
    await first.enqueueRemoteSyncOperation(operation)
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.listRemoteSyncOperations()).toEqual([
      createRemoteSyncOperation({
        id: 'sync-1',
        kind: 'test-evidence-summary',
        localProjectId: project.id,
        runId: run.id,
        entityId: evidence.id,
        createdAt: '2026-08-01T00:00:00.000Z',
      }),
    ])
    second.close()
    expect((await readFile(dbPath)).toString()).not.toContain(sentinel)
  })

  it('atomically enqueues canonical summaries with paired scope across entity writes', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await store.saveRun(run)
    await store.saveRun({ ...run, updatedAt: '2026-06-15T00:00:30.000Z' })
    await store.saveTestEvidence(evidence)
    await store.saveAgentReview(agentReview)
    await store.saveCodingAgentRun({ ...codingRun, status: 'running' })
    await store.saveCodingAgentRun(codingRun)

    const operations = await store.listRemoteSyncOperations()
    expect(operations.map((operation) => operation.kind)).toEqual([
      'run-summary',
      'test-evidence-summary',
      'agent-review-summary',
      'coding-agent-summary',
    ])
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'run-summary', generation: 2,
        organizationId: desktopPairingCredential.organizationId,
        teamProjectId: desktopPairingCredential.projectId,
      }),
    ]))
    expect((await store.loadState()).remoteSyncOperations).toEqual(operations)
    store.close()

    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.listRemoteSyncOperations()).toEqual(operations)
    reopened.close()
  })

  it('atomically preserves the first terminal Coding Agent transition', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const { completedAt: _completedAt, ...activeFields } = codingRun
    const activeRun: CodingAgentRun = {
      ...activeFields,
      status: 'waiting_permission',
      summary: 'Waiting for a permission decision.',
    }
    const cancelledRun: CodingAgentRun = {
      ...activeRun,
      status: 'cancelled',
      summary: 'Cancelled first.',
      completedAt: '2026-08-01T00:01:00.000Z',
    }
    const staleCompletedRun: CodingAgentRun = {
      ...activeRun,
      status: 'completed',
      summary: 'This stale completion must not win.',
      completedAt: '2026-08-01T00:02:00.000Z',
    }
    await store.saveCodingAgentRun(activeRun)

    const cancelled = store.commitCodingAgentMutation({
      expectedRun: activeRun,
      expectedPendingPermissionRequestIds: [],
      run: cancelledRun,
    })
    const staleCompletion = store.commitCodingAgentMutation({
      expectedRun: activeRun,
      expectedPendingPermissionRequestIds: [],
      run: staleCompletedRun,
    })

    await expect(cancelled).resolves.toMatchObject({ committed: true, run: cancelledRun })
    await expect(staleCompletion).resolves.toMatchObject({
      committed: false,
      reason: 'stale_run',
      run: cancelledRun,
    })
    expect(await store.listCodingAgentRuns()).toEqual([cancelledRun])
    store.close()

    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.listCodingAgentRuns()).toEqual([cancelledRun])
    await expect(reopened.commitCodingAgentMutation({
      expectedRun: cancelledRun,
      expectedPendingPermissionRequestIds: [],
      run: { ...cancelledRun, status: 'completed', summary: 'Terminal rewrite attempt.' },
    })).resolves.toMatchObject({
      committed: false,
      reason: 'terminal_run',
      run: cancelledRun,
    })
    expect(await reopened.listCodingAgentRuns()).toEqual([cancelledRun])
    reopened.close()
  })

  it('atomically reserves only one active Coding Agent run per project', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const { completedAt: _completedAt, ...activeFields } = codingRun
    const firstRun: CodingAgentRun = {
      ...activeFields,
      id: 'coding-run-reservation-1',
      status: 'preparing',
      summary: 'Preparing the first run.',
    }
    const secondRun: CodingAgentRun = {
      ...activeFields,
      id: 'coding-run-reservation-2',
      status: 'preparing',
      summary: 'Preparing the second run.',
    }

    const first = store.reserveCodingAgentRun(firstRun)
    const second = store.reserveCodingAgentRun(secondRun)

    await expect(first).resolves.toEqual({ reserved: true, run: firstRun })
    await expect(second).resolves.toEqual({
      reserved: false,
      reason: 'active_run_exists',
      run: firstRun,
    })
    expect(await store.listCodingAgentRuns()).toEqual([firstRun])
    store.close()
  })

  it('atomically rejects a stale continuation bundle after terminalization', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const { completedAt: _completedAt, ...activeFields } = codingRun
    const activeRun: CodingAgentRun = {
      ...activeFields,
      status: 'waiting_permission',
      summary: 'Waiting for a permission decision.',
    }
    const cancelledRun: CodingAgentRun = {
      ...activeRun,
      status: 'cancelled',
      summary: 'Cancelled first.',
      completedAt: '2026-08-01T00:01:00.000Z',
    }
    const nextPermission: CodingPermissionRequest = {
      ...permissionRequest,
      id: 'permission-next',
      status: 'pending',
      requestedAt: '2026-08-01T00:02:00.000Z',
      expiresAt: '2026-08-01T00:03:00.000Z',
    }
    const continuationEvent: CodingAgentEvent = {
      ...codingEvent,
      id: 'coding-event-next-permission',
      sequence: 2,
      metadata: { requestId: nextPermission.id },
      timestamp: nextPermission.requestedAt,
    }
    await store.saveCodingAgentRun(activeRun)

    const terminal = store.commitCodingAgentMutation({
      expectedRun: activeRun,
      expectedPendingPermissionRequestIds: [],
      run: cancelledRun,
    })
    const staleContinuation = store.commitCodingAgentMutation({
      expectedRun: activeRun,
      expectedPendingPermissionRequestIds: [],
      run: { ...activeRun, summary: 'Waiting for another permission.' },
      events: [continuationEvent],
      permissionRequests: [nextPermission],
    })

    await expect(terminal).resolves.toMatchObject({ committed: true })
    await expect(staleContinuation).resolves.toMatchObject({
      committed: false,
      reason: 'stale_run',
      run: cancelledRun,
    })
    expect(await store.listCodingPermissionRequests()).toEqual([])
    expect(await store.listCodingAgentEvents()).toEqual([])
    store.close()
  })

  it('detects a new pending permission even when the Coding Agent run JSON is unchanged', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const { completedAt: _completedAt, ...activeFields } = codingRun
    const activeRun: CodingAgentRun = {
      ...activeFields,
      status: 'waiting_permission',
      summary: 'Waiting for another permission.',
    }
    const nextPermission: CodingPermissionRequest = {
      ...permissionRequest,
      id: 'permission-next-same-run',
      status: 'pending',
      requestedAt: '2026-08-01T00:02:00.000Z',
      expiresAt: '2026-08-01T00:03:00.000Z',
    }
    const timedOutRun: CodingAgentRun = {
      ...activeRun,
      status: 'timed_out',
      summary: 'Timed out.',
      completedAt: '2026-08-01T00:04:00.000Z',
    }
    await store.saveCodingAgentRun(activeRun)

    const continuation = store.commitCodingAgentMutation({
      expectedRun: activeRun,
      expectedPendingPermissionRequestIds: [],
      run: activeRun,
      permissionRequests: [nextPermission],
    })
    const staleTimeout = store.commitCodingAgentMutation({
      expectedRun: activeRun,
      expectedPendingPermissionRequestIds: [],
      run: timedOutRun,
    })

    await expect(continuation).resolves.toMatchObject({ committed: true })
    await expect(staleTimeout).resolves.toMatchObject({
      committed: false,
      reason: 'stale_permission_set',
      run: activeRun,
    })
    expect(await store.listCodingAgentRuns()).toEqual([activeRun])
    expect(await store.listCodingPermissionRequests()).toEqual([nextPermission])
    store.close()
  })

  it('atomically claims one pending Coding Agent permission decision', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const { completedAt: _completedAt, ...activeFields } = codingRun
    const activeRun: CodingAgentRun = {
      ...activeFields,
      status: 'waiting_permission',
      summary: 'Waiting for a permission decision.',
    }
    const pendingRequest: CodingPermissionRequest = {
      ...permissionRequest,
      status: 'pending',
    }
    const approvedRequest: CodingPermissionRequest = { ...pendingRequest, status: 'approved' }
    const expiredRequest: CodingPermissionRequest = { ...pendingRequest, status: 'expired' }
    const approvedDecision: CodingPermissionDecision = {
      ...permissionDecision,
      id: 'decision-approved',
      decision: 'approved',
    }
    const expiredDecision: CodingPermissionDecision = {
      ...permissionDecision,
      id: 'decision-expired',
      decision: 'expired',
    }
    await store.saveCodingAgentRun(activeRun)
    await store.saveCodingPermissionRequest(pendingRequest)

    const approved = store.commitCodingAgentMutation({
      expectedRun: activeRun,
      expectedPendingPermissionRequestIds: [pendingRequest.id],
      expectedPermissionRequests: [pendingRequest],
      permissionRequests: [approvedRequest],
      permissionDecisions: [approvedDecision],
    })
    const expired = store.commitCodingAgentMutation({
      expectedRun: activeRun,
      expectedPendingPermissionRequestIds: [pendingRequest.id],
      expectedPermissionRequests: [pendingRequest],
      permissionRequests: [expiredRequest],
      permissionDecisions: [expiredDecision],
    })

    await expect(approved).resolves.toMatchObject({ committed: true })
    await expect(expired).resolves.toMatchObject({
      committed: false,
      reason: 'stale_permission_set',
    })
    expect(await store.listCodingPermissionRequests()).toEqual([approvedRequest])
    expect(await store.listCodingPermissionDecisions()).toEqual([approvedDecision])
    store.close()
  })

  it('enforces pending creation and one matching decision for permission settlement', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const { completedAt: _completedAt, ...activeFields } = codingRun
    const activeRun: CodingAgentRun = {
      ...activeFields,
      status: 'waiting_permission',
      summary: 'Waiting for a permission decision.',
    }
    const pendingRequest: CodingPermissionRequest = {
      ...permissionRequest,
      status: 'pending',
    }
    const approvedRequest: CodingPermissionRequest = { ...pendingRequest, status: 'approved' }
    await store.saveCodingAgentRun(activeRun)
    await store.saveCodingPermissionRequest(pendingRequest)

    await expect(store.commitCodingAgentMutation({
      expectedRun: activeRun,
      expectedPendingPermissionRequestIds: [pendingRequest.id],
      permissionRequests: [{ ...approvedRequest, id: 'permission-new-terminal' }],
    })).rejects.toThrow('New Coding Agent permission requests must be pending and undecided')

    await expect(store.commitCodingAgentMutation({
      expectedRun: activeRun,
      expectedPendingPermissionRequestIds: [pendingRequest.id],
      expectedPermissionRequests: [pendingRequest],
      permissionRequests: [approvedRequest],
    })).rejects.toThrow('Settled Coding Agent permission requests require one matching decision')

    await expect(store.commitCodingAgentMutation({
      expectedRun: activeRun,
      expectedPendingPermissionRequestIds: [pendingRequest.id],
      expectedPermissionRequests: [pendingRequest],
      permissionRequests: [approvedRequest],
      permissionDecisions: [{
        ...permissionDecision,
        id: 'decision-mismatched',
        decision: 'rejected',
      }],
    })).rejects.toThrow('Settled Coding Agent permission requests require one matching decision')

    expect(await store.listCodingPermissionRequests()).toEqual([pendingRequest])
    expect(await store.listCodingPermissionDecisions()).toEqual([])
    store.close()
  })

  it('rejects reused provider permission IDs without reviving or crossing run authority', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const { completedAt: _completedAt, ...activeFields } = codingRun
    const firstRun: CodingAgentRun = {
      ...activeFields,
      status: 'waiting_permission',
      summary: 'Waiting for another permission.',
    }
    const secondRun: CodingAgentRun = {
      ...activeFields,
      id: 'coding-run-2',
      projectId: 'project-2',
      status: 'waiting_permission',
      summary: 'Waiting in another project.',
    }
    const approvedRequest: CodingPermissionRequest = {
      ...permissionRequest,
      status: 'approved',
    }
    await store.saveCodingAgentRun(firstRun)
    await store.saveCodingAgentRun(secondRun)
    await store.saveCodingPermissionRequest(approvedRequest)

    await expect(store.commitCodingAgentMutation({
      expectedRun: firstRun,
      expectedPendingPermissionRequestIds: [],
      run: firstRun,
      permissionRequests: [{ ...approvedRequest, status: 'pending' }],
    })).resolves.toMatchObject({
      committed: false,
      reason: 'stale_permission_request',
    })
    await expect(store.commitCodingAgentMutation({
      expectedRun: secondRun,
      expectedPendingPermissionRequestIds: [],
      run: secondRun,
      permissionRequests: [{
        ...approvedRequest,
        codingRunId: secondRun.id,
        runId: secondRun.runId,
        nodeId: secondRun.nodeId,
        status: 'pending',
      }],
    })).resolves.toMatchObject({
      committed: false,
      reason: 'stale_permission_request',
    })
    expect(await store.listCodingPermissionRequests()).toEqual([approvedRequest])
    store.close()
  })

  it('keeps the old fixed scope terminal without blocking a canonical save after re-pairing', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const originalPairing = {
      ...desktopPairingCredential,
      localProjectId: project.id,
    }
    await store.saveDesktopPairingCredential(originalPairing, 'encrypted-token-1')
    await store.saveRun(run)
    const claimed = await store.claimNextRemoteSyncOperation('2026-08-01T00:00:00.000Z')
    expect(claimed).toMatchObject({
      status: 'sending',
      generation: 1,
      organizationId: originalPairing.organizationId,
      teamProjectId: originalPairing.projectId,
    })

    await store.saveDesktopPairingCredential({
      ...originalPairing,
      organizationId: 'org-repaired',
      projectId: 'team-project-repaired',
      createdAt: '2026-08-01T00:01:00.000Z',
    }, 'encrypted-token-2')
    const updatedRun = { ...run, updatedAt: '2026-08-01T00:02:00.000Z' }

    await expect(store.saveRun(updatedRun)).resolves.toBeUndefined()
    await expect(store.getRun(run.id)).resolves.toEqual(updatedRun)
    await expect(store.listRemoteSyncOperations()).resolves.toEqual([
      expect.objectContaining({
        id: claimed!.id,
        idempotencyKey: claimed!.idempotencyKey,
        organizationId: originalPairing.organizationId,
        teamProjectId: originalPairing.projectId,
        status: 'terminal',
        generation: 2,
        nextAttemptAt: null,
        leaseExpiresAt: null,
        lastErrorCode: 'scope_mismatch',
        lastErrorMessage: 'The paired Team Project does not match the remote sync operation.',
        recovery: 'none',
        completedAt: null,
        updatedAt: updatedRun.updatedAt,
      }),
    ])
    await expect(store.claimNextRemoteSyncOperation('2026-08-01T00:03:00.000Z')).resolves.toBeNull()
    store.close()
  })

  it('rejects a remote-sync operation with a forged idempotency key', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const operation = {
      ...createRemoteSyncOperation({
        id: 'sync-forged-key',
        kind: 'run-summary',
        localProjectId: project.id,
        runId: run.id,
        entityId: run.id,
        createdAt: '2026-08-01T00:00:00.000Z',
      }),
      idempotencyKey: 'remote-sync:v1:forged',
    }

    await expect(store.enqueueRemoteSyncOperation(operation)).resolves.toEqual({
      enqueued: false,
      reason: 'invalid_idempotency_key',
    })
    expect(await store.listRemoteSyncOperations()).toEqual([])
    store.close()
  })

  it('rejects non-canonical initial remote-sync operations at enqueue', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const canonical = createRemoteSyncOperation({
      id: 'sync-canonical',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    const invalid = [
      { ...canonical, id: '' },
      { ...canonical, localProjectId: '\uD800' },
      { ...canonical, organizationId: 'org-1', teamProjectId: null },
      { ...canonical, organizationId: '', teamProjectId: 'team-project-1' },
      { ...canonical, status: 'sending' as const },
      { ...canonical, generation: 2 },
      { ...canonical, attemptCount: 1 },
      { ...canonical, nextAttemptAt: null },
      { ...canonical, leaseExpiresAt: '2026-08-01T00:01:00.000Z' },
      {
        ...canonical,
        createdAt: 'not-a-date',
        updatedAt: 'not-a-date',
        nextAttemptAt: 'not-a-date',
      },
    ]

    for (const operation of invalid) {
      await expect(store.enqueueRemoteSyncOperation(operation)).resolves.toEqual({
        enqueued: false,
        reason: 'invalid_operation',
      })
    }
    expect(await store.listRemoteSyncOperations()).toEqual([])
    store.close()
  })

  it('coalesces the same logical remote-sync work into a new pending generation', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const first = createRemoteSyncOperation({
      id: 'sync-original',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    const replacement = createRemoteSyncOperation({
      id: 'sync-replacement',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:01:00.000Z',
    })

    await store.enqueueRemoteSyncOperation(first)
    const result = await store.enqueueRemoteSyncOperation(replacement)
    if (result.enqueued || result.reason !== 'coalesced') {
      throw new Error('Expected the duplicate operation to coalesce')
    }

    expect(result).toEqual({
      enqueued: false,
      reason: 'coalesced',
      operation: {
        ...first,
        generation: 2,
        nextAttemptAt: replacement.createdAt,
        updatedAt: replacement.updatedAt,
      },
    })
    expect(await store.listRemoteSyncOperations()).toEqual([result.operation])
    store.close()
  })

  it('rejects coalescing a logical operation into a different fixed Team scope', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const original = createRemoteSyncOperation({
      id: 'sync-fixed-scope',
      kind: 'run-summary',
      localProjectId: project.id,
      organizationId: 'org-1',
      teamProjectId: 'team-project-1',
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    await store.enqueueRemoteSyncOperation(original)

    const result = await store.enqueueRemoteSyncOperation(createRemoteSyncOperation({
      id: 'sync-other-scope',
      kind: original.kind,
      localProjectId: original.localProjectId,
      organizationId: 'org-2',
      teamProjectId: 'team-project-2',
      runId: original.runId,
      entityId: original.entityId,
      createdAt: '2026-08-01T00:01:00.000Z',
    }))

    expect(result).toEqual({ enqueued: false, reason: 'scope_mismatch' })
    expect(await store.listRemoteSyncOperations()).toEqual([original])
    store.close()
  })

  it('adopts Team scope once during coalesce and keeps it immutable afterwards', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const unbound = createRemoteSyncOperation({
      id: 'sync-scope-original',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    const bound = createRemoteSyncOperation({
      id: 'sync-scope-bound',
      kind: unbound.kind,
      localProjectId: unbound.localProjectId,
      organizationId: 'org-1',
      teamProjectId: 'team-project-1',
      runId: unbound.runId,
      entityId: unbound.entityId,
      createdAt: '2026-08-01T00:01:00.000Z',
    })
    await store.enqueueRemoteSyncOperation(unbound)

    await expect(store.enqueueRemoteSyncOperation(bound)).resolves.toMatchObject({
      enqueued: false,
      reason: 'coalesced',
      operation: {
        organizationId: 'org-1',
        teamProjectId: 'team-project-1',
      },
    })
    await expect(store.enqueueRemoteSyncOperation({
      ...unbound,
      id: 'sync-scope-unbound-again',
      createdAt: '2026-08-01T00:02:00.000Z',
      updatedAt: '2026-08-01T00:02:00.000Z',
      nextAttemptAt: '2026-08-01T00:02:00.000Z',
    })).resolves.toMatchObject({
      operation: {
        organizationId: 'org-1',
        teamProjectId: 'team-project-1',
      },
    })
    await expect(store.enqueueRemoteSyncOperation({
      ...bound,
      id: 'sync-scope-other',
      organizationId: 'org-2',
      teamProjectId: 'team-project-2',
      createdAt: '2026-08-01T00:03:00.000Z',
      updatedAt: '2026-08-01T00:03:00.000Z',
      nextAttemptAt: '2026-08-01T00:03:00.000Z',
    })).resolves.toEqual({ enqueued: false, reason: 'scope_mismatch' })
    store.close()
  })

  it('atomically claims only the next due remote-sync operation', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const later = createRemoteSyncOperation({
      id: 'sync-later',
      kind: 'agent-review-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: 'review-2',
      createdAt: '2026-08-01T00:02:00.000Z',
    })
    const due = createRemoteSyncOperation({
      id: 'sync-due',
      kind: 'test-evidence-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: evidence.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    await store.enqueueRemoteSyncOperation(later)
    await store.enqueueRemoteSyncOperation(due)

    const claimed = await store.claimNextRemoteSyncOperation('2026-08-01T00:01:00.000Z')

    expect(claimed).toEqual({
      ...due,
      status: 'sending',
      attemptCount: 1,
      nextAttemptAt: null,
      leaseExpiresAt: '2026-08-01T00:02:00.000Z',
      lastAttemptAt: '2026-08-01T00:01:00.000Z',
      updatedAt: '2026-08-01T00:01:00.000Z',
    })
    expect(await store.claimNextRemoteSyncOperation('2026-08-01T00:01:00.000Z')).toBeNull()
    store.close()
  })

  it('claims child evidence before the canonical Run when both are due together', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const canonicalRun = createRemoteSyncOperation({
      id: 'aaa-run-operation',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    const childEvidence = createRemoteSyncOperation({
      id: 'zzz-child-operation',
      kind: 'test-evidence-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: evidence.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    await store.enqueueRemoteSyncOperation(canonicalRun)
    await store.enqueueRemoteSyncOperation(childEvidence)

    await expect(
      store.claimNextRemoteSyncOperation('2026-08-01T00:00:10.000Z'),
    ).resolves.toMatchObject({ id: childEvidence.id, kind: childEvidence.kind })
    store.close()
  })

  it('serializes overlapping outbox mutations and persists their invocation order', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const runOperation = createRemoteSyncOperation({
      id: 'sync-overlap-run',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    const childOperation = createRemoteSyncOperation({
      id: 'sync-overlap-child',
      kind: 'test-evidence-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: evidence.id,
      createdAt: '2026-08-01T00:00:20.000Z',
    })
    await store.enqueueRemoteSyncOperation(runOperation)

    const claiming = store.claimNextRemoteSyncOperation('2026-08-01T00:00:10.000Z')
    const enqueueing = store.enqueueRemoteSyncOperation(childOperation)
    const [claimed, enqueued] = await Promise.all([claiming, enqueueing])

    expect(claimed).toMatchObject({ id: runOperation.id, status: 'sending' })
    expect(enqueued).toMatchObject({ enqueued: true })
    store.close()
    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.listRemoteSyncOperations()).toEqual([claimed, childOperation])
    reopened.close()
  })

  it('restores the pending claim state and preserves the persistence error when saving fails', async () => {
    const dbPath = await tempDbPath()
    const backupPath = `${dbPath}.backup`
    const store = await createLocalStore({ dbPath })
    const operation = createRemoteSyncOperation({
      id: 'sync-persist-failure',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    await store.enqueueRemoteSyncOperation(operation)
    await rename(dbPath, backupPath)
    await mkdir(dbPath)

    await expect(
      store.claimNextRemoteSyncOperation('2026-08-01T00:00:10.000Z'),
    ).rejects.toThrow(persistenceFailurePattern)
    expect(await store.listRemoteSyncOperations()).toEqual([operation])
    store.close()
  })

  it('rolls back a remote-sync settlement when persistence fails', async () => {
    const dbPath = await tempDbPath()
    const backupPath = `${dbPath}.backup`
    const store = await createLocalStore({ dbPath })
    const operation = createRemoteSyncOperation({
      id: 'sync-settle-persist-failure',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    await store.enqueueRemoteSyncOperation(operation)
    const claimed = await store.claimNextRemoteSyncOperation('2026-08-01T00:00:10.000Z')
    await rename(dbPath, backupPath)
    await mkdir(dbPath)

    await expect(store.settleRemoteSyncOperation({
      id: operation.id,
      generation: operation.generation,
      status: 'terminal',
      lastErrorCode: 'remote_error',
      lastErrorMessage: 'Safe fixed failure.',
      updatedAt: '2026-08-01T00:00:20.000Z',
    })).rejects.toThrow(persistenceFailurePattern)
    expect(await store.listRemoteSyncOperations()).toEqual([claimed])
    await rm(dbPath, { recursive: true })
    await rename(backupPath, dbPath)
    const subsequent = createRemoteSyncOperation({
      id: 'sync-after-settle-failure',
      kind: 'test-evidence-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: evidence.id,
      createdAt: '2026-08-01T00:00:30.000Z',
    })
    await store.enqueueRemoteSyncOperation(subsequent)
    store.close()

    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.listRemoteSyncOperations()).toEqual([claimed, subsequent])
    reopened.close()
  })

  it('rolls back a canonical entity and its outbox operation when persistence fails', async () => {
    const dbPath = await tempDbPath()
    const backupPath = `${dbPath}.backup`
    const store = await createLocalStore({ dbPath })
    await rename(dbPath, backupPath)
    await mkdir(dbPath)

    await expect(store.saveRun(run)).rejects.toThrow(persistenceFailurePattern)
    expect(await store.getRun(run.id)).toBeNull()
    expect(await store.listRemoteSyncOperations()).toEqual([])
    store.close()
  })

  it('binds an unbound remote-sync operation to one Team scope', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const operation = createRemoteSyncOperation({
      id: 'sync-bind',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    await store.enqueueRemoteSyncOperation(operation)
    const claimed = await store.claimNextRemoteSyncOperation('2026-08-01T00:00:10.000Z')

    const result = await store.bindRemoteSyncOperationScope({
      id: operation.id,
      generation: operation.generation,
      organizationId: 'org-1',
      teamProjectId: 'team-project-1',
      updatedAt: '2026-08-01T00:00:30.000Z',
    })

    expect(result).toEqual({
      bound: true,
      operation: {
        ...claimed!,
        organizationId: 'org-1',
        teamProjectId: 'team-project-1',
        updatedAt: '2026-08-01T00:00:30.000Z',
      },
    })
    await expect(store.bindRemoteSyncOperationScope({
      id: operation.id,
      generation: operation.generation,
      organizationId: 'org-1',
      teamProjectId: 'team-project-1',
      updatedAt: '2026-08-01T00:00:40.000Z',
    })).resolves.toMatchObject({ bound: true })
    await expect(store.bindRemoteSyncOperationScope({
      id: operation.id,
      generation: operation.generation,
      organizationId: 'org-2',
      teamProjectId: 'team-project-2',
      updatedAt: '2026-08-01T00:00:50.000Z',
    })).resolves.toEqual({ bound: false, reason: 'scope_mismatch' })
    store.close()
  })

  it('does not bind Team scope before an operation is claimed for sending', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const operation = createRemoteSyncOperation({
      id: 'sync-pending-bind',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    await store.enqueueRemoteSyncOperation(operation)

    await expect(store.bindRemoteSyncOperationScope({
      id: operation.id,
      generation: operation.generation,
      organizationId: 'org-1',
      teamProjectId: 'team-project-1',
      updatedAt: '2026-08-01T00:00:30.000Z',
    })).resolves.toEqual({ bound: false, reason: 'not_sending' })
    expect(await store.listRemoteSyncOperations()).toEqual([operation])
    store.close()
  })

  it('rejects malformed Team scope binding input', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const operation = createRemoteSyncOperation({
      id: 'sync-invalid-bind',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    await store.enqueueRemoteSyncOperation(operation)
    await store.claimNextRemoteSyncOperation('2026-08-01T00:00:10.000Z')

    await expect(store.bindRemoteSyncOperationScope({
      id: operation.id,
      generation: operation.generation,
      organizationId: '',
      teamProjectId: 'team-project-1',
      updatedAt: '2026-08-01T00:00:20.000Z',
    })).rejects.toThrow(/invalid remote-sync scope binding input/i)
    await expect(store.bindRemoteSyncOperationScope({
      id: operation.id,
      generation: operation.generation,
      organizationId: 'org-1',
      teamProjectId: 'team-project-1',
      updatedAt: 'not-a-date',
    })).rejects.toThrow(/invalid remote-sync scope binding input/i)
    expect(await store.listRemoteSyncOperations()).toMatchObject([
      { status: 'sending', organizationId: null, teamProjectId: null },
    ])
    store.close()
  })

  it('rejects a stale settle after newer logical work supersedes an in-flight generation', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const operation = createRemoteSyncOperation({
      id: 'sync-cas',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    await store.enqueueRemoteSyncOperation(operation)
    const claimed = await store.claimNextRemoteSyncOperation('2026-08-01T00:00:10.000Z')
    await store.enqueueRemoteSyncOperation({
      ...operation,
      id: 'ignored-new-id',
      createdAt: '2026-08-01T00:00:20.000Z',
      updatedAt: '2026-08-01T00:00:20.000Z',
      nextAttemptAt: '2026-08-01T00:00:20.000Z',
    })

    const result = await store.settleRemoteSyncOperation({
      id: operation.id,
      generation: claimed!.generation,
      status: 'completed',
      completedAt: '2026-08-01T00:00:30.000Z',
      updatedAt: '2026-08-01T00:00:30.000Z',
    })

    expect(result).toEqual({ settled: false, reason: 'stale_generation' })
    expect(await store.listRemoteSyncOperations()).toEqual([
      {
        ...operation,
        generation: 2,
        nextAttemptAt: '2026-08-01T00:00:20.000Z',
        updatedAt: '2026-08-01T00:00:20.000Z',
      },
    ])
    store.close()
  })

  it('rejects inconsistent remote-sync settlement state combinations', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const operation = createRemoteSyncOperation({
      id: 'sync-invalid-settle',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    await store.enqueueRemoteSyncOperation(operation)
    await store.claimNextRemoteSyncOperation('2026-08-01T00:00:10.000Z')
    const common = {
      id: operation.id,
      generation: operation.generation,
      updatedAt: '2026-08-01T00:00:20.000Z',
    }
    const invalid: SettleRemoteSyncOperationInput[] = [
      { ...common, status: 'retry-scheduled' },
      {
        ...common,
        status: 'retry-scheduled',
        nextAttemptAt: '2026-08-01T00:00:30.000Z',
      },
      { ...common, status: 'terminal' },
      {
        ...common,
        status: 'completed',
        lastErrorCode: 'remote_error',
        lastErrorMessage: 'should not survive completion',
      },
      { ...common, status: 'completed', updatedAt: 'not-a-date' },
    ]

    for (const settlement of invalid) {
      await expect(store.settleRemoteSyncOperation(settlement)).rejects.toThrow(
        /invalid remote-sync settlement/i,
      )
    }
    expect(await store.listRemoteSyncOperations()).toMatchObject([
      { status: 'sending', leaseExpiresAt: '2026-08-01T00:01:10.000Z' },
    ])
    store.close()
  })

  it('manually retries a terminal operation without changing its identity or scope', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const operation = createRemoteSyncOperation({
      id: 'sync-retry',
      kind: 'coding-agent-summary',
      localProjectId: project.id,
      organizationId: 'org-1',
      teamProjectId: 'team-project-1',
      runId: run.id,
      entityId: 'coding-run-1',
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    await store.enqueueRemoteSyncOperation(operation)
    const claimed = await store.claimNextRemoteSyncOperation('2026-08-01T00:00:10.000Z')
    await store.settleRemoteSyncOperation({
      id: operation.id,
      generation: claimed!.generation,
      status: 'terminal',
      lastErrorCode: 'forbidden',
      lastErrorMessage: 'Authorization: Bearer never-store-this-token',
      updatedAt: '2026-08-01T00:00:20.000Z',
    })
    const [terminal] = await store.listRemoteSyncOperations()
    expect(terminal?.lastErrorMessage).toContain('[REDACTED:authorization_secret]')
    expect(terminal?.lastErrorMessage).not.toContain('never-store-this-token')

    const result = await store.retryRemoteSyncOperation({
      id: operation.id,
      updatedAt: '2026-08-01T00:00:30.000Z',
    })

    expect(result).toEqual({
      retried: true,
      operation: {
        ...operation,
        generation: 2,
        nextAttemptAt: '2026-08-01T00:00:30.000Z',
        updatedAt: '2026-08-01T00:00:30.000Z',
      },
    })
    store.close()
  })

  it('recovers interrupted sending work after reopen without accepting the old generation', async () => {
    const dbPath = await tempDbPath()
    const operation = createRemoteSyncOperation({
      id: 'sync-interrupted',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    const first = await createLocalStore({ dbPath })
    await first.enqueueRemoteSyncOperation(operation)
    const claimed = await first.claimNextRemoteSyncOperation('2026-08-01T00:00:10.000Z')
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(
      await second.recoverInterruptedRemoteSyncOperations('2026-08-01T00:01:20.000Z'),
    ).toBe(1)
    expect(await second.listRemoteSyncOperations()).toEqual([
      {
        ...operation,
        generation: 2,
        attemptCount: 1,
        nextAttemptAt: '2026-08-01T00:01:20.000Z',
        lastAttemptAt: '2026-08-01T00:00:10.000Z',
        updatedAt: '2026-08-01T00:01:20.000Z',
      },
    ])
    await expect(second.settleRemoteSyncOperation({
      id: operation.id,
      generation: claimed!.generation,
      status: 'completed',
      updatedAt: '2026-08-01T00:01:30.000Z',
    })).resolves.toEqual({ settled: false, reason: 'stale_generation' })
    second.close()
  })

  it('recovers only expired remote-sync claim leases', async () => {
    const dbPath = await tempDbPath()
    const operation = createRemoteSyncOperation({
      id: 'sync-leased',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    const store = await createLocalStore({ dbPath })
    await store.enqueueRemoteSyncOperation(operation)
    await store.claimNextRemoteSyncOperation('2026-08-01T00:00:10.000Z')

    expect(
      await store.recoverInterruptedRemoteSyncOperations('2026-08-01T00:00:30.000Z'),
    ).toBe(0)
    expect(await store.listRemoteSyncOperations()).toMatchObject([
      {
        status: 'sending',
        generation: 1,
        leaseExpiresAt: '2026-08-01T00:01:10.000Z',
      },
    ])

    expect(
      await store.recoverInterruptedRemoteSyncOperations('2026-08-01T00:01:10.000Z'),
    ).toBe(1)
    expect(await store.listRemoteSyncOperations()).toMatchObject([
      {
        status: 'pending',
        generation: 2,
        nextAttemptAt: '2026-08-01T00:01:10.000Z',
        leaseExpiresAt: null,
      },
    ])
    store.close()
  })

  it('recovers legacy sending operations that have no claim lease', async () => {
    const dbPath = await tempDbPath()
    const operation = createRemoteSyncOperation({
      id: 'sync-legacy-lease',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    const first = await createLocalStore({ dbPath })
    await first.enqueueRemoteSyncOperation(operation)
    await first.claimNextRemoteSyncOperation('2026-08-01T00:00:10.000Z')
    first.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const legacy = new SQL.Database(await readFile(dbPath))
    legacy.run('pragma ignore_check_constraints = on')
    legacy.run(
      'update remote_sync_outbox set lease_expires_at = null where id = ?',
      [operation.id],
    )
    await writeFile(dbPath, Buffer.from(legacy.export()))
    legacy.close()

    const second = await createLocalStore({ dbPath })
    expect(
      await second.recoverInterruptedRemoteSyncOperations('2026-08-01T00:00:20.000Z'),
    ).toBe(1)
    expect(await second.listRemoteSyncOperations()).toMatchObject([
      { status: 'pending', generation: 2, leaseExpiresAt: null },
    ])
    second.close()
  })

  it('migrates an existing v1 database to v25 without losing local projects or runs', async () => {
    const dbPath = await tempDbPath()
    await writeLegacyV1Database(dbPath)

    const store = await createLocalStore({ dbPath })

    expect(await store.getSchemaVersion()).toBe(25)
    expect(await store.listProjects()).toEqual([project])
    expect(await store.listRuns()).toEqual([run])
    expect(await store.getSettings()).toEqual({ themePreference: 'system' })
    expect(await store.listMcpServers()).toEqual([])
    store.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const db = new SQL.Database(await readFile(dbPath))
    expect(db.exec("select value from schema_meta where key = 'schema_version'")[0]?.values[0]?.[0]).toBe('25')
    expect(db.exec("select name from sqlite_master where type = 'table' and name = 'workflow_nodes'")[0]?.values[0]?.[0]).toBe('workflow_nodes')
    db.close()
  })

  it('migrates v8 data into a metadata-only remote-sync outbox schema', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    await initial.upsertProject(project)
    await initial.saveRun(run)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const v8Db = new SQL.Database(await readFile(dbPath))
    v8Db.run(`
      ${dropAgentMemorySchemaSql}
      ${dropKnowledgeIndexSchemaSql}
      ${dropAgentRuntimeSchemaSql}
      drop index idx_remote_sync_outbox_due;
      drop table remote_sync_outbox;
      update schema_meta set value = '8' where key = 'schema_version';
    `)
    await writeFile(dbPath, Buffer.from(v8Db.export()))
    v8Db.close()

    const migrated = await createLocalStore({ dbPath })
    expect(await migrated.getSchemaVersion()).toBe(25)
    expect(await migrated.listProjects()).toEqual([project])
    expect(await migrated.listRuns()).toEqual([run])
    migrated.close()

    const inspected = new SQL.Database(await readFile(dbPath))
    const columnNames = inspected.exec('pragma table_info(remote_sync_outbox)')[0]?.values
      .map((row) => String(row[1])) ?? []
    inspected.close()
    expect(columnNames).toContain('idempotency_key')
    expect(columnNames).toContain('lease_expires_at')
    expect(columnNames).not.toEqual(expect.arrayContaining(['json', 'payload', 'raw_body']))
  })

  it('migrates a retained v20 outbox through schema 25 without losing queued metadata', async () => {
    const dbPath = await tempDbPath()
    const retainedOperation = createRemoteSyncOperation({
      id: 'sync-retained-v20',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-12T20:00:00.000Z',
    })
    const initial = await createLocalStore({ dbPath })
    await initial.enqueueRemoteSyncOperation(retainedOperation)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const v20Db = new SQL.Database(await readFile(dbPath))
    v20Db.run(`
      ${dropAgentMemorySchemaSql}
      ${dropKnowledgeIndexSchemaSql}
      drop index idx_remote_sync_outbox_due;
      alter table remote_sync_outbox rename to remote_sync_outbox_v21;
      create table remote_sync_outbox (
        id text primary key,
        kind text not null,
        local_project_id text not null,
        organization_id text,
        team_project_id text,
        run_id text not null,
        entity_id text not null,
        idempotency_key text not null unique,
        status text not null,
        generation integer not null,
        attempt_count integer not null,
        next_attempt_at text,
        lease_expires_at text,
        last_attempt_at text,
        last_error_code text,
        last_error_message text,
        recovery text not null,
        completed_at text,
        created_at text not null,
        updated_at text not null,
        check (kind in (
          'run-summary', 'test-evidence-summary', 'agent-review-summary',
          'coding-agent-summary'
        )),
        check (status in ('pending', 'sending', 'retry-scheduled', 'completed', 'terminal')),
        check (generation >= 1),
        check (attempt_count >= 0),
        check (
          (status = 'sending' and lease_expires_at is not null) or
          (status <> 'sending' and lease_expires_at is null)
        ),
        check (
          (organization_id is null and team_project_id is null) or
          (organization_id is not null and team_project_id is not null)
        )
      );
      insert into remote_sync_outbox select * from remote_sync_outbox_v21;
      drop table remote_sync_outbox_v21;
      create index idx_remote_sync_outbox_due
        on remote_sync_outbox(status, next_attempt_at, created_at);
      update schema_meta set value = '20' where key = 'schema_version';
    `)
    await writeFile(dbPath, Buffer.from(v20Db.export()))
    v20Db.close()

    const migrated = await createLocalStore({ dbPath })
    await expect(migrated.getSchemaVersion()).resolves.toBe(25)
    await expect(migrated.listRemoteSyncOperations()).resolves.toEqual([retainedOperation])
    await expect(migrated.enqueueRemoteSyncOperation(createRemoteSyncOperation({
      id: 'sync-runtime-v21',
      kind: 'agent-runtime-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: 'agent-runtime-team-1',
      createdAt: '2026-08-12T20:01:00.000Z',
    }))).resolves.toMatchObject({ operation: { kind: 'agent-runtime-summary' } })
    migrated.close()
  })

  it('migrates a retained v9 database to the Work Request materialization schema', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    await initial.upsertProject(project)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const v9Db = new SQL.Database(await readFile(dbPath))
    v9Db.run(`
      ${dropAgentMemorySchemaSql}
      ${dropKnowledgeIndexSchemaSql}
      ${dropAgentRuntimeSchemaSql}
      drop index idx_work_request_materializations_pending;
      drop index idx_work_request_materializations_run_id;
      drop table work_request_materializations;
      update schema_meta set value = '9' where key = 'schema_version';
    `)
    await writeFile(dbPath, Buffer.from(v9Db.export()))
    v9Db.close()

    const migrated = await createLocalStore({ dbPath })
    expect(await migrated.getSchemaVersion()).toBe(25)
    expect(await migrated.listProjects()).toEqual([project])
    migrated.close()

    const inspected = new SQL.Database(await readFile(dbPath))
    expect(
      inspected.exec(
        "select name from sqlite_master where type = 'table' and name = 'work_request_materializations'",
      )[0]?.values[0]?.[0],
    ).toBe('work_request_materializations')
    inspected.close()
  })

  it('migrates a retained v10 database to the Gate Command execution schema', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    await initial.upsertProject(project)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const v10Db = new SQL.Database(await readFile(dbPath))
    v10Db.run(`
      ${dropAgentMemorySchemaSql}
      ${dropKnowledgeIndexSchemaSql}
      ${dropAgentRuntimeSchemaSql}
      drop index idx_gate_command_acknowledgements_pending;
      drop table gate_command_acknowledgements;
      drop index idx_gate_command_receipts_command;
      drop table gate_command_receipts;
      drop table gate_command_executions;
      update schema_meta set value = '10' where key = 'schema_version';
    `)
    await writeFile(dbPath, Buffer.from(v10Db.export()))
    v10Db.close()

    const migrated = await createLocalStore({ dbPath })
    expect(await migrated.getSchemaVersion()).toBe(25)
    expect(await migrated.listProjects()).toEqual([project])
    migrated.close()

    const inspected = new SQL.Database(await readFile(dbPath))
    expect(
      inspected.exec(
        "select name from sqlite_master where type = 'table' and name = 'gate_command_executions'",
      )[0]?.values[0]?.[0],
    ).toBe('gate_command_executions')
    expect(
      inspected.exec('pragma table_info(gate_command_executions)')[0]?.values.map(
        (row) => String(row[1]),
      ),
    ).toContain('claim_token_id')
    expect(
      inspected.exec('pragma table_info(gate_command_acknowledgements)')[0]?.values.map(
        (row) => String(row[1]),
      ),
    ).toEqual(expect.arrayContaining(['status', 'failure_code', 'failed_at']))
    inspected.close()
  })

  it('migrates retained v11 Gate receipts into evaluated metadata observations', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    await initial.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-token',
    )
    await initial.saveRun(gateRunBefore)
    const command: GateCommand = {
      ...deliveringGateCommand,
      id: 'gate-command-v11-observation-migration',
      action: 'reject',
      workflowCommand: null,
      reason: 'Retained v11 execution.',
      idempotencyKey: 'gate-command:v11-observation-migration:run-1:v3',
      requestFingerprint: '9'.repeat(64),
    }
    const receipt: GateCommandReceipt = {
      ...gateCommandReceipt,
      id: 'gate-command-receipt-v11-observation-migration',
      commandId: command.id,
    }
    await initial.commitGateCommandExecution({
      command,
      receipt,
      expectedPairing: workRequestPairing,
      outcomeCode: 'human_rejected',
      evaluatedAt: gateRunAfter.updatedAt,
    })
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const v11Db = new SQL.Database(await readFile(dbPath))
    v11Db.run(`
      ${dropAgentMemorySchemaSql}
      ${dropKnowledgeIndexSchemaSql}
      ${dropAgentRuntimeSchemaSql}
      drop index idx_gate_command_receipt_observations_command;
      drop table gate_command_receipt_observations;
      update schema_meta set value = '11' where key = 'schema_version';
    `)
    await writeFile(dbPath, Buffer.from(v11Db.export()))
    v11Db.close()

    const migrated = await createLocalStore({ dbPath })
    expect(await migrated.getSchemaVersion()).toBe(25)
    await expect(
      migrated.getGateCommandReceiptObservation(receipt.id),
    ).resolves.toMatchObject({
      receiptId: receipt.id,
      commandId: command.id,
      claimTokenId: desktopPairingCredential.tokenId,
      status: 'evaluated',
      outcomeCode: 'human_rejected',
      receivedAt: gateRunAfter.updatedAt,
      evaluatedAt: gateRunAfter.updatedAt,
    })
    migrated.close()
  })

  it('rolls back a failed v11 Gate Command migration without advancing schema or losing data', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    await initial.upsertProject(project)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const malformed = new SQL.Database(await readFile(dbPath))
    malformed.run(`
      ${dropAgentMemorySchemaSql}
      ${dropKnowledgeIndexSchemaSql}
      drop index idx_gate_command_acknowledgements_pending;
      drop table gate_command_acknowledgements;
      drop index idx_gate_command_receipts_command;
      drop table gate_command_receipts;
      drop table gate_command_executions;
      create table gate_command_receipts (receipt_id text primary key);
      update schema_meta set value = '10' where key = 'schema_version';
    `)
    await writeFile(dbPath, Buffer.from(malformed.export()))
    malformed.close()

    await expect(createLocalStore({ dbPath })).rejects.toThrow(
      /DevFlow local database is unreadable/,
    )

    const unchanged = new SQL.Database(await readFile(dbPath))
    expect(
      unchanged.exec("select value from schema_meta where key = 'schema_version'")[0]
        ?.values[0]?.[0],
    ).toBe('10')
    expect(
      JSON.parse(
        String(unchanged.exec('select json from local_projects')[0]?.values[0]?.[0]),
      ),
    ).toEqual(project)
    expect(
      unchanged.exec('pragma table_info(gate_command_receipts)')[0]?.values.map(
        (row) => String(row[1]),
      ),
    ).toEqual(['receipt_id'])
    expect(
      unchanged.exec(
        "select name from sqlite_master where type = 'table' and name = 'gate_command_executions'",
      )[0],
    ).toBeUndefined()
    unchanged.close()
  })

  it('rolls back a failed v12 receipt observation migration without advancing schema or losing data', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    await initial.upsertProject(project)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const malformed = new SQL.Database(await readFile(dbPath))
    malformed.run(`
      ${dropAgentMemorySchemaSql}
      ${dropKnowledgeIndexSchemaSql}
      drop index idx_gate_command_receipt_observations_command;
      drop table gate_command_receipt_observations;
      create table gate_command_receipt_observations (receipt_id text primary key);
      update schema_meta set value = '11' where key = 'schema_version';
    `)
    await writeFile(dbPath, Buffer.from(malformed.export()))
    malformed.close()

    await expect(createLocalStore({ dbPath })).rejects.toThrow(
      /DevFlow local database is unreadable/,
    )

    const unchanged = new SQL.Database(await readFile(dbPath))
    expect(
      unchanged.exec("select value from schema_meta where key = 'schema_version'")[0]
        ?.values[0]?.[0],
    ).toBe('11')
    expect(
      JSON.parse(
        String(unchanged.exec('select json from local_projects')[0]?.values[0]?.[0]),
      ),
    ).toEqual(project)
    expect(
      unchanged.exec('pragma table_info(gate_command_receipt_observations)')[0]
        ?.values.map((row) => String(row[1])),
    ).toEqual(['receipt_id'])
    unchanged.close()
  })

  it('rolls back a failed v10 materialization migration without advancing schema or losing data', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    await initial.upsertProject(project)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const malformed = new SQL.Database(await readFile(dbPath))
    malformed.run(`
      ${dropAgentMemorySchemaSql}
      ${dropKnowledgeIndexSchemaSql}
      drop index idx_work_request_materializations_pending;
      drop index idx_work_request_materializations_run_id;
      drop table work_request_materializations;
      create table work_request_materializations (work_request_id text primary key);
      update schema_meta set value = '9' where key = 'schema_version';
    `)
    await writeFile(dbPath, Buffer.from(malformed.export()))
    malformed.close()

    await expect(createLocalStore({ dbPath })).rejects.toThrow(
      /DevFlow local database is unreadable/,
    )

    const unchanged = new SQL.Database(await readFile(dbPath))
    expect(
      unchanged.exec("select value from schema_meta where key = 'schema_version'")[0]
        ?.values[0]?.[0],
    ).toBe('9')
    expect(
      JSON.parse(
        String(unchanged.exec('select json from local_projects')[0]?.values[0]?.[0]),
      ),
    ).toEqual(project)
    expect(
      unchanged.exec('pragma table_info(work_request_materializations)')[0]?.values.map(
        (row) => String(row[1]),
      ),
    ).toEqual(['work_request_id'])
    unchanged.close()
  })

  it('enforces Work Request materialization state, fingerprint, and version constraints', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveRun(run)
    store.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const db = new SQL.Database(await readFile(dbPath))
    const insert = (overrides: {
      workRequestId?: string
      claimVersion?: number
      fingerprint?: string
      idempotencyKey?: string
      status?: string
      acknowledgedVersion?: number | null
      acknowledgedAt?: string | null
    }) =>
      db.run(
        `insert into work_request_materializations (
           work_request_id, organization_id, team_project_id, local_project_id,
           run_id, claim_version, source_fingerprint, materialize_idempotency_key,
           status, acknowledged_version, created_at, updated_at, acknowledged_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          overrides.workRequestId ?? `wr-${JSON.stringify(overrides)}`,
          'org-demo',
          'p-payments',
          project.id,
          run.id,
          overrides.claimVersion ?? 2,
          overrides.fingerprint ?? 'a'.repeat(64),
          overrides.idempotencyKey ?? `materialize-${JSON.stringify(overrides)}`,
          overrides.status ?? 'pending_ack',
          overrides.acknowledgedVersion ?? null,
          '2026-08-01T12:00:00.000Z',
          '2026-08-01T12:00:00.000Z',
          overrides.acknowledgedAt ?? null,
        ],
      )

    expect(() => insert({ claimVersion: 0 })).toThrow(/constraint/i)
    expect(() => insert({ fingerprint: 'not-a-sha256' })).toThrow(/constraint/i)
    expect(() => insert({ idempotencyKey: ' padded ' })).toThrow(/constraint/i)
    expect(() => insert({ status: 'forgotten' })).toThrow(/constraint/i)
    expect(() =>
      insert({ status: 'pending_ack', acknowledgedVersion: 3 }),
    ).toThrow(/constraint/i)
    expect(() =>
      insert({
        status: 'acknowledged',
        acknowledgedVersion: 4,
        acknowledgedAt: '2026-08-01T12:01:00.000Z',
      }),
    ).toThrow(/constraint/i)
    expect(() =>
      insert({ status: 'acknowledged', acknowledgedVersion: 3 }),
    ).toThrow(/constraint/i)
    db.close()
  })

  it('enforces remote-sync metadata invariants in the SQLite schema', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    store.close()
    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const db = new SQL.Database(await readFile(dbPath))
    const insert = (overrides: {
      kind?: string
      organizationId?: string | null
      teamProjectId?: string | null
      status?: string
      generation?: number
      attemptCount?: number
      leaseExpiresAt?: string | null
    }) => db.run(
      `insert into remote_sync_outbox (
         id, kind, local_project_id, organization_id, team_project_id, run_id, entity_id,
         idempotency_key, status, generation, attempt_count, next_attempt_at, lease_expires_at, recovery,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `invalid-${JSON.stringify(overrides)}`,
        overrides.kind ?? 'run-summary',
        'local-1',
        overrides.organizationId ?? null,
        overrides.teamProjectId ?? null,
        'run-1',
        'run-1',
        `key-${JSON.stringify(overrides)}`,
        overrides.status ?? 'pending',
        overrides.generation ?? 1,
        overrides.attemptCount ?? 0,
        '2026-08-01T00:00:00.000Z',
        overrides.leaseExpiresAt ?? null,
        'none',
        '2026-08-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
      ],
    )

    expect(() => insert({ organizationId: 'org-1' })).toThrow(/constraint/i)
    expect(() => insert({ kind: 'payload-dump' })).toThrow(/constraint/i)
    expect(() => insert({ status: 'forgotten' })).toThrow(/constraint/i)
    expect(() => insert({ generation: 0 })).toThrow(/constraint/i)
    expect(() => insert({ attemptCount: -1 })).toThrow(/constraint/i)
    expect(() => insert({ status: 'sending' })).toThrow(/constraint/i)
    expect(() => insert({ leaseExpiresAt: '2026-08-01T00:01:00.000Z' })).toThrow(
      /constraint/i,
    )
    db.close()
  })

  it('refuses to open a database created by a newer schema version', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const newerDb = new SQL.Database(await readFile(dbPath))
    newerDb.run("update schema_meta set value = '26' where key = 'schema_version'")
    await writeFile(dbPath, Buffer.from(newerDb.export()))
    newerDb.close()

    await expect(createLocalStore({ dbPath })).rejects.toThrow(
      /schema version 26 is newer than supported version 25/,
    )

    const unchangedDb = new SQL.Database(await readFile(dbPath))
    expect(
      unchangedDb.exec("select value from schema_meta where key = 'schema_version'")[0]
        ?.values[0]?.[0],
    ).toBe('26')
    unchangedDb.close()
  })

  it('leaves the previous version and data intact when a migration transaction fails', async () => {
    const dbPath = await tempDbPath()
    const initial = await createLocalStore({ dbPath })
    await initial.upsertProject(project)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const v7Db = new SQL.Database(await readFile(dbPath))
    v7Db.run(`
      ${dropAgentMemorySchemaSql}
      ${dropKnowledgeIndexSchemaSql}
      ${dropAgentRuntimeSchemaSql}
      drop index idx_workflow_nodes_run_id_position;
      drop table workflow_nodes;
      create table workflow_nodes (id text primary key);
      update schema_meta set value = '7' where key = 'schema_version';
    `)
    await writeFile(dbPath, Buffer.from(v7Db.export()))
    v7Db.close()

    await expect(createLocalStore({ dbPath })).rejects.toThrow(
      /DevFlow local database is unreadable/,
    )

    const unchangedDb = new SQL.Database(await readFile(dbPath))
    expect(
      unchangedDb.exec("select value from schema_meta where key = 'schema_version'")[0]
        ?.values[0]?.[0],
    ).toBe('7')
    expect(
      JSON.parse(String(unchangedDb.exec('select json from local_projects')[0]?.values[0]?.[0])),
    ).toEqual(project)
    unchangedDb.run('drop table workflow_nodes')
    await writeFile(dbPath, Buffer.from(unchangedDb.export()))
    unchangedDb.close()

    const migrated = await createLocalStore({ dbPath })
    expect(await migrated.getSchemaVersion()).toBe(25)
    expect(await migrated.listProjects()).toEqual([project])
    migrated.close()
  })

  it('throws a clear error when an existing database file is corrupted', async () => {
    const dbPath = await tempDbPath()
    await writeFile(dbPath, 'not a sqlite database')

    await expect(createLocalStore({ dbPath })).rejects.toThrow(/DevFlow local database is unreadable/)
  })

  it('persists local projects, runs, artifacts, events, and test evidence across reopen', async () => {
    const dbPath = await tempDbPath()

    const first = await createLocalStore({ dbPath })
    await first.upsertProject(project)
    await first.saveRun(run)
    await first.saveArtifact(artifact)
    await first.saveEvent(event)
    await first.saveTestEvidence(evidence)
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.listProjects()).toEqual([project])
    expect(await second.listRuns()).toEqual([run])
    expect(await second.listArtifacts('run-1')).toEqual([
      createTestEvidenceArtifact(redactTestEvidenceForStorage(evidence)),
    ])
    expect(await second.listEvents('run-1')).toEqual([event])
    expect(await second.listTestEvidence('run-1')).toEqual([
      redactTestEvidenceForStorage(evidence),
    ])
    second.close()
  })

  it('persists concurrent mutations in invocation order without reviving stale snapshots', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const concurrentArtifact: Artifact = {
      ...artifact,
      id: 'artifact-concurrent-persist',
      kind: 'design',
    }

    const saving = store.saveArtifact(concurrentArtifact)
    const deleting = store.deleteRun(concurrentArtifact.runId)
    await Promise.all([saving, deleting])

    store.close()
    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.listArtifacts(concurrentArtifact.runId)).toEqual([])
    reopened.close()
  })

  it('redacts Test Result events at the local persistence boundary', async () => {
    const dbPath = await tempDbPath()
    const hostileEvent: AgentEvent = {
      ...event,
      message:
        'error:/Users/alice/private/report.json Authorization: Bearer opaque-agent-event-secret',
    }

    const store = await createLocalStore({ dbPath })
    await store.saveEvent(hostileEvent)

    const [persisted] = await store.listEvents(hostileEvent.runId)
    expect(JSON.stringify(persisted)).not.toContain('/Users/alice/private')
    expect(JSON.stringify(persisted)).not.toContain('opaque-agent-event-secret')
    store.close()
  })

  it('permanently redacts legacy Test Evidence when opening an existing database', async () => {
    const dbPath = await tempDbPath()
    const legacyEvidence: TestEvidence = {
      ...evidence,
      command: 'node /Users/alice/work/devflow/scripts/test.mjs',
      cwd: '/Users/alice/work/devflow',
      stdout: 'FAIL /Users/alice/work/devflow/src/workflow.test.ts:42',
      stderr: 'API_TOKEN=super-secret-token',
      summary: 'Tests failed in /Users/alice/work/devflow',
      redacted: false,
    }

    const initial = await createLocalStore({ dbPath })
    await initial.saveTestEvidence(evidence)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const legacyDb = new SQL.Database(await readFile(dbPath))
    legacyDb.run('update test_evidence set json = ? where id = ?', [
      JSON.stringify(legacyEvidence),
      legacyEvidence.id,
    ])
    await writeFile(dbPath, Buffer.from(legacyDb.export()))
    legacyDb.close()

    const normalizedEvidence = redactTestEvidenceForStorage(legacyEvidence)
    const migrated = await createLocalStore({ dbPath })
    expect(await migrated.listTestEvidence(legacyEvidence.runId)).toEqual([normalizedEvidence])
    migrated.close()

    const persistedDb = new SQL.Database(await readFile(dbPath))
    const persistedJson = String(
      persistedDb.exec('select json from test_evidence')[0]?.values[0]?.[0] ?? '',
    )
    persistedDb.close()
    expect(persistedJson).not.toContain('/Users/alice/work/devflow')
    expect(persistedJson).not.toContain('super-secret-token')

    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.listTestEvidence(legacyEvidence.runId)).toEqual([normalizedEvidence])
    reopened.close()
  })

  it('permanently rebuilds a legacy Test Result event from sanitized evidence', async () => {
    const dbPath = await tempDbPath()
    const legacyEvidence: TestEvidence = {
      ...evidence,
      cwd: '/Users/alice/work/devflow',
      summary:
        'Tests failed in /Users/alice/work/devflow with Authorization: Bearer opaque-legacy-secret',
      status: 'failed',
      exitCode: 1,
      redacted: false,
    }
    const legacyEvent: AgentEvent = {
      ...event,
      id: `event-${legacyEvidence.id}`,
      message: legacyEvidence.summary,
    }

    const initial = await createLocalStore({ dbPath })
    await initial.saveTestEvidence(evidence)
    await initial.saveEvent(event)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const legacyDb = new SQL.Database(await readFile(dbPath))
    legacyDb.run('update test_evidence set json = ? where id = ?', [
      JSON.stringify(legacyEvidence),
      legacyEvidence.id,
    ])
    legacyDb.run('update agent_events set json = ? where id = ?', [
      JSON.stringify(legacyEvent),
      legacyEvent.id,
    ])
    await writeFile(dbPath, Buffer.from(legacyDb.export()))
    legacyDb.close()

    const expected = createTestEvidenceEvent(
      redactTestEvidenceForStorage(legacyEvidence),
      legacyEvent.sequence,
    )
    const migrated = await createLocalStore({ dbPath })
    expect(await migrated.listEvents(legacyEvidence.runId)).toEqual([expected])
    migrated.close()

    const persistedDb = new SQL.Database(await readFile(dbPath))
    const persistedJson = String(
      persistedDb.exec('select json from agent_events where id = ?', [legacyEvent.id])[0]
        ?.values[0]?.[0] ?? '',
    )
    persistedDb.close()
    expect(persistedJson).not.toContain('/Users/alice/work/devflow')
    expect(persistedJson).not.toContain('opaque-legacy-secret')
  })

  it('permanently redacts an orphaned legacy Test Result event', async () => {
    const dbPath = await tempDbPath()
    const orphanedEvent: AgentEvent = {
      ...event,
      id: 'event-orphaned-legacy-test-result',
      message:
        'error:/Users/alice/private/orphan.json Authorization: Bearer opaque-orphan-secret',
    }

    const initial = await createLocalStore({ dbPath })
    await initial.saveEvent({ ...orphanedEvent, message: 'safe placeholder' })
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const legacyDb = new SQL.Database(await readFile(dbPath))
    legacyDb.run('update agent_events set json = ? where id = ?', [
      JSON.stringify(orphanedEvent),
      orphanedEvent.id,
    ])
    await writeFile(dbPath, Buffer.from(legacyDb.export()))
    legacyDb.close()

    const migrated = await createLocalStore({ dbPath })
    const [persisted] = await migrated.listEvents(orphanedEvent.runId)
    expect(JSON.stringify(persisted)).not.toContain('/Users/alice/private')
    expect(JSON.stringify(persisted)).not.toContain('opaque-orphan-secret')
    migrated.close()
  })

  it('permanently rebuilds legacy Test Evidence reports without changing non-TestEvidence artifacts', async () => {
    const dbPath = await tempDbPath()
    const legacyEvidence: TestEvidence = {
      ...evidence,
      command: 'node /Users/alice/work/devflow/scripts/test.mjs',
      cwd: '/Users/alice/work/devflow',
      stdout: 'FAIL /Users/alice/work/devflow/src/workflow.test.ts:42',
      stderr: 'API_TOKEN=super-secret-token',
      summary: 'Tests failed in /Users/alice/work/devflow',
      redacted: false,
    }
    const legacyReport: Artifact = {
      ...artifact,
      id: `artifact-${legacyEvidence.id}`,
      summary: legacyEvidence.summary,
      content: [
        `Command: ${legacyEvidence.command}`,
        `CWD: ${legacyEvidence.cwd}`,
        `STDOUT: ${legacyEvidence.stdout}`,
        `STDERR: ${legacyEvidence.stderr}`,
      ].join('\n'),
      redacted: false,
    }
    const collisionEvidence: TestEvidence = {
      ...evidence,
      id: 'evidence-non-test-artifact',
    }
    const nonTestEvidenceArtifact: Artifact = {
      ...artifact,
      id: `artifact-${collisionEvidence.id}`,
      kind: 'design',
      title: 'Do not rebuild this artifact',
      summary: 'This artifact only collides with the deterministic Test Evidence id.',
      content: 'Preserve this content exactly.',
      updatedAt: '2026-06-15T00:02:00.000Z',
    }

    const initial = await createLocalStore({ dbPath })
    await initial.saveTestEvidence(legacyEvidence)
    await initial.saveTestEvidence(collisionEvidence)
    await initial.saveArtifact(legacyReport)
    await initial.saveArtifact(nonTestEvidenceArtifact)
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const legacyDb = new SQL.Database(await readFile(dbPath))
    legacyDb.run('update test_evidence set json = ? where id = ?', [
      JSON.stringify(legacyEvidence),
      legacyEvidence.id,
    ])
    legacyDb.run('update artifacts set json = ? where id = ?', [
      JSON.stringify(legacyReport),
      legacyReport.id,
    ])
    await writeFile(dbPath, Buffer.from(legacyDb.export()))
    legacyDb.close()

    const normalizedEvidence = redactTestEvidenceForStorage(legacyEvidence)
    const normalizedReport = createTestEvidenceArtifact(normalizedEvidence)
    const migrated = await createLocalStore({ dbPath })
    expect(await migrated.listArtifacts(legacyEvidence.runId)).toEqual([
      normalizedReport,
      nonTestEvidenceArtifact,
    ])
    migrated.close()

    const persistedDb = new SQL.Database(await readFile(dbPath))
    const persistedReportJson = String(
      persistedDb.exec('select json from artifacts where id = ?', [legacyReport.id])[0]
        ?.values[0]?.[0] ?? '',
    )
    persistedDb.close()
    expect(persistedReportJson).not.toContain('/Users/alice/work/devflow')
    expect(persistedReportJson).not.toContain('super-secret-token')

    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.listArtifacts(legacyEvidence.runId)).toEqual([
      normalizedReport,
      nonTestEvidenceArtifact,
    ])
    reopened.close()
  })

  it('permanently redacts an orphaned legacy Test Report before it can be displayed', async () => {
    const dbPath = await tempDbPath()
    const orphanedReport: Artifact = {
      ...artifact,
      id: 'artifact-orphaned-test-report',
      title: 'Report from /Users/alice/private',
      summary:
        'error:/Users/alice/private/report.json Authorization: Bearer opaque-report-secret',
      content:
        'cache:/Users/alice/private/cache.json {"password":"opaque-report-secret"}',
      redacted: false,
    }

    const initial = await createLocalStore({ dbPath })
    await initial.saveArtifact({
      ...orphanedReport,
      title: 'safe placeholder',
      summary: 'safe placeholder',
      content: 'safe placeholder',
    })
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const legacyDb = new SQL.Database(await readFile(dbPath))
    legacyDb.run('update artifacts set json = ? where id = ?', [
      JSON.stringify(orphanedReport),
      orphanedReport.id,
    ])
    await writeFile(dbPath, Buffer.from(legacyDb.export()))
    legacyDb.close()

    const migrated = await createLocalStore({ dbPath })
    const [persisted] = await migrated.listArtifacts(orphanedReport.runId)
    expect(JSON.stringify(persisted)).not.toContain('/Users/alice/private')
    expect(JSON.stringify(persisted)).not.toContain('opaque-report-secret')
    expect(persisted?.redacted).toBe(true)
    migrated.close()
  })

  it('redacts but does not rebuild a legacy Test Report with a mismatched evidence relation', async () => {
    const dbPath = await tempDbPath()
    const mismatchedReport: Artifact = {
      ...artifact,
      id: `artifact-${evidence.id}`,
      nodeId: 'node-other',
      title: 'Mismatched report from /Users/alice/private',
      summary: 'Authorization: Bearer opaque-mismatch-secret',
      content: 'error:/Users/alice/private/report.json',
      redacted: false,
    }

    const initial = await createLocalStore({ dbPath })
    await initial.saveTestEvidence(evidence)
    await initial.saveArtifact({
      ...mismatchedReport,
      title: 'safe placeholder',
      summary: 'safe placeholder',
      content: 'safe placeholder',
    })
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const legacyDb = new SQL.Database(await readFile(dbPath))
    legacyDb.run('update artifacts set json = ? where id = ?', [
      JSON.stringify(mismatchedReport),
      mismatchedReport.id,
    ])
    await writeFile(dbPath, Buffer.from(legacyDb.export()))
    legacyDb.close()

    const migrated = await createLocalStore({ dbPath })
    const [persisted] = await migrated.listArtifacts(mismatchedReport.runId)
    expect(persisted?.nodeId).toBe('node-other')
    expect(persisted?.title).not.toBe('Local test evidence')
    expect(JSON.stringify(persisted)).not.toContain('/Users/alice/private')
    expect(JSON.stringify(persisted)).not.toContain('opaque-mismatch-secret')
    expect(persisted?.redacted).toBe(true)
    migrated.close()
  })

  it('redacts Test Report display fields on write without changing non-TestReport artifacts', async () => {
    const dbPath = await tempDbPath()
    const hostileReport: Artifact = {
      ...artifact,
      id: 'artifact-write-boundary-test-report',
      title: 'Report from /Users/alice/private',
      summary: 'Authorization: Bearer opaque-write-secret',
      content: 'error:/Users/alice/private/report.json --token opaque-write-secret',
      redacted: false,
    }
    const unrelatedArtifact: Artifact = {
      ...artifact,
      id: 'artifact-unrelated-design',
      kind: 'design',
      title: 'Design keeps /Users/alice/private by local policy',
      summary: 'Authorization: Bearer intentionally-unmodified',
      content: 'Do not apply the Test Report policy here.',
      redacted: false,
    }

    const store = await createLocalStore({ dbPath })
    await store.saveArtifact(hostileReport)
    await store.saveArtifact(unrelatedArtifact)

    const persisted = await store.listArtifacts(hostileReport.runId)
    const report = persisted.find((candidate) => candidate.id === hostileReport.id)
    const design = persisted.find((candidate) => candidate.id === unrelatedArtifact.id)
    expect(JSON.stringify(report)).not.toContain('/Users/alice/private')
    expect(JSON.stringify(report)).not.toContain('opaque-write-secret')
    expect(report?.redacted).toBe(true)
    expect(design).toEqual(unrelatedArtifact)
    store.close()
  })

  it('marks every persisted Test Report as redacted even when its display text is already safe', async () => {
    const dbPath = await tempDbPath()
    const safeReport: Artifact = {
      ...artifact,
      id: 'artifact-safe-test-report',
      title: 'Safe Test Report',
      summary: 'All tests passed.',
      content: 'No sensitive output was captured.',
      redacted: false,
    }

    const store = await createLocalStore({ dbPath })
    await store.saveArtifact(safeReport)

    const [persisted] = await store.listArtifacts(safeReport.runId)
    expect(persisted).toEqual({ ...safeReport, redacted: true })
    store.close()
  })

  it('creates a workflow run and its initial evidence atomically', async () => {
    const dbPath = await tempDbPath()
    const first = await createLocalStore({ dbPath })

    await expect(
      first.createWorkflow({
        run,
        artifacts: [artifact],
        events: [event],
      }),
    ).resolves.toEqual({ created: true })
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.getRun(run.id)).toEqual(run)
    expect(await second.listArtifacts(run.id)).toEqual([{ ...artifact, redacted: true }])
    expect(await second.listEvents(run.id)).toEqual([event])
    second.close()
  })

  it('rejects a duplicate workflow creation without writing new candidates', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveRun(run)

    await expect(
      store.createWorkflow({
        run: { ...run, title: 'Must not replace the existing run' },
        artifacts: [artifact],
        events: [event],
      }),
    ).resolves.toEqual({ created: false, reason: 'run_exists' })

    expect(await store.getRun(run.id)).toEqual(run)
    expect(await store.listArtifacts(run.id)).toEqual([])
    expect(await store.listEvents(run.id)).toEqual([])
    store.close()
  })

  it('rolls back workflow creation when an initial evidence write fails', async () => {
    const dbPath = await tempDbPath()
    const invalidArtifact = {
      ...artifact,
      content: BigInt(1),
    } as unknown as Artifact
    const store = await createLocalStore({ dbPath })

    await expect(
      store.createWorkflow({
        run,
        artifacts: [invalidArtifact],
        events: [event],
      }),
    ).rejects.toThrow()

    expect(await store.getRun(run.id)).toBeNull()
    expect(await store.listArtifacts(run.id)).toEqual([])
    expect(await store.listEvents(run.id)).toEqual([])
    store.close()
  })

  it('atomically materializes a claimed Work Request and reopens its safe pending binding', async () => {
    const dbPath = await tempDbPath()
    const first = await createLocalStore({ dbPath })
    await first.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-materialization-token',
    )

    await expect(
      first.materializeClaimedWorkRequest({
        workRequest: claimedWorkRequest,
        creation: claimedWorkRequestCreation,
        expectedPairing: workRequestPairing,
        sourceFingerprint: claimedWorkRequestFingerprint,
        materializeIdempotencyKey,
      }),
    ).resolves.toEqual({ status: 'created' })

    const expectedBinding = {
      workRequestId: claimedWorkRequest.id,
      organizationId: claimedWorkRequest.organizationId,
      teamProjectId: claimedWorkRequest.projectId,
      localProjectId: project.id,
      runId: claimedWorkRequest.claim!.runId,
      claimVersion: claimedWorkRequest.version,
      sourceFingerprint: claimedWorkRequestFingerprint,
      materializeIdempotencyKey,
      status: 'pending_ack',
      acknowledgedVersion: null,
      createdAt: claimedWorkRequest.claim!.claimedAt,
      updatedAt: claimedWorkRequest.claim!.claimedAt,
      acknowledgedAt: null,
    }
    expect(
      await first.getWorkRequestMaterializationByWorkRequestId(
        claimedWorkRequest.id,
      ),
    ).toEqual(expectedBinding)
    expect(
      await first.getWorkRequestMaterializationByRunId(
        claimedWorkRequest.claim!.runId,
      ),
    ).toEqual(expectedBinding)
    expect(await first.getRun(claimedWorkRequest.claim!.runId)).toEqual(
      claimedWorkRequestCreation.run,
    )
    expect(
      await first.listArtifacts(claimedWorkRequest.claim!.runId),
    ).toEqual(claimedWorkRequestCreation.artifacts)
    expect(await first.listEvents(claimedWorkRequest.claim!.runId)).toEqual(
      claimedWorkRequestCreation.events,
    )
    expect(
      await first.listRemoteSyncOperations(claimedWorkRequest.claim!.runId),
    ).toMatchObject([
      {
        kind: 'run-summary',
        organizationId: claimedWorkRequest.organizationId,
        teamProjectId: claimedWorkRequest.projectId,
        runId: claimedWorkRequest.claim!.runId,
        generation: 1,
      },
    ])
    first.close()

    const reopened = await createLocalStore({ dbPath })
    expect(
      await reopened.getWorkRequestMaterializationByWorkRequestId(
        claimedWorkRequest.id,
      ),
    ).toEqual(expectedBinding)
    expect(await reopened.getRun(claimedWorkRequest.claim!.runId)).toEqual(
      claimedWorkRequestCreation.run,
    )
    reopened.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const inspected = new SQL.Database(await readFile(dbPath))
    const rawBinding = inspected.exec(
      'select * from work_request_materializations',
    )[0]?.values[0]
    expect(JSON.stringify(rawBinding)).not.toContain(
      desktopPairingCredential.tokenId,
    )
    expect(JSON.stringify(rawBinding)).not.toContain(
      claimedWorkRequest.title,
    )
    expect(JSON.stringify(rawBinding)).not.toContain(
      claimedWorkRequest.request,
    )
    inspected.close()
  })

  it('replays an identical local materialization without re-enqueueing and rejects changed authority', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-materialization-token',
    )
    const input = {
      workRequest: claimedWorkRequest,
      creation: claimedWorkRequestCreation,
      expectedPairing: workRequestPairing,
      sourceFingerprint: claimedWorkRequestFingerprint,
      materializeIdempotencyKey,
    }

    await expect(store.materializeClaimedWorkRequest(input)).resolves.toEqual({
      status: 'created',
    })
    await expect(store.materializeClaimedWorkRequest(input)).resolves.toEqual({
      status: 'replayed',
    })
    expect(
      await store.listRemoteSyncOperations(claimedWorkRequest.claim!.runId),
    ).toMatchObject([{ generation: 1, status: 'pending' }])

    await expect(
      store.materializeClaimedWorkRequest({
        ...input,
        sourceFingerprint: 'b'.repeat(64),
      }),
    ).resolves.toEqual({ status: 'conflict' })
    expect(
      await store.getWorkRequestMaterializationByWorkRequestId(
        claimedWorkRequest.id,
      ),
    ).toMatchObject({ sourceFingerprint: claimedWorkRequestFingerprint })
    store.close()
  })

  it('never adopts an existing unbound Run for a Work Request claim', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-materialization-token',
    )
    await store.saveRun(claimedWorkRequestCreation.run)

    await expect(
      store.materializeClaimedWorkRequest({
        workRequest: claimedWorkRequest,
        creation: claimedWorkRequestCreation,
        expectedPairing: workRequestPairing,
        sourceFingerprint: claimedWorkRequestFingerprint,
        materializeIdempotencyKey,
      }),
    ).resolves.toEqual({ status: 'conflict' })
    expect(
      await store.getWorkRequestMaterializationByWorkRequestId(
        claimedWorkRequest.id,
      ),
    ).toBeNull()
    expect(await store.listArtifacts(claimedWorkRequest.claim!.runId)).toEqual(
      [],
    )
    store.close()
  })

  it.each([
    ['tokenId', { tokenId: 'desktop-token-other' }],
    ['organization', { organizationId: 'org-other' }],
    ['Team Project', { projectId: 'p-other' }],
    ['local Project', { localProjectId: 'local-other' }],
  ])(
    'fails closed when the current pairing differs by %s',
    async (_field, change) => {
      const dbPath = await tempDbPath()
      const store = await createLocalStore({ dbPath })
      await store.saveDesktopPairingCredential(
        { ...desktopPairingCredential, localProjectId: project.id },
        'encrypted-materialization-token',
      )

      await expect(
        store.materializeClaimedWorkRequest({
          workRequest: claimedWorkRequest,
          creation: claimedWorkRequestCreation,
          expectedPairing: { ...workRequestPairing, ...change },
          sourceFingerprint: claimedWorkRequestFingerprint,
          materializeIdempotencyKey,
        }),
      ).resolves.toEqual({ status: 'pairing_scope_mismatch' })
      expect(await store.getRun(claimedWorkRequest.claim!.runId)).toBeNull()
      expect(
        await store.getWorkRequestMaterializationByWorkRequestId(
          claimedWorkRequest.id,
        ),
      ).toBeNull()
      store.close()
    },
  )

  it('rejects non-canonical claim materialization fields even with a valid upper-layer fingerprint', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-materialization-token',
    )
    const variants: Array<{
      workRequest: WorkRequest
      creation: typeof claimedWorkRequestCreation
    }> = [
      {
        workRequest: { ...claimedWorkRequest, title: 'Changed title' },
        creation: claimedWorkRequestCreation,
      },
      {
        workRequest: {
          ...claimedWorkRequest,
          claim: { ...claimedWorkRequest.claim!, runId: 'run-other' },
        },
        creation: claimedWorkRequestCreation,
      },
      {
        workRequest: claimedWorkRequest,
        creation: {
          ...claimedWorkRequestCreation,
          run: {
            ...claimedWorkRequestCreation.run,
            creatorId: 'u-other',
          },
        },
      },
      {
        workRequest: claimedWorkRequest,
        creation: {
          ...claimedWorkRequestCreation,
          run: {
            ...claimedWorkRequestCreation.run,
            createdAt: '2026-08-01T12:00:01.000Z',
            updatedAt: '2026-08-01T12:00:01.000Z',
          },
        },
      },
      {
        workRequest: claimedWorkRequest,
        creation: {
          ...claimedWorkRequestCreation,
          run: { ...claimedWorkRequestCreation.run, projectId: 'local-other' },
        },
      },
    ]

    for (const variant of variants) {
      await expect(
        store.materializeClaimedWorkRequest({
          ...variant,
          expectedPairing: workRequestPairing,
          sourceFingerprint: 'd'.repeat(64),
          materializeIdempotencyKey,
        }),
      ).resolves.toEqual({ status: 'conflict' })
    }
    expect(await store.getRun(claimedWorkRequest.claim!.runId)).toBeNull()
    expect(
      await store.getWorkRequestMaterializationByWorkRequestId(
        claimedWorkRequest.id,
      ),
    ).toBeNull()
    store.close()
  })

  it('serializes colliding Work Request materializations so one Run has one authority binding', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-materialization-token',
    )
    const competingRequest: WorkRequest = {
      ...claimedWorkRequest,
      id: 'wr-competing-materialization',
    }
    const competingFingerprint = 'c'.repeat(64)

    const [winner, loser] = await Promise.all([
      store.materializeClaimedWorkRequest({
        workRequest: claimedWorkRequest,
        creation: claimedWorkRequestCreation,
        expectedPairing: workRequestPairing,
        sourceFingerprint: claimedWorkRequestFingerprint,
        materializeIdempotencyKey,
      }),
      store.materializeClaimedWorkRequest({
        workRequest: competingRequest,
        creation: claimedWorkRequestCreation,
        expectedPairing: workRequestPairing,
        sourceFingerprint: competingFingerprint,
        materializeIdempotencyKey: 'materialize:competing',
      }),
    ])

    expect(winner).toEqual({ status: 'created' })
    expect(loser).toEqual({ status: 'conflict' })
    expect(
      await store.getWorkRequestMaterializationByRunId(
        claimedWorkRequest.claim!.runId,
      ),
    ).toMatchObject({ workRequestId: claimedWorkRequest.id })
    store.close()
  })

  it('marks materialization acknowledgement idempotently and rejects changed bindings', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-materialization-token',
    )
    await store.materializeClaimedWorkRequest({
      workRequest: claimedWorkRequest,
      creation: claimedWorkRequestCreation,
      expectedPairing: workRequestPairing,
      sourceFingerprint: claimedWorkRequestFingerprint,
      materializeIdempotencyKey,
    })
    const ackInput = {
      workRequestId: claimedWorkRequest.id,
      runId: claimedWorkRequest.claim!.runId,
      materializedVersion: claimedWorkRequest.version + 1,
      acknowledgedAt: '2026-08-01T12:01:00.000Z',
      expectedPairing: workRequestPairing,
      sourceFingerprint: claimedWorkRequestFingerprint,
      materializeIdempotencyKey,
    }

    await expect(
      store.markWorkRequestMaterializationAcknowledged(ackInput),
    ).resolves.toEqual({ acknowledged: true })
    await expect(
      store.markWorkRequestMaterializationAcknowledged({
        ...ackInput,
        acknowledgedAt: '2026-08-01T12:02:00.000Z',
      }),
    ).resolves.toEqual({ acknowledged: false, reason: 'conflict' })
    expect(
      await store.getWorkRequestMaterializationByWorkRequestId(
        claimedWorkRequest.id,
      ),
    ).toMatchObject({
      status: 'acknowledged',
      acknowledgedVersion: claimedWorkRequest.version + 1,
      acknowledgedAt: ackInput.acknowledgedAt,
    })

    await expect(
      store.markWorkRequestMaterializationAcknowledged({
        ...ackInput,
        materializedVersion: claimedWorkRequest.version + 2,
      }),
    ).resolves.toEqual({ acknowledged: false, reason: 'conflict' })
    await expect(
      store.markWorkRequestMaterializationAcknowledged({
        ...ackInput,
        expectedPairing: {
          ...workRequestPairing,
          tokenId: 'desktop-token-other',
        },
      }),
    ).resolves.toEqual({
      acknowledged: false,
      reason: 'pairing_scope_mismatch',
    })
    store.close()
  })

  it('restores Run, evidence, outbox, and binding when materialization persistence fails', async () => {
    const dbPath = await tempDbPath()
    const backupPath = `${dbPath}.backup`
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-materialization-token',
    )
    await rename(dbPath, backupPath)
    await mkdir(dbPath)

    await expect(
      store.materializeClaimedWorkRequest({
        workRequest: claimedWorkRequest,
        creation: claimedWorkRequestCreation,
        expectedPairing: workRequestPairing,
        sourceFingerprint: claimedWorkRequestFingerprint,
        materializeIdempotencyKey,
      }),
    ).rejects.toThrow(persistenceFailurePattern)
    expect(await store.getRun(claimedWorkRequest.claim!.runId)).toBeNull()
    expect(
      await store.getWorkRequestMaterializationByWorkRequestId(
        claimedWorkRequest.id,
      ),
    ).toBeNull()
    expect(
      await store.listRemoteSyncOperations(claimedWorkRequest.claim!.runId),
    ).toEqual([])
    store.close()

    await rm(dbPath, { recursive: true })
    await rename(backupPath, dbPath)
    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.getRun(claimedWorkRequest.claim!.runId)).toBeNull()
    expect(
      await reopened.getWorkRequestMaterializationByWorkRequestId(
        claimedWorkRequest.id,
      ),
    ).toBeNull()
    reopened.close()
  })

  it('refuses to delete a Run while it is bound to a Work Request materialization', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(
      { ...desktopPairingCredential, localProjectId: project.id },
      'encrypted-materialization-token',
    )
    await store.materializeClaimedWorkRequest({
      workRequest: claimedWorkRequest,
      creation: claimedWorkRequestCreation,
      expectedPairing: workRequestPairing,
      sourceFingerprint: claimedWorkRequestFingerprint,
      materializeIdempotencyKey,
    })

    await expect(
      store.deleteRun(claimedWorkRequest.claim!.runId),
    ).rejects.toThrow('Run is bound to a Work Request materialization.')
    expect(await store.getRun(claimedWorkRequest.claim!.runId)).not.toBeNull()
    expect(
      await store.getWorkRequestMaterializationByRunId(
        claimedWorkRequest.claim!.runId,
      ),
    ).not.toBeNull()
    store.close()
  })

  it('commits a workflow run and its candidate evidence atomically', async () => {
    const dbPath = await tempDbPath()
    const updatedRun: WorkflowRun = {
      ...run,
      title: 'Run local tests atomically',
      updatedAt: '2026-06-15T00:01:00.000Z',
    }

    const first = await createLocalStore({ dbPath })
    await first.saveRun(run)
    await expect(
      first.commitWorkflowMutation({
        expectedRun: run,
        run: updatedRun,
        artifacts: [artifact],
        events: [event],
        testEvidence: [evidence],
      }),
    ).resolves.toEqual({ committed: true })
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.getRun(run.id)).toEqual(updatedRun)
    expect(await second.listArtifacts(run.id)).toEqual([
      createTestEvidenceArtifact(redactTestEvidenceForStorage(evidence)),
    ])
    expect(await second.listEvents(run.id)).toEqual([event])
    expect(await second.listTestEvidence(run.id)).toEqual([
      redactTestEvidenceForStorage(evidence),
    ])
    second.close()
  })

  it('rolls back the whole workflow mutation when any candidate write fails', async () => {
    const dbPath = await tempDbPath()
    const updatedRun: WorkflowRun = {
      ...run,
      title: 'This update must roll back',
      updatedAt: '2026-06-15T00:01:00.000Z',
    }
    const invalidArtifact = {
      ...artifact,
      id: 'artifact-invalid-json',
      content: BigInt(1),
    } as unknown as Artifact

    const store = await createLocalStore({ dbPath })
    await store.saveRun(run)

    await expect(
      store.commitWorkflowMutation({
        expectedRun: run,
        run: updatedRun,
        artifacts: [invalidArtifact],
        events: [event],
        testEvidence: [evidence],
      }),
    ).rejects.toThrow()

    expect(await store.getRun(run.id)).toEqual(run)
    expect(await store.listArtifacts(run.id)).toEqual([])
    expect(await store.listEvents(run.id)).toEqual([])
    expect(await store.listTestEvidence(run.id)).toEqual([])
    store.close()
  })

  it('rolls back the whole workflow mutation when Test Evidence sanitization fails', async () => {
    const dbPath = await tempDbPath()
    const updatedRun: WorkflowRun = {
      ...run,
      title: 'This sanitization failure must roll back',
      updatedAt: '2026-06-15T00:01:00.000Z',
    }
    const invalidEvidence = {
      ...evidence,
      cwd: BigInt(1),
    } as unknown as TestEvidence

    const store = await createLocalStore({ dbPath })
    await store.saveRun(run)

    await expect(
      store.commitWorkflowMutation({
        expectedRun: run,
        run: updatedRun,
        artifacts: [artifact],
        events: [event],
        testEvidence: [invalidEvidence],
      }),
    ).rejects.toThrow()

    expect(await store.getRun(run.id)).toEqual(run)
    expect(await store.listArtifacts(run.id)).toEqual([])
    expect(await store.listEvents(run.id)).toEqual([])
    expect(await store.listTestEvidence(run.id)).toEqual([])
    store.close()
  })

  it('rejects a stale workflow mutation without persisting any candidates', async () => {
    const dbPath = await tempDbPath()
    const firstUpdate: WorkflowRun = {
      ...run,
      title: 'First committed update',
      updatedAt: '2026-06-15T00:01:00.000Z',
    }
    const staleUpdate: WorkflowRun = {
      ...run,
      title: 'Stale update',
      updatedAt: '2026-06-15T00:02:00.000Z',
    }
    const store = await createLocalStore({ dbPath })
    await store.saveRun(run)

    await expect(
      store.commitWorkflowMutation({
        expectedRun: run,
        run: firstUpdate,
      }),
    ).resolves.toEqual({ committed: true })
    await expect(
      store.commitWorkflowMutation({
        expectedRun: run,
        run: staleUpdate,
        artifacts: [artifact],
      }),
    ).resolves.toEqual({ committed: false, reason: 'stale_run' })

    expect(await store.getRun(run.id)).toEqual(firstUpdate)
    expect(await store.listArtifacts(run.id)).toEqual([])
    store.close()
  })

  it('persists workflow nodes and edges in relational tables instead of embedding them in run json', async () => {
    const dbPath = await tempDbPath()
    const created = createWorkflowRunFromRequest({
      runId: 'run-relational',
      title: 'Relational workflow nodes',
      request: 'Persist nodes separately from the run envelope.',
      projectId: 'project-1',
      creatorId: 'user-1',
      branchName: 'ai/relational-nodes',
      now: '2026-06-15T00:00:00.000Z',
    })

    const first = await createLocalStore({ dbPath })
    await first.saveRun(created.run)
    first.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const db = new SQL.Database(await readFile(dbPath))
    const embeddedShape = db.exec(`
      select
        json_type(json, '$.nodes') as nodes_json_type,
        json_type(json, '$.edges') as edges_json_type
      from workflow_runs
      where id = 'run-relational'
    `)[0]?.values[0]
    const nodeRows = db.exec(`
      select id, run_id, stage, kind, status, position
      from workflow_nodes
      where run_id = 'run-relational'
      order by position asc
    `)[0]?.values
    const edgeCount = db.exec(`
      select count(*)
      from workflow_edges
      where run_id = 'run-relational'
    `)[0]?.values[0]?.[0]
    db.close()

    expect(embeddedShape).toEqual([null, null])
    expect(nodeRows).toHaveLength(created.run.nodes.length)
    expect(nodeRows?.[0]).toEqual(['run-relational-clarify', 'run-relational', 'clarify', 'agent', 'running', 0])
    expect(edgeCount).toBe(created.run.edges.length)

    const second = await createLocalStore({ dbPath })
    expect(await second.listRuns()).toEqual([created.run])
    second.close()
  })

  it('normalizes stale completed runs that still have a running build node', async () => {
    const dbPath = await tempDbPath()
    const created = createWorkflowRunFromRequest({
      runId: 'run-stale-build',
      title: 'Stale build state',
      request: 'The run should still be shown as building.',
      projectId: 'project-1',
      creatorId: 'user-1',
      branchName: 'ai/stale-build',
      now: '2026-06-15T00:00:00.000Z',
    })
    const staleRun: WorkflowRun = {
      ...created.run,
      status: 'completed',
      currentNodeId: 'run-stale-build-test',
      nodes: created.run.nodes.map((node) => {
        if (node.stage === 'clarify' || node.stage === 'design') return { ...node, status: 'success' as const }
        if (node.id === 'run-stale-build-build') return { ...node, status: 'running' as const }
        if (node.id === 'run-stale-build-test') return { ...node, status: 'success' as const }
        if (node.id === 'run-stale-build-accept') return { ...node, status: 'success' as const }
        return node
      }),
    }

    const store = await createLocalStore({ dbPath })
    await store.saveRun(staleRun)

    const [loaded] = await store.listRuns()
    expect(loaded).toMatchObject({
      status: 'building',
      currentNodeId: 'run-stale-build-build',
    })
    expect(loaded?.nodes.find((node) => node.id === 'run-stale-build-build')?.status).toBe('running')
    expect(loaded?.nodes.find((node) => node.id === 'run-stale-build-test')?.status).toBe('pending')
    expect(loaded?.nodes.find((node) => node.id === 'run-stale-build-pr')?.status).toBe('pending')
    expect(loaded?.nodes.find((node) => node.id === 'run-stale-build-accept')?.status).toBe('pending')
    store.close()
  })

  it('persists local settings and MCP server state across reopen', async () => {
    const dbPath = await tempDbPath()

    const first = await createLocalStore({ dbPath })
    await first.saveSettings({ themePreference: 'dark' })
    await first.saveMcpServers([mcpServer])
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.getSettings()).toEqual({ themePreference: 'dark' })
    expect(await second.listMcpServers()).toEqual([mcpServer])
    expect(await second.loadState()).toMatchObject({
      settings: { themePreference: 'dark' },
      mcpServers: [mcpServer],
    })
    second.close()
  })

  it('persists policy snapshots and Gate override decisions across reopen', async () => {
    const dbPath = await tempDbPath()

    const first = await createLocalStore({ dbPath })
    await first.savePolicySnapshot(policySnapshot)
    await first.saveGateOverride(gateOverride)
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.getPolicySnapshot('project-1')).toEqual(policySnapshot)
    expect(await second.listGateOverrides('run-1')).toEqual([gateOverride])
    second.close()
  })

  it('persists policy remediation retry attempts across reopen', async () => {
    const dbPath = await tempDbPath()

    const first = await createLocalStore({ dbPath })
    await first.saveRetryAttempt(retryAttempt)
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.listRetryAttempts('run-1')).toEqual([retryAttempt])
    expect(await second.loadState()).toMatchObject({
      retryAttempts: [retryAttempt],
    })
    second.close()
  })

  it('persists local agent reviews, traces, and token usage across reopen', async () => {
    const dbPath = await tempDbPath()

    const first = await createLocalStore({ dbPath })
    await first.saveAgentReview(agentReview)
    await first.saveAgentTrace(agentTrace)
    await first.saveAgentTokenUsage(agentTokenUsage)
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.listAgentReviews('run-1')).toEqual([agentReview])
    expect(await second.listAgentTraces('run-1')).toEqual([agentTrace])
    expect(await second.listAgentTokenUsage('run-1')).toEqual([agentTokenUsage])
    expect(await second.loadState()).toMatchObject({
      agentReviews: [agentReview],
      agentTraces: [agentTrace],
      agentTokenUsage: [agentTokenUsage],
    })
    second.close()
  })

  it('persists provider credential metadata separately from encrypted secret', async () => {
    const dbPath = await tempDbPath()
    const metadata = {
      providerId: 'openai-default',
      model: 'gpt-4.1-mini',
      baseUrl: 'https://api.openai.com/v1',
      maskedCredential: 'sk-...cret',
      updatedAt: '2026-06-15T00:03:00.000Z',
    }

    const first = await createLocalStore({ dbPath })
    await first.saveProviderCredential(metadata, 'encrypted-secret-value')
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.listProviderCredentials()).toEqual([metadata])
    expect(await second.getProviderEncryptedSecret('openai-default')).toBe('encrypted-secret-value')
    expect(JSON.stringify(await second.listProviderCredentials())).not.toContain('encrypted-secret-value')
    second.close()
  })

  it('persists desktop pairing metadata separately from the encrypted bearer token', async () => {
    const dbPath = await tempDbPath()

    const first = await createLocalStore({ dbPath })
    await first.saveDesktopPairingCredential(
      desktopPairingCredential,
      'encrypted-desktop-token-value',
    )
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.getDesktopPairingCredential()).toEqual(desktopPairingCredential)
    expect(await second.getDesktopPairingEncryptedToken()).toBe('encrypted-desktop-token-value')
    expect(JSON.stringify(await second.getDesktopPairingCredential())).not.toContain(
      'encrypted-desktop-token-value',
    )
    second.close()
  })

  it('reads desktop pairing metadata and token as one consistent bundle', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })

    await expect(store.getDesktopPairingCredentialBundle()).resolves.toBeNull()
    await store.saveDesktopPairingCredential(desktopPairingCredential, '')
    await expect(store.getDesktopPairingCredentialBundle()).resolves.toBeNull()

    await store.saveDesktopPairingCredential(
      desktopPairingCredential,
      'encrypted-desktop-token-value',
    )
    await expect(store.getDesktopPairingCredentialBundle()).resolves.toEqual({
      credential: desktopPairingCredential,
      encryptedToken: 'encrypted-desktop-token-value',
    })
    store.close()
  })

  it('persists the active local project binding in pairing metadata', async () => {
    const dbPath = await tempDbPath()
    const boundCredential: DesktopPairingCredential = {
      ...desktopPairingCredential,
      localProjectId: 'local-project-1',
    }

    const first = await createLocalStore({ dbPath })
    await first.saveDesktopPairingCredential(boundCredential, 'encrypted-desktop-token-value')
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.getDesktopPairingCredential()).toEqual(boundCredential)
    second.close()
  })

  it('persists coding agent runs, permissions, workspaces, bootstrap evidence, and diffs across reopen', async () => {
    const dbPath = await tempDbPath()

    const first = await createLocalStore({ dbPath })
    await first.saveCodingAgentRun(codingRun)
    await first.saveCodingAgentEvent(codingEvent)
    await first.saveCodingPermissionRequest(permissionRequest)
    await first.saveCodingPermissionDecision(permissionDecision)
    await first.saveManagedCodingWorkspace(workspace)
    await first.saveDependencyBootstrapEvidence(bootstrapEvidence)
    await first.saveCodingDiffArtifact(codingDiff)
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.listCodingAgentRuns('run-1')).toEqual([codingRun])
    expect(await second.listCodingAgentEvents('coding-run-1')).toEqual([codingEvent])
    expect(await second.listCodingPermissionRequests('coding-run-1')).toEqual([permissionRequest])
    expect(await second.listCodingPermissionDecisions('coding-run-1')).toEqual([permissionDecision])
    expect(await second.listManagedCodingWorkspaces('project-1')).toEqual([workspace])
    expect(await second.listDependencyBootstrapEvidence('coding-run-1')).toEqual([bootstrapEvidence])
    expect(await second.listCodingDiffArtifacts('run-1')).toEqual([codingDiff])
    expect(await second.loadState()).toMatchObject({
      codingRuns: [codingRun],
      codingEvents: [codingEvent],
      codingPermissionRequests: [permissionRequest],
      codingPermissionDecisions: [permissionDecision],
      managedCodingWorkspaces: [workspace],
      dependencyBootstrapEvidence: [bootstrapEvidence],
      codingDiffArtifacts: [codingDiff],
    })
    second.close()
  })

  it('compare-and-swaps the delivery commit onto an unchanged active workspace', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const baseCommitSha = '0000000000000000000000000000000000000000'
    const headCommitSha = '1111111111111111111111111111111111111111'
    const activeWorkspace: ManagedCodingWorkspace = {
      ...workspace,
      baseCommitSha,
      cleanupStatus: 'active',
    }
    const committedWorkspace: ManagedCodingWorkspace = {
      ...activeWorkspace,
      headCommitSha,
    }
    await store.saveManagedCodingWorkspace(activeWorkspace)

    await expect(store.commitManagedCodingWorkspaceHead({
      expectedWorkspace: activeWorkspace,
      workspace: committedWorkspace,
    })).resolves.toEqual({
      committed: true,
      replayed: false,
      workspace: committedWorkspace,
    })
    await expect(store.commitManagedCodingWorkspaceHead({
      expectedWorkspace: activeWorkspace,
      workspace: committedWorkspace,
    })).resolves.toEqual({
      committed: true,
      replayed: true,
      workspace: committedWorkspace,
    })

    await store.saveManagedCodingWorkspace({
      ...committedWorkspace,
      cleanupStatus: 'deleted',
      deletedAt: '2026-08-11T13:00:00.000Z',
    })
    await expect(store.commitManagedCodingWorkspaceHead({
      expectedWorkspace: committedWorkspace,
      workspace: committedWorkspace,
    })).resolves.toEqual({ committed: false, reason: 'source_stale' })
    store.close()
  })

  it('does not let an old cleanup snapshot erase a delivery commit head', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const baseCommitSha = '0000000000000000000000000000000000000000'
    const headCommitSha = '1111111111111111111111111111111111111111'
    const initialWorkspace: ManagedCodingWorkspace = {
      ...workspace,
      baseCommitSha,
      cleanupStatus: 'active',
    }
    const committedWorkspace: ManagedCodingWorkspace = {
      ...initialWorkspace,
      headCommitSha,
    }
    await store.saveManagedCodingWorkspace(initialWorkspace)
    await store.commitManagedCodingWorkspaceHead({
      expectedWorkspace: initialWorkspace,
      workspace: committedWorkspace,
    })
    const staleCleanup: ManagedCodingWorkspace = {
      ...initialWorkspace,
      deletedAt: '2026-08-11T13:00:00.000Z',
      cleanupStatus: 'deleted',
    }

    await expect(store.commitManagedCodingWorkspaceCleanup({
      expectedWorkspace: initialWorkspace,
      workspace: staleCleanup,
    })).resolves.toEqual({ committed: false, reason: 'source_stale' })
    expect(await store.listManagedCodingWorkspaces(initialWorkspace.projectId))
      .toEqual([committedWorkspace])

    const currentCleanup: ManagedCodingWorkspace = {
      ...committedWorkspace,
      deletedAt: '2026-08-11T13:00:01.000Z',
      cleanupStatus: 'deleted',
    }
    await expect(store.commitManagedCodingWorkspaceCleanup({
      expectedWorkspace: committedWorkspace,
      workspace: currentCleanup,
    })).resolves.toEqual({
      committed: true,
      replayed: false,
      workspace: currentCleanup,
    })
    expect(await store.listManagedCodingWorkspaces(initialWorkspace.projectId))
      .toEqual([currentCleanup])
    store.close()
  })

  it('persists a budget-unavailable coding run without a managed workspace across reopen', async () => {
    const dbPath = await tempDbPath()
    const unavailableRun: CodingAgentRun = {
      id: 'coding-run-budget-unavailable',
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'paid-coding-engine',
      engine: 'opencode-http',
      status: 'failed',
      branchName: 'devflow/run-1-node-build',
      userInstruction: 'Keep the change minimal.',
      prompt: 'DevFlow assembled prompt stays local.',
      summary: 'Coding run blocked because the authoritative budget decision was unavailable.',
      changedPaths: [],
      startedAt: '2026-06-15T00:03:00.000Z',
      completedAt: '2026-06-15T00:03:00.000Z',
      budgetDecision: {
        status: 'unavailable',
        blocksRun: true,
        currentSpendUsd: 0,
        projectedCostUsd: 0.02,
        reason: 'Authoritative budget decision unavailable.',
      },
      redacted: true,
    }

    const first = await createLocalStore({ dbPath })
    await first.saveCodingAgentRun(unavailableRun)
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.listCodingAgentRuns('run-1')).toEqual([unavailableRun])
    expect(await second.listManagedCodingWorkspaces('project-1')).toEqual([])
    expect(await second.loadState()).toMatchObject({
      codingRuns: [unavailableRun],
      managedCodingWorkspaces: [],
    })
    second.close()
  })

  it('recursively redacts Coding Agent events at the local persistence boundary', async () => {
    const dbPath = await tempDbPath()
    const hostileEvent: CodingAgentEvent = {
      ...codingEvent,
      message:
        'Opened error:/Users/alice/private/report.json with Authorization: Bearer opaque-event-secret',
      metadata: {
        token: 'opaque-structured-event-token',
        Authorization: 'Bearer opaque-structured-event-bearer',
        nested: {
          password: 'opaque-structured-event-password',
          command: 'client --api-key opaque-event-secret',
          files: ['/Users/alice/private/report.json', { route: '/metrics' }],
        },
      },
      redacted: false,
    }

    const store = await createLocalStore({ dbPath })
    await store.saveCodingAgentEvent(hostileEvent)

    const [persisted] = await store.listCodingAgentEvents(hostileEvent.codingRunId)
    expect(JSON.stringify(persisted)).not.toContain('/Users/alice/private')
    expect(JSON.stringify(persisted)).not.toContain('opaque-event-secret')
    expect(JSON.stringify(persisted)).not.toContain('opaque-structured-event-token')
    expect(JSON.stringify(persisted)).not.toContain('opaque-structured-event-bearer')
    expect(JSON.stringify(persisted)).not.toContain('opaque-structured-event-password')
    expect(JSON.stringify(persisted)).toContain('/metrics')
    expect(persisted?.redacted).toBe(true)
    store.close()
  })

  it('permanently redacts legacy Coding Agent event messages and metadata', async () => {
    const dbPath = await tempDbPath()
    const legacyEvent: CodingAgentEvent = {
      ...codingEvent,
      message:
        'Opened error:/Users/alice/private/report.json with Authorization: Bearer opaque-coding-legacy-secret',
      metadata: {
        token: 'opaque-structured-coding-legacy-token',
        Authorization: 'Bearer opaque-structured-coding-legacy-bearer',
        nested: {
          password: 'opaque-structured-coding-legacy-password',
          command: 'client --token opaque-coding-legacy-secret',
          filePath: '/Users/alice/private/report.json',
        },
      },
      redacted: false,
    }

    const initial = await createLocalStore({ dbPath })
    await initial.saveCodingAgentEvent({
      ...legacyEvent,
      message: 'safe placeholder',
      metadata: {},
      redacted: true,
    })
    initial.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const legacyDb = new SQL.Database(await readFile(dbPath))
    legacyDb.run('update coding_agent_events set json = ? where id = ?', [
      JSON.stringify(legacyEvent),
      legacyEvent.id,
    ])
    await writeFile(dbPath, Buffer.from(legacyDb.export()))
    legacyDb.close()

    const migrated = await createLocalStore({ dbPath })
    const [persisted] = await migrated.listCodingAgentEvents(legacyEvent.codingRunId)
    expect(JSON.stringify(persisted)).not.toContain('/Users/alice/private')
    expect(JSON.stringify(persisted)).not.toContain('opaque-coding-legacy-secret')
    expect(JSON.stringify(persisted)).not.toContain('opaque-structured-coding-legacy-token')
    expect(JSON.stringify(persisted)).not.toContain('opaque-structured-coding-legacy-bearer')
    expect(JSON.stringify(persisted)).not.toContain('opaque-structured-coding-legacy-password')
    expect(persisted?.redacted).toBe(true)
    migrated.close()
  })

  it('hard deletes run-scoped records while preserving other runs and project metadata', async () => {
    const dbPath = await tempDbPath()
    const otherRun: WorkflowRun = {
      ...run,
      id: 'run-2',
      title: 'Other run',
      branchName: 'ai/other-run',
      updatedAt: '2026-06-15T00:10:00.000Z',
    }
    const otherArtifact: Artifact = {
      ...artifact,
      id: 'artifact-other',
      runId: 'run-2',
      updatedAt: '2026-06-15T00:10:00.000Z',
    }
    const providerMetadata = {
      providerId: 'provider-delete-run',
      model: 'fake',
      maskedCredential: 'sk-...test',
      updatedAt: '2026-06-15T00:06:00.000Z',
    }

    const store = await createLocalStore({ dbPath })
    await store.upsertProject(project)
    await store.saveRun(run)
    await store.saveRun(otherRun)
    await store.saveArtifact(artifact)
    await store.saveArtifact(otherArtifact)
    await store.saveEvent(event)
    await store.saveTestEvidence(evidence)
    await store.saveAgentReview(agentReview)
    await store.saveAgentTrace(agentTrace)
    await store.saveAgentTokenUsage(agentTokenUsage)
    await store.saveCodingAgentRun(codingRun)
    await store.saveCodingAgentEvent(codingEvent)
    await store.saveCodingPermissionRequest(permissionRequest)
    await store.saveCodingPermissionDecision(permissionDecision)
    await store.saveManagedCodingWorkspace(workspace)
    await store.saveDependencyBootstrapEvidence(bootstrapEvidence)
    await store.saveCodingDiffArtifact(codingDiff)
    await store.saveGateOverride(gateOverride)
    await store.saveRetryAttempt(retryAttempt)
    await store.savePolicySnapshot(policySnapshot)
    await store.saveProviderCredential(providerMetadata, 'encrypted-provider-secret')
    const deletedRunSyncOperation = createRemoteSyncOperation({
      id: 'sync-deleted-run',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: run.id,
      entityId: run.id,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    const preservedRunSyncOperation = createRemoteSyncOperation({
      id: 'sync-preserved-run',
      kind: 'run-summary',
      localProjectId: project.id,
      runId: otherRun.id,
      entityId: otherRun.id,
      createdAt: '2026-08-01T00:01:00.000Z',
    })
    await store.enqueueRemoteSyncOperation(deletedRunSyncOperation)
    await store.enqueueRemoteSyncOperation(preservedRunSyncOperation)

    await store.deleteRun('run-1')

    expect(await store.listRuns()).toEqual([otherRun])
    expect(await store.listArtifacts('run-1')).toEqual([])
    expect(await store.listArtifacts('run-2')).toEqual([{ ...otherArtifact, redacted: true }])
    expect(await store.listEvents('run-1')).toEqual([])
    expect(await store.listTestEvidence('run-1')).toEqual([])
    expect(await store.listAgentReviews('run-1')).toEqual([])
    expect(await store.listAgentTraces('run-1')).toEqual([])
    expect(await store.listAgentTokenUsage('run-1')).toEqual([])
    expect(await store.listCodingAgentRuns('run-1')).toEqual([])
    expect(await store.listCodingAgentEvents('coding-run-1')).toEqual([])
    expect(await store.listCodingPermissionRequests('coding-run-1')).toEqual([])
    expect(await store.listCodingPermissionDecisions('coding-run-1')).toEqual([])
    expect(await store.listManagedCodingWorkspaces('project-1')).toEqual([])
    expect(await store.listDependencyBootstrapEvidence('coding-run-1')).toEqual([])
    expect(await store.listCodingDiffArtifacts('run-1')).toEqual([])
    expect(await store.listGateOverrides('run-1')).toEqual([])
    expect(await store.listRetryAttempts('run-1')).toEqual([])
    expect(await store.listRemoteSyncOperations('run-1')).toEqual([])
    expect(await store.listRemoteSyncOperations('run-2')).toMatchObject([
      { kind: 'run-summary', runId: 'run-2', entityId: 'run-2', status: 'pending' },
    ])
    expect(await store.listProjects()).toEqual([project])
    expect(await store.getPolicySnapshot('project-1')).toEqual(policySnapshot)
    expect(await store.listProviderCredentials()).toEqual([providerMetadata])
    store.close()
  })
})
