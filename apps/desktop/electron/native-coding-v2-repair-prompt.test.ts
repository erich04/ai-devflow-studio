// @vitest-environment node
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCodingWorkspaceTextFile } from './coding-change-set.js'
import {
  buildNativeCodingV2RepairPrompt,
  redactFileForExcerpts,
  type NativeCodingV2RepairPromptInput,
} from './native-coding-executor-v2.js'

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

describe('Native v2 repair excerpts are redacted before windowing (ADR 0024 §6)', () => {
  // Test fixture only: a syntactically shaped key block, not a real credential.
  const keyBlock = ['-----BEGIN RSA PRIVATE KEY-----', ...Array.from({ length: 25 }, (_, index) => `FIXTUREKEYMATERIAL${String(index).padStart(2, '0')}abcdefghijklmnopqrstuvwxyz`), '-----END RSA PRIVATE KEY-----']
  const testFile = [
    ...Array.from({ length: 10 }, (_, index) => `// header ${index + 1}`),
    ...keyBlock,
    ...Array.from({ length: 11 }, (_, index) => `// setup ${index + 1}`),
    '  expect(filterDone(items)).toEqual(expected)',
    ...Array.from({ length: 20 }, (_, index) => `// tail ${index + 1}`),
  ].join('\n')
  const failingLine = 10 + keyBlock.length + 12

  it('keeps line numbers while masking a private key that a window edge would cut', () => {
    const redacted = redactFileForExcerpts(testFile)
    expect(redacted.lineAligned).toBe(true)
    expect(redacted.content).not.toContain('FIXTUREKEYMATERIAL')
    expect(redacted.content.split('\n')[failingLine - 1]).toBe('  expect(filterDone(items)).toEqual(expected)')
    // A key marker without its pair (for example a truncated file) is dropped too.
    expect(redactFileForExcerpts('-----BEGIN RSA PRIVATE KEY-----\nMIIE').content).not.toContain('BEGIN RSA PRIVATE KEY')
  })

  it('sends no key material in a read-only excerpt centred near the key', async () => {
    const built = await buildNativeCodingV2RepairPrompt(input({ 'src/filter.ts': 'export const filter = 1\n', 'src/filter.test.ts': testFile }, {
      testFailure: { summary: 'failed', stdout: ` ❯ src/filter.test.ts:${failingLine}:5`, stderr: '' },
      initialChanges: [{ path: 'src/filter.ts', replacements: [{ oldText: 'filter = 0', newText: 'filter = 1' }] }],
    }))
    expect(built.prompt).not.toContain('FIXTUREKEYMATERIAL')
    const payload = JSON.parse(built.prompt) as Payload
    const [readOnly] = payload.readOnlyExcerpts!
    expect(readOnly!.content).toContain('[REDACTED:private_key]')
    expect(readOnly!.content.split('\n')[failingLine - readOnly!.startLine]).toBe('  expect(filterDone(items)).toEqual(expected)')
  })

  it('reads read-only excerpts through the real worktree guard, skipping symlinks and internal folders', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-repair-guard-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'devflow-repair-outside-'))
    try {
      await mkdir(path.join(root, 'src'))
      await mkdir(path.join(root, 'build'))
      await mkdir(path.join(root, '.devflow'))
      await writeFile(path.join(root, 'src/filter.ts'), 'export const filter = 1\n')
      await writeFile(path.join(root, 'build/acceptance.test.mjs'), 'assert.equal(greeting, "x")\n')
      await writeFile(path.join(root, '.devflow/state.json'), '{"secret":"internal"}\n')
      await writeFile(path.join(outside, 'private.ts'), 'export const outsideSecret = "leak"\n')
      await symlink(path.join(outside, 'private.ts'), path.join(root, 'src/linked.ts'))
      const built = await buildNativeCodingV2RepairPrompt({
        brief: 'DevFlow Coding Brief',
        testFailure: {
          summary: 'failed',
          stdout: [' ❯ build/acceptance.test.mjs:1:1', ' ❯ src/linked.ts:1:1', ' ❯ .devflow/state.json:1:1'].join('\n'),
          stderr: '',
        },
        worktreePath: root,
        initialChanges: [{ path: 'src/filter.ts', replacements: [{ oldText: 'filter = 0', newText: 'filter = 1' }] }],
        readFile: (filePath) => readCodingWorkspaceTextFile(root, filePath),
      })
      const payload = JSON.parse(built.prompt) as Payload
      expect(payload.readOnlyExcerpts?.map((excerpt) => excerpt.path)).toEqual(['build/acceptance.test.mjs'])
      expect(built.prompt).not.toContain('outsideSecret')
      expect(built.prompt).not.toContain('internal')
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
