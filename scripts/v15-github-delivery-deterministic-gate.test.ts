import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
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
import { createGitHubDeliveryCompletion } from '@ai-devflow/shared'
import type { RequestPrincipal } from '../apps/api/src/auth/request-auth'
import type { GitHubAppClient } from '../apps/api/src/github-app-client'
import { createGitHubDeliveryService } from '../apps/api/src/github-delivery-service'
import type {
  GitHubDeliveryApproval,
  GitHubDeliveryRequest,
} from '../apps/api/src/repositories/github-delivery-contract'
import { createSeedGitHubDeliveryRepository } from '../apps/api/src/repositories/seed-github-delivery-repository'
import {
  resolveGitHubDeliveryRoute,
  type GitHubDeliveryRouteResult,
} from '../apps/api/src/routes/github-delivery-routes'
import {
  createGitHubDeliveryProcessor,
  reconcileCompletedGitHubDeliveryIntents,
  reconcileRemoteCompletedGitHubDeliveryIntents,
} from '../apps/desktop/electron/github-delivery-processor'
import { createGitHubDeliveryRemoteClient } from '../apps/desktop/electron/github-delivery-remote-client'
import { createGitHubDeliveryRuntime } from '../apps/desktop/electron/github-delivery-runtime'
import {
  createGitHubGitPublisher,
  type RunGitCommand,
} from '../apps/desktop/electron/github-git-publisher'
import { createLocalStore, type LocalStore } from '../apps/desktop/electron/local-store'
import { createWorkflowRuntime } from '../apps/desktop/electron/workflow-runtime'
import { createWorkspaceOperationCoordinator } from '../apps/desktop/electron/workspace-operation-coordinator'

const execFileAsync = promisify(execFile)
const organizationId = 'org-v15-gate'
const teamProjectId = 'team-project-v15-gate'
const localProjectId = 'local-project-v15-gate'
const runId = 'run-v15-gate'
const prNodeId = `${runId}-pr`
const fixedNow = '2026-08-11T12:00:00.000Z'
const credentialExpiresAt = '2026-08-11T13:00:00.000Z'
const repositoryName = 'example/project'
const installationId = '12345'
const repositoryId = '98765'
const desktopToken = 'desktop-v15-gate-token'
const ephemeralToken = 'ghs_deterministic_v15_token_123456'
const rawProviderFailure = '/private/provider/output TOKEN_SHOULD_NOT_PERSIST'

const ownerPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-owner-v15-gate',
    organizationId,
    userId: 'owner-v15-gate',
    role: 'owner',
    projectMemberships: [],
  },
  authentication: { kind: 'session_cookie', tokenRecordId: null },
} satisfies RequestPrincipal

const desktopPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-desktop-v15-gate',
    organizationId,
    userId: 'desktop-v15-gate',
    role: 'member',
    projectMemberships: [
      {
        projectId: teamProjectId,
        userId: 'desktop-v15-gate',
        role: 'member',
      },
    ],
  },
  authentication: {
    kind: 'desktop_bearer',
    tokenRecordId: 'desktop-token-record-v15-gate',
  },
} satisfies RequestPrincipal

type CanonicalAuthority = {
  organizationId: string
  projectId: string
  runId: string
  runVersion: number
  currentNodeId: string
  materializedByTokenRecordId: string
}

type GateHarness = Awaited<ReturnType<typeof createGateHarness>>
const cleanupRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
    ),
  )
})

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      LC_ALL: 'C',
      LANG: 'C',
    },
  })
  return result.stdout
}

async function configureRepository(
  harness: GateHarness,
): Promise<GitHubRepositoryBinding> {
  const result = await harness.route(
    'PUT',
    `/api/team/projects/${teamProjectId}/github-repository-binding`,
    ownerPrincipal,
    { installationId, repositoryId, expectedStateVersion: 0 },
  )
  expect(result).toMatchObject({
    status: 201,
    body: {
      binding: { status: 'active', version: 1, redacted: true },
      outcomeCode: 'binding_created',
      replayed: false,
    },
  })
  return (result?.body as { binding: GitHubRepositoryBinding }).binding
}

