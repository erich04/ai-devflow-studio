import { describe, expect, it } from 'vitest'
import { evaluateOpencodeSmokePreflight } from './opencode-smoke-preflight'

describe('opencode smoke preflight', () => {
  it('skips safely when live opencode smoke is not requested', () => {
    const result = evaluateOpencodeSmokePreflight({})

    expect(result.mode).toBe('skip')
    expect(result.message).toBe('Skipping opencode smoke: set DEVFLOW_RUN_OPENCODE_SMOKE=1 to run it.')
  })

  it('blocks live smoke with a clear missing configuration message', () => {
    const result = evaluateOpencodeSmokePreflight({
      DEVFLOW_RUN_OPENCODE_SMOKE: '1',
      DEVFLOW_OPENCODE_PROVIDER_ID: 'openai',
      DEVFLOW_OPENCODE_MODEL_ID: 'gpt-4.1-mini',
    })

    expect(result.mode).toBe('blocked')
    expect(result.missing).toEqual(['OPENAI_API_KEY'])
    expect(result.message).toContain('Missing required OPENAI_API_KEY')
    expect(result.message).toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
  })

  it('returns ready configuration without leaking the provider key', () => {
    const result = evaluateOpencodeSmokePreflight({
      DEVFLOW_RUN_OPENCODE_SMOKE: '1',
      DEVFLOW_OPENCODE_PROVIDER_ID: 'openai',
      DEVFLOW_OPENCODE_MODEL_ID: 'gpt-4.1-mini',
      OPENAI_API_KEY: 'sk-secret-value',
    })

    expect(result).toMatchObject({
      mode: 'ready',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      apiKeyEnvName: 'OPENAI_API_KEY',
      binaryPath: 'opencode',
    })
    expect(result.message).toContain('opencode smoke preflight passed')
    expect(result.message).not.toContain('sk-secret-value')
  })
})
