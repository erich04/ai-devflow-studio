import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectDesktopArtifactTrio,
  inspectDesktopArtifactTrioSync,
  stageDesktopArtifactTrio,
} from './desktop-artifact-trio.mjs'

const temporaryRoots: string[] = []
const execFileAsync = promisify(execFile)
const trioCliPath = path.resolve('scripts/desktop-artifact-trio.mjs')

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function createTrioFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-desktop-trio-test-'))
  temporaryRoots.push(root)
  const version = '1.5.0'
  const platform = 'darwin'
  const arch = 'arm64'
  const label = `ai-devflow-studio-desktop-${version}-${platform}-${arch}`
  const manifestName = `${label}.manifest.json`
  const archiveName = `${label}.tar.gz`
  const archive = Buffer.from('candidate-bound-desktop-archive')
  const archiveSha256 = createHash('sha256').update(archive).digest('hex')
  const indexPath = path.join(root, 'artifact-index.json')

  await writeFile(path.join(root, archiveName), archive)
  await writeFile(
    path.join(root, manifestName),
    `${JSON.stringify({
      schemaVersion: 1,
      artifact: {
        productName: 'AI DevFlow Studio',
        version,
        electronVersion: '33.4.11',
        platform,
        arch,
        signed: false,
        installer: false,
        runtimeDependencies: { electron: '33.4.11', 'sql.js': '1.14.1' },
      },
      entries: [],
      archive: { path: archiveName, sha256: archiveSha256 },
    })}\n`,
  )
  await writeFile(
    indexPath,
    `${JSON.stringify({
      schemaVersion: 1,
      platform,
      arch,
      appDirectory: `app-directory/AI DevFlow Studio-${platform}-${arch}`,
      manifest: manifestName,
      archive: archiveName,
    })}\n`,
  )

  return { root, indexPath, manifestName, archiveName, archive, archiveSha256 }
}

describe('Desktop artifact trio', () => {
  it('inspects and stages the exact candidate-bound trio', async () => {
    const fixture = await createTrioFixture()
    const inspected = inspectDesktopArtifactTrioSync(fixture.indexPath, { exclusive: true })

    expect(inspected).toMatchObject({
      version: '1.5.0',
      platform: 'darwin',
      arch: 'arm64',
      indexName: 'artifact-index.json',
      manifestName: fixture.manifestName,
      archiveName: fixture.archiveName,
      archiveSha256: fixture.archiveSha256,
      archiveSize: fixture.archive.length,
    })

    const destination = path.join(path.dirname(fixture.root), `${path.basename(fixture.root)}-staged`)
    temporaryRoots.push(destination)
    await stageDesktopArtifactTrio(fixture.indexPath, destination, { exclusiveSource: true })

    expect((await readdir(destination)).sort()).toEqual(
      ['artifact-index.json', fixture.manifestName, fixture.archiveName].sort(),
    )
    expect(await readFile(path.join(destination, fixture.archiveName))).toEqual(fixture.archive)
  })

  it('rejects a source directory with any fourth top-level entry when exclusivity is required', async () => {
    const fixture = await createTrioFixture()
    await writeFile(path.join(fixture.root, 'unrecorded.txt'), 'not part of the candidate\n')

    await expect(
      inspectDesktopArtifactTrio(fixture.indexPath, { exclusive: true }),
    ).rejects.toMatchObject({ code: 'artifact_source_not_exclusive' })
  })

  it('rejects a symlink masquerading as one of the candidate files', async () => {
    const fixture = await createTrioFixture()
    const target = path.join(fixture.root, 'archive-target')
    await writeFile(target, fixture.archive)
    await rm(path.join(fixture.root, fixture.archiveName))
    await symlink(target, path.join(fixture.root, fixture.archiveName))

    await expect(inspectDesktopArtifactTrio(fixture.indexPath)).rejects.toMatchObject({
      code: 'artifact_archive_not_regular',
    })
  })

  it('rejects archive bytes that do not match the manifest digest', async () => {
    const fixture = await createTrioFixture()
    await writeFile(path.join(fixture.root, fixture.archiveName), 'tampered archive bytes')

    await expect(inspectDesktopArtifactTrio(fixture.indexPath)).rejects.toMatchObject({
      code: 'artifact_digest_mismatch',
    })
  })

  it('rejects index paths that can escape the candidate directory', async () => {
    const fixture = await createTrioFixture()
    const index = JSON.parse(await readFile(fixture.indexPath, 'utf8'))
    index.manifest = '../outside.manifest.json'
    await writeFile(fixture.indexPath, JSON.stringify(index))

    await expect(inspectDesktopArtifactTrio(fixture.indexPath)).rejects.toMatchObject({
      code: 'artifact_index_path_invalid',
    })
  })

  it('exposes inspect, verify, and stage through the command line', async () => {
    const fixture = await createTrioFixture()
    const inspected = await execFileAsync(process.execPath, [
      trioCliPath,
      'inspect',
      fixture.indexPath,
    ])
    const verified = await execFileAsync(process.execPath, [
      trioCliPath,
      'verify',
      fixture.indexPath,
      '--exclusive',
    ])
    const destination = path.join(path.dirname(fixture.root), `${path.basename(fixture.root)}-cli`)
    temporaryRoots.push(destination)
    const staged = await execFileAsync(process.execPath, [
      trioCliPath,
      'stage',
      fixture.indexPath,
      destination,
      '--exclusive-source',
    ])

    expect(JSON.parse(inspected.stdout)).toMatchObject({ status: 'ok', command: 'inspect' })
    expect(JSON.parse(verified.stdout)).toMatchObject({ status: 'ok', command: 'verify' })
    expect(JSON.parse(staged.stdout)).toMatchObject({
      status: 'ok',
      command: 'stage',
      archiveSha256: fixture.archiveSha256,
    })
  })
})
