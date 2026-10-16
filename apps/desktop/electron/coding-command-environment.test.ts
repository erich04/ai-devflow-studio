// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { CodingCommandRunner } from './coding-command-runner'
import * as processes from './opencode-process'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('keeps command temporary files private and outside deep workspaces, so real local sockets work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'df-command-env-')); roots.push(root)
  const storage = path.join(root, ...Array.from({ length: 6 }, (_, index) => `deep-command-storage-${index}`))
  await mkdir(path.join(root, '.git'))
  const runner = new CodingCommandRunner(storage)
  const script = String.raw`const net=require('node:net'),os=require('node:os'),path=require('node:path'),fs=require('node:fs'); const temporary=os.tmpdir(); const socket=process.platform==='win32'?'\\\\.\\pipe\\df-command-'+process.pid:path.join(temporary,'test-'+process.pid+'.sock'); const server=net.createServer(); server.on('error',error=>{console.error(error.code);process.exitCode=1}); server.listen(socket,()=>{console.log(JSON.stringify({temporary,home:os.homedir(),mode:fs.statSync(temporary).mode&511}));server.close()});`
  try {
    await runner.start('socket', { executable: process.execPath, args: ['-e', script], timeoutMs: 5000, profile: { kind: 'trusted_local' } }, root)
    const receipt = await runner.wait('socket'), output = (await runner.read('socket')).output
    expect(receipt.status, output).toBe('passed')
    const observed = JSON.parse(output.trim()) as { temporary: string; home: string; mode: number }
    expect(path.relative(root, observed.temporary).startsWith('..')).toBe(true)
    expect(observed.home).toBe(path.join(storage, 'home'))
    if (process.platform !== 'win32') expect(observed.mode & 0o077).toBe(0)
    await expect(stat(observed.temporary)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await runner.cancelAll() }
})

it('removes only its own temporary directory after stopping a real command tree', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'df-command-env-cancel-')); roots.push(root)
  const runner = new CodingCommandRunner(path.join(root, 'receipts'))
  const sibling = await mkdtemp(path.join(os.tmpdir(), 'df-unrelated-')); roots.push(sibling)
  try {
    await runner.start('cancel', { executable: process.execPath, args: ['-e', 'require("node:fs").writeFileSync("temporary.json",JSON.stringify({path:require("node:os").tmpdir()}));setInterval(()=>{},100)'], timeoutMs: 10000, profile: { kind: 'trusted_local' } }, root)
    await expect.poll(async () => { try { return JSON.parse(await readFile(path.join(root, 'temporary.json'), 'utf8')).path as string } catch { return '' } }).not.toBe('')
    const temporary = JSON.parse(await readFile(path.join(root, 'temporary.json'), 'utf8')).path as string
    await runner.cancelAll()
    expect((await runner.wait('cancel')).status).toBe('cancelled')
    await expect(stat(temporary)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await stat(sibling)).isDirectory()).toBe(true)
  } finally { await runner.cancelAll() }
})

it('preserves an unverified temporary directory and retries cleanup only after its receipt ownership is restored', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'df-command-env-recover-')); roots.push(root)
  const storage = path.join(root, 'receipts'), runner = new CodingCommandRunner(storage)
  try {
    await runner.start('owner-removed', { executable: process.execPath, args: ['-e', 'const fs=require("node:fs"),path=require("node:path"),tmp=require("node:os").tmpdir();fs.writeFileSync(path.join(tmp,"preserve.txt"),"kept");fs.unlinkSync(path.join(tmp,".devflow-owner.json"))'], timeoutMs: 5000, profile: { kind: 'trusted_local' } }, root)
    const receipt = await runner.wait('owner-removed')
    expect(receipt).toMatchObject({ status: 'passed', temporaryCleanupStatus: 'failed' })
    const temporary = receipt.temporaryDirectory!; roots.push(temporary)
    const reopened = new CodingCommandRunner(storage)
    expect(await reopened.reconcile()).toBe(false)
    expect(await readFile(path.join(temporary, 'preserve.txt'), 'utf8')).toBe('kept')
    await writeFile(path.join(temporary, '.devflow-owner.json'), JSON.stringify({ id: receipt.id, workerToken: receipt.workerToken }))
    expect(await reopened.reconcile()).toBe(true)
    expect(await reopened.get(receipt.id)).toMatchObject({ status: 'passed', temporaryCleanupStatus: 'completed' })
    await expect(stat(temporary)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await runner.cancelAll() }
})

it.skipIf(process.platform === 'win32')('defers temporary cleanup until recovery proves a worker is stopped', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'df-command-env-stop-')); roots.push(root)
  const storage = path.join(root, 'receipts'), runner = new CodingCommandRunner(storage)
  try {
    vi.spyOn(processes, 'terminateProcessTree').mockRejectedValueOnce(new Error('Termination not confirmed'))
    await runner.start('uncertain-stop', { executable: process.execPath, args: ['-e', 'console.log("exited")'], timeoutMs: 5000, profile: { kind: 'trusted_local' } }, root)
    const receipt = await runner.wait('uncertain-stop'); roots.push(receipt.temporaryDirectory!)
    expect(receipt).toMatchObject({ status: 'unknown', temporaryCleanupStatus: 'failed' })
    expect((await stat(receipt.temporaryDirectory!)).isDirectory()).toBe(true)
    vi.restoreAllMocks()
    const reopened = new CodingCommandRunner(storage)
    expect(await reopened.reconcile()).toBe(true)
    expect(await reopened.get(receipt.id)).toMatchObject({ status: 'cancelled', temporaryCleanupStatus: 'completed' })
    await expect(stat(receipt.temporaryDirectory!)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { vi.restoreAllMocks(); await runner.cancelAll() }
})
