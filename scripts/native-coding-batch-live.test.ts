// @vitest-environment node
import { expect, it } from 'vitest'
// @ts-expect-error Standalone Node evaluator has no declaration file.
import { bindPublicTestPlans, protectedEvaluationPath } from './native-coding-batch-live.mjs'

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
