import { describe, expect, it, vi } from 'vitest'
import {
  buildOpencodeDiscoveryEnv,
  detectCodingRuntimeEngines,
  inspectOpencodeRuntimeProfile,
  isSupportedOpencodeVersion,
  parseAuthenticatedOpencodeProviders,
} from './opencode-discovery.js'

describe('OpenCode Coding Engine discovery', () => {
  it('does not expose ambient credentials to binary discovery or version probing', () => {
    expect(buildOpencodeDiscoveryEnv({
      PATH: '/opt/devflow/bin',
      LANG: 'en_US.UTF-8',
      GH_TOKEN: 'github-secret',
      GIT_ASKPASS: '/tmp/helper',
      AWS_SECRET_ACCESS_KEY: 'deploy-secret',
    })).toEqual({
      PATH: '/opt/devflow/bin',
      LANG: 'en_US.UTF-8',
    })
  })

  it('reports a compatible binary without selecting it automatically', async () => {
    const resolveExecutable = vi.fn().mockResolvedValue('/opt/devflow/bin/opencode')
    const readVersion = vi.fn().mockResolvedValue('1.18.15\n')

    await expect(detectCodingRuntimeEngines({
      projectId: 'local-1',
      env: { PATH: '/opt/devflow/bin' },
      deps: {
        resolveExecutable,
        readVersion,
        now: () => '2026-08-30T18:00:00.000Z',
      },
    })).resolves.toEqual({
      projectId: 'local-1',
      candidates: [{
        engine: 'opencode-http',
        executor: 'opencode-http',
        status: 'available',
        binaryPath: '/opt/devflow/bin/opencode',
        version: '1.18.15',
        requiresConfirmation: true,
        reason: '已检测到本机 OpenCode。确认后才会把它用于当前项目。',
      }],
      detectedAt: '2026-08-30T18:00:00.000Z',
    })
    expect(readVersion).toHaveBeenCalledWith('/opt/devflow/bin/opencode', { PATH: '/opt/devflow/bin' })
  })

  it('distinguishes an installed but contract-incompatible version', async () => {
    expect(isSupportedOpencodeVersion('1.17.5')).toBe(true)
    expect(isSupportedOpencodeVersion('1.18.15')).toBe(true)
    expect(isSupportedOpencodeVersion('1.2.3')).toBe(false)
    const discovery = await detectCodingRuntimeEngines({
      projectId: 'local-1',
      deps: {
        resolveExecutable: async () => '/opt/devflow/bin/opencode',
        readVersion: async () => '1.2.3',
        now: () => '2026-08-30T18:00:00.000Z',
      },
    })
    expect(discovery.candidates[0]).toMatchObject({
      status: 'unavailable',
      binaryPath: '/opt/devflow/bin/opencode',
      version: '1.2.3',
      reason: expect.stringContaining('版本尚未通过'),
    })
  })

  it('fails closed when no binary is found', async () => {
    const readVersion = vi.fn()
    const discovery = await detectCodingRuntimeEngines({
      projectId: 'local-1',
      deps: {
        resolveExecutable: async () => null,
        readVersion,
        now: () => '2026-08-30T18:00:00.000Z',
      },
    })

    expect(discovery.candidates[0]).toMatchObject({
      status: 'unavailable',
      requiresConfirmation: true,
    })
    expect(readVersion).not.toHaveBeenCalled()
  })

  it('does not expose an invalid version response as an available engine', async () => {
    const discovery = await detectCodingRuntimeEngines({
      projectId: 'local-1',
      deps: {
        resolveExecutable: async () => '/opt/devflow/bin/opencode',
        readVersion: async () => 'token=secret\nsecond-line',
        now: () => '2026-08-30T18:00:00.000Z',
      },
    })

    expect(discovery.candidates[0]).toEqual({
      engine: 'opencode-http',
      executor: 'opencode-http',
      status: 'unavailable',
      requiresConfirmation: true,
      reason: 'OpenCode 存在但兼容性检查失败；不会启动或修改仓库。',
    })
  })

  it('probes the selected auth profile, provider and exact model with a credential-safe environment', async () => {
    const runCommand = vi.fn(async (_binaryPath: string, args: string[], env: NodeJS.ProcessEnv) => {
      expect(env).toMatchObject({ PATH: '/opt/devflow/bin', HOME: '/Users/devflow' })
      expect(env).not.toHaveProperty('GH_TOKEN')
      expect(env).not.toHaveProperty('GIT_ASKPASS')
      return args[0] === 'auth'
        ? [
            '\u001b[0m',
            '\u250c  Credentials \u001b[90m/Users/devflow/.local/share/opencode/auth.json',
            '\u2502',
            '\u25cf  OpenAI \u001b[90mapi',
            '\u2502',
            '\u2514  1 credential',
          ].join('\n')
        : 'openai/gpt-4.1-mini\nopenai/gpt-4.1\n'
    })
    await expect(inspectOpencodeRuntimeProfile({
      binaryPath: '/opt/devflow/bin/opencode',
      providerId: 'openai',
      modelId: 'gpt-4.1-mini',
      env: {
        PATH: '/opt/devflow/bin',
        HOME: '/Users/devflow',
        GH_TOKEN: 'github-secret',
        GIT_ASKPASS: '/tmp/helper',
      },
      deps: { runCommand },
    })).resolves.toEqual({
      authAvailable: true,
      profileAvailable: true,
      modelAvailable: true,
    })
    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      '/opt/devflow/bin/opencode',
      ['auth', 'list', '--pure'],
      expect.any(Object),
    )
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      '/opt/devflow/bin/opencode',
      ['models', 'openai', '--pure'],
      expect.any(Object),
    )
  })

  it('parses only provider credential entries from the real OpenCode auth-list shape', () => {
    const providers = parseAuthenticatedOpencodeProviders([
      '\u001b[0m',
      '\u250c  Credentials \u001b[90m/Users/devflow/.local/share/opencode/auth.json',
      '\u2502',
      '\u25cf  OpenAI \u001b[90mapi',
      '\u2502',
      '\u25cf  GitHub Copilot \u001b[90moauth',
      '\u2502',
      '\u2514  2 credentials',
    ].join('\n'))

    expect([...providers]).toEqual(['openai', 'githubcopilot'])
    expect(providers.has('usersdevflowlocalshareopencodeauthjson')).toBe(false)
  })

  it('does not treat a different Provider credential as authentication for the selected Provider', async () => {
    await expect(inspectOpencodeRuntimeProfile({
      binaryPath: '/opt/devflow/bin/opencode',
      providerId: 'openai',
      modelId: 'gpt-4.1-mini',
      deps: {
        runCommand: async (_binaryPath, args) => args[0] === 'auth'
          ? [
              '\u250c  Credentials /Users/devflow/.local/share/opencode/auth.json',
              '\u2502',
              '\u25cf  Anthropic api',
              '\u2502',
              '\u2514  1 credential',
            ].join('\n')
          : 'openai/gpt-4.1-mini\n',
      },
    })).resolves.toEqual({
      authAvailable: false,
      profileAvailable: true,
      modelAvailable: true,
    })
  })

  it('distinguishes missing authentication, provider profile and exact model', async () => {
    const missingAuth = await inspectOpencodeRuntimeProfile({
      binaryPath: '/opt/devflow/bin/opencode',
      providerId: 'openai',
      modelId: 'missing-model',
      deps: {
        runCommand: async (_binaryPath, args) =>
          args[0] === 'auth' ? '0 credentials\n' : 'openai/gpt-4.1-mini\n',
      },
    })
    expect(missingAuth).toEqual({
      authAvailable: false,
      profileAvailable: true,
      modelAvailable: false,
    })

    await expect(inspectOpencodeRuntimeProfile({
      binaryPath: '/opt/devflow/bin/opencode',
      providerId: 'missing-provider',
      modelId: 'missing-model',
      deps: { runCommand: async () => '' },
    })).resolves.toEqual({
      authAvailable: false,
      profileAvailable: false,
      modelAvailable: false,
    })
  })

  it('recognizes the built-in OpenCode provider without a stored credential', async () => {
    await expect(inspectOpencodeRuntimeProfile({
      binaryPath: '/opt/devflow/bin/opencode',
      providerId: 'opencode',
      modelId: 'big-pickle',
      deps: {
        runCommand: async (_binaryPath, args) =>
          args[0] === 'auth' ? '0 credentials\n' : 'opencode/big-pickle\n',
      },
    })).resolves.toEqual({
      authAvailable: true,
      profileAvailable: true,
      modelAvailable: true,
    })
  })
})
