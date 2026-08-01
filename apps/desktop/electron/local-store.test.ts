import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import {
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  createRemoteSyncOperation,
  createWorkflowRunFromRequest,
  createWarnOnlyDefaultPolicy,
  redactTestEvidenceForStorage,
  resolveEffectivePolicy,
} from '@ai-devflow/shared'
import type {
  AgentEvent,
  AgentReviewResult,
  AgentTrace,
  AgentTokenUsage,
  Artifact,
  CodingAgentEvent,
  CodingAgentRun,
  CodingDiffArtifact,
  CodingPermissionDecision,
  CodingPermissionRequest,
  DependencyBootstrapEvidence,
  DesktopPairingCredential,
  GateAdvisory,
  LocalProject,
  McpServerDefinition,
  ManagedCodingWorkspace,
  RetryAttempt,
  TestEvidence,
  WorkflowRun,
} from '@ai-devflow/shared'
import {
  createLocalStore,
  type SettleRemoteSyncOperationInput,
} from './local-store'

let tempDirs: string[] = []

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

describe('createLocalStore', () => {
  it('initializes schema version 9 and keeps it stable across reopen', async () => {
    const dbPath = await tempDbPath()

    const first = await createLocalStore({ dbPath })
    expect(await first.getSchemaVersion()).toBe(9)
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.getSchemaVersion()).toBe(9)
    second.close()
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
    ).rejects.toThrow(/EISDIR|directory/i)
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
    })).rejects.toThrow(/EISDIR|directory/i)
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

    await expect(store.saveRun(run)).rejects.toThrow(/EISDIR|directory/i)
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

  it('migrates an existing v1 database to v9 without losing local projects or runs', async () => {
    const dbPath = await tempDbPath()
    await writeLegacyV1Database(dbPath)

    const store = await createLocalStore({ dbPath })

    expect(await store.getSchemaVersion()).toBe(9)
    expect(await store.listProjects()).toEqual([project])
    expect(await store.listRuns()).toEqual([run])
    expect(await store.getSettings()).toEqual({ themePreference: 'system' })
    expect(await store.listMcpServers()).toEqual([])
    store.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const db = new SQL.Database(await readFile(dbPath))
    expect(db.exec("select value from schema_meta where key = 'schema_version'")[0]?.values[0]?.[0]).toBe('9')
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
      drop index idx_remote_sync_outbox_due;
      drop table remote_sync_outbox;
      update schema_meta set value = '8' where key = 'schema_version';
    `)
    await writeFile(dbPath, Buffer.from(v8Db.export()))
    v8Db.close()

    const migrated = await createLocalStore({ dbPath })
    expect(await migrated.getSchemaVersion()).toBe(9)
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
    newerDb.run("update schema_meta set value = '10' where key = 'schema_version'")
    await writeFile(dbPath, Buffer.from(newerDb.export()))
    newerDb.close()

    await expect(createLocalStore({ dbPath })).rejects.toThrow(
      /schema version 10 is newer than supported version 9/,
    )

    const unchangedDb = new SQL.Database(await readFile(dbPath))
    expect(
      unchangedDb.exec("select value from schema_meta where key = 'schema_version'")[0]
        ?.values[0]?.[0],
    ).toBe('10')
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
    expect(await migrated.getSchemaVersion()).toBe(9)
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
