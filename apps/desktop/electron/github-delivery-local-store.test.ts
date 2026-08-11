import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import {
  createGitHubDeliveryIntent,
  redactTestEvidenceForStorage,
} from '@ai-devflow/shared'
import type {
  Artifact,
  CodingAgentRun,
  CodingDiffArtifact,
  DesktopPairingCredential,
  GitHubRepositoryBinding,
  ManagedCodingWorkspace,
  TestEvidence,
  WorkflowRun,
} from '@ai-devflow/shared'
import { createLocalStore } from './local-store'

const baseCommitSha = '0000000000000000000000000000000000000000'
const expectedCommitSha = '1111111111111111111111111111111111111111'
let tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })))
  tempDirs = []
})

async function tempDbPath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-delivery-store-'))
  tempDirs.push(directory)
  return path.join(directory, 'devflow.sqlite')
}

function createSources() {
  const pairing: DesktopPairingCredential = {
    tokenId: 'desktop-token-1',
    organizationId: 'org-1',
    projectId: 'team-project-1',
    localProjectId: 'local-project-1',
    userId: 'user-1',
    role: 'lead',
    authAccountId: 'auth-account-1',
    projectMemberships: [
      { projectId: 'team-project-1', userId: 'user-1', role: 'lead' },
    ],
    createdAt: '2026-08-11T09:55:00.000Z',
  }
  const repositoryBinding: GitHubRepositoryBinding = {
    stateVersion: 1,
    id: 'github-binding-1',
    version: 3,
    organizationId: pairing.organizationId,
    teamProjectId: pairing.projectId,
    installationId: '123456',
    repositoryId: '987654321',
    repository: 'erich04/ai-devflow-studio',
    defaultBranch: 'main',
    status: 'active',
    validatedAt: '2026-08-11T09:56:00.000Z',
    updatedAt: '2026-08-11T09:56:00.000Z',
    redacted: true,
  }
  const run: WorkflowRun = {
    id: 'run-delivery-1',
    version: 6,
    title: 'Ship a tested change',
    request: 'Publish the exact managed-worktree commit.',
    projectId: 'local-project-1',
    creatorId: 'user-1',
    status: 'testing',
    currentNodeId: 'run-delivery-1-pr',
    branchName: 'ai/planned-branch-is-not-authoritative',
    createdAt: '2026-08-11T10:00:00.000Z',
    updatedAt: '2026-08-11T10:30:00.000Z',
    nodes: [
      {
        id: 'run-delivery-1-build',
        stage: 'build',
        title: 'Build',
        subtitle: 'Implement',
        kind: 'task',
        status: 'success',
        ownerId: 'user-1',
        requiredRole: 'member',
        retryCount: 0,
        artifactIds: ['diff-delivery-1'],
      },
      {
        id: 'run-delivery-1-pr',
        stage: 'pr',
        title: 'PR',
        subtitle: 'Deliver',
        kind: 'pr',
        status: 'running',
        ownerId: 'user-1',
        requiredRole: 'member',
        retryCount: 0,
        artifactIds: ['artifact-delivery-pr-1'],
      },
    ],
    edges: [],
  }
  const codingRun: CodingAgentRun = {
    id: 'coding-delivery-1',
    runId: run.id,
    nodeId: 'run-delivery-1-build',
    projectId: run.projectId,
    requestedBy: 'user-1',
    providerId: 'fake-coding-engine',
    engine: 'fake',
    status: 'completed',
    managedWorkspaceId: 'workspace-delivery-1',
    branchName: 'devflow/run-delivery-1-build-coding-delivery-1',
    userInstruction: 'Implement the bounded change.',
    prompt: 'redacted',
    summary: 'Completed.',
    changedPaths: ['src/delivery.ts'],
    startedAt: '2026-08-11T10:05:00.000Z',
    completedAt: '2026-08-11T10:20:00.000Z',
    diffArtifactId: 'diff-delivery-1',
    testEvidenceId: 'precommit-test-delivery-1',
    redacted: true,
  }
  const workspace: ManagedCodingWorkspace = {
    id: 'workspace-delivery-1',
    projectId: run.projectId,
    codingRunId: codingRun.id,
    sourcePath: '/private/source/never-persist-in-delivery',
    worktreePath: '/private/worktree/never-persist-in-delivery',
    branchName: codingRun.branchName,
    baseBranch: 'main',
    baseCommitSha,
    headCommitSha: expectedCommitSha,
    createdAt: '2026-08-11T10:04:00.000Z',
    cleanupStatus: 'active',
  }
  const diffArtifact: CodingDiffArtifact = {
    id: 'diff-delivery-1',
    runId: run.id,
    nodeId: codingRun.nodeId,
    projectId: run.projectId,
    changedPaths: ['src/delivery.ts'],
    patch: '+ private local patch',
    truncated: false,
    redacted: true,
    createdAt: '2026-08-11T10:18:00.000Z',
  }
  const testEvidence = redactTestEvidenceForStorage({
    id: 'postcommit-test-delivery-1',
    runId: run.id,
    nodeId: codingRun.nodeId,
    projectId: run.projectId,
    command: 'pnpm test',
    cwd: workspace.worktreePath,
    status: 'passed',
    exitCode: 0,
    durationMs: 100,
    stdout: 'local stdout',
    stderr: '',
    summary: 'Tests passed at the exact managed commit.',
    redacted: true,
    sourceCommitSha: expectedCommitSha,
    createdAt: '2026-08-11T10:22:00.000Z',
  } satisfies TestEvidence)
  const prPackage: Artifact = {
    id: 'artifact-delivery-pr-1',
    runId: run.id,
    nodeId: 'run-delivery-1-pr',
    kind: 'pr',
    title: 'PR Draft: Ship a tested change',
    summary: 'Bounded delivery package.',
    content: '# Ship a tested change\n\nEvidence metadata only.',
    redacted: true,
    updatedAt: '2026-08-11T10:25:00.000Z',
  }
  return { pairing, repositoryBinding, run, codingRun, workspace, diffArtifact, testEvidence, prPackage }
}