async function persistDeliverySource(
  store: LocalStore,
  fixture: Awaited<ReturnType<typeof createLocalGitFixture>>,
  binding: GitHubRepositoryBinding,
): Promise<void> {
  const project: LocalProject = {
    id: localProjectId,
    name: 'V1.5 deterministic delivery gate',
    path: fixture.sourcePath,
    packageManager: 'pnpm',
    testCommand: 'node --version',
    createdAt: fixedNow,
    updatedAt: fixedNow,
  }
  const pairing: DesktopPairingCredential = {
    tokenId: desktopPrincipal.authentication.tokenRecordId,
    organizationId,
    projectId: teamProjectId,
    localProjectId,
    userId: desktopPrincipal.session.userId,
    role: 'member',
    authAccountId: desktopPrincipal.session.authAccountId,
    projectMemberships: [...desktopPrincipal.session.projectMemberships],
    createdAt: fixedNow,
  }
  const buildNodeId = `${runId}-build`
  const testNodeId = `${runId}-test`
  const acceptanceNodeId = `${runId}-accept`
  const diffId = 'diff-v15-gate'
  const codingRunId = 'coding-v15-gate'
  const workspaceId = 'workspace-v15-gate'
  const precommitEvidenceId = 'precommit-test-v15-gate'
  const workflowEvidenceId = 'workflow-test-v15-gate'
  const testReportId = `artifact-${workflowEvidenceId}`
  const packageId = `artifact-${runId}-pr-draft-v6`
  const run: WorkflowRun = {
    id: runId,
    version: 7,
    title: 'Deliver one exact reviewed commit',
    request: 'Exercise the complete offline V1.5 GitHub Delivery path.',
    projectId: localProjectId,
    creatorId: desktopPrincipal.session.userId,
    status: 'paused_at_gate',
    currentNodeId: prNodeId,
    branchName: 'ai/non-authoritative-plan',
    createdAt: fixedNow,
    updatedAt: fixedNow,
    nodes: [
      {
        id: buildNodeId,
        stage: 'build',
        title: 'Build',
        subtitle: 'Implement',
        kind: 'task',
        status: 'success',
        ownerId: desktopPrincipal.session.userId,
        requiredRole: 'member',
        retryCount: 0,
        artifactIds: [diffId],
      },
      {
        id: testNodeId,
        stage: 'test',
        title: 'Test',
        subtitle: 'Verify',
        kind: 'test',
        status: 'success',
        ownerId: desktopPrincipal.session.userId,
        requiredRole: 'member',
        retryCount: 0,
        artifactIds: [testReportId],
      },
      {
        id: prNodeId,
        stage: 'pr',
        title: 'PR',
        subtitle: 'Deliver',
        kind: 'pr',
        status: 'running',
        ownerId: desktopPrincipal.session.userId,
        requiredRole: 'member',
        retryCount: 0,
        artifactIds: [packageId],
      },
      {
        id: acceptanceNodeId,
        stage: 'accept',
        title: 'Acceptance',
        subtitle: 'Accept',
        kind: 'acceptance',
        status: 'pending',
        ownerId: ownerPrincipal.session.userId,
        requiredRole: 'lead',
        retryCount: 0,
        artifactIds: [],
      },
    ],
    edges: [
      {
        id: `${prNodeId}-${acceptanceNodeId}`,
        source: prNodeId,
        target: acceptanceNodeId,
        kind: 'normal',
      },
    ],
  }
  const codingRun: CodingAgentRun = {
    id: codingRunId,
    runId,
    nodeId: buildNodeId,
    projectId: localProjectId,
    requestedBy: desktopPrincipal.session.userId,
    providerId: 'offline-gate',
    engine: 'fake',
    status: 'completed',
    managedWorkspaceId: workspaceId,
    branchName: fixture.branchName,
    userInstruction: 'Make the reviewed offline change.',
    prompt: 'redacted',
    summary: 'Offline change completed.',
    changedPaths: ['src/delivery.txt'],
    startedAt: fixedNow,
    completedAt: fixedNow,
    diffArtifactId: diffId,
    testEvidenceId: precommitEvidenceId,
    redacted: true,
  }
  const workspace: ManagedCodingWorkspace = {
    id: workspaceId,
    projectId: localProjectId,
    codingRunId,
    sourcePath: fixture.sourcePath,
    worktreePath: fixture.worktreePath,
    branchName: fixture.branchName,
    baseBranch: 'main',
    baseCommitSha: fixture.baseCommitSha,
    createdAt: fixedNow,
    cleanupStatus: 'active',
  }
  const diff: CodingDiffArtifact = {
    id: diffId,
    runId,
    nodeId: buildNodeId,
    projectId: localProjectId,
    changedPaths: ['src/delivery.txt'],
    patch: '+[REDACTED]',
    sourceDigest: fixture.diffDigest,
    truncated: false,
    redacted: true,
    createdAt: fixedNow,
  }
  const precommitEvidence: TestEvidence = {
    id: precommitEvidenceId,
    runId,
    nodeId: buildNodeId,
    projectId: localProjectId,
    command: project.testCommand,
    cwd: fixture.worktreePath,
    status: 'passed',
    exitCode: 0,
    durationMs: 1,
    stdout: '',
    stderr: '',
    summary: 'Pre-commit check passed.',
    redacted: true,
    createdAt: fixedNow,
  }
  const workflowEvidence: TestEvidence = {
    ...precommitEvidence,
    id: workflowEvidenceId,
    nodeId: testNodeId,
    summary: 'Workflow test evidence passed.',
  }
  const testReport: Artifact = {
    id: testReportId,
    runId,
    nodeId: testNodeId,
    kind: 'test_report',
    title: 'Offline test report',
    summary: workflowEvidence.summary,
    content: workflowEvidence.summary,
    redacted: true,
    updatedAt: fixedNow,
  }
  const prPackage: Artifact = {
    id: packageId,
    runId,
    nodeId: prNodeId,
    kind: 'pr',
    title: 'PR Draft: deterministic V1.5 delivery',
    summary: 'Exact commit and test evidence package.',
    content: '# Deterministic V1.5 delivery\n\nOffline integration evidence only.',
    redacted: true,
    updatedAt: fixedNow,
    githubDeliverySource: {
      stateVersion: 1,
      codingRunId,
      workspaceId,
      diffArtifactId: diffId,
      diffSourceDigest: fixture.diffDigest,
      testEvidenceId: precommitEvidenceId,
      headBranch: fixture.branchName,
    },
  }

  await store.upsertProject(project)
  await store.saveDesktopPairingCredential(pairing, 'encrypted-desktop-token')
  await store.saveGitHubRepositoryBinding(binding)
  await store.saveRun(run)
  await store.saveCodingAgentRun(codingRun)
  await store.saveManagedCodingWorkspace(workspace)
  await store.saveCodingDiffArtifact(diff)
  await store.saveTestEvidence(precommitEvidence)
  await store.saveTestEvidence(workflowEvidence)
  await store.saveArtifact(testReport)
  await store.saveArtifact(prPackage)
}

