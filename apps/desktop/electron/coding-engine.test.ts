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

  it('does not start the injected OpenCode process manager before execution authorization', async () => {
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

    expect(ensure).not.toHaveBeenCalled()
  })

  it('rejects unknown real engine values instead of silently falling back', () => {
    expect(() =>
      createCodingEngineAdapterFromEnv({ DEVFLOW_CODING_ENGINE: 'opencode-acp' }),
    ).toThrow('Unsupported Coding Agent engine: opencode-acp')
  })

  it('maps runtime provider secrets into process env without writing opencode auth', () => {
    const env = buildOpencodeRuntimeEnv({
      baseEnv: {
        PATH: '/usr/bin',
        HOME: '/Users/operator',
        LANG: 'en_US.UTF-8',
        GH_TOKEN: 'github-secret',
        GIT_ASKPASS: '/tmp/credential-helper',
        AWS_SECRET_ACCESS_KEY: 'deploy-secret',
        UNRELATED_SECRET: 'private',
      },
      apiKeyEnvName: 'OPENAI_API_KEY',
      apiKey: 'sk-runtime-only',
    })

    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/operator',
      LANG: 'en_US.UTF-8',
      OPENAI_API_KEY: 'sk-runtime-only',
    })
    expect(JSON.stringify(env)).not.toContain('auth.json')
    expect(JSON.stringify(env)).not.toContain('github-secret')
    expect(JSON.stringify(env)).not.toContain('credential-helper')
    expect(JSON.stringify(env)).not.toContain('deploy-secret')
    expect(JSON.stringify(env)).not.toContain('private')
  })

  it('rejects source-control and deployment credentials as selected Provider credentials', () => {
    for (const apiKeyEnvName of ['GITHUB_API_KEY', 'GIT_ASKPASS', 'VERCEL_AUTH_TOKEN']) {
      expect(() => buildOpencodeRuntimeEnv({
        baseEnv: {},
        apiKeyEnvName,
        apiKey: 'must-not-be-forwarded',
      })).toThrow('OpenCode Provider credential environment name is not allowed')
    }
  })
})
