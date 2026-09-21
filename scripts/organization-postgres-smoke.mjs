import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const databaseUrl = process.env.DEVFLOW_TENANCY_TEST_DATABASE_URL
if (!databaseUrl || !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) {
  throw new Error('Set DEVFLOW_TENANCY_TEST_DATABASE_URL to an isolated test Postgres database. The suite creates and removes its own random schema.')
}
const child = spawn(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', ['pnpm', 'exec', 'vitest', 'run', 'scripts/organization-postgres.test.ts'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit', env: process.env,
})
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
