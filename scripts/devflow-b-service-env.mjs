import assert from 'node:assert/strict'

// Verification-only: reuse an existing App configuration in the API process.
// Never inherit it implicitly or forward the source file's other settings.
export function serviceEnvironment(service, inherited, common, appSource) {
  assert(['api', 'web', 'desktop'].includes(service), 'Unknown B service')
  const result = { ...inherited, ...common }
  for (const name of Object.keys(result)) {
    if (name.startsWith('DEVFLOW_GITHUB_APP_') || name === 'DEVFLOW_B_GITHUB_APP_ENV') delete result[name]
  }
  if (service === 'api' && appSource) {
    const id = appSource.DEVFLOW_GITHUB_APP_ID
    const key = appSource.DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64
    assert(typeof id === 'string' && /^\d+$/.test(id) && typeof key === 'string' && key.length > 0,
      'Explicit GitHub App configuration requires an ID and private key')
    result.DEVFLOW_GITHUB_APP_ID = id
    result.DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64 = key
  }
  return result
}
