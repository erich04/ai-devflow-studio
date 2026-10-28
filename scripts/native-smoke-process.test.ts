// @vitest-environment node
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { stopNativeSmokeProcess } from './native-smoke-process.mjs'

it('closes real descendant-held pipes without terminating an unrelated process', async () => {
  const descendant = "console.log('descendant:' + process.pid); setInterval(() => {}, 1000)"
  const parent = spawn(process.execPath, ['-e', `
    require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'inherit' });
    setInterval(() => {}, 1000);
  `], { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  const unrelated = spawn(process.execPath, ['-e', "console.log('ready'); setInterval(() => {}, 1000)"], {
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  })
  let descendantPid: number | undefined
  try {
    const unrelatedReady = once(unrelated.stdout, 'data')
    const [output] = await once(parent.stdout, 'data')
    descendantPid = Number(output.toString().match(/descendant:(\d+)/)?.[1])
    expect(descendantPid).toBeGreaterThan(0)
    await unrelatedReady
    await stopNativeSmokeProcess(parent)
    await expect.poll(() => {
      try { process.kill(descendantPid!, 0); return true } catch { return false }
    }, { timeout: 2_000 }).toBe(false)
    expect(parent.stdout.destroyed).toBe(true)
    expect(() => process.kill(unrelated.pid!, 0)).not.toThrow()
  } finally {
    await Promise.all([stopNativeSmokeProcess(parent), stopNativeSmokeProcess(unrelated)])
    if (descendantPid) { try { process.kill(descendantPid, 'SIGKILL') } catch { /* Already stopped. */ } }
  }
}, 15_000)
