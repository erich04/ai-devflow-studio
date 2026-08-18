import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type {
  Artifact,
  CodingAgentRun,
  CodingDiffArtifact,
  DesktopPairingCredential,
  GitHubDeliveryIntent,
  GitHubRepositoryBinding,
  LocalProject,
  ManagedCodingWorkspace,
  TestEvidence,
  WorkflowRun,
} from '@ai-devflow/shared'
import { sanitizeCodingDiffArtifact } from '@ai-devflow/shared'
import { createGitHubDeliveryRuntime } from './github-delivery-runtime'
import type {
  GitHubDeliveryPreparationMutationResult,
  GitHubDeliveryReplacementMutationResult,
} from './local-store'
import { createWorkspaceOperationCoordinator } from './workspace-operation-coordinator'

const baseCommitSha = '0000000000000000000000000000000000000000'
const expectedCommitSha = '1111111111111111111111111111111111111111'

function fixture() {
  const project: LocalProject = {
    id: 'local-project-1',
    name: 'Delivery fixture',
    path: '/private/local/source',
    packageManager: 'pnpm',
    testCommand: 'pnpm test',
    createdAt: '2026-08-11T13:00:00.000Z',
    updatedAt: '2026-08-11T13:00:00.000Z',
  }
  const pairing: DesktopPairingCredential = {
    tokenId: 'desktop-token-1',
    organizationId: 'org-1',
    projectId: 'team-project-1',
    localProjectId: project.id,
    userId: 'user-1',
    role: 'lead',
    authAccountId: 'account-1',
    projectMemberships: [
      { projectId: 'team-project-1', userId: 'user-1', role: 'lead' },
    ],
    createdAt: '2026-08-11T13:00:00.000Z',
  }
  const binding: GitHubRepositoryBinding = {
    stateVersion: 1,
    id: 'binding-1',
    version: 1,
    organizationId: pairing.organizationId,
    teamProjectId: pairing.projectId,
    installationId: '12345',
    repositoryId: '98765',
    repository: 'erich04/ai-devflow-studio',
    defaultBranch: 'main',
    status: 'active',
    validatedAt: '2026-08-11T13:00:00.000Z',
    updatedAt: '2026-08-11T13:00:00.000Z',
    redacted: true,
  }
  const packageId = 'artifact-run-1-pr-draft-v6'
  const run: WorkflowRun = {
    id: 'run-1',
    version: 7,
    title: 'Ship a tested change',
    request: 'Publish the reviewed managed-worktree commit.',
    projectId: project.id,
    creatorId: 'user-1',
    status: 'testing',
    currentNodeId: 'run-1-pr',
    branchName: 'ai/non-authoritative-plan',
    createdAt: '2026-08-11T13:00:00.000Z',
    updatedAt: '2026-08-11T13:06:00.000Z',
    nodes: [
      {
        id: 'run-1-build',
        stage: 'build',
        title: 'Build',
        subtitle: 'Implement',
        kind: 'task',
        status: 'success',
        ownerId: 'user-1',
        requiredRole: 'member',
        retryCount: 0,
        artifactIds: ['diff-1'],
      },
      {
        id: 'run-1-pr',
        stage: 'pr',
        title: 'PR',
        subtitle: 'Deliver',
        kind: 'pr',
        status: 'running',
        ownerId: 'user-1',
        requiredRole: 'member',
        retryCount: 0,
        artifactIds: [packageId],
      },
    ],
    edges: [],
  }
  const codingRun: CodingAgentRun = {
    id: 'coding-1',
    runId: run.id,
    nodeId: 'run-1-build',
    projectId: project.id,
    requestedBy: 'user-1',
    providerId: 'fake',
    engine: 'fake',
    status: 'completed',
    managedWorkspaceId: 'workspace-1',
    branchName: 'devflow/run-1-build-coding-1',
    userInstruction: 'Implement.',
    prompt: 'redacted',
    summary: 'Completed.',
    changedPaths: ['src/delivery.ts'],
    startedAt: '2026-08-11T13:01:00.000Z',
    completedAt: '2026-08-11T13:04:00.000Z',
    diffArtifactId: 'diff-1',
    testEvidenceId: 'precommit-test-1',
    redacted: true,
  }
  const workspace: ManagedCodingWorkspace = {
    id: 'workspace-1',
    projectId: project.id,
    codingRunId: codingRun.id,
    sourcePath: project.path,
    worktreePath: '/private/local/worktree',
    branchName: codingRun.branchName,
    baseBranch: binding.defaultBranch,
    baseCommitSha,
    createdAt: '2026-08-11T13:00:30.000Z',
    cleanupStatus: 'active',
  }
  const rawPatch = 'diff --git a/src/delivery.ts b/src/delivery.ts\n+reviewed\n'
  const sourceDigest = createHash('sha256').update(rawPatch, 'utf8').digest('hex')
  const diff: CodingDiffArtifact = sanitizeCodingDiffArtifact({
    id: 'diff-1',
    runId: run.id,
    nodeId: codingRun.nodeId,
    projectId: project.id,
    changedPaths: [...codingRun.changedPaths],
    patch: rawPatch,
    sourceDigest,
    createdAt: '2026-08-11T13:03:00.000Z',
  })
  const precommitTest: TestEvidence = {
    id: 'precommit-test-1',
    runId: run.id,
    nodeId: codingRun.nodeId,
    projectId: project.id,
    command: 'pnpm test',
    cwd: workspace.worktreePath,
    status: 'passed',
    exitCode: 0,
    durationMs: 10,
    stdout: '',
    stderr: '',
    summary: 'Precommit tests passed.',
    redacted: true,
    createdAt: '2026-08-11T13:03:30.000Z',
  }
  const prPackage: Artifact = {
    id: packageId,
    runId: run.id,
    nodeId: 'run-1-pr',
    kind: 'pr',
    title: 'PR Draft: Ship a tested change',
    summary: 'Bounded delivery package.',
    content: '# Ship a tested change\n\nEvidence only.',
    redacted: true,
    updatedAt: '2026-08-11T13:05:00.000Z',
    githubDeliverySource: {
      stateVersion: 1,
      codingRunId: codingRun.id,
      workspaceId: workspace.id,
      diffArtifactId: diff.id,
      diffSourceDigest: sourceDigest,
      testEvidenceId: precommitTest.id,
      headBranch: workspace.branchName,
    },
  }
  return {
    project,
    pairing,
    binding,
    run,
    codingRun,
    workspace,
    diff,
    precommitTest,
    prPackage,
  }
}