async function saveSources(
  store: Awaited<ReturnType<typeof createLocalStore>>,
  sources: ReturnType<typeof createSources>,
): Promise<void> {
  await store.saveDesktopPairingCredential(sources.pairing, 'encrypted-token')
  await store.saveGitHubRepositoryBinding(sources.repositoryBinding)
  await store.saveRun(sources.run)
  await store.saveCodingAgentRun(sources.codingRun)
  await store.saveManagedCodingWorkspace(sources.workspace)
  await store.saveCodingDiffArtifact(sources.diffArtifact)
  await store.saveTestEvidence(sources.testEvidence)
  await store.saveArtifact(sources.prPackage)
}

async function createIntent(sources: ReturnType<typeof createSources>) {
  return createGitHubDeliveryIntent({
    id: 'delivery-intent-1',
    repositoryBinding: sources.repositoryBinding,
    run: sources.run,
    prNodeId: 'run-delivery-1-pr',
    codingRun: sources.codingRun,
    workspace: sources.workspace,
    diffArtifact: sources.diffArtifact,
    prPackage: sources.prPackage,
    testEvidence: sources.testEvidence as TestEvidence & { sourceCommitSha: string },
    baseCommitSha,
    expectedCommitSha,
    now: '2026-08-11T10:31:00.000Z',
  })
}

