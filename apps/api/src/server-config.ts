import { isPilotAgentCredentialKey } from './agent-credentials'
import { isValidDatabaseStatementTimeout } from './db/client'

export type ServerListenConfig = {
  host: string
  port: number
}

export type ServerRuntimeConfig = ServerListenConfig & {
  deploymentProfile: 'development' | 'pilot'
  devAuthEnabled: boolean
  requireAuth: boolean
  secureCookies: boolean
  sessionSecret: string
  webAppUrl: string
}

const DEVELOPMENT_SESSION_SECRET = 'devflow-dev-session-secret'
const DEVELOPMENT_WEB_APP_URL = 'http://127.0.0.1:4311'
const PILOT_SESSION_SECRET_MIN_LENGTH = 32

export const PILOT_API_ENV_ALLOWLIST = Object.freeze([
  'DATABASE_URL',
  'DEVFLOW_AGENT_CREDENTIAL_KEY',
  'DEVFLOW_DATABASE_APPLICATION_NAME',
  'DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS',
  'DEVFLOW_DATABASE_URL',
  'DEVFLOW_DEPLOYMENT_PROFILE',
  'DEVFLOW_ENABLE_DEMO_DATA',
  'DEVFLOW_ENABLE_FAKE_RUNTIME',
  'DEVFLOW_GITHUB_APP_ID',
  'DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64',
  'DEVFLOW_REQUIRE_AUTH',
  'DEVFLOW_SESSION_SECRET',
  'DEVFLOW_WEB_APP_URL',
  'DEV_AUTH_ENABLED',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_OAUTH_CLIENT_ID',
  'GITHUB_OAUTH_CLIENT_SECRET',
  'GITHUB_OAUTH_REDIRECT_URI',
  'HOST',
  'PORT',
] as const)

const pilotApiEnvAllowlist = new Set<string>(PILOT_API_ENV_ALLOWLIST)

function assertPilotEnvAllowlist(env: Record<string, string | undefined>): void {
  const unknown = Object.keys(env)
    .filter(
      (name) =>
        (name.startsWith('DEVFLOW_') || name.startsWith('DEV_AUTH_')) &&
        !pilotApiEnvAllowlist.has(name),
    )
    .sort()[0]
  if (unknown) {
    throw new Error(`Unsupported pilot environment variable: ${unknown}.`)
  }
}

function isPilotSessionSecret(value: string): boolean {
  const configured = value.trim()
  return (
    configured.length >= PILOT_SESSION_SECRET_MIN_LENGTH &&
    !/(?:replace[-_ ]?this|placeholder|change[-_ ]?me|devflow-dev-session-secret|<[^>]+>)/i.test(
      configured,
    )
  )
}

function isPostgresUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const protocol = new URL(value).protocol
    return protocol === 'postgres:' || protocol === 'postgresql:'
  } catch {
    return false
  }
}

function resolveBoolean(
  name:
    | 'DEV_AUTH_ENABLED'
    | 'DEVFLOW_REQUIRE_AUTH'
    | 'DEVFLOW_ENABLE_DEMO_DATA'
    | 'DEVFLOW_ENABLE_FAKE_RUNTIME',
  value: string | undefined,
  strict: boolean,
): boolean {
  if (value === undefined) return false

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false

  if (strict) {
    throw new Error(
      `${name} must be "true" or "false" for DEVFLOW_DEPLOYMENT_PROFILE=pilot.`,
    )
  }

  return false
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname.length > 0
    )
  } catch {
    return false
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  )
}

function resolveDeploymentProfile(
  value: string | undefined,
): ServerRuntimeConfig['deploymentProfile'] {
  const normalized = value?.trim().toLowerCase() || 'development'
  if (normalized === 'development' || normalized === 'pilot') {
    return normalized
  }

  throw new Error(`Unsupported DEVFLOW_DEPLOYMENT_PROFILE: ${normalized}`)
}

export function resolveServerListenConfig(
  env: Record<string, string | undefined> = process.env,
): ServerListenConfig {
  const port = Number(env['PORT'] ?? 4310)
  if (!Number.isFinite(port) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be a finite integer between 1 and 65535.')
  }

  return {
    host: env['HOST'] ?? '127.0.0.1',
    port,
  }
}

