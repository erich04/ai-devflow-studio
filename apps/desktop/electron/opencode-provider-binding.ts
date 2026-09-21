import { createHash } from 'node:crypto'
import type { ProviderCredentialMetadata } from '@ai-devflow/shared'

/** Main-process only. Never serialize this binding into IPC, artifacts or logs. */
export type OpencodeProviderBinding = {
  providerId: string
  modelId: string
  baseUrl: string
  apiKey: string
  fingerprint: string
}

export async function resolveSavedOpencodeProviderBinding(input: {
  providerId: string
  modelId: string
  credentialSource: {
    listProviderCredentials(): Promise<ProviderCredentialMetadata[]>
    getProviderEncryptedSecret(providerId: string): Promise<string | null>
  }
  decryptCredential(encryptedSecret: string): string | Promise<string>
}): Promise<OpencodeProviderBinding | undefined> {
  const metadata = (await input.credentialSource.listProviderCredentials())
    .find((candidate) => candidate.providerId === input.providerId)
  // An unbound provider retains OpenCode's existing user-profile authentication.
  if (!metadata) return undefined
  let apiKey: string
  try {
    const encrypted = await input.credentialSource.getProviderEncryptedSecret(metadata.providerId)
    if (!encrypted) throw new Error('missing')
    apiKey = await input.decryptCredential(encrypted)
    if (!apiKey.trim()) throw new Error('empty')
    const current = (await input.credentialSource.listProviderCredentials()).find((item) => item.providerId === input.providerId)
    if (current?.updatedAt !== metadata.updatedAt || await input.credentialSource.getProviderEncryptedSecret(metadata.providerId) !== encrypted) {
      throw new Error('changed')
    }
  } catch {
    throw new Error('Saved OpenCode Provider credential is unavailable')
  }
  const baseUrl = metadata.baseUrl || 'https://api.openai.com/v1'
  return {
    providerId: metadata.providerId,
    modelId: input.modelId,
    baseUrl,
    apiKey,
    fingerprint: createHash('sha256').update(JSON.stringify([
      metadata.providerId, input.modelId, baseUrl, metadata.updatedAt, apiKey,
    ])).digest('hex'),
  }
}

export function opencodeProviderBindingEnv(binding?: OpencodeProviderBinding): NodeJS.ProcessEnv {
  if (!binding) return {}
  return {
    DEVFLOW_OPENCODE_PROVIDER_API_KEY: binding.apiKey,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      provider: {
        [binding.providerId]: {
          npm: '@ai-sdk/openai-compatible',
          options: {
            baseURL: binding.baseUrl,
            apiKey: '{env:DEVFLOW_OPENCODE_PROVIDER_API_KEY}',
          },
          models: { [binding.modelId]: { name: binding.modelId } },
        },
      },
    }),
  }
}
