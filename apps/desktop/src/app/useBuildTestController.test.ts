import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DevFlowDesktopApi } from '../desktop-api'
import { addChange, addCoding, buildTestFacts } from '../testing/build-test-fixtures'
import { useBuildTestController, type BuildTestBaseFacts } from './useBuildTestController'
import { projectBuildTestDecision } from './build-test/projection'
afterEach(cleanup)
const setup = (base: BuildTestBaseFacts, api: DevFlowDesktopApi) => ({ base, api, requestedBy: 'user', otherWriteBusy: false, runtimeBudgetApprovalId: '', applyState: vi.fn(), reloadReadiness: vi.fn(), reloadFreshness: vi.fn(), selectNode: vi.fn() })
it('rejects a stale displayed approval even after the successor history finishes loading', async () => {
  const f = buildTestFacts(), r = addCoding(f), p = addChange(f, r)
  const replyCodingPermission = vi.fn(), getCodingChangeHistory = vi.fn(async () => structuredClone(f.history!))
  // Only these API ports are exercised; unexpected mutations remain absent.
  const api = { getCodingChangeHistory, replyCodingPermission } as unknown as DevFlowDesktopApi
  const { result, rerender } = renderHook(({ base }) => useBuildTestController(setup(base, api)), { initialProps: { base: f } })
  await waitFor(() => expect(result.current.facts?.history).toBeDefined())
  const displayed = projectBuildTestDecision({ facts: result.current.facts!, stage: 'build' })
  expect(displayed.bar.buttons.find(b => b.id === 'approveChange')?.enabled).toBe(true)
  p.status = 'superseded'; addChange(f, r); rerender({ base: { ...f } })
  await waitFor(() => expect(result.current.facts?.history?.changeSets).toHaveLength(2))
  await act(async () => { expect(await result.current.dispatch('approveChange', displayed)).toBe(false) })
  expect(replyCodingPermission).not.toHaveBeenCalled()
})
it('does not project another task pending test or late error into the selected task', async () => {
  const a = buildTestFacts(); a.run.currentNodeId = a.testNode.id; a.testCommand = 'node --test'
  const b = buildTestFacts(); b.run.id = 'other'; b.run.currentNodeId = b.testNode.id; b.testCommand = 'node --test'
  let fail!: (error: Error) => void
  const runProjectTests = vi.fn(() => new Promise((_resolve, reject) => { fail = reject }))
  const api = { runProjectTests } as unknown as DevFlowDesktopApi
  const { result, rerender } = renderHook(({ base }) => useBuildTestController(setup(base, api)), { initialProps: { base: a } })
  let pending!: Promise<boolean>
  act(() => { pending = result.current.dispatch('runTests', projectBuildTestDecision({ facts: result.current.facts!, stage: 'test' })) })
  expect(runProjectTests).toHaveBeenCalledOnce()
  rerender({ base: b })
  expect(projectBuildTestDecision({ facts: result.current.facts!, stage: 'test' }).bar.row).toBe('T11')
  await act(async () => { fail(new Error('A-only workspace failure')); await pending })
  expect(result.current.facts?.writeResult).toBeUndefined()
  expect(result.current.facts?.writes).toEqual([])
})
