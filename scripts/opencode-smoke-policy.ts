import type { CodingPermissionRequest } from '../packages/shared/src/domain.ts'
import { redactSensitiveText } from '../packages/shared/src/redaction.ts'
import { join } from 'node:path'

export const OPENCODE_SMOKE_MARKER = 'devflow-opencode-smoke.txt'

export type CandidateGitIdentity = {
  head: string
  branch: string
}

const OPENCODE_RUNTIME_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'TMPDIR',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TZ',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'OPENCODE_CONFIG',
  'OPENCODE_CONFIG_CONTENT',
  'OPENCODE_DISABLE_PROJECT_CONFIG',
  'OPENCODE_DISABLE_AUTOUPDATE',
  'OPENCODE_DISABLE_MODELS_FETCH',
  'OPENCODE_PURE',
  'NO_COLOR',
  'FORCE_COLOR',
] as const

export function buildOpencodeSmokeRuntimeEnv(
  source: NodeJS.ProcessEnv,
  apiKeyEnvName: string,
): NodeJS.ProcessEnv {
  const runtimeEnv: NodeJS.ProcessEnv = {}
  for (const name of [...OPENCODE_RUNTIME_ENV_ALLOWLIST, apiKeyEnvName]) {
    const value = source[name]
    if (value !== undefined) {
      runtimeEnv[name] = value
    }
  }
  return runtimeEnv
}

export function buildIsolatedOpencodeSmokeRuntimeEnv(
  source: NodeJS.ProcessEnv,
  apiKeyEnvName: string,
  runtimeRoot: string,
): NodeJS.ProcessEnv {
  const runtimeEnv = buildOpencodeSmokeRuntimeEnv(source, apiKeyEnvName)
  delete runtimeEnv.OPENCODE_CONFIG
  return {
    ...runtimeEnv,
    HOME: join(runtimeRoot, 'home'),
    TMPDIR: join(runtimeRoot, 'tmp'),
    XDG_CONFIG_HOME: join(runtimeRoot, 'config'),
    XDG_DATA_HOME: join(runtimeRoot, 'data'),
    XDG_CACHE_HOME: join(runtimeRoot, 'cache'),
    XDG_STATE_HOME: join(runtimeRoot, 'state'),
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_PURE: '1',
  }
}

export function assertOpencodeSmokePermission(request: CodingPermissionRequest): void {
  const allowedShellProbe =
    request.permission === 'bash' &&
    request.title === 'opencode requested bash permission' &&
    (request.command?.trim() === 'pwd' || request.command?.trim() === '/bin/pwd')
  const allowedMarkerMutation =
    request.permission === 'edit' &&
    request.title === 'opencode requested edit permission' &&
    request.filePath === OPENCODE_SMOKE_MARKER

  if (!allowedShellProbe && !allowedMarkerMutation) {
    throw new Error('opencode smoke blocked an unexpected permission request')
  }
}

export function assertOpencodeSmokeChangedPaths(changedPaths: string[]): void {
  if (changedPaths.length !== 1 || changedPaths[0] !== OPENCODE_SMOKE_MARKER) {
    throw new Error('opencode smoke produced an unexpected changed path')
  }
}

export function assertCleanCandidateStatus(status: string): void {
  if (status.trim()) {
    throw new Error('opencode smoke detected candidate worktree pollution')
  }
}

export function assertCandidateIdentity(
  initial: CandidateGitIdentity,
  current: CandidateGitIdentity,
): void {
  if (initial.head !== current.head || initial.branch !== current.branch) {
    throw new Error('opencode smoke detected candidate Git identity changes')
  }
}

export function assertCleanFixtureStatus(status: string): void {
  if (status.trim()) {
    throw new Error('opencode smoke detected fixture source repository pollution')
  }
}

export function combineOpencodeSmokeFailures(
  primaryError: unknown | undefined,
  safetyErrors: unknown[],
): unknown | undefined {
  const failures = [...(primaryError === undefined ? [] : [primaryError]), ...safetyErrors]
  if (failures.length === 0) {
    return undefined
  }
  if (failures.length === 1) {
    return failures[0]
  }
  return new AggregateError(
    failures,
    'opencode smoke failed with additional cleanup or integrity errors',
  )
}

export function opencodeSmokeErrorMessages(
  error: unknown,
  providerKey: string | undefined,
): string[] {
  const errors = error instanceof AggregateError ? error.errors : [error]
  return errors.flatMap((item) => {
    if (item instanceof AggregateError) {
      return opencodeSmokeErrorMessages(item, providerKey)
    }
    const message = item instanceof Error ? item.message : 'opencode smoke failed with an unknown error'
    const keyRedacted = providerKey
      ? message.split(providerKey).join('[REDACTED:provider_key]')
      : message
    return [redactSensitiveText(keyRedacted).value]
  })
}
