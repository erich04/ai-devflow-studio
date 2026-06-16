import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectProjectDirectory, runLocalTestCommand } from './test-runner'

let tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

async function makeProject(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'devflow-project-'))
  tempDirs.push(dir)
  await Promise.all(
    Object.entries(files).map(async ([filePath, content]) => {
      const absolutePath = path.join(dir, filePath)
      await mkdir(path.dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, content)
    }),
  )
  return dir
}

describe('inspectProjectDirectory', () => {
  it('creates a local project from a package.json test script and pnpm lockfile', async () => {
    const projectPath = await makeProject({
      'package.json': JSON.stringify({ name: 'fixture-api', scripts: { test: 'vitest run' } }),
      'pnpm-lock.yaml': 'lockfileVersion: 9.0',
    })

    const project = await inspectProjectDirectory(projectPath, '2026-06-15T00:00:00.000Z')

    expect(project.name).toBe('fixture-api')
    expect(project.path).toBe(projectPath)
    expect(project.packageManager).toBe('pnpm')
    expect(project.detectedTestCommand).toBe('pnpm test')
    expect(project.testCommand).toBe('pnpm test')
  })
})

describe('runLocalTestCommand', () => {
  it('runs the configured command in the project cwd and redacts secret output', async () => {
    const projectPath = await makeProject({
      'package.json': JSON.stringify({ name: 'runner-fixture', scripts: { test: 'node test.js' } }),
      'test.js': "console.log(process.cwd()); console.log('OPENAI_API_KEY=sk-1234567890abcdefghijklmnop');",
    })

    const result = await runLocalTestCommand({
      command: 'node test.js',
      cwd: projectPath,
      timeoutMs: 5_000,
    })

    expect(result.status).toBe('passed')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(projectPath)
    expect(result.stdout).toContain('[REDACTED:env_secret_assignment]')
    expect(result.stdout).not.toContain('sk-1234567890abcdefghijklmnop')
  })

  it('returns a failed result when the test command exits non-zero', async () => {
    const projectPath = await makeProject({
      'package.json': JSON.stringify({ name: 'failing-fixture', scripts: { test: 'node fail.js' } }),
      'fail.js': "console.error('boom'); process.exit(2);",
    })

    const result = await runLocalTestCommand({
      command: 'node fail.js',
      cwd: projectPath,
      timeoutMs: 5_000,
    })

    expect(result.status).toBe('failed')
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('boom')
  })
})
