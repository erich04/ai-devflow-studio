// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createBudgetContinuationPrompts, describeBudgetContinuation } from './model-budget-continuation'
import { budgetContinuationFixture } from '../src/testing/budget-continuation-fixture'
it('requires explicit consent in the same identity/version and coalesces double confirmation', async () => {
  const prompts = createBudgetContinuationPrompts(vi.fn())
  const card = budgetContinuationFixture()
  let finish!: () => void
  const confirm = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const waiting = prompts.wait(card, 'scope', confirm)
  expect(confirm).not.toHaveBeenCalled()
  await expect(prompts.respond({ id: card.id, expectedVersion: card.version, confirmed: true }, 'other')).rejects.toThrow('身份')
  await expect(prompts.respond({ id: card.id, expectedVersion: 'stale', confirmed: true }, 'scope')).rejects.toThrow('身份')
  const response = { id: card.id, expectedVersion: card.version, confirmed: true }
  const first = prompts.respond(response, 'scope')
  await prompts.respond(response, 'scope')
  expect(confirm).toHaveBeenCalledTimes(1)
  finish(); await first
  expect(await waiting).toBe(card.id)
  expect(prompts.accepted('scope', card.operation.id)).toBe(card.id)
  expect(prompts.accepted('other', card.operation.id)).toBeUndefined()
  expect(prompts.accepted('scope', 'next-operation')).toBeUndefined()
  expect(createBudgetContinuationPrompts(vi.fn()).list()).toEqual([])
})
it('does not release a waiting model call if cancelled while server confirmation is in flight', async () => {
  const prompts = createBudgetContinuationPrompts(vi.fn())
  const card = budgetContinuationFixture(); const controller = new AbortController()
  let finish!: () => void
  const waiting = prompts.wait(card, 'scope', () => new Promise<void>(resolve => { finish = resolve }), controller.signal).catch(error => error)
  const response = prompts.respond({ id: card.id, expectedVersion: card.version, confirmed: true }, 'scope')
  controller.abort(); finish(); await response
  expect(await waiting).toBeInstanceOf(Error)
  expect(prompts.list()).toEqual([])
  expect(prompts.accepted('scope', card.operation.id)).toBeUndefined()
})
it('expires without contacting the server or approving a future operation', async () => {
  vi.useFakeTimers()
  try {
    const prompts = createBudgetContinuationPrompts(vi.fn()); const card = budgetContinuationFixture(); const confirm = vi.fn()
    const waiting = prompts.wait(card, 'scope', confirm).catch(error => error)
    await vi.advanceTimersByTimeAsync(60001)
    expect((await waiting).message).toContain('过期')
    expect(confirm).not.toHaveBeenCalled(); expect(prompts.list()).toEqual([])
  } finally { vi.useRealTimers() }
})

it('uses only the matching final answer for the local card and never treats reasoning as an answer', () => {
  const card=budgetContinuationFixture()
  const base={id:'chat',localProjectId:'local',version:1,title:'方案修订',isOpen:true,inputDraft:'',status:'running' as const,createdAt:card.createdAt,updatedAt:card.createdAt}
  const call={id:'call',role:'notice' as const,text:'模型调用',createdAt:card.createdAt,usage:{budgetAttemptIds:['unknown-call']},reasoning:{text:'PRIVATE_REASONING',status:'interrupted' as const}}
  const without=describeBudgetContinuation(card,[{...base,messages:[call]}])
  expect(without.records[0]?.result).toContain('未收到完整答复')
  expect(JSON.stringify(without)).not.toContain('PRIVATE_REASONING')
  const withAnswer=describeBudgetContinuation(card,[{...base,messages:[call,{id:'answer',role:'assistant',text:'完成的方案答复',createdAt:card.createdAt}]}])
  expect(withAnswer.records[0]?.result).toBe('完成的方案答复')
  const later=describeBudgetContinuation(card,[{...base,messages:[call,{...call,id:'next',usage:{budgetAttemptIds:['next-call']}},{id:'answer',role:'assistant',text:'另一次调用的结果',createdAt:card.createdAt}]}])
  expect(later.records[0]?.result).not.toContain('另一次')
})
