import { access, readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  GitHubGitPublisherError,
  createGitHubGitPublisher,
  type GitCommandInput,
} from './github-git-publisher'

const expectedCommitSha = 'a'.repeat(40)
const repository = 'erich04/ai-devflow-studio'
const headBranch = 'devflow/run-1'
const secret = `ghs_SECRET_SENTINEL_${'x'.repeat(24)}`

function input() {
  return {
    worktreePath: '/controlled/worktree',
    repository,
    headBranch,
    expectedCommitSha,
    token: secret,
  }
}

describe('GitHub git publisher', () => {
  it('pushes only the exact clean commit with ephemeral askpass authority', async () => {
    const calls: GitCommandInput[] = []
    let askPassPath = ''
    const runGit = vi.fn(async (command: GitCommandInput) => {
      calls.push(command)
      if (command.args[0] === 'rev-parse') return { stdout: `${expectedCommitSha}\n` }
      if (command.args[0] === 'status') return { stdout: '' }
      if (command.args[0] === 'remote') return { stdout: `git@github.com:${repository}.git\n` }
      expect(command.env['DEVFLOW_GITHUB_ACCESS_TOKEN']).toBe(secret)
      expect(command.args.join(' ')).not.toContain(secret)
      askPassPath = command.env['GIT_ASKPASS']!
      expect(await readFile(askPassPath, 'utf8')).not.toContain(secret)
      expect(
        await readFile(command.env['DEVFLOW_GITHUB_ASKPASS_SCRIPT']!, 'utf8'),
      ).not.toContain(secret)
      if (command.args[0] === 'ls-remote') return { stdout: '' }
      return { stdout: 'ok\n' }
    })

    await expect(createGitHubGitPublisher({ runGit }).publish(input())).resolves.toEqual({
      outcome: 'pushed',
      expectedCommitSha,
      repository,
      headBranch,
    })

    expect(calls.map(({ args }) => args)).toEqual([
      ['rev-parse', '--verify', 'HEAD'],
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      ['remote', 'get-url', 'origin'],
      [
        'ls-remote',
        '--heads',
        `https://github.com/${repository}.git`,
        `refs/heads/${headBranch}`,
      ],
      [
        'push',
        '--porcelain',
        '--no-verify',
        `https://github.com/${repository}.git`,
        `${expectedCommitSha}:refs/heads/${headBranch}`,
      ],
    ])
    expect(calls.slice(0, 3).every(({ env }) => env['DEVFLOW_GITHUB_ACCESS_TOKEN'] === undefined))
      .toBe(true)
    await expect(access(askPassPath)).rejects.toBeDefined()
  })

  it('treats an exact remote head as an idempotent replay without pushing', async () => {
    const runGit = vi.fn(async (command: GitCommandInput) => {
      if (command.args[0] === 'rev-parse') return { stdout: `${expectedCommitSha}\n` }
      if (command.args[0] === 'status') return { stdout: '' }
      if (command.args[0] === 'remote') return { stdout: `https://github.com/${repository}.git\n` }
      if (command.args[0] === 'ls-remote') {
        return { stdout: `${expectedCommitSha}\trefs/heads/${headBranch}\n` }
      }
      throw new Error('push must not run')
    })

    await expect(createGitHubGitPublisher({ runGit }).publish(input())).resolves.toMatchObject({
      outcome: 'already_present',
    })
    expect(runGit.mock.calls.some(([command]) => command.args[0] === 'push')).toBe(false)
  })

  it('fails before push for dirty, wrong-repository, wrong-head, or diverged worktrees', async () => {
    const cases = [
      {
        label: 'dirty',
        outputs: { status: ' M src/index.ts\0' },
        code: 'workspace_dirty',
      },
      {
        label: 'wrong repository',
        outputs: { remote: 'https://github.com/other/repository.git\n' },
        code: 'repository_mismatch',
      },
      {
        label: 'wrong head',
        outputs: { head: `${'b'.repeat(40)}\n` },
        code: 'workspace_mismatch',
      },
      {
        label: 'diverged',
        outputs: { remoteHead: `${'c'.repeat(40)}\trefs/heads/${headBranch}\n` },
        code: 'remote_branch_diverged',
      },
    ]

    for (const testCase of cases) {
      const runGit = vi.fn(async (command: GitCommandInput) => {
        if (command.args[0] === 'rev-parse') {
          return { stdout: testCase.outputs.head ?? `${expectedCommitSha}\n` }
        }
        if (command.args[0] === 'status') return { stdout: testCase.outputs.status ?? '' }
        if (command.args[0] === 'remote') {
          return { stdout: testCase.outputs.remote ?? `git@github.com:${repository}.git\n` }
        }
        if (command.args[0] === 'ls-remote') {
          return { stdout: testCase.outputs.remoteHead ?? '' }
        }
        throw new Error('push must not run')
      })
      const error = await createGitHubGitPublisher({ runGit })
        .publish(input())
        .catch((reason: unknown) => reason)
      expect(error, testCase.label).toMatchObject({ code: testCase.code })
      expect(runGit.mock.calls.some(([command]) => command.args[0] === 'push')).toBe(false)
    }
  })

  it('maps raw git failures to a fixed ambiguity without retaining credentials or paths', async () => {
    const raw = `fatal ${secret} /private/controlled/worktree`
    const runGit = vi.fn(async (command: GitCommandInput) => {
      if (command.args[0] === 'rev-parse') return { stdout: `${expectedCommitSha}\n` }
      if (command.args[0] === 'status') return { stdout: '' }
      if (command.args[0] === 'remote') return { stdout: `git@github.com:${repository}.git\n` }
      if (command.args[0] === 'ls-remote') return { stdout: '' }
      throw new Error(raw)
    })

    const error = await createGitHubGitPublisher({ runGit })
      .publish(input())
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(GitHubGitPublisherError)
    expect(error).toMatchObject({ code: 'push_result_unknown' })
    expect(String(error)).not.toContain(secret)
    expect(String(error)).not.toContain('/private/')
    expect(JSON.stringify(error)).not.toContain(raw)
  })
})