async function createLocalGitFixture(root: string) {
  const sourcePath = path.join(root, 'source')
  const worktreePath = path.join(root, 'managed-worktree')
  const bareRemotePath = path.join(root, 'remote.git')
  const branchName = 'devflow/run-v15-gate-build-coding-v15-gate'
  await mkdir(path.join(sourcePath, 'src'), { recursive: true })
  await git(sourcePath, ['init', '-b', 'main'])
  await writeFile(path.join(sourcePath, 'src/delivery.txt'), 'before\n', 'utf8')
  await git(sourcePath, ['add', 'src/delivery.txt'])
  await git(sourcePath, [
    '-c',
    'user.name=Offline Gate',
    '-c',
    'user.email=offline-gate@localhost',
    'commit',
    '--no-gpg-sign',
    '-m',
    'initial fixture',
  ])
  const baseCommitSha = (await git(sourcePath, ['rev-parse', 'HEAD'])).trim()
  await git(sourcePath, ['remote', 'add', 'origin', `https://github.com/${repositoryName}.git`])
  await git(sourcePath, ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'])
  await writeFile(path.join(worktreePath, 'src/delivery.txt'), 'after\n', 'utf8')
  const patch = await git(worktreePath, [
    'diff',
    '--no-ext-diff',
    '--',
    'src/delivery.txt',
  ])
  const diffDigest = createHash('sha256').update(patch, 'utf8').digest('hex')
  await git(root, ['init', '--bare', bareRemotePath])
  return {
    sourcePath,
    worktreePath,
    bareRemotePath,
    branchName,
    baseCommitSha,
    diffDigest,
  }
}

async function createGateHarness() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-v15-gate-'))
  cleanupRoots.push(root)
  const fixture = await createLocalGitFixture(root)
  const dbPath = path.join(root, 'devflow.sqlite')
  let canonicalAuthority: CanonicalAuthority | null = null
  let nextId = 0
  let failNextPullRequest = true
  let pullRequestProviderCalls = 0
  let credentialProviderCalls = 0
  let publisherPushCalls = 0

  const repository = createSeedGitHubDeliveryRepository({
    now: () => new Date(fixedNow),
    id: (kind) => `${kind}-v15-gate-${++nextId}`,
    resolveProjectRole: (input) =>
      input.organizationId === organizationId &&
      input.projectId === teamProjectId &&
      input.userId === ownerPrincipal.session.userId
        ? 'owner'
        : input.organizationId === organizationId &&
            input.projectId === teamProjectId &&
            input.userId === desktopPrincipal.session.userId
          ? 'member'
          : null,
    desktopTokenStillAuthorized: (input) =>
      input.organizationId === organizationId &&
      input.projectId === teamProjectId &&
      input.userId === desktopPrincipal.session.userId &&
      input.tokenRecordId === desktopPrincipal.authentication.tokenRecordId,
    resolveCanonicalRunAuthority: (input) =>
      canonicalAuthority &&
      input.organizationId === canonicalAuthority.organizationId &&
      input.projectId === canonicalAuthority.projectId &&
      input.runId === canonicalAuthority.runId
        ? canonicalAuthority
        : null,
  })
  const githubClient: GitHubAppClient = {
    async verifyRepository(input) {
      return {
        ...input,
        repository: repositoryName,
        defaultBranch: 'main',
        private: true,
        visibility: 'private',
        verifiedAt: fixedNow,
      }
    },
    async issueContentsWriteToken(input) {
      credentialProviderCalls += 1
      return {
        ...input,
        token: ephemeralToken,
        expiresAt: credentialExpiresAt,
        permissions: { contents: 'write' },
      }
    },
    async getBranchHead(input) {
      const sha = (
        await git(fixture.bareRemotePath, [
          '--git-dir',
          fixture.bareRemotePath,
          'rev-parse',
          `refs/heads/${input.branch}`,
        ])
      ).trim()
      return {
        repository: input.repository,
        branch: input.branch,
        sha,
        verifiedAt: fixedNow,
      }
    },
    async findDraftPullRequest() {
      return null
    },
    async findOrCreateDraftPullRequest(input) {
      pullRequestProviderCalls += 1
      if (failNextPullRequest) {
        failNextPullRequest = false
        throw new Error(rawProviderFailure)
      }
      return {
        disposition: 'created',
        pullRequest: {
          id: '456789',
          number: 42,
          url: `https://github.com/${input.repository}/pull/42`,
          repository: input.repository,
          baseBranch: input.baseBranch,
          headBranch: input.headBranch,
          headSha: input.expectedHeadSha,
          state: 'open',
          draft: true,
          marker: `<!-- devflow-delivery:${input.idempotencyKey.slice('github-delivery:'.length)} -->`,
          createdAt: fixedNow,
        },
      }
    },
  }
  const service = createGitHubDeliveryService({
    repository,
    client: githubClient,
    clock: () => new Date(fixedNow),
  })

  const route = async (
    method: string,
    pathname: string,
    principal: RequestPrincipal,
    body?: unknown,
  ): Promise<GitHubDeliveryRouteResult | null> =>
    resolveGitHubDeliveryRoute(
      method,
      pathname,
      repository,
      service,
      body === undefined ? { principal } : { principal, body },
    )

  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    )
    const headers = new Headers(init?.headers)
    if (headers.get('authorization') !== `Bearer ${desktopToken}`) {
      return new Response(
        JSON.stringify({
          error: 'unauthorized',
          message: 'Desktop pairing required.',
          outcomeCode: 'authentication_forbidden',
          replayed: false,
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      )
    }
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const result = await route(method, url.pathname, desktopPrincipal, body)
    if (!result) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    })
  }
  const remote = createGitHubDeliveryRemoteClient({
    apiBaseUrl: 'https://api.devflow.test',
    authToken: desktopToken,
    fetcher,
  })
  const runGit: RunGitCommand = async (input) => {
    const canonical = `https://github.com/${repositoryName}.git`
    const args = input.args.map((argument) =>
      argument === canonical ? fixture.bareRemotePath : argument,
    )
    if (args[0] === 'push') publisherPushCalls += 1
    const result = await execFileAsync('git', args, {
      cwd: input.cwd,
      env: input.env,
      timeout: input.timeoutMs,
      signal: input.signal,
    })
    return { stdout: result.stdout }
  }
  const publisher = createGitHubGitPublisher({ runGit })

  return {
    root,
    fixture,
    dbPath,
    repository,
    remote,
    publisher,
    route,
    setCanonicalAuthority(intent: GitHubDeliveryIntent) {
      canonicalAuthority = {
        organizationId,
        projectId: teamProjectId,
        runId: intent.runId,
        runVersion: intent.runVersion,
        currentNodeId: intent.nodeId,
        materializedByTokenRecordId:
          desktopPrincipal.authentication.tokenRecordId,
      }
    },
    counts() {
      return {
        pullRequestProviderCalls,
        credentialProviderCalls,
        publisherPushCalls,
      }
    },
  }
}