function fakeStore(source: ReturnType<typeof fixture>) {
  let workspace = source.workspace
  const intents: GitHubDeliveryIntent[] = []
  const evidence = [source.precommitTest]
  return {
    intents,
    evidence,
    setWorkspace(next: ManagedCodingWorkspace) {
      workspace = next
    },
    getRun: vi.fn(async () => source.run),
    listProjects: vi.fn(async () => [source.project]),
    getDesktopPairingCredential: vi.fn(async () => source.pairing),
    getGitHubRepositoryBinding: vi.fn(async () => source.binding),
    listArtifacts: vi.fn(async () => [source.prPackage]),
    listCodingAgentRuns: vi.fn(async () => [source.codingRun]),
    listManagedCodingWorkspaces: vi.fn(async () => [workspace]),
    listCodingDiffArtifacts: vi.fn(async () => [source.diff]),
    listTestEvidence: vi.fn(async () => [...evidence]),
    listGitHubDeliveryIntents: vi.fn(async () => [...intents]),
    commitManagedCodingWorkspaceHead: vi.fn(async (mutation: {
      expectedWorkspace: ManagedCodingWorkspace
      workspace: ManagedCodingWorkspace
    }) => {
      if (JSON.stringify(workspace) !== JSON.stringify(mutation.expectedWorkspace)) {
        return { committed: false as const, reason: 'source_stale' as const }
      }
      workspace = mutation.workspace
      return { committed: true as const, replayed: false, workspace }
    }),
    saveTestEvidence: vi.fn(async (test: TestEvidence) => {
      evidence.push(test)
    }),
    commitGitHubDeliveryPreparation: vi.fn(async (mutation: {
      intent: GitHubDeliveryIntent
      testEvidence: TestEvidence
    }): Promise<GitHubDeliveryPreparationMutationResult> => {
      evidence.push(mutation.testEvidence)
      intents.push(mutation.intent)
      return { committed: true as const, replayed: false, intent: mutation.intent }
    }),
    commitGitHubDeliveryReplacement: vi.fn(async (mutation: {
      kind: 'revision' | 'retry'
      expectedIntent: GitHubDeliveryIntent
      intent: GitHubDeliveryIntent
      testEvidence: TestEvidence
    }): Promise<GitHubDeliveryReplacementMutationResult> => {
      const expectedIndex = intents.findIndex((intent) =>
        JSON.stringify(intent) === JSON.stringify(mutation.expectedIntent),
      )
      if (expectedIndex < 0) {
        return { committed: false as const, reason: 'intent_stale' as const }
      }
      if (mutation.kind === 'revision') {
        intents[expectedIndex] = {
          ...mutation.expectedIntent,
          status: 'revoked',
          updatedAt: mutation.intent.createdAt,
        }
      }
      evidence.push(mutation.testEvidence)
      intents.push(mutation.intent)
      return { committed: true as const, replayed: false, intent: mutation.intent }
    }),
  }
}

