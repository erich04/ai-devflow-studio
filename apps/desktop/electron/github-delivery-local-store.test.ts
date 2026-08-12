import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import {
  createGitHubDeliveryCompletion,
  createGitHubDeliveryIntent,
  redactTestEvidenceForStorage,
} from '@ai-devflow/shared'
import type {
  Artifact,
  CodingAgentRun,
  CodingDiffArtifact,
  DesktopPairingCredential,
  GitHubDeliveryRevocationCheck,
  GitHubRepositoryBinding,
  LocalProject,
  ManagedCodingWorkspace,
  TestEvidence,
  WorkflowRun,
} from '@ai-devflow/shared'
import { createLocalStore } from './local-store'

const baseCommitSha = '0000000000000000000000000000000000000000'
const expectedCommitSha = '1111111111111111111111111111111111111111'
let tempDirs: string[] = []
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
  const project: LocalProject = {
    id: 'local-project-1',
    name: 'Delivery fixture',
    path: '/private/source/never-persist-in-delivery',
    packageManager: 'pnpm',
    testCommand: 'corepack pnpm test',
    createdAt: '2026-08-11T09:50:00.000Z',
    updatedAt: '2026-08-11T09:50:00.000Z',
  }
  const pairing: DesktopPairingCredential = {
    tokenId: 'desktop-token-1',
    organizationId: 'org-1',
    projectId: 'team-project-1',
    localProjectId: project.id,
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
    sourceDigest: '2222222222222222222222222222222222222222222222222222222222222222',
    truncated: false,
    redacted: true,
    createdAt: '2026-08-11T10:18:00.000Z',
  }
  const testEvidence = redactTestEvidenceForStorage({
    id: 'postcommit-test-delivery-1',
    runId: run.id,
    nodeId: codingRun.nodeId,
    projectId: run.projectId,
    command: 'corepack pnpm test',
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
    githubDeliverySource: {
      stateVersion: 1,
      codingRunId: codingRun.id,
      workspaceId: workspace.id,
      diffArtifactId: diffArtifact.id,
      diffSourceDigest: diffArtifact.sourceDigest!,
      testEvidenceId: codingRun.testEvidenceId!,
      headBranch: workspace.branchName,
    },
  }
  return { project, pairing, repositoryBinding, run, codingRun, workspace, diffArtifact, testEvidence, prPackage }
}

