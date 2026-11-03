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

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('preflights real framework checks on immutable B, distinguishes bad programs and does not observe C', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'df-check-preflight-')); roots.push(root)
  const delivery = path.join(root, 'delivery'); await mkdir(delivery); await mkdir(path.join(delivery, 'tests'))
  await writeFile(path.join(delivery, 'value.ts'), 'export const value = 1')
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
  for (const [index, [program, baselineExpectation, expected]] of [
    [body, 'fail', 'valid'], [body, 'pass', 'invalid'], ['const x = ""/report""', 'fail', 'invalid'],
    ["import { test, expect } from 'vitest'; import { writeFileSync } from 'node:fs'; test('write', () => { writeFileSync('value.ts', 'tampered'); expect(true).toBe(true) })", 'pass', 'invalid'],
  ].entries()) {
    const plan = freezeIndependentChecks(source, { checks: [{ criterionId: 'value', body: program, baselineExpectation }] }, '2026-11-02T00:00:00.000Z')
    const result = await preflightIndependentChecks({ plan, workspace, runner, profile: { kind: 'trusted_local' }, operationId: `case-${index}`, signal: new AbortController().signal })
    expect(result.status, `case ${index}: ${result.feedback}`).toBe(expected)
    expect(await readFile(path.join(workspace.candidatePath, 'value.ts'), 'utf8')).toBe('export const value = 2')
    expect(await readFile(path.join(delivery, 'value.ts'), 'utf8')).toBe('export const value = 1')
    expect((await readdir(workspace.root)).some(name => name.startsWith('preflight-'))).toBe(false)
  }
}, 30000)
