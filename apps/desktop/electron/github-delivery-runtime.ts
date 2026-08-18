import { randomUUID } from 'node:crypto'
import {
  createGitHubDeliveryIntent,
  hasSupportedCodingDiffSanitization,
  redactTestEvidenceForStorage,
  validateTestCommandSafety,
  type Artifact,
  type CodingAgentRun,
  type CodingDiffArtifact,
  type DesktopPairingCredential,
  type GitHubDeliveryIntent,
  type GitHubRepositoryBinding,
  type LocalProject,
  type ManagedCodingWorkspace,
  type TestEvidence,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import {
  commitManagedCodingWorkspace,
  type CommitManagedCodingWorkspaceInput,
  type CommitManagedCodingWorkspaceResult,
} from './coding-runner.js'
import type {
  GitHubDeliveryPreparationMutation,
  GitHubDeliveryPreparationMutationResult,
  GitHubDeliveryReplacementMutation,
  GitHubDeliveryReplacementMutationResult,
  LocalStore,
  ManagedCodingWorkspaceHeadMutation,
  ManagedCodingWorkspaceHeadMutationResult,
} from './local-store.js'
import { runLocalTestCommand, type LocalTestCommandInput, type LocalTestCommandResult } from './test-runner.js'
import {
  createWorkspaceOperationCoordinator,
  type WorkspaceOperationCoordinator,
} from './workspace-operation-coordinator.js'

const REPLAYABLE_DELIVERY_STATUSES = new Set<GitHubDeliveryIntent['status']>([
  'approval_required',
  'approved',
  'publishing_branch',
  'branch_published',
  'creating_pr',
  'completed',
  'recovery_required',
])

type GitHubDeliveryRuntimeStore = Pick<
  LocalStore,
  | 'getRun'
  | 'listProjects'
  | 'getDesktopPairingCredential'
  | 'getGitHubRepositoryBinding'
  | 'listArtifacts'
  | 'listCodingAgentRuns'
  | 'listManagedCodingWorkspaces'
  | 'listCodingDiffArtifacts'
  | 'listTestEvidence'
  | 'listGitHubDeliveryIntents'
  | 'commitManagedCodingWorkspaceHead'
  | 'saveTestEvidence'
  | 'commitGitHubDeliveryPreparation'
  | 'commitGitHubDeliveryReplacement'
>

export type PrepareGitHubDeliveryInput = {
  runId: string
  nodeId: string
}

export type ReviseGitHubDeliveryInput = {
  intentId: string
  expectedUpdatedAt: string
}

export type RetryGitHubDeliveryInput = ReviseGitHubDeliveryInput

export type PrepareGitHubDeliveryResult =
  | {
      status: 'prepared'
      replayed: boolean
      intent: GitHubDeliveryIntent
      testEvidence: TestEvidence & { sourceCommitSha: string }
    }
  | {
      status: 'tests_failed'
      testEvidence: TestEvidence & { sourceCommitSha: string }
    }

export type GitHubDeliveryRuntime = {
  prepare(input: PrepareGitHubDeliveryInput): Promise<PrepareGitHubDeliveryResult>
  revise(input: ReviseGitHubDeliveryInput): Promise<PrepareGitHubDeliveryResult>
  retry(input: RetryGitHubDeliveryInput): Promise<PrepareGitHubDeliveryResult>
}

export class GitHubDeliveryPreparationError extends Error {
  readonly code = 'preparation_failed'

  constructor() {
    super('GitHub Delivery preparation failed safely')
    this.name = 'GitHubDeliveryPreparationError'
  }
}

export type GitHubDeliveryRuntimeDeps = {
  store: GitHubDeliveryRuntimeStore
  commitWorkspace?: (
    input: CommitManagedCodingWorkspaceInput,
  ) => Promise<CommitManagedCodingWorkspaceResult>
  runTestCommand?: (input: LocalTestCommandInput) => Promise<LocalTestCommandResult>
  now?: () => string
  idGenerator?: (prefix: string) => string
  testTimeoutMs?: number
  workspaceCoordinator?: WorkspaceOperationCoordinator
}

type ResolvedDeliverySource = {
  run: WorkflowRun
  prNode: WorkflowNode
  project: LocalProject
  pairing: DesktopPairingCredential
  repositoryBinding: GitHubRepositoryBinding
  codingRun: CodingAgentRun
  workspace: ManagedCodingWorkspace
  diffArtifact: CodingDiffArtifact
  prPackage: Artifact
  precommitTestEvidence: TestEvidence
}

export function createGitHubDeliveryRuntime(
  deps: GitHubDeliveryRuntimeDeps,
): GitHubDeliveryRuntime {
  const commitWorkspace = deps.commitWorkspace ?? commitManagedCodingWorkspace
  const runTestCommand = deps.runTestCommand ?? runLocalTestCommand
  const now = deps.now ?? (() => new Date().toISOString())
  const idGenerator = deps.idGenerator ?? ((prefix: string) => `${prefix}-${randomUUID()}`)
  const testTimeoutMs = deps.testTimeoutMs ?? 120_000
  const workspaceCoordinator = deps.workspaceCoordinator ??
    createWorkspaceOperationCoordinator()
  const inFlight = new Map<string, Promise<PrepareGitHubDeliveryResult>>()

  async function prepareOnce(
    input: PrepareGitHubDeliveryInput,
  ): Promise<PrepareGitHubDeliveryResult> {
    const candidateIntent = await loadExistingIntent(deps.store, input)
    const candidateWorkspaceId = candidateIntent?.workspaceId ??
      (await resolveDeliverySource(deps.store, input)).workspace.id
    return workspaceCoordinator.runExclusive(candidateWorkspaceId, () =>
      prepareLocked(input, candidateWorkspaceId),
    )
  }

  async function prepareLocked(
    input: PrepareGitHubDeliveryInput,
    lockedWorkspaceId: string,
  ): Promise<PrepareGitHubDeliveryResult> {
    const existingIntent = await loadExistingIntent(deps.store, input)
    if (existingIntent) {
      if (existingIntent.workspaceId !== lockedWorkspaceId) {
        throw new Error('GitHub Delivery workspace authority changed before preparation')
      }
      return replayActiveIntent(
        deps.store,
        input,
        existingIntent,
        commitWorkspace,
      )
    }

    const source = await resolveDeliverySource(deps.store, input)
    if (source.workspace.id !== lockedWorkspaceId) {
      throw new Error('GitHub Delivery workspace authority changed before preparation')
    }
    const safety = validateTestCommandSafety(source.project.testCommand)
    if (safety.level === 'blocked') {
      throw new Error('GitHub Delivery Project test command is blocked')
    }

    const committed = await commitWorkspace({
      workspace: source.workspace,
      expectedDiffArtifact: source.diffArtifact,
      runId: source.run.id,
    })
    const headCommit = await deps.store.commitManagedCodingWorkspaceHead({
      expectedWorkspace: source.workspace,
      workspace: committed.workspace,
    } satisfies ManagedCodingWorkspaceHeadMutation)
    if (!headCommit.committed) {
      throw new Error('Managed workspace changed while recording its delivery commit')
    }
    const committedWorkspace = headCommit.workspace

    await commitWorkspace({
      workspace: committedWorkspace,
      expectedDiffArtifact: source.diffArtifact,
      runId: source.run.id,
    })
    const testResult = await runTestCommand({
      command: safety.normalizedCommand,
      cwd: committedWorkspace.worktreePath,
      timeoutMs: testTimeoutMs,
    })
    await commitWorkspace({
      workspace: committedWorkspace,
      expectedDiffArtifact: source.diffArtifact,
      runId: source.run.id,
    })

    const createdAt = now()
    const testEvidence = redactTestEvidenceForStorage({
      id: idGenerator('github-delivery-test'),
      runId: source.run.id,
      nodeId: source.codingRun.nodeId,
      projectId: source.project.id,
      command: safety.normalizedCommand,
      cwd: committedWorkspace.worktreePath,
      status: testResult.status,
      exitCode: testResult.exitCode,
      durationMs: testResult.durationMs,
      stdout: testResult.stdout,
      stderr: testResult.stderr,
      summary: testResult.summary,
      redacted: testResult.redacted,
      sourceCommitSha: committed.expectedCommitSha,
      createdAt,
    }) as TestEvidence & { sourceCommitSha: string }

    if (testEvidence.status !== 'passed' || testEvidence.exitCode !== 0) {
      await deps.store.saveTestEvidence(testEvidence)
      return { status: 'tests_failed', testEvidence }
    }

    const intent = await createGitHubDeliveryIntent({
      id: idGenerator('github-delivery-intent'),
      repositoryBinding: source.repositoryBinding,
      run: source.run,
      prNodeId: source.prNode.id,
      codingRun: source.codingRun,
      workspace: committedWorkspace,
      diffArtifact: source.diffArtifact,
      prPackage: source.prPackage,
      testEvidence,
      baseCommitSha: committed.baseCommitSha,
      expectedCommitSha: committed.expectedCommitSha,
      now: createdAt,
    })
    const prepared = await deps.store.commitGitHubDeliveryPreparation({
      intent,
      expectedProject: source.project,
      expectedPairingCredential: source.pairing,
      expectedRepositoryBinding: source.repositoryBinding,
      expectedRun: source.run,
      expectedCodingRun: source.codingRun,
      expectedWorkspace: committedWorkspace,
      expectedDiffArtifact: source.diffArtifact,
      testEvidence,
      expectedPrPackage: source.prPackage,
    } satisfies GitHubDeliveryPreparationMutation)
    if (
      !prepared.committed &&
      (prepared.reason === 'active_intent_exists' || prepared.reason === 'id_conflict')
    ) {
      const winner = await loadExistingIntent(deps.store, input)
      if (!winner) {
        throw new Error('GitHub Delivery preparation winner could not be reloaded')
      }
      if (winner.workspaceId !== lockedWorkspaceId) {
        throw new Error('GitHub Delivery preparation winner changed workspace authority')
      }
      return replayActiveIntent(deps.store, input, winner, commitWorkspace)
    }
    return settlePreparationResult(prepared, testEvidence)
  }

  async function replaceOnce(
    kind: GitHubDeliveryReplacementMutation['kind'],
    input: ReviseGitHubDeliveryInput,
  ): Promise<PrepareGitHubDeliveryResult> {
    const candidate = await loadIntentForReplacement(deps.store, kind, input)
    const source = await resolveDeliverySource(deps.store, {
      runId: candidate.runId,
      nodeId: candidate.nodeId,
    })
    return workspaceCoordinator.runExclusive(source.workspace.id, () =>
      replaceLocked(kind, input, source.workspace.id),
    )
  }

  async function replaceLocked(
    kind: GitHubDeliveryReplacementMutation['kind'],
    input: ReviseGitHubDeliveryInput,
    lockedWorkspaceId: string,
  ): Promise<PrepareGitHubDeliveryResult> {
    const expectedIntent = await loadIntentForReplacement(deps.store, kind, input)
    const scopedInput = { runId: expectedIntent.runId, nodeId: expectedIntent.nodeId }
    const source = await resolveDeliverySource(deps.store, scopedInput)
    if (source.workspace.id !== lockedWorkspaceId) {
      throw new Error('GitHub Delivery workspace authority changed before replacement')
    }
    const safety = validateTestCommandSafety(source.project.testCommand)
    if (safety.level === 'blocked') {
      throw new Error('GitHub Delivery Project test command is blocked')
    }

    const committed = await commitWorkspace({
      workspace: source.workspace,
      expectedDiffArtifact: source.diffArtifact,
      runId: source.run.id,
    })
    const headCommit = await deps.store.commitManagedCodingWorkspaceHead({
      expectedWorkspace: source.workspace,
      workspace: committed.workspace,
    } satisfies ManagedCodingWorkspaceHeadMutation)
    if (!headCommit.committed) {
      throw new Error('Managed workspace changed while recording its delivery commit')
    }
    const committedWorkspace = headCommit.workspace
    await commitWorkspace({
      workspace: committedWorkspace,
      expectedDiffArtifact: source.diffArtifact,
      runId: source.run.id,
    })
    const testResult = await runTestCommand({
      command: safety.normalizedCommand,
      cwd: committedWorkspace.worktreePath,
      timeoutMs: testTimeoutMs,
    })
    await commitWorkspace({
      workspace: committedWorkspace,
      expectedDiffArtifact: source.diffArtifact,
      runId: source.run.id,
    })

    const observedAt = now()
    const observedTime = Date.parse(observedAt)
    const expectedTime = Date.parse(expectedIntent.updatedAt)
    if (!Number.isFinite(observedTime) || !Number.isFinite(expectedTime)) {
      throw new Error('GitHub Delivery replacement timestamp is not monotonic')
    }
    const createdAt = new Date(Math.max(observedTime, expectedTime + 1)).toISOString()
    const testEvidence = redactTestEvidenceForStorage({
      id: idGenerator('github-delivery-test'),
      runId: source.run.id,
      nodeId: source.codingRun.nodeId,
      projectId: source.project.id,
      command: safety.normalizedCommand,
      cwd: committedWorkspace.worktreePath,
      status: testResult.status,
      exitCode: testResult.exitCode,
      durationMs: testResult.durationMs,
      stdout: testResult.stdout,
      stderr: testResult.stderr,
      summary: testResult.summary,
      redacted: testResult.redacted,
      sourceCommitSha: committed.expectedCommitSha,
      createdAt,
    }) as TestEvidence & { sourceCommitSha: string }
    if (testEvidence.status !== 'passed' || testEvidence.exitCode !== 0) {
      await deps.store.saveTestEvidence(testEvidence)
      return { status: 'tests_failed', testEvidence }
    }

    const createIntent = (deliveryAttempt: number, id: string) =>
      createGitHubDeliveryIntent({
        id,
        repositoryBinding: source.repositoryBinding,
        run: source.run,
        prNodeId: source.prNode.id,
        codingRun: source.codingRun,
        workspace: committedWorkspace,
        diffArtifact: source.diffArtifact,
        prPackage: source.prPackage,
        testEvidence,
        baseCommitSha: committed.baseCommitSha,
        expectedCommitSha: committed.expectedCommitSha,
        deliveryAttempt,
        now: createdAt,
      })
    const intentId = idGenerator('github-delivery-intent')
    let intent: GitHubDeliveryIntent
    if (kind === 'revision') {
      intent = await createIntent(expectedIntent.deliveryAttempt, intentId)
      if (intent.deliverySeriesKey !== expectedIntent.deliverySeriesKey) {
        throw new Error('GitHub Delivery revision changed delivery series authority')
      }
    } else {
      const firstAttemptCandidate = await createIntent(1, intentId)
      if (firstAttemptCandidate.deliverySeriesKey === expectedIntent.deliverySeriesKey) {
        const scopedIntents = (await deps.store.listGitHubDeliveryIntents(expectedIntent.runId))
          .filter((candidate) =>
            candidate.runId === expectedIntent.runId &&
            candidate.nodeId === expectedIntent.nodeId &&
            candidate.deliverySeriesKey === expectedIntent.deliverySeriesKey,
          )
        const nextAttempt = Math.max(
          ...scopedIntents.map((candidate) => candidate.deliveryAttempt),
        ) + 1
        intent = await createIntent(nextAttempt, intentId)
      } else {
        intent = firstAttemptCandidate
      }
    }

    const replaced = await deps.store.commitGitHubDeliveryReplacement({
      kind,
      expectedIntent,
      intent,
      expectedProject: source.project,
      expectedPairingCredential: source.pairing,
      expectedRepositoryBinding: source.repositoryBinding,
      expectedRun: source.run,
      expectedCodingRun: source.codingRun,
      expectedWorkspace: committedWorkspace,
      expectedDiffArtifact: source.diffArtifact,
      testEvidence,
      expectedPrPackage: source.prPackage,
    } satisfies GitHubDeliveryReplacementMutation)
    return settleReplacementResult(replaced, testEvidence)
  }

  function runSafely(
    key: string,
    operation: () => Promise<PrepareGitHubDeliveryResult>,
  ): Promise<PrepareGitHubDeliveryResult> {
    const existing = inFlight.get(key)
    if (existing) return existing
    const execution = operation()
      .catch((error: unknown) => {
        if (error instanceof GitHubDeliveryPreparationError) throw error
        throw new GitHubDeliveryPreparationError()
      })
      .finally(() => {
        if (inFlight.get(key) === execution) inFlight.delete(key)
      })
    inFlight.set(key, execution)
    return execution
  }

  return {
    prepare(input) {
      const key = `${input.runId}:${input.nodeId}`
      return runSafely(key, () => prepareOnce(input))
    },
    revise(input) {
      return runSafely(`intent:${input.intentId}`, () => replaceOnce('revision', input))
    },
    retry(input) {
      return runSafely(`intent:${input.intentId}`, () => replaceOnce('retry', input))
    },
  }
}

async function loadIntentForReplacement(
  store: GitHubDeliveryRuntimeStore,
  kind: GitHubDeliveryReplacementMutation['kind'],
  input: ReviseGitHubDeliveryInput,
): Promise<GitHubDeliveryIntent> {
  const matches = (await store.listGitHubDeliveryIntents())
    .filter((candidate) => candidate.id === input.intentId)
  if (matches.length !== 1 || matches[0]!.updatedAt !== input.expectedUpdatedAt) {
    throw new Error('GitHub Delivery replacement authority is stale')
  }
  const intent = matches[0]!
  const eligible = kind === 'revision'
    ? intent.status === 'approval_required' || intent.status === 'approved'
    : intent.status === 'failed' || intent.status === 'revoked'
  if (!eligible) {
    throw new Error('GitHub Delivery intent is not eligible for replacement')
  }
  return intent
}

async function loadExistingIntent(
  store: GitHubDeliveryRuntimeStore,
  input: PrepareGitHubDeliveryInput,
): Promise<GitHubDeliveryIntent | undefined> {
  const scopedIntents = (await store.listGitHubDeliveryIntents(input.runId))
    .filter((candidate) =>
      candidate.runId === input.runId &&
      candidate.nodeId === input.nodeId,
    )
  if (scopedIntents.length === 0) {
    return undefined
  }
  const automatic = scopedIntents.filter((candidate) =>
    REPLAYABLE_DELIVERY_STATUSES.has(candidate.status) &&
    candidate.status !== 'completed',
  )
  if (automatic.length > 1) {
    throw new Error('Multiple active GitHub Delivery Intents violate local authority')
  }
  if (automatic[0]) return automatic[0]
  const completed = [...scopedIntents]
    .reverse()
    .find((candidate) => candidate.status === 'completed')
  if (completed) return completed
  throw new Error('A terminal GitHub Delivery Intent requires an explicit recovery action')
}

async function replayActiveIntent(
  store: GitHubDeliveryRuntimeStore,
  input: PrepareGitHubDeliveryInput,
  activeIntent: GitHubDeliveryIntent,
  verifyWorkspace: (
    input: CommitManagedCodingWorkspaceInput,
  ) => Promise<CommitManagedCodingWorkspaceResult>,
): Promise<PrepareGitHubDeliveryResult> {
  const replay = await resolveDeliverySource(store, input, activeIntent)
  const verifiedWorkspace = await verifyWorkspace({
    workspace: replay.workspace,
    expectedDiffArtifact: replay.diffArtifact,
    runId: replay.run.id,
  })
  if (
    verifiedWorkspace.baseCommitSha !== activeIntent.baseCommitSha ||
    verifiedWorkspace.expectedCommitSha !== activeIntent.expectedCommitSha
  ) {
    throw new Error('Existing GitHub Delivery workspace no longer matches its approved commit')
  }
  const testEvidence = replay.precommitTestEvidence as TestEvidence & {
    sourceCommitSha: string
  }
  const canonical = await createGitHubDeliveryIntent({
    id: activeIntent.id,
    repositoryBinding: replay.repositoryBinding,
    run: replay.run,
    prNodeId: replay.prNode.id,
    codingRun: replay.codingRun,
    workspace: replay.workspace,
    diffArtifact: replay.diffArtifact,
    prPackage: replay.prPackage,
    testEvidence,
    baseCommitSha: activeIntent.baseCommitSha,
    expectedCommitSha: activeIntent.expectedCommitSha,
    deliveryAttempt: activeIntent.deliveryAttempt,
    now: activeIntent.createdAt,
  })
  if (
    canonical.intentDigest !== activeIntent.intentDigest ||
    canonical.idempotencyKey !== activeIntent.idempotencyKey ||
    canonical.testEvidenceId !== activeIntent.testEvidenceId
  ) {
    throw new Error('Existing GitHub Delivery Intent no longer matches its source authority')
  }
  return {
    status: 'prepared',
    replayed: true,
    intent: activeIntent,
    testEvidence,
  }
}

function settlePreparationResult(
  result: GitHubDeliveryPreparationMutationResult,
  testEvidence: TestEvidence & { sourceCommitSha: string },
): PrepareGitHubDeliveryResult {
  if (!result.committed) {
    throw new Error(`GitHub Delivery preparation lost source authority: ${result.reason}`)
  }
  return {
    status: 'prepared',
    replayed: result.replayed,
    intent: result.intent,
    testEvidence,
  }
}

function settleReplacementResult(
  result: GitHubDeliveryReplacementMutationResult,
  testEvidence: TestEvidence & { sourceCommitSha: string },
): PrepareGitHubDeliveryResult {
  if (!result.committed) {
    throw new Error(`GitHub Delivery replacement lost source authority: ${result.reason}`)
  }
  return {
    status: 'prepared',
    replayed: result.replayed,
    intent: result.intent,
    testEvidence,
  }
}

async function resolveDeliverySource(
  store: GitHubDeliveryRuntimeStore,
  input: PrepareGitHubDeliveryInput,
  intent?: GitHubDeliveryIntent,
): Promise<ResolvedDeliverySource> {
  const run = await store.getRun(input.runId)
  if (!run) {
    throw new Error('GitHub Delivery Run was not found')
  }
  const prNode = run.nodes.find((candidate) => candidate.id === input.nodeId)
  if (
    !prNode ||
    run.currentNodeId !== prNode.id ||
    prNode.kind !== 'pr' ||
    prNode.stage !== 'pr' ||
    prNode.status !== 'running'
  ) {
    throw new Error('GitHub Delivery requires the current running PR node')
  }

  const [
    projects,
    pairing,
    artifacts,
    codingRuns,
    workspaces,
    diffArtifacts,
    testEvidence,
  ] = await Promise.all([
    store.listProjects(),
    store.getDesktopPairingCredential(),
    store.listArtifacts(run.id),
    store.listCodingAgentRuns(run.id),
    store.listManagedCodingWorkspaces(run.projectId),
    store.listCodingDiffArtifacts(run.id),
    store.listTestEvidence(run.id),
  ])
  const matchingProjects = projects.filter((candidate) => candidate.id === run.projectId)
  if (matchingProjects.length !== 1) {
    throw new Error('GitHub Delivery Local Project authority is missing or ambiguous')
  }
  const project = matchingProjects[0]!
  if (!pairing || pairing.localProjectId !== project.id) {
    throw new Error('GitHub Delivery Desktop pairing does not own the Local Project')
  }
  const repositoryBinding = await store.getGitHubRepositoryBinding(pairing.projectId)
  if (
    !repositoryBinding ||
    repositoryBinding.status !== 'active' ||
    repositoryBinding.organizationId !== pairing.organizationId ||
    repositoryBinding.teamProjectId !== pairing.projectId ||
    (intent && repositoryBinding.id !== intent.repositoryBindingId)
  ) {
    throw new Error('GitHub Delivery repository binding is unavailable or stale')
  }

  const expectedPackageId = intent?.prPackageArtifactId ??
    `artifact-${run.id}-pr-draft-v${run.version - 1}`
  const prPackage = artifacts.find((candidate) => candidate.id === expectedPackageId)
  if (
    !prPackage ||
    !prNode.artifactIds.includes(prPackage.id) ||
    prPackage.runId !== run.id ||
    prPackage.nodeId !== prNode.id ||
    prPackage.kind !== 'pr' ||
    prPackage.redacted !== true ||
    !prPackage.githubDeliverySource
  ) {
    throw new Error('GitHub Delivery PR Package is missing or stale')
  }
  const packageSource = prPackage.githubDeliverySource
  const codingRunId = intent?.codingRunId ?? packageSource.codingRunId
  const workspaceId = intent?.workspaceId ?? packageSource.workspaceId
  const diffArtifactId = intent?.diffArtifactId ?? packageSource.diffArtifactId
  const testEvidenceId = intent?.testEvidenceId ?? packageSource.testEvidenceId
  const codingRun = codingRuns.find((candidate) => candidate.id === codingRunId)
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId)
  const diffArtifact = diffArtifacts.find((candidate) => candidate.id === diffArtifactId)
  const selectedTestEvidence = testEvidence.find((candidate) => candidate.id === testEvidenceId)
  const buildNode = codingRun
    ? run.nodes.find((candidate) => candidate.id === codingRun.nodeId)
    : undefined
  if (
    !codingRun ||
    codingRun.status !== 'completed' ||
    !codingRun.completedAt ||
    !buildNode ||
    buildNode.kind !== 'task' ||
    buildNode.stage !== 'build' ||
    buildNode.status !== 'success' ||
    codingRun.runId !== run.id ||
    codingRun.projectId !== project.id ||
    codingRun.managedWorkspaceId !== workspaceId ||
    codingRun.diffArtifactId !== diffArtifactId ||
    !workspace ||
    workspace.projectId !== project.id ||
    workspace.codingRunId !== codingRun.id ||
    workspace.sourcePath !== project.path ||
    workspace.branchName !== packageSource.headBranch ||
    workspace.baseBranch !== repositoryBinding.defaultBranch ||
    workspace.cleanupStatus !== 'active' ||
    workspace.deletedAt ||
    !workspace.baseCommitSha ||
    !diffArtifact ||
    diffArtifact.runId !== run.id ||
    diffArtifact.nodeId !== codingRun.nodeId ||
    diffArtifact.projectId !== project.id ||
    diffArtifact.id !== packageSource.diffArtifactId ||
    diffArtifact.sourceDigest !== packageSource.diffSourceDigest ||
    diffArtifact.truncated ||
    !hasSupportedCodingDiffSanitization(diffArtifact) ||
    !selectedTestEvidence ||
    selectedTestEvidence.runId !== run.id ||
    selectedTestEvidence.nodeId !== codingRun.nodeId ||
    selectedTestEvidence.projectId !== project.id
  ) {
    throw new Error('GitHub Delivery managed coding source is missing or inconsistent')
  }
  if (
    intent &&
    (
      workspace.headCommitSha !== intent.expectedCommitSha ||
      selectedTestEvidence.sourceCommitSha !== intent.expectedCommitSha ||
      repositoryBinding.version !== intent.repositoryBindingVersion
    )
  ) {
    throw new Error('Existing GitHub Delivery Intent no longer matches its source authority')
  }
  return {
    run,
    prNode,
    project,
    pairing,
    repositoryBinding,
    codingRun,
    workspace,
    diffArtifact,
    prPackage,
    precommitTestEvidence: selectedTestEvidence,
  }
}
