// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it, vi } from 'vitest'
import { CodingCandidateWorkspace } from './coding-candidate-workspace'
import { CodingCommandRunner } from './coding-command-runner'
import * as dependencies from './coding-dependency-preparation'
import { freezeIndependentChecks, type IndependentCheckSource } from './native-coding-independent-verification'
import { preflightIndependentChecks } from './native-coding-check-preflight'
import { restoreCodingDependencySeed } from './coding-dependency-seed'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('preflights real framework checks on immutable B, distinguishes bad programs and does not observe C', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'df-check-preflight-')); roots.push(root)
  const delivery = path.join(root, 'delivery'); await mkdir(delivery); await mkdir(path.join(delivery, 'tests'))
  await writeFile(path.join(delivery, 'value.ts'), 'export const value = 1')
  await writeFile(path.join(delivery, 'save-state.ts'), "export function save(next: number, previous: number) {\n  if (next !== previous + 1) throw new Error('Invalid saved revision')\n}\n")
  await writeFile(path.join(delivery, 'tests/base.test.ts'), '// directory anchor')
  await writeFile(path.join(delivery, 'package.json'), '{"type":"module","private":true}')
  await writeFile(path.join(delivery, 'vitest.config.mjs'), "export default { test: { environment: 'node', include: ['tests/**/*.test.ts'] } }")
  const git = (args: string[]) => promisify(execFile)('git', args, { cwd: delivery })
  await git(['init', '--quiet']); await git(['add', '.']); await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'base'])
  const workspace = await CodingCandidateWorkspace.create({ root: path.join(root, 'workspace'), delivery, baseCommitSha: (await git(['rev-parse', 'HEAD'])).stdout.trim(), excludedPaths: ['node_modules'] })
  await writeFile(path.join(workspace.candidatePath, 'value.ts'), 'export const value = 2')
  // Provision the already installed test framework, avoiding a network install in
  // this test. Baseline materialization and framework execution are real.
  vi.spyOn(dependencies, 'prepareCodingDependencies').mockImplementation(async input => {
    await symlink(path.resolve('node_modules'), path.join(input.directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    return { inputDigest: input.plan.inputDigest }
  })
  const runner = new CodingCommandRunner(path.join(root, 'commands'))
  const source: IndependentCheckSource = { objectiveVersion: 1, sourceDigest: 'a'.repeat(64), baselineDigest: workspace.identity.base.digest,
    criteria: [{ id: 'value', text: 'Export value 2', sourceRef: 'approved' }], adapter: { kind: 'vitest', directory: 'tests' } }
  const body = "import { test, expect } from 'vitest'; import { value } from '../value'; test('value', () => expect(value).toBe(2))"
  const badSetup = "import { it, expect } from 'vitest'; import { save } from '../save-state'; it('persist', () => { save(3, 1); expect(1).toBe(1) })"
  for (const [index, [program, baselineExpectation, expected]] of [
    [badSetup, 'fail', 'invalid'], [body, 'fail', 'valid'], [body, 'pass', 'invalid'], ['const x = ""/report""', 'fail', 'invalid'],
    ["import { test, expect } from 'vitest'; import { writeFileSync } from 'node:fs'; test('write', () => { writeFileSync('value.ts', 'tampered'); expect(true).toBe(true) })", 'pass', 'invalid'],
  ].entries()) {
    const plan = freezeIndependentChecks(source, { checks: [{ criterionId: 'value', body: program, baselineExpectation }] }, '2026-11-02T00:00:00.000Z')
    const result = await preflightIndependentChecks({ plan, workspace, runner, profile: { kind: 'trusted_local' }, operationId: `case-${index}`, signal: new AbortController().signal })
    expect(result.status, `case ${index}: ${result.feedback}`).toBe(expected)
    if (program === badSetup) {
      expect(result.feedback).toContain('save-state.ts:2')
      expect(result.feedback).toContain('next !== previous + 1')
      expect(result.feedback).toContain('Invalid saved revision')
      expect(result.feedback).not.toContain(root)
    }
    expect(await readFile(path.join(workspace.candidatePath, 'value.ts'), 'utf8')).toBe('export const value = 2')
    expect(await readFile(path.join(delivery, 'value.ts'), 'utf8')).toBe('export const value = 1')
    expect((await readdir(workspace.root)).some(name => name.startsWith('preflight-'))).toBe(false)
  }
}, 30000)

it('publishes bootstrap packages before a private check can alter its own store', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'df-check-seed-')); roots.push(root)
  const delivery = path.join(root, 'delivery'); await mkdir(path.join(delivery, 'tests'), { recursive: true })
  await writeFile(path.join(delivery, 'package.json'), '{"type":"module","private":true,"packageManager":"pnpm@9.15.0"}')
  await writeFile(path.join(delivery, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  await writeFile(path.join(delivery, 'vitest.config.mjs'), "export default { test: { environment: 'node', include: ['tests/**/*.test.ts'] } }")
  await writeFile(path.join(delivery, 'tests/base.test.ts'), '// directory anchor')
  const workspace = await CodingCandidateWorkspace.create({ root: path.join(root, 'workspace'), delivery, baseCommitSha: 'a'.repeat(40), excludedPaths: ['node_modules', '.cache'] })
  const packageFile = '.cache/devflow-pnpm-store/v3/files/ab/package-content'
  vi.spyOn(dependencies, 'prepareCodingDependencies').mockImplementation(async input => {
    expect(input.plan.storeDirectory).toBe('.cache/devflow-pnpm-store')
    await mkdir(path.dirname(path.join(input.directory, packageFile)), { recursive: true })
    await writeFile(path.join(input.directory, packageFile), 'bootstrap-only')
    await symlink(path.resolve('node_modules'), path.join(input.directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    return { inputDigest: input.plan.inputDigest, logId: `${input.operationId}:prepared` }
  })
  const source: IndependentCheckSource = { objectiveVersion: 1, sourceDigest: 'a'.repeat(64), baselineDigest: workspace.identity.base.digest,
    criteria: [{ id: 'value', text: 'Export value 2', sourceRef: 'approved' }], adapter: { kind: 'vitest', directory: 'tests' } }
  const body = `import { test, expect } from 'vitest'; import { writeFileSync } from 'node:fs'; test('value', () => { writeFileSync(${JSON.stringify(packageFile)}, 'private-check-payload'); expect(1).toBe(2) })`
  const plan = freezeIndependentChecks(source, { checks: [{ criterionId: 'value', body, baselineExpectation: 'fail' }] }, '2026-11-02T00:00:00.000Z')
  const result = await preflightIndependentChecks({ plan, workspace, runner: new CodingCommandRunner(path.join(root, 'commands')), profile: { kind: 'trusted_local' }, operationId: 'seed-preflight', signal: new AbortController().signal, dependencyCacheVersion: 1 })
  expect(result.status).toBe('valid')
  const dependencyPlan = await dependencies.codingDependencyPlan(workspace.candidatePath, { kind: 'trusted_local' }, workspace.identity.base.excludedPaths, { isolatedStore: true })
  await restoreCodingDependencySeed({ workspace, directory: workspace.candidatePath, plan: dependencyPlan })
  expect(await readFile(path.join(workspace.candidatePath, packageFile), 'utf8')).toBe('bootstrap-only')
}, 20000)
