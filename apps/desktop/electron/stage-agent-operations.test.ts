import { expect, it } from 'vitest'
import { StageAgentOperations } from './stage-agent-operations'

it('isolates cancellation, rejects duplicate work, and releases a failed operation for explicit retry', async () => {
  const operations = new StageAgentOperations()
  const active = operations.run('run', 'node', (signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  await expect(operations.run('run', 'other', async () => 1)).rejects.toThrow('已有')
  expect(operations.cancel('other-run', 'node')).toBe(false)
  expect(operations.cancel('run', 'other-node')).toBe(false)
  expect(operations.cancel('run', 'node')).toBe(true)
  await expect(active).rejects.toThrow('已取消')
  await expect(operations.run('run', 'node', async () => 2)).resolves.toBe(2)
})

it('rejects cancellation once the atomic completion begins', async () => {
  const operations = new StageAgentOperations()
  await operations.run('run', 'node', async () => {
    operations.seal('run', 'node')
    expect(operations.cancel('run', 'node')).toBe(false)
  })
})

it('discards a cancelled operation even when its provider replies late', async () => {
  const operations = new StageAgentOperations()
  let release!: () => void
  const reply = new Promise<void>((resolve) => { release = resolve })
  let committed = false
  const pending = operations.run('run', 'node', async () => {
    await reply
    operations.seal('run', 'node')
    committed = true
  })
  expect(operations.cancel('run', 'node')).toBe(true)
  release()
  await expect(pending).rejects.toThrow('已取消')
  expect(committed).toBe(false)
})
