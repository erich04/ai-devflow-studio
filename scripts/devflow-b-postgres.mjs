// Provision ONLY B's disposable PostgreSQL. Existing unrelated containers are never touched.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const directory = path.resolve(process.env.DEVFLOW_B_ENVIRONMENT ?? path.join(root, '.tmp/devflow-b-20261023'))
const config = path.join(directory, 'postgres.json')
const name = 'devflow-b-20261023'
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const names = docker('ps', '-a', '--format', '{{.Names}}').split('\n')
if (names.includes(name)) {
  const saved = JSON.parse(await readFile(config, 'utf8'))
  const owned = JSON.parse(docker('inspect', name))[0]
  assert.equal(owned.Config.Labels?.['devflow.validation.scope'], name)
  assert.equal(owned.State.Running, true, 'B database exists but is stopped; inspect before restarting')
  assert.equal(saved.container, name)
  console.log(JSON.stringify({ ready: true, container: name, config, port: saved.port, reused: true }))
} else {
  assert(!docker('volume', 'ls', '--format', '{{.Name}}').split('\n').includes(`${name}-data`), 'B volume already exists; inspect before reuse')
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port; await new Promise(resolve => server.close(resolve))
  const password = randomBytes(24).toString('hex')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  execFileSync('docker', ['run', '-d', '--name', name, '--label', `devflow.validation.scope=${name}`,
    '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=devflow_b', '-p', `127.0.0.1:${port}:5432`,
    '-v', `${name}-data:/var/lib/postgresql/data`, 'postgres:16-alpine'],
    { env: { ...process.env, POSTGRES_PASSWORD: password }, stdio: ['ignore', 'ignore', 'pipe'] })
  const databaseUrl = `postgres://postgres:${password}@127.0.0.1:${port}/devflow_b`
  await writeFile(config, JSON.stringify({ container: name, port, databaseUrl }, null, 2), { mode: 0o600 })
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    try { docker('exec', name, 'pg_isready', '-U', 'postgres', '-d', 'devflow_b'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 500)) }
  }
  assert(ready, 'B Postgres did not become ready; container and evidence retained')
  console.log(JSON.stringify({ ready, container: name, config, port, reused: false }))
}
