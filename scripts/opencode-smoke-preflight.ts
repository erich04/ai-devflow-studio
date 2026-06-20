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
      message: string
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
        'corepack pnpm test:opencode-smoke',
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

  return {
    mode: 'ready',
    providerID,
    modelID,
    apiKeyEnvName,
    binaryPath,
    message: `opencode smoke preflight passed for ${providerID}/${modelID} using ${binaryPath}; key env ${apiKeyEnvName}.`,
  }
}
