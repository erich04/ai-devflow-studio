import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalCommandEnv, inspectProjectDirectory, runLocalTestCommand } from './test-runner'

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
    expect(project.detectedTestCommand).toBe('corepack pnpm test')
    expect(project.testCommand).toBe('corepack pnpm test')
  })
})

describe('runLocalTestCommand', () => {
  it('adds common package-manager paths to the command environment', () => {
    const basePath = ['/usr/bin', '/bin'].join(path.delimiter)
    const env = createLocalCommandEnv({
      PATH: basePath,
      HOME: '/Users/example',
      APPDATA: 'C:\\Users\\example\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\example\\AppData\\Local',
      ProgramFiles: 'C:\\Program Files',
    })

    const expectedExtraPaths =
      process.platform === 'win32'
        ? [
            'C:\\Users\\example\\AppData\\Roaming\\npm',
            'C:\\Users\\example\\AppData\\Local\\pnpm',
            'C:\\Program Files\\nodejs',
          ]
        : [
            '/usr/local/bin',
            '/opt/homebrew/bin',
            '/Users/example/.local/bin',
            '/Users/example/.local/share/pnpm',
            '/Users/example/Library/pnpm',
          ]

    expect(env.PATH?.split(path.delimiter)).toEqual(['/usr/bin', '/bin', ...expectedExtraPaths])
  })

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
