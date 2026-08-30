import { describe, expect, it } from 'vitest'
import {
  assertAgentProviderNameAvailable,
  createGeneratedAgentProviderId,
  requireAgentProviderName,
  resolveAgentProviderDisplayName,
  validateAgentProviderName,
} from './agent-provider-identity'

describe('agent provider identity', () => {
  it('normalizes a user-facing name while keeping it separate from the generated identity', () => {
    expect(requireAgentProviderName('  OpenAI   production  ')).toBe('OpenAI production')
    expect(createGeneratedAgentProviderId('123e4567-e89b-12d3-a456-426614174000')).toBe(
      'provider_123e4567e89b12d3a456426614174000',
    )
  })

  it('rejects empty, oversized, and control-character names without echoing their contents', () => {
    expect(validateAgentProviderName('   ')).toMatchObject({ ok: false, code: 'empty' })
    expect(validateAgentProviderName('x'.repeat(101))).toMatchObject({ ok: false, code: 'too_long' })
    expect(validateAgentProviderName('unsafe\nname')).toMatchObject({
      ok: false,
      code: 'invalid_characters',
    })
  })

  it('detects normalized duplicate names but permits an update to the same internal identity', () => {
    const providers = [{ id: 'provider_existing', name: 'OpenAI Production' }]

    expect(() =>
      assertAgentProviderNameAvailable({ name: ' openai   production ', providers }),
    ).toThrow('Provider name already exists.')
    expect(() =>
      assertAgentProviderNameAvailable({
        name: 'OpenAI Production',
        providers,
        providerId: 'provider_existing',
      }),
    ).not.toThrow()
  })

  it('keeps legacy persisted metadata readable when it has no display name', () => {
    expect(resolveAgentProviderDisplayName({ providerId: 'doubao-review' })).toBe('doubao-review')
    expect(resolveAgentProviderDisplayName({ providerId: 'openai-default' })).toBe(
      'OpenAI Compatible',
    )
    expect(
      resolveAgentProviderDisplayName({ providerId: 'provider_internal', name: '公司火山方舟' }),
    ).toBe('公司火山方舟')
  })
})
