// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { CodingCommandRunner } from './coding-command-runner'
import { codingShellPlan } from './coding-dependency-preparation'

const directories: string[] = []
it('executes an authorized real command, keeps paged output, and never reruns a completed command id', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-command-')); directories.push(root)
  const runner = new CodingCommandRunner(path.join(root, 'receipts'))
  const plan = { executable: process.execPath, args: ['-e', 'require("fs").appendFileSync("count.txt", "x");console.log("real output")'], timeoutMs: 5000, profile: { kind: 'trusted_local' as const } }
  const job = await runner.start('command-1', plan, root)
  expect((await runner.wait(job.id)).status).toBe('passed')
  expect((await runner.read(job.id, 0, 500)).output).toContain('real output')
  const reopened = new CodingCommandRunner(path.join(root, 'receipts'))
  expect((await reopened.start('command-1', plan, root)).status).toBe('passed')
  expect(await readFile(path.join(root, 'count.txt'), 'utf8')).toBe('x')
})
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

it('preserves quoted arguments, spaces and operators in a saved shell test command', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow command quoting ')); directories.push(root)
  const runner = new CodingCommandRunner(path.join(root, 'receipts'))
  const plan = codingShellPlan('node -e "require(\'fs\').writeFileSync(\'result with spaces.txt\', \'expected value\')" && node -e "process.exit(0)"', { kind: 'trusted_local' })
  try {
    const receipt = await runner.start('quoted-saved-test', plan, root)
    expect(await runner.wait(receipt.id), JSON.stringify(await runner.read(receipt.id))).toMatchObject({ status: 'passed', exitCode: 0 })
    expect(await readFile(path.join(root, 'result with spaces.txt'), 'utf8')).toBe('expected value')
  } finally { await runner.cancelAll() }
})

it('does not run the saved test when dependency preparation fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-preparation-')); directories.push(root)
  const runner = new CodingCommandRunner(path.join(root, 'receipts'))
  await runner.start('prepare-failed', { executable: process.execPath, args: ['-e', 'require("fs").writeFileSync("must-not-exist", "bad")'], timeoutMs: 5000, profile: { kind: 'trusted_local' }, preparation: { executable: process.execPath, args: ['-e', 'console.log("install failure");process.exit(7)'], timeoutMs: 5000 } }, root)
  expect(await runner.wait('prepare-failed')).toMatchObject({ status: 'failed', preparationExitCode: 7, exitCode: 7 })
  await expect(readFile(path.join(root, 'must-not-exist'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('waits for the actual process to stop before returning cancellation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-command-cancel-')); directories.push(root)
  const runner = new CodingCommandRunner(path.join(root, 'receipts'))
  const receipt = await runner.start('cancel', { executable: process.execPath, args: ['-e', 'setInterval(()=>{},100)'], timeoutMs: 10000, profile: { kind: 'trusted_local' } }, root)
  await runner.cancelAll()
  expect(await runner.wait('cancel')).toMatchObject({ status: 'cancelled', exitCode: null })
  expect(runner.hasActiveCommands).toBe(false)
  if (receipt.pid) expect(() => process.kill(receipt.pid!, 0)).toThrow()
})

it('cancels the actual command descendant as well as its worker', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-command-tree-')); directories.push(root)
  const runner = new CodingCommandRunner(path.join(root, 'receipts'))
  let commandPid: number | undefined
  try {
    const receipt = await runner.start('command-tree', { executable: process.execPath, args: ['-e', 'require("fs").writeFileSync("command.pid", String(process.pid));setInterval(()=>{},100)'], timeoutMs: 10000, profile: { kind: 'trusted_local' } }, root)
    await expect.poll(async () => { try { commandPid = Number(await readFile(path.join(root, 'command.pid'), 'utf8')); return Number.isSafeInteger(commandPid) } catch { return false } }).toBe(true)
    expect(commandPid).not.toBe(receipt.pid)
    await runner.cancelAll()
    expect((await runner.wait(receipt.id)).status).toBe('cancelled')
    expect(() => process.kill(commandPid!, 0)).toThrow()
  } finally {
    // Failed assertions must not leave a real command holding the test directory.
    if (commandPid) { try { process.kill(commandPid, 'SIGKILL') } catch {} }
    await runner.cancelAll()
  }
})

it('enforces the preparation deadline independently of the following test allowance', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-phase-deadline-')); directories.push(root)
  const runner = new CodingCommandRunner(path.join(root, 'receipts'))
  await runner.start('phase-deadline', { executable: process.execPath, args: ['-e', 'require("fs").writeFileSync("must-not-exist", "bad")'], timeoutMs: 5000, profile: { kind: 'trusted_local' }, preparation: { executable: process.execPath, args: ['-e', 'setTimeout(()=>{}, 1500)'], timeoutMs: 500 } }, root)
  expect(await runner.wait('phase-deadline')).toMatchObject({ status: 'timed_out', exitCode: null })
  await expect(readFile(path.join(root, 'must-not-exist'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('reconciles a surviving authenticated worker even when no logical writer lease remains', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-command-takeover-')); directories.push(root)
  const original = new CodingCommandRunner(path.join(root, 'receipts'))
  const started = await original.start('old-worker', { executable: process.execPath, args: ['-e', 'setInterval(()=>{},100)'], timeoutMs: 30000, profile: { kind: 'trusted_local' } }, root)
  try {
    const replacement = new CodingCommandRunner(path.join(root, 'receipts'))
    const reconciled = await replacement.reconcile()
    expect(reconciled, JSON.stringify(await replacement.get('old-worker'))).toBe(true)
    await original.wait('old-worker')
    expect(['cancelled', 'failed']).toContain((await replacement.get('old-worker'))!.status)
    expect(() => process.kill(started.pid!, 0)).toThrow()
  } finally { await original.cancelAll() }
})

it('keeps an installed stdio transport under the same durable process owner and cancels it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-stdio-')); directories.push(root)
  const runner = new CodingCommandRunner(path.join(root, 'receipts'))
  const child = await runner.startStdio('mcp', process.execPath, ['-e', 'process.stdin.on("data", b => process.stdout.write(b));setInterval(()=>{},1000)'], root, { PATH: process.env.PATH })
  const response = new Promise<string>(resolve => child.stdout.once('data', bytes => resolve(String(bytes))))
  child.stdin.write('protocol-message\n')
  expect(await response).toBe('protocol-message\n')
  await runner.cancelAll()
  expect((await runner.wait('mcp')).status).toBe('cancelled')
  expect(() => process.kill(child.pid!, 0)).toThrow()
})
