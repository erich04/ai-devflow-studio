// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { codingDigest } from './coding-candidate-workspace'
import { fixtureTemplate, FixtureCaseCorrection } from './native-coding-fixture-cases'
import {
  fixtureChecksFromResponse,
  validateFrozenIndependentChecks,
  validateIndependentVerification,
} from './native-coding-independent-verification'
import { classifyIndependentPreflight } from './native-coding-check-preflight'
import type { AcceptancePlanning } from './native-coding-fixture-planning'
import { codingHarnessFixture, codingToolReply } from './native-coding-test-fixture'

it('retains a valid private variation while correcting its sibling and freezes only the complete sourced plan', () => {
  const fixture = fixtureTemplate(
    'example.test.ts',
    "import {it,expect} from 'vitest'\nit('happy',()=>{\nconst value=1\nexpect(value).toBe(1)\n})",
  )
  const source = {
    objectiveVersion: 1,
    baselineDigest: 'b'.repeat(64),
    sourceDigest: 'c'.repeat(64),
    adapter: { kind: 'vitest' as const, directory: '.' },
    criteria: [{ id: 'objective', sourceRef: 'approved', text: 'First change. Second change.' }],
  }
  const selection = {
    scenarios: ['r1.1', 'r1.2'].map((unit) => ({
      units: [unit],
      fixture: 'f1',
      anchor: 't1',
      precondition: 'Valid control',
    })),
    contextOnly: [],
  }
  const p: AcceptancePlanning = {
    source,
    fixtures: [fixture],
    selection,
    phase: 'cases',
    request: { systemPrompt: '', messages: [], tools: [] },
  }
  const first = { scenario: 's1', baseline: 'fail', edits: [{ line: 2, deleteCount: 1, insert: 'const value=2' }] }
  const bad = { scenario: 's2', baseline: 'fail', edits: [{ line: 3, deleteCount: 1, insert: 'expect(true).toBe(true)' }] }
  const reply = (cases: unknown[]) => codingToolReply('author', 'submit_fixture_cases', { cases })
  const now = '2026-11-04T17:00:00.000Z'
  let correction: FixtureCaseCorrection | undefined
  try {
    fixtureChecksFromResponse(p, reply([first, bad]), now)
  } catch (error) {
    expect(error).toBeInstanceOf(FixtureCaseCorrection)
    correction = error as FixtureCaseCorrection
  }
  expect(correction!.partial.cases.map((c) => c.scenario)).toEqual(['s1'])
  expect(correction!.partial.selectionDigest).toBe(codingDigest(JSON.stringify(selection)))
  expect(correction!.message).toMatch(/s2.*assertion/i)
  const tampered = structuredClone(correction!.partial)
  tampered.cases[0]!.body = 'throw new Error()'
  expect(() =>
    validateIndependentVerification({
      plans: [],
      humanInputs: [],
      drafts: [
        {
          attemptId: 'partial',
          sourceDigest: source.sourceDigest,
          objectiveVersion: 1,
          partial: tampered,
          feedback: 'repair',
        },
      ],
    }),
  ).toThrow(/partial/)
  const retry = { ...p, partial: correction!.partial }
  expect(() => fixtureChecksFromResponse(retry, reply([first]), now)).toThrow()
  const plan = fixtureChecksFromResponse(retry, reply([{ ...first, scenario: 's2' }]), now)
  expect(validateFrozenIndependentChecks(plan).checks).toHaveLength(2)
  expect(plan.checks[0]?.body).toContain('const value=2')
  expect(plan.checks.map((check) => check.fixture?.units)).toEqual([['r1.1'], ['r1.2']])
  const mismatch = classifyIndependentPreflight(
    plan,
    { planDigest: plan.digest, status: 'failed', checkedCriteria: ['case-1', 'case-2'], failedCriteria: ['case-1'] },
    '[]',
  )
  expect(mismatch).toMatchObject({ status: 'invalid', correctCases: true, retainedCaseIds: ['case-1'] })
  const broken = classifyIndependentPreflight(
    plan,
    {
      planDigest: plan.digest,
      status: 'invalid',
      checkedCriteria: ['case-1'],
      failedCriteria: [],
      invalidCriteria: ['case-2'],
    },
    '[]',
  )
  expect(broken.feedback).toMatch(/case-1.*declared fail.*observed pass/i)
})

