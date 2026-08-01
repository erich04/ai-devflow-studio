export type ServerListenConfig = {
  host: string
  port: number
}

export type ServerRuntimeConfig = ServerListenConfig & {
  deploymentProfile: 'development' | 'pilot'
  devAuthEnabled: boolean
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
  return {
    host: env['HOST'] ?? '127.0.0.1',
    port: Number(env['PORT'] ?? 4310),
  }
}

export function resolveServerRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): ServerRuntimeConfig {
  const listen = resolveServerListenConfig(env)
  const deploymentProfile = resolveDeploymentProfile(env['DEVFLOW_DEPLOYMENT_PROFILE'])
  const devAuthEnabled = env['DEV_AUTH_ENABLED']?.trim().toLowerCase() === 'true'

  if (deploymentProfile === 'pilot' && devAuthEnabled) {
    throw new Error(
      'DEV_AUTH_ENABLED=true is forbidden for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
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
  }
}
