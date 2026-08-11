import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  buildCodingBrief,
  isActiveCodingAgentRunStatus,
  sanitizeCodingDiffArtifact,
  type Artifact,
  type CodingBrief,
  type CodingBriefInput,
  type CodingAgentRun,
  type CodingAgentEvent,
  type CodingDiffArtifact,
  type CodingPermissionRequest,
  type DependencyBootstrapEvidence,
  type GateDecision,
  type KnowledgeChunk,
  type KnowledgeGovernanceCheck,
  type KnowledgeReference,
  type LocalProject,
  type ManagedCodingWorkspace,
  type RemediationPlan,
  type RetryAttempt,
  type TestEvidence,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'

const execFileAsync = promisify(execFile)

export type CreateManagedCodingWorkspaceInput = {
  project: LocalProject
  codingRunId: string
  runId: string
  nodeId: string
  worktreeRoot?: string
}

export type FakeCodingRunBundleInput = {
  id: string
  runId: string
  nodeId: string
  project: LocalProject
  requestedBy: string
  providerId?: string
  userInstruction: string
  workspace: ManagedCodingWorkspace
  now?: string
  run?: WorkflowRun
  node?: WorkflowNode
  upstreamArtifacts?: Artifact[]
  knowledgeReferences?: KnowledgeReference[]
  knowledgeChunks?: KnowledgeChunk[]
  governanceChecks?: KnowledgeGovernanceCheck[]
  gateDecisions?: GateDecision[]
  testEvidence?: TestEvidence[]
  remediationPlan?: RemediationPlan | undefined
  retryAttempt?: RetryAttempt | undefined
  brief?: CodingBrief
}

export type FakeCodingRunBundle = {
  codingRun: CodingAgentRun
  events: CodingAgentEvent[]
  permissionRequest: CodingPermissionRequest
  brief: CodingBrief
}

export type CompleteFakeCodingRunInput = {
  codingRun: CodingAgentRun
  workspace: ManagedCodingWorkspace
  project: LocalProject
  now?: string
}

export type CompleteFakeCodingRunResult = {
  codingRun: CodingAgentRun
  events: CodingAgentEvent[]
  diff: CodingDiffArtifact
  bootstrapEvidence: DependencyBootstrapEvidence
}

export type CapturedWorktreeDiff = {
  changedPaths: string[]
  patch: string
}

export type CommitManagedCodingWorkspaceInput = {
  workspace: ManagedCodingWorkspace
  expectedChangedPaths: string[]
  runId: string
}

export type CommitManagedCodingWorkspaceResult = {
  workspace: ManagedCodingWorkspace & {
    baseCommitSha: string
    headCommitSha: string
  }
  baseCommitSha: string
  expectedCommitSha: string
}

export function findActiveCodingRun(
  runs: CodingAgentRun[],
  projectId: string,
): CodingAgentRun | undefined {
  return runs.find((run) => run.projectId === projectId && isActiveCodingAgentRunStatus(run.status))
}