describe('GitHub Delivery preparation runtime', () => {
  it('retests current material and replaces an approval with a new immutable revision', async () => {
    const source = fixture()
    const store = fakeStore(source)
    const committedWorkspace = {
      ...source.workspace,
      baseCommitSha,
      headCommitSha: expectedCommitSha,
    }
    const commitWorkspace = vi.fn(async () => ({
      workspace: committedWorkspace,
      baseCommitSha,
      expectedCommitSha,
    }))
    const runTestCommand = vi.fn(async () => ({
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 25,
      stdout: 'ok',
      stderr: '',
      redacted: false,
      summary: 'Tests passed.',
    }))
    let clock = 0
    let sequence = 0
    const runtime = createGitHubDeliveryRuntime({
      store,
      commitWorkspace,
      runTestCommand,
      now: () => [
        '2026-08-11T13:10:00.000Z',
        '2026-08-11T13:12:00.000Z',
      ][clock++]!,
      idGenerator: (prefix) => `${prefix}-${++sequence}`,
    })
    const prepared = await runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' })
    if (prepared.status !== 'prepared') throw new Error('Expected initial preparation')
    source.prPackage = {
      ...source.prPackage,
      summary: 'Materially revised package.',
      updatedAt: '2026-08-11T13:11:00.000Z',
    }

    const revised = await runtime.revise({
      intentId: prepared.intent.id,
      expectedUpdatedAt: prepared.intent.updatedAt,
    })

    expect(revised).toMatchObject({
      status: 'prepared',
      replayed: false,
      intent: {
        status: 'approval_required',
        deliverySeriesKey: prepared.intent.deliverySeriesKey,
        deliveryAttempt: prepared.intent.deliveryAttempt,
        idempotencyKey: prepared.intent.idempotencyKey,
      },
    })
    expect(store.intents).toHaveLength(2)
    expect(store.intents[0]).toMatchObject({
      id: prepared.intent.id,
      status: 'revoked',
    })
    expect(store.commitGitHubDeliveryReplacement).toHaveBeenCalledTimes(1)
    expect(runTestCommand).toHaveBeenCalledTimes(2)
  })

  it('retests a terminal delivery into the next attempt and replays only the new active intent', async () => {
    const source = fixture()
    const store = fakeStore(source)
    const committedWorkspace = {
      ...source.workspace,
      baseCommitSha,
      headCommitSha: expectedCommitSha,
    }
    const commitWorkspace = vi.fn(async () => ({
      workspace: committedWorkspace,
      baseCommitSha,
      expectedCommitSha,
    }))
    const runTestCommand = vi.fn(async () => ({
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 25,
      stdout: 'ok',
      stderr: '',
      redacted: false,
      summary: 'Tests passed.',
    }))
    let clock = 0
    let sequence = 0
    const runtime = createGitHubDeliveryRuntime({
      store,
      commitWorkspace,
      runTestCommand,
      now: () => [
        '2026-08-11T13:10:00.000Z',
        '2026-08-11T13:12:00.000Z',
      ][clock++]!,
      idGenerator: (prefix) => `${prefix}-${++sequence}`,
    })
    const prepared = await runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' })
    if (prepared.status !== 'prepared') throw new Error('Expected initial preparation')
    const failed: GitHubDeliveryIntent = {
      ...prepared.intent,
      status: 'failed',
      updatedAt: '2026-08-11T13:11:00.000Z',
    }
    store.intents[0] = failed

    const retried = await runtime.retry({
      intentId: failed.id,
      expectedUpdatedAt: failed.updatedAt,
    })

    expect(retried).toMatchObject({
      status: 'prepared',
      replayed: false,
      intent: {
        deliverySeriesKey: failed.deliverySeriesKey,
        deliveryAttempt: 2,
      },
    })
    if (retried.status !== 'prepared') throw new Error('Expected retry preparation')
    expect(retried.intent.idempotencyKey).not.toBe(failed.idempotencyKey)
    expect(store.intents[0]).toEqual(failed)
    expect(store.intents).toHaveLength(2)

    runTestCommand.mockClear()
    store.commitGitHubDeliveryReplacement.mockClear()
    await expect(runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' }))
      .resolves.toMatchObject({
        status: 'prepared',
        replayed: true,
        intent: { id: retried.intent.id, deliveryAttempt: 2 },
      })
    expect(runTestCommand).not.toHaveBeenCalled()
    expect(store.commitGitHubDeliveryReplacement).not.toHaveBeenCalled()
  })

  it('starts retry at attempt one when current repository authority creates a new series', async () => {
    const source = fixture()
    const store = fakeStore(source)
    const committedWorkspace = {
      ...source.workspace,
      baseCommitSha,
      headCommitSha: expectedCommitSha,
    }
    let clock = 0
    let sequence = 0
    const runtime = createGitHubDeliveryRuntime({
      store,
      commitWorkspace: vi.fn(async () => ({
        workspace: committedWorkspace,
        baseCommitSha,
        expectedCommitSha,
      })),
      runTestCommand: vi.fn(async () => ({
        status: 'passed' as const,
        exitCode: 0,
        durationMs: 25,
        stdout: 'ok',
        stderr: '',
        redacted: false,
        summary: 'Tests passed.',
      })),
      now: () => [
        '2026-08-11T13:10:00.000Z',
        '2026-08-11T13:13:00.000Z',
      ][clock++]!,
      idGenerator: (prefix) => `${prefix}-${++sequence}`,
    })
    const prepared = await runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' })
    if (prepared.status !== 'prepared') throw new Error('Expected initial preparation')
    const revoked: GitHubDeliveryIntent = {
      ...prepared.intent,
      status: 'revoked',
      updatedAt: '2026-08-11T13:11:00.000Z',
    }
    store.intents[0] = revoked
    source.binding = {
      ...source.binding,
      version: 2,
      validatedAt: '2026-08-11T13:12:00.000Z',
      updatedAt: '2026-08-11T13:12:00.000Z',
    }

    const rebound = await runtime.retry({
      intentId: revoked.id,
      expectedUpdatedAt: revoked.updatedAt,
    })

    expect(rebound).toMatchObject({
      status: 'prepared',
      intent: { deliveryAttempt: 1, repositoryBindingVersion: 2 },
    })
    if (rebound.status !== 'prepared') throw new Error('Expected rebound preparation')
    expect(rebound.intent.deliverySeriesKey).not.toBe(revoked.deliverySeriesKey)
  })

  it('maps raw git failures to one fixed preparation error without retaining the cause', async () => {
    const source = fixture()
    const store = fakeStore(source)
    const rawFailure = 'git -C /private/secret/worktree failed with TOKEN_SENTINEL'
    const runtime = createGitHubDeliveryRuntime({
      store,
      commitWorkspace: vi.fn(async () => {
        throw new Error(rawFailure)
      }),
      runTestCommand: vi.fn(),
    })

    const failure = await runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' })
      .then(() => undefined, (error: unknown) => error)

    expect(failure).toMatchObject({
      name: 'GitHubDeliveryPreparationError',
      code: 'preparation_failed',
      message: 'GitHub Delivery preparation failed safely',
    })
    expect(JSON.stringify(failure)).not.toContain(rawFailure)
    expect(JSON.stringify(failure)).not.toContain('/private/')
    expect(failure).not.toHaveProperty('cause')
  })

  it('rejects a diff without sanitizer provenance before commit or test side effects', async () => {
    const source = fixture()
    const {
      sanitizerVersion: _sanitizerVersion,
      sanitizedAt: _sanitizedAt,
      secretReplacementCount: _secretReplacementCount,
      ...legacyDiff
    } = source.diff
    source.diff = legacyDiff
    const store = fakeStore(source)
    const commitWorkspace = vi.fn()
    const runTestCommand = vi.fn()
    const runtime = createGitHubDeliveryRuntime({
      store,
      commitWorkspace,
      runTestCommand,
    })

    await expect(runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' }))
      .rejects.toMatchObject({
        code: 'preparation_failed',
        message: 'GitHub Delivery preparation failed safely',
      })
    expect(commitWorkspace).not.toHaveBeenCalled()
    expect(runTestCommand).not.toHaveBeenCalled()
    expect(store.commitGitHubDeliveryPreparation).not.toHaveBeenCalled()
  })

  it('commits, records the workspace head, retests the exact worktree, and atomically prepares an intent', async () => {
    const source = fixture()
    const store = fakeStore(source)
    const callOrder: string[] = []
    const committedWorkspace = {
      ...source.workspace,
      baseCommitSha,
      headCommitSha: expectedCommitSha,
    }
    const commitWorkspace = vi.fn(async () => {
      callOrder.push('verify-workspace')
      return {
        workspace: committedWorkspace,
        baseCommitSha,
        expectedCommitSha,
      }
    })
    const runTestCommand = vi.fn(async () => {
      callOrder.push('run-tests')
      return {
        status: 'passed' as const,
        exitCode: 0,
        durationMs: 25,
        stdout: 'ok',
        stderr: '',
        redacted: false,
        summary: 'Tests passed.',
      }
    })
    store.commitManagedCodingWorkspaceHead.mockImplementationOnce(async () => {
      callOrder.push('commit-head')
      store.setWorkspace(committedWorkspace)
      return { committed: true, replayed: false, workspace: committedWorkspace }
    })
    store.commitGitHubDeliveryPreparation.mockImplementationOnce(async (mutation) => {
      callOrder.push('commit-preparation')
      store.evidence.push(mutation.testEvidence)
      store.intents.push(mutation.intent)
      return { committed: true, replayed: false, intent: mutation.intent }
    })

    const runtime = createGitHubDeliveryRuntime({
      store,
      commitWorkspace,
      runTestCommand,
      now: () => '2026-08-11T13:10:00.000Z',
      idGenerator: (prefix) => `${prefix}-1`,
      testTimeoutMs: 120_000,
    })
    const result = await runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' })

    expect(result).toMatchObject({ status: 'prepared', replayed: false })
    if (result.status !== 'prepared') {
      throw new Error('Expected a prepared GitHub Delivery Intent')
    }
    expect(result.intent.expectedCommitSha).toBe(expectedCommitSha)
    expect(result.testEvidence.sourceCommitSha).toBe(expectedCommitSha)
    expect(runTestCommand).toHaveBeenCalledWith({
      command: source.project.testCommand,
      cwd: source.workspace.worktreePath,
      timeoutMs: 120_000,
    })
    expect(commitWorkspace).toHaveBeenCalledTimes(3)
    expect(callOrder).toEqual([
      'verify-workspace',
      'commit-head',
      'verify-workspace',
      'run-tests',
      'verify-workspace',
      'commit-preparation',
    ])
  })

  it('persists commit-bound failed tests without creating a delivery intent or retrying', async () => {
    const source = fixture()
    const store = fakeStore(source)
    const committedWorkspace = {
      ...source.workspace,
      baseCommitSha,
      headCommitSha: expectedCommitSha,
    }
    const commitWorkspace = vi.fn(async () => ({
      workspace: committedWorkspace,
      baseCommitSha,
      expectedCommitSha,
    }))
    const runTestCommand = vi.fn(async () => ({
      status: 'failed' as const,
      exitCode: 1,
      durationMs: 20,
      stdout: '',
      stderr: 'failed',
      redacted: false,
      summary: 'Tests failed.',
    }))
    const runtime = createGitHubDeliveryRuntime({
      store,
      commitWorkspace,
      runTestCommand,
      now: () => '2026-08-11T13:10:00.000Z',
      idGenerator: (prefix) => `${prefix}-1`,
      testTimeoutMs: 120_000,
    })

    const result = await runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' })

    expect(result).toMatchObject({ status: 'tests_failed' })
    expect(store.saveTestEvidence).toHaveBeenCalledTimes(1)
    expect(store.commitGitHubDeliveryPreparation).not.toHaveBeenCalled()
    expect(store.intents).toEqual([])
    expect(runTestCommand).toHaveBeenCalledTimes(1)
  })

  it('replays an exact active intent after re-verifying git without another test or evidence write', async () => {
    const source = fixture()
    const store = fakeStore(source)
    const committedWorkspace = {
      ...source.workspace,
      baseCommitSha,
      headCommitSha: expectedCommitSha,
    }
    const commitWorkspace = vi.fn(async () => ({
      workspace: committedWorkspace,
      baseCommitSha,
      expectedCommitSha,
    }))
    const runTestCommand = vi.fn(async () => ({
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 25,
      stdout: 'ok',
      stderr: '',
      redacted: false,
      summary: 'Tests passed.',
    }))
    const runtime = createGitHubDeliveryRuntime({
      store,
      commitWorkspace,
      runTestCommand,
      now: () => '2026-08-11T13:10:00.000Z',
      idGenerator: (prefix) => `${prefix}-1`,
    })
    const first = await runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' })
    expect(first.status).toBe('prepared')
    commitWorkspace.mockClear()
    runTestCommand.mockClear()
    store.saveTestEvidence.mockClear()
    store.commitGitHubDeliveryPreparation.mockClear()

    const replay = await runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' })

    expect(replay).toMatchObject({ status: 'prepared', replayed: true })
    expect(commitWorkspace).toHaveBeenCalledTimes(1)
    expect(runTestCommand).not.toHaveBeenCalled()
    expect(store.saveTestEvidence).not.toHaveBeenCalled()
    expect(store.commitGitHubDeliveryPreparation).not.toHaveBeenCalled()
  })

  it('replays a completed intent after restart instead of preparing a second logical delivery', async () => {
    const source = fixture()
    const store = fakeStore(source)
    const committedWorkspace = {
      ...source.workspace,
      baseCommitSha,
      headCommitSha: expectedCommitSha,
    }
    const commitWorkspace = vi.fn(async () => ({
      workspace: committedWorkspace,
      baseCommitSha,
      expectedCommitSha,
    }))
    const runTestCommand = vi.fn(async () => ({
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 25,
      stdout: 'ok',
      stderr: '',
      redacted: false,
      summary: 'Tests passed.',
    }))
    const runtime = createGitHubDeliveryRuntime({
      store,
      commitWorkspace,
      runTestCommand,
      now: () => '2026-08-11T13:10:00.000Z',
      idGenerator: (prefix) => `${prefix}-1`,
    })
    const first = await runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' })
    expect(first.status).toBe('prepared')
    store.intents[0] = {
      ...store.intents[0]!,
      status: 'completed',
      updatedAt: '2026-08-11T13:11:00.000Z',
    }
    commitWorkspace.mockClear()
    runTestCommand.mockClear()
    store.commitGitHubDeliveryPreparation.mockClear()

    const replay = await runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' })

    expect(replay).toMatchObject({
      status: 'prepared',
      replayed: true,
      intent: { status: 'completed' },
    })
    expect(commitWorkspace).toHaveBeenCalledTimes(1)
    expect(runTestCommand).not.toHaveBeenCalled()
    expect(store.commitGitHubDeliveryPreparation).not.toHaveBeenCalled()
  })

  it('fails a replay when the real managed worktree no longer matches the approved commit', async () => {
    const source = fixture()
    const store = fakeStore(source)
    const committedWorkspace = {
      ...source.workspace,
      baseCommitSha,
      headCommitSha: expectedCommitSha,
    }
    const commitWorkspace = vi.fn(async () => ({
      workspace: committedWorkspace,
      baseCommitSha,
      expectedCommitSha,
    }))
    const runTestCommand = vi.fn(async () => ({
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 25,
      stdout: 'ok',
      stderr: '',
      redacted: false,
      summary: 'Tests passed.',
    }))
    const runtime = createGitHubDeliveryRuntime({
      store,
      commitWorkspace,
      runTestCommand,
      now: () => '2026-08-11T13:10:00.000Z',
      idGenerator: (prefix) => `${prefix}-1`,
    })
    await runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' })
    commitWorkspace.mockRejectedValueOnce(
      new Error('git -C /private/changed/worktree reported a dirty tree'),
    )
    runTestCommand.mockClear()
    store.commitGitHubDeliveryPreparation.mockClear()

    await expect(runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' }))
      .rejects.toMatchObject({
        name: 'GitHubDeliveryPreparationError',
        code: 'preparation_failed',
      })
    expect(runTestCommand).not.toHaveBeenCalled()
    expect(store.commitGitHubDeliveryPreparation).not.toHaveBeenCalled()
  })

  it('singleflights concurrent preparation for the same Run and PR node', async () => {
    const source = fixture()
    const store = fakeStore(source)
    const committedWorkspace = {
      ...source.workspace,
      baseCommitSha,
      headCommitSha: expectedCommitSha,
    }
    const commitWorkspace = vi.fn(async () => ({
      workspace: committedWorkspace,
      baseCommitSha,
      expectedCommitSha,
    }))
    let markTestStarted!: () => void
    const testStarted = new Promise<void>((resolve) => {
      markTestStarted = resolve
    })
    let finishTest!: (result: {
      status: 'passed'
      exitCode: 0
      durationMs: number
      stdout: string
      stderr: string
      redacted: boolean
      summary: string
    }) => void
    const testFinished = new Promise<{
      status: 'passed'
      exitCode: 0
      durationMs: number
      stdout: string
      stderr: string
      redacted: boolean
      summary: string
    }>((resolve) => {
      finishTest = resolve
    })
    const runTestCommand = vi.fn(() => {
      markTestStarted()
      return testFinished
    })
    const runtime = createGitHubDeliveryRuntime({
      store,
      commitWorkspace,
      runTestCommand,
      now: () => '2026-08-11T13:10:00.000Z',
      idGenerator: (prefix) => `${prefix}-1`,
    })

    const first = runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' })
    await testStarted
    const second = runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' })
    expect(second).toBe(first)
    finishTest({
      status: 'passed',
      exitCode: 0,
      durationMs: 25,
      stdout: 'ok',
      stderr: '',
      redacted: false,
      summary: 'Tests passed.',
    })

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(runTestCommand).toHaveBeenCalledTimes(1)
    expect(commitWorkspace).toHaveBeenCalledTimes(3)
    expect(store.commitGitHubDeliveryPreparation).toHaveBeenCalledTimes(1)
  })

  it('holds the shared workspace lock through tests and final intent persistence', async () => {
    const source = fixture()
    const store = fakeStore(source)
    const coordinator = createWorkspaceOperationCoordinator()
    const committedWorkspace = {
      ...source.workspace,
      baseCommitSha,
      headCommitSha: expectedCommitSha,
    }
    const commitWorkspace = vi.fn(async () => ({
      workspace: committedWorkspace,
      baseCommitSha,
      expectedCommitSha,
    }))
    let markTestStarted!: () => void
    const testStarted = new Promise<void>((resolve) => {
      markTestStarted = resolve
    })
    let finishTest!: (result: {
      status: 'passed'
      exitCode: 0
      durationMs: number
      stdout: string
      stderr: string
      redacted: boolean
      summary: string
    }) => void
    const testFinished = new Promise<{
      status: 'passed'
      exitCode: 0
      durationMs: number
      stdout: string
      stderr: string
      redacted: boolean
      summary: string
    }>((resolve) => {
      finishTest = resolve
    })
    const runtime = createGitHubDeliveryRuntime({
      store,
      workspaceCoordinator: coordinator,
      commitWorkspace,
      runTestCommand: vi.fn(() => {
        markTestStarted()
        return testFinished
      }),
      now: () => '2026-08-11T13:10:00.000Z',
      idGenerator: (prefix) => `${prefix}-1`,
    })

    const preparation = runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' })
    await testStarted
    let cleanupEntered = false
    const cleanup = coordinator.runExclusive(source.workspace.id, async () => {
      cleanupEntered = true
    })
    await Promise.resolve()
    expect(cleanupEntered).toBe(false)
    finishTest({
      status: 'passed',
      exitCode: 0,
      durationMs: 25,
      stdout: 'ok',
      stderr: '',
      redacted: false,
      summary: 'Tests passed.',
    })

    await preparation
    await cleanup
    expect(cleanupEntered).toBe(true)
    expect(store.commitGitHubDeliveryPreparation).toHaveBeenCalledTimes(1)
  })

  it('reloads and verifies the winning active intent when the final preparation CAS loses the race', async () => {
    const source = fixture()
    const store = fakeStore(source)
    const committedWorkspace = {
      ...source.workspace,
      baseCommitSha,
      headCommitSha: expectedCommitSha,
    }
    const commitWorkspace = vi.fn(async () => ({
      workspace: committedWorkspace,
      baseCommitSha,
      expectedCommitSha,
    }))
    const runTestCommand = vi.fn(async () => ({
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 25,
      stdout: 'ok',
      stderr: '',
      redacted: false,
      summary: 'Tests passed.',
    }))
    store.commitGitHubDeliveryPreparation.mockImplementationOnce(async (mutation) => {
      store.evidence.push(mutation.testEvidence)
      store.intents.push(mutation.intent)
      return { committed: false as const, reason: 'active_intent_exists' as const }
    })
    const runtime = createGitHubDeliveryRuntime({
      store,
      commitWorkspace,
      runTestCommand,
      now: () => '2026-08-11T13:10:00.000Z',
      idGenerator: (prefix) => `${prefix}-1`,
    })

    await expect(runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' }))
      .resolves.toMatchObject({
        status: 'prepared',
        replayed: true,
        intent: { id: 'github-delivery-intent-1' },
      })
    expect(runTestCommand).toHaveBeenCalledTimes(1)
    expect(store.commitGitHubDeliveryPreparation).toHaveBeenCalledTimes(1)
    expect(store.listGitHubDeliveryIntents).toHaveBeenCalledTimes(3)
  })

  it('fails closed before tests when the workspace head CAS loses authority', async () => {
    const source = fixture()
    const store = fakeStore(source)
    const committedWorkspace = {
      ...source.workspace,
      baseCommitSha,
      headCommitSha: expectedCommitSha,
    }
    const commitWorkspace = vi.fn(async () => ({
      workspace: committedWorkspace,
      baseCommitSha,
      expectedCommitSha,
    }))
    store.commitManagedCodingWorkspaceHead.mockResolvedValueOnce({
      committed: false,
      reason: 'source_stale',
    })
    const runTestCommand = vi.fn()
    const runtime = createGitHubDeliveryRuntime({
      store,
      commitWorkspace,
      runTestCommand,
    })

    await expect(runtime.prepare({ runId: source.run.id, nodeId: 'run-1-pr' }))
      .rejects.toMatchObject({
        name: 'GitHubDeliveryPreparationError',
        code: 'preparation_failed',
      })
    expect(runTestCommand).not.toHaveBeenCalled()
    expect(store.commitGitHubDeliveryPreparation).not.toHaveBeenCalled()
  })
})
