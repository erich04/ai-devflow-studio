// @vitest-environment node
import { expect, it } from 'vitest'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error Standalone Node evaluator has no declaration file.
import { bindPublicTestPlans, budgetedEngineOrder, checkDeepSeekAvailability, nextTrialBudget, providerStopReason, protectedEvaluationPath, trialLedgerAccountedUsd, removeDisposableDependencies, removeTrialCommandCaches } from './native-coding-batch-live.mjs'

it('cleans only reproducible stores in owned evaluation locations while retaining source and seed provenance', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'df-eval-cache-cleanup-'))
  try {
    const execution = path.join(root, 'execution'), key = 'b'.repeat(64)
    const seed = path.join(execution, 'harness', 'a'.repeat(64), 'dependency-seeds', key)
    for (const directory of ['source/node_modules/package', 'source/.cache/devflow-pnpm-store', 'source/.cache/devflow-corepack', 'source/.cache/unrelated', 'source/dependency-seeds/example/store', path.relative(root, path.join(seed, 'store')), path.relative(root, path.join(seed, 'corepack'))]) {
      await mkdir(path.join(root, directory), { recursive: true }); await writeFile(path.join(root, directory, 'value'), 'preserve or rebuild')
    }
    await writeFile(path.join(seed, 'manifest.json'), JSON.stringify({ key, identity: { version: 1 }, capturedBeforePrivateChecks: true, manifestDigest: 'proof' }))
    await removeDisposableDependencies(root); await removeTrialCommandCaches(execution)
    await expect(access(path.join(root, 'source/node_modules'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(root, 'source/.cache/devflow-pnpm-store'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(root, 'source/.cache/devflow-corepack'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(seed, 'store'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(seed, 'corepack'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(await readFile(path.join(seed, 'manifest.json'), 'utf8')).manifestDigest).toBe('proof')
    expect(await readFile(path.join(root, 'source/dependency-seeds/example/store/value'), 'utf8')).toBe('preserve or rebuild')
    expect(await readFile(path.join(root, 'source/.cache/unrelated/value'), 'utf8')).toBe('preserve or rebuild')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('stops before paid work when the provider reports no balance, without recording account amounts or credentials', async () => {
  const secret = 'private-fixture-credential'
  const result = await checkDeepSeekAvailability(secret, async () => new Response(JSON.stringify({ is_available: false, balance_infos: [{ total_balance: '-1.00' }] })))
  expect(result).toEqual({ available: false, httpStatus: 200, reason: 'balance_unavailable' })
  expect(JSON.stringify(result)).not.toContain(secret)
  expect(JSON.stringify(result)).not.toContain('total_balance')
  expect(await checkDeepSeekAvailability(secret, async () => new Response(JSON.stringify({ is_available: true })))).toEqual({ available: true, httpStatus: 200, reason: 'available' })
})

it('distinguishes confirmed access/balance errors from task failures and ambiguous provider state', async () => {
  expect(providerStopReason({ httpStatus: 401 })).toBe('authentication_failed')
  expect(providerStopReason({ httpStatus: 402 })).toBe('balance_unavailable')
  for (const value of [undefined, { httpStatus: 429 }, { httpStatus: 500 }, { failure: 'invalid_model_output' }]) expect(providerStopReason(value)).toBeNull()
  expect(await checkDeepSeekAvailability('fixture', async () => new Response('', { status: 401 }))).toEqual({ available: false, httpStatus: 401, reason: 'authentication_failed' })
  expect(await checkDeepSeekAvailability('fixture', async () => new Response('{}'))).toEqual({ available: false, httpStatus: 200, reason: 'availability_unknown' })
})

it('protects package/test configuration and acceptance files without masking production changes', () => {
  for (const file of ['package.json', 'apps/web/package.json', 'pnpm-lock.yaml', 'vitest.config.ts', 'vitest.setup.ts', 'apps/desktop/tsconfig.json', 'apps/api/src/a.test.ts', 'apps/web/src/a.spec.tsx']) expect(protectedEvaluationPath(file), file).toBe(true)
  for (const file of ['apps/desktop/electron/native-coding-loop.ts', 'packages/shared/src/domain.ts', 'README.md']) expect(protectedEvaluationPath(file), file).toBe(false)
})

it('requires a matching qualified public plan for every task, without changing private acceptance', () => {
  const tasks = [{ id: 'task-a', baseSha: 'base-a', acceptanceTests: ['private-a.test.ts'] }, { id: 'task-b', baseSha: 'base-b', acceptanceTests: ['private-b.test.ts'] }]
  const plan = { taskManifestDigest: 'tasks-digest', tasks: tasks.map(task => ({ taskId: task.id, baseSha: task.baseSha, publicTestFiles: [`scripts/${task.id}.test.ts`], testCommand: `corepack pnpm exec vitest run scripts/${task.id}.test.ts` })) }
  const qualification = { publicPlanDigest: 'plan-digest', taskManifestDigest: 'tasks-digest', qualified: 2, results: plan.tasks.map(task => ({ ...task, qualified: true, receipt: { status: 'passed', temporaryCleanupStatus: 'completed' }, tests: { passed: 3, failed: 0, unhandledErrors: 0, skipped: 1 } })) }
  const bind = (plans = plan, result = qualification) => bindPublicTestPlans(tasks, plans, result, 'tasks-digest', 'plan-digest')
  expect(bind()).toEqual(tasks.map((task, index) => ({ ...task, publicTestFiles: plan.tasks[index]!.publicTestFiles, testCommand: plan.tasks[index]!.testCommand })))
  expect(() => bind({ ...plan, tasks: plan.tasks.slice(0, 1) })).toThrow('every qualified task')
  expect(() => bind(plan, { ...qualification, publicPlanDigest: 'stale' })).toThrow('digest')
  expect(() => bind(plan, { ...qualification, results: qualification.results.map((row, index) => index ? row : { ...row, baseSha: 'different' }) })).toThrow('qualified public plan')
  expect(() => bind(plan, { ...qualification, results: qualification.results.map((row, index) => index ? row : { ...row, qualified: false }) })).toThrow('qualified public plan')
  expect(() => bind(plan, { ...qualification, results: qualification.results.map((row, index) => index ? row : { ...row, tests: { ...row.tests, failed: 1 } }) })).toThrow('qualified public plan')
  expect(() => bind(plan, { ...qualification, results: qualification.results.map((row, index) => index ? row : { ...row, receipt: { ...row.receipt, status: 'failed' } }) })).toThrow('qualified public plan')
  expect(() => bind({ ...plan, tasks: [plan.tasks[0]!, plan.tasks[0]!] })).toThrow('every qualified task')
  expect(() => bind({ ...plan, tasks: plan.tasks.map((row, index) => index ? row : { ...row, testCommand: 'corepack pnpm exec vitest run; echo fake' }) })).toThrow('public test command')
})
it('accounts unknown calls at their reservation and stops dispatch below the frozen headroom', () => {
  const ledger = { rows: [{ costUsd: 0.012, boundUsd: 0.4 }, { costUsd: null, boundUsd: 0.25 }, { costUsd: 0, boundUsd: 0.1 }] }
  expect(trialLedgerAccountedUsd(ledger)).toBeCloseTo(0.262, 9)
  expect(trialLedgerAccountedUsd(undefined)).toBe(0)
  expect(() => trialLedgerAccountedUsd({ rows: [{ costUsd: null, boundUsd: -1 }] })).toThrow('invalid accounting value')
  const budget = { maxCostUsd: 3, minimumTrialHeadroomUsd: 0.3 }
  expect(nextTrialBudget(budget, 0, 100)).toBe(3)
  expect(nextTrialBudget(budget, 2.5, 100)).toBeCloseTo(0.5, 9)
  expect(nextTrialBudget(budget, 2.75, 100)).toBeNull()
  expect(nextTrialBudget(budget, 3.2, 100)).toBeNull()
  expect(nextTrialBudget({ maxCostUsd: 300, minimumTrialHeadroomUsd: 0.3 }, 0, 100)).toBe(100)
})
it('runs the low-cost engines before Native v3 under a shared ceiling', () => {
  expect(budgetedEngineOrder(['native-v2', 'native-v3', 'opencode'])).toEqual(['native-v2', 'opencode', 'native-v3'])
})
