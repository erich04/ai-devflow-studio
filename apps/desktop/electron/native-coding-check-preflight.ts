import { rm } from 'node:fs/promises'
import path from 'node:path'
import { codingDigest, snapshotCodingTree, type CodingCandidateWorkspace } from './coding-candidate-workspace'
import { codingDependencyPlan, prepareCodingDependencies } from './coding-dependency-preparation'
import type { CodingCommandRunner, CodingExecutionProfile } from './coding-command-runner'
import { runIndependentChecks, type FrozenIndependentChecks } from './native-coding-independent-verification'

export type IndependentPreflight = { status: 'valid' | 'invalid' | 'unavailable'; feedback: string }

/** Execute only against a fresh B copy, before implementation. Never inspect C,
 * reference patches or external acceptance tests when validating a draft. */
export async function preflightIndependentChecks(input: { plan: FrozenIndependentChecks; workspace: CodingCandidateWorkspace; runner: CodingCommandRunner; profile: CodingExecutionProfile; operationId: string; signal: AbortSignal }): Promise<IndependentPreflight> {
  if (!input.plan.adapter) return { status: 'valid', feedback: 'Legacy node check format; no framework baseline preflight.' }
  const { plan, workspace, runner, profile, signal } = input, base = workspace.identity.base
  const directory = path.join(workspace.root, `preflight-${codingDigest(input.operationId).slice(0, 20)}`)
  signal.throwIfAborted()
  await workspace.materialize(base, directory)
  try {
    const dependencies = await codingDependencyPlan(directory, profile, base.excludedPaths)
    await prepareCodingDependencies({ directory, profile, excludedPaths: base.excludedPaths, runner, operationId: input.operationId, plan: dependencies, signal, final: true })
    let diagnostics = ''
    const result = await runIndependentChecks({ plan, runner, directory, profile, operationId: `${input.operationId}:checks`, signal, onDiagnostics: value => { diagnostics = value } })
    if ((await snapshotCodingTree(directory, base.excludedPaths)).digest !== base.digest) return { status: 'invalid', feedback: 'The generated checks modified existing baseline files. Only host-owned scratch test files are allowed.' }
    if (result.status === 'timed_out' || result.status === 'cancelled') return { status: 'unavailable', feedback: `Independent check preflight ${result.status}; no implementation has started.` }
    if (result.status === 'invalid') return { status: 'invalid', feedback: `The checks could not evaluate these criteria: ${(result.invalidCriteria ?? []).join(', ')}. Categories: ${diagnostics}. Fix syntax, imports, fixture setup and assertion presence. Use normal Vitest modules, not a runner or report parser.` }
    const mismatched = plan.checks.filter(check => result.failedCriteria.includes(check.criterionId) !== (check.baselineExpectation === 'fail'))
    return mismatched.length ? { status: 'invalid', feedback: `Baseline behavior disagrees with the declared expectation for: ${mismatched.map(check => check.criterionId).join(', ')}. Check the fixture and assert the actual required behavior. Do not weaken assertions or change expectations merely to accept the baseline.` }
      : { status: 'valid', feedback: 'All criteria ran on immutable B with their declared behavior. This establishes executability and baseline discrimination, not semantic completeness.' }
  } catch (error) {
    signal.throwIfAborted()
    return { status: 'unavailable', feedback: 'Independent preflight could not prepare or execute its isolated baseline. Inspect private host command receipts; do not charge this as an implementation repair.' }
  } finally { await rm(directory, { recursive: true, force: true }) }
}
