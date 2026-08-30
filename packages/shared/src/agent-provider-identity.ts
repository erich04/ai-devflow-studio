import type { AgentProviderConfig, ProviderCredentialMetadata } from './domain'

export const AGENT_PROVIDER_NAME_MAX_LENGTH = 100

export type AgentProviderNameValidationResult =
  | { ok: true; name: string }
  | { ok: false; code: 'empty' | 'too_long' | 'invalid_characters'; message: string }

export function normalizeAgentProviderName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

export function validateAgentProviderName(value: unknown): AgentProviderNameValidationResult {
  if (typeof value !== 'string') {
    return { ok: false, code: 'empty', message: 'Provider name is required.' }
  }

  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    return {
      ok: false,
      code: 'invalid_characters',
      message: 'Provider name cannot contain control characters.',
    }
  }

  const name = normalizeAgentProviderName(value)
  if (!name) {
    return { ok: false, code: 'empty', message: 'Provider name is required.' }
  }
  if (name.length > AGENT_PROVIDER_NAME_MAX_LENGTH) {
    return {
      ok: false,
      code: 'too_long',
      message: `Provider name must be ${AGENT_PROVIDER_NAME_MAX_LENGTH} characters or fewer.`,
    }
  }

  return { ok: true, name }
}

export function requireAgentProviderName(value: unknown): string {
  const validation = validateAgentProviderName(value)
  if (!validation.ok) {
    throw new Error(validation.message)
  }
  return validation.name
}

function comparableProviderName(value: string): string {
  return normalizeAgentProviderName(value).normalize('NFKC').toLocaleLowerCase('en-US')
}

export function assertAgentProviderNameAvailable(input: {
  name: string
  providers: ReadonlyArray<Pick<AgentProviderConfig, 'id' | 'name'>>
  providerId?: string
}): void {
  const comparableName = comparableProviderName(input.name)
  const duplicate = input.providers.some(
    (provider) =>
      provider.id !== input.providerId && comparableProviderName(provider.name) === comparableName,
  )
  if (duplicate) {
    throw new Error('Provider name already exists.')
  }
}

export function createGeneratedAgentProviderId(randomValue: string): string {
  const suffix = randomValue.toLowerCase().replace(/[^a-z0-9]/gu, '')
  if (suffix.length < 16) {
    throw new Error('Unable to generate a valid provider identity.')
  }
  return `provider_${suffix}`
}

export function resolveAgentProviderDisplayName(
  metadata: Pick<ProviderCredentialMetadata, 'providerId' | 'name'>,
): string {
  const validation = validateAgentProviderName(metadata.name)
  if (validation.ok) {
    return validation.name
  }
  return metadata.providerId === 'openai-default' ? 'OpenAI Compatible' : metadata.providerId
}
