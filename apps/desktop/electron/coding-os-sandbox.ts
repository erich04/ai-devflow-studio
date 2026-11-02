import { execFile } from 'node:child_process'
import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { promisify } from 'node:util'
import path from 'node:path'
import { codingDigest } from './coding-candidate-workspace'

type Command = { executable: string; args: string[] }
type Backend = 'seatbelt' | 'bubblewrap' | 'landlock'
export type CodingSandboxInput = Command & { cwd: string; temporaryDirectory: string; network: 'none' | 'enabled'; platform?: NodeJS.Platform; linuxBackend?: 'bubblewrap' | 'landlock' | undefined }
const exec = promisify(execFile)
const helperPath = () => path.join(import.meta.dirname, '..', 'dist-electron', 'native', 'coding-linux-sandbox')
const runnable = async (file: string) => { try { await access(file, constants.X_OK); return true } catch { return false } }
const sb = (value: string) => JSON.stringify(value)
async function canonical(directory: string): Promise<string> {
  if (!path.isAbsolute(directory) || /[\x00-\x1f]/u.test(directory)) throw new Error('Invalid sandbox root')
  const result = await realpath(directory)
  if (result === path.parse(result).root || !(await stat(result)).isDirectory()) throw new Error('Invalid sandbox root')
  return result
}
async function readableRoots(platform: NodeJS.Platform, executable: string): Promise<string[]> {
  const system = platform === 'darwin' ? ['/usr', '/bin', '/sbin', '/System/Library', '/System/Cryptexes', '/System/Volumes/Preboot/Cryptexes', '/Library/Apple', '/Library/Frameworks', '/Library/Developer', '/opt/homebrew'] : ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/opt']
  system.push('/etc/ssl', '/etc/pki', '/etc/ld.so.cache', '/etc/ld.so.conf', '/etc/ld.so.conf.d', '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/passwd', '/etc/group', '/etc/localtime', '/etc/os-release')
  const roots: string[] = []
  for (const entry of system) { try { roots.push(entry, await realpath(entry)) } catch {} }
  // Only this binary is added for a host-installed tool outside system roots.
  // Its containing user directory is never made visible.
  if (path.isAbsolute(executable)) { try { roots.push(await realpath(executable)) } catch {} }
  return [...new Set(roots)]
}

/** Restrict reads as well as writes: host transcripts, frozen checks and credentials stay outside C/V. */
export function codingSeatbeltPolicy(readable: string[], writable: string[], network: 'none' | 'enabled'): string {
  const forms = ['(version 1)', '(deny default)', '(allow process-exec process-fork)', '(allow signal (target same-sandbox))',
    '(allow process-info* (target same-sandbox))', '(allow sysctl-read)', '(allow file-read-metadata)',
    `(allow file-read* (literal "/") ${[...readable, ...writable].map(root => `(subpath ${sb(root)})`).join(' ')})`,
    '(allow file-read* (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))',
    '(allow file-write-data (literal "/dev/null"))', `(allow file-write* ${writable.map(root => `(subpath ${sb(root)})`).join(' ')})`]
  if (network === 'enabled') forms.push('(allow network-bind (local ip "*:*"))', '(allow network-inbound (local ip "*:*"))', '(allow network-outbound (remote ip "*:*"))',
    '(allow mach-lookup (global-name "com.apple.SystemConfiguration.DNSConfiguration") (global-name "com.apple.SystemConfiguration.configd"))')
  return forms.join('\n')
}

export async function codingSandboxAvailability(): Promise<{ available: boolean; reason: string }> {
  const available = process.platform === 'darwin' ? await runnable('/usr/bin/sandbox-exec')
    : process.platform === 'linux' && (await runnable('/usr/bin/bwrap') || await runnable('/bin/bwrap') || await runnable(helperPath()))
  return { available, reason: available ? '仅可写本任务工作区和私有临时目录；宿主私有资料不可读，默认断网。启动时核验系统隔离，失败就停止。' : '本机系统沙箱不可用；不会自动改用无沙箱执行。请配置受管容器，或明确选择本机可信执行。' }
}