describe('GitHub Delivery Intent local persistence', () => {
  it('migrates to schema 13 with a metadata-only delivery table', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    expect(await store.getSchemaVersion()).toBe(13)
    store.close()

    const SQL = await initSqlJs()
    const database = new SQL.Database(await readFile(dbPath))
    const columns = database.exec('pragma table_info(github_delivery_intents)')[0]?.values
      .map((row) => String(row[1])) ?? []
    expect(columns).toEqual([
      'id',
      'organization_id',
      'team_project_id',
      'local_project_id',
      'run_id',
      'node_id',
      'repository_binding_id',
      'repository_binding_version',
      'installation_id',
      'repository_id',
      'coding_run_id',
      'workspace_id',
      'diff_artifact_id',
      'test_evidence_id',
      'pr_package_artifact_id',
      'base_commit_sha',
      'expected_commit_sha',
      'intent_digest',
      'idempotency_key',
      'status',
      'state_version',
      'json',
      'created_at',
      'updated_at',
    ])
    expect(columns).not.toEqual(expect.arrayContaining([
      'token', 'secret', 'source_path', 'worktree_path', 'patch', 'stdout', 'stderr',
    ]))
    database.close()
  })

  it('atomically persists, replays, and restores the exact source-bound intent', async () => {
    const dbPath = await tempDbPath()
    const sources = createSources()
    const intent = await createIntent(sources)
    const first = await createLocalStore({ dbPath })
    await saveSources(first, sources)

    const replayIntent = {
      ...intent,
      id: 'delivery-intent-replay',
      createdAt: '2026-08-11T11:00:00.000Z',
      updatedAt: '2026-08-11T11:00:00.000Z',
    }
    const [created, replayed] = await Promise.all([
      first.commitGitHubDeliveryIntent({
        intent,
        expectedPairingCredential: sources.pairing,
        expectedRepositoryBinding: sources.repositoryBinding,
        expectedRun: sources.run,
        expectedCodingRun: sources.codingRun,
        expectedWorkspace: sources.workspace,
        expectedDiffArtifact: sources.diffArtifact,
        expectedTestEvidence: sources.testEvidence,
        expectedPrPackage: sources.prPackage,
      }),
      first.commitGitHubDeliveryIntent({
        intent: replayIntent,
        expectedPairingCredential: sources.pairing,
        expectedRepositoryBinding: sources.repositoryBinding,
        expectedRun: sources.run,
        expectedCodingRun: sources.codingRun,
        expectedWorkspace: sources.workspace,
        expectedDiffArtifact: sources.diffArtifact,
        expectedTestEvidence: sources.testEvidence,
        expectedPrPackage: sources.prPackage,
      }),
    ])
    if (!created.committed || !replayed.committed) {
      throw new Error('Concurrent GitHub Delivery Intent creation must not fail')
    }
    expect([created.replayed, replayed.replayed].sort()).toEqual([false, true])
    expect(created).toMatchObject({ committed: true, intent })
    expect(replayed).toMatchObject({ committed: true, intent })

    await first.saveArtifact({
      ...sources.prPackage,
      summary: 'The source changed after the intent was persisted.',
    })
    await expect(first.commitGitHubDeliveryIntent({
      intent: replayIntent,
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      expectedTestEvidence: sources.testEvidence,
      expectedPrPackage: sources.prPackage,
    })).resolves.toEqual({ committed: true, replayed: true, intent })
    first.close()

    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.listGitHubDeliveryIntents(sources.run.id)).toEqual([intent])
    expect((await reopened.loadState()).githubDeliveryIntents).toEqual([intent])
    await expect(reopened.deleteRun(sources.run.id)).rejects.toThrow(
      'Run is bound to a GitHub Delivery Intent.',
    )
    reopened.close()

    const SQL = await initSqlJs()
    const database = new SQL.Database(await readFile(dbPath))
    const deliveryJson = String(
      database.exec('select json from github_delivery_intents')[0]?.values[0]?.[0],
    )
    expect(deliveryJson).not.toContain(sources.workspace.sourcePath)
    expect(deliveryJson).not.toContain(sources.workspace.worktreePath)
    expect(deliveryJson).not.toContain(sources.diffArtifact.patch)
    expect(deliveryJson).not.toContain('local stdout')
    database.close()
  })

  it('rejects a stale source snapshot without creating a delivery row', async () => {
    const dbPath = await tempDbPath()
    const sources = createSources()
    const intent = await createIntent(sources)
    const store = await createLocalStore({ dbPath })
    await saveSources(store, sources)
    await store.saveArtifact({ ...sources.prPackage, summary: 'Changed after approval input.' })

    await expect(store.commitGitHubDeliveryIntent({
      intent,
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      expectedTestEvidence: sources.testEvidence,
      expectedPrPackage: sources.prPackage,
    })).resolves.toEqual({ committed: false, reason: 'source_stale' })
    expect(await store.listGitHubDeliveryIntents()).toEqual([])
    store.close()
  })

  it('rejects a stale pairing scope and a second active intent for the same PR node', async () => {
    const dbPath = await tempDbPath()
    const sources = createSources()
    const intent = await createIntent(sources)
    const store = await createLocalStore({ dbPath })
    await saveSources(store, sources)
    await store.saveDesktopPairingCredential(
      { ...sources.pairing, projectId: 'other-team-project' },
      'encrypted-other-token',
    )
    await expect(store.commitGitHubDeliveryIntent({
      intent,
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      expectedTestEvidence: sources.testEvidence,
      expectedPrPackage: sources.prPackage,
    })).resolves.toEqual({ committed: false, reason: 'source_stale' })

    await store.saveDesktopPairingCredential(sources.pairing, 'encrypted-token')
    await expect(store.commitGitHubDeliveryIntent({
      intent,
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      expectedTestEvidence: sources.testEvidence,
      expectedPrPackage: sources.prPackage,
    })).resolves.toMatchObject({ committed: true, replayed: false })

    const changedPackage = {
      ...sources.prPackage,
      summary: 'A materially changed package requiring a new approval.',
      updatedAt: '2026-08-11T10:40:00.000Z',
    }
    const changedSources = { ...sources, prPackage: changedPackage }
    await store.saveArtifact(changedPackage)
    const secondIntent = await createGitHubDeliveryIntent({
      id: 'delivery-intent-2',
      repositoryBinding: sources.repositoryBinding,
      run: sources.run,
      prNodeId: 'run-delivery-1-pr',
      codingRun: sources.codingRun,
      workspace: sources.workspace,
      diffArtifact: sources.diffArtifact,
      prPackage: changedPackage,
      testEvidence: sources.testEvidence as TestEvidence & { sourceCommitSha: string },
      baseCommitSha,
      expectedCommitSha,
      now: '2026-08-11T10:41:00.000Z',
    })
    await expect(store.commitGitHubDeliveryIntent({
      intent: secondIntent,
      expectedPairingCredential: changedSources.pairing,
      expectedRepositoryBinding: changedSources.repositoryBinding,
      expectedRun: changedSources.run,
      expectedCodingRun: changedSources.codingRun,
      expectedWorkspace: changedSources.workspace,
      expectedDiffArtifact: changedSources.diffArtifact,
      expectedTestEvidence: changedSources.testEvidence,
      expectedPrPackage: changedSources.prPackage,
    })).resolves.toEqual({ committed: false, reason: 'active_intent_exists' })
    store.close()
  })
})
