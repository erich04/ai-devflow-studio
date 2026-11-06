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
  readFixtureSelection,
  scopedPublicFixture,
} from './native-coding-fixture-cases'
import { codingDigest } from './coding-candidate-workspace'

const text = `import { describe, it as sample, expect } from 'vitest';
describe('screen', () => { sample('public display', () => expect(true).toBe(true)) });
describe('engine', () => { const run = () => 2; sample('public execution', () => expect(run()).toBe(2)) });`
const fixture = fixtureTemplate('feature/runtime.test.ts', text)
const criteria = [{ id: 'approved', text: '界面展示入口。执行入口要真正运行。', sourceRef: 'design@1' }]
const first = { units: ['r1.1'], fixture: 'f1', anchor: 't1', baseline: 'pass', body: 'expect(true).toBe(true)' }
const second = { units: ['r1.2'], fixture: 'f1', anchor: 't2', baseline: 'fail', body: 'expect(run()).toBe(3)' }

it('scopes a compound observation at a complete assertion without discarding setup or cleanup', () => {
  const body = [
    'const result = run()',
    'expect(result.action).toBe("approve")',
    'expect(result.sections).toEqual(["old-layout"])',
  ].join('\n')
  const scoped = scopedPublicFixture('screen.test.ts', body, 2)
  expect(scoped).toBe(body.split('\n').slice(0, 2).join('\n'))
  expect(scopedPublicFixture('screen.test.ts', body)).toBe(body)
  expect(() => scopedPublicFixture('screen.test.ts', body, 1)).toThrow(/boundary|top-level/)
  expect(() => scopedPublicFixture('screen.test.ts', body + '\ncleanup()', 2)).toThrow(/cleanup/)
  expect(() => scopedPublicFixture('screen.test.ts', 'if (enabled) {\nexpect(true).toBe(true)\n}', 2)).toThrow(/top-level/)
  expect(() => varyPublicFixture(scoped, [{ line: 2, deleteCount: 1, insert: 'expect(true).toBe(true)' }])).toThrow(/assertion/)
  const compound = fixtureTemplate('screen.test.ts', `import {it,expect} from 'vitest';\nit('layout',async()=>{${body}\n})`)
  const program = compound.render('t1', 'requested action', scoped + '\nexpect(result.allowed).toBe(true)', true, 2)
  expect(program).toContain('devflow:original-control')
  expect(program).not.toContain('old-layout')
  expect(compound.render('t1', 'whole callback', body, true)).toContain('old-layout')
})
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

it('distinguishes a failure reached during the original public call from a separately initiated manual retry', () => {
  const f = fixtureTemplate(
    'service.test.ts',
    `
    import {it, expect} from 'vitest'
    it('handles work', async () => {
      const service = harness(() => { throw new TransportError({code:'busy',retryable:true}) })
      const result = await submit(service)
      expect(result).toBe('done')
    })
    it('handles another case', async () => {
      await submit(service)
      const result = await service.retry()
      expect(result).toBe('done')
    })`,
  )
  expect(f.anchors[0]?.behavior).toEqual({ actions: ['submit'], faults: ['TransportError: busy'] })
  expect(f.anchors[1]?.behavior).toEqual({ actions: ['submit', 'service.retry'], faults: [] })
})

it('preserves the meaning and order of original assertions, allowing harmless whitespace and rejecting a changed operator', () => {
  const original = 'const value = 1\nexpect(!value || value === 1).toBe(true)'
  const formatted = [{ line: 1, deleteCount: 2, insert: 'const value = 2\nexpect( !value || value===1 ).toBe(true);' }]
  expect(varyPublicFixture(original, formatted)).toContain('value = 2')
  const changed = [{ line: 2, deleteCount: 1, insert: 'expect(~value || value === 1).toBe(true)' }]
  expect(() => varyPublicFixture(original, changed)).toThrow(/assertion.*line 2/i)
})

