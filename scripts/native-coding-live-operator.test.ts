// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { handleEvaluationChildControls, evaluationPermissionDecision } from './native-coding-live-operator'
import type { CodingOperationPermission } from '../apps/desktop/electron/native-coding-permissions'

it('authorizes only an explicitly enabled, current, exact-content test-input request', () => {
  const permission: CodingOperationPermission = { id: 'tests', operationId: 'propose', objectiveVersion: 1, kind: 'test_inputs', digest: 'a'.repeat(64), details: 'Exact update', decision: 'pending', expiresAt: new Date(Date.now() + 60000).toISOString() }
  const session = { objectiveVersion: 1, permissions: [permission] }
  expect(evaluationPermissionDecision('tests', session)).toBe('rejected')
  expect(evaluationPermissionDecision('other', session, 'approve_exact_content')).toBe('rejected')
  expect(evaluationPermissionDecision('tests', session, 'approve_exact_content')).toBe('approved')
  for (const kind of ['command', 'dependencies', 'network', 'mcp'] as const)
    expect(evaluationPermissionDecision('tests', { ...session, permissions: [{ ...permission, kind }] }, 'approve_exact_content')).toBe('rejected')
  expect(evaluationPermissionDecision('tests', { ...session, objectiveVersion: 2 }, 'approve_exact_content')).toBe('rejected')
  expect(evaluationPermissionDecision('tests', { ...session, permissions: [{ ...permission, decision: 'rejected' }] }, 'approve_exact_content')).toBe('rejected')
  expect(evaluationPermissionDecision('tests', { ...session, permissions: [{ ...permission, expiresAt: '2000-01-01' }] }, 'approve_exact_content')).toBe('rejected')
})

it('uses the isolated test-input policy on the addressed child and records its actual decision', async () => {
  const command = vi.fn(async () => undefined)
  const decidePermission = vi.fn(async () => 'approved' as const)
  await handleEvaluationChildControls({ children: [{ id: 'child-a', title: 'A', status: 'waiting_permission' }] }, {
    get: async () => ({ status: 'waiting_permission', permission: { id: 'tests', title: 'Update tests', details: '' } }),
    command, decidePermission,
  })
  expect(decidePermission).toHaveBeenCalledWith('tests', 'child-a')
  expect(command).toHaveBeenCalledWith({ type: 'permission', permissionId: 'tests', decision: 'approved' }, 'child-a')
})

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
