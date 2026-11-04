// @vitest-environment node
import { expect, it } from 'vitest'
import {
  fixtureTemplate,
  sourceUnits,
  bindFixtureCases,
  varyPublicFixture,
  bindFixtureContrast,
  namedFixtureSubjects,
  requireNamedFixtureSubjects,
} from './native-coding-fixture-cases'
import { codingDigest } from './coding-candidate-workspace'

const text = `import { describe, it as sample, expect } from 'vitest';
describe('screen', () => { sample('public display', () => expect(true).toBe(true)) });
describe('engine', () => { const run = () => 2; sample('public execution', () => expect(run()).toBe(2)) });`
const fixture = fixtureTemplate('feature/runtime.test.ts', text)
const criteria = [{ id: 'approved', text: '界面展示入口。执行入口要真正运行。', sourceRef: 'design@1' }]
const first = { units: ['r1.1'], fixture: 'f1', anchor: 't1', baseline: 'pass', body: 'expect(true).toBe(true)' }
const second = { units: ['r1.2'], fixture: 'f1', anchor: 't2', baseline: 'fail', body: 'expect(run()).toBe(3)' }
it('requires an executable call on a named subject and keeps incidental terms out of that requirement', () => {
  const units = sourceUnits([{ id: 'action', sourceRef: 'design', text: 'ARCHIVE 作业可审阅。不要创建 DRAFT 记录。' }])
  const subjects = namedFixtureSubjects(units, [
    { term: 'ARCHIVE', value: 'archive' },
    { term: 'DRAFT', value: 'draft' },
  ])
  expect(subjects).toEqual([{ unit: 'r1.1', value: 'archive' }])
  expect(() => requireNamedFixtureSubjects(subjects, [{ units: ['r1.1'] }])).toThrow()
  expect(() => requireNamedFixtureSubjects(subjects, [{ units: ['r1.2'], contrast: { requested: 'archive' } }])).toThrow()
  expect(() =>
    requireNamedFixtureSubjects(subjects, [{ units: ['r1.1'], contrast: { requested: 'archive' } }]),
  ).not.toThrow()
})
it('rejects a plan with only the display case when the approved source also requires execution', () => {
  expect(sourceUnits(criteria)).toHaveLength(2)
  expect(() => bindFixtureCases(criteria, [fixture], { cases: [first], contextOnly: [] })).toThrow(/coverage/i)
  const bound = bindFixtureCases(criteria, [fixture], { cases: [first, second], contextOnly: [] })
  expect(bound.criteria.map((c) => c.text)).toEqual(['界面展示入口。', '执行入口要真正运行。'])
  expect(bound.checks[1]?.fixture).toMatchObject({ path: 'feature/runtime.test.ts', hash: codingDigest(text), anchor: 't2' })
  expect(() =>
    bindFixtureCases(criteria, [fixture], { cases: [{ ...first, anchor: 't99' }, second], contextOnly: [] }),
  ).toThrow()
})

it('binds original and requested inputs to the same stimulus without letting the variation replace the host input', () => {
  const control = "  const mode = 'existing'\n  expect(handle(mode)).toBe(true)"
  const changed = varyPublicFixture(control, [
    {
      line: 1,
      deleteCount: 1,
      insert: '  const mode = __devflowInput\n  __devflowInvoke(handle, [mode], actual => actual)',
    },
  ])
  const pair = { control: 'existing', requested: 'archived' }
  expect(bindFixtureContrast(pair, changed, ['archived'])).toEqual({ ...pair, boundCall: true })
  expect(() => bindFixtureContrast(pair, control, ['archived'])).toThrow()
  expect(() => bindFixtureContrast(pair, 'const mode = __devflowInput; handle(other)', ['archived'])).toThrow()
  expect(() => bindFixtureContrast(pair, '__devflowInvoke(handle, [other], () => __devflowInput)', ['archived'])).toThrow()
  expect(() => bindFixtureContrast(pair, changed, ['other'])).toThrow()
  expect(() => varyPublicFixture(control, [{ line: 2, deleteCount: 1, insert: '  expect(true).toBe(true)' }])).toThrow(
    /assertion/,
  )
})
it('runs the new assertion inside the chosen baseline fixture scope and removes unrelated test registrations and empty suites', () => {
  const body = fixture.render('t2', '执行入口要真正运行。', second.body)
  expect(body).toContain('const run = () => 2')
  expect(body).toContain('expect(run()).toBe(3)')
  expect(body).not.toMatch(/public display|public execution|describe\('screen'/)
})
