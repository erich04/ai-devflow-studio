import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createGitHubOutboundContentScanner,
  GitHubOutboundContentScanError,
} from './github-outbound-content-scan.js'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []
const scannedAt = '2026-08-17T20:00:00.000Z'

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

describe('GitHub outbound content scanner', () => {
  it('scans the exact linear commit range and returns a metadata-only receipt', async () => {
    const repo = await gitRepo()
    const baseCommitSha = await commitFile(repo, 'README.md', '# Safe base\n', 'base')
    const expectedCommitSha = await commitFile(
      repo,
      'src/change.ts',
      'export const answer = 42\n',
      'Add a bounded safe change',
    )

    const receipt = await createGitHubOutboundContentScanner({
      now: () => scannedAt,
    }).scan({ worktreePath: repo, baseCommitSha, expectedCommitSha })

    expect(receipt).toMatchObject({
      stateVersion: 1,
      scannerVersion: 1,
      baseCommitSha,
      expectedCommitSha,
      commitCount: 1,
      secretMatchCount: 0,
      scannedAt,
      status: 'safe',
    })
    expect(receipt.scanDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(JSON.stringify(receipt)).not.toContain(repo)
    expect(JSON.stringify(receipt)).not.toContain('export const answer')
  })

  it('blocks a secret introduced by an intermediate commit even when the final tree removes it', async () => {
    const repo = await gitRepo()
    const baseCommitSha = await commitFile(repo, 'README.md', '# Safe base\n', 'base')
    const token = `ghp_${'a1B2'.repeat(6)}`
    await commitFile(repo, 'src/temporary.ts', `export const token = '${token}'\n`, 'temporary')
    await git(repo, ['rm', 'src/temporary.ts'])
    await git(repo, ['commit', '-m', 'remove temporary file'])
    const expectedCommitSha = await head(repo)

    await expect(createGitHubOutboundContentScanner({
      now: () => scannedAt,
    }).scan({ worktreePath: repo, baseCommitSha, expectedCommitSha })).rejects.toMatchObject({
      code: 'content_scan_blocked',
    })
  })

  it('does not treat a deletion-only line already present in the approved base as new outbound content', async () => {
    const repo = await gitRepo()
    const token = `ghp_${'c3D4'.repeat(6)}`
    const baseCommitSha = await commitFile(
      repo,
      'src/legacy.ts',
      `export const oldToken = '${token}'\n`,
      'base with already-published fixture',
    )
    await git(repo, ['rm', 'src/legacy.ts'])
    await git(repo, ['commit', '-m', 'remove legacy fixture'])
    const expectedCommitSha = await head(repo)

    await expect(createGitHubOutboundContentScanner({
      now: () => scannedAt,
    }).scan({ worktreePath: repo, baseCommitSha, expectedCommitSha })).resolves.toMatchObject({
      status: 'safe',
      secretMatchCount: 0,
    })
  })

  it('blocks high-confidence credentials in commit metadata and binary payloads', async () => {
    const metadataRepo = await gitRepo()
    const metadataBase = await commitFile(metadataRepo, 'README.md', '# Safe base\n', 'base')
    const metadataToken = `ghp_${'e5F6'.repeat(6)}`
    await commitFile(metadataRepo, 'safe.txt', 'safe\n', `leaked ${metadataToken}`)
    await expect(createGitHubOutboundContentScanner().scan({
      worktreePath: metadataRepo,
      baseCommitSha: metadataBase,
      expectedCommitSha: await head(metadataRepo),
    })).rejects.toBeInstanceOf(GitHubOutboundContentScanError)

    const binaryRepo = await gitRepo()
    const binaryBase = await commitFile(binaryRepo, 'README.md', '# Safe base\n', 'base')
    const binaryToken = `ghp_${'g7H8'.repeat(6)}`
    await writeFile(path.join(binaryRepo, 'fixture.bin'), Buffer.concat([
      Buffer.from('prefix\0', 'latin1'),
      Buffer.from(binaryToken, 'latin1'),
    ]))
    await git(binaryRepo, ['add', 'fixture.bin'])
    await git(binaryRepo, ['commit', '-m', 'add binary fixture'])
    await expect(createGitHubOutboundContentScanner().scan({
      worktreePath: binaryRepo,
      baseCommitSha: binaryBase,
      expectedCommitSha: await head(binaryRepo),
    })).rejects.toMatchObject({ code: 'content_scan_blocked' })

    const attributedRepo = await gitRepo()
    const attributedBase = await commitFile(
      attributedRepo,
      '.gitattributes',
      'forced-binary.txt -diff\n',
      'base attributes',
    )
    const attributedToken = `ghp_${'i9J0'.repeat(6)}`
    await commitFile(
      attributedRepo,
      'forced-binary.txt',
      `credential=${attributedToken}\n`,
      'add text classified as binary',
    )
    await expect(createGitHubOutboundContentScanner().scan({
      worktreePath: attributedRepo,
      baseCommitSha: attributedBase,
      expectedCommitSha: await head(attributedRepo),
    })).rejects.toMatchObject({ code: 'content_scan_blocked' })
  })
})

async function gitRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'devflow-outbound-scan-'))
  tempDirs.push(repo)
  await git(repo, ['init', '--initial-branch=main'])
  await git(repo, ['config', 'user.name', 'DevFlow Test'])
  await git(repo, ['config', 'user.email', 'devflow@example.test'])
  return repo
}

async function commitFile(
  repo: string,
  relativePath: string,
  content: string,
  message: string,
): Promise<string> {
  const destination = path.join(repo, relativePath)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, content)
  await git(repo, ['add', relativePath])
  await git(repo, ['commit', '-m', message])
  return head(repo)
}

async function head(repo: string): Promise<string> {
  return (await git(repo, ['rev-parse', 'HEAD'])).trim().toLowerCase()
}

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repo,
    encoding: 'utf8',
  })
  return stdout
}
