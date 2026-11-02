// @vitest-environment node
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { codingHarnessFixture, codingToolReply } from './native-coding-test-fixture'
import { CodingCandidateWorkspace } from './coding-candidate-workspace'
import type { CodingHarnessCommand } from '@ai-devflow/shared'

it.runIf(process.platform !== 'win32').each(['allowed', 'denied'] as const)('applies %s rules to actual sandbox commands without an unattended prompt', async outcome => {
  let turn = 0
  const args = outcome === 'allowed' ? ['--version'] : ['-e', 'require("fs").writeFileSync("should-not-exist","x")']
  const f = await codingHarnessFixture(async () => {
    if (++turn === 1) return codingToolReply('command', 'run_command', { executable: process.execPath, args, timeoutMs: 5000 })
    if (turn === 2 && outcome === 'allowed') return codingToolReply('wait', 'read_command', { id: 'native-coding:command', waitMs: 5000 })
    return codingToolReply('stop', 'report_blocked', { reason: 'test finished' })
  }, undefined, {}, undefined, { commandRules: [{ prefix: [process.execPath], decision: 'allow' }] })
  try {
    await f.authorize({ profile: 'os_sandbox', permissionMode: 'unattended' }); await f.executor.settled('coding')
    const view = (await f.get()).snapshot, session = (await f.store.getNativeCodingSession('native-coding'))!
    expect(view.status).toBe('paused')
    expect(view.permissionPolicy).toMatchObject({ mode: 'unattended', humanPrompts: 0, automaticDecisions: 1 })
    expect(session.permissions[0]).toMatchObject({ decision: outcome === 'allowed' ? 'approved' : 'rejected', source: 'rule' })
    if (outcome === 'allowed') expect(session.toolReceipts.find(r => r.name === 'read_command')?.result).toMatchObject({ receipt: { status: 'passed' } })
    else {
      const workspace = await CodingCandidateWorkspace.open(session.binding!.workspaceRoot)
      await expect(readFile(path.join(workspace.candidatePath, 'should-not-exist'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  } finally { await f.executor.shutdown(); await f.store.close(); await rm(f.root, { recursive: true, force: true }) }
})

it('executes each one-off command only after approval, then reuses an explicit task grant', async () => {
  let turn = 0
  const command = { executable: process.execPath, args: ['-e', 'require("fs").appendFileSync("permission-count.txt","x")'], timeoutMs: 5000 }
  const f = await codingHarnessFixture(async () => {
    turn++
    if (turn <= 6) return turn % 2 ? codingToolReply(`run-${turn}`, 'run_command', command) : codingToolReply(`wait-${turn}`, 'read_command', { id: `native-coding:run-${turn - 1}`, waitMs: 5000 })
    return codingToolReply('stop', 'report_blocked', { reason: 'Finished permission lifecycle fixture' })
  })
  const send = async (value: object) => f.executor.harness!.command({ protocolVersion: 2, codingRunId: 'coding', commandId: `human-${turn}`, expectedVersion: (await f.get()).snapshot.version, ...value } as CodingHarnessCommand, async () => {})
  try {
    await f.authorize(); await f.executor.settled('coding')
    const first = (await f.get()).snapshot
    expect(first.status).toBe('waiting_permission')
    await send({ type: 'permission', permissionId: first.permission!.id, decision: 'approved' }); await f.executor.settled('coding')
    const second = (await f.get()).snapshot
    expect(second.status).toBe('waiting_permission'); expect(second.permission!.id).not.toBe(first.permission!.id)
    await send({ type: 'permission', permissionId: second.permission!.id, decision: 'approved', scope: 'task' }); await f.executor.settled('coding')
    const done = (await f.get()).snapshot
    expect(done.status).toBe('paused')
    expect(done.permissionPolicy).toMatchObject({ humanPrompts: 2, automaticDecisions: 0 })
    const session = (await f.store.getNativeCodingSession('native-coding'))!
    const workspace = await CodingCandidateWorkspace.open(session.binding!.workspaceRoot)
    expect(await readFile(path.join(workspace.candidatePath, 'permission-count.txt'), 'utf8')).toBe('xxx')
    expect(session.permissions.map(p => p.scope)).toEqual(['once', 'task'])
  } finally { await f.executor.shutdown(); await f.store.close(); await rm(f.root, { recursive: true, force: true }) }
}, 15000)
