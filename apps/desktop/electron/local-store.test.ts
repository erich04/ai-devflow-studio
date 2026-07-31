import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import {
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
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
import { createLocalStore } from './local-store'

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
  db.run(
    'insert into workflow_runs (id, json, created_at, updated_at) values (?, ?, ?, ?)',
    [run.id, JSON.stringify(run), run.createdAt, run.updatedAt],
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
  it('initializes schema version 8 and keeps it stable across reopen', async () => {
    const dbPath = await tempDbPath()

    const first = await createLocalStore({ dbPath })
    expect(await first.getSchemaVersion()).toBe(8)
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.getSchemaVersion()).toBe(8)
    second.close()
  })

  it('migrates an existing v1 database to v8 without losing local projects or runs', async () => {
    const dbPath = await tempDbPath()
    await writeLegacyV1Database(dbPath)

    const store = await createLocalStore({ dbPath })

    expect(await store.getSchemaVersion()).toBe(8)
    expect(await store.listProjects()).toEqual([project])
    expect(await store.listRuns()).toEqual([run])
    expect(await store.getSettings()).toEqual({ themePreference: 'system' })
    expect(await store.listMcpServers()).toEqual([])
    store.close()

    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const db = new SQL.Database(await readFile(dbPath))
    expect(db.exec("select value from schema_meta where key = 'schema_version'")[0]?.values[0]?.[0]).toBe('8')
    expect(db.exec("select name from sqlite_master where type = 'table' and name = 'workflow_nodes'")[0]?.values[0]?.[0]).toBe('workflow_nodes')
    db.close()
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
    expect(await store.listProjects()).toEqual([project])
    expect(await store.getPolicySnapshot('project-1')).toEqual(policySnapshot)
    expect(await store.listProviderCredentials()).toEqual([providerMetadata])
    store.close()
  })
})
