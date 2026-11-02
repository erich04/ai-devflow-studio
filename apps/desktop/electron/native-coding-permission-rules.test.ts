// @vitest-environment node
import { rm } from 'node:fs/promises'
import { afterEach, expect, it } from 'vitest'
import { codingHarnessFixture, codingToolReply } from './native-coding-test-fixture'
import { mutateNativeCodingSession } from './native-coding-session'
import { CodingPermissionWait, requireCodingPermission } from './native-coding-permissions'
import type { CodingPermissionPolicy } from '@ai-devflow/shared'
import { createLocalStore } from './local-store'
import path from 'node:path'

const fixtures: Awaited<ReturnType<typeof codingHarnessFixture>>[] = []
afterEach(async () => { for (const f of fixtures.splice(0)) { await f.store.close(); await rm(f.root, { recursive: true, force: true }) } })
async function fixture(policy: CodingPermissionPolicy = { version: 1, mode: 'ask', rules: [] }) {
  const f = await codingHarnessFixture(async () => codingToolReply('stop', 'report_blocked', { reason: 'test' })); fixtures.push(f)
  await f.executor.shutdown()
  await mutateNativeCodingSession(f.store, 'native-coding', s => { s.binding!.permissionPolicy = policy; s.binding!.executionGranted = true; s.status = 'running'; s.binding!.profile = { kind: 'container', image: `runtime@sha256:${'a'.repeat(64)}`, network: 'none' } })
  const invoke = (id: string, executable = 'git', args = ['status']) => requireCodingPermission(f.store, 'native-coding', { id, kind: 'command', value: { executable, args }, details: 'test command' })
  return Object.assign(f, { invoke })
}
it('a one-operation approval cannot authorize a second call with identical arguments', async () => {
  const f = await fixture()
  await expect(f.invoke('one')).rejects.toBeInstanceOf(CodingPermissionWait)
  await mutateNativeCodingSession(f.store, 'native-coding', s => { s.permissions[0]!.decision = 'approved'; s.status = 'running' })
  await f.invoke('one')
  await expect(f.invoke('two')).rejects.toBeInstanceOf(CodingPermissionWait)
  expect((await f.store.getNativeCodingSession('native-coding'))!.permissions).toHaveLength(2)
})
it('an explicit task grant survives SQLite reopen but expires on a changed objective', async () => {
  const f = await fixture()
  await expect(f.invoke('one')).rejects.toBeInstanceOf(CodingPermissionWait)
  await mutateNativeCodingSession(f.store, 'native-coding', s => { Object.assign(s.permissions[0]!, { decision: 'approved', scope: 'task' }); s.status = 'running' })
  await f.store.close(); f.store = await createLocalStore({ dbPath: path.join(f.root, 'local.sqlite') })
  await f.invoke('two')
  await mutateNativeCodingSession(f.store, 'native-coding', s => { s.objectiveVersion++; s.objective += ' new scope' })
  await expect(f.invoke('three')).rejects.toBeInstanceOf(CodingPermissionWait)
})
it('records rule decisions and rejects unknown unattended operations without waiting for a card', async () => {
  const f = await fixture({ version: 1, mode: 'unattended', rules: [{ prefix: ['git', 'status'], decision: 'allow' }, { prefix: ['git', 'push'], decision: 'deny' }] })
  await f.invoke('read')
  await expect(f.invoke('deny', 'git', ['push'])).rejects.toThrow(/rule/i)
  await expect(f.invoke('unknown', 'node', ['-e', '42'])).rejects.toThrow(/rule/i)
  const state = (await f.store.getNativeCodingSession('native-coding'))!
  expect(state.status).toBe('running')
  expect(state.permissions.map(p => p.decision)).toEqual(['approved', 'rejected', 'rejected'])
})
it('does not allow policy mutation after execution has been granted', async () => {
  const f = await fixture()
  await expect(mutateNativeCodingSession(f.store, 'native-coding', s => { s.binding!.permissionPolicy!.mode = 'unattended' })).rejects.toThrow(/immutable/)
})
