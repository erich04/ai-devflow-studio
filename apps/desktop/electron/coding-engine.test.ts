import { describe, expect, it, vi } from 'vitest'
import { buildOpencodeRuntimeEnv, createCodingEngineAdapterFromEnv } from './coding-engine'

describe('coding engine selection', () => {
  it('uses an unconfigured engine by default', async () => {
    const engine = createCodingEngineAdapterFromEnv({})

    expect(engine.engine).toBe('not-configured')
    await expect(engine.ensure({
      project: {
        id: 'local-1',
        name: 'Local project',
        path: '/tmp/local-project',
        packageManager: 'pnpm',
        testCommand: 'pnpm test',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
      },
    })).rejects.toThrow('Coding Agent engine is not configured.')
  })

  it('selects the fake engine only when fake runtime is explicitly enabled', () => {
    expect(() =>
      createCodingEngineAdapterFromEnv({ DEVFLOW_CODING_ENGINE: 'fake' }),
    ).toThrow('DEVFLOW_CODING_ENGINE=fake requires DEVFLOW_ENABLE_FAKE_RUNTIME=true.')

    const engine = createCodingEngineAdapterFromEnv({
      DEVFLOW_CODING_ENGINE: 'fake',
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
    })

    expect(engine.engine).toBe('fake')
  })

  it('selects opencode-http only when explicitly requested', () => {
    const engine = createCodingEngineAdapterFromEnv({
      DEVFLOW_CODING_ENGINE: 'opencode-http',
      DEVFLOW_OPENCODE_PROVIDER_ID: 'openai',
      DEVFLOW_OPENCODE_MODEL_ID: 'gpt-4.1-mini',
    })

    expect(engine.engine).toBe('opencode-http')
    expect(engine.providerId).toBe('openai')
  })

  it('uses the injected shared process manager for opencode-http', async () => {
    const ensure = vi.fn(async ({ projectId }: { projectId: string }) => ({
      projectId,
      baseUrl: 'http://127.0.0.1:4097',
      child: {} as never,
    }))
    const engine = createCodingEngineAdapterFromEnv(
      {
        DEVFLOW_CODING_ENGINE: 'opencode-http',
        DEVFLOW_OPENCODE_PROVIDER_ID: 'openai',
        DEVFLOW_OPENCODE_MODEL_ID: 'gpt-4.1-mini',
      },
      { processManager: { ensure } },
    )

    await engine.ensure({
      project: {
        id: 'local-1',
        name: 'Local project',
        path: '/tmp/local-project',
        packageManager: 'pnpm',
        testCommand: 'pnpm test',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
      },
    })

    expect(ensure).toHaveBeenCalledTimes(1)
    expect(ensure).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'local-1' }))
  })

  it('rejects unknown real engine values instead of silently falling back', () => {
    expect(() =>
      createCodingEngineAdapterFromEnv({ DEVFLOW_CODING_ENGINE: 'opencode-acp' }),
    ).toThrow('Unsupported Coding Agent engine: opencode-acp')
  })

  it('maps runtime provider secrets into process env without writing opencode auth', () => {
    const env = buildOpencodeRuntimeEnv({
      baseEnv: { PATH: '/usr/bin' },
      apiKeyEnvName: 'OPENAI_API_KEY',
      apiKey: 'sk-runtime-only',
    })

    expect(env['OPENAI_API_KEY']).toBe('sk-runtime-only')
    expect(JSON.stringify(env)).not.toContain('auth.json')
  })
})
