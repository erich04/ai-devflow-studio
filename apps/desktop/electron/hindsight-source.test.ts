// @vitest-environment node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readSelectedKnowledgeSource } from './repository-knowledge'

const exec = promisify(execFile)
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

it('verifies a selected tracked file independently of the bounded catalogue and hashes its current bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hindsight-source-')); roots.push(root)
  await exec('git', ['init', root])
  await mkdir(path.join(root, 'docs/knowledge'), { recursive: true })
  const sourcePath = 'docs/knowledge/[rule].md'
  await writeFile(path.join(root, sourcePath), 'old')
  await exec('git', ['-C', root, 'add', '.'])
  await writeFile(path.join(root, sourcePath), 'abc')
  const read = () => readSelectedKnowledgeSource(root, 'docs/knowledge', sourcePath)
  await expect(read()).resolves.toMatchObject({
    status: 'current', markdown: 'abc',
    contentDigest: 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  })
  await rm(path.join(root, sourcePath))
  await expect(read()).resolves.toEqual({ status: 'missing' })
  await writeFile(path.join(root, sourcePath), 'new')
  await exec('git', ['-C', root, 'rm', '--cached', '-f', '--', sourcePath])
  await expect(read()).resolves.toEqual({ status: 'untracked' })
})

it('never reads root instructions, outside-root files, untracked files or symlink targets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hindsight-source-')); roots.push(root)
  await exec('git', ['init', root])
  await mkdir(path.join(root, 'docs/knowledge'), { recursive: true })
  await writeFile(path.join(root, 'AGENTS.md'), 'host instructions')
  await symlink(path.join(root, 'AGENTS.md'), path.join(root, 'docs/knowledge/link.md'))
  await exec('git', ['-C', root, 'add', '.'])
  for (const sourcePath of ['AGENTS.md', '../AGENTS.md', 'docs/knowledge/link.md']) {
    expect((await readSelectedKnowledgeSource(root, '', sourcePath)).status).toBe('unverified')
  }
  await rm(root, { recursive: true })
  await expect(readSelectedKnowledgeSource(root, 'docs/knowledge', 'a.md')).resolves.toEqual({ status: 'unverified' })
})
