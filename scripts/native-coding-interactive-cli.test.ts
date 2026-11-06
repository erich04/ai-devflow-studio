// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'

const exec = promisify(execFile), roots: string[] = []
const repo = fileURLToPath(new URL('..', import.meta.url))
const script = path.join(repo, 'scripts/native-coding-interactive-live.mjs')
const call = (args: string[]) => exec(process.execPath, ['--import', 'tsx', script, ...args], { cwd: repo, timeout: 20000 })
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 5 }))) })
async function directory() { const root = await mkdtemp(path.join(os.tmpdir(), 'interactive-cli-')); roots.push(root); return root }

it('requires an explicit round and both limits before creating any output or reading a credential', async () => {
  const root = await directory(), round = path.join(root, 'round')
  await expect(call(['init', round])).rejects.toThrow(/Usage/)
  await expect(call(['init', round, '1'])).rejects.toThrow(/Usage/)
  expect(await readdir(root)).toEqual([])
})

it('initializes without credentials and marks exhausted selected scenarios blocked without starting workers', async () => {
  const root = await directory(), round = path.join(root, 'round')
  await call(['init', round, '0.000001', '3'])
  const limits = JSON.parse(await readFile(path.join(round, 'round.json'), 'utf8'))
  expect(limits).toMatchObject({ maxCostUsd: 0.000001, maxCalls: 3 })
  // This path is deliberately absent: a worker must never reach credential loading.
  await expect(call(['run', round, 'r1', path.join(root, 'absent-key'), 'clarification'])).rejects.toThrow()
  const result = JSON.parse(await readFile(path.join(round, 'attempts/r1/results.json'), 'utf8'))
  expect(result).toEqual([expect.objectContaining({ id: 'clarification', passed: false, blocked: 'round_budget_exhausted' })])
  const summary = JSON.parse(await readFile(path.join(round, 'attempts/r1/round-budget.json'), 'utf8'))
  expect(summary).toMatchObject({ calls: 0, maxCostUsd: 0.000001, maxCalls: 3 })
  expect((await readdir(path.join(round, 'attempts/r1'))).some(name => name.endsWith('.log'))).toBe(false)
}, 30000)

it('rejects missing rounds, unknown scenarios and reused attempt names before launching a worker', async () => {
  const root = await directory(), round = path.join(root, 'round')
  await expect(call(['run', round, 'r1', path.join(root, 'absent-key')])).rejects.toThrow()
  expect(await readdir(root)).toEqual([])
  await call(['init', round, '0.000001', '3'])
  await expect(call(['run', round, 'r1', 'absent-key', 'typo'])).rejects.toThrow(/scenario/i)
  await expect(call(['run', round, '../escape', 'absent-key', 'clarification'])).rejects.toThrow(/attempt/i)
  await expect(call(['run', round, 'r1', 'absent-key', 'clarification'])).rejects.toThrow()
  await expect(call(['run', round, 'r1', 'absent-key', 'clarification'])).rejects.toThrow(/EEXIST/)
}, 30000)

it('rejects a direct worker without a shared round before reading its private credential', async () => {
  const root = await directory(), config = path.join(root, 'config.json')
  await writeFile(config, JSON.stringify({ root: path.join(root, 'scenario') }))
  await expect(exec(process.execPath, ['--import', 'tsx', 'scripts/native-coding-interactive-worker.mts', config, path.join(root, 'absent-key')],
    { cwd: repo, timeout: 20000 })).rejects.toThrow(/Explicit shared round budget required/)
  expect(await readdir(root)).toEqual(['config.json'])
})
