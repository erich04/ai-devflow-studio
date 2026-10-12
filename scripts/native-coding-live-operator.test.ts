// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { handleEvaluationChildControls } from './native-coding-live-operator'

it('rejects a child permission through that child, rather than leaving the parent waiting', async () => {
  const command = vi.fn(async () => undefined)
  const get = vi.fn(async () => ({ status: 'waiting_permission' as const, permission: { id: 'child-permission', title: 'Extra command', details: '' } }))
  expect(await handleEvaluationChildControls({ children: [{ id: 'child-a', title: 'A', status: 'waiting_permission' }] }, { get, command })).toEqual({ handled: true })
  expect(get).toHaveBeenCalledWith('child-a')
  expect(command).toHaveBeenCalledWith({ type: 'permission', permissionId: 'child-permission', decision: 'rejected' }, 'child-a')
})

it('ends a historical trial on an unanswered child question without inventing an answer', async () => {
  const command = vi.fn(async () => undefined)
  const result = await handleEvaluationChildControls({ children: [{ id: 'child-a', title: 'A', status: 'waiting_input' }] }, {
    get: async () => ({ status: 'waiting_input', question: { id: 'q', text: 'Business choice?', options: [] } }), command,
  })
  expect(result).toEqual({ handled: false, unansweredChild: 'child-a' })
  expect(command).not.toHaveBeenCalled()
})

it('rechecks live child state before responding and never approves a child revision on the parent behalf', async () => {
  const command = vi.fn(async () => undefined)
  const get = vi.fn(async () => ({ status: 'completed' as const }))
  expect(await handleEvaluationChildControls({ children: [{ id: 'child-a', title: 'A', status: 'waiting_permission' }, { id: 'child-b', title: 'B', status: 'review' }] }, { get, command })).toEqual({ handled: false })
  expect(get).toHaveBeenCalledTimes(1)
  expect(command).not.toHaveBeenCalled()
})