function createProcessor(
  harness: GateHarness,
  store: LocalStore,
  options: { failCompletionCommit?: boolean } = {},
) {
  const coordinator = createWorkspaceOperationCoordinator()
  const preparationRuntime = createGitHubDeliveryRuntime({
    store,
    workspaceCoordinator: coordinator,
    now: () => fixedNow,
    idGenerator: (prefix) => `${prefix}-v15-gate`,
  })
  const processor = createGitHubDeliveryProcessor({
    store: options.failCompletionCommit
      ? {
          listGitHubDeliveryIntents: (runId?: string) =>
            store.listGitHubDeliveryIntents(runId),
          listArtifacts: (selectedRunId?: string) =>
            store.listArtifacts(selectedRunId),
          listManagedCodingWorkspaces: (projectId?: string) =>
            store.listManagedCodingWorkspaces(projectId),
          getRun: (selectedRunId: string) => store.getRun(selectedRunId),
          commitGitHubDeliveryIntentStatus: (mutation) =>
            store.commitGitHubDeliveryIntentStatus(mutation),
          commitGitHubDeliveryIntentCompletion: async () => {
            throw new Error(rawProviderFailure)
          },
        }
      : store,
    remote: harness.remote,
    publisher: harness.publisher,
    workflow: createWorkflowRuntime(store),
    preparationRuntime,
    workspaceCoordinator: coordinator,
    now: () => fixedNow,
    maxIntentsPerCycle: 1,
  })
  return { processor, preparationRuntime }
}

