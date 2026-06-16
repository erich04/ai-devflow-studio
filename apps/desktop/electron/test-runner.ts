import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {
  detectPackageManager,
  detectTestCommand,
  redactSecrets,
  type LocalProject,
  type PackageManager,
  type ProjectFileSnapshot,
  type TestEvidenceStatus,
} from '@ai-devflow/shared'

const PROJECT_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
]

const MAX_OUTPUT_CHARS = 20_000

export type LocalTestCommandInput = {
  command: string
  cwd: string
  timeoutMs: number
}

export type LocalTestCommandResult = {
  status: TestEvidenceStatus
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  redacted: boolean
  summary: string
}

function projectIdFromPath(projectPath: string): string {
  const digest = createHash('sha256').update(path.resolve(projectPath)).digest('hex').slice(0, 12)
  return `local-${digest}`
}

function packageManagerFromSnapshot(snapshot: ProjectFileSnapshot): PackageManager {
  return detectPackageManager(snapshot)
}

function appendUniquePath(paths: string[], value: string | undefined) {
  if (!value || paths.includes(value)) {
    return
  }

  paths.push(value)
}

function commonPackageManagerPaths(env: NodeJS.ProcessEnv): string[] {
  if (process.platform === 'win32') {
    const paths: string[] = []
    appendUniquePath(paths, env['APPDATA'] ? path.join(env['APPDATA'], 'npm') : undefined)
    appendUniquePath(paths, env['LOCALAPPDATA'] ? path.join(env['LOCALAPPDATA'], 'pnpm') : undefined)
    appendUniquePath(paths, env['ProgramFiles'] ? path.join(env['ProgramFiles'], 'nodejs') : undefined)
    return paths
  }

  const home = env['HOME']
  const paths = ['/usr/local/bin', '/opt/homebrew/bin']
  appendUniquePath(paths, home ? path.join(home, '.local', 'bin') : undefined)
  appendUniquePath(paths, home ? path.join(home, '.local', 'share', 'pnpm') : undefined)
  appendUniquePath(paths, home ? path.join(home, 'Library', 'pnpm') : undefined)
  return paths
}

export function createLocalCommandEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const existingPath = baseEnv['PATH'] ?? baseEnv['Path'] ?? ''
  const pathEntries = existingPath.split(path.delimiter).filter(Boolean)

  for (const candidate of commonPackageManagerPaths(baseEnv)) {
    appendUniquePath(pathEntries, candidate)
  }

  return {
    ...baseEnv,
    PATH: pathEntries.join(path.delimiter),
  }
}

async function readProjectSnapshot(projectPath: string): Promise<ProjectFileSnapshot> {
  const entries = await Promise.all(
    PROJECT_FILES.map(async (fileName) => {
      try {
        const content = await readFile(path.join(projectPath, fileName), 'utf8')
        return [fileName, content] as const
      } catch {
        return null
      }
    }),
  )

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null))
}

function projectName(projectPath: string, snapshot: ProjectFileSnapshot): string {
  const packageJson = snapshot['package.json']
  if (packageJson) {
    try {
      const parsed = JSON.parse(packageJson) as { name?: unknown }
      if (typeof parsed.name === 'string' && parsed.name.trim()) {
        return parsed.name.trim()
      }
    } catch {
      return path.basename(projectPath)
    }
  }

  return path.basename(projectPath)
}

export async function inspectProjectDirectory(
  projectPath: string,
  timestamp = new Date().toISOString(),
): Promise<LocalProject> {
  const resolvedPath = path.resolve(projectPath)
  const snapshot = await readProjectSnapshot(resolvedPath)
  const detected = detectTestCommand(snapshot)
  const packageManager = detected?.packageManager ?? packageManagerFromSnapshot(snapshot)

  return {
    id: projectIdFromPath(resolvedPath),
    name: projectName(resolvedPath, snapshot),
    path: resolvedPath,
    packageManager,
    testCommand: detected?.command ?? '',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(detected?.command ? { detectedTestCommand: detected.command } : {}),
  }
}

function appendBounded(previous: string, chunk: string): string {
  const next = previous + chunk
  if (next.length <= MAX_OUTPUT_CHARS) {
    return next
  }

  return next.slice(next.length - MAX_OUTPUT_CHARS)
}

export function runLocalTestCommand(input: LocalTestCommandInput): Promise<LocalTestCommandResult> {
  const startedAt = Date.now()

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let didTimeout = false
    let settled = false

    const child = spawn(input.command, {
      cwd: input.cwd,
      shell: true,
      env: createLocalCommandEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timer = setTimeout(() => {
      didTimeout = true
      child.kill('SIGTERM')
    }, input.timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk.toString('utf8'))
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk.toString('utf8'))
    })

    child.on('error', (error) => {
      stderr = appendBounded(stderr, error.message)
    })

    child.on('close', (code) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)

      const durationMs = Date.now() - startedAt
      const status: TestEvidenceStatus = didTimeout ? 'timed_out' : code === 0 ? 'passed' : 'failed'
      const redactedStdout = redactSecrets(stdout)
      const redactedStderr = redactSecrets(stderr)
      const exitCode = didTimeout ? null : code
      const summary =
        status === 'passed'
          ? `Tests passed in ${durationMs}ms`
          : status === 'timed_out'
            ? `Tests timed out after ${durationMs}ms`
            : `Tests failed with exit code ${exitCode ?? 'unknown'}`

      resolve({
        status,
        exitCode,
        durationMs,
        stdout: redactedStdout.value,
        stderr: redactedStderr.value,
        redacted: redactedStdout.redacted || redactedStderr.redacted,
        summary,
      })
    })
  })
}
