// @vitest-environment node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareCodingSandbox } from './coding-os-sandbox'

const roots: string[] = [], exec = promisify(execFile)
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'devflow-os-sandbox-')); roots.push(root)
  const cwd = path.join(root, 'workspace'), temporaryDirectory = path.join(root, 'temporary')
  await mkdir(cwd); await mkdir(temporaryDirectory)
  const secret = path.join(root, 'host-private.txt'); await writeFile(secret, 'synthetic-host-private-data')
  return { root, cwd, temporaryDirectory, secret }
}
const supported = process.platform === 'darwin' || process.platform === 'linux'
it.runIf(process.platform === 'darwin' && process.env.DEVFLOW_REQUIRE_PUBLIC_DNS === '1')('permits the OS DNS resolver only with explicit network authorization', async () => {
  const f = await fixture()
  const script = 'require("dns").lookup("registry.npmjs.org",(e)=>{console.log(e?"denied":"resolved")})'
  for (const network of ['none', 'enabled'] as const) {
    const command = await prepareCodingSandbox({ ...f, executable: process.execPath, args: ['-e', script], network })
    expect((await exec(command.executable, command.args, { cwd: f.cwd, timeout: 10000 })).stdout.trim()).toBe(network === 'enabled' ? 'resolved' : 'denied')
  }
})
const backends = process.platform === 'linux' ? [undefined, 'landlock' as const, ...(process.env.DEVFLOW_REQUIRE_BUBBLEWRAP === '1' ? ['bubblewrap' as const] : [])] : [undefined]
it.runIf(supported)('runs a shell package-manager child from a private Node installation without exposing adjacent private files', async () => {
  const f = await fixture(), bin = path.join(f.root, 'host-toolchain', 'bin')
  await mkdir(bin, { recursive: true }); await copyFile(process.execPath, path.join(bin, 'node'))
  // Homebrew Node uses a sibling libnode; keep that existing system runtime
  // accessible so this fixture isolates executable permissions, not linking.
  const installed = await realpath(process.execPath)
  if (installed.startsWith('/opt/homebrew/')) await symlink(path.join(path.dirname(path.dirname(installed)), 'lib'), path.join(bin, '..', 'lib'))
  const npm = path.join(f.root, 'node-packages', 'npm')
  await mkdir(path.join(npm, 'bin'), { recursive: true })
  await writeFile(path.join(npm, 'package.json'), JSON.stringify({ name: 'npm' }))
  await writeFile(path.join(npm, 'bin', 'npm-cli.js'), `#!/usr/bin/env node\nrequire('../entry.cjs')\n`, { mode: 0o755 })
  await writeFile(path.join(npm, 'entry.cjs'), `const fs=require('fs'); require('assert/strict').throws(()=>fs.readFileSync(${JSON.stringify(f.secret)})); console.log('private runtime works')`)
  await symlink(path.join(npm, 'bin', 'npm-cli.js'), path.join(bin, 'npm'))
  const previous = process.env.PATH
  try {
    process.env.PATH = `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin`
    const command = await prepareCodingSandbox({ ...f, executable: '/bin/sh', args: ['-c', 'exec npm'], network: 'none' })
    expect((await exec(command.executable, command.args, { cwd: f.cwd, env: { PATH: process.env.PATH }, timeout: 10000 })).stdout).toContain('private runtime works')
  } finally { process.env.PATH = previous }
})
describe.each(backends)('sandbox backend %s', linuxBackend => {
it.runIf(supported)('allows workspace edits while rejecting outside writes, symlink escapes and private host reads', async () => {
  const f = await fixture(); await symlink(f.root, path.join(f.cwd, 'escape'))
  const command = await prepareCodingSandbox({ ...f, executable: process.execPath, args: ['-e', `
    const fs = require('fs'), assert = require('assert/strict');
    fs.writeFileSync('inside.txt', 'allowed');
    for (const p of ${JSON.stringify([f.secret, path.join(f.root, 'outside.txt'), path.join(f.cwd, 'escape/outside-link.txt')])}) {
      assert.throws(() => fs.writeFileSync(p, 'forbidden'), /EPERM|EACCES|EROFS/);
    }
    assert.throws(() => fs.readFileSync(${JSON.stringify(f.secret)}), /EPERM|EACCES|ENOENT/);
    assert.throws(() => fs.linkSync(${JSON.stringify(f.secret)}, 'hardlink-escape'), /EPERM|EACCES|ENOENT|EXDEV/);
    console.log('filesystem confined');
  `], network: 'none', linuxBackend })
  const result = await exec(command.executable, command.args, { cwd: f.cwd, timeout: 10000 })
  expect(result.stdout).toContain('filesystem confined')
  expect(await readFile(path.join(f.cwd, 'inside.txt'), 'utf8')).toBe('allowed')
  expect(await readFile(f.secret, 'utf8')).toBe('synthetic-host-private-data')
})

it.runIf(supported)('denies real TCP access by default, including subprocesses, and allows it only for an explicit network profile', async () => {
  const f = await fixture(), server = createServer(socket => socket.end('ok'))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const script = `const net=require('net'); const socket=net.connect(${port},'127.0.0.1');socket.on('connect',()=>{console.log('connected');socket.end()});socket.on('error',()=>console.log('denied'));setTimeout(()=>process.exit(2),3000).unref()`
  try {
    const blocked = await prepareCodingSandbox({ ...f, executable: process.execPath, args: ['-e', `const {spawnSync}=require('child_process'); const r=spawnSync(process.execPath,['-e',${JSON.stringify(script)}],{encoding:'utf8'});if(r.error)throw r.error;process.stdout.write(r.stdout);process.exit(r.status??1)`], network: 'none', linuxBackend })
    expect((await exec(blocked.executable, blocked.args, { cwd: f.cwd, timeout: 10000 })).stdout).toContain('denied')
    const allowed = await prepareCodingSandbox({ ...f, executable: process.execPath, args: ['-e', script], network: 'enabled', linuxBackend })
    expect((await exec(allowed.executable, allowed.args, { cwd: f.cwd, timeout: 10000 })).stdout).toContain('connected')
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
it.runIf(supported)('does not expose host Unix sockets even when IP networking is authorized', async () => {
  const f = await fixture(), socketPath = path.join(f.root, 'host.sock'), server = createServer(socket => socket.end('host'))
  await new Promise<void>(resolve => server.listen(socketPath, resolve))
  try {
    const command = await prepareCodingSandbox({ ...f, executable: process.execPath, args: ['-e', `const s=require('net').connect(${JSON.stringify(socketPath)});s.on('connect',()=>process.exit(1));s.on('error',()=>console.log('denied'))`], network: 'enabled', linuxBackend })
    expect((await exec(command.executable, command.args, { cwd: f.cwd, timeout: 10000 })).stdout).toContain('denied')
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
it.runIf(process.platform === 'linux')('does not expose host abstract Unix sockets when sharing IP networking', async () => {
  const f = await fixture(), socketPath = `\0devflow-${path.basename(f.root)}`, server = createServer(socket => socket.end('host'))
  await new Promise<void>(resolve => server.listen(socketPath, resolve))
  try {
    const command = await prepareCodingSandbox({ ...f, executable: process.execPath, args: ['-e', `const s=require('net').connect(${JSON.stringify(socketPath)});s.on('connect',()=>process.exit(1));s.on('error',()=>console.log('denied'))`], network: 'enabled', linuxBackend })
    expect((await exec(command.executable, command.args, { cwd: f.cwd, timeout: 10000 })).stdout).toContain('denied')
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
})

it('never returns an unconfined command on an unsupported platform', async () => {
  const f = await fixture()
  await expect(prepareCodingSandbox({ ...f, executable: process.execPath, args: ['-e', 'process.exit(0)'], network: 'none', platform: 'win32' })).rejects.toThrow(/unavailable/i)
})

it.runIf(process.platform === 'linux')('Landlock stdio pairs cannot be retargeted to a host Unix service', async () => {
  const f = await fixture(), socketPath = path.join(f.root, 'host.sock'), server = createServer(socket => socket.end('host'))
  await new Promise<void>(resolve => server.listen(socketPath, resolve))
  try {
    const source = path.join(f.cwd, 'probe.c'), binary = path.join(f.cwd, 'probe')
    await writeFile(source, `#include <assert.h>
#include <errno.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/syscall.h>
#include <unistd.h>
int main(int argc, char **argv) {
  assert(argc == 2); int p[2];
  assert(syscall(452, -100, argv[1], 0777, 0) == -1 && errno == ENOSYS);
  assert(socket(AF_UNIX, SOCK_STREAM, 0) == -1 && errno == EPERM);
  assert(socketpair(AF_UNIX, SOCK_DGRAM, 0, p) == -1 && errno == EPERM);
  assert(socketpair(AF_UNIX, SOCK_SEQPACKET, 0, p) == -1 && errno == EPERM);
  assert(socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, p) == 0);
  struct sockaddr_un address = {.sun_family = AF_UNIX};
  assert(strlen(argv[1]) < sizeof address.sun_path); strcpy(address.sun_path, argv[1]);
  assert(connect(p[0], (struct sockaddr *)&address, sizeof address) == -1);
  assert(sendto(p[0], "x", 1, MSG_NOSIGNAL, (struct sockaddr *)&address, sizeof address) == -1);
  close(p[1]);
  assert(connect(p[0], (struct sockaddr *)&address, sizeof address) == -1);
  shutdown(p[0], SHUT_RDWR);
  assert(connect(p[0], (struct sockaddr *)&address, sizeof address) == -1);
  close(p[0]); return 0;
}`)
    await exec('cc', ['-Wall', '-Wextra', '-Werror', source, '-o', binary])
    const command = await prepareCodingSandbox({ ...f, executable: binary, args: [socketPath], network: 'enabled', linuxBackend: 'landlock' })
    await exec(command.executable, command.args, { cwd: f.cwd, timeout: 10000 })
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
