export type OpencodeSmokePreflightResult =
  | {
      mode: 'skip'
      message: string
    }
  | {
      mode: 'blocked'
      missing: string[]
      message: string
    }
  | {
      mode: 'ready'
      providerID: string
      modelID: string
      apiKeyEnvName: string
      binaryPath: string
      releaseProfile?: 'v1.4'
      message: string
    }

function createV14OpencodeReleaseProfile(baseURL: string) {
  return {
    $schema: 'https://opencode.ai/config.json',
    autoupdate: false,
    plugin: [],
    model: 'double/ark-code-latest',
    enabled_providers: ['double'],
    provider: {
      double: {
        npm: '@ai-sdk/openai',
        name: 'Volcengine Ark Coding Plan (Responses API)',
        options: {
          baseURL,
          apiKey: '{env:ANTHROPIC_AUTH_TOKEN}',
          timeout: 210_000,
          headerTimeout: 180_000,
          chunkTimeout: 60_000,
        },
        models: {
          'ark-code-latest': {
            name: 'ark-code-latest',
            limit: { context: 256_000, output: 32_000 },
            modalities: { input: ['text', 'image'], output: ['text'] },
          },
        },
      },
    },
  } as const
}

export function assertV14ResolvedOpencodeConfig(
  value: unknown,
  expectedApiKey: string,
): void {
  if (!isRecord(value)) {
    throw new Error('opencode did not resolve the candidate-owned V1.4 Responses profile')
  }
  if (value.model !== 'double/ark-code-latest') {
    throw new Error('opencode did not resolve the candidate-owned V1.4 Responses profile')
  }
  const provider = isRecord(value.provider) ? value.provider.double : undefined
  if (!isRecord(provider) || provider.npm !== '@ai-sdk/openai') {
    throw new Error('opencode did not resolve the candidate-owned V1.4 Responses profile')
  }
  const options = isRecord(provider.options) ? provider.options : undefined
  if (
    !isRecord(options) ||
    options.baseURL !== 'https://ark.cn-beijing.volces.com/api/coding/v3' ||
    options.apiKey !== expectedApiKey ||
    options.timeout !== 210_000 ||
    options.headerTimeout !== 180_000 ||
    options.chunkTimeout !== 60_000
  ) {
    throw new Error('opencode did not resolve the candidate-owned V1.4 Responses profile')
  }
  const models = isRecord(provider.models) ? provider.models : undefined
  const model = isRecord(models?.['ark-code-latest']) ? models['ark-code-latest'] : undefined
  if (!isRecord(model) || model.name !== 'ark-code-latest') {
    throw new Error('opencode did not resolve the candidate-owned V1.4 Responses profile')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createV14OpencodeReleaseConfigContent(input?: {
  baseURL?: string
}): string {
  return JSON.stringify(
    createV14OpencodeReleaseProfile(
      input?.baseURL ?? 'https://ark.cn-beijing.volces.com/api/coding/v3',
    ),
  )
}

export function resolveOpencodeSmokeConfigContent(
  input: {
    providerID: string
    modelID: string
    apiKeyEnvName: string
    releaseProfile?: 'v1.4'
  },
  ambientConfigContent: string | undefined,
  releaseBaseUrl?: string,
): string | undefined {
  if (
    input.releaseProfile === 'v1.4' &&
    input.providerID === 'double' &&
    input.modelID === 'ark-code-latest' &&
    input.apiKeyEnvName === 'ANTHROPIC_AUTH_TOKEN'
  ) {
    return createV14OpencodeReleaseConfigContent(
      releaseBaseUrl ? { baseURL: releaseBaseUrl } : undefined,
    )
  }
  return ambientConfigContent
}

export function evaluateOpencodeSmokePreflight(
  env: NodeJS.ProcessEnv,
): OpencodeSmokePreflightResult {
  if (env['DEVFLOW_RUN_OPENCODE_SMOKE'] !== '1') {
    return {
      mode: 'skip',
      message: 'Skipping opencode smoke: set DEVFLOW_RUN_OPENCODE_SMOKE=1 to run it.',
    }
  }

  const apiKeyEnvName = env['DEVFLOW_OPENCODE_API_KEY_ENV'] ?? 'OPENAI_API_KEY'
  const required = [
    'DEVFLOW_CODING_ENGINE',
    'DEVFLOW_OPENCODE_PROVIDER_ID',
    'DEVFLOW_OPENCODE_MODEL_ID',
    apiKeyEnvName,
  ]
  const missing = required.filter((key) => !env[key])

  if (missing.length) {
    return {
      mode: 'blocked',
      missing,
      message: [
        `Missing required ${missing.join(', ')} for real opencode smoke.`,
        '',
        'Example:',
        'DEVFLOW_RUN_OPENCODE_SMOKE=1 \\',
        'DEVFLOW_CODING_ENGINE=opencode-http \\',
        'DEVFLOW_OPENCODE_PROVIDER_ID=openai \\',
        'DEVFLOW_OPENCODE_MODEL_ID=gpt-4.1-mini \\',
        `${apiKeyEnvName}="<redacted>" \\`,
        'corepack pnpm --silent test:opencode-smoke',
      ].join('\n'),
    }
  }

  if (env['DEVFLOW_CODING_ENGINE'] !== 'opencode-http') {
    return {
      mode: 'blocked',
      missing: ['DEVFLOW_CODING_ENGINE=opencode-http'],
      message: [
        'Real opencode smoke requires DEVFLOW_CODING_ENGINE=opencode-http.',
        '',
        'This keeps live-provider runs explicit while default verification stays on the fake engine.',
      ].join('\n'),
    }
  }

  const providerID = env['DEVFLOW_OPENCODE_PROVIDER_ID']!
  const modelID = env['DEVFLOW_OPENCODE_MODEL_ID']!
  const binaryPath = env['DEVFLOW_OPENCODE_BIN'] ?? 'opencode'
  const requestedReleaseProfile = env['DEVFLOW_OPENCODE_RELEASE_PROFILE']
  const isV14ReleaseProfile =
    requestedReleaseProfile === 'v1.4' &&
    providerID === 'double' &&
    modelID === 'ark-code-latest' &&
    apiKeyEnvName === 'ANTHROPIC_AUTH_TOKEN'
  const resemblesV14ReleaseProfile =
    providerID === 'double' ||
    modelID === 'ark-code-latest' ||
    apiKeyEnvName === 'ANTHROPIC_AUTH_TOKEN'

  if (
    (requestedReleaseProfile !== undefined && !isV14ReleaseProfile) ||
    (requestedReleaseProfile === undefined && resemblesV14ReleaseProfile)
  ) {
    return {
      mode: 'blocked',
      missing: [
        'DEVFLOW_OPENCODE_RELEASE_PROFILE=v1.4',
        'DEVFLOW_OPENCODE_PROVIDER_ID=double',
        'DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest',
        'DEVFLOW_OPENCODE_API_KEY_ENV=ANTHROPIC_AUTH_TOKEN',
      ],
      message: 'The V1.4 opencode release smoke requires the exact candidate-owned Responses profile identity.',
    }
  }

  return {
    mode: 'ready',
    providerID,
    modelID,
    apiKeyEnvName,
    binaryPath,
    ...(isV14ReleaseProfile ? { releaseProfile: 'v1.4' as const } : {}),
    message: `opencode smoke preflight passed for ${providerID}/${modelID}${isV14ReleaseProfile ? ' (Responses API)' : ''} using ${binaryPath}; key env ${apiKeyEnvName}.`,
  }
}
