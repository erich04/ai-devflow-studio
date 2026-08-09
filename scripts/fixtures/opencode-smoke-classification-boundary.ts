import { createOpencodeSmokeStageError } from '../opencode-smoke-policy.ts'

async function main(): Promise<void> {
  const { CodingEnginePermissionDiscoveryError, CodingEngineStartupCleanupError } = await import(
    '../../apps/desktop/electron/coding-engine-lifecycle.js'
  )
  const completedWithoutPermission = createOpencodeSmokeStageError(
    'engine_start',
    new CodingEnginePermissionDiscoveryError('message_completed_without_permission'),
  )

  if (completedWithoutPermission.code !== 'message_completed_without_permission') {
    throw new Error(`unexpected classification: ${completedWithoutPermission.code}`)
  }
  const permissionTimeout = createOpencodeSmokeStageError(
    'engine_start',
    new CodingEnginePermissionDiscoveryError('permission_discovery_timed_out'),
  )
  if (permissionTimeout.code !== 'permission_discovery_timed_out') {
    throw new Error(`unexpected timeout classification: ${permissionTimeout.code}`)
  }

  const { OpencodeMessageResponseError, sendOpencodeMessage } = await import(
    '../../apps/desktop/electron/opencode-http-adapter.js'
  )
  const providerFailure = createOpencodeSmokeStageError(
    'engine_start',
    new OpencodeMessageResponseError({
      code: 'provider_api_error',
      statusCode: 429,
      retryable: true,
    }),
  )

  if (
    providerFailure.code !== 'provider_api_error' ||
    providerFailure.statusCode !== 429 ||
    providerFailure.retryable !== true
  ) {
    throw new Error(`unexpected provider classification: ${providerFailure.code}`)
  }

  const cleanupFailure = createOpencodeSmokeStageError(
    'engine_start',
    new CodingEngineStartupCleanupError([
      new OpencodeMessageResponseError({
        code: 'provider_api_error',
        statusCode: 429,
        retryable: true,
      }),
      new Error('cleanup detail must not be classified'),
    ]),
  )

  if (cleanupFailure.code !== 'provider_api_error' || cleanupFailure.cleanup !== 'failed') {
    throw new Error(`unexpected cleanup classification: ${cleanupFailure.code}`)
  }

  const transportError = await sendOpencodeMessage({
    baseUrl: 'http://opencode.invalid',
    sessionId: 'RAW_SESSION_SENTINEL',
    directory: '/private/tmp/RAW_DIRECTORY_SENTINEL',
    model: { providerID: 'double', modelID: 'ark-code-latest' },
    text: 'safe fixture prompt',
    fetcher: (async (input: Parameters<typeof fetch>[0]) => {
      throw new Error(`RAW_TRANSPORT_SENTINEL ${String(input)}`)
    }) as typeof fetch,
  }).catch((error: unknown) => error)
  const classifiedTransport = createOpencodeSmokeStageError('engine_start', transportError)

  if (classifiedTransport.code !== 'transport_error') {
    throw new Error(`unexpected transport classification: ${classifiedTransport.code}`)
  }
  const serializedTransport = JSON.stringify(classifiedTransport)
  for (const forbidden of [
    'RAW_TRANSPORT_SENTINEL',
    'RAW_SESSION_SENTINEL',
    'RAW_DIRECTORY_SENTINEL',
    '%2Fprivate%2Ftmp',
  ]) {
    if (serializedTransport.includes(forbidden)) {
      throw new Error('transport classification exposed a forbidden sentinel')
    }
  }

  const httpError = await sendOpencodeMessage({
    baseUrl: 'http://opencode.invalid',
    sessionId: 'RAW_SESSION_SENTINEL',
    directory: '/private/tmp/RAW_DIRECTORY_SENTINEL',
    model: { providerID: 'double', modelID: 'ark-code-latest' },
    text: 'safe fixture prompt',
    fetcher: (async () =>
      new Response('RAW_HTTP_BODY_SENTINEL', { status: 503 })) as typeof fetch,
  }).catch((error: unknown) => error)
  const classifiedHttp = createOpencodeSmokeStageError('engine_start', httpError)
  if (classifiedHttp.code !== 'http_status_error' || classifiedHttp.statusCode !== 503) {
    throw new Error(`unexpected HTTP classification: ${classifiedHttp.code}`)
  }
  if (JSON.stringify(classifiedHttp).includes('RAW_HTTP_BODY_SENTINEL')) {
    throw new Error('HTTP classification exposed a forbidden sentinel')
  }

  const invalidJsonError = await sendOpencodeMessage({
    baseUrl: 'http://opencode.invalid',
    sessionId: 'RAW_SESSION_SENTINEL',
    directory: '/private/tmp/RAW_DIRECTORY_SENTINEL',
    model: { providerID: 'double', modelID: 'ark-code-latest' },
    text: 'safe fixture prompt',
    fetcher: (async () =>
      new Response('RAW_INVALID_JSON_SENTINEL', { status: 200 })) as typeof fetch,
  }).catch((error: unknown) => error)
  const classifiedInvalidJson = createOpencodeSmokeStageError(
    'engine_start',
    invalidJsonError,
  )
  if (
    classifiedInvalidJson.code !== 'invalid_json_response' ||
    classifiedInvalidJson.statusCode !== 200
  ) {
    throw new Error(`unexpected JSON classification: ${classifiedInvalidJson.code}`)
  }
  if (JSON.stringify(classifiedInvalidJson).includes('RAW_INVALID_JSON_SENTINEL')) {
    throw new Error('JSON classification exposed a forbidden sentinel')
  }
}

void main()
