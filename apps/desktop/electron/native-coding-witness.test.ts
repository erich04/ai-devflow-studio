// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import * as dependencies from './coding-dependency-preparation'
import { CodingCandidateWorkspace } from './coding-candidate-workspace'
import { CodingCommandRunner } from './coding-command-runner'
import { fixtureTemplate } from './native-coding-fixture-cases'
import { fixtureChecksFromResponse } from './native-coding-independent-verification'
import { preflightIndependentChecks } from './native-coding-check-preflight'
import { codingToolReply } from './native-coding-test-fixture'

it('requires a compound change to fail at its declared behavior, not while arranging or checking something else', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'coding-private-witness-')),
    delivery = path.join(root, 'delivery')
  await mkdir(delivery)
  const file = 'queue.test.ts',
    code = `import {it,expect} from 'vitest'
it('reads the queue',()=>{
const queue={available:true, sent:false}
expect(queue.available).toBe(true)
})`
  await writeFile(path.join(delivery, file), code)
  await writeFile(path.join(delivery, 'package.json'), '{"private":true,"type":"module","packageManager":"pnpm@9.15.0"}')
  await writeFile(path.join(delivery, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
  await writeFile(
    path.join(delivery, 'vitest.config.mjs'),
    "export default {test:{environment:'node',include:['*.test.ts']}}",
  )
  const workspace = await CodingCandidateWorkspace.create({
    root: path.join(root, 'workspace'),
    delivery,
    baseCommitSha: 'a'.repeat(40),
    excludedPaths: ['node_modules', '.cache'],
  })
  const template = fixtureTemplate(file, code),
    source = {
      objectiveVersion: 1,
      sourceDigest: 'd'.repeat(64),
      baselineDigest: workspace.identity.base.digest,
      criteria: [{ id: 'goal', text: 'A queued job is sent.', sourceRef: 'approved' }],
      adapter: { kind: 'vitest' as const, directory: '.' },
    }
  const planning = {
    source,
    request: { systemPrompt: '', messages: [], tools: [] },
    phase: 'cases' as const,
    requireWitness: true,
    fixtures: [template],
    selection: {
      scenarios: [{ units: ['r1.1'], fixture: 'f1', anchor: 't1', precondition: 'Queue available' }],
      contextOnly: [],
    },
  }
  const draft = (insert: string) =>
    fixtureChecksFromResponse(
      planning,
      codingToolReply('cases', 'submit_fixture_cases', {
        cases: [{ scenario: 's1', baseline: 'fail', edits: [{ line: 4, deleteCount: 0, insert }] }],
      }),
      '2026-11-04T18:00:00Z',
    )
  const runner = new CodingCommandRunner(path.join(root, 'commands'))
  const prep = vi.spyOn(dependencies, 'prepareCodingDependencies').mockImplementation(async ({ directory, plan }) => {
    await symlink(
      path.resolve('node_modules'),
      path.join(directory, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    return { inputDigest: plan.inputDigest }
  })
  try {
    const before = 'expect(queue.available).toBe(false)',
      succeeds = 'expect(queue.available).toBe(true)',
      fails = 'expect(queue.sent).toBe(true)',
      mark = '// @devflow-witness\n'
    const legacy = fixtureChecksFromResponse(
      { ...planning, requireWitness: false },
      codingToolReply('old', 'submit_fixture_cases', {
        cases: [{ scenario: 's1', baseline: 'fail', edits: [{ line: 4, deleteCount: 0, insert: before + '\n' + fails }] }],
      }),
      '2026-11-04T18:00:00Z',
    )
    expect(legacy.checks[0]?.fixture?.witnessed).toBeUndefined()
    expect(() => draft(before + '\n' + fails)).toThrow(/witness/i)
    expect(() => draft(before + '\n' + mark + 'const label = "unused"\n' + fails)).toThrow(/witness/i)
    for (const [id, body, wanted] of [
      ['wrong-setup', before + '\n' + mark + fails, 'invalid'],
      ['real-effect', succeeds + '\n' + mark + fails, 'valid'],
      ['unrelated-after', mark + succeeds + '\n' + fails, 'invalid'],
    ] as const) {
      const plan = draft(body)
      const result = await preflightIndependentChecks({
        plan,
        workspace,
        runner,
        profile: { kind: 'trusted_local' },
        operationId: id,
        signal: new AbortController().signal,
      })
      expect(result.status, JSON.stringify(result)).toBe(wanted)
      if (wanted === 'invalid') expect(result.feedback).toMatch(/WitnessNotReached/)
    }
  } finally {
    prep.mockRestore()
    await runner.cancelAll()
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
