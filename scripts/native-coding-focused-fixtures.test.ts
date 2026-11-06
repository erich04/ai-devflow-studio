// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { focusedFixtures } from './native-coding-focused-fixtures'
import { qualifyFixtures, judgeFixture } from './native-coding-focused-live.mts'

it('both independent acceptance suites reject the broken input and accept the reference implementation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'focused-qualification-'))
  try {
    const result = await qualifyFixtures(path.join(root, 'qualification'))
    expect(result).toHaveLength(2)
    for (const row of result) { expect(row.baseline.passed).toBe(false); expect(row.reference.passed).toBe(true); expect(row.passed).toBe(true) }
    expect(result[0]!.reference.output).toMatch(/pass 6/)
    expect(result[1]!.reference.output).toMatch(/pass 5/)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 20000)

it('changing a public test cannot turn a failed candidate into accepted evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'focused-cheating-')), source = path.join(root, 'candidate')
  try {
    const fixture = focusedFixtures[0]!
    await mkdir(source)
    for (const [file, content] of Object.entries(fixture.files)) await writeFile(path.join(source, file), content)
    await writeFile(path.join(source, 'runner.test.js'), 'process.exit(0)')
    const result = await judgeFixture(fixture, source, path.join(root, 'evaluation'))
    expect(result.protectedUnchanged).toBe(false); expect(result.passed).toBe(false)
    expect(result.output).toMatch(/fail [1-9]/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