export function resolveServerRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): ServerRuntimeConfig {
  const listen = resolveServerListenConfig(env)
  const deploymentProfile = resolveDeploymentProfile(env['DEVFLOW_DEPLOYMENT_PROFILE'])
  if (deploymentProfile === 'pilot') {
    assertPilotEnvAllowlist(env)
  }
  const strictBooleans = deploymentProfile === 'pilot'
  const devAuthEnabled = resolveBoolean(
    'DEV_AUTH_ENABLED',
    env['DEV_AUTH_ENABLED'],
    strictBooleans,
  )
  const requireAuth = resolveBoolean(
    'DEVFLOW_REQUIRE_AUTH',
    env['DEVFLOW_REQUIRE_AUTH'],
    strictBooleans,
  )
  const demoDataEnabled = resolveBoolean(
    'DEVFLOW_ENABLE_DEMO_DATA',
    env['DEVFLOW_ENABLE_DEMO_DATA'],
    strictBooleans,
  )
  const fakeRuntimeEnabled = resolveBoolean(
    'DEVFLOW_ENABLE_FAKE_RUNTIME',
    env['DEVFLOW_ENABLE_FAKE_RUNTIME'],
    strictBooleans,
  )
  const sessionSecret = env['DEVFLOW_SESSION_SECRET'] ?? DEVELOPMENT_SESSION_SECRET
  const databaseUrl = env['DEVFLOW_DATABASE_URL'] ?? env['DATABASE_URL']
  const configuredWebAppUrl = env['DEVFLOW_WEB_APP_URL']?.trim()
  const webAppUrl = configuredWebAppUrl || DEVELOPMENT_WEB_APP_URL
  let secureCookies = false

  if (deploymentProfile === 'pilot' && devAuthEnabled) {
    throw new Error(
      'DEV_AUTH_ENABLED=true is forbidden for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  }

  if (deploymentProfile === 'pilot' && !requireAuth) {
    throw new Error(
      'DEVFLOW_REQUIRE_AUTH=true is required for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  }

  if (deploymentProfile === 'pilot' && !isPilotSessionSecret(sessionSecret)) {
    throw new Error(
      'DEVFLOW_SESSION_SECRET must be at least 32 characters and must not be a placeholder for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  }

  if (deploymentProfile === 'pilot' && !isPostgresUrl(databaseUrl)) {
    throw new Error(
      'A postgres:// or postgresql:// DEVFLOW_DATABASE_URL (or DATABASE_URL) is required for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  }

  if (
    deploymentProfile === 'pilot' &&
    (!configuredWebAppUrl || !isHttpUrl(configuredWebAppUrl))
  ) {
    throw new Error(
      'DEVFLOW_WEB_APP_URL must be an http(s) URL for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  }

  if (deploymentProfile === 'pilot' && demoDataEnabled) {
    throw new Error(
      'DEVFLOW_ENABLE_DEMO_DATA=true is forbidden for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  }

  if (deploymentProfile === 'pilot' && fakeRuntimeEnabled) {
    throw new Error(
      'DEVFLOW_ENABLE_FAKE_RUNTIME=true is forbidden for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  }

  const statementTimeout = env['DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS']
  if (
    deploymentProfile === 'pilot' &&
    statementTimeout !== undefined &&
    !isValidDatabaseStatementTimeout(statementTimeout)
  ) {
    throw new Error(
      'DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS must be a positive finite integer for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  }

  if (
    deploymentProfile === 'pilot' &&
    !isPilotAgentCredentialKey(env['DEVFLOW_AGENT_CREDENTIAL_KEY'])
  ) {
    throw new Error(
      'DEVFLOW_AGENT_CREDENTIAL_KEY must be at least 32 characters, must not be a placeholder, and must not use the development fallback for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  }

  if (
    deploymentProfile === 'pilot' &&
    sessionSecret.trim() === env['DEVFLOW_AGENT_CREDENTIAL_KEY']?.trim()
  ) {
    throw new Error(
      'DEVFLOW_SESSION_SECRET and DEVFLOW_AGENT_CREDENTIAL_KEY must be independent for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  }

  if (deploymentProfile === 'pilot') {
    const githubClientId =
      env['GITHUB_OAUTH_CLIENT_ID']?.trim() || env['GITHUB_CLIENT_ID']?.trim()
    const githubClientSecret =
      env['GITHUB_OAUTH_CLIENT_SECRET']?.trim() ||
      env['GITHUB_CLIENT_SECRET']?.trim()
    const githubRedirectUri = env['GITHUB_OAUTH_REDIRECT_URI']?.trim()

    if (!githubClientId || !githubClientSecret || !githubRedirectUri) {
      throw new Error(
        'A complete GitHub OAuth configuration (client ID, client secret, and redirect URI) is required for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
      )
    }

    if (!isHttpUrl(githubRedirectUri)) {
      throw new Error(
        'GITHUB_OAUTH_REDIRECT_URI must be an http(s) URL for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
      )
    }

    const githubRedirectUrl = new URL(githubRedirectUri)
    const parsedWebAppUrl = new URL(webAppUrl)
    if (
      githubRedirectUrl.protocol !== parsedWebAppUrl.protocol ||
      githubRedirectUrl.hostname !== parsedWebAppUrl.hostname
    ) {
      throw new Error(
        'DEVFLOW_WEB_APP_URL and GITHUB_OAUTH_REDIRECT_URI must use the same protocol and hostname for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
      )
    }
    secureCookies = githubRedirectUrl.protocol === 'https:'
  }

  if (devAuthEnabled && !isLoopbackHost(listen.host)) {
    throw new Error(
      'DEV_AUTH_ENABLED=true is allowed only for explicit non-browser development on a loopback API.',
    )
  }

  return {
    ...listen,
    deploymentProfile,
    devAuthEnabled,
    requireAuth,
    secureCookies,
    sessionSecret,
    webAppUrl,
  }
}