it('permits inspecting one awaited public result without changing its original resolves matcher or invoking the product twice', () => {
  const original = 'await expect(load(item)).resolves.toMatchObject({ok:true})'
  const captured = 'const record = await load(item)\nexpect(record).toMatchObject({ok:true})\nexpect(record.id).toBe(4)'
  const program = varyPublicFixture(original, [{ line: 1, deleteCount: 1, insert: captured }])
  expect(program.split('load(item)')).toHaveLength(2)
  expect(program).toContain('__devflowAssert')
  for (const altered of [
    captured.replace('load(item)', 'load(other)'),
    captured.replace('ok:true', 'ok:false'),
    captured.replace('const record', 'let record'),
    captured.replace('expect(record)', 'touch(record); expect(record)'),
  ]) {
    expect(() => varyPublicFixture(original, [{ line: 1, deleteCount: 1, insert: altered }])).toThrow(/assertion/i)
  }
})

it('reports the edited callback location when a variation drops a closing delimiter', () => {
  const original = 'await expect(load({id:1})).resolves.toEqual({ok:true})'
  const malformed = 'const record = await load({id:1,\nexpect(record).toEqual({ok:true})'
  expect(() => varyPublicFixture(original, [{ line: 1, deleteCount: 1, insert: malformed }])).toThrow(/syntax.*line.*TS\d+/i)
})

it('keeps an awaited public polling assertion and rejects replacing its polling or its matcher', () => {
  const control = "const operation = start('old')\nawait vi.waitFor(() => expect(operation.result).toBe('done'))"
  const changes = [{ line: 1, deleteCount: 1, insert: "const operation = start('new')" }]
  expect(varyPublicFixture(control, changes)).toContain("await vi.waitFor(() => expect(operation.result).toBe('done'))")
  for (const alternate of [
    "expect(operation.result).toBe('done')",
    "vi.waitFor(() => expect(operation.result).toBe('done'))",
    "await vi.waitFor(() => expect(operation.result).toBe('other'))",
  ]) {
    expect(() => varyPublicFixture(control, [{ line: 2, deleteCount: 1, insert: alternate }])).toThrow(/assertion/i)
  }
})

it('offers only immutable callbacks with assertions the authoring host can protect', () => {
  const fixture = fixtureTemplate(
    'queue.test.ts',
    `
    it('observes completion',async()=>{ await vi.waitFor(()=>expect(awaited.done).toBe(true)) })
    it('contains an example string',()=>{ trace('expect(fake).toBe(true)') })
  `,
  )
  const choose = (anchor: string) =>
    readFixtureSelection([criteria[0]!], [fixture], {
      scenarios: [{ anchor, units: ['r1.1'], precondition: 'The queue has an active operation' }],
      contextOnly: [{ unit: 'r1.2', reason: 'covered separately as a host limit' }],
    })
  expect(() => choose('f1:t1')).not.toThrow()
  expect(() => choose('f1:t2')).toThrow(/unsupported/)
})

it('makes immutable literal rows selectable while keeping the identity of neighboring cases', () => {
  const text = `import {test as check,expect} from 'vitest'
check.each([{mode:'disabled' as const},{mode:'enabled' as const}])('uses the saved $mode', async (policy) => {
  const sent = await invoke(policy)
  expect(sent.mode).toBe(policy.mode)
})
check('adjacent',()=>{expect(true).toBe(true)})
check.each(buildTable())('dynamic rows',(input)=>{expect(run(input)).toBe(1)})
check.skip.each([1])('skip this row',(input)=>{expect(input).toBe(1)})`
  const fixture = fixtureTemplate('setting.test.ts', text)
  expect(fixture.anchors.find((a) => a.id === 't2')?.title).toBe('adjacent')
  const rows = fixture.anchors.filter((a) => a.selectable && a.title.includes('uses the saved'))
  expect(rows.map((row) => row.id)).toEqual(['t1', 't1r2'])
  expect(rows.map((a) => a.title).join(' ')).toMatch(/disabled.*enabled/)
  expect(fixture.anchors.filter((a) => a.selectable)).toHaveLength(3)
  for (const row of rows) {
    const program = fixture.render(row.id, 'covers an actual mode', row.control!, true)
    expect(program.match(/__devflowFixtureCase\.sequential\(/g)).toHaveLength(2)
    expect(program).not.toContain('buildTable()')
    expect(program).not.toContain(row.title.includes('enabled') ? "'disabled'" : "'enabled'")
  }
})
