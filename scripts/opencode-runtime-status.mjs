import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

function evaluateSmokeGate(env) {
  if (env.DEVFLOW_RUN_OPENCODE_SMOKE !== '1') {
    return {
      mode: 'skip',
      message: 'Skipping opencode smoke: set DEVFLOW_RUN_OPENCODE_SMOKE=1 to run it.',
    }
  }

  if (env.DEVFLOW_CODING_ENGINE !== 'opencode-http') {
    return {
      mode: 'blocked',
      message: 'Real opencode smoke requires DEVFLOW_CODING_ENGINE=opencode-http.',
    }
  }

  const apiKeyEnvName = env.DEVFLOW_OPENCODE_API_KEY_ENV ?? 'OPENAI_API_KEY'
  const missing = ['DEVFLOW_OPENCODE_PROVIDER_ID', 'DEVFLOW_OPENCODE_MODEL_ID', apiKeyEnvName].filter(
    (key) => !env[key],
  )
  if (missing.length) {
    return {
      mode: 'blocked',
      message: `Missing required ${missing.join(', ')} for real opencode smoke.`,
    }
  }

  return {
    mode: 'ready',
    message: 'Live opencode smoke preflight is ready.',
  }
}

export function collectOpencodeRuntimeProbe(env = process.env) {
  const binaryPath = env.DEVFLOW_OPENCODE_BIN ?? 'opencode'
  let binaryFound = false
  let version = null

  try {
    version = execFileSync(binaryPath, ['--version'], { encoding: 'utf8' }).trim()
    binaryFound = version.length > 0
  } catch {
    binaryFound = false
    version = null
  }

  const preflight = evaluateSmokeGate(env)
  const apiKeyEnvName = env.DEVFLOW_OPENCODE_API_KEY_ENV ?? 'OPENAI_API_KEY'

  return {
    binaryPath,
    binaryFound,
    version,
    smokeMode: preflight.mode,
    smokeMessage: preflight.message,
    engine: env.DEVFLOW_CODING_ENGINE,
    providerID: env.DEVFLOW_OPENCODE_PROVIDER_ID,
    modelID: env.DEVFLOW_OPENCODE_MODEL_ID,
    apiKeyEnvName,
    apiKeyConfigured: Boolean(env[apiKeyEnvName]),
  }
}

export function evaluateOpencodeRuntimeStatus(probe) {
  const providerReady =
    probe.engine === 'opencode-http' &&
    Boolean(probe.providerID) &&
    Boolean(probe.modelID) &&
    probe.apiKeyConfigured
  const providerPartiallyConfigured =
    Boolean(probe.engine) || Boolean(probe.providerID) || Boolean(probe.modelID) || probe.apiKeyConfigured

  return [
    {
      id: 'binary',
      label: 'opencode binary',
      state: probe.binaryFound ? 'ready' : 'attention',
      detail: probe.binaryFound
        ? `${probe.binaryPath} reports ${probe.version}.`
        : `${probe.binaryPath} was not found or did not return a version.`,
    },
    {
      id: 'default-engine',
      label: 'Default engine posture',
      state: probe.smokeMode === 'skip' ? 'ready' : 'pending',
      detail:
        probe.smokeMode === 'skip'
          ? 'Live opencode smoke is disabled by default; deterministic fake-engine verify remains safe.'
          : 'Live opencode smoke has been explicitly requested for this environment.',
    },
    {
      id: 'live-smoke-gate',
      label: 'Live smoke gate',
      state: probe.smokeMode === 'blocked' ? 'attention' : 'ready',
      detail:
        probe.smokeMode === 'blocked'
          ? probe.smokeMessage
          : probe.smokeMode === 'ready'
            ? 'Live opencode smoke preflight is ready.'
            : 'Live opencode smoke will skip unless DEVFLOW_RUN_OPENCODE_SMOKE=1 is set.',
    },
    {
      id: 'provider-profile',
      label: 'Provider profile',
      state: providerReady ? 'ready' : providerPartiallyConfigured ? 'attention' : 'pending',
      detail: providerReady
        ? `Configured ${probe.providerID}/${probe.modelID} with key env ${probe.apiKeyEnvName}.`
        : providerPartiallyConfigured
          ? `Provider profile is incomplete: engine=${probe.engine ?? '<unset>'}, provider=${probe.providerID ?? '<unset>'}, model=${probe.modelID ?? '<unset>'}, keyEnv=${probe.apiKeyEnvName}, keyConfigured=${probe.apiKeyConfigured}.`
          : 'Provider profile is not configured; this is expected unless running the live smoke.',
    },
  ]
}

export function formatOpencodeRuntimeStatusItems(items) {
  const iconByState = {
    ready: 'OK',
    pending: '..',
    attention: '!!',
  }

  return items
    .map((item) => `${iconByState[item.state]} ${item.label}: ${item.detail}`)
    .join('\n')
}

function runCli() {
  const strict = process.argv.includes('--strict')
  const probe = collectOpencodeRuntimeProbe()
  const items = evaluateOpencodeRuntimeStatus(probe)
  console.log(formatOpencodeRuntimeStatusItems(items))

  const hasAttention = items.some((item) => item.state === 'attention')
  const hasPending = items.some((item) => item.state === 'pending')
  if (hasAttention || (strict && hasPending)) {
    process.exitCode = 1
  }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCli) {
  runCli()
}
