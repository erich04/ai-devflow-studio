import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  selectDependencyBootstrap,
  type DependencyBootstrapDecision,
  type DependencyBootstrapEvidence,
  type DependencyBootstrapStatus,
} from '@ai-devflow/shared'
import { readProjectFileSnapshot, type LocalTestCommandResult } from './test-runner.js'

export type DependencyBootstrapCommandRunner = (input: {
  command: string
  cwd: string
  timeoutMs: number
}) => Promise<LocalTestCommandResult>

export type DependencyBootstrapRunnerInput = {
  codingRunId: string
  runId: string
  nodeId: string
  projectId: string
  worktreePath: string
  previousDependencyHash?: string | undefined
  runCommand: DependencyBootstrapCommandRunner
  timeoutMs: number
  now: string
}

export async function runDependencyBootstrap(
  input: DependencyBootstrapRunnerInput,
): Promise<DependencyBootstrapEvidence> {
  const files = await readProjectFileSnapshot(input.worktreePath)
  const decision = selectDependencyBootstrap({
    files,
    nodeModulesPresent: existsSync(path.join(input.worktreePath, 'node_modules')),
    ...(input.previousDependencyHash ? { previousDependencyHash: input.previousDependencyHash } : {}),
  })

  if (decision.status === 'skipped' || decision.status === 'needs_approval') {
    return evidenceFromDecision({
      input,
      decision,
      status: decision.status,
      exitCode: null,
      durationMs: 0,
      stdout: '',
      stderr: '',
      summary: decision.reason,
      redacted: true,
    })
  }

  const result = await input.runCommand({
    command: decision.command,
    cwd: input.worktreePath,
    timeoutMs: input.timeoutMs,
  })

  return evidenceFromDecision({
    input,
    decision,
    status: result.status === 'passed' ? 'passed' : result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    summary: result.summary,
    redacted: result.redacted,
  })
}

function evidenceFromDecision(input: {
  input: DependencyBootstrapRunnerInput
  decision: DependencyBootstrapDecision
  status: DependencyBootstrapStatus
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  summary: string
  redacted: boolean
}): DependencyBootstrapEvidence {
  return {
    id: `bootstrap-${input.input.codingRunId}`,
    codingRunId: input.input.codingRunId,
    runId: input.input.runId,
    nodeId: input.input.nodeId,
    projectId: input.input.projectId,
    command: input.decision.command,
    status: input.status,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    stdout: input.stdout,
    stderr: input.stderr,
    summary: input.summary,
    dependencyHash: input.decision.dependencyHash,
    redacted: input.redacted,
    createdAt: input.input.now,
  }
}