export async function isGitRepository(repositoryPath: string): Promise<boolean> {
  try {
    await execGit(repositoryPath, ['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}

export async function createManagedCodingWorkspace(
  input: CreateManagedCodingWorkspaceInput,
): Promise<ManagedCodingWorkspace> {
  if (!(await isGitRepository(input.project.path))) {
    throw new Error(`Local project is not a git repository: ${input.project.path}`)
  }

  const baseBranch = await currentBranch(input.project.path)
  const baseCommitSha = await currentCommit(input.project.path)
  const branchName = safeBranchName(`devflow/${input.runId}-${input.nodeId}-${input.codingRunId}`)
  const root = input.worktreeRoot ?? path.join(os.tmpdir(), 'devflow-coding-worktrees')
  const workspaceId = `workspace-${input.codingRunId}`
  const worktreePath = path.join(root, safePathSegment(`${input.runId}-${input.nodeId}-${input.codingRunId}`))

  await mkdir(root, { recursive: true })
  await execGit(input.project.path, ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'])

  return {
    id: workspaceId,
    projectId: input.project.id,
    codingRunId: input.codingRunId,
    sourcePath: input.project.path,
    worktreePath,
    branchName,
    baseBranch,
    baseCommitSha,
    createdAt: new Date().toISOString(),
    cleanupStatus: 'active',
  }
}

export async function commitManagedCodingWorkspace(
  input: CommitManagedCodingWorkspaceInput,
): Promise<CommitManagedCodingWorkspaceResult> {
  if (input.workspace.cleanupStatus !== 'active' || input.workspace.deletedAt) {
    throw new Error('Only an active managed workspace can be committed for delivery')
  }

  const currentBranchName = await currentBranch(input.workspace.worktreePath)
  if (currentBranchName !== input.workspace.branchName) {
    throw new Error('Managed workspace branch changed before delivery commit')
  }
  const currentHead = await currentCommit(input.workspace.worktreePath)

  if (input.workspace.headCommitSha) {
    if (!input.workspace.baseCommitSha || currentHead !== input.workspace.headCommitSha) {
      throw new Error('Managed workspace expected commit changed after delivery preparation')
    }
    const replayStatus = await worktreeStatus(input.workspace.worktreePath)
    if (replayStatus.length > 0) {
      throw new Error('Managed workspace changed after delivery commit')
    }
    return {
      workspace: input.workspace as CommitManagedCodingWorkspaceResult['workspace'],
      baseCommitSha: input.workspace.baseCommitSha,
      expectedCommitSha: input.workspace.headCommitSha,
    }
  }

  const baseCommitSha = input.workspace.baseCommitSha ?? currentHead
  if (currentHead !== baseCommitSha) {
    throw new Error('Managed workspace contains an unrecorded commit')
  }
  const entries = await worktreeStatus(input.workspace.worktreePath)
  const actualPaths = sortedUnique(entries.map((entry) => entry.path))
  const expectedPaths = sortedUnique(input.expectedChangedPaths)
  if (
    actualPaths.length === 0 ||
    actualPaths.length !== expectedPaths.length ||
    actualPaths.some((value, index) => value !== expectedPaths[index])
  ) {
    throw new Error('Managed workspace changed paths do not match reviewed Coding evidence')
  }

  await execGit(input.workspace.worktreePath, ['add', '--', ...expectedPaths])
  const commitMessage = `DevFlow delivery ${input.runId.replace(/[^A-Za-z0-9._-]/gu, '-').slice(0, 100)}`
  await execGit(input.workspace.worktreePath, [
    '-c',
    'user.name=AI DevFlow Studio',
    '-c',
    'user.email=devflow@localhost',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--no-gpg-sign',
    '--no-verify',
    '-m',
    commitMessage,
  ])

  const expectedCommitSha = await currentCommit(input.workspace.worktreePath)
  const parentCommitSha = (await execGit(
    input.workspace.worktreePath,
    ['rev-parse', '--verify', 'HEAD^'],
  )).stdout.trim().toLowerCase()
  if (parentCommitSha !== baseCommitSha) {
    throw new Error('Managed workspace delivery commit is not directly based on the recorded base')
  }
  const finalStatus = await worktreeStatus(input.workspace.worktreePath)
  if (finalStatus.length > 0) {
    throw new Error('Managed workspace was not clean after delivery commit')
  }

  const workspace = {
    ...input.workspace,
    baseCommitSha,
    headCommitSha: expectedCommitSha,
  }
  return {
    workspace,
    baseCommitSha,
    expectedCommitSha,
  }
}

export async function deleteManagedCodingWorkspace(
  workspace: ManagedCodingWorkspace,
): Promise<ManagedCodingWorkspace> {
  const deletedAt = new Date().toISOString()
  try {
    await execGit(workspace.sourcePath, ['worktree', 'remove', '--force', workspace.worktreePath])
    await execGit(workspace.sourcePath, ['worktree', 'prune'])
    return {
      ...workspace,
      deletedAt,
      cleanupStatus: 'deleted',
      cleanupError: undefined,
    }
  } catch (worktreeError) {
    try {
      await rm(workspace.worktreePath, { recursive: true, force: true })
      await execGit(workspace.sourcePath, ['worktree', 'prune'])
      return {
        ...workspace,
        deletedAt,
        cleanupStatus: 'deleted',
        cleanupError: undefined,
      }
    } catch (fallbackError) {
      return {
        ...workspace,
        deletedAt,
        cleanupStatus: 'cleanup_failed',
        cleanupError: cleanupErrorMessage(fallbackError, worktreeError),
      }
    }
  }
}

function cleanupErrorMessage(error: unknown, cause?: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (!cause) {
    return message
  }
  const causeMessage = cause instanceof Error ? cause.message : String(cause)
  return `${message}; initial worktree remove failed: ${causeMessage}`
}

export async function captureWorktreeDiff(input: {
  worktreePath: string
}): Promise<CapturedWorktreeDiff> {
  const { stdout: statusOutput } = await execGit(input.worktreePath, [
    '-c',
    'core.quotePath=false',
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])
  const entries = parsePorcelainStatus(statusOutput)
  if (!entries.length) {
    return { changedPaths: [], patch: '' }
  }

  const untrackedPaths = entries
    .filter((entry) => entry.status === '??')
    .map((entry) => entry.path)
  if (untrackedPaths.length) {
    await execGit(input.worktreePath, ['add', '-N', '--', ...untrackedPaths])
  }

  const changedPaths = Array.from(new Set(entries.map((entry) => entry.path)))
  const { stdout: patch } = await execGit(input.worktreePath, [
    'diff',
    '--no-ext-diff',
    'HEAD',
    '--',
    ...changedPaths,
  ])

  return { changedPaths, patch }
}

export function createFakeCodingRunBundle(input: FakeCodingRunBundleInput): FakeCodingRunBundle {
  const now = input.now ?? new Date().toISOString()
  const node = input.node ?? fakeNode(input.nodeId)
  const run = input.run ?? fakeRun(input.runId, input.project.id, input.nodeId)
  const brief = input.brief ?? buildCodingBrief({
    run,
    node,
    project: input.project,
    upstreamArtifacts: input.upstreamArtifacts ?? [],
    knowledgeReferences: input.knowledgeReferences ?? [],
    knowledgeChunks: input.knowledgeChunks ?? [],
    governanceChecks: input.governanceChecks ?? [],
    gateDecisions: input.gateDecisions ?? [],
    testEvidence: input.testEvidence ?? [],
    remediationPlan: input.remediationPlan,
    retryAttempt: input.retryAttempt,
    userInstruction: input.userInstruction,
    worktreePath: input.workspace.worktreePath,
    branchName: input.workspace.branchName,
  } satisfies CodingBriefInput)

  const codingRun: CodingAgentRun = {
    id: input.id,
    runId: input.runId,
    nodeId: input.nodeId,
    projectId: input.project.id,
    requestedBy: input.requestedBy,
    providerId: input.providerId ?? 'fake-coding-engine',
    engine: 'fake',
    status: 'waiting_permission',
    managedWorkspaceId: input.workspace.id,
    branchName: input.workspace.branchName,
    userInstruction: brief.userInstruction,
    prompt: brief.prompt,
    summary: 'Waiting for permission to apply the fake coding diff.',
    changedPaths: [],
    startedAt: now,
    redacted: true,
  }
  const permissionRequest: CodingPermissionRequest = {
    id: `permission-${randomUUID()}`,
    codingRunId: codingRun.id,
    runId: input.runId,
    nodeId: input.nodeId,
    permission: 'edit',
    title: 'Apply fake coding diff',
    filePath: 'devflow-fake-change.txt',
    diffPreview: '+DevFlow fake coding adapter was approved.',
    risk: 'warn',
    reasons: ['Coding agents must ask before writing files in the managed worktree.'],
    status: 'pending',
    requestedAt: now,
    expiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
  }
  const events: CodingAgentEvent[] = [
    {
      id: `coding-event-${randomUUID()}`,
      codingRunId: codingRun.id,
      runId: input.runId,
      nodeId: input.nodeId,
      sequence: 1,
      kind: 'brief',
      message: 'DevFlow assembled a coding brief from run, node, knowledge, gate, and test context.',
      timestamp: now,
      redacted: true,
    },
    {
      id: `coding-event-${randomUUID()}`,
      codingRunId: codingRun.id,
      runId: input.runId,
      nodeId: input.nodeId,
      sequence: 2,
      kind: 'permission',
      message: 'Fake coding engine requested edit permission.',
      timestamp: now,
      metadata: { requestId: permissionRequest.id },
      redacted: true,
    },
  ]

  return { codingRun, events, permissionRequest, brief }
}

export async function completeFakeCodingRun(
  input: CompleteFakeCodingRunInput,
): Promise<CompleteFakeCodingRunResult> {
  const now = input.now ?? new Date().toISOString()
  const markerPath = path.join(input.workspace.worktreePath, 'devflow-fake-change.txt')
  await writeFile(
    markerPath,
    [
      'DevFlow fake coding adapter was approved.',
      `Instruction: ${input.codingRun.userInstruction}`,
      `Run: ${input.codingRun.runId}`,
      '',
    ].join('\n'),
  )
  const capturedDiff = await captureWorktreeDiff({ worktreePath: input.workspace.worktreePath })
  const diff = sanitizeCodingDiffArtifact({
    id: `coding-diff-${input.codingRun.id}`,
    runId: input.codingRun.runId,
    nodeId: input.codingRun.nodeId,
    projectId: input.project.id,
    changedPaths: capturedDiff.changedPaths,
    patch: capturedDiff.patch,
    createdAt: now,
  })
  const bootstrapEvidence: DependencyBootstrapEvidence = {
    id: `bootstrap-${input.codingRun.id}`,
    codingRunId: input.codingRun.id,
    runId: input.codingRun.runId,
    nodeId: input.codingRun.nodeId,
    projectId: input.project.id,
    command: '',
    status: 'skipped',
    exitCode: 0,
    durationMs: 0,
    stdout: '',
    stderr: '',
    summary: 'Fake coding harness used a zero-dependency marker change; dependency bootstrap was skipped.',
    dependencyHash: 'fake-harness',
    redacted: true,
    createdAt: now,
  }
  const codingRun: CodingAgentRun = {
    ...input.codingRun,
    status: 'completed',
    summary: 'Fake coding run completed in a managed worktree and produced a diff artifact.',
    changedPaths: diff.changedPaths,
    completedAt: now,
    diffArtifactId: diff.id,
    bootstrapEvidenceId: bootstrapEvidence.id,
    redacted: true,
  }
  const events: CodingAgentEvent[] = [
    {
      id: `coding-event-${randomUUID()}`,
      codingRunId: codingRun.id,
      runId: codingRun.runId,
      nodeId: codingRun.nodeId,
      sequence: 3,
      kind: 'diff',
      message: 'Fake coding engine wrote a marker file and captured a redacted worktree diff.',
      timestamp: now,
      metadata: { diffArtifactId: diff.id },
      redacted: true,
    },
    {
      id: `coding-event-${randomUUID()}`,
      codingRunId: codingRun.id,
      runId: codingRun.runId,
      nodeId: codingRun.nodeId,
      sequence: 4,
      kind: 'bootstrap',
      message: bootstrapEvidence.summary,
      timestamp: now,
      metadata: { bootstrapEvidenceId: bootstrapEvidence.id },
      redacted: true,
    },
  ]

  return {
    codingRun,
    events,
    diff,
    bootstrapEvidence,
  }
}

async function currentBranch(repositoryPath: string): Promise<string> {
  const { stdout } = await execGit(repositoryPath, ['branch', '--show-current'])
  const branch = stdout.trim()
  return branch || 'HEAD'
}

async function currentCommit(repositoryPath: string): Promise<string> {
  const { stdout } = await execGit(repositoryPath, ['rev-parse', '--verify', 'HEAD'])
  return stdout.trim().toLowerCase()
}

async function worktreeStatus(repositoryPath: string): Promise<Array<{ status: string; path: string }>> {
  const { stdout } = await execGit(repositoryPath, [
    '-c',
    'core.quotePath=false',
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])
  return parsePorcelainStatus(stdout)
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

async function execGit(cwd: string, args: string[]) {
  return execFileAsync('git', ['-C', cwd, ...args], {
    timeout: 30_000,
    windowsHide: true,
  })
}

function safeBranchName(value: string): string {
  return value.replace(/[^A-Za-z0-9/_-]/g, '-')
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-')
}

function parsePorcelainStatus(output: string): Array<{ status: string; path: string }> {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2)
      const rawPath = line.slice(3)
      const renamedPath = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) : rawPath
      return { status, path: renamedPath ?? rawPath }
    })
    .filter((entry) => entry.path.length > 0)
}

function fakeRun(runId: string, projectId: string, nodeId: string): WorkflowRun {
  return {
    id: runId,
    version: 1,
    title: 'DevFlow coding run',
    request: 'Use the selected build node context.',
    projectId,
    creatorId: 'local-user',
    status: 'building',
    currentNodeId: nodeId,
    branchName: 'devflow/local',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    nodes: [],
    edges: [],
  }
}

function fakeNode(nodeId: string): WorkflowNode {
  return {
    id: nodeId,
    stage: 'build',
    title: 'Build node',
    subtitle: 'Managed fake coding harness.',
    kind: 'task',
    status: 'pending',
    ownerId: 'local-user',
    retryCount: 0,
    artifactIds: [],
  }
}
