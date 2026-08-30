import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { CodingRuntimeDiscovery, CodingRuntimeEngineCandidate } from '@ai-devflow/shared'
import { buildOpencodeRuntimeEnv } from './coding-engine.js'

const execFileAsync = promisify(execFile)
const MAX_VERSION_LENGTH = 160
const SUPPORTED_OPENCODE_MAJOR = 1
const SUPPORTED_OPENCODE_MINORS = new Set([17, 18])

type OpencodeDiscoveryDeps = {
  resolveExecutable?: (binaryHint: string, env: NodeJS.ProcessEnv) => Promise<string | null>
  readVersion?: (binaryPath: string, env: NodeJS.ProcessEnv) => Promise<string>
  now?: () => string
}

export type OpencodeRuntimeProfileReadiness = {
  authAvailable: boolean
  profileAvailable: boolean
  modelAvailable: boolean
}

type OpencodeProfileProbeDeps = {
  runCommand?: (
    binaryPath: string,
    args: string[],
    env: NodeJS.ProcessEnv,
  ) => Promise<string>
}

export async function detectCodingRuntimeEngines(input: {
  projectId: string
  env?: NodeJS.ProcessEnv
  deps?: OpencodeDiscoveryDeps
}): Promise<CodingRuntimeDiscovery> {
  const sourceEnv = input.env ?? process.env
  const binaryHint = sourceEnv.DEVFLOW_OPENCODE_BIN?.trim() || 'opencode'
  const env = buildOpencodeDiscoveryEnv(sourceEnv)
  const resolveExecutable = input.deps?.resolveExecutable ?? resolveExecutableOnPath
  const readVersion = input.deps?.readVersion ?? readOpencodeVersion
  let candidate: CodingRuntimeEngineCandidate

  try {
    const binaryPath = await resolveExecutable(binaryHint, env)
    if (!binaryPath) {
      candidate = unavailableCandidate('未检测到兼容的 OpenCode；不会自动选择或启动 Coding Engine。')
    } else {
      const version = normalizeVersion(await readVersion(binaryPath, env))
      candidate = isSupportedOpencodeVersion(version)
        ? {
            engine: 'opencode-http',
            executor: 'opencode-http',
            status: 'available',
            binaryPath,
            version,
            requiresConfirmation: true,
            reason: '已检测到本机 OpenCode。确认后才会把它用于当前项目。',
          }
        : {
            engine: 'opencode-http',
            executor: 'opencode-http',
            status: 'unavailable',
            binaryPath,
            version,
            requiresConfirmation: true,
            reason: 'OpenCode 版本尚未通过当前 HTTP contract 验证；不会启动或修改仓库。',
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

export function isSupportedOpencodeVersion(value: string): boolean {
  const version = value.trim().replace(/^v/u, '')
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][A-Za-z0-9.-]+)?$/u.exec(version)
  if (!match) return false
  return Number(match[1]) === SUPPORTED_OPENCODE_MAJOR && SUPPORTED_OPENCODE_MINORS.has(Number(match[2]))
}

export function buildOpencodeDiscoveryEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const name of [
    'PATH',
    'PATHEXT',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TMPDIR',
    'TMP',
    'TEMP',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
  ] as const) {
    const value = source[name]
    if (value !== undefined) env[name] = value
  }
  return env
}

export async function inspectOpencodeRuntimeProfile(input: {
  binaryPath: string
  providerId: string
  modelId: string
  env?: NodeJS.ProcessEnv
  deps?: OpencodeProfileProbeDeps
}): Promise<OpencodeRuntimeProfileReadiness> {
  const providerId = input.providerId.trim()
  const modelId = input.modelId.trim()
  if (!providerId || !modelId) {
    return { authAvailable: false, profileAvailable: false, modelAvailable: false }
  }
  const env = buildOpencodeRuntimeEnv({
    baseEnv: input.env ?? process.env,
    apiKeyEnvName: 'OPENCODE_API_KEY',
  })
  const runCommand = input.deps?.runCommand ?? runOpencodeReadinessCommand
  let authOutput = ''
  let modelOutput = ''
  try {
    authOutput = stripTerminalFormatting(
      await runCommand(input.binaryPath, ['auth', 'list', '--pure'], env),
    )
  } catch {
    // A failed auth probe is an explicit unavailable state, never a reason to
    // assume that a user profile can authenticate.
  }
  try {
    modelOutput = stripTerminalFormatting(
      await runCommand(input.binaryPath, ['models', providerId, '--pure'], env),
    )
  } catch {
    // Provider/model readiness is reported independently from binary readiness.
  }

  const modelLines = modelOutput
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
  const qualifiedModelId = modelId.startsWith(`${providerId}/`)
    ? modelId
    : `${providerId}/${modelId}`
  const profileAvailable = modelLines.some((line) => line.startsWith(`${providerId}/`))
  const modelAvailable = modelLines.includes(qualifiedModelId)
  const authenticatedProviders = parseAuthenticatedOpencodeProviders(authOutput)
  const authAvailable = providerId === 'opencode' || authenticatedProviders.has(
    normalizeProviderIdentity(providerId),
  )
  return { authAvailable, profileAvailable, modelAvailable }
}

/**
 * Parse only the provider labels emitted as credential entries by
 * `opencode auth list --pure` (for example `● OpenAI api`). Header, path,
 * count and diagnostic lines are ignored so no credential material is kept.
 */
export function parseAuthenticatedOpencodeProviders(value: string): ReadonlySet<string> {
  const providers = new Set<string>()
  for (const rawLine of stripTerminalFormatting(value).split(/\r?\n/u)) {
    const line = rawLine.trim()
    const entry = /^[●•]\s+(.+?)\s+(?:api|oauth)$/iu.exec(line)
    if (!entry) continue
    const provider = normalizeProviderIdentity(entry[1] ?? '')
    if (provider) providers.add(provider)
  }
  return providers
}

function normalizeProviderIdentity(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/gu, '')
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

async function runOpencodeReadinessCommand(
  binaryPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const { stdout } = await execFileAsync(binaryPath, args, {
    env,
    timeout: 3_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

function stripTerminalFormatting(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
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
