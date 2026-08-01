import { describe, expect, it, vi } from 'vitest'
import {
  listElectronAgentProviderConfigs,
  resolveElectronAgentProvider,
  resolveElectronAgentProviderMetadata,
} from './agent-provider-runtime'

describe('Electron agent provider runtime', () => {
  it('resolves paid provider metadata for cost preflight without reading or decrypting its secret', async () => {
    const credentialSource = {
      listProviderCredentials: vi.fn(async () => [{
        providerId: 'team-openai',
        model: 'gpt-4.1-mini',
        baseUrl: 'https://api.example.test/v1',
        maskedCredential: 'sk-***last',
        updatedAt: '2026-07-31T00:00:00.000Z',
      }]),
      getProviderEncryptedSecret: vi.fn(async () => {
        throw new Error('preflight must not read the encrypted secret')
      }),
    }
    const decryptCredential = vi.fn(() => {
      throw new Error('preflight must not decrypt the provider secret')
    })

    const metadata = await resolveElectronAgentProviderMetadata({
      providerId: 'team-openai',
      fakeRuntimeEnabled: false,
      credentialSource,
    })

    expect(metadata).toEqual({
      id: 'team-openai',
      name: 'team-openai',
      model: 'gpt-4.1-mini',
    })
    expect(credentialSource.listProviderCredentials).toHaveBeenCalledTimes(1)
    expect(credentialSource.getProviderEncryptedSecret).not.toHaveBeenCalled()
    expect(decryptCredential).not.toHaveBeenCalled()
  })

  it('exposes the built-in fake provider without a saved credential when fake runtime is enabled', () => {
    expect(listElectronAgentProviderConfigs({
      credentials: [],
      fakeRuntimeEnabled: true,
    })).toEqual([
      {
        id: 'fake-knowledge-review',
        name: 'Deterministic Fake Provider',
        kind: 'fake',
        model: 'fake',
        enabled: true,
        updatedAt: new Date(0).toISOString(),
      },
    ])
  })

  it('hides the fake provider when fake runtime is disabled, including stale saved metadata', () => {
    expect(listElectronAgentProviderConfigs({
      credentials: [{
        providerId: 'fake-knowledge-review',
        model: 'fake',
        maskedCredential: 'stale',
        updatedAt: '2026-06-15T00:00:00.000Z',
      }],
      fakeRuntimeEnabled: false,
    })).toEqual([])
  })

  it('resolves the built-in fake provider without reading or decrypting credentials', async () => {
    const credentialSource = {
      listProviderCredentials: vi.fn(async () => {
        throw new Error('fake provider must not list credentials')
      }),
      getProviderEncryptedSecret: vi.fn(async () => {
        throw new Error('fake provider must not read a credential secret')
      }),
    }
    const decryptCredential = vi.fn(() => {
      throw new Error('fake provider must not decrypt a credential secret')
    })

    const provider = await resolveElectronAgentProvider({
      providerId: 'fake-knowledge-review',
      fakeRuntimeEnabled: true,
      credentialSource,
      decryptCredential,
    })

    expect(provider).toEqual(expect.objectContaining({
      id: 'fake-knowledge-review',
      name: 'Deterministic Fake Provider',
      model: 'fake',
    }))
    expect(credentialSource.listProviderCredentials).not.toHaveBeenCalled()
    expect(credentialSource.getProviderEncryptedSecret).not.toHaveBeenCalled()
    expect(decryptCredential).not.toHaveBeenCalled()
  })

  it('refuses to resolve the fake provider when fake runtime is disabled', async () => {
    const credentialSource = {
      listProviderCredentials: vi.fn(async () => [{
        providerId: 'fake-knowledge-review',
        model: 'fake',
        maskedCredential: 'stale',
        updatedAt: '2026-06-15T00:00:00.000Z',
      }]),
      getProviderEncryptedSecret: vi.fn(async () => 'stale-encrypted-secret'),
    }
    const decryptCredential = vi.fn(() => 'stale-plain-secret')

    await expect(resolveElectronAgentProvider({
      providerId: 'fake-knowledge-review',
      fakeRuntimeEnabled: false,
      credentialSource,
      decryptCredential,
    })).rejects.toThrow('Fake Agent Provider requires DEVFLOW_ENABLE_FAKE_RUNTIME=true.')

    expect(credentialSource.listProviderCredentials).not.toHaveBeenCalled()
    expect(credentialSource.getProviderEncryptedSecret).not.toHaveBeenCalled()
    expect(decryptCredential).not.toHaveBeenCalled()
  })
})
