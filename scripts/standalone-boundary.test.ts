import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertSelfContainedDirectory } from './standalone-boundary.mjs'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  )
})

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'devflow-standalone-boundary-'))
  temporaryRoots.push(parent)
  const root = path.join(parent, 'artifact')
  const outside = path.join(parent, 'outside')
  await Promise.all([mkdir(path.join(root, 'packages'), { recursive: true }), mkdir(outside)])
  await writeFile(path.join(root, 'packages', 'runtime.js'), 'export const ready = true\n')
  await writeFile(path.join(outside, 'host-only.js'), 'must not be used\n')
  return { root, outside }
}

describe.skipIf(process.platform === 'win32')('standalone artifact boundary', () => {
  it('accepts a relative symlink that resolves entirely inside the artifact', async () => {
    const { root } = await fixture()
    await symlink('packages', path.join(root, 'node_modules'))

    await expect(assertSelfContainedDirectory(root)).resolves.toBeUndefined()
  })

  it('rejects an absolute symlink into the host dependency tree', async () => {
    const { root, outside } = await fixture()
    await symlink(outside, path.join(root, 'node_modules'))

    await expect(assertSelfContainedDirectory(root)).rejects.toThrow(
      'Standalone artifact contains an absolute symlink',
    )
  })

  it('rejects an absolute symlink even when it currently resolves inside the artifact', async () => {
    const { root } = await fixture()
    await symlink(path.join(root, 'packages'), path.join(root, 'node_modules'))

    await expect(assertSelfContainedDirectory(root)).rejects.toThrow(
      'Standalone artifact contains an absolute symlink',
    )
  })

  it('rejects a relative symlink that escapes the artifact root', async () => {
    const { root } = await fixture()
    await symlink('../outside', path.join(root, 'node_modules'))

    await expect(assertSelfContainedDirectory(root)).rejects.toThrow(
      'Standalone artifact symlink escapes its root',
    )
  })
})
