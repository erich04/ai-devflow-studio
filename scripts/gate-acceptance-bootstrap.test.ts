// @vitest-environment node
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })
const request = { model: 'deepseek-flash', max_tokens: 65536, messages: [{ role: 'user', content: 'PRIVATE_SYNTHETIC_PROMPT' }] }

async function harness(fetcher: typeof fetch, closed = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gate-acceptance-budget-'))
  directories.push(directory)
  if (closed) await writeFile(path.join(directory, 'official-budget.json'), JSON.stringify({ version: 1, budgetMicroyuan: 2_000_000, closed: true, calls: [] }))
  const app = Object.assign(new EventEmitter(), { setName() {}, quit: vi.fn() })
  const processStub = Object.assign(new EventEmitter(), {
    env: { DEVFLOW_GATE_ACCEPTANCE: '1', DEVFLOW_GATE_ACCEPTANCE_DIR: directory },
    pid: process.pid, hrtime: process.hrtime,
  })
  const require = createRequire(import.meta.url)
  const source = (await readFile('scripts/gate-acceptance-bootstrap.cjs', 'utf8'))
    .replace(/^import\(pathToFileURL.*$/mu, '')
  const sandbox = { require: (name: string) => name === 'electron' ? { app } : require(name),
    __dirname: path.resolve('scripts'), process: processStub, Buffer, URL, setTimeout, fetch: fetcher }
  runInNewContext(source, sandbox)
  return {
    quit: () => app.emit('before-quit'),
    dispatch: (body = request) => sandbox.fetch('https://api.deepseek.com/chat/completions', { method: 'POST', body: JSON.stringify(body) }),
    ledger: async () => JSON.parse(await readFile(path.join(directory, 'official-budget.json'), 'utf8')),
    log: () => readFile(path.join(directory, 'lifecycle.jsonl'), 'utf8'),
  }
}

describe('isolated gate acceptance observer', () => {
  it('closes authorization on Electron quit even when Node SIGTERM is not delivered', async () => {
    const fetcher = vi.fn(async () => new Response('{}'))
    const run = await harness(fetcher)
    run.quit()
    expect((await run.ledger()).closed).toBe(true)
    await expect(run.dispatch()).rejects.toThrow('CNY 2')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns the original response when cloning for observation fails', async () => {
    const response = new Response('real response')
    response.clone = () => { throw new Error('observer only') }
    const run = await harness(vi.fn(async () => response))
    expect(await run.dispatch()).toBe(response)
    expect(await response.text()).toBe('real response')
    expect((await run.ledger()).calls[0].committedMicroyuan).toBeUndefined()
  })

  it('does not delay or rewrite the original response while observing its clone', async () => {
    let complete!: () => void
    const response = new Response('real response')
    response.clone = () => new Response(new ReadableStream({ start(controller) {
      complete = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }))); controller.close() }
    } }))
    const fetcher = vi.fn<typeof fetch>(async () => response)
    const run = await harness(fetcher)
    expect(await run.dispatch()).toBe(response)
    expect((await run.ledger()).calls[0].status).toBe('reserved_unknown')
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(request)
    complete()
    await vi.waitFor(async () => expect((await run.ledger()).calls[0].committedMicroyuan).toBe(88))
    expect(JSON.stringify(await run.ledger()) + await run.log()).not.toContain('PRIVATE_SYNTHETIC_PROMPT')
  })

  it('reserves unknown calls cumulatively and rejects a call before spending past CNY 2', async () => {
    const fetcher = vi.fn(async () => new Response('{}'))
    const run = await harness(fetcher)
    for (let index = 0; index < 3; index++) await run.dispatch()
    await expect(run.dispatch()).rejects.toThrow('CNY 2')
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect((await run.ledger()).calls).toHaveLength(3)
  })

  it('keeps a closed authorization closed after restarting the observer', async () => {
    const fetcher = vi.fn(async () => new Response('{}'))
    const run = await harness(fetcher, true)
    await expect(run.dispatch()).rejects.toThrow('CNY 2')
    expect(fetcher).not.toHaveBeenCalled()
    expect((await run.ledger()).closed).toBe(true)
  })
})
