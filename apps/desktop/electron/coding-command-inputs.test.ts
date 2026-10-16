// @vitest-environment node
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { codingCommandInputsDigest, CommandInputsUnavailableError } from './coding-command-inputs'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

async function worktree() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-command-inputs-'))
  directories.push(root)
  await writeFile(path.join(root, 'package.json'), '{"scripts":{"test":"vitest run"}}')
  await mkdir(path.join(root, 'packages', 'api'), { recursive: true })
  await writeFile(path.join(root, 'packages', 'api', 'package.json'), '{"scripts":{"test":"vitest run"}}')
  await writeFile(path.join(root, 'vitest.config.ts'), 'export default {}')
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(root, 'src', 'app.ts'), 'export const value = 1')
  return root
}

describe('package command inputs', () => {
  it('ignores commands that do not run package scripts', async () => {
    const root = await worktree()
    for (const command of ['git diff --stat', 'rg TODO src', 'pwd']) expect(await codingCommandInputsDigest(root, command)).toBeUndefined()
  })

  it('changes when any manifest or tool configuration changes, not when ordinary sources change', async () => {
    const root = await worktree()
    const command = 'cd [REDACTED:worktree_path] && pnpm test'
    const initial = await codingCommandInputsDigest(root, command)
    expect(initial).toMatch(/^[0-9a-f]{64}$/u)
    await writeFile(path.join(root, 'src', 'app.ts'), 'export const value = 2')
    expect(await codingCommandInputsDigest(root, command)).toBe(initial)
    await writeFile(path.join(root, 'packages', 'api', 'package.json'), '{"scripts":{"test":"node steal.js"}}')
    const workspaceChanged = await codingCommandInputsDigest(root, command)
    expect(workspaceChanged).not.toBe(initial)
    await writeFile(path.join(root, 'vitest.config.ts'), 'export default { setupFiles: ["steal.ts"] }')
    expect(await codingCommandInputsDigest(root, command)).not.toBe(workspaceChanged)
  })

  it('does not descend into dependencies or follow directory links', async () => {
    const root = await worktree()
    const initial = await codingCommandInputsDigest(root, 'npm test')
    await mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true })
    await writeFile(path.join(root, 'node_modules', 'dep', 'package.json'), '{}')
    await symlink(path.join(root, 'packages'), path.join(root, 'linked'), 'dir')
    expect(await codingCommandInputsDigest(root, 'npm test')).toBe(initial)
  })

  it('fails closed when the worktree cannot be read', async () => {
    await expect(codingCommandInputsDigest(path.join(os.tmpdir(), 'devflow-missing-worktree-x'), 'pnpm test'))
      .rejects.toBeInstanceOf(CommandInputsUnavailableError)
  })
})
