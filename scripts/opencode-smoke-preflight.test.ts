import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  assertV14ResolvedOpencodeConfig,
  createV14OpencodeReleaseConfigContent,
  evaluateOpencodeSmokePreflight,
  resolveOpencodeSmokeConfigContent,
} from './opencode-smoke-preflight'

describe('opencode smoke preflight', () => {
  it('prints only a fixed failure when the release preflight cannot start', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/opencode-release-config-preflight.ts'],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
        },
        encoding: 'utf8',
        timeout: 5_000,
      },
    )

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('opencode release config preflight failed\n')
  })

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
    expect(result.missing).toEqual(['DEVFLOW_CODING_ENGINE', 'OPENAI_API_KEY'])
    expect(result.message).toContain('Missing required DEVFLOW_CODING_ENGINE, OPENAI_API_KEY')
    expect(result.message).toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(result.message).toContain('corepack pnpm --silent test:opencode-smoke')
  })

  it('requires the explicit real opencode coding engine switch', () => {
    const result = evaluateOpencodeSmokePreflight({
      DEVFLOW_RUN_OPENCODE_SMOKE: '1',
      DEVFLOW_CODING_ENGINE: 'fake',
      DEVFLOW_OPENCODE_PROVIDER_ID: 'openai',
      DEVFLOW_OPENCODE_MODEL_ID: 'gpt-4.1-mini',
      OPENAI_API_KEY: 'sk-secret-value',
    })

    expect(result.mode).toBe('blocked')
    expect(result.missing).toEqual(['DEVFLOW_CODING_ENGINE=opencode-http'])
    expect(result.message).toContain('Real opencode smoke requires DEVFLOW_CODING_ENGINE=opencode-http')
    expect(result.message).not.toContain('sk-secret-value')
  })

  it('blocks live smoke with a clear missing key message when the engine is configured', () => {
    const result = evaluateOpencodeSmokePreflight({
      DEVFLOW_RUN_OPENCODE_SMOKE: '1',
      DEVFLOW_CODING_ENGINE: 'opencode-http',
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
      DEVFLOW_CODING_ENGINE: 'opencode-http',
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

  it('describes a Volcengine Ark style custom provider profile without leaking the key value', () => {
    const result = evaluateOpencodeSmokePreflight({
      DEVFLOW_RUN_OPENCODE_SMOKE: '1',
      DEVFLOW_CODING_ENGINE: 'opencode-http',
      DEVFLOW_OPENCODE_PROVIDER_ID: 'double',
      DEVFLOW_OPENCODE_MODEL_ID: 'ark-code-latest',
      DEVFLOW_OPENCODE_API_KEY_ENV: 'ANTHROPIC_AUTH_TOKEN',
      DEVFLOW_OPENCODE_RELEASE_PROFILE: 'v1.4',
      DEVFLOW_OPENCODE_BIN: '/opt/homebrew/bin/opencode',
      OPENCODE_CONFIG_CONTENT: createV14OpencodeReleaseConfigContent(),
      ANTHROPIC_AUTH_TOKEN: 'volcengine-secret',
    })

    expect(result).toMatchObject({
      mode: 'ready',
      providerID: 'double',
      modelID: 'ark-code-latest',
      apiKeyEnvName: 'ANTHROPIC_AUTH_TOKEN',
      binaryPath: '/opt/homebrew/bin/opencode',
      releaseProfile: 'v1.4',
    })
    expect(result.message).toContain('double/ark-code-latest')
    expect(result.message).toContain('Responses API')
    expect(result.message).toContain('ANTHROPIC_AUTH_TOKEN')
    expect(result.message).not.toContain('volcengine-secret')
  })

  it('owns the exact v1.4 Responses profile and replaces ambient Chat configuration', () => {
    const ambientChatConfig = '{"provider":{"double":{"npm":"@ai-sdk/openai-compatible"}}}'
    const content = resolveOpencodeSmokeConfigContent({
      providerID: 'double',
      modelID: 'ark-code-latest',
      apiKeyEnvName: 'ANTHROPIC_AUTH_TOKEN',
      releaseProfile: 'v1.4',
    }, ambientChatConfig)
    const config = JSON.parse(content!)

    expect(config).toMatchObject({
      model: 'double/ark-code-latest',
      enabled_providers: ['double'],
      provider: {
        double: {
          npm: '@ai-sdk/openai',
          options: {
            baseURL: 'https://ark.cn-beijing.volces.com/api/coding/v3',
            apiKey: '{env:ANTHROPIC_AUTH_TOKEN}',
            timeout: 210_000,
            headerTimeout: 180_000,
            chunkTimeout: 60_000,
          },
          models: {
            'ark-code-latest': {
              limit: { context: 256_000, output: 32_000 },
              modalities: { input: ['text', 'image'], output: ['text'] },
            },
          },
        },
      },
    })
    expect(content).not.toContain('openai-compatible')
    expect(content).not.toContain('volcengine-secret')
  })

  it('validates the minimal resolved V1.4 profile without retaining resolved config output', () => {
    const fakeApiKey = '__DEVFLOW_RELEASE_CONFIG_PREFLIGHT__'
    const config = JSON.parse(createV14OpencodeReleaseConfigContent())
    config.provider.double.options.apiKey = fakeApiKey

    expect(() => assertV14ResolvedOpencodeConfig(config, fakeApiKey)).not.toThrow()

    for (const mutate of [
      (value: typeof config) => { value.provider.double.npm = '@ai-sdk/openai-compatible' },
      (value: typeof config) => { value.provider.double.options.baseURL = 'https://example.invalid' },
      (value: typeof config) => { value.provider.double.options.timeout = 0 },
      (value: typeof config) => { value.provider.double.options.apiKey = 'wrong-key' },
      (value: typeof config) => { delete value.provider.double.models['ark-code-latest'] },
    ]) {
      const invalid = structuredClone(config)
      mutate(invalid)
      expect(() => assertV14ResolvedOpencodeConfig(invalid, fakeApiKey)).toThrow(
        'opencode did not resolve the candidate-owned V1.4 Responses profile',
      )
    }
  })

  it('preserves ambient inline config for non-release profiles', () => {
    expect(resolveOpencodeSmokeConfigContent({
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      apiKeyEnvName: 'OPENAI_API_KEY',
    }, '{"provider":{"openai":{}}}')).toBe('{"provider":{"openai":{}}}')
  })

  it('uses the credential-owning loopback gate for the live release invocation', () => {
    const content = resolveOpencodeSmokeConfigContent(
      {
        providerID: 'double',
        modelID: 'ark-code-latest',
        apiKeyEnvName: 'ANTHROPIC_AUTH_TOKEN',
        releaseProfile: 'v1.4',
      },
      undefined,
      'http://127.0.0.1:43129/capability/api/coding/v3',
    )
    const config = JSON.parse(content!)

    expect(config.provider.double.options.baseURL).toBe(
      'http://127.0.0.1:43129/capability/api/coding/v3',
    )
    expect(config.provider.double.options.apiKey).toBe('{env:ANTHROPIC_AUTH_TOKEN}')
  })

  it('blocks a near-match instead of silently falling back to ambient configuration', () => {
    const result = evaluateOpencodeSmokePreflight({
      DEVFLOW_RUN_OPENCODE_SMOKE: '1',
      DEVFLOW_CODING_ENGINE: 'opencode-http',
      DEVFLOW_OPENCODE_PROVIDER_ID: 'double',
      DEVFLOW_OPENCODE_MODEL_ID: 'ark-code-latest',
      DEVFLOW_OPENCODE_API_KEY_ENV: 'ANTHROPIC_AUTH_TOKEN',
      ANTHROPIC_AUTH_TOKEN: 'volcengine-secret',
    })

    expect(result).toMatchObject({
      mode: 'blocked',
      missing: expect.arrayContaining(['DEVFLOW_OPENCODE_RELEASE_PROFILE=v1.4']),
    })
    expect(result.message).not.toContain('volcengine-secret')
  })
})
