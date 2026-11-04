// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CodingCommandRunner } from './coding-command-runner'
import { codingDigest } from './coding-candidate-workspace'
import { vitestIndependentResult } from './native-coding-vitest-checks'
import {
  freezeIndependentChecks, independentCheckResult, runIndependentChecks, validateFrozenIndependentChecks,
  type IndependentCheckSource,
} from './native-coding-independent-verification'

const roots: string[] = []
const source: IndependentCheckSource = {
  objectiveVersion: 1, baselineDigest: 'b'.repeat(64), sourceDigest: 'c'.repeat(64),
  criteria: [{ id: 'criterion-value', text: 'The exported value is 2.', sourceRef: 'approved-requirement@v1' }],
}
const checks = [{ criterionId: 'criterion-value', body: "const { value } = await import('./value.mjs'); check(value === 2);" }]
const frozen = () => freezeIndependentChecks(source, { checks }, '2026-11-02T00:00:00.000Z')
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('frozen independent acceptance', () => {
  it('returns only failed test locations that quote the approved source, never private test descriptions', () => {
    const result = vitestIndependentResult(frozen(), 'nonce', { status: 'failed', exitCode: 1 }, { nonce: 'nonce', rows: [
      { id: 'criterion-value', status: 'failed', tests: 2, failedTitles: ['The exported value is 2.', 'PRIVATE-EXPECTED-DETAIL'] },
    ] })
    expect(result.failedRequirements).toEqual([{ id: 'criterion-value', text: source.criteria[0]!.text, sourceRef: 'approved-requirement@v1' }])
    expect(JSON.stringify(result)).not.toContain('PRIVATE-EXPECTED-DETAIL')
  })
  it('requires exact coverage of approved criteria and binds code, source, and objective into the digest', () => {
    const plan = frozen()
    expect(validateFrozenIndependentChecks(plan)).toEqual(plan)
    expect(() => freezeIndependentChecks(source, { checks: [] }, plan.createdAt)).toThrow(/criteria/i)
    expect(() => freezeIndependentChecks(source, { checks: [...checks, ...checks] }, plan.createdAt)).toThrow(/criteria/i)
    expect(() => freezeIndependentChecks(source, { checks: [{ ...checks[0], criterionId: 'invented' }] }, plan.createdAt)).toThrow(/criteria/i)
    expect(() => validateFrozenIndependentChecks({ ...plan, checks: [{ ...checks[0]!, body: 'check(true)' }] })).toThrow(/digest/i)
    expect(() => validateFrozenIndependentChecks({ ...plan, objectiveVersion: 2 })).toThrow(/digest/i)
    expect(() => freezeIndependentChecks(source, { checks, extra: 'not a contract' }, plan.createdAt)).toThrow()
  })

  it('rejects oversized or non-executable-shaped plans without accepting a model completion claim', () => {
    expect(() => freezeIndependentChecks(source, { checks: [{ ...checks[0], body: '' }] }, '2026-11-02T00:00:00.000Z')).toThrow()
    expect(() => freezeIndependentChecks(source, { checks: [{ ...checks[0], body: 'x'.repeat(64001) }] }, '2026-11-02T00:00:00.000Z')).toThrow()
    expect(() => freezeIndependentChecks(source, { completed: true }, '2026-11-02T00:00:00.000Z')).toThrow()
  })

  it('fails incorrect product behavior, passes the repaired behavior, and removes the private check file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-independent-')); roots.push(root)
    const directory = path.join(root, 'verification'); await mkdir(directory)
    const runner = new CodingCommandRunner(path.join(root, 'commands'))
    await writeFile(path.join(directory, 'value.mjs'), 'export const value = 1')
    const failed = await runIndependentChecks({ plan: frozen(), runner, directory, profile: { kind: 'trusted_local' }, operationId: 'first' })
    expect(failed.status).toBe('failed')
    expect(failed.failedCriteria).toEqual(['criterion-value'])
    expect(await readdir(directory)).toEqual(['value.mjs'])
    expect(await readFile(path.join(directory, 'value.mjs'), 'utf8')).toBe('export const value = 1')
    await writeFile(path.join(directory, 'value.mjs'), 'export const value = 2')
    const passed = await runIndependentChecks({ plan: frozen(), runner, directory, profile: { kind: 'trusted_local' }, operationId: 'second' })
    expect(passed).toMatchObject({ status: 'passed', checkedCriteria: ['criterion-value'], failedCriteria: [], planDigest: frozen().digest })
    expect(await readdir(directory)).toEqual(['value.mjs'])
  })

  it('does not mistake exit zero, no assertion, or a missing host completion record for passing acceptance', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-independent-')); roots.push(root)
    const directory = path.join(root, 'verification'); await mkdir(directory)
    const runner = new CodingCommandRunner(path.join(root, 'commands'))
    for (const [index, body] of ['process.exit(0)', 'const unused = 2;', 'check("true")', 'try { check(false) } catch {} check(true)'].entries()) {
      const plan = freezeIndependentChecks(source, { checks: [{ criterionId: 'criterion-value', body }] }, '2026-11-02T00:00:00.000Z')
      const result = await runIndependentChecks({ plan, runner, directory, profile: { kind: 'trusted_local' }, operationId: `no-proof-${index}` })
      expect(result.status).toBe(index < 2 ? 'invalid' : 'failed')
    }
    expect(independentCheckResult(frozen(), 'wrong-token', { status: 'passed', exitCode: 0, output: '{"passed":true}' }).status).toBe('invalid')
  })

  it('keeps generated assertion values out of public failure evidence', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-independent-')); roots.push(root)
    const directory = path.join(root, 'verification'); await mkdir(directory)
    const runner = new CodingCommandRunner(path.join(root, 'commands'))
    const privateValue = 'PRIVATE-EXPECTED-VALUE-48291'
    const plan = freezeIndependentChecks(source, { checks: [{ criterionId: 'criterion-value', body: `throw new Error(${JSON.stringify(privateValue)});` }] }, '2026-11-02T00:00:00.000Z')
    const result = await runIndependentChecks({ plan, runner, directory, profile: { kind: 'trusted_local' }, operationId: 'hidden' })
    expect(result.status).toBe('invalid')
    expect(JSON.stringify(result)).not.toContain(privateValue)
    expect(result.planDigest).toBe(codingDigest(JSON.stringify(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'digest')))))
  })

  it('distinguishes a broken check from an actual failed requirement without leaking private details', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-independent-')); roots.push(root)
    const directory = path.join(root, 'verification'); await mkdir(directory)
    const runner = new CodingCommandRunner(path.join(root, 'commands'))
    for (const [index, body] of ['const report = ""/private/report.json""; check(true)', 'throw new TypeError("PRIVATE-FIXTURE-DETAIL")', 'check(false)'].entries()) {
      const plan = freezeIndependentChecks(source, { checks: [{ criterionId: 'criterion-value', body }] }, '2026-11-02T00:00:00.000Z')
      const result = await runIndependentChecks({ plan, runner, directory, profile: { kind: 'trusted_local' }, operationId: `fault-${index}` })
      expect(result).toMatchObject(index < 2
        ? { status: 'invalid', failedCriteria: [], invalidCriteria: ['criterion-value'] }
        : { status: 'failed', failedCriteria: ['criterion-value'], invalidCriteria: [] })
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE-FIXTURE-DETAIL|private\/report/)
    }
  })

  it('owns Vitest file paths and reports, rejecting invalid, skipped and assertion-free checks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-independent-')); roots.push(root)
    const directory = path.join(root, 'verification'); await mkdir(directory); await mkdir(path.join(directory, 'tests'))
    await symlink(path.resolve('node_modules'), path.join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    await writeFile(path.join(directory, 'package.json'), '{"type":"module"}')
    await writeFile(path.join(directory, 'vitest.config.mjs'), "export default { test: { environment: 'node', include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] } }")
    await writeFile(path.join(directory, 'value.ts'), 'export const value = 2')
    const runner = new CodingCommandRunner(path.join(root, 'commands'))
    for (const [index, [body, status, extension]] of [
      ["import { test, expect } from 'vitest'; import { value } from '../value'; test('behavior', () => expect(value).toBe(2));", 'passed'],
      ["import { test, expect } from 'vitest'; import { value } from '../value'; test('behavior', () => expect(value).toBe(3));", 'failed'],
      ["import { test, expect } from 'vitest'; expect.extend({toMeetContract(){return {pass:false, message:()=> 'PRIVATE-FIXTURE-DETAIL'}}}); test('custom matcher',()=>expect(2).toMeetContract());", 'failed'],
      ["import { test, expect } from 'vitest'; expect.extend({toMeetContract(){throw Object.assign(new Error('PRIVATE-FIXTURE-DETAIL'),{actual:2,expected:3})}}); test('broken matcher',()=>expect(2).toMeetContract());", 'invalid'],
      ['const report = ""/private/report.json"";', 'invalid'],
      ["import { test } from 'vitest'; test('empty', () => {});", 'invalid'],
      ["import { test, expect } from 'vitest'; test.skip('skipped', () => expect(true).toBe(true));", 'invalid'],
      ["import { test } from 'vitest'; test('bad fixture', () => { throw new TypeError('PRIVATE-FIXTURE-DETAIL') });", 'invalid'],
      ["import { test, expect } from 'vitest'; const React = { createElement: (type: string) => ({ type }) }; test('JSX fixture', () => expect((<div />).type).toBe('div'));", 'passed', 'tsx'],
    ].entries()) {
      const plan = freezeIndependentChecks({ ...source, adapter: { kind: 'vitest', directory: 'tests', extension: extension === 'tsx' ? 'tsx' : 'ts' } }, { checks: [{ criterionId: 'criterion-value', body, baselineExpectation: 'fail' }] }, '2026-11-02T00:00:00.000Z')
      const result = await runIndependentChecks({ plan, runner, directory, profile: { kind: 'trusted_local' }, operationId: `framework-${index}` })
      expect(result.status, `case ${index}`).toBe(status)
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE-FIXTURE-DETAIL|private\/report/)
      expect(await readdir(path.join(directory, 'tests'))).toEqual([])
      expect((await readdir(directory)).filter(name => name.startsWith('.devflow-'))).toEqual([])
    }
  }, 30000)
})