async function approveRequest(
  harness: GateHarness,
  request: GitHubDeliveryRequest,
): Promise<GitHubDeliveryApproval> {
  const pathname = `/api/team/projects/${teamProjectId}/github-deliveries/${request.id}/approve`
  await expect(
    harness.route('POST', pathname, desktopPrincipal, {
      expectedStateVersion: request.stateVersion,
    }),
  ).resolves.toMatchObject({
    status: 403,
    body: { outcomeCode: 'authentication_forbidden' },
  })
  const approved = await harness.route('POST', pathname, ownerPrincipal, {
    expectedStateVersion: request.stateVersion,
  })
  expect(approved).toMatchObject({
    status: 200,
    body: {
      request: { status: 'approved' },
      approval: {
        approvedRole: 'owner',
        authenticationKind: 'session_cookie',
      },
      outcomeCode: 'delivery_approved',
      replayed: false,
    },
  })
  return (approved?.body as { approval: GitHubDeliveryApproval }).approval
}

describe('V1.5 deterministic GitHub Delivery gate', () => {
  it('read-only reconciles a remote-completed/local-uncommitted crash after binding revocation', async () => {
    const harness = await createGateHarness()
    const binding = await configureRepository(harness)
    const store = await createLocalStore({ dbPath: harness.dbPath })
    await persistDeliverySource(store, harness.fixture, binding)
    const runtime = createProcessor(harness, store)
    const prepared = await runtime.preparationRuntime.prepare({
      runId,
      nodeId: prNodeId,
    })
    if (prepared.status !== 'prepared') {
      throw new Error('Expected deterministic delivery preparation to pass')
    }
    harness.setCanonicalAuthority(prepared.intent)
    await expect(runtime.processor.recoverAndAdvance()).resolves.toMatchObject({
      results: [{ disposition: 'submitted' }],
    })
    const request = harness.repository.inspectForTests().requests[0]
    if (!request) throw new Error('Expected submitted delivery request')
    await approveRequest(harness, request)

    await expect(runtime.processor.recoverAndAdvance()).resolves.toMatchObject({
      results: [{ disposition: 'recovery_required' }],
    })
    const interrupted = (await store.listGitHubDeliveryIntents())[0]
    if (!interrupted) throw new Error('Expected interrupted local delivery')
    const faultRuntime = createProcessor(harness, store, {
      failCompletionCommit: true,
    })
    await expect(faultRuntime.processor.resume({
      intentId: interrupted.id,
      expectedUpdatedAt: interrupted.updatedAt,
    })).resolves.toMatchObject({
      disposition: 'recovery_required',
      outcomeCode: 'processor_failed',
    })
    const locallyInterrupted = (await store.listGitHubDeliveryIntents())[0]
    expect(locallyInterrupted?.status).toBe('recovery_required')
    expect(locallyInterrupted?.completion).toBeUndefined()
    const completedSnapshot = await harness.remote.getRecoverySnapshot({
      projectId: teamProjectId,
      requestId: request.id,
    })
    expect(completedSnapshot.request).toMatchObject({
      status: 'completed',
      outcomeCode: 'draft_pr_created',
    })

    const revoked = await harness.route(
      'POST',
      `/api/team/projects/${teamProjectId}/github-repository-binding/revoke`,
      ownerPrincipal,
      { expectedStateVersion: binding.version },
    )
    expect(revoked).toMatchObject({
      status: 200,
      body: { binding: { status: 'revoked', version: binding.version + 1 } },
    })
    await store.saveGitHubRepositoryBinding(
      (revoked?.body as { binding: GitHubRepositoryBinding }).binding,
    )
    store.close()

    const providerCountsBeforeReconciliation = harness.counts()
    const reopened = await createLocalStore({ dbPath: harness.dbPath })
    await expect(reconcileRemoteCompletedGitHubDeliveryIntents({
      store: reopened,
      remote: harness.remote,
      workflow: createWorkflowRuntime(reopened),
      now: () => '2026-08-11T12:06:00.000Z',
      maxIntentsPerCycle: 1,
      maxIntentsScannedPerCycle: 1,
    })).resolves.toEqual({
      results: [{
        intentId: interrupted.id,
        remoteRequestId: request.id,
        disposition: 'workflow_advanced',
        outcomeCode: 'draft_pr_created',
      }],
    })
    expect(await reopened.getRun(runId)).toMatchObject({
      currentNodeId: `${runId}-accept`,
      pullRequestUrl: `https://github.com/${repositoryName}/pull/42`,
    })
    expect(harness.counts()).toEqual(providerCountsBeforeReconciliation)
    const serialized = JSON.stringify({
      completion: (await reopened.listGitHubDeliveryIntents())[0]?.completion,
      run: await reopened.getRun(runId),
    })
    expect(serialized).not.toContain(ephemeralToken)
    expect(serialized).not.toContain(harness.fixture.worktreePath)
    expect(serialized).not.toContain(rawProviderFailure)
    reopened.close()
  })

  it('reconciles durable completion after restart even when the current binding is revoked', async () => {
    const harness = await createGateHarness()
    const binding = await configureRepository(harness)
    const store = await createLocalStore({ dbPath: harness.dbPath })
    await persistDeliverySource(store, harness.fixture, binding)
    const runtime = createProcessor(harness, store)
    const prepared = await runtime.preparationRuntime.prepare({
      runId,
      nodeId: prNodeId,
    })
    if (prepared.status !== 'prepared') {
      throw new Error('Expected deterministic delivery preparation to pass')
    }

    let current = prepared.intent
    const transitions: Array<{
      status: GitHubDeliveryIntent['status']
      updatedAt: string
    }> = [
      { status: 'approved', updatedAt: '2026-08-11T12:01:00.000Z' },
      { status: 'publishing_branch', updatedAt: '2026-08-11T12:02:00.000Z' },
      { status: 'branch_published', updatedAt: '2026-08-11T12:03:00.000Z' },
      { status: 'creating_pr', updatedAt: '2026-08-11T12:04:00.000Z' },
    ]
    for (const transition of transitions) {
      const next: GitHubDeliveryIntent = { ...current, ...transition }
      const committed = await store.commitGitHubDeliveryIntentStatus({
        expectedIntent: current,
        intent: next,
      })
      if (!committed.committed) {
        throw new Error('Expected deterministic delivery transition to commit')
      }
      current = committed.intent
    }
    const completion = createGitHubDeliveryCompletion({
      intent: current,
      remoteRequestId: 'request-local-completion-v15-gate',
      publicationId: 'publication-local-completion-v15-gate',
      pullRequestOutcomeId: 'pull-request-local-completion-v15-gate',
      pullRequestId: '456789',
      pullRequestNumber: 42,
      pullRequestUrl: `https://github.com/${repositoryName}/pull/42`,
      repository: current.repository,
      baseBranch: current.baseBranch,
      headBranch: current.headBranch,
      headSha: current.expectedCommitSha,
      draft: true,
      providerCreatedAt: '2026-08-11T12:04:30.000Z',
      recordedAt: '2026-08-11T12:05:00.000Z',
    })
    const completed = {
      ...current,
      status: 'completed' as const,
      completion,
      updatedAt: completion.recordedAt,
    }
    await expect(store.commitGitHubDeliveryIntentCompletion({
      expectedIntent: current,
      intent: completed,
    })).resolves.toMatchObject({ committed: true, replayed: false })

    const revoked = await harness.route(
      'POST',
      `/api/team/projects/${teamProjectId}/github-repository-binding/revoke`,
      ownerPrincipal,
      { expectedStateVersion: binding.version },
    )
    expect(revoked).toMatchObject({
      status: 200,
      body: { binding: { status: 'revoked', version: binding.version + 1 } },
    })
    await store.saveGitHubRepositoryBinding(
      (revoked?.body as { binding: GitHubRepositoryBinding }).binding,
    )
    store.close()

    const reopened = await createLocalStore({ dbPath: harness.dbPath })
    await expect(reconcileCompletedGitHubDeliveryIntents({
      store: reopened,
      workflow: createWorkflowRuntime(reopened),
      now: () => '2026-08-11T12:06:00.000Z',
      maxIntentsPerCycle: 1,
    })).resolves.toEqual({
      results: [{
        intentId: completed.id,
        remoteRequestId: completion.remoteRequestId,
        disposition: 'workflow_advanced',
        outcomeCode: 'draft_pr_created',
      }],
    })
    expect(await reopened.getRun(runId)).toMatchObject({
      currentNodeId: `${runId}-accept`,
      pullRequestUrl: completion.pullRequestUrl,
    })
    expect(harness.counts()).toEqual({
      pullRequestProviderCalls: 0,
      credentialProviderCalls: 0,
      publisherPushCalls: 0,
    })
    reopened.close()
  })

  it('recovers one exact delivery after a push/PR restart without replaying provider effects or leaking delivery secrets', async () => {
    const harness = await createGateHarness()
    const binding = await configureRepository(harness)
    const firstStore = await createLocalStore({ dbPath: harness.dbPath })
    await persistDeliverySource(firstStore, harness.fixture, binding)
    const firstRuntime = createProcessor(harness, firstStore)
    const prepared = await firstRuntime.preparationRuntime.prepare({
      runId,
      nodeId: prNodeId,
    })
    expect(prepared).toMatchObject({ status: 'prepared', replayed: false })
    if (prepared.status !== 'prepared') {
      throw new Error('Expected deterministic delivery preparation to pass')
    }
    expect(
      (await firstStore.listManagedCodingWorkspaces(localProjectId))[0],
    ).toMatchObject({
      cleanupStatus: 'active',
      headCommitSha: prepared.intent.expectedCommitSha,
    })
    expect(
      (await firstStore.listManagedCodingWorkspaces(localProjectId))[0]
        ?.deletedAt,
    ).toBeUndefined()
    harness.setCanonicalAuthority(prepared.intent)

    const submitted = await firstRuntime.processor.recoverAndAdvance()
    expect(submitted).toEqual({
      results: [
        {
          intentId: prepared.intent.id,
          remoteRequestId: expect.any(String),
          disposition: 'submitted',
          outcomeCode: 'delivery_created',
        },
      ],
    })
    const request = harness.repository.inspectForTests().requests[0]
    if (!request) throw new Error('Expected submitted delivery request')
    await approveRequest(harness, request)

    const interrupted = await firstRuntime.processor.recoverAndAdvance()
    expect(interrupted.results).toEqual([
      expect.objectContaining({
        intentId: prepared.intent.id,
        remoteRequestId: request.id,
        disposition: 'recovery_required',
      }),
    ])
    expect(harness.counts()).toEqual({
      pullRequestProviderCalls: 1,
      credentialProviderCalls: 1,
      publisherPushCalls: 1,
    })
    expect(
      (
        await git(harness.fixture.bareRemotePath, [
          '--git-dir',
          harness.fixture.bareRemotePath,
          'rev-parse',
          `refs/heads/${prepared.intent.headBranch}`,
        ])
      ).trim(),
    ).toBe(prepared.intent.expectedCommitSha)

    const interruptedIntent = (await firstStore.listGitHubDeliveryIntents())[0]
    if (!interruptedIntent) throw new Error('Expected durable interrupted intent')
    firstStore.close()

    const restartedStore = await createLocalStore({ dbPath: harness.dbPath })
    const restartedRuntime = createProcessor(harness, restartedStore)
    const resumed = await restartedRuntime.processor.resume({
      intentId: interruptedIntent.id,
      expectedUpdatedAt: interruptedIntent.updatedAt,
    })
    expect(resumed).toEqual({
      intentId: interruptedIntent.id,
      remoteRequestId: request.id,
      disposition: 'workflow_advanced',
      outcomeCode: 'draft_pr_created',
    })
    expect(harness.counts()).toEqual({
      pullRequestProviderCalls: 2,
      credentialProviderCalls: 1,
      publisherPushCalls: 1,
    })

    const completedRun = await restartedStore.getRun(runId)
    expect(completedRun).toMatchObject({
      currentNodeId: `${runId}-accept`,
      status: 'paused_at_gate',
      pullRequestUrl: `https://github.com/${repositoryName}/pull/42`,
    })
    expect(completedRun?.nodes.find((node) => node.id === prNodeId)).toMatchObject({
      status: 'success',
    })
    await expect(restartedRuntime.processor.recoverAndAdvance()).resolves.toEqual({
      results: [],
    })

    const remoteSnapshot = await harness.remote.getRecoverySnapshot({
      projectId: teamProjectId,
      requestId: request.id,
    })
    const replayedPullRequest = await harness.remote.createDraftPullRequest({
      projectId: teamProjectId,
      requestId: request.id,
      publicationId: remoteSnapshot.publication!.id,
      expectedStateVersion: remoteSnapshot.request.stateVersion,
    })
    expect(replayedPullRequest).toMatchObject({
      replayed: true,
      request: { status: 'completed' },
      pullRequest: { status: 'completed', pullRequestNumber: 42 },
    })
    expect(harness.counts()).toEqual({
      pullRequestProviderCalls: 2,
      credentialProviderCalls: 1,
      publisherPushCalls: 1,
    })

    const rendererDeliveryProjection = (
      await restartedStore.loadState()
    ).githubDeliveryIntents
    const durableRemoteProjection = harness.repository.inspectForTests()
    for (const projection of [
      resumed,
      remoteSnapshot,
      rendererDeliveryProjection,
      durableRemoteProjection,
    ]) {
      const serialized = JSON.stringify(projection)
      expect(serialized).not.toContain(ephemeralToken)
      expect(serialized).not.toContain(harness.fixture.worktreePath)
      expect(serialized).not.toContain(harness.fixture.sourcePath)
      expect(serialized).not.toContain(rawProviderFailure)
      expect(serialized).not.toContain('TOKEN_SHOULD_NOT_PERSIST')
    }
    restartedStore.close()
    expect(await readFile(harness.dbPath)).toBeInstanceOf(Buffer)
  })

  it('blocks a new credential grant after owner revocation without invoking the token or publisher boundary', async () => {
    const harness = await createGateHarness()
    const binding = await configureRepository(harness)
    const store = await createLocalStore({ dbPath: harness.dbPath })
    await persistDeliverySource(store, harness.fixture, binding)
    const runtime = createProcessor(harness, store)
    const prepared = await runtime.preparationRuntime.prepare({
      runId,
      nodeId: prNodeId,
    })
    if (prepared.status !== 'prepared') {
      throw new Error('Expected deterministic delivery preparation to pass')
    }
    harness.setCanonicalAuthority(prepared.intent)
    const submitted = await harness.remote.submit({
      projectId: teamProjectId,
      intent: prepared.intent,
      prTitle: 'PR Draft: deterministic V1.5 delivery',
      prBody: 'Offline integration evidence only.',
      expectedStateVersion: 0,
    })
    await approveRequest(harness, submitted.request)

    await expect(
      harness.route(
        'POST',
        `/api/team/projects/${teamProjectId}/github-repository-binding/revoke`,
        ownerPrincipal,
        { expectedStateVersion: binding.version },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        binding: { status: 'revoked', version: binding.version + 1 },
        outcomeCode: 'binding_revoked',
        replayed: false,
      },
    })
    const revokedRequest = harness.repository.inspectForTests().requests[0]
    if (!revokedRequest) throw new Error('Expected revoked delivery request')
    expect(revokedRequest).toMatchObject({
      status: 'revoked',
      outcomeCode: 'binding_revoked',
    })
    let publisherCalled = false

    const rejected = await harness.remote
      .withCredentialGrant(
        {
          projectId: teamProjectId,
          requestId: revokedRequest.id,
          expectedStateVersion: revokedRequest.stateVersion,
        },
        async (credential) => {
          publisherCalled = true
          return {
            outcome: 'pushed' as const,
            expectedCommitSha: credential.expectedCommitSha,
            repository: credential.repository,
            headBranch: credential.headBranch,
          }
        },
      )
      .then(() => null, (error: unknown) => error)

    expect(rejected).toMatchObject({
      name: 'GitHubDeliveryRemoteError',
      code: 'conflict',
      operation: 'credential_grant',
      outcomeCode: 'approval_required',
    })
    expect(publisherCalled).toBe(false)
    expect(harness.counts()).toEqual({
      pullRequestProviderCalls: 0,
      credentialProviderCalls: 0,
      publisherPushCalls: 0,
    })
    expect(harness.repository.inspectForTests().grants).toEqual([])
    const serialized = JSON.stringify(rejected)
    expect(serialized).not.toContain(ephemeralToken)
    expect(serialized).not.toContain(harness.fixture.worktreePath)
    expect(serialized).not.toContain(rawProviderFailure)
    store.close()
  })
})
