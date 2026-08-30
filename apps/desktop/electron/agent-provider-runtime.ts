import {
  assertAgentProviderNameAvailable,
  createGeneratedAgentProviderId,
  createFakeAgentProvider,
  createOpenAiCompatibleAgentProvider,
  resolveAgentProviderDisplayName,
  type AgentProvider,
  type AgentProviderConfig,
  type ProviderCredentialMetadata,
} from '@ai-devflow/shared'

export const FAKE_AGENT_PROVIDER_ID = 'fake-knowledge-review'
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini'

const fakeAgentProviderConfig: AgentProviderConfig = {
  id: FAKE_AGENT_PROVIDER_ID,
  name: 'Deterministic Fake Provider',
  kind: 'fake',
  model: 'fake',
  enabled: true,
  updatedAt: new Date(0).toISOString(),
}

export function createElectronAgentProviderCredentialMetadata(input: {
  name: string
  providerId?: string
  model: string
  baseUrl?: string
  maskedCredential: string
  updatedAt: string
  randomValue: string
  providers: AgentProviderConfig[]
}): ProviderCredentialMetadata {
  const providerId = input.providerId ?? createGeneratedAgentProviderId(input.randomValue)
  assertAgentProviderNameAvailable({
    name: input.name,
    providers: input.providers,
    ...(input.providerId ? { providerId } : {}),
  })
  return {
    providerId,
    name: input.name,
    model: input.model,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    maskedCredential: input.maskedCredential,
    updatedAt: input.updatedAt,
  }
}

function providerConfigFromCredential(metadata: ProviderCredentialMetadata): AgentProviderConfig {
  return {
    id: metadata.providerId,
    name: resolveAgentProviderDisplayName(metadata),
    kind: 'openai-compatible',
    model: metadata.model,
    ...(metadata.baseUrl ? { baseUrl: metadata.baseUrl } : {}),
    enabled: true,
    maskedCredential: metadata.maskedCredential,
    updatedAt: metadata.updatedAt,
  }
}

export async function resolveElectronAgentProviderMetadata(input: {
  providerId: string
  fakeRuntimeEnabled: boolean
  credentialSource: {
    listProviderCredentials(): Promise<ProviderCredentialMetadata[]>
  }
}): Promise<Pick<AgentProvider, 'id' | 'name' | 'model'>> {
  if (input.providerId === FAKE_AGENT_PROVIDER_ID) {
    if (!input.fakeRuntimeEnabled) {
      throw new Error('Fake Agent Provider requires DEVFLOW_ENABLE_FAKE_RUNTIME=true.')
    }
    return {
      id: fakeAgentProviderConfig.id,
      name: fakeAgentProviderConfig.name,
      model: fakeAgentProviderConfig.model,
    }
  }

  const credentials = await input.credentialSource.listProviderCredentials()
  const metadata = credentials.find((candidate) => candidate.providerId === input.providerId)
  if (!metadata) {
    throw new Error(`Agent provider credential metadata not found: ${input.providerId}`)
  }

  const config = providerConfigFromCredential(metadata)
  return { id: config.id, name: config.name, model: config.model }
}

export function listElectronAgentProviderConfigs(input: {
  credentials: ProviderCredentialMetadata[]
  fakeRuntimeEnabled: boolean
}): AgentProviderConfig[] {
  return [
    ...(input.fakeRuntimeEnabled ? [fakeAgentProviderConfig] : []),
    ...input.credentials
      .filter((metadata) => metadata.providerId !== FAKE_AGENT_PROVIDER_ID)
      .map(providerConfigFromCredential),
  ]
}

export async function resolveElectronAgentProvider(input: {
  providerId: string
  fakeRuntimeEnabled: boolean
  credentialSource: {
    listProviderCredentials(): Promise<ProviderCredentialMetadata[]>
    getProviderEncryptedSecret(providerId: string): Promise<string | null>
  }
  decryptCredential(encryptedSecret: string): string
}): Promise<AgentProvider> {
  if (input.providerId === FAKE_AGENT_PROVIDER_ID) {
    if (!input.fakeRuntimeEnabled) {
      throw new Error('Fake Agent Provider requires DEVFLOW_ENABLE_FAKE_RUNTIME=true.')
    }

    return createFakeAgentProvider()
  }

  const credentials = await input.credentialSource.listProviderCredentials()
  const metadata = credentials.find((candidate) => candidate.providerId === input.providerId)
  const encryptedSecret = await input.credentialSource.getProviderEncryptedSecret(input.providerId)
  if (!metadata || !encryptedSecret) {
    throw new Error(`Agent provider credential not found: ${input.providerId}`)
  }

  return createOpenAiCompatibleAgentProvider({
    id: metadata.providerId,
    name: resolveAgentProviderDisplayName(metadata),
    model: metadata.model || DEFAULT_OPENAI_MODEL,
    baseUrl: metadata.baseUrl || DEFAULT_OPENAI_BASE_URL,
    apiKey: input.decryptCredential(encryptedSecret),
  })
}
