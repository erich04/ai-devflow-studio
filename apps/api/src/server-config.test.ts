import { describe, expect, it } from 'vitest'
import { resolveServerListenConfig, resolveServerRuntimeConfig } from './server-config'

describe('server listen config', () => {
  it('defaults to the local development interface and port', () => {
    expect(resolveServerListenConfig({})).toEqual({
      host: '127.0.0.1',
      port: 4310,
    })
  })

  it('allows container deployments to bind to all interfaces', () => {
    expect(resolveServerListenConfig({ HOST: '0.0.0.0', PORT: '4310' })).toEqual({
      host: '0.0.0.0',
      port: 4310,
    })
  })

  it('rejects unsigned development auth on a network-exposed API', () => {
    expect(() =>
      resolveServerRuntimeConfig({
        HOST: '0.0.0.0',
        PORT: '4310',
        DEV_AUTH_ENABLED: 'true',
      }),
    ).toThrow(
      'DEV_AUTH_ENABLED=true is allowed only for explicit non-browser development on a loopback API.',
    )
  })

  it('rejects unsigned development auth for a pilot deployment even on loopback', () => {
    expect(() =>
      resolveServerRuntimeConfig({
        HOST: '127.0.0.1',
        DEVFLOW_DEPLOYMENT_PROFILE: 'pilot',
        DEV_AUTH_ENABLED: 'true',
      }),
    ).toThrow('DEV_AUTH_ENABLED=true is forbidden for DEVFLOW_DEPLOYMENT_PROFILE=pilot.')
  })

  it('preserves explicit unsigned auth for non-browser loopback development', () => {
    expect(
      resolveServerRuntimeConfig({
        HOST: '127.0.0.1',
        PORT: '4310',
        DEV_AUTH_ENABLED: 'true',
      }),
    ).toEqual({
      deploymentProfile: 'development',
      devAuthEnabled: true,
      host: '127.0.0.1',
      port: 4310,
    })
  })

  it('rejects an unknown deployment profile instead of silently treating it as development', () => {
    expect(() =>
      resolveServerRuntimeConfig({
        DEVFLOW_DEPLOYMENT_PROFILE: 'pilto',
      }),
    ).toThrow('Unsupported DEVFLOW_DEPLOYMENT_PROFILE: pilto')
  })
})
