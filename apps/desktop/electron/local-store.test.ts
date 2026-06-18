import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import {
  createWarnOnlyDefaultPolicy,
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
  it('initializes schema version 6 and keeps it stable across reopen', async () => {
    const dbPath = await tempDbPath()

    const first = await createLocalStore({ dbPath })
    expect(await first.getSchemaVersion()).toBe(6)
    first.close()

    const second = await createLocalStore({ dbPath })
    expect(await second.getSchemaVersion()).toBe(6)
    second.close()
  })

  it('migrates an existing v1 database to v6 without losing local projects or runs', async () => {
    const dbPath = await tempDbPath()
    await writeLegacyV1Database(dbPath)

    const store = await createLocalStore({ dbPath })

    expect(await store.getSchemaVersion()).toBe(6)
    expect(await store.listProjects()).toEqual([project])
    expect(await store.listRuns()).toEqual([run])
    expect(await store.getSettings()).toEqual({ themePreference: 'system' })
    expect(await store.listMcpServers()).toEqual([])
    store.close()
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
    expect(await second.listArtifacts('run-1')).toEqual([artifact])
    expect(await second.listEvents('run-1')).toEqual([event])
    expect(await second.listTestEvidence('run-1')).toEqual([evidence])
    second.close()
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
})