async function saveSources(
  store: Awaited<ReturnType<typeof createLocalStore>>,
  sources: ReturnType<typeof createSources>,
): Promise<void> {
  await store.upsertProject(sources.project)
  await store.saveDesktopPairingCredential(sources.pairing, 'encrypted-token')
  await store.saveGitHubRepositoryBinding(sources.repositoryBinding)
  await store.saveRun(sources.run)
  await store.saveCodingAgentRun(sources.codingRun)
  await store.saveManagedCodingWorkspace(sources.workspace)
  await store.saveCodingDiffArtifact(sources.diffArtifact)
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

async function savePreparedIntent(
  store: Awaited<ReturnType<typeof createLocalStore>>,
  sources: ReturnType<typeof createSources>,
) {
  const intent = await createIntent(sources)
  const result = await store.commitGitHubDeliveryPreparation({
    intent,
    expectedProject: sources.project,
    expectedPairingCredential: sources.pairing,
    expectedRepositoryBinding: sources.repositoryBinding,
    expectedRun: sources.run,
    expectedCodingRun: sources.codingRun,
    expectedWorkspace: sources.workspace,
    expectedDiffArtifact: sources.diffArtifact,
    testEvidence: sources.testEvidence,
    expectedPrPackage: sources.prPackage,
  })
  expect(result).toMatchObject({ committed: true })
  return intent
}

async function saveCompletedIntent(
  store: Awaited<ReturnType<typeof createLocalStore>>,
  sources: ReturnType<typeof createSources>,
) {
  const intent = await savePreparedIntent(store, sources)
  const approved = {
    ...intent,
    status: 'approved' as const,
    updatedAt: '2026-08-11T10:32:00.000Z',
  }
  const publishing = {
    ...approved,
    status: 'publishing_branch' as const,
    updatedAt: '2026-08-11T10:33:00.000Z',
  }
  const published = {
    ...publishing,
    status: 'branch_published' as const,
    updatedAt: '2026-08-11T10:34:00.000Z',
  }
  const creating = {
    ...published,
    status: 'creating_pr' as const,
    updatedAt: '2026-08-11T10:35:00.000Z',
  }
  await store.commitGitHubDeliveryIntentStatus({ expectedIntent: intent, intent: approved })
  await store.commitGitHubDeliveryIntentStatus({ expectedIntent: approved, intent: publishing })
  await store.commitGitHubDeliveryIntentStatus({ expectedIntent: publishing, intent: published })
  await store.commitGitHubDeliveryIntentStatus({ expectedIntent: published, intent: creating })
  const completion = createGitHubDeliveryCompletion({
    intent: creating,
    remoteRequestId: 'remote-delivery-1',
    publicationId: 'publication-1',
    pullRequestOutcomeId: 'pull-request-outcome-1',
    pullRequestId: '123456789',
    pullRequestNumber: 42,
    pullRequestUrl: 'https://github.com/erich04/ai-devflow-studio/pull/42',
    repository: creating.repository,
    baseBranch: creating.baseBranch,
    headBranch: creating.headBranch,
    headSha: creating.expectedCommitSha,
    draft: true,
    providerCreatedAt: '2026-08-11T10:35:30.000Z',
    recordedAt: '2026-08-11T10:36:00.000Z',
  })
  const completed = {
    ...creating,
    status: 'completed' as const,
    completion,
    updatedAt: completion.recordedAt,
  }
  await store.commitGitHubDeliveryIntentCompletion({
    expectedIntent: creating,
    intent: completed,
  })
  return completed
}

describe('GitHub repository binding observation CAS', () => {
  it('persists the first observation and replays only identical state', async () => {
    const dbPath = await tempDbPath()
    const sources = createSources()
    const store = await createLocalStore({ dbPath })
    await store.saveDesktopPairingCredential(sources.pairing, 'encrypted-token')

    await expect(
      store.commitGitHubRepositoryBindingObservation({
        expectedPairing: sources.pairing,
        binding: sources.repositoryBinding,
      }),
    ).resolves.toEqual({
      committed: true,
      replayed: false,
      binding: sources.repositoryBinding,
    })
    await expect(
      store.commitGitHubRepositoryBindingObservation({
        expectedPairing: sources.pairing,
        binding: sources.repositoryBinding,
      }),
    ).resolves.toEqual({
      committed: true,
      replayed: true,
      binding: sources.repositoryBinding,
    })
    store.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(
      reopened.getGitHubRepositoryBinding(sources.pairing.projectId),
    ).resolves.toEqual(sources.repositoryBinding)
    reopened.close()
  })

  it('accepts a same-ID higher version including revoked state', async () => {
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    const sources = createSources()
    await store.saveDesktopPairingCredential(sources.pairing, 'encrypted-token')
    await store.commitGitHubRepositoryBindingObservation({
      expectedPairing: sources.pairing,
      binding: sources.repositoryBinding,
    })
    const revoked: GitHubRepositoryBinding = {
      ...sources.repositoryBinding,
      version: sources.repositoryBinding.version + 1,
      status: 'revoked',
      updatedAt: '2026-08-11T10:00:00.000Z',
    }

    await expect(
      store.commitGitHubRepositoryBindingObservation({
        expectedPairing: sources.pairing,
        binding: revoked,
      }),
    ).resolves.toEqual({ committed: true, replayed: false, binding: revoked })
    await expect(
      store.getGitHubRepositoryBinding(sources.pairing.projectId),
    ).resolves.toEqual(revoked)
    store.close()
  })

  it.each([
    [
      'lower version',
      (binding: GitHubRepositoryBinding) => ({
        ...binding,
        version: binding.version - 1,
      }),
    ],
    [
      'same-version changed content',
      (binding: GitHubRepositoryBinding) => ({
        ...binding,
        defaultBranch: 'develop',
      }),
    ],
    [
      'different binding ID',
      (binding: GitHubRepositoryBinding) => ({
        ...binding,
        id: 'github-binding-other',
      }),
    ],
  ])(
    'rejects conflicting %s observations without changing cached authority',
    async (_label, change) => {
      const store = await createLocalStore({ dbPath: await tempDbPath() })
      const sources = createSources()
      await store.saveDesktopPairingCredential(
        sources.pairing,
        'encrypted-token',
      )
      await store.commitGitHubRepositoryBindingObservation({
        expectedPairing: sources.pairing,
        binding: sources.repositoryBinding,
      })

      await expect(
        store.commitGitHubRepositoryBindingObservation({
          expectedPairing: sources.pairing,
          binding: change(sources.repositoryBinding),
        }),
      ).resolves.toEqual({ committed: false, reason: 'binding_conflict' })
      await expect(
        store.getGitHubRepositoryBinding(sources.pairing.projectId),
      ).resolves.toEqual(sources.repositoryBinding)
      store.close()
    },
  )

  it('clears the exact Project cache on a null observation and replays an empty cache', async () => {
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    const sources = createSources()
    await store.saveDesktopPairingCredential(sources.pairing, 'encrypted-token')
    await store.commitGitHubRepositoryBindingObservation({
      expectedPairing: sources.pairing,
      binding: sources.repositoryBinding,
    })

    await expect(
      store.commitGitHubRepositoryBindingObservation({
        expectedPairing: sources.pairing,
        binding: null,
      }),
    ).resolves.toEqual({ committed: true, replayed: false, binding: null })
    await expect(
      store.getGitHubRepositoryBinding(sources.pairing.projectId),
    ).resolves.toBeNull()
    await expect(
      store.commitGitHubRepositoryBindingObservation({
        expectedPairing: sources.pairing,
        binding: null,
      }),
    ).resolves.toEqual({ committed: true, replayed: true, binding: null })
    store.close()
  })

  it('rejects a fetch-to-commit pairing race and preserves the prior cache', async () => {
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    const sources = createSources()
    await store.saveDesktopPairingCredential(sources.pairing, 'encrypted-token')
    await store.saveGitHubRepositoryBinding(sources.repositoryBinding)
    await store.saveDesktopPairingCredential(
      { ...sources.pairing, tokenId: 'desktop-token-rotated' },
      'rotated-encrypted-token',
    )

    await expect(
      store.commitGitHubRepositoryBindingObservation({
        expectedPairing: sources.pairing,
        binding: {
          ...sources.repositoryBinding,
          version: sources.repositoryBinding.version + 1,
          updatedAt: '2026-08-11T10:00:00.000Z',
        },
      }),
    ).resolves.toEqual({ committed: false, reason: 'pairing_scope_mismatch' })
    await expect(
      store.getGitHubRepositoryBinding(sources.pairing.projectId),
    ).resolves.toEqual(sources.repositoryBinding)
    store.close()
  })

  it.each([
    [
      'secret field',
      { ...createSources().repositoryBinding, token: 'ghs_secret' },
    ],
    [
      'local path field',
      { ...createSources().repositoryBinding, path: '/private/repo' },
    ],
    [
      'malformed repository',
      { ...createSources().repositoryBinding, repository: 'Example/Project' },
    ],
  ])(
    'rejects a %s before it can reach local persistence',
    async (_label, binding) => {
      const store = await createLocalStore({ dbPath: await tempDbPath() })
      const sources = createSources()
      await store.saveDesktopPairingCredential(
        sources.pairing,
        'encrypted-token',
      )

      await expect(
        store.commitGitHubRepositoryBindingObservation({
          expectedPairing: sources.pairing,
          binding: binding as GitHubRepositoryBinding,
        }),
      ).resolves.toEqual({ committed: false, reason: 'invalid_input' })
      await expect(
        store.getGitHubRepositoryBinding(sources.pairing.projectId),
      ).resolves.toBeNull()
      store.close()
    },
  )

  it.each([
    [
      'revoked binding',
      (source: GitHubRepositoryBinding) => ({
        ...source,
        version: source.version + 1,
        status: 'revoked' as const,
        updatedAt: '2026-08-11T10:00:00.000Z',
      }),
    ],
    [
      'active binding update',
      (source: GitHubRepositoryBinding) => ({
        ...source,
        version: source.version + 1,
        updatedAt: '2026-08-11T10:00:00.000Z',
      }),
    ],
    ['null binding', () => null],
  ])(
    'atomically terminalizes a cold-start nonterminal intent after %s',
    async (_label, observe) => {
      const dbPath = await tempDbPath()
      const sources = createSources()
      const first = await createLocalStore({ dbPath })
      await saveSources(first, sources)
      const intent = await savePreparedIntent(first, sources)
      first.close()

      const reopened = await createLocalStore({ dbPath })
      const observation = observe(sources.repositoryBinding)
      await expect(
        reopened.commitGitHubRepositoryBindingObservation({
          expectedPairing: sources.pairing,
          binding: observation,
        }),
      ).resolves.toMatchObject({ committed: true, binding: observation })
      const [terminalized] = await reopened.listGitHubDeliveryIntents()
      expect(terminalized).toMatchObject({
        id: intent.id,
        status: 'revoked',
      })
      expect(Date.parse(terminalized!.updatedAt)).toBeGreaterThan(
        Date.parse(intent.updatedAt),
      )
      reopened.close()
    },
  )

  it('keeps a nonterminal intent automatic when the active authority still matches', async () => {
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    const sources = createSources()
    await saveSources(store, sources)
    const intent = await savePreparedIntent(store, sources)

    await expect(
      store.commitGitHubRepositoryBindingObservation({
        expectedPairing: sources.pairing,
        binding: sources.repositoryBinding,
      }),
    ).resolves.toEqual({
      committed: true,
      replayed: true,
      binding: sources.repositoryBinding,
    })
    await expect(store.listGitHubDeliveryIntents()).resolves.toEqual([intent])
    store.close()
  })

  it('atomically revokes the prior pairing authority before replacing the default credential', async () => {
    const dbPath = await tempDbPath()
    const sources = createSources()
    const store = await createLocalStore({ dbPath })
    await saveSources(store, sources)
    const intent = await savePreparedIntent(store, sources)
    const replacement: DesktopPairingCredential = {
      ...sources.pairing,
      tokenId: 'desktop-token-2',
      organizationId: 'org-2',
      projectId: 'team-project-2',
      userId: 'user-2',
      authAccountId: 'auth-account-2',
      projectMemberships: [
        { projectId: 'team-project-2', userId: 'user-2', role: 'lead' },
      ],
      createdAt: '2026-08-11T11:00:00.000Z',
    }

    await store.saveDesktopPairingCredential(
      replacement,
      'replacement-encrypted-token',
    )

    await expect(store.getDesktopPairingCredential()).resolves.toEqual(replacement)
    const [terminalized] = await store.listGitHubDeliveryIntents(intent.runId)
    expect(terminalized).toMatchObject({ id: intent.id, status: 'revoked' })
    expect(Date.parse(terminalized!.updatedAt)).toBeGreaterThan(
      Date.parse(intent.updatedAt),
    )
    store.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(reopened.getDesktopPairingCredential()).resolves.toEqual(replacement)
    await expect(reopened.listGitHubDeliveryIntents(intent.runId)).resolves.toEqual([
      terminalized,
    ])
    reopened.close()
  })

  it('restores the prior pairing and nonterminal intent when replacement persistence fails', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const sources = createSources()
    await saveSources(store, sources)
    const intent = await savePreparedIntent(store, sources)
    const replacement: DesktopPairingCredential = {
      ...sources.pairing,
      tokenId: 'desktop-token-replacement',
      createdAt: '2026-08-11T11:00:00.000Z',
    }
    await rename(dbPath, `${dbPath}.backup`)
    await mkdir(dbPath)

    await expect(
      store.saveDesktopPairingCredential(
        replacement,
        'replacement-encrypted-token',
      ),
    ).rejects.toThrow()
    await expect(store.getDesktopPairingCredential()).resolves.toEqual(
      sources.pairing,
    )
    await expect(store.listGitHubDeliveryIntents(intent.runId)).resolves.toEqual([
      intent,
    ])
    store.close()
  })
})

