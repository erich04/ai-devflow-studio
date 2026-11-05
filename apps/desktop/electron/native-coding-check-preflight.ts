import { rm } from 'node:fs/promises'
import path from 'node:path'
import { codingDigest, snapshotCodingTree, type CodingCandidateWorkspace } from './coding-candidate-workspace'
import { codingDependencyPlan, prepareCodingDependencies } from './coding-dependency-preparation'
import { captureCodingDependencySeed, restoreCodingDependencySeed } from './coding-dependency-seed'
import type { CodingCommandRunner, CodingExecutionProfile } from './coding-command-runner'
import { runIndependentChecks, type FrozenIndependentChecks, type IndependentCheckResult } from './native-coding-independent-verification'

export type IndependentPreflight = {
  status: 'valid' | 'invalid' | 'unavailable'
  feedback: string
  correctCases?: true
  retainedCaseIds?: string[]
}

export function classifyIndependentPreflight(
  plan: FrozenIndependentChecks,
  result: IndependentCheckResult,
  diagnostics: string,
): IndependentPreflight {
  if (result.status === 'timed_out' || result.status === 'cancelled')
    return {
      status: 'unavailable',
      feedback: `Independent check preflight ${result.status}; submission remains blocked.`,
    }
  const observed = (id: string) => (result.failedCriteria.includes(id) ? 'fail' : 'pass')
  const evaluated = plan.checks.filter(
    (check) => result.checkedCriteria.includes(check.criterionId) && !result.invalidCriteria?.includes(check.criterionId),
  )
  const mismatched = evaluated.filter((check) => observed(check.criterionId) !== check.baselineExpectation)
  const retained = evaluated
    .filter((check) => observed(check.criterionId) === check.baselineExpectation)
    .map((check) => check.criterionId)
  const differences = mismatched
    .map((check) => `${check.criterionId} (declared ${check.baselineExpectation}, observed ${observed(check.criterionId)})`)
    .join(', ')
  const fixCases = plan.coverage ? { correctCases: true as const, retainedCaseIds: retained } : {}
  if (result.status === 'invalid')
    return {
      status: 'invalid',
      ...fixCases,
      feedback: `The checks could not evaluate these criteria: ${(result.invalidCriteria ?? []).join(', ')}. Categories: ${diagnostics}.${differences ? ' Other baseline disagreements: ' + differences + '.' : ''} Fix syntax, imports, fixture setup and assertion presence. For WitnessNotReached, restore the prerequisites on B or remove the unrelated failure while keeping the requested effect at the marked assertion. For MatchedControlFailed, first make the same arrangement and observations work in the original supported state. For MismatchedInput, update the actual invocation arguments and current fixture state to address the selected subject. A positive async domain refusal must be observed at the operation. Use normal Vitest modules, not a runner or report parser.`,
    }
  if (evaluated.length !== plan.checks.length)
    return { status: 'invalid', feedback: 'Missing baseline observations; the complete independent plan did not execute.' }
  if (mismatched.length)
    return {
      status: 'invalid',
      ...(retained.length ? fixCases : {}),
      feedback: `Baseline behavior disagrees with the declared expectation for: ${differences}. Check the fixture and assert the actual required behavior. Do not weaken assertions or change expectations merely to accept the baseline.`,
    }
  // Paired controls already prove preservation on B. Automatic acceptance of a
  // change also needs an executable witness for behavior missing from that B.
  if (plan.coverage && !result.failedCriteria.length)
    return {
      status: 'invalid',
      feedback:
        'Every variant already passed on the unchanged baseline. These controls cannot demonstrate the requested change. Start with a successful call to the owning production entry point. Change its input to the specific mode and precondition named in the approved request, then assert the required successful effect. Exercising an existing mode or a refusal alone cannot establish that effect. If the work is purely behavior-preserving, these checks alone cannot establish completion.',
    }
  return { status: 'valid', feedback: 'All criteria executed on immutable B with their declared outcomes.' }
}

/** Execute only against a fresh B copy. Never inspect C,
 * reference patches or external acceptance tests when validating a draft. */
export async function preflightIndependentChecks(input: { plan: FrozenIndependentChecks; workspace: CodingCandidateWorkspace; runner: CodingCommandRunner; profile: CodingExecutionProfile; operationId: string; signal: AbortSignal; dependencyCacheVersion?: 1 }): Promise<IndependentPreflight> {
  if (!input.plan.adapter) return { status: 'valid', feedback: 'Legacy node check format; no framework baseline preflight.' }
  const { plan, workspace, runner, profile, signal } = input, base = workspace.identity.base
  const directory = path.join(workspace.root, `preflight-${codingDigest(input.operationId).slice(0, 20)}`)
  signal.throwIfAborted()
  await workspace.materialize(base, directory)
  try {
    const dependencies = await codingDependencyPlan(directory, profile, base.excludedPaths, { isolatedStore: input.dependencyCacheVersion === 1 })
    await restoreCodingDependencySeed({ workspace, directory, plan: dependencies, signal })
    const prepared = await prepareCodingDependencies({ directory, profile, excludedPaths: base.excludedPaths, runner, operationId: input.operationId, plan: dependencies, signal, final: true })
    // Publish only the successful B bootstrap, before loading any private test.
    if (prepared.logId) await captureCodingDependencySeed({ workspace, directory, plan: dependencies, preparationLogId: prepared.logId, signal })
    let diagnostics = ''
    const result = await runIndependentChecks({ plan, baseline: workspace, runner, directory, profile, baselinePreflight: true, operationId: `${input.operationId}:checks`, signal, onDiagnostics: value => { diagnostics = value } })
    if ((await snapshotCodingTree(directory, base.excludedPaths)).digest !== base.digest) return { status: 'invalid', feedback: 'The generated checks modified existing baseline files. Only host-owned scratch test files are allowed.' }
    return classifyIndependentPreflight(plan, result, diagnostics)
  } catch (error) {
    signal.throwIfAborted()
    return { status: 'unavailable', feedback: 'Independent preflight could not prepare or execute its isolated baseline. Inspect private host command receipts; do not charge this as an implementation repair.' }
  } finally { await rm(directory, { recursive: true, force: true }) }
}
