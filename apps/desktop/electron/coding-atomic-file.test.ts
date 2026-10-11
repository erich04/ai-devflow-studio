// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { atomicCodingFile } from './coding-candidate-workspace'

const { beforeRename } = vi.hoisted(() => ({ beforeRename: vi.fn() }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: async (...args: Parameters<typeof actual.rename>) => { await beforeRename(...args); return actual.rename(...args) } }
})

it('retries a Windows sharing violation without exposing a missing or partial receipt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-atomic-'))
  const file = path.join(root, 'receipt.json'), platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  await writeFile(file, 'old valid receipt')
  beforeRename.mockReset()
  const occupied = async () => {
    expect(await readFile(file, 'utf8')).toBe('old valid receipt')
    throw Object.assign(new Error('File is temporarily shared'), { code: 'EPERM' })
  }
  beforeRename.mockImplementationOnce(occupied).mockImplementationOnce(occupied)
  Object.defineProperty(process, 'platform', { value: 'win32' })
  try {
    await atomicCodingFile(file, Buffer.from('new valid receipt'))
    expect(await readFile(file, 'utf8')).toBe('new valid receipt')
    expect(await readdir(root)).toEqual(['receipt.json'])
  } finally { Object.defineProperty(process, 'platform', platform); beforeRename.mockReset(); await rm(root, { recursive: true, force: true }) }
})

it('fails a permanent Windows replacement denial while retaining the original receipt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-atomic-denied-'))
  const file = path.join(root, 'receipt.json'), platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  await writeFile(file, 'old valid receipt')
  beforeRename.mockReset().mockRejectedValue(Object.assign(new Error('Replacement denied'), { code: 'EPERM' }))
  Object.defineProperty(process, 'platform', { value: 'win32' })
  try {
    await expect(atomicCodingFile(file, Buffer.from('new receipt'))).rejects.toMatchObject({ code: 'EPERM' })
    expect(await readFile(file, 'utf8')).toBe('old valid receipt')
    expect(await readdir(root)).toEqual(['receipt.json'])
  } finally { Object.defineProperty(process, 'platform', platform); beforeRename.mockReset(); await rm(root, { recursive: true, force: true }) }
})
