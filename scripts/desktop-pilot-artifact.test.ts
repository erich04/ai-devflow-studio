import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gunzipSync } from 'node:zlib'
import {
  createDesktopArtifactManifest,
  resolveDesktopExecutablePath,
  stageDesktopPilotApplication,
  writeDeterministicTarGzip,
} from './desktop-pilot-artifact.mjs'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixtureDirectory() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-desktop-artifact-test-'))
  tempRoots.push(root)
  const appDirectory = path.join(root, 'AI DevFlow Studio.app')
  await mkdir(path.join(appDirectory, 'Contents', 'Resources'), { recursive: true })
  await writeFile(path.join(appDirectory, 'Contents', 'Resources', 'app.json'), '{"ok":true}\n')
  const executable = path.join(appDirectory, 'Contents', 'runner')
  await writeFile(executable, '#!/bin/sh\nexit 0\n')
  await chmod(executable, 0o755)
  return { root, appDirectory, executable }
}

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

describe('Desktop pilot artifact', () => {
  it('creates a stable, path-safe manifest independent of source mtimes', async () => {
    const { appDirectory, executable } = await fixtureDirectory()
    const metadata = {
      productName: 'AI DevFlow Studio',
      version: '1.4.0',
      electronVersion: '33.4.11',
      platform: 'darwin',
      arch: 'arm64',
    }

    const first = await createDesktopArtifactManifest(appDirectory, metadata)
    await utimes(executable, new Date('2035-01-01T00:00:00.000Z'), new Date('2035-01-01T00:00:00.000Z'))
    const second = await createDesktopArtifactManifest(appDirectory, metadata)

    expect(second).toEqual(first)
    expect(first.entries.map((entry) => entry.path)).toEqual(
      [...first.entries.map((entry) => entry.path)].sort(),
    )
    expect(JSON.stringify(first)).not.toContain(appDirectory)
    expect(first.entries).toContainEqual(
      expect.objectContaining({
        path: 'Contents/runner',
        type: 'file',
        mode: '0755',
      }),
    )
  })

  it('writes the same portable archive bytes after source mtimes change', async () => {
    const { root, appDirectory, executable } = await fixtureDirectory()
    const firstArchive = path.join(root, 'first.tar.gz')
    const secondArchive = path.join(root, 'second.tar.gz')

    await writeDeterministicTarGzip({
      sourceDirectory: appDirectory,
      archivePath: firstArchive,
      archiveRootName: 'ai-devflow-studio-darwin-arm64',
    })
    await utimes(executable, new Date('2040-01-01T00:00:00.000Z'), new Date('2040-01-01T00:00:00.000Z'))
    await writeDeterministicTarGzip({
      sourceDirectory: appDirectory,
      archivePath: secondArchive,
      archiveRootName: 'ai-devflow-studio-darwin-arm64',
    })

    const first = await readFile(firstArchive)
    const second = await readFile(secondArchive)
    expect(sha256(second)).toBe(sha256(first))
    expect(gunzipSync(first).subarray(0, 100).toString('utf8')).toContain(
      'ai-devflow-studio-darwin-arm64/',
    )
  })

  it('stages only built application files and the sql.js runtime dependency', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-desktop-staging-test-'))
    tempRoots.push(root)
    const desktopDirectory = path.join(root, 'desktop')
    const sqlJsDirectory = path.join(root, 'sql.js')
    const stagingDirectory = path.join(root, 'staging')
    await mkdir(path.join(desktopDirectory, 'dist'), { recursive: true })
    await mkdir(path.join(desktopDirectory, 'dist-electron'), { recursive: true })
    await mkdir(path.join(desktopDirectory, 'electron'), { recursive: true })
    await mkdir(path.join(sqlJsDirectory, 'dist'), { recursive: true })
    await writeFile(
      path.join(desktopDirectory, 'package.json'),
      JSON.stringify({
        name: '@ai-devflow/desktop',
        version: '1.4.0',
        type: 'module',
        main: 'dist-electron/main.js',
        dependencies: { '@ai-devflow/shared': 'workspace:*', 'sql.js': '^1.14.1' },
      }),
    )
    await writeFile(path.join(desktopDirectory, 'dist', 'index.html'), '<main>built</main>')
    await writeFile(path.join(desktopDirectory, 'dist-electron', 'main.js'), "import 'sql.js'\n")
    await writeFile(path.join(desktopDirectory, 'dist-electron', 'preload.cjs'), 'module.exports = {}\n')
    await writeFile(path.join(desktopDirectory, 'electron', 'source.ts'), 'not packaged\n')
    await writeFile(path.join(sqlJsDirectory, 'package.json'), JSON.stringify({ name: 'sql.js', version: '1.14.1' }))
    await writeFile(path.join(sqlJsDirectory, 'dist', 'sql-wasm.js'), 'module.exports = {}\n')

    await stageDesktopPilotApplication({ desktopDirectory, stagingDirectory, sqlJsDirectory })

    const stagedPackage = JSON.parse(await readFile(path.join(stagingDirectory, 'package.json'), 'utf8'))
    expect(stagedPackage).toMatchObject({
      name: 'ai-devflow-studio-desktop',
      productName: 'AI DevFlow Studio',
      version: '1.4.0',
      main: 'dist-electron/main.js',
      dependencies: { 'sql.js': '1.14.1' },
    })
    expect(await readFile(path.join(stagingDirectory, 'dist', 'index.html'), 'utf8')).toContain('built')
    expect(await readFile(path.join(stagingDirectory, 'node_modules', 'sql.js', 'dist', 'sql-wasm.js'), 'utf8')).toContain(
      'module.exports',
    )
    await expect(readFile(path.join(stagingDirectory, 'electron', 'source.ts'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('resolves the packaged executable for each supported host platform', () => {
    expect(resolveDesktopExecutablePath('/artifact', 'darwin')).toBe(
      path.join('/artifact', 'AI DevFlow Studio.app', 'Contents', 'MacOS', 'AI DevFlow Studio'),
    )
    expect(resolveDesktopExecutablePath('/artifact', 'linux')).toBe(
      path.join('/artifact', 'AI DevFlow Studio'),
    )
    expect(resolveDesktopExecutablePath('C:\\artifact', 'win32')).toBe(
      path.join('C:\\artifact', 'AI DevFlow Studio.exe'),
    )
  })
})
