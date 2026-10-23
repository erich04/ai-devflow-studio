// Explicit B verification process only. The production entry point never imports this file.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, safeStorage } = require('electron')
assert.equal(process.env.DEVFLOW_B_HARNESS, '1')
assert(process.env.DEVFLOW_USER_DATA_DIR && process.env.DEVFLOW_DATA_PROFILE_REGISTRY_PATH)
assert(process.env.DEVFLOW_B_GATEWAY_CONFIG)
const originalFetch = globalThis.fetch
// Credentials in this fresh profile are synthetic gateway/pairing values only. Real DeepSeek
// credentials remain in the separate gateway; this does not test the operating-system keychain.
safeStorage.isAsyncEncryptionAvailable = async () => true
safeStorage.encryptStringAsync = async value => Buffer.from(`devflow-b-fixture:${value}`)
safeStorage.decryptStringAsync = async bytes => {
  const value = bytes.toString()
  assert(value.startsWith('devflow-b-fixture:'), 'Only isolated B fixture credentials are allowed')
  return { result: value.slice('devflow-b-fixture:'.length), shouldReEncrypt: false }
}
globalThis.fetch = async (input, options) => {
  const source = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  if (source.hostname !== 'api.deepseek.com') return originalFetch(input, options)
  assert(source.protocol === 'https:' && ['/v1/chat/completions', '/chat/completions'].includes(source.pathname))
  const gateway = JSON.parse(fs.readFileSync(process.env.DEVFLOW_B_GATEWAY_CONFIG, 'utf8'))
  assert(gateway.url, 'B gateway is not enabled; no model request was sent')
  const endpoint = new URL(gateway.url)
  assert.equal(endpoint.protocol, 'http:')
  assert.equal(endpoint.hostname, '127.0.0.1')
  assert(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash)
  endpoint.pathname = '/v1/chat/completions'
  const headers = new Headers(options?.headers ?? (input instanceof Request ? input.headers : undefined))
  headers.set('Authorization', 'Bearer sk-synthetic-b-gateway')
  // The real production provider/parser/governance still sees official metadata and real usage.
  const response = await originalFetch(endpoint, { ...options, headers, redirect: 'error' })
  if (process.env.DEVFLOW_B_RESPONSE_DIAGNOSTICS === '1') {
    const profile = path.resolve(process.env.DEVFLOW_USER_DATA_DIR)
    const output = path.dirname(profile)
    assert(path.basename(profile) === 'profile' && /^no-opencode-\d+$/.test(path.basename(output)))
    assert(output.startsWith(path.resolve(__dirname, '../.tmp/devflow-b-20261023') + path.sep))
    void require('./devflow-b-response-diagnostics.cjs').diagnoseResponse(response.clone(), path.join(output, 'response-shapes.jsonl'))
  }
  return response
}
app.setName(require('../apps/desktop/package.json').name)
import(pathToFileURL(path.resolve(__dirname, '../apps/desktop/dist-electron/main.js')).href)
