import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { CodingRuntimeDiscovery, CodingRuntimeEngineCandidate } from '@ai-devflow/shared'

const execFileAsync = promisify(execFile)
const MAX_VERSION_LENGTH = 160

type OpencodeDiscoveryDeps = {
  resolveExecutable?: (binaryHint: string, env: NodeJS.ProcessEnv) => Promise<string | null>
  readVersion?: (binaryPath: string, env: NodeJS.ProcessEnv) => Promise<string>
  now?: () => string
}

export async function detectCodingRuntimeEngines(input: {
  projectId: string
  env?: NodeJS.ProcessEnv
  deps?: OpencodeDiscoveryDeps
}): Promise<CodingRuntimeDiscovery> {
  const env = input.env ?? process.env
  const binaryHint = env.DEVFLOW_OPENCODE_BIN?.trim() || 'opencode'
  const resolveExecutable = input.deps?.resolveExecutable ?? resolveExecutableOnPath
  const readVersion = input.deps?.readVersion ?? readOpencodeVersion
  let candidate: CodingRuntimeEngineCandidate

  try {
    const binaryPath = await resolveExecutable(binaryHint, env)
    if (!binaryPath) {
      candidate = unavailableCandidate('未检测到兼容的 OpenCode；不会自动选择或启动 Coding Engine。')
    } else {
      const version = normalizeVersion(await readVersion(binaryPath, env))
      candidate = {
        engine: 'opencode-http',
        executor: 'opencode-http',
        status: 'available',
        binaryPath,
        version,
        requiresConfirmation: true,
        reason: '已检测到本机 OpenCode。确认后才会把它用于当前项目。',
      }
    }
  } catch {
    candidate = unavailableCandidate('OpenCode 存在但兼容性检查失败；不会启动或修改仓库。')
  }

  return {
    projectId: input.projectId,
    candidates: [candidate],
    detectedAt: (input.deps?.now ?? (() => new Date().toISOString()))(),
  }
}

function unavailableCandidate(reason: string): CodingRuntimeEngineCandidate {
  return {
    engine: 'opencode-http',
    executor: 'opencode-http',
    status: 'unavailable',
    requiresConfirmation: true,
    reason,
  }
}

async function resolveExecutableOnPath(
  binaryHint: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const hasPathSeparator = binaryHint.includes('/') || binaryHint.includes('\\')
  const candidates = hasPathSeparator
    ? path.isAbsolute(binaryHint)
      ? [binaryHint]
      : []
    : executableCandidates(binaryHint, env)

  for (const candidate of candidates) {
    try {
      await access(candidate, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK)
      const canonical = await realpath(candidate)
      if ((await stat(canonical)).isFile()) return canonical
    } catch {
      // Continue searching PATH without surfacing host paths or filesystem errors.
    }
  }
  return null
}

function executableCandidates(binaryName: string, env: NodeJS.ProcessEnv): string[] {
  const directories = (env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const extensions = process.platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : ['']
  return directories.flatMap((directory) =>
    extensions.map((extension) => path.join(directory, `${binaryName}${extension}`)),
  )
}

async function readOpencodeVersion(binaryPath: string, env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync(binaryPath, ['--version'], {
    env,
    timeout: 2_000,
    maxBuffer: 4_096,
    windowsHide: true,
  })
  return stdout
}

function normalizeVersion(value: string): string {
  const version = value.trim().split(/\r?\n/u)[0]?.trim() ?? ''
  if (
    !version ||
    version.length > MAX_VERSION_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._+\- ()/]{0,159}$/u.test(version)
  ) {
    throw new Error('OpenCode returned an invalid version string')
  }
  return version
}
