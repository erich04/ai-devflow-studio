// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { CodingCommandRunner } from './coding-command-runner'

it.runIf(process.platform === 'darwin' || process.platform === 'linux')('confines MCP stdio and cancels the sandboxed process tree', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-stdio-sandbox-')), cwd = path.join(root, 'candidate')
  await mkdir(cwd); const secret = path.join(root, 'private'); await writeFile(secret, 'private')
  const runner = new CodingCommandRunner(path.join(root, 'commands'))
  try {
    const environment = { PATH: process.env.PATH }
    const child = await runner.startStdio('mcp', process.execPath, ['-e', `
      const fs=require('fs'),assert=require('assert/strict');
      assert.throws(()=>fs.readFileSync(${JSON.stringify(secret)}),/EPERM|EACCES|ENOENT/);
      const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)']);
      fs.writeFileSync('child.pid',String(c.pid));
      process.stdin.on('data', b=>process.stdout.write(b));setInterval(()=>{},1000);
    `], cwd, environment, undefined, { kind: 'os_sandbox', network: 'none' })
    const echoed = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Confined stdio did not respond')), 5000)
      child.stdout.once('data', data => { clearTimeout(timeout); resolve(String(data)) })
    })
    child.stdin.write('sandbox echo')
    expect(await echoed).toContain('sandbox echo')
    expect(environment).toEqual({ PATH: process.env.PATH })
    const pid = Number(await readFile(path.join(cwd, 'child.pid'), 'utf8'))
    const receipt = await runner.cancel('mcp')
    expect(receipt.status).toBe('cancelled')
    expect(receipt.temporaryCleanupStatus).toBe('completed')
    // In a bubblewrap PID namespace the child pid is namespace-local. The outer
    // worker cancellation and die-with-parent close its streams and namespace.
    if (receipt.sandbox?.backend !== 'bubblewrap') await expect.poll(() => {
      try { process.kill(pid, 0); return false } catch { return true }
    }, { timeout: 5000 }).toBe(true)
  } finally { await runner.cancelAll(); await rm(root, { recursive: true, force: true }) }
})

it.runIf(process.platform === 'darwin' || process.platform === 'linux')('runs the real command worker with a durable sandbox identity and private host data excluded', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-command-sandbox-')), cwd = path.join(root, 'candidate')
  await mkdir(cwd); const secret = path.join(root, 'private.json'); await writeFile(secret, 'private')
  const runner = new CodingCommandRunner(path.join(root, 'commands'))
  try {
    await runner.start('confined', { executable: process.execPath, args: ['-e', `const fs=require('fs'),assert=require('assert/strict');assert.throws(()=>fs.readFileSync(${JSON.stringify(secret)}),/EPERM|EACCES|ENOENT/);fs.writeFileSync('result','ok');fs.writeFileSync(process.env.TMPDIR+'/temp','ok')`], timeoutMs: 5000, profile: { kind: 'os_sandbox', network: 'none' } }, cwd)
    const receipt = await runner.wait('confined')
    expect(receipt.status).toBe('passed')
    expect(receipt.sandbox?.policyDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(receipt.sandbox?.backend).toBe(process.platform === 'darwin' ? 'seatbelt' : expect.stringMatching(/bubblewrap|landlock/))
    expect(receipt.temporaryCleanupStatus).toBe('completed')
    expect(await readFile(path.join(cwd, 'result'), 'utf8')).toBe('ok')
    expect(await readFile(secret, 'utf8')).toBe('private')
  } finally { await runner.cancelAll(); await rm(root, { recursive: true, force: true }) }
})
