// @vitest-environment node
import { expect, it } from 'vitest'
// @ts-expect-error Standalone Node evaluator has no declaration file.
import { bindPublicTestPlans, checkDeepSeekAvailability, providerStopReason, protectedEvaluationPath } from './native-coding-batch-live.mjs'

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
