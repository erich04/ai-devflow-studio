// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { computeSourceTreeDigest, withSourceTreeDigest } from './source-tree-digest.js'

const execFileAsync = promisify(execFile)
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function repository() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-source-tree-'))
  directories.push(directory)
  const git = (...args: string[]) => execFileAsync('git', ['-C', directory, ...args])
  await git('init', '-q', '-b', 'main')
  // The fixture's own commit must not start background maintenance that races the assertions.
  await git('config', 'gc.auto', '0')
  await git('config', 'maintenance.auto', 'false')
  await writeFile(path.join(directory, '.gitignore'), 'coverage/\n')
  await writeFile(path.join(directory, 'app.js'), 'export const value = 1\n')
  await git('add', '.')
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'init')
  return { directory, git }
}

describe('source tree digest (hardening H3)', () => {
  it('changes with tracked edits, staged edits and untracked files, but not ignored output', async () => {
    const { directory, git } = await repository()
    const clean = await computeSourceTreeDigest(directory)
    expect(clean).toEqual({ tracked: expect.stringMatching(/^[a-f0-9]{64}$/u), full: expect.stringMatching(/^[a-f0-9]{64}$/u) })
    expect(await computeSourceTreeDigest(directory)).toEqual(clean)

    await writeFile(path.join(directory, 'coverage.json'), 'ignored? no')
    const untracked = await computeSourceTreeDigest(directory)
    expect(untracked?.tracked).toBe(clean?.tracked)
    expect(untracked?.full).not.toBe(clean?.full)
    await rm(path.join(directory, 'coverage.json'))

    await execFileAsync('mkdir', ['-p', path.join(directory, 'coverage')])
    await writeFile(path.join(directory, 'coverage', 'report.txt'), 'ignored output')
    expect(await computeSourceTreeDigest(directory)).toEqual(clean)

    await writeFile(path.join(directory, 'app.js'), 'export const value = 2\n')
    const edited = await computeSourceTreeDigest(directory)
    expect(edited?.tracked).not.toBe(clean?.tracked)
    await git('add', 'app.js')
    expect((await computeSourceTreeDigest(directory))?.tracked).toBe(edited?.tracked)
  })

  it('never writes objects or the index', async () => {
    const { directory, git } = await repository()
    await writeFile(path.join(directory, 'new.js'), 'export const created = true\n')
    const objectId = (await git('hash-object', 'new.js')).stdout.trim()
    const index = path.join(directory, '.git', 'index')
    const indexBefore = await stat(index)
    await computeSourceTreeDigest(directory)
    await expect(git('cat-file', '-e', objectId)).rejects.toThrow()
    expect((await stat(index)).mtimeMs).toBe(indexBefore.mtimeMs)
  })

  it('returns null outside a Git checkout', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-source-tree-plain-'))
    directories.push(directory)
    expect(await computeSourceTreeDigest(directory)).toBeNull()
  })

  it('records the state a test left behind, and nothing when the test changed tracked code', async () => {
    const { directory } = await repository()
    const leavesOutput = await withSourceTreeDigest(directory, async () => {
      await writeFile(path.join(directory, 'test-output.log'), 'passed')
      return 'passed'
    })
    expect(leavesOutput.value).toBe('passed')
    expect(leavesOutput.digest).toBe((await computeSourceTreeDigest(directory))?.full)

    const editsCode = await withSourceTreeDigest(directory, async () => {
      await writeFile(path.join(directory, 'app.js'), 'export const value = 3\n')
      return 'passed'
    })
    expect(editsCode.digest).toBeUndefined()
  })
})
