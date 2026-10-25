import assert from 'node:assert/strict'
import test from 'node:test'
import { serviceEnvironment } from './devflow-b-service-env.mjs'

const app = { DEVFLOW_GITHUB_APP_ID: '123', DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64: 'fixture-only-key' }

test('only the API receives the explicitly selected App credentials', () => {
  const source = { ...app, DEVFLOW_DATABASE_URL: 'old-database', UNRELATED_SECRET: 'old-secret' }
  for (const service of ['api', 'web', 'desktop']) {
    const result = serviceEnvironment(service, { PATH: '/fixture/bin' }, { PORT: '12345' }, source)
    assert.equal(result.PATH, '/fixture/bin')
    assert.equal(result.PORT, '12345')
    assert.equal(result.DEVFLOW_DATABASE_URL, undefined)
    assert.equal(result.UNRELATED_SECRET, undefined)
    assert.equal(result.DEVFLOW_GITHUB_APP_ID, service === 'api' ? '123' : undefined)
    assert.equal(result.DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64, service === 'api' ? 'fixture-only-key' : undefined)
  }
})

test('ambient App configuration and its source path cannot reach any service', () => {
  const inherited = { ...app, DEVFLOW_B_GITHUB_APP_ENV: '/private/old.env', DEVFLOW_GITHUB_APP_OTHER_SECRET: 'old' }
  for (const service of ['api', 'web', 'desktop']) {
    assert.deepEqual(serviceEnvironment(service, inherited, app), {})
  }
  assert.equal(inherited.DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64, 'fixture-only-key')
})

test('incomplete explicit App configuration fails without including its values', () => {
  assert.throws(() => serviceEnvironment('api', {}, {}, { DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64: 'fixture-only-key' }), {
    message: 'Explicit GitHub App configuration requires an ID and private key',
  })
  assert.throws(() => serviceEnvironment('unknown', {}, {}), /Unknown B service/)
})
