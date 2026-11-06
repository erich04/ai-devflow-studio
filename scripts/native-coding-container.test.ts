// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { CodingCommandRunner } from '../apps/desktop/electron/coding-command-runner'
import { codingDigest } from '../apps/desktop/electron/coding-candidate-workspace'

const image = process.env['DEVFLOW_NATIVE_CONTAINER_TEST_IMAGE']
it.skipIf(!image)('runs and cancels an actual pinned container without mounting host data or falling back locally', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-container-'))
  const { mkdir } = await import('node:fs/promises')
  const candidate = path.join(root, 'candidate'); await mkdir(candidate)
  const outside = path.join(root, 'host-only'); await writeFile(outside, 'private fixture')
  const runner = new CodingCommandRunner(path.join(root, 'receipts'))
  try {
    await runner.start('container', { executable: '/bin/sh', args: ['-c', `test ! -e '${outside}' && test ! -e /var/run/docker.sock && printf verified > result.txt`], timeoutMs: 30000, profile: { kind: 'container', image: image!, network: 'none' } }, candidate)
    expect((await runner.wait('container')).status).toBe('passed')
    expect(await readFile(path.join(candidate, 'result.txt'), 'utf8')).toBe('verified')
    expect(await readFile(outside, 'utf8')).toBe('private fixture')
    await runner.start('container-cancel', { executable: '/bin/sh', args: ['-c', 'sleep 30'], timeoutMs: 60000, profile: { kind: 'container', image: image!, network: 'none' } }, candidate)
    await new Promise(resolve => setTimeout(resolve, 1000))
    await runner.cancelAll()
    expect((await runner.wait('container-cancel')).status).toBe('cancelled')
    await expect(promisify(execFile)('docker', ['inspect', `devflow-${codingDigest('container-cancel').slice(0, 24)}`])).rejects.toThrow()
    await expect(runner.start('missing-image', { executable: '/bin/sh', args: ['-c', 'touch must-not-exist'], timeoutMs: 10000, profile: { kind: 'container', image: `devflow-unavailable@sha256:${'0'.repeat(64)}`, network: 'none' } }, candidate)).rejects.toThrow()
    await expect(readFile(path.join(candidate, 'must-not-exist'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await runner.cancelAll(); await rm(root, { recursive: true, force: true }) }
}, 60000)