describe('GitHub Delivery Intent local persistence', () => {
  it('discards schema 16 revocation checks and writes only proof state version 2', async () => {
    const dbPath = await tempDbPath()
    const sources = createSources()
    const store = await createLocalStore({ dbPath })
    await saveSources(store, sources)
    const completed = await saveCompletedIntent(store, sources)
    const revokedBinding: GitHubRepositoryBinding = {
      ...sources.repositoryBinding,
      version: sources.repositoryBinding.version + 1,
      status: 'revoked',
      updatedAt: '2026-08-11T10:37:00.000Z',
    }
    await store.saveGitHubRepositoryBinding(revokedBinding)
    store.close()

    const staleV1Check = {
      stateVersion: 1,
      intentId: completed.id,
      intentUpdatedAt: completed.updatedAt,
      bindingId: revokedBinding.id,
      bindingVersion: revokedBinding.version,
      outcomeCode: 'binding_inactive',
      checkedAt: '2026-08-11T10:38:00.000Z',
      redacted: true,
    } as const
    const SQL = await initSqlJs()
    const database = new SQL.Database(await readFile(dbPath))
    database.run(`
      ${dropAgentRuntimeSchemaSql}
      drop table github_delivery_revocation_checks;
      create table github_delivery_revocation_checks (
        intent_id text primary key,
        intent_updated_at text not null,
        binding_id text not null,
        binding_version integer not null,
        outcome_code text not null,
        checked_at text not null,
        state_version integer not null,
        json text not null,
        check (outcome_code = 'binding_inactive'),
        check (state_version = 1),
        check (json_valid(json)),
        check (json_extract(json, '$.stateVersion') = state_version)
      );
      update schema_meta set value = '16' where key = 'schema_version';
    `)
    database.run(
      `insert into github_delivery_revocation_checks (
        intent_id, intent_updated_at, binding_id, binding_version,
        outcome_code, checked_at, state_version, json
      ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        staleV1Check.intentId,
        staleV1Check.intentUpdatedAt,
        staleV1Check.bindingId,
        staleV1Check.bindingVersion,
        staleV1Check.outcomeCode,
        staleV1Check.checkedAt,
        staleV1Check.stateVersion,
        JSON.stringify(staleV1Check),
      ],
    )
    await writeFile(dbPath, database.export())
    database.close()

    const migrated = await createLocalStore({ dbPath })
    await expect(migrated.getSchemaVersion()).resolves.toBe(20)
    await expect(migrated.listGitHubDeliveryRevocationChecks()).resolves.toEqual([])

    const v2Check: GitHubDeliveryRevocationCheck = {
      ...staleV1Check,
      stateVersion: 2,
    }
    await expect(
      migrated.commitGitHubDeliveryRevocationCheck({
        check: v2Check,
        expectedIntent: completed,
        expectedBinding: revokedBinding,
        expectedPairing: sources.pairing,
      }),
    ).resolves.toEqual({ committed: true, replayed: false, check: v2Check })
    await expect(migrated.listGitHubDeliveryRevocationChecks()).resolves.toEqual([
      v2Check,
    ])
    migrated.close()

    const verified = new SQL.Database(await readFile(dbPath))
    const migratedTableSql = String(
      verified.exec(
        "select sql from sqlite_master where type = 'table' and name = 'github_delivery_revocation_checks'",
      )[0]?.values[0]?.[0],
    )
    expect(migratedTableSql).toMatch(/check \(state_version = 2\)/u)
    verified.close()
  })

  it('keeps schema 17 revocation checks isolated after migrating through schema 20', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    expect(await store.getSchemaVersion()).toBe(20)
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
      'delivery_series_key',
      'delivery_attempt',
      'status',
      'state_version',
      'json',
      'created_at',
      'updated_at',
    ])
    expect(columns).not.toEqual(expect.arrayContaining([
      'token', 'secret', 'source_path', 'worktree_path', 'patch', 'stdout', 'stderr',
    ]))
    const intentIndexes = database.exec('pragma index_list(github_delivery_intents)')[0]
      ?.values.map((row) => ({ name: String(row[1]), unique: Number(row[2]) })) ?? []
    expect(intentIndexes).toEqual(expect.arrayContaining([
      { name: 'idx_github_delivery_intents_idempotency', unique: 0 },
      { name: 'idx_github_delivery_intents_active_scope', unique: 1 },
    ]))
    const outcomeColumns = database
      .exec('pragma table_info(github_delivery_operator_outcomes)')[0]
      ?.values.map((row) => String(row[1])) ?? []
    expect(outcomeColumns).toEqual([
      'intent_id',
      'intent_updated_at',
      'outcome_code',
      'state_version',
      'json',
      'recorded_at',
    ])
    expect(outcomeColumns).not.toEqual(expect.arrayContaining([
      'token', 'secret', 'path', 'message', 'error', 'cause',
    ]))
    const revocationCheckColumns = database
      .exec('pragma table_info(github_delivery_revocation_checks)')[0]
      ?.values.map((row) => String(row[1])) ?? []
    expect(revocationCheckColumns).toEqual([
      'intent_id',
      'intent_updated_at',
      'binding_id',
      'binding_version',
      'outcome_code',
      'checked_at',
      'state_version',
      'json',
    ])
    expect(revocationCheckColumns).not.toEqual(expect.arrayContaining([
      'request_id', 'repository', 'token', 'secret', 'path', 'message', 'error', 'cause',
    ]))
    database.close()
  })

  it('durably records one exact completed-intent revocation check in the safe state projection', async () => {
    const dbPath = await tempDbPath()
    const sources = createSources()
    const store = await createLocalStore({ dbPath })
    await saveSources(store, sources)
    const completed = await saveCompletedIntent(store, sources)
    const revokedBinding: GitHubRepositoryBinding = {
      ...sources.repositoryBinding,
      version: sources.repositoryBinding.version + 1,
      status: 'revoked',
      updatedAt: '2026-08-11T10:37:00.000Z',
    }
    await store.saveGitHubRepositoryBinding(revokedBinding)
    const check: GitHubDeliveryRevocationCheck = {
      stateVersion: 2,
      intentId: completed.id,
      intentUpdatedAt: completed.updatedAt,
      bindingId: revokedBinding.id,
      bindingVersion: revokedBinding.version,
      outcomeCode: 'binding_inactive',
      checkedAt: '2026-08-11T10:38:00.000Z',
      redacted: true,
    }

    await expect(store.commitGitHubDeliveryRevocationCheck({
      check,
      expectedIntent: completed,
      expectedBinding: revokedBinding,
      expectedPairing: sources.pairing,
    })).resolves.toEqual({ committed: true, replayed: false, check })
    await expect(store.commitGitHubDeliveryRevocationCheck({
      check,
      expectedIntent: completed,
      expectedBinding: revokedBinding,
      expectedPairing: sources.pairing,
    })).resolves.toEqual({ committed: true, replayed: true, check })
    await expect(store.listGitHubDeliveryRevocationChecks()).resolves.toEqual([check])
    await expect(store.loadState()).resolves.toMatchObject({
      githubDeliveryRevocationChecks: [check],
    })
    store.close()

    const SQL = await initSqlJs()
    const database = new SQL.Database(await readFile(dbPath))
    const persistedJson = String(
      database.exec('select json from github_delivery_revocation_checks')[0]
        ?.values[0]?.[0],
    )
    expect(persistedJson).toBe(JSON.stringify(check))
    expect(persistedJson).not.toMatch(
      /requestId|repository|token|secret|bearer|credential|raw|path|\/Users\//i,
    )
    database.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(reopened.listGitHubDeliveryRevocationChecks(completed.id))
      .resolves.toEqual([check])
    await expect(reopened.loadState()).resolves.toMatchObject({
      githubDeliveryRevocationChecks: [check],
    })
    expect(JSON.stringify(check)).not.toMatch(
      /requestId|repository|token|secret|bearer|credential|raw|path|\/Users\//i,
    )
    reopened.close()
  })

  it('fails closed when revoked repository authority differs from the completed intent', async () => {
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    const sources = createSources()
    await saveSources(store, sources)
    const completed = await saveCompletedIntent(store, sources)
    const unrelatedBinding: GitHubRepositoryBinding = {
      ...sources.repositoryBinding,
      version: sources.repositoryBinding.version + 1,
      repositoryId: '111111111',
      repository: 'erich04/unrelated-private-sandbox',
      status: 'revoked',
      updatedAt: '2026-08-11T10:37:00.000Z',
    }
    await store.saveGitHubRepositoryBinding(unrelatedBinding)
    const check: GitHubDeliveryRevocationCheck = {
      stateVersion: 2,
      intentId: completed.id,
      intentUpdatedAt: completed.updatedAt,
      bindingId: unrelatedBinding.id,
      bindingVersion: unrelatedBinding.version,
      outcomeCode: 'binding_inactive',
      checkedAt: '2026-08-11T10:38:00.000Z',
      redacted: true,
    }

    await expect(store.commitGitHubDeliveryRevocationCheck({
      check,
      expectedIntent: completed,
      expectedBinding: unrelatedBinding,
      expectedPairing: sources.pairing,
    })).resolves.toEqual({ committed: false, reason: 'authority_mismatch' })
    await expect(store.listGitHubDeliveryRevocationChecks()).resolves.toEqual([])
    store.close()
  })

  it('never persists a non-binding-inactive probe result as pass evidence', async () => {
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    const sources = createSources()
    await saveSources(store, sources)
    const completed = await saveCompletedIntent(store, sources)
    const revokedBinding: GitHubRepositoryBinding = {
      ...sources.repositoryBinding,
      version: sources.repositoryBinding.version + 1,
      status: 'revoked',
      updatedAt: '2026-08-11T10:37:00.000Z',
    }
    await store.saveGitHubRepositoryBinding(revokedBinding)
    const unexpectedGrant = {
      stateVersion: 2 as const,
      intentId: completed.id,
      intentUpdatedAt: completed.updatedAt,
      bindingId: revokedBinding.id,
      bindingVersion: revokedBinding.version,
      outcomeCode: 'grant_finalized',
      checkedAt: '2026-08-11T10:38:00.000Z',
      redacted: true as const,
    } as unknown as GitHubDeliveryRevocationCheck

    await expect(store.commitGitHubDeliveryRevocationCheck({
      check: unexpectedGrant,
      expectedIntent: completed,
      expectedBinding: revokedBinding,
      expectedPairing: sources.pairing,
    })).resolves.toEqual({ committed: false, reason: 'invalid_input' })
    await expect(store.listGitHubDeliveryRevocationChecks()).resolves.toEqual([])
    store.close()
  })

  it('rejects a probe-to-commit pairing race without creating evidence', async () => {
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    const sources = createSources()
    await saveSources(store, sources)
    const completed = await saveCompletedIntent(store, sources)
    const revokedBinding: GitHubRepositoryBinding = {
      ...sources.repositoryBinding,
      version: sources.repositoryBinding.version + 1,
      status: 'revoked',
      updatedAt: '2026-08-11T10:37:00.000Z',
    }
    await store.saveGitHubRepositoryBinding(revokedBinding)
    const check: GitHubDeliveryRevocationCheck = {
      stateVersion: 2,
      intentId: completed.id,
      intentUpdatedAt: completed.updatedAt,
      bindingId: revokedBinding.id,
      bindingVersion: revokedBinding.version,
      outcomeCode: 'binding_inactive',
      checkedAt: '2026-08-11T10:38:00.000Z',
      redacted: true,
    }
    await store.saveDesktopPairingCredential({
      ...sources.pairing,
      tokenId: 'replacement-token',
      createdAt: '2026-08-11T10:37:30.000Z',
    }, 'replacement-encrypted-token')

    await expect(store.commitGitHubDeliveryRevocationCheck({
      check,
      expectedIntent: completed,
      expectedBinding: revokedBinding,
      expectedPairing: sources.pairing,
    })).resolves.toEqual({ committed: false, reason: 'pairing_stale' })
    await expect(store.listGitHubDeliveryRevocationChecks()).resolves.toEqual([])
    store.close()
  })

  it('rejects terminal delivery work without completed Draft evidence', async () => {
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    const sources = createSources()
    await saveSources(store, sources)
    const intent = await savePreparedIntent(store, sources)
    const failed = {
      ...intent,
      status: 'failed' as const,
      updatedAt: '2026-08-11T10:32:00.000Z',
    }
    await store.commitGitHubDeliveryIntentStatus({ expectedIntent: intent, intent: failed })
    const revokedBinding: GitHubRepositoryBinding = {
      ...sources.repositoryBinding,
      version: sources.repositoryBinding.version + 1,
      status: 'revoked',
      updatedAt: '2026-08-11T10:37:00.000Z',
    }
    await store.saveGitHubRepositoryBinding(revokedBinding)
    const check: GitHubDeliveryRevocationCheck = {
      stateVersion: 2,
      intentId: failed.id,
      intentUpdatedAt: failed.updatedAt,
      bindingId: revokedBinding.id,
      bindingVersion: revokedBinding.version,
      outcomeCode: 'binding_inactive',
      checkedAt: '2026-08-11T10:38:00.000Z',
      redacted: true,
    }

    await expect(store.commitGitHubDeliveryRevocationCheck({
      check,
      expectedIntent: failed,
      expectedBinding: revokedBinding,
      expectedPairing: sources.pairing,
    })).resolves.toEqual({ committed: false, reason: 'intent_ineligible' })
    await expect(store.listGitHubDeliveryRevocationChecks()).resolves.toEqual([])
    store.close()
  })

  it('rejects extra secret-bearing revocation-check fields before persistence', async () => {
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    const sources = createSources()
    await saveSources(store, sources)
    const completed = await saveCompletedIntent(store, sources)
    const revokedBinding: GitHubRepositoryBinding = {
      ...sources.repositoryBinding,
      version: sources.repositoryBinding.version + 1,
      status: 'revoked',
      updatedAt: '2026-08-11T10:37:00.000Z',
    }
    await store.saveGitHubRepositoryBinding(revokedBinding)
    const unsafeCheck = {
      stateVersion: 2 as const,
      intentId: completed.id,
      intentUpdatedAt: completed.updatedAt,
      bindingId: revokedBinding.id,
      bindingVersion: revokedBinding.version,
      outcomeCode: 'binding_inactive' as const,
      checkedAt: '2026-08-11T10:38:00.000Z',
      redacted: true as const,
      token: 'must-not-persist',
    } as GitHubDeliveryRevocationCheck

    await expect(store.commitGitHubDeliveryRevocationCheck({
      check: unsafeCheck,
      expectedIntent: completed,
      expectedBinding: revokedBinding,
      expectedPairing: sources.pairing,
    })).resolves.toEqual({ committed: false, reason: 'invalid_input' })
    await expect(store.listGitHubDeliveryRevocationChecks()).resolves.toEqual([])
    store.close()
  })

  it('rolls back revocation pass evidence when durable persistence fails', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const sources = createSources()
    await saveSources(store, sources)
    const completed = await saveCompletedIntent(store, sources)
    const revokedBinding: GitHubRepositoryBinding = {
      ...sources.repositoryBinding,
      version: sources.repositoryBinding.version + 1,
      status: 'revoked',
      updatedAt: '2026-08-11T10:37:00.000Z',
    }
    await store.saveGitHubRepositoryBinding(revokedBinding)
    const check: GitHubDeliveryRevocationCheck = {
      stateVersion: 2,
      intentId: completed.id,
      intentUpdatedAt: completed.updatedAt,
      bindingId: revokedBinding.id,
      bindingVersion: revokedBinding.version,
      outcomeCode: 'binding_inactive',
      checkedAt: '2026-08-11T10:38:00.000Z',
      redacted: true,
    }
    await rename(dbPath, `${dbPath}.backup`)
    await mkdir(dbPath)

    await expect(store.commitGitHubDeliveryRevocationCheck({
      check,
      expectedIntent: completed,
      expectedBinding: revokedBinding,
      expectedPairing: sources.pairing,
    })).rejects.toThrow()
    await expect(store.listGitHubDeliveryRevocationChecks()).resolves.toEqual([])
    store.close()
  })

  it('preserves an existing v14 JSON series and non-first attempt through schema 20', async () => {
    const dbPath = await tempDbPath()
    const sources = createSources()
    const store = await createLocalStore({ dbPath })
    await saveSources(store, sources)
    const attemptTwo = await createGitHubDeliveryIntent({
      id: 'delivery-intent-existing-attempt-2',
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
      deliveryAttempt: 2,
      now: '2026-08-11T10:31:00.000Z',
    })
    expect(attemptTwo.deliverySeriesKey).not.toBe(attemptTwo.idempotencyKey)
    await expect(store.commitGitHubDeliveryPreparation({
      intent: attemptTwo,
      expectedProject: sources.project,
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      testEvidence: sources.testEvidence,
      expectedPrPackage: sources.prPackage,
    })).resolves.toMatchObject({ committed: true })
    store.close()

    const SQL = await initSqlJs()
    const database = new SQL.Database(await readFile(dbPath))
    database.run(`${dropAgentRuntimeSchemaSql}
      update schema_meta set value = '14' where key = 'schema_version';`)
    await writeFile(dbPath, database.export())
    database.close()

    const migrated = await createLocalStore({ dbPath })
    await expect(migrated.getSchemaVersion()).resolves.toBe(20)
    await expect(migrated.listGitHubDeliveryIntents(sources.run.id))
      .resolves.toEqual([attemptTwo])
    migrated.close()
  })

  it('adds the isolated revocation-check table to an existing schema 15 database', async () => {
    const dbPath = await tempDbPath()
    const sources = createSources()
    const store = await createLocalStore({ dbPath })
    await saveSources(store, sources)
    const completed = await saveCompletedIntent(store, sources)
    store.close()

    const SQL = await initSqlJs()
    const database = new SQL.Database(await readFile(dbPath))
    database.run(`${dropAgentRuntimeSchemaSql}
      drop table github_delivery_revocation_checks;
      update schema_meta set value = '15' where key = 'schema_version';`)
    await writeFile(dbPath, database.export())
    database.close()

    const migrated = await createLocalStore({ dbPath })
    await expect(migrated.getSchemaVersion()).resolves.toBe(20)
    await expect(migrated.listGitHubDeliveryIntents(sources.run.id))
      .resolves.toEqual([completed])
    await expect(migrated.listGitHubDeliveryRevocationChecks()).resolves.toEqual([])
    migrated.close()
  })

  it('does not stop or record an outcome for stale or terminal CAS input', async () => {
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    const sources = createSources()
    await saveSources(store, sources)
    const intent = await savePreparedIntent(store, sources)

    await expect(store.stopGitHubDeliveryIntent({
      intentId: intent.id,
      expectedUpdatedAt: '2026-08-11T10:30:00.000Z',
      updatedAt: '2026-08-11T10:32:00.000Z',
    })).resolves.toEqual({ committed: false, reason: 'source_stale' })
    await expect(store.listGitHubDeliveryIntents(intent.runId)).resolves.toEqual([intent])
    await expect(store.listGitHubDeliveryOperatorOutcomes()).resolves.toEqual([])

    const failedIntent = {
      ...intent,
      status: 'failed' as const,
      updatedAt: '2026-08-11T10:33:00.000Z',
    }
    await expect(store.commitGitHubDeliveryIntentStatus({
      expectedIntent: intent,
      intent: failedIntent,
    })).resolves.toMatchObject({ committed: true, intent: failedIntent })
    await expect(store.stopGitHubDeliveryIntent({
      intentId: intent.id,
      expectedUpdatedAt: failedIntent.updatedAt,
      updatedAt: '2026-08-11T10:34:00.000Z',
    })).resolves.toEqual({ committed: false, reason: 'intent_terminal' })
    await expect(store.listGitHubDeliveryOperatorOutcomes()).resolves.toEqual([])
    store.close()
  })

  it('rolls back both Stop status and operator outcome when persistence fails', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const sources = createSources()
    await saveSources(store, sources)
    const intent = await savePreparedIntent(store, sources)
    await rename(dbPath, `${dbPath}.backup`)
    await mkdir(dbPath)

    await expect(store.stopGitHubDeliveryIntent({
      intentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
      updatedAt: '2026-08-11T10:32:00.000Z',
    })).rejects.toThrow()
    await expect(store.listGitHubDeliveryIntents(intent.runId)).resolves.toEqual([intent])
    await expect(store.listGitHubDeliveryOperatorOutcomes()).resolves.toEqual([])
    store.close()
  })

  it('atomically persists a closed publisher outcome with recovery-required status', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const sources = createSources()
    await saveSources(store, sources)
    const intent = await savePreparedIntent(store, sources)
    const approved = {
      ...intent,
      status: 'approved' as const,
      updatedAt: '2026-08-11T10:32:00.000Z',
    }
    await store.commitGitHubDeliveryIntentStatus({
      expectedIntent: intent,
      intent: approved,
    })
    const recovery = {
      ...approved,
      status: 'recovery_required' as const,
      updatedAt: '2026-08-11T10:33:00.000Z',
    }

    await expect(store.commitGitHubDeliveryIntentStatus({
      expectedIntent: approved,
      intent: recovery,
      operatorOutcomeCode: 'remote_unavailable',
    })).resolves.toMatchObject({ committed: true, intent: recovery })
    await expect(store.stopGitHubDeliveryIntent({
      intentId: intent.id,
      expectedUpdatedAt: recovery.updatedAt,
      updatedAt: '2026-08-11T10:34:00.000Z',
    })).resolves.toEqual({ committed: false, reason: 'intent_terminal' })
    await expect(store.listGitHubDeliveryOperatorOutcomes(intent.id)).resolves.toMatchObject([{
      outcomeCode: 'remote_unavailable',
      intentUpdatedAt: recovery.updatedAt,
    }])
    store.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(reopened.listGitHubDeliveryOperatorOutcomes(intent.id)).resolves.toEqual([{
      stateVersion: 1,
      intentId: intent.id,
      intentUpdatedAt: recovery.updatedAt,
      outcomeCode: 'remote_unavailable',
      recordedAt: recovery.updatedAt,
      redacted: true,
    }])
    reopened.close()
  })

  it('durably parks approval-waiting work in recovery without inventing approval or failure', async () => {
    const dbPath = await tempDbPath()
    const store = await createLocalStore({ dbPath })
    const sources = createSources()
    await saveSources(store, sources)
    const intent = await savePreparedIntent(store, sources)
    const recovery = {
      ...intent,
      status: 'recovery_required' as const,
      updatedAt: '2026-08-11T10:33:00.000Z',
    }

    await expect(store.commitGitHubDeliveryIntentStatus({
      expectedIntent: intent,
      intent: recovery,
    })).resolves.toEqual({ committed: true, replayed: false, intent: recovery })
    store.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(reopened.listGitHubDeliveryIntents(intent.runId)).resolves.toEqual([recovery])
    await expect(reopened.listGitHubDeliveryOperatorOutcomes(intent.id)).resolves.toEqual([])
    reopened.close()
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
      first.commitGitHubDeliveryPreparation({
        intent,
        expectedProject: sources.project,
        expectedPairingCredential: sources.pairing,
        expectedRepositoryBinding: sources.repositoryBinding,
        expectedRun: sources.run,
        expectedCodingRun: sources.codingRun,
        expectedWorkspace: sources.workspace,
        expectedDiffArtifact: sources.diffArtifact,
        testEvidence: sources.testEvidence,
        expectedPrPackage: sources.prPackage,
      }),
      first.commitGitHubDeliveryPreparation({
        intent: replayIntent,
        expectedProject: sources.project,
        expectedPairingCredential: sources.pairing,
        expectedRepositoryBinding: sources.repositoryBinding,
        expectedRun: sources.run,
        expectedCodingRun: sources.codingRun,
        expectedWorkspace: sources.workspace,
        expectedDiffArtifact: sources.diffArtifact,
        testEvidence: sources.testEvidence,
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
    await expect(first.commitGitHubDeliveryPreparation({
      intent: replayIntent,
      expectedProject: sources.project,
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      testEvidence: sources.testEvidence,
      expectedPrPackage: sources.prPackage,
    })).resolves.toEqual({ committed: true, replayed: true, intent })
    first.close()

    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.listGitHubDeliveryIntents(sources.run.id)).toEqual([intent])
    expect(await reopened.listTestEvidence(sources.run.id)).toEqual([sources.testEvidence])
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

    await expect(store.commitGitHubDeliveryPreparation({
      intent,
      expectedProject: sources.project,
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      testEvidence: sources.testEvidence,
      expectedPrPackage: sources.prPackage,
    })).resolves.toEqual({ committed: false, reason: 'source_stale' })
    expect(await store.listGitHubDeliveryIntents()).toEqual([])
    store.close()
  })

  it('rejects an untrusted Project source or test command before writing evidence', async () => {
    const dbPath = await tempDbPath()
    const sources = createSources()
    const intent = await createIntent(sources)
    const store = await createLocalStore({ dbPath })
    await saveSources(store, sources)

    await expect(store.commitGitHubDeliveryPreparation({
      intent,
      expectedProject: { ...sources.project, path: '/private/other-source' },
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      testEvidence: sources.testEvidence,
      expectedPrPackage: sources.prPackage,
    })).rejects.toThrow('does not match the Local Project source')

    await expect(store.commitGitHubDeliveryPreparation({
      intent,
      expectedProject: { ...sources.project, testCommand: 'rm -rf /private/other-source' },
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      testEvidence: sources.testEvidence,
      expectedPrPackage: sources.prPackage,
    })).rejects.toThrow('does not match the safe Project test command')

    expect(await store.listTestEvidence(sources.run.id)).toEqual([])
    expect(await store.listGitHubDeliveryIntents(sources.run.id)).toEqual([])
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
    await expect(store.commitGitHubDeliveryPreparation({
      intent,
      expectedProject: sources.project,
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      testEvidence: sources.testEvidence,
      expectedPrPackage: sources.prPackage,
    })).resolves.toEqual({ committed: false, reason: 'source_stale' })

    await store.saveDesktopPairingCredential(sources.pairing, 'encrypted-token')
    await expect(store.commitGitHubDeliveryPreparation({
      intent,
      expectedProject: sources.project,
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      testEvidence: sources.testEvidence,
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
    await expect(store.commitGitHubDeliveryPreparation({
      intent: secondIntent,
      expectedProject: changedSources.project,
      expectedPairingCredential: changedSources.pairing,
      expectedRepositoryBinding: changedSources.repositoryBinding,
      expectedRun: changedSources.run,
      expectedCodingRun: changedSources.codingRun,
      expectedWorkspace: changedSources.workspace,
      expectedDiffArtifact: changedSources.diffArtifact,
      testEvidence: changedSources.testEvidence,
      expectedPrPackage: changedSources.prPackage,
    })).resolves.toEqual({ committed: false, reason: 'active_intent_exists' })
    store.close()
  })

  it('atomically supersedes an approval-wait intent with an immutable material revision', async () => {
    const sources = createSources()
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    await saveSources(store, sources)
    const original = await savePreparedIntent(store, sources)
    const changedPackage: Artifact = {
      ...sources.prPackage,
      summary: 'Materially revised delivery package.',
      updatedAt: '2026-08-11T10:40:00.000Z',
    }
    const changedEvidence: TestEvidence = {
      ...sources.testEvidence,
      id: 'postcommit-test-delivery-revision-1',
      createdAt: '2026-08-11T10:41:00.000Z',
    }
    await store.saveArtifact(changedPackage)
    const revision = await createGitHubDeliveryIntent({
      id: 'delivery-intent-revision-1',
      repositoryBinding: sources.repositoryBinding,
      run: sources.run,
      prNodeId: original.nodeId,
      codingRun: sources.codingRun,
      workspace: sources.workspace,
      diffArtifact: sources.diffArtifact,
      prPackage: changedPackage,
      testEvidence: changedEvidence as TestEvidence & { sourceCommitSha: string },
      baseCommitSha,
      expectedCommitSha,
      deliveryAttempt: original.deliveryAttempt,
      now: '2026-08-11T10:42:00.000Z',
    })
    expect(revision).toMatchObject({
      deliverySeriesKey: original.deliverySeriesKey,
      deliveryAttempt: original.deliveryAttempt,
      idempotencyKey: original.idempotencyKey,
    })
    expect(revision.intentDigest).not.toBe(original.intentDigest)

    await expect(store.commitGitHubDeliveryReplacement({
      kind: 'revision',
      expectedIntent: original,
      intent: revision,
      expectedProject: sources.project,
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      testEvidence: changedEvidence,
      expectedPrPackage: changedPackage,
    })).resolves.toEqual({ committed: true, replayed: false, intent: revision })

    await expect(store.listGitHubDeliveryIntents(sources.run.id)).resolves.toEqual([
      { ...original, status: 'revoked', updatedAt: revision.createdAt },
      revision,
    ])
    await expect(store.listTestEvidence(sources.run.id)).resolves.toEqual([
      sources.testEvidence,
      changedEvidence,
    ])
    store.close()
  })

  it('creates a new attempt after terminal failure without reopening the old intent', async () => {
    const sources = createSources()
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    await saveSources(store, sources)
    const original = await savePreparedIntent(store, sources)
    const failed = {
      ...original,
      status: 'failed' as const,
      updatedAt: '2026-08-11T10:33:00.000Z',
    }
    await expect(store.commitGitHubDeliveryIntentStatus({
      expectedIntent: original,
      intent: failed,
    })).resolves.toMatchObject({ committed: true, replayed: false, intent: failed })
    const retryEvidence: TestEvidence = {
      ...sources.testEvidence,
      id: 'postcommit-test-delivery-retry-2',
      createdAt: '2026-08-11T10:34:00.000Z',
    }
    const retry = await createGitHubDeliveryIntent({
      id: 'delivery-intent-attempt-2',
      repositoryBinding: sources.repositoryBinding,
      run: sources.run,
      prNodeId: failed.nodeId,
      codingRun: sources.codingRun,
      workspace: sources.workspace,
      diffArtifact: sources.diffArtifact,
      prPackage: sources.prPackage,
      testEvidence: retryEvidence as TestEvidence & { sourceCommitSha: string },
      baseCommitSha,
      expectedCommitSha,
      deliveryAttempt: 2,
      now: '2026-08-11T10:35:00.000Z',
    })
    expect(retry.deliverySeriesKey).toBe(failed.deliverySeriesKey)
    expect(retry.idempotencyKey).not.toBe(failed.idempotencyKey)

    await expect(store.commitGitHubDeliveryReplacement({
      kind: 'retry',
      expectedIntent: failed,
      intent: retry,
      expectedProject: sources.project,
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      testEvidence: retryEvidence,
      expectedPrPackage: sources.prPackage,
    })).resolves.toEqual({ committed: true, replayed: false, intent: retry })
    await expect(store.listGitHubDeliveryIntents(sources.run.id)).resolves.toEqual([
      failed,
      retry,
    ])

    await expect(store.commitGitHubDeliveryIntentStatus({
      expectedIntent: original,
      intent: { ...original, status: 'approved', updatedAt: retry.updatedAt },
    })).resolves.toEqual({ committed: false, reason: 'source_stale' })
    store.close()
  })

  it('starts a new delivery series at attempt one after repository rebind', async () => {
    const sources = createSources()
    const store = await createLocalStore({ dbPath: await tempDbPath() })
    await saveSources(store, sources)
    const original = await savePreparedIntent(store, sources)
    const revoked = {
      ...original,
      status: 'revoked' as const,
      updatedAt: '2026-08-11T10:33:00.000Z',
    }
    await expect(store.commitGitHubDeliveryIntentStatus({
      expectedIntent: original,
      intent: revoked,
    })).resolves.toMatchObject({ committed: true, intent: revoked })
    const reboundBinding: GitHubRepositoryBinding = {
      ...sources.repositoryBinding,
      version: sources.repositoryBinding.version + 1,
      updatedAt: '2026-08-11T10:34:00.000Z',
      validatedAt: '2026-08-11T10:34:00.000Z',
    }
    await store.saveGitHubRepositoryBinding(reboundBinding)
    const retryEvidence: TestEvidence = {
      ...sources.testEvidence,
      id: 'postcommit-test-delivery-rebound-1',
      createdAt: '2026-08-11T10:35:00.000Z',
    }
    const rebound = await createGitHubDeliveryIntent({
      id: 'delivery-intent-rebound-1',
      repositoryBinding: reboundBinding,
      run: sources.run,
      prNodeId: revoked.nodeId,
      codingRun: sources.codingRun,
      workspace: sources.workspace,
      diffArtifact: sources.diffArtifact,
      prPackage: sources.prPackage,
      testEvidence: retryEvidence as TestEvidence & { sourceCommitSha: string },
      baseCommitSha,
      expectedCommitSha,
      deliveryAttempt: 1,
      now: '2026-08-11T10:36:00.000Z',
    })
    expect(rebound.deliverySeriesKey).not.toBe(revoked.deliverySeriesKey)

    await expect(store.commitGitHubDeliveryReplacement({
      kind: 'retry',
      expectedIntent: revoked,
      intent: rebound,
      expectedProject: sources.project,
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: reboundBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      testEvidence: retryEvidence,
      expectedPrPackage: sources.prPackage,
    })).resolves.toEqual({ committed: true, replayed: false, intent: rebound })
    expect(rebound.deliveryAttempt).toBe(1)
    await expect(store.listGitHubDeliveryIntents(sources.run.id)).resolves.toEqual([
      revoked,
      rebound,
    ])
    store.close()
  })

  it('CAS-transitions only the delivery lifecycle and survives restart', async () => {
    const dbPath = await tempDbPath()
    const sources = createSources()
    const intent = await createIntent(sources)
    const store = await createLocalStore({ dbPath })
    await saveSources(store, sources)
    const prepared = await store.commitGitHubDeliveryPreparation({
      intent,
      expectedProject: sources.project,
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      testEvidence: sources.testEvidence,
      expectedPrPackage: sources.prPackage,
    })
    if (!prepared.committed) throw new Error('Fixture delivery intent must be persisted')

    const approved = {
      ...intent,
      status: 'approved' as const,
      updatedAt: '2026-08-11T10:32:00.000Z',
    }
    await expect(store.commitGitHubDeliveryIntentStatus({
      expectedIntent: intent,
      intent: approved,
    })).resolves.toEqual({ committed: true, replayed: false, intent: approved })
    await expect(store.commitGitHubDeliveryIntentStatus({
      expectedIntent: intent,
      intent: approved,
    })).resolves.toEqual({ committed: true, replayed: true, intent: approved })
    store.close()

    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.listGitHubDeliveryIntents(sources.run.id)).toEqual([approved])
    reopened.close()
  })

  it('stops an approval-wait delivery by exact CAS and records only a safe local outcome', async () => {
    const dbPath = await tempDbPath()
    const sources = createSources()
    const store = await createLocalStore({ dbPath })
    await saveSources(store, sources)
    const intent = await savePreparedIntent(store, sources)
    const stoppedAt = '2026-08-11T10:32:00.000Z'
    const stoppedIntent = {
      ...intent,
      status: 'recovery_required' as const,
      updatedAt: stoppedAt,
    }
    const outcome = {
      stateVersion: 1 as const,
      intentId: intent.id,
      intentUpdatedAt: stoppedAt,
      outcomeCode: 'operation_cancelled' as const,
      recordedAt: stoppedAt,
      redacted: true as const,
    }

    await expect(store.stopGitHubDeliveryIntent({
      intentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
      updatedAt: stoppedAt,
    })).resolves.toEqual({
      committed: true,
      replayed: false,
      intent: stoppedIntent,
      outcome,
    })
    await expect(store.stopGitHubDeliveryIntent({
      intentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
      updatedAt: stoppedAt,
    })).resolves.toEqual({
      committed: true,
      replayed: true,
      intent: stoppedIntent,
      outcome,
    })
    await expect(store.loadState()).resolves.toMatchObject({
      githubDeliveryIntents: [stoppedIntent],
      githubDeliveryOperatorOutcomes: [outcome],
    })
    expect(JSON.stringify(outcome)).not.toMatch(
      /token|\/Users\/|\/private\/managed|worktree|patch/i,
    )
    store.close()

    const SQL = await initSqlJs()
    const database = new SQL.Database(await readFile(dbPath))
    const columns = database
      .exec('pragma table_info(github_delivery_operator_outcomes)')[0]
      ?.values.map((row) => String(row[1])) ?? []
    expect(columns).toEqual([
      'intent_id',
      'intent_updated_at',
      'outcome_code',
      'state_version',
      'json',
      'recorded_at',
    ])
    const outcomeJson = String(
      database.exec('select json from github_delivery_operator_outcomes')[0]
        ?.values[0]?.[0],
    )
    expect(outcomeJson).toBe(JSON.stringify(outcome))
    expect(outcomeJson).not.toMatch(
      /token|\/Users\/|\/private\/managed|worktree|patch/i,
    )
    database.close()

    const reopened = await createLocalStore({ dbPath })
    await expect(reopened.listGitHubDeliveryOperatorOutcomes(intent.id)).resolves.toEqual([
      outcome,
    ])
    await expect(reopened.loadState()).resolves.toMatchObject({
      githubDeliveryIntents: [stoppedIntent],
      githubDeliveryOperatorOutcomes: [outcome],
    })
    reopened.close()
  })

  it('rejects stale, regressive, and authority-mutating delivery transitions', async () => {
    const dbPath = await tempDbPath()
    const sources = createSources()
    const intent = await createIntent(sources)
    const store = await createLocalStore({ dbPath })
    await saveSources(store, sources)
    const prepared = await store.commitGitHubDeliveryPreparation({
      intent,
      expectedProject: sources.project,
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      testEvidence: sources.testEvidence,
      expectedPrPackage: sources.prPackage,
    })
    if (!prepared.committed) throw new Error('Fixture delivery intent must be persisted')

    const approved = {
      ...intent,
      status: 'approved' as const,
      updatedAt: '2026-08-11T10:32:00.000Z',
    }
    const failed = {
      ...approved,
      status: 'failed' as const,
      updatedAt: '2026-08-11T10:33:00.000Z',
    }
    await store.commitGitHubDeliveryIntentStatus({ expectedIntent: intent, intent: approved })

    await expect(store.commitGitHubDeliveryIntentStatus({
      expectedIntent: intent,
      intent: { ...intent, status: 'failed', updatedAt: '2026-08-11T10:34:00.000Z' },
    })).resolves.toEqual({ committed: false, reason: 'source_stale' })

    await expect(store.commitGitHubDeliveryIntentStatus({
      expectedIntent: approved,
      intent: { ...failed, expectedCommitSha: '3333333333333333333333333333333333333333' },
    })).rejects.toThrow('may only change status and updatedAt')

    await store.commitGitHubDeliveryIntentStatus({ expectedIntent: approved, intent: failed })
    await expect(store.commitGitHubDeliveryIntentStatus({
      expectedIntent: failed,
      intent: {
        ...failed,
        status: 'creating_pr',
        updatedAt: '2026-08-11T10:34:00.000Z',
      },
    })).rejects.toThrow('transition is invalid')
    await expect(store.commitGitHubDeliveryIntentStatus({
      expectedIntent: failed,
      intent: {
        ...failed,
        status: 'failed',
        updatedAt: '2026-08-11T10:32:00.000Z',
      },
    })).rejects.toThrow('timestamp is invalid')
    store.close()
  })

  it('atomically records the exact Draft PR completion and rejects generic completion', async () => {
    const dbPath = await tempDbPath()
    const sources = createSources()
    const intent = await createIntent(sources)
    const store = await createLocalStore({ dbPath })
    await saveSources(store, sources)
    const prepared = await store.commitGitHubDeliveryPreparation({
      intent,
      expectedProject: sources.project,
      expectedPairingCredential: sources.pairing,
      expectedRepositoryBinding: sources.repositoryBinding,
      expectedRun: sources.run,
      expectedCodingRun: sources.codingRun,
      expectedWorkspace: sources.workspace,
      expectedDiffArtifact: sources.diffArtifact,
      testEvidence: sources.testEvidence,
      expectedPrPackage: sources.prPackage,
    })
    if (!prepared.committed) throw new Error('Fixture delivery intent must be persisted')

    const approved = { ...intent, status: 'approved' as const, updatedAt: '2026-08-11T10:32:00.000Z' }
    const publishing = { ...approved, status: 'publishing_branch' as const, updatedAt: '2026-08-11T10:33:00.000Z' }
    const published = { ...publishing, status: 'branch_published' as const, updatedAt: '2026-08-11T10:34:00.000Z' }
    const creating = { ...published, status: 'creating_pr' as const, updatedAt: '2026-08-11T10:35:00.000Z' }
    await store.commitGitHubDeliveryIntentStatus({ expectedIntent: intent, intent: approved })
    await store.commitGitHubDeliveryIntentStatus({ expectedIntent: approved, intent: publishing })
    await store.commitGitHubDeliveryIntentStatus({ expectedIntent: publishing, intent: published })
    await store.commitGitHubDeliveryIntentStatus({ expectedIntent: published, intent: creating })

    await expect(store.commitGitHubDeliveryIntentStatus({
      expectedIntent: creating,
      intent: { ...creating, status: 'completed', updatedAt: '2026-08-11T10:36:00.000Z' },
    })).rejects.toThrow('transition is invalid')

    const completion = createGitHubDeliveryCompletion({
      intent: creating,
      remoteRequestId: 'remote-delivery-1',
      publicationId: 'publication-1',
      pullRequestOutcomeId: 'pull-request-outcome-1',
      pullRequestId: '123456789',
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/erich04/ai-devflow-studio/pull/42',
      repository: creating.repository,
      baseBranch: creating.baseBranch,
      headBranch: creating.headBranch,
      headSha: creating.expectedCommitSha,
      draft: true,
      providerCreatedAt: '2026-08-11T10:35:30.000Z',
      recordedAt: '2026-08-11T10:36:00.000Z',
    })
    const completed = {
      ...creating,
      status: 'completed' as const,
      completion,
      updatedAt: completion.recordedAt,
    }
    await expect(store.commitGitHubDeliveryIntentCompletion({
      expectedIntent: creating,
      intent: completed,
    })).resolves.toEqual({ committed: true, replayed: false, intent: completed })
    await expect(store.commitGitHubDeliveryIntentCompletion({
      expectedIntent: creating,
      intent: completed,
    })).resolves.toEqual({ committed: true, replayed: true, intent: completed })
    store.close()

    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.listGitHubDeliveryIntents(sources.run.id)).toEqual([completed])
    reopened.close()
  })
})
