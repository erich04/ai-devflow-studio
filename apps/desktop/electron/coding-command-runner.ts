import { fork, execFile, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { atomicCodingFile, codingDigest } from './coding-candidate-workspace'
import { terminateProcessTree } from './opencode-process'

export type CodingExecutionProfile = { kind: 'trusted_local' } | { kind: 'container'; image: string; network: 'none' | 'bridge' }
export type CodingCommandPlan = { executable: string; args: string[]; timeoutMs: number; profile: CodingExecutionProfile; preparation?: { executable: string; args: string[]; timeoutMs: number } }
export type CodingCommandReceipt = {
  schemaVersion: 1; id: string; plan: CodingCommandPlan; planDigest: string; cwd: string; pid?: number; workerToken?: string
  status: 'starting' | 'running' | 'passed' | 'failed' | 'timed_out' | 'cancelled' | 'unknown'
  exitCode: number | null; outputBytes: number; startedAt: string; completedAt?: string; error?: string
  preparationExitCode?: number | null
  phase?: 'preparation' | 'command'
  temporaryDirectory?: string
  temporaryCleanupStatus?: 'completed' | 'failed'
  temporaryCleanupError?: string
}
const exec = promisify(execFile)
// Socket-based tools (including tsx) cannot use the arbitrarily deep receipt
// directory as TEMP. Keep a private, short directory outside any project Git tree.
const temporaryBase = () => process.platform === 'win32' ? os.tmpdir() : '/tmp'
const temporaryPrefix = (id: string) => `dfcmd-${codingDigest(id).slice(0, 12)}-`
async function createCommandTemporaryDirectory(receipt: CodingCommandReceipt): Promise<string> {
  const directory = await mkdtemp(path.join(temporaryBase(), temporaryPrefix(receipt.id)))
  try {
    await writeFile(path.join(directory, '.devflow-owner.json'), JSON.stringify({ id: receipt.id, workerToken: receipt.workerToken }), { mode: 0o600, flag: 'wx' })
    return directory
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
}
async function removeCommandTemporaryDirectory(receipt: CodingCommandReceipt): Promise<void> {
  const directory = receipt.temporaryDirectory
  if (!directory) return
  let entry
  try { entry = await lstat(directory) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  const prefix = temporaryPrefix(receipt.id), name = path.basename(directory)
  if (!path.isAbsolute(directory) || !name.startsWith(prefix) || !/^[a-zA-Z0-9]{6}$/u.test(name.slice(prefix.length)) ||
      await realpath(path.dirname(directory)) !== await realpath(temporaryBase()) || !entry.isDirectory() || entry.isSymbolicLink() ||
      (process.getuid && entry.uid !== process.getuid())) throw new Error('Command temporary directory ownership is not verifiable')
  let owner: { id?: string; workerToken?: string }
  try { owner = JSON.parse(await readFile(path.join(directory, '.devflow-owner.json'), 'utf8')) as typeof owner }
  catch (error) {
    // The old host and a recovery host may both finish cleaning the same stopped
    // worker. A missing directory is idempotent; a missing owner in a live one is not.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      try { await lstat(directory) } catch (missing) { if ((missing as NodeJS.ErrnoException).code === 'ENOENT') return }
    }
    throw error
  }
  if (!receipt.workerToken || owner.id !== receipt.id || owner.workerToken !== receipt.workerToken) throw new Error('Command temporary directory owner does not match its receipt')
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
async function waitForWorkerExit(pid: number, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  do {
    try { process.kill(process.platform === 'win32' ? pid : -pid, 0) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error }
    if (Date.now() >= deadline) return false
    await new Promise(resolve => setTimeout(resolve, 25))
  } while (true)
}

async function terminateCodingWorker(child: ChildProcess): Promise<void> {
  if (process.platform !== 'win32' || !child.pid) return terminateProcessTree(child, { timeoutMs: 250, forceTimeoutMs: 2000 })
  if (child.exitCode !== null || await waitForWorkerExit(child.pid, 0)) return
  // On Windows, child.kill() forcibly exits only the worker; its JavaScript
  // SIGTERM handler cannot stop the actual command descendant.
  await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 5000 }).catch(async error => { if (!await waitForWorkerExit(child.pid!, 0)) throw error })
  if (!await waitForWorkerExit(child.pid)) throw new Error('Coding command process tree did not exit')
}
// The worker will not start a command until the host durably records its identity and sends `go`.
// Host IPC loss stops the worker's process group. It never interprets model-generated JavaScript.
const workerSource = String.raw`
const { spawn, execFile } = require('node:child_process');
let child, started = false, stopping = false, finished = false;
function stop() {
  if (stopping || finished) return; stopping = true;
  if (!child) return process.exit(1);
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => process.exit(1));
  } else {
    try { process.kill(-process.pid, 'SIGTERM'); } catch {}
    setTimeout(() => { try { process.kill(-process.pid, 'SIGKILL'); } catch {} process.exit(1); }, 300);
  }
}
process.on('SIGTERM', stop); process.on('disconnect', stop);
process.on('message', message => {
  if (started || message.type !== 'go') return; started = true;
  function run(index) {
    const command = message.commands[index];
    // Match Node's cmd.exe shell convention for an already-authorized script.
    // Default argv escaping inserts backslashes which cmd.exe treats literally.
    const cmdScript = process.platform === 'win32' && /^(?:.*[\\/])?cmd(?:\.exe)?$/i.test(command.executable) && command.args.length === 4 && command.args.slice(0, 3).join(' ').toLowerCase() === '/d /s /c';
    const args = cmdScript ? [...command.args.slice(0, 3), '"' + command.args[3] + '"'] : command.args;
    child = spawn(command.executable, args, { cwd: message.cwd, env: message.env, shell: false, windowsVerbatimArguments: cmdScript, stdio: [message.streamInput ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
    if (message.streamInput) process.stdin.pipe(child.stdin);
    child.on('error', error => { process.stderr.write(String(error)); process.exitCode = 1; });
    child.on('close', code => {
      if (stopping) return;
      if (index < message.commands.length - 1) {
        if (process.connected) process.send({ type: 'preparation', code });
        if (code === 0) return run(index + 1);
      }
      finished = true; process.exitCode = code === 0 ? 0 : 1;
      if (process.connected) { process.send({ type: 'exit', code }); process.disconnect(); }
    });
  }
  run(0);
});
process.send({ type: 'ready' });
`

/** Host-owned argv execution. Trusted-local deliberately makes no operating-system sandbox claim. */
export class CodingCommandRunner {
  private readonly active = new Map<string, { child: ChildProcess; done: Promise<CodingCommandReceipt>; stop(reason: 'cancelled' | 'timed_out'): Promise<void> }>()
  private readonly starting = new Map<string, Promise<CodingCommandReceipt>>()
  private readonly writes = new Map<string, Promise<void>>()
  constructor(readonly root: string, private readonly activity?: (id: string, active: boolean) => Promise<void>) {}
  private file(id: string, suffix: string) { return path.join(this.root, `${codingDigest(id)}.${suffix}`) }
  private save(receipt: CodingCommandReceipt) {
    const bytes = Buffer.from(JSON.stringify(receipt)), previous = this.writes.get(receipt.id) ?? Promise.resolve()
    const pending = previous.then(() => atomicCodingFile(this.file(receipt.id, 'json'), bytes)); this.writes.set(receipt.id, pending)
    return pending
  }
  private async cleanupTemporary(receipt: CodingCommandReceipt): Promise<boolean> {
    if (!receipt.temporaryDirectory || receipt.temporaryCleanupStatus === 'completed') return true
    try { await removeCommandTemporaryDirectory(receipt); receipt.temporaryCleanupStatus = 'completed'; delete receipt.temporaryCleanupError; return true }
    catch (error) { receipt.temporaryCleanupStatus = 'failed'; receipt.temporaryCleanupError = error instanceof Error ? error.message : 'Temporary directory cleanup failed'; return false }
  }
  async get(id: string): Promise<CodingCommandReceipt | undefined> {
    try { return JSON.parse(await readFile(this.file(id, 'json'), 'utf8')) as CodingCommandReceipt }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  }
  async start(id: string, plan: CodingCommandPlan, cwd: string, signal?: AbortSignal): Promise<CodingCommandReceipt> {
    const inFlight = this.starting.get(id)
    if (inFlight) { await inFlight; return this.start(id, plan, cwd, signal) }
    const pending = this.launch(id, plan, cwd, signal); this.starting.set(id, pending)
    try { return await pending } finally { this.starting.delete(id) }
  }
  /** The installed MCP authority supplies argv/env; model text cannot access this transport. */
  async startStdio(id: string, executable: string, args: string[], cwd: string, environment: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<ChildProcessWithoutNullStreams> {
    if (this.starting.has(id) || this.active.has(id)) throw new Error('MCP transport already owns this operation')
    const pending = this.launch(id, { executable, args, timeoutMs: 300000, profile: { kind: 'trusted_local' } }, cwd, signal, { streamInput: true, environment })
    this.starting.set(id, pending)
    try {
      await pending
      const child = this.active.get(id)?.child
      if (!child?.stdin || !child.stdout || !child.stderr) throw new Error('Previous MCP operation cannot be replayed')
      return child as ChildProcessWithoutNullStreams
    } finally { this.starting.delete(id) }
  }
  private async launch(id: string, plan: CodingCommandPlan, cwd: string, signal?: AbortSignal, transport?: { streamInput: true; environment: NodeJS.ProcessEnv }): Promise<CodingCommandReceipt> {
    const planDigest = codingDigest(JSON.stringify({ plan, cwd, ...(transport ? { transport: 'stdio', environmentDigest: codingDigest(JSON.stringify(transport.environment)) } : {}) }))
    const previous = await this.get(id)
    if (previous) {
      if (previous.planDigest !== planDigest) throw new Error('Command id reused with different authorization')
      if (['starting', 'running'].includes(previous.status) && !this.active.has(id)) {
        previous.status = 'unknown'; previous.error = 'Previous process must be stopped and its effects reconciled before another command'; await this.save(previous)
      }
      return previous
    }
    signal?.throwIfAborted()
    if (!plan.executable || plan.executable.includes('\0') || !Array.isArray(plan.args) || plan.args.some(arg => typeof arg !== 'string' || arg.includes('\0')) ||
      !Number.isSafeInteger(plan.timeoutMs) || plan.timeoutMs < 1 || plan.timeoutMs > 60 * 60_000 || !path.isAbsolute(cwd)) throw new Error('Invalid command plan')
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const privateHome = path.join(this.root, 'home'); await mkdir(privateHome, { recursive: true, mode: 0o700 })
    const emptyConfig = path.join(this.root, 'empty-gitconfig'); await writeFile(emptyConfig, '', { mode: 0o600 })
    if (plan.preparation && (!plan.preparation.executable || plan.preparation.executable.includes('\0') || plan.preparation.args.some(arg => typeof arg !== 'string' || arg.includes('\0')) || !Number.isSafeInteger(plan.preparation.timeoutMs) || plan.preparation.timeoutMs < 1 || plan.preparation.timeoutMs > 30 * 60_000)) throw new Error('Invalid dependency command')
    let commands = [...(plan.preparation ? [plan.preparation] : []), { executable: plan.executable, args: plan.args }].map(({ executable, args }) => ({ executable, args }))
    const containerName = `devflow-${codingDigest(id).slice(0, 24)}`
    if (plan.profile.kind === 'container') {
      if (!/^\S+@sha256:[a-f0-9]{64}$/u.test(plan.profile.image)) throw new Error('Container image must be pinned by digest')
      await exec('docker', ['image', 'inspect', plan.profile.image], { timeout: 10_000 })
      const profile = plan.profile
      commands = commands.map(command => ({ executable: 'docker', args: ['run', '--rm', '--name', containerName, '--network', profile.network, '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev',
        '--mount', `type=bind,source=${cwd},target=/workspace`, '--workdir', '/workspace', '--env', 'HOME=/tmp', ...(process.getuid ? ['--user', `${process.getuid()}:${process.getgid!()}`] : []), profile.image, command.executable, ...command.args] }))
    }
    const receipt: CodingCommandReceipt = { schemaVersion: 1, id, plan, planDigest, cwd, status: 'starting', exitCode: null, outputBytes: 0, startedAt: new Date().toISOString(), workerToken: randomUUID() }
    if (!transport) receipt.temporaryDirectory = await createCommandTemporaryDirectory(receipt)
    try { await this.save(receipt) } catch (error) { await this.cleanupTemporary(receipt); throw error }
    const environment = transport?.environment ?? {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
      TEMP: receipt.temporaryDirectory, TMP: receipt.temporaryDirectory, TMPDIR: receipt.temporaryDirectory,
      HOME: privateHome, USERPROFILE: privateHome, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_TERMINAL_PROMPT: '0', CI: '1',
    }
    const workerFile = path.join(this.root, 'command-worker.cjs'); await atomicCodingFile(workerFile, Buffer.from(workerSource))
    const child = fork(workerFile, [receipt.workerToken!], { execPath: process.execPath, execArgv: [], cwd, detached: process.platform !== 'win32', stdio: [transport ? 'pipe' : 'ignore', 'pipe', 'pipe', 'ipc'], env: { ...environment, ELECTRON_RUN_AS_NODE: '1' } })
    let reason: 'cancelled' | 'timed_out' | undefined, stopping: Promise<void> | undefined, output = Promise.resolve(), logError: unknown
    const stop = (why: 'cancelled' | 'timed_out') => {
      reason ??= why
      stopping ??= (async () => {
        if (plan.profile.kind === 'container') await exec('docker', ['rm', '--force', containerName], { timeout: 10_000 }).catch(error => { if (!String(error.stderr).includes('No such container')) throw error })
        await terminateCodingWorker(child)
      })()
      return stopping
    }
    const onData = (chunk: Buffer) => {
      receipt.outputBytes += chunk.length
      if (receipt.outputBytes > 64 * 1024 * 1024) { void stop('cancelled').catch(() => undefined); logError = new Error('Command output capacity exceeded'); return }
      output = output.then(() => appendFile(this.file(id, 'log'), chunk, { mode: 0o600 })).catch(error => { logError = error; void stop('cancelled').catch(() => undefined) })
    }
    child.stdout?.on('data', onData); child.stderr?.on('data', onData)
    let spawnError: Error | undefined, commandExit: number | null = null
    receipt.phase = plan.preparation ? 'preparation' : 'command'
    let timer = setTimeout(() => { void stop('timed_out').catch(() => undefined) }, plan.preparation?.timeoutMs ?? plan.timeoutMs)
    child.on('message', message => {
      if (!message || typeof message !== 'object' || !('type' in message) || !('code' in message)) return
      if (message.type === 'exit') commandExit = typeof message.code === 'number' ? message.code : null
      if (message.type === 'preparation') {
        receipt.preparationExitCode = typeof message.code === 'number' ? message.code : null
        if (message.code === 0 && !reason) {
          clearTimeout(timer)
          receipt.phase = 'command'
          timer = setTimeout(() => { void stop('timed_out').catch(() => undefined) }, plan.timeoutMs)
          void this.save(receipt).catch(error => { logError = error; void stop('cancelled').catch(() => undefined) })
        }
      }
    })
    child.on('error', error => { spawnError = error })
    const abort = () => { void stop('cancelled').catch(() => undefined) }
    signal?.addEventListener('abort', abort, { once: true })
    const done = new Promise<CodingCommandReceipt>((resolve, reject) => {
      child.once('close', code => {
        void (async () => {
          clearTimeout(timer); signal?.removeEventListener('abort', abort)
          let stopped = false
          try { await (stopping ?? terminateCodingWorker(child)); stopped = true; await output }
          catch (error) { logError = error }
          receipt.exitCode = reason ? null : commandExit
          receipt.status = logError ? 'unknown' : reason ?? (code === 0 && commandExit === 0 && !spawnError ? 'passed' : 'failed')
          if (spawnError || logError) receipt.error = String(spawnError ?? logError)
          if (stopped) await this.cleanupTemporary(receipt)
          else if (receipt.temporaryDirectory) { receipt.temporaryCleanupStatus = 'failed'; receipt.temporaryCleanupError = 'Worker termination not confirmed; temporary directory preserved for recovery' }
          receipt.completedAt = new Date().toISOString(); await this.save(receipt); this.active.delete(id)
          await this.activity?.(id, false); resolve(receipt)
        })().catch(reject)
      })
    })
    this.active.set(id, { child, done, stop })
    // The returned receipt follows the spawn-intent checkpoint. A crash in between is explicitly unknown.
    if (child.pid !== undefined) receipt.pid = child.pid
    try {
      receipt.status = 'running'; await this.save(receipt)
      await this.activity?.(id, true)
      if (signal?.aborted) abort()
      else child.send({ type: 'go', commands, cwd, env: environment, streamInput: Boolean(transport) })
    } catch (error) { await stop('cancelled'); await done; throw error }
    return structuredClone(receipt)
  }
  async wait(id: string): Promise<CodingCommandReceipt> {
    const active = this.active.get(id)
    if (active) return active.done
    const saved = await this.get(id); if (!saved) throw new Error('Command not found'); return saved
  }
  async read(id: string, offset = 0, limit = 16000, options: { waitMs?: number; signal?: AbortSignal } = {}): Promise<{ receipt: CodingCommandReceipt; output: string; nextOffset: number | null }> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 64_000) throw new Error('Invalid output page')
    const waitMs = options.waitMs ?? 0
    if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 30000) throw new Error('Invalid command read wait')
    options.signal?.throwIfAborted()
    const active = this.active.get(id)
    if (active && waitMs > 0) {
      // Keep waiting inside the host tool call rather than spending another
      // model turn to rediscover the same running process. This never restarts it.
      let timer: ReturnType<typeof setTimeout> | undefined
      let abort = () => {}
      try {
        await Promise.race([active.done, new Promise<void>((resolve, reject) => {
          timer = setTimeout(resolve, waitMs)
          abort = () => reject(options.signal?.reason ?? new DOMException('Command read interrupted', 'AbortError'))
          options.signal?.addEventListener('abort', abort, { once: true })
          if (options.signal?.aborted) abort()
        })])
      } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
    }
    options.signal?.throwIfAborted()
    const receipt = await this.get(id); if (!receipt) throw new Error('Command not found')
    const bytes = await readFile(this.file(id, 'log')).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.alloc(0); throw error })
    return { receipt, output: bytes.subarray(offset, offset + limit).toString('utf8'), nextOffset: offset + limit < bytes.length ? offset + limit : null }
  }
  async cancel(id: string): Promise<CodingCommandReceipt> {
    await this.starting.get(id)
    const active = this.active.get(id)
    if (active) { await active.stop('cancelled'); return active.done }
    const receipt = await this.get(id)
    if (!receipt) throw new Error('Command not found')
    // A persisted PID is not authority to kill. Recovery must authenticate an
    // orphaned worker before any new owner can stop it.
    if (['starting', 'running', 'unknown'].includes(receipt.status)) throw new Error('Command owner is unknown; reconcile before cancellation')
    return receipt
  }
  async cancelAll(): Promise<void> {
    await Promise.all([...this.starting.values()])
    const running = [...this.active.values()]
    await Promise.all(running.map(item => item.stop('cancelled')))
    await Promise.all(running.map(item => item.done))
  }
  get hasActiveCommands() { return this.active.size > 0 }
  isActive(id: string) { return this.active.has(id) || this.starting.has(id) }

  /** No replay. Stop only an authenticated old worker; preserve uncertainty if identity cannot be proved. */
  async reconcile(): Promise<boolean> {
    let files: string[]
    try { files = await readdir(this.root) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error }
    let safe = true
    for (const file of files.filter(value => /^[a-f0-9]{64}\.json$/u.test(value))) {
      const receipt = JSON.parse(await readFile(path.join(this.root, file), 'utf8')) as CodingCommandReceipt
      if (this.active.has(receipt.id)) continue
      if (!['starting', 'running', 'unknown'].includes(receipt.status)) {
        if (receipt.temporaryDirectory && receipt.temporaryCleanupStatus !== 'completed') { if (!await this.cleanupTemporary(receipt)) safe = false; await this.save(receipt) }
        continue
      }
      if (!receipt.pid) {
        if (!await this.cleanupTemporary(receipt)) safe = false
        receipt.status = 'failed'; receipt.error = 'Host stopped before the durable worker grant; command was not started'; await this.save(receipt); continue
      }
      try {
        let identity = ''
        // Cold PowerShell/CIM startup can exceed five seconds on Windows. This
        // bounded read only authenticates the old worker; it never grants work.
        if (process.platform === 'win32') identity = (await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId = ${receipt.pid}" -OperationTimeoutSec 5).CommandLine`], { timeout: 15000 })).stdout
        else identity = (await exec('ps', ['-p', String(receipt.pid), '-o', 'command='], { timeout: 5000 }).catch(error => { if (error.code === 1) return { stdout: '' }; throw error })).stdout
        if (identity.trim()) {
          if (!receipt.workerToken || !identity.includes(receipt.workerToken) || !identity.includes('command-worker.cjs')) { receipt.error = 'Recovery could not authenticate the recorded worker'; await this.save(receipt); safe = false; continue }
          if (process.platform === 'win32') await exec('taskkill', ['/PID', String(receipt.pid), '/T', '/F'], { timeout: 5000 }).catch(async error => { if (!await waitForWorkerExit(receipt.pid!, 0)) throw error })
          else { try { process.kill(-receipt.pid, 'SIGTERM') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }; await new Promise(resolve => setTimeout(resolve, 400)); try { process.kill(-receipt.pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error } }
        }
        if (receipt.plan.profile.kind === 'container') await exec('docker', ['rm', '--force', `devflow-${codingDigest(receipt.id).slice(0, 24)}`], { timeout: 10000 }).catch(error => { if (!String(error.stderr).includes('No such container')) throw error })
        if (!await waitForWorkerExit(receipt.pid)) { receipt.error = 'Recorded worker still exists after termination'; await this.save(receipt); safe = false; continue }
        if (!await this.cleanupTemporary(receipt)) safe = false
        receipt.status = 'cancelled'; receipt.exitCode = null; receipt.completedAt = new Date().toISOString(); receipt.error = 'Interrupted command stopped during recovery; no success is inferred'; await this.save(receipt)
      } catch (error) { receipt.error = `Worker recovery could not prove termination: ${error instanceof Error ? error.message : 'unknown error'}`; await this.save(receipt); safe = false }
    }
    return safe
  }
}
