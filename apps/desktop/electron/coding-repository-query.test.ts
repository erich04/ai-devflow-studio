// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { expect, it } from 'vitest'
import { CodingCandidateWorkspace, codingRelativePath } from './coding-candidate-workspace'
import { codingMatchingLines, queryCodingSymbols } from './coding-repository-query'

it('finds cross-file symbol references in the current candidate and refuses stale source identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'coding-symbols-'))
  try {
    const delivery = path.join(root, 'input'); await mkdir(delivery)
    await writeFile(path.join(delivery, 'source.ts'), 'export const answer = 42\n')
    await writeFile(path.join(delivery, 'consumer.ts'), "import { answer } from './source'\nconsole.log(answer)\n")
    const workspace = await CodingCandidateWorkspace.create({ root: path.join(root, 'private'), delivery, baseCommitSha: 'a'.repeat(40), excludedPaths: [] })
    expect(await queryCodingSymbols(workspace, codingRelativePath, 'find_symbol', { query: 'answer' })).toMatchObject({ available: true, entries: expect.arrayContaining([expect.objectContaining({ name: 'answer', path: 'source.ts' })]) })
    const source = await workspace.read('source.ts')
    const result = await queryCodingSymbols(workspace, codingRelativePath, 'find_references', { path: 'source.ts', expectedHash: source.hash, line: 1, column: 15 })
    expect(result).toMatchObject({ available: true, entries: expect.arrayContaining([expect.objectContaining({ path: 'consumer.ts' })]) })
    await workspace.write('source.ts', 'export const replacement = 43\n', source.hash)
    await expect(queryCodingSymbols(workspace, codingRelativePath, 'find_references', { path: 'source.ts', expectedHash: source.hash, line: 1, column: 15 })).rejects.toThrow(/current source/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('supports regular expressions without allowing a pathological regex to block the main thread', async () => {
  const signal = new AbortController().signal
  expect(await codingMatchingLines('id=12\nother\nid=34', '^id=\\d+$', true, signal)).toEqual([0, 2])
  await expect(codingMatchingLines('a'.repeat(20000) + '!', '(a+)+$', true, signal)).rejects.toThrow(/one second|interrupted/)
})
