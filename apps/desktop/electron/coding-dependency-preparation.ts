import path from 'node:path'
import { selectDependencyBootstrap } from '@ai-devflow/shared'
import { readProjectFileSnapshot } from './test-runner'
import { codingDigest, snapshotCodingTree } from './coding-candidate-workspace'
import { CodingCommandRunner, type CodingCommandPlan, type CodingExecutionProfile } from './coding-command-runner'

export type CodingDependencyPlan = { digest: string; inputDigest: string; command: string; frozen: boolean; plan: CodingCommandPlan | null }
export function codingShellPlan(command: string, profile: CodingExecutionProfile): CodingCommandPlan {
  return process.platform === 'win32' && profile.kind === 'trusted_local'
    ? { executable: 'cmd.exe', args: ['/d', '/s', '/c', command], timeoutMs: 15 * 60_000, profile }
    : { executable: '/bin/sh', args: ['-c', command], timeoutMs: 15 * 60_000, profile }
}
export async function codingDependencyPlan(directory: string, profile: CodingExecutionProfile, excludedPaths: string[]): Promise<CodingDependencyPlan> {
  const files = await readProjectFileSnapshot(directory)
  const manifest = await snapshotCodingTree(directory, excludedPaths)
  const inputDigest = codingDigest(JSON.stringify(manifest.files.filter(file => /(?:^|\/)(?:package\.json|.*lock.*|\.npmrc|pnpm-workspace\.yaml|\.node-version|\.nvmrc)$/u.test(file.path))))
  const decision = Object.hasOwn(files, 'package.json') ? selectDependencyBootstrap({ files, nodeModulesPresent: false }) : undefined
  const frozen = decision?.status !== 'needs_approval'
  // Non-frozen preparation is candidate-only and must create a lock for final verification.
  const command = !decision || decision.status === 'skipped' ? '' : decision.status === 'needs_approval' ? decision.command.replace(' --package-lock=false', '') : decision.command
  const plan = command ? codingShellPlan(command, profile) : null
  return { digest: codingDigest(JSON.stringify({ inputDigest, plan, frozen })), inputDigest, command, frozen, plan }
}
export async function prepareCodingDependencies(input: { directory: string; profile: CodingExecutionProfile; excludedPaths: string[]; runner: CodingCommandRunner; operationId: string; plan: CodingDependencyPlan; signal?: AbortSignal; final?: boolean }): Promise<{ logId?: string; inputDigest: string }> {
  const current = await codingDependencyPlan(input.directory, input.profile, input.excludedPaths)
  if (current.digest !== input.plan.digest) throw new Error('Dependency inputs changed after authorization')
  if (input.final && !current.frozen) throw new Error('Final verification requires a lockfile in the approved revision')
  if (!current.plan) return { inputDigest: current.inputDigest }
  const logId = `${input.operationId}:dependencies:${codingDigest(path.resolve(input.directory))}`
  await input.runner.start(logId, current.plan, input.directory, input.signal)
  const receipt = await input.runner.wait(logId)
  if (receipt.status !== 'passed') throw new Error(`Dependency preparation ${receipt.status}; inspect ${logId}`)
  return { logId, inputDigest: current.inputDigest }
}