/** Probe before dispatch. Falling back after the real command starts would replay side effects. */
export async function prepareCodingSandbox(input: CodingSandboxInput): Promise<Command & { backend: Backend; policyDigest: string }> {
  const platform = input.platform ?? process.platform
  if (!['darwin', 'linux'].includes(platform)) throw new Error('OS sandbox unavailable on this platform; no unconfined fallback')
  const cwd = await canonical(input.cwd), temporaryDirectory = await canonical(input.temporaryDirectory)
  const readonly = await readableRoots(platform, input.executable), writable = [cwd, temporaryDirectory]
  if (readonly.some(root => cwd === root || cwd.startsWith(`${root}/`) || temporaryDirectory === root || temporaryDirectory.startsWith(`${root}/`))) throw new Error('OS sandbox unavailable: task directories must not overlap system read roots')
  const digest = codingDigest(JSON.stringify({ platform, readonly, writable, network: input.network }))
  const wrap = (backend: Backend, executable: string, prefix: string[]): Command & { backend: Backend; policyDigest: string } => ({ executable, args: [...prefix, input.executable, ...input.args], backend, policyDigest: digest })
  const probe = async (command: Command) => { await exec(command.executable, command.args, { cwd, timeout: 5000, maxBuffer: 8192, env: { PATH: process.env.PATH, HOME: temporaryDirectory, TMPDIR: temporaryDirectory } }) }
  if (platform === 'darwin') {
    const prefix = ['-p', codingSeatbeltPolicy(readonly, writable, input.network)]
    try { await probe({ executable: '/usr/bin/sandbox-exec', args: [...prefix, '/usr/bin/true'] }) }
    catch { throw new Error('OS sandbox unavailable: macOS Seatbelt could not enforce the policy; no unconfined fallback') }
    return wrap('seatbelt', '/usr/bin/sandbox-exec', prefix)
  }
  if (input.linuxBackend !== 'landlock') {
    const bwrap = await runnable('/usr/bin/bwrap') ? '/usr/bin/bwrap' : '/bin/bwrap'
    const prefix = ['--die-with-parent', '--new-session', '--unshare-all', '--unshare-user', '--disable-userns', ...(input.network === 'enabled' ? ['--share-net'] : []), '--cap-drop', 'ALL', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp']
    for (const root of readonly) prefix.push('--ro-bind', root, root)
    for (const root of writable) prefix.push('--bind', root, root)
    // Sharing the network namespace also exposes host abstract Unix sockets.
    // Keep the same socket-family and syscall restrictions as the fallback.
    if (input.network === 'enabled') prefix.push('--ro-bind', helperPath(), helperPath())
    // Parent directories are synthetic namespace storage, but still outside the
    // task's two writable roots. Remounting a parent leaves child bind mounts RW.
    prefix.push('--remount-ro', '/tmp', '--remount-ro', '/', '--chdir', cwd, '--')
    if (input.network === 'enabled') prefix.push(helperPath(), '--network=enabled', ...readonly.flatMap(root => ['--ro', root]), ...writable.flatMap(root => ['--rw', root]), '--')
    try { await probe({ executable: bwrap, args: [...prefix, '/usr/bin/true'] }); return wrap('bubblewrap', bwrap, prefix) }
    catch { if (input.linuxBackend === 'bubblewrap') throw new Error('OS sandbox unavailable: bubblewrap could not enforce the policy') }
  }
  const prefix = [`--network=${input.network}`, ...readonly.flatMap(root => ['--ro', root]), ...writable.flatMap(root => ['--rw', root]), '--']
  try { await probe({ executable: helperPath(), args: [...prefix, '/usr/bin/true'] }) }
  catch { throw new Error('OS sandbox unavailable: bubblewrap and the packaged Landlock/seccomp helper could not enforce the policy; no unconfined fallback') }
  return wrap('landlock', helperPath(), prefix)
}
