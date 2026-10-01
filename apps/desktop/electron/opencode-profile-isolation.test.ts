// @vitest-environment node
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createIsolatedOpencodeProfile, opencodeToolBinDirectory } from './opencode-profile-isolation'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('isolated OpenCode profile tool cache (#209)', () => {
  it('shares downloaded tool binaries across profiles and keeps them when a profile is disposed', async () => {
    const owner = await mkdtemp(path.join(tmpdir(), 'devflow-tool-cache-test-'))
    roots.push(owner)
    const shared = path.join(owner, 'tool-bin')

    const first = await createIsolatedOpencodeProfile('devflow-profile-test-', { isolateHome: true, toolCacheDirectory: shared })
    expect(first.env.XDG_CACHE_HOME).toBe(path.join(first.root, 'cache'))
    // OpenCode writes ripgrep into the profile's bin directory, which resolves to the shared cache.
    await writeFile(path.join(opencodeToolBinDirectory(first.root), 'rg'), 'binary')
    await first.dispose()
    expect(existsSync(first.root)).toBe(false)
    expect(await readFile(path.join(shared, 'rg'), 'utf8')).toBe('binary')

    const second = await createIsolatedOpencodeProfile('devflow-profile-test-', { toolCacheDirectory: shared })
    expect(await readFile(path.join(opencodeToolBinDirectory(second.root), 'rg'), 'utf8')).toBe('binary')
    await second.dispose()
    expect(await readFile(path.join(shared, 'rg'), 'utf8')).toBe('binary')
  })

  it('still creates a working profile when the shared cache cannot be prepared', async () => {
    const owner = await mkdtemp(path.join(tmpdir(), 'devflow-tool-cache-test-'))
    roots.push(owner)
    const blocked = path.join(owner, 'not-a-directory')
    await writeFile(blocked, 'file')

    const profile = await createIsolatedOpencodeProfile('devflow-profile-test-', { toolCacheDirectory: path.join(blocked, 'tool-bin') })
    expect(existsSync(opencodeToolBinDirectory(profile.root))).toBe(false)
    await profile.dispose()
    expect(existsSync(profile.root)).toBe(false)
  })

  it('creates no shared link without a tool cache directory', async () => {
    const profile = await createIsolatedOpencodeProfile('devflow-profile-test-')
    expect(existsSync(opencodeToolBinDirectory(profile.root))).toBe(false)
    await profile.dispose()
  })
})
