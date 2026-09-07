import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  validateTestCommandSafety,
  type LocalProject,
  type ManagedCodingWorkspace,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'
import { runLocalTestCommand } from './test-runner.js'
import type { WorkspaceOperationCoordinator } from './workspace-operation-coordinator.js'

type WorkflowTestStore = Pick<LocalStore, 'getRun' | 'listCodingAgentRuns' | 'listManagedCodingWorkspaces'>
const execFileAsync = promisify(execFile)

export type WorkflowTestCommandResult = {
  command: string
  cwd: string
  result: Awaited<ReturnType<typeof runLocalTestCommand>>
}

export async function runWorkflowTestCommand<T>(input: {
  project: LocalProject
  run: WorkflowRun
  nodeId: string
  store: WorkflowTestStore
  workspaceCoordinator: WorkspaceOperationCoordinator
  timeoutMs: number
  complete: (execution: WorkflowTestCommandResult) => Promise<T>
}): Promise<T> {
  const { project, run } = input
  if (run.projectId !== project.id) {
    throw new Error('The selected local project does not own this workflow run')
  }
  const node = run.nodes.find((candidate) => candidate.id === input.nodeId)
  if (
    !node || run.currentNodeId !== node.id || node.kind !== 'test' || node.stage !== 'test' ||
    (node.status !== 'running' && node.status !== 'failed')
  ) {
    throw new Error('Only the current workflow Test node can execute the project test command')
  }
  const command = project.testCommand.trim()
  if (!command) throw new Error('Local project has no test command')
  const safety = validateTestCommandSafety(command)
  if (safety.level === 'blocked') {
    throw new Error(`Test command blocked: ${safety.reasons.join(' ')}`)
  }
  const resolveWorkspace = async () => {
    const current = await input.store.getRun(run.id)
    if (!current || current.updatedAt !== run.updatedAt || current.version !== run.version) {
      throw new Error('Workflow changed before Test execution; reload the run')
    }
    const predecessors = run.edges
      .filter((edge) => edge.target === node.id && edge.kind === 'normal')
      .map((edge) => edge.source)
    const builds = run.nodes.filter((candidate) =>
      predecessors.includes(candidate.id) && candidate.stage === 'build' && candidate.kind === 'task',
    )
    if (builds.length !== 1 || builds[0]!.status !== 'success') {
      throw new Error('Workflow Test requires one completed upstream Build node')
    }
    const codingRuns = (await input.store.listCodingAgentRuns(run.id))
      .filter((candidate) => candidate.nodeId === builds[0]!.id)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    // Only workflows without Coding execution retain the original checkout path.
    const codingRun = codingRuns[0]
    if (!codingRun) return undefined
    if (
      codingRun.runId !== run.id || codingRun.projectId !== project.id ||
      codingRun.status !== 'completed' || !codingRun.completedAt ||
      !codingRun.managedWorkspaceId || codingRuns[1]?.startedAt === codingRun.startedAt
    ) {
      throw new Error('Latest Build Coding run is incomplete, ambiguous, or inconsistent')
    }
    const workspaces = (await input.store.listManagedCodingWorkspaces(project.id))
      .filter((workspace) => workspace.id === codingRun.managedWorkspaceId)
    const workspace = workspaces[0]
    if (
      workspaces.length !== 1 || !workspace || workspace.projectId !== project.id ||
      workspace.codingRunId !== codingRun.id || workspace.sourcePath !== project.path ||
      workspace.branchName !== codingRun.branchName || workspace.cleanupStatus !== 'active' ||
      workspace.deletedAt || !workspace.baseCommitSha ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(workspace.baseCommitSha) ||
      (workspace.headCommitSha !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(workspace.headCommitSha))
    ) {
      throw new Error('Workflow Test managed Coding workspace is missing or inconsistent')
    }
    return workspace
  }
  const initialWorkspace = await resolveWorkspace()
  const execute = async () => {
    // A queued cleanup or Coding operation can change the source while waiting for the lease.
    const workspace = await resolveWorkspace()
    if (JSON.stringify(workspace) !== JSON.stringify(initialWorkspace)) {
      throw new Error('Workflow Test source changed while waiting for its workspace')
    }
    const cwd = workspace ? await verifyManagedWorkspace(workspace) : project.path
    const result = await runLocalTestCommand({
      command: safety.normalizedCommand,
      cwd,
      timeoutMs: input.timeoutMs,
    })
    if (workspace) await verifyManagedWorkspace(workspace)
    // Keep the workspace lease through the existing atomic evidence/transition commit.
    return input.complete({ command: safety.normalizedCommand, cwd, result })
  }
  return initialWorkspace
    ? input.workspaceCoordinator.runExclusive(initialWorkspace.id, execute)
    : execute()
}

async function verifyManagedWorkspace(workspace: ManagedCodingWorkspace): Promise<string> {
  const [sourcePath, worktreePath] = await Promise.all([
    realpath(workspace.sourcePath), realpath(workspace.worktreePath),
  ])
  const git = async (cwd: string, ...args: string[]) =>
    (await execFileAsync('git', ['-C', cwd, ...args], { timeout: 10_000 })).stdout.trim()
  const [topLevel, sourceCommonDir, worktreeCommonDir, branch, head] = await Promise.all([
    git(worktreePath, 'rev-parse', '--show-toplevel').then((value) => realpath(value)),
    git(sourcePath, 'rev-parse', '--git-common-dir').then((value) => realpath(path.resolve(sourcePath, value))),
    git(worktreePath, 'rev-parse', '--git-common-dir').then((value) => realpath(path.resolve(worktreePath, value))),
    git(worktreePath, 'branch', '--show-current'),
    git(worktreePath, 'rev-parse', '--verify', 'HEAD'),
  ])
  if (
    sourcePath === worktreePath || topLevel !== worktreePath ||
    sourceCommonDir !== worktreeCommonDir || branch !== workspace.branchName ||
    head !== (workspace.headCommitSha ?? workspace.baseCommitSha)
  ) {
    throw new Error('Workflow Test managed workspace repository, branch, or HEAD changed')
  }
  if (workspace.headCommitSha) {
    await git(worktreePath, 'merge-base', '--is-ancestor', workspace.baseCommitSha!, head)
  }
  return workspace.worktreePath
}
