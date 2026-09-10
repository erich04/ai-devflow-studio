import { describe, expect, it, vi } from 'vitest'
import { buildOpencodeRuntimeEnv } from './coding-engine.js'
import { inspectOpencodeRuntimeProfile } from './opencode-discovery.js'
import { buildReadOnlyStageAgentRuntimeEnv } from './stage-agent-executor.js'
import { resolveSavedOpencodeProviderBinding } from './opencode-provider-binding.js'

function fixture() {
  return {
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    credentialSource: {
      listProviderCredentials: vi.fn(async () => [{
        providerId: 'deepseek', name: 'DeepSeek', model: 'deepseek-v4-flash',
        baseUrl: 'https://api.deepseek.com', maskedCredential: '***', updatedAt: '2026-09-10T00:00:00Z',
      }]),
      getProviderEncryptedSecret: vi.fn(async () => 'encrypted-test-credential'),
    },
    decryptCredential: vi.fn(() => 'test-provider-secret'),
  }
}

describe('saved Provider binding for managed OpenCode', () => {
  it('keeps the explicitly selected saved credential through both runtime environment filters', async () => {
    const binding = await resolveSavedOpencodeProviderBinding(fixture())
    const ambient = { PATH: '/usr/bin', GH_TOKEN: 'unrelated-secret', OPENAI_API_KEY: 'ambient-secret' }
    const codingEnv = buildOpencodeRuntimeEnv({ baseEnv: ambient, apiKeyEnvName: 'OPENCODE_API_KEY', providerBinding: binding })
    const stageEnv = buildReadOnlyStageAgentRuntimeEnv(codingEnv, binding)
    expect(stageEnv.DEVFLOW_OPENCODE_PROVIDER_API_KEY).toBe('test-provider-secret')
    expect(stageEnv).not.toHaveProperty('GH_TOKEN')
    expect(stageEnv).not.toHaveProperty('OPENAI_API_KEY')
    const config = JSON.parse(stageEnv.OPENCODE_CONFIG_CONTENT!)
    expect(config.provider.deepseek.options).toEqual({
      baseURL: 'https://api.deepseek.com', apiKey: '{env:DEVFLOW_OPENCODE_PROVIDER_API_KEY}',
    })
    expect(config.provider.deepseek.models).toHaveProperty('deepseek-v4-flash')
    expect(stageEnv.OPENCODE_CONFIG_CONTENT).not.toContain('test-provider-secret')
    expect(buildReadOnlyStageAgentRuntimeEnv(codingEnv)).not.toHaveProperty('DEVFLOW_OPENCODE_PROVIDER_API_KEY')
  })

  it('recognizes a saved credential even when OpenCode has zero credentials, and enumerates the exact model', async () => {
    const binding = await resolveSavedOpencodeProviderBinding(fixture())
    const runCommand = vi.fn(async (_binary: string, args: string[], env: NodeJS.ProcessEnv) => {
      if (args[0] === 'auth') return '0 credentials\n'
      expect(env.DEVFLOW_OPENCODE_PROVIDER_API_KEY).toBe('test-provider-secret')
      return 'deepseek/deepseek-v4-flash\n'
    })
    await expect(inspectOpencodeRuntimeProfile({
      binaryPath: '/fixture/opencode', providerId: 'deepseek', modelId: 'deepseek-v4-flash',
      providerBinding: binding, deps: { runCommand },
    })).resolves.toEqual({ authAvailable: true, profileAvailable: true, modelAvailable: true })
  })

  it('does not borrow a different provider credential or match a display name', async () => {
    const input = fixture()
    input.providerId = 'DeepSeek'
    expect(await resolveSavedOpencodeProviderBinding(input)).toBeUndefined()
    expect(input.credentialSource.getProviderEncryptedSecret).not.toHaveBeenCalled()
    expect(input.decryptCredential).not.toHaveBeenCalled()
  })

  it('fails closed without exposing decryption errors or using a different credential source', async () => {
    const input = fixture()
    input.decryptCredential.mockImplementation(() => { throw new Error('sensitive-provider-secret') })
    await expect(resolveSavedOpencodeProviderBinding(input)).rejects.toThrow('Saved OpenCode Provider credential is unavailable')
    input.decryptCredential.mockReturnValue('')
    await expect(resolveSavedOpencodeProviderBinding(input)).rejects.toThrow('Saved OpenCode Provider credential is unavailable')
  })

  it('changes the runtime identity after rotating the saved credential', async () => {
    const input = fixture()
    const before = await resolveSavedOpencodeProviderBinding(input)
    input.decryptCredential.mockReturnValue('rotated-test-secret')
    const after = await resolveSavedOpencodeProviderBinding(input)
    expect(after?.fingerprint).not.toBe(before?.fingerprint)
    expect(after?.fingerprint).not.toContain('rotated-test-secret')
  })
})
