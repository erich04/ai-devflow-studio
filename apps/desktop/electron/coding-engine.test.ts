import { describe, expect, it } from 'vitest'
import { createCodingEngineAdapterFromEnv } from './coding-engine'

describe('coding engine selection', () => {
  it('uses the deterministic fake engine by default', () => {
    const engine = createCodingEngineAdapterFromEnv({})

    expect(engine.engine).toBe('fake')
  })

  it('selects opencode-http only when explicitly requested', () => {
    const engine = createCodingEngineAdapterFromEnv({
      DEVFLOW_CODING_ENGINE: 'opencode-http',
      DEVFLOW_OPENCODE_PROVIDER_ID: 'openai',
      DEVFLOW_OPENCODE_MODEL_ID: 'gpt-4.1-mini',
    })

    expect(engine.engine).toBe('opencode-http')
  })

  it('rejects unknown real engine values instead of silently falling back', () => {
    expect(() =>
      createCodingEngineAdapterFromEnv({ DEVFLOW_CODING_ENGINE: 'opencode-acp' }),
    ).toThrow('Unsupported Coding Agent engine: opencode-acp')
  })
})
