import { createPrivateKey, sign, type KeyObject } from 'node:crypto'
import {
  createGitHubAppClient,
  type GitHubAppClient,
  type GitHubAppJwtClaims,
} from './github-app-client'

const githubAppConfigurationError = 'GitHub App delivery configuration is invalid'
const encodedPrivateKeyPattern = /^[A-Za-z0-9+/]+={0,2}$/u

export type GitHubAppAuthConfig = {
  appId: string
  privateKey: KeyObject
}

export type CreateGitHubAppClientFromEnvInput = {
  env: Record<string, string | undefined>
  fetcher: typeof fetch
  clock: () => Date
}

function invalidConfiguration(): Error {
  return new Error(githubAppConfigurationError)
}

function decodePrivateKey(value: string): KeyObject {
  if (
    value.length < 64 ||
    value.length > 32_768 ||
    value.length % 4 !== 0 ||
    !encodedPrivateKeyPattern.test(value)
  ) {
    throw invalidConfiguration()
  }

  let decoded: Buffer | undefined
  try {
    decoded = Buffer.from(value, 'base64')
    if (
      decoded.length === 0 ||
      decoded.toString('base64').replace(/=+$/u, '') !== value.replace(/=+$/u, '')
    ) {
      throw invalidConfiguration()
    }
    const key = createPrivateKey({ key: decoded, format: 'pem' })
    if (key.asymmetricKeyType !== 'rsa') {
      throw invalidConfiguration()
    }
    return key
  } catch {
    throw invalidConfiguration()
  } finally {
    decoded?.fill(0)
  }
}

export function resolveGitHubAppAuthConfig(
  env: Record<string, string | undefined>,
): GitHubAppAuthConfig | undefined {
  const appId = env['DEVFLOW_GITHUB_APP_ID']?.trim()
  const encodedPrivateKey = env['DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64']?.trim()
  if (!appId && !encodedPrivateKey) {
    return undefined
  }
  if (
    !appId ||
    !encodedPrivateKey ||
    !/^[1-9][0-9]{0,15}$/u.test(appId) ||
    appId !== env['DEVFLOW_GITHUB_APP_ID'] ||
    encodedPrivateKey !== env['DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64']
  ) {
    throw invalidConfiguration()
  }
  return {
    appId,
    privateKey: decodePrivateKey(encodedPrivateKey),
  }
}

function createGitHubAppJwtSigner(config: GitHubAppAuthConfig) {
  return (claims: GitHubAppJwtClaims): string => {
    if (
      claims.iss !== config.appId ||
      !Number.isSafeInteger(claims.iat) ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 600
    ) {
      throw invalidConfiguration()
    }
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString(
      'base64url',
    )
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    const signingInput = `${header}.${payload}`
    const signature = sign('RSA-SHA256', Buffer.from(signingInput), config.privateKey).toString(
      'base64url',
    )
    return `${signingInput}.${signature}`
  }
}

export function createGitHubAppClientFromEnv(
  input: CreateGitHubAppClientFromEnvInput,
): GitHubAppClient | undefined {
  const config = resolveGitHubAppAuthConfig(input.env)
  if (!config) {
    return undefined
  }
  return createGitHubAppClient({
    appId: config.appId,
    fetcher: input.fetcher,
    clock: input.clock,
    signJwt: createGitHubAppJwtSigner(config),
  })
}
