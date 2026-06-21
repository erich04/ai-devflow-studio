import { describe, expect, it } from 'vitest'
import { resolveServerListenConfig } from './server-config'

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
})