it('uses the retained cases through the normal governed plan-authoring loop', async () => {
  const deps = await import('./coding-dependency-preparation')
  const { symlink, rm } = await import('node:fs/promises')
  const path = await import('node:path')
  let cases = 0
  const fixture = await codingHarnessFixture(
    async () => codingToolReply('stop', 'report_blocked', { reason: 'verification recorded' }),
    'node node_modules/vitest/vitest.mjs run value.test.ts',
    {},
    async (request) => {
      if (request.tools[0]?.function.name === 'select_behavior_contract')
        return codingToolReply('selection', 'select_behavior_contract', {
          scenarios: ['r1.1', 'r1.2'].map((unit) => ({
            units: [unit],
            anchor: 'f1:t1',
            precondition: 'Known successful public call',
          })),
          contextOnly: [],
        })
      const form = JSON.parse(request.messages[0]!.content as string)
      cases++
      const changed = {
        scenario: 's1',
        baseline: 'fail',
        edits: [{ line: 2, deleteCount: 1, insert: " const value='changed'" }],
      }
      if (cases === 1)
        return codingToolReply('partial', 'submit_fixture_cases', {
          cases: [
            changed,
            { scenario: 's2', baseline: 'fail', edits: [{ line: 3, deleteCount: 1, insert: ' expect(true).toBe(true)' }] },
          ],
        })
      expect(form.scenarios.map((s: { id: string }) => s.id)).toEqual(['s2'])
      expect(form.retainedScenarios).toEqual(['s1'])
      return codingToolReply('correct', 'submit_fixture_cases', { cases: [{ ...changed, scenario: 's2' }] })
    },
    {
      userInstruction: 'First behavior. Second behavior.',
      baselineFiles: {
        'package.json': '{"type":"module","devDependencies":{"vitest":"3.2.6"}}',
        'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
        'vitest.config.mjs': "export default {test:{environment:'node',include:['*.test.ts']}}",
        'value.test.ts':
          "import {it,expect} from 'vitest'\nit('accepts original',()=>{\n const value='original'\n expect(value).toBe('original')\n})",
      },
    },
  )
  const prepare = vi.spyOn(deps, 'prepareCodingDependencies').mockImplementation(async (input) => {
    await symlink(
      path.resolve('node_modules'),
      path.join(input.directory, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    return { inputDigest: input.plan.inputDigest }
  })
  try {
    await fixture.authorize()
    await fixture.executor.settled('coding')
    const state = (await fixture.store.getNativeCodingSession('native-coding'))!.independentVerification!
    expect(cases).toBe(2)
    expect(state.drafts?.find((d) => d.partial)?.partial?.cases.map((c) => c.scenario)).toEqual(['s1'])
    expect(state.plans[0]?.checks.map((c) => c.criterionId)).toEqual(['case-1', 'case-2'])
    validateIndependentVerification(JSON.parse(JSON.stringify(state)))
  } finally {
    prepare.mockRestore()
    await fixture.executor.shutdown()
    await fixture.store.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
}, 30000)

it('returns an all-preservation declaration for re-selection without bootstrapping or running the baseline', () => {
  const f = fixtureTemplate('case.test.ts', "it('public',()=>{\nconst a='first'\nexpect(a).toBe('first')\n})")
  const source = {
    objectiveVersion: 1,
    baselineDigest: 'a'.repeat(64),
    sourceDigest: 'b'.repeat(64),
    criteria: [{ id: 'r', sourceRef: 'approved', text: 'Support another input.' }],
    adapter: { kind: 'vitest' as const, directory: '.' },
  }
  const p: AcceptancePlanning = {
    source,
    fixtures: [f],
    phase: 'cases',
    selection: { scenarios: [{ units: ['r1.1'], fixture: 'f1', anchor: 't1', precondition: 'valid' }], contextOnly: [] },
    request: { systemPrompt: '', messages: [], tools: [] },
  }
  const r = codingToolReply('pass', 'submit_fixture_cases', {
    cases: [{ scenario: 's1', baseline: 'pass', edits: [{ line: 2, deleteCount: 1, insert: 'const a="first"' }] }],
  })
  expect(() => fixtureChecksFromResponse(p, r, '2026-11-04T17:00:00.000Z')).toThrow(/declared.*unchanged baseline/i)
})
