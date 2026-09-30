// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildNativeCodingV2RepairPrompt, type NativeCodingV2RepairPromptInput } from './native-coding-executor-v2.js'

const worktreePath = '/tmp/work/tree'
const largeSource = `${Array.from({ length: 3_000 }, (_, index) => `export const value${index + 1} = ${index + 1}`).join('\n')}\n`
const testSource = `${Array.from({ length: 60 }, (_, index) => index === 11
  ? '  expect(filterDone(items)).toEqual(expected)'
  : `  // test line ${index + 1}`).join('\n')}\n`

type Payload = {
  failureLocations?: Array<{ path: string; line: number; column?: number }>
  initialChangeSet: { changes?: Array<{ path: string; replacements: Array<{ oldText: string; newText: string }> }>; truncated?: boolean; paths?: string[]; bodyOmitted?: boolean }
  excerpts: Array<{ path: string; content: string; startLine?: number }>
  readOnlyExcerpts?: Array<{ path: string; startLine: number; content: string }>
}

function input(files: Record<string, string>, overrides: Partial<NativeCodingV2RepairPromptInput> = {}): NativeCodingV2RepairPromptInput {
  return {
    brief: 'DevFlow Coding Brief\nFilter completed items.',
    testFailure: {
      summary: 'Tests failed with exit code 1',
      stdout: [
        'FAIL src/filter.test.ts > filters done items',
        'AssertionError: expected [] to deeply equal [ 1 ]',
        ' ❯ src/filter.test.ts:12:17',
        ` ❯ ${worktreePath}/src/filter.ts:2500:3`,
        ' ❯ node_modules/vitest/dist/index.js:10:1',
        ' ❯ src/missing.ts:3:1',
      ].join('\n'),
      stderr: '',
    },
    worktreePath,
    initialChanges: [{ path: 'src/filter.ts', replacements: [{ oldText: 'export const value2500 = 2500', newText: 'export const value2500 = 0' }] }],
    readFile: async (filePath) => {
      const content = files[filePath]
      if (content === undefined) throw new Error('not readable')
      return content
    },
    ...overrides,
  }
}

describe('Native v2 repair prompt (ADR 0024 §6)', () => {
  it('centres editable excerpts on the first failure and adds read-only excerpts for other failing files', async () => {
    const built = await buildNativeCodingV2RepairPrompt(input({ 'src/filter.ts': largeSource, 'src/filter.test.ts': testSource }))
    expect(built.prompt.length).toBeLessThanOrEqual(30_000)
    const payload = JSON.parse(built.prompt) as Payload
    const keys = Object.keys(payload)
    expect(keys.slice(0, 3)).toEqual(['stateVersion', 'brief', 'testFailure'])
    expect(keys.slice(-2)).toEqual(['phase', 'limits'])
    expect(payload.failureLocations).toEqual([
      { path: 'src/filter.test.ts', line: 12, column: 17 },
      { path: 'src/filter.ts', line: 2500, column: 3 },
      { path: 'src/missing.ts', line: 3, column: 1 },
    ])
    const [excerpt] = payload.excerpts
    expect(excerpt!.path).toBe('src/filter.ts')
    expect(excerpt!.startLine).toBeGreaterThan(1)
    expect(excerpt!.content.startsWith(`export const value${excerpt!.startLine} = ${excerpt!.startLine}\n`)).toBe(true)
    expect(excerpt!.content).toContain('export const value2500 = 2500\n')
    // Unreadable failing files are skipped; the Change Set paths stay the only editable paths.
    expect(payload.readOnlyExcerpts).toEqual([{ path: 'src/filter.test.ts', startLine: 1, content: expect.stringContaining('expect(filterDone(items))') }])
    expect(payload.initialChangeSet).toEqual({ changes: [{ path: 'src/filter.ts', replacements: [{ oldText: 'export const value2500 = 2500', newText: 'export const value2500 = 0' }] }] })
    expect(built.excerptCount).toBe(1)
  })

  it('drops read-only excerpts, then the Change Set body, then failure locations, and shortens editable excerpts last', async () => {
    const editable = `${'export const keep = 1\n'.repeat(150)}`
    const files = { 'src/filter.ts': editable, 'src/filter.test.ts': testSource }
    const build = async (maxPromptChars: number) => {
      const built = await buildNativeCodingV2RepairPrompt(input(files, { maxPromptChars }))
      expect(built.prompt.length).toBeLessThanOrEqual(maxPromptChars)
      return { length: built.prompt.length, payload: JSON.parse(built.prompt) as Payload }
    }
    const full = await build(1_000_000)
    expect(full.payload.readOnlyExcerpts).toHaveLength(1)

    const withoutReadOnly = await build(full.length - 1)
    expect(withoutReadOnly.payload).not.toHaveProperty('readOnlyExcerpts')
    expect(withoutReadOnly.payload.initialChangeSet.changes).toHaveLength(1)
    expect(withoutReadOnly.payload.failureLocations).toHaveLength(3)

    const withoutBody = await build(withoutReadOnly.length - 1)
    expect(withoutBody.payload.initialChangeSet).toEqual({ paths: ['src/filter.ts'], bodyOmitted: true })
    expect(withoutBody.payload.failureLocations).toHaveLength(3)
    expect(withoutBody.payload.excerpts[0]!.content).toBe(editable)

    const withoutLocations = await build(withoutBody.length - 1)
    expect(withoutLocations.payload).not.toHaveProperty('failureLocations')
    expect(withoutLocations.payload.excerpts[0]!.content).toBe(editable)

    const shortened = await build(withoutLocations.length - 1)
    expect(shortened.payload.excerpts[0]!.content.length).toBeLessThan(editable.length)
  })

  it('bounds the initial Change Set body', async () => {
    const built = await buildNativeCodingV2RepairPrompt(input({ 'src/filter.ts': largeSource }, {
      initialChanges: [{ path: 'src/filter.ts', replacements: [{ oldText: 'export const value1 = 1', newText: 'x'.repeat(1_000) }] }],
    }))
    const payload = JSON.parse(built.prompt) as Payload
    expect(payload.initialChangeSet.truncated).toBe(true)
    expect(payload.initialChangeSet.changes![0]!.replacements[0]!.newText).toBe(`${'x'.repeat(800)}…`)
  })
})
