// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createCodingModelContext } from './coding-model-context'

it('binds only the executing operation and releases it when the executor returns or throws', async () => {
  const context = createCodingModelContext()
  const verify = vi.fn(async () => {})
  await expect(context.assertCurrent()).rejects.toThrow(/执行上下文/)
  await context.run(verify, async () => { await context.assertCurrent() })
  expect(verify).toHaveBeenCalledOnce()
  await expect(context.assertCurrent()).rejects.toThrow(/执行上下文/)
  await expect(context.run(verify, async () => { throw new Error('executor failed') })).rejects.toThrow('executor failed')
  await expect(context.assertCurrent()).rejects.toThrow(/执行上下文/)
})

it('does not choose a guard from another concurrent operation or let absent guards dispatch', async () => {
  const context = createCodingModelContext()
  await context.run(async () => {}, async () => {
    await context.run(async () => {}, async () => {
      await expect(context.assertCurrent()).rejects.toThrow(/执行上下文/)
    })
    await expect(context.assertCurrent()).resolves.toBeUndefined()
  })
  await context.run(undefined, async () => {
    await expect(context.assertCurrent()).rejects.toThrow(/执行上下文/)
  })
})
