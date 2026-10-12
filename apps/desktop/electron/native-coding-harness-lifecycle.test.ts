// @vitest-environment node
import { readFile, rm } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { codingHarnessFixture, codingToolReply } from './native-coding-test-fixture'
import { mutateNativeCodingSession } from './native-coding-session'
import path from 'node:path'
import { createLocalStore } from './local-store'
import { createNativeCodingExecutorV3 } from './native-coding-harness'
import { CodingCandidateWorkspace } from './coding-candidate-workspace'
import { CodingCommandRunner } from './coding-command-runner'
import { AgentProviderRequestError } from '@ai-devflow/shared'

it('enforces active time while a model request is in flight, without waiting for another step', async () => {
  let aborted = false
  const fixture = await codingHarnessFixture(async request => new Promise((_resolve, reject) => {
    request.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('Endpoint request interrupted')) }, { once: true })
  }))
  try {
    await mutateNativeCodingSession(fixture.store, 'native-coding', draft => { draft.limits.maxActiveMilliseconds = 150 })
    await fixture.authorize()
    await expect.poll(() => aborted, { timeout: 2000 }).toBe(true)
    await fixture.executor.settled('coding')
    const view = (await fixture.get()).snapshot
    expect(view.status, JSON.stringify(view)).toBe('reconciling')
    expect(view.cost.unknownAttempts).toBe(1)
    expect(view.messages).toHaveLength(1)
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

it('returns a restored frozen revision for fresh approval without asking the model to finish it again', async () => {
  const model = vi.fn(async () => codingToolReply('frozen', 'propose_changeset', { summary: 'Reviewed unchanged value' }))
  const fixture = await codingHarnessFixture(model)
  try {
    await fixture.authorize(); await fixture.executor.settled('coding')
    const original = (await fixture.get()).snapshot
    expect(original.status).toBe('review')
    // State produced after durable delivery recovery has proved rollback to B.
    await mutateNativeCodingSession(fixture.store, 'native-coding', draft => { draft.status = 'paused'; draft.pauseReason = 'delivery_restored_after_restart' })
    const restored = (await fixture.get()).snapshot
    const resumed = await fixture.executor.harness!.command({ protocolVersion: 2, type: 'resume', codingRunId: 'coding', commandId: 'review-restored', expectedVersion: restored.version }, async () => {})
    await fixture.executor.settled('coding')
    expect(resumed.snapshot.status).toBe('review'); expect(resumed.snapshot.revision?.digest).toBe(original.revision?.digest); expect(model).toHaveBeenCalledTimes(1)
    const accepted = await fixture.executor.harness!.command({ protocolVersion: 2, type: 'approve', codingRunId: 'coding', commandId: 'fresh-approval', expectedVersion: resumed.snapshot.version, objectiveVersion: resumed.snapshot.objectiveVersion, revisionDigest: resumed.snapshot.revision!.digest }, async () => {})
    expect(accepted.snapshot.status).toBe('completed')
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

it('stops varying text-only completions without treating rewording as execution progress', async () => {
  let count = 0
  const fixture = await codingHarnessFixture(async () => ({ kind: 'text', text: `Nothing further to do ${++count}`, assistantMessage: { role: 'assistant', content: `Nothing further to do ${count}` } }))
  try {
    await fixture.authorize(); await fixture.executor.settled('coding')
    const view = (await fixture.get()).snapshot
    expect(view.status).toBe('paused'); expect(view.pauseReason).toBe('no_progress'); expect(count).toBe(3)
    expect(view.revision).toBeUndefined(); expect(view.evidence).toEqual([])
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

it('preserves a received malformed response and its charge without calling it an unknown delivery', async () => {
  const model = vi.fn(async () => { throw new AgentProviderRequestError({ code: 'invalid_model_output', httpStatus: 200, deliveryState: 'response_received', billingState: 'confirmed', retryable: false, sanitizedCause: 'invalid_tool_response', usage: { inputTokens: 90, outputTokens: 30 } }) })
  const fixture = await codingHarnessFixture(model)
  try {
    await fixture.authorize(); await fixture.executor.settled('coding')
    const view = (await fixture.get()).snapshot
    expect(view.status).toBe('paused'); expect(view.pauseReason).toBe('invalid_model_response')
    expect(view.cost.unknownAttempts).toBe(0); expect(model).toHaveBeenCalledTimes(1)
    const attempt = (await fixture.store.getNativeCodingSession('native-coding'))!.attempts.at(-1)!
    expect(attempt.status).toBe('completed'); expect(attempt.usage).toMatchObject({ inputTokens: 90, outputTokens: 30 })
    expect(view.revision).toBeUndefined()
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

it('accounts parent and child model attempts against a single root step allowance', async () => {
  let sequence = 0
  const fixture = await codingHarnessFixture(async request => {
    if (!request.messages[0]?.content?.includes('rootObjective')) return codingToolReply(`call-${++sequence}`, 'delegate_task', { title: 'Inspect', prompt: 'Inspect only', mode: 'read_only', paths: [], maxTokens: 1000, maxCostUsd: 0.1 })
    return codingToolReply(`call-${++sequence}`, 'list_directory', {})
  })
  try {
    await mutateNativeCodingSession(fixture.store, 'native-coding', draft => { draft.limits.maxSteps = 2 })
    await fixture.authorize(); await fixture.executor.settled('coding')
    const sessions = await fixture.store.listNativeCodingSessions('project')
    await Promise.all(sessions.map(session => fixture.executor.settled(session.codingRunId)))
    const total = (await fixture.store.listNativeCodingSessions('project')).reduce((sum, session) => sum + session.attempts.length, 0)
    expect(total).toBe(2)
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

it('stops an old child before renewing authority and preserves its unknown-request recovery reason', async () => {
  let sequence = 0, childAborted = false, childStarted = false, releaseChild = () => {}
  const fixture = await codingHarnessFixture(async request => {
    if (request.messages[0]?.content?.includes('rootObjective')) return new Promise((_resolve, reject) => {
      childStarted = true
      releaseChild = () => reject(new Error('fixture teardown'))
      request.signal!.addEventListener('abort', () => { childAborted = true; reject(new Error('old authority stopped')) }, { once: true })
    })
    if (request.messages.some(message => message.role === 'tool')) return codingToolReply(`call-${++sequence}`, 'request_user_input', { text: 'Continue after checking authority?' })
    return codingToolReply(`call-${++sequence}`, 'delegate_task', { title: 'Inspect', prompt: 'Inspect only', mode: 'read_only', paths: [], maxTokens: 1000, maxCostUsd: 0.1 })
  })
  try {
    await fixture.authorize(); await fixture.executor.settled('coding')
    await expect.poll(async () => childStarted ? true : (await fixture.get()).snapshot).toBe(true)
    await mutateNativeCodingSession(fixture.store, 'native-coding', draft => { draft.status = 'paused'; draft.pauseReason = 'authorization_expired' })
    const paused = (await fixture.get()).snapshot
    await fixture.executor.harness!.command({ protocolVersion: 2, type: 'renew_authorization', codingRunId: 'coding', commandId: 'renew', expectedVersion: paused.version }, async () => {})
    expect(childAborted).toBe(true)
    const child = (await fixture.get(paused.children[0]!.id)).snapshot
    expect(child.status).toBe('reconciling')
    expect(child.pauseReason).toBe('model_delivery_unknown')
    expect(child.cost.unknownAttempts).toBe(1)
  } finally { releaseChild(); await fixture.executor.shutdown(); fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

it('workflow cancellation interrupts final verification and restores the actual delivery bytes', async () => {
  let sequence = 0
  const fixture = await codingHarnessFixture(async request => {
    const results = request.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content))
    const reply = (name: string, args: unknown) => codingToolReply(`call-${++sequence}`, name, args)
    if (!results.length) return reply('read_file', { path: 'value.ts' })
    if (results.length === 1) return reply('write_file', { path: 'value.ts', expectedHash: results[0].hash, content: 'export const value = 2\n' })
    return reply('propose_changeset', { summary: 'Set value to two' })
  }, 'node -e "setTimeout(()=>process.exit(0),30000)"')
  try {
    await fixture.authorize(); await fixture.executor.settled('coding')
    const review = (await fixture.get()).snapshot
    expect(review.status, JSON.stringify(review)).toBe('review')
    const approving = fixture.executor.harness!.command({ protocolVersion: 2, type: 'approve', codingRunId: 'coding', commandId: 'approve-cancelled', expectedVersion: review.version, objectiveVersion: review.objectiveVersion, revisionDigest: review.revision!.digest }, async () => {})
    await expect.poll(async () => { const view = (await fixture.get()).snapshot; return view.status === 'verifying' ? view.status : view }, { timeout: 5000 }).toBe('verifying')
    expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toContain('value = 2')
    const codingRun = (await fixture.store.listCodingAgentRuns()).find(run => run.id === 'coding')!
    await fixture.executor.cancel({ codingRun })
    await approving
    expect((await fixture.get()).snapshot.status).toBe('cancelled')
    expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe('export const value = 1\n')
    expect((await fixture.get()).completion).toBeUndefined()
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

it('requires a preselected manual plan and human evidence, without inventing a passed test', async () => {
  const fixture = await codingHarnessFixture(async () => codingToolReply('freeze-manual', 'propose_changeset', { summary: 'Reviewed the existing value; no change required' }), '')
  try {
    const initial = (await fixture.get()).snapshot
    await expect(fixture.authorize()).rejects.toThrow(/验收|test|verification/i)
    await fixture.executor.harness!.command({ protocolVersion: 2, type: 'authorize', codingRunId: 'coding', commandId: 'manual-start', expectedVersion: initial.version, profile: 'trusted_local', manualValidationPlan: 'Read value.ts and confirm it exports the documented value 1.' }, async () => {})
    await fixture.executor.settled('coding')
    const view = (await fixture.get()).snapshot
    const approve = { protocolVersion: 2 as const, type: 'approve' as const, codingRunId: 'coding', commandId: 'manual-approve', expectedVersion: view.version, objectiveVersion: view.objectiveVersion, revisionDigest: view.revision!.digest }
    await expect(fixture.executor.harness!.command(approve, async () => {})).rejects.toThrow(/人工|manual/i)
    const result = await fixture.executor.harness!.command({ ...approve, manualValidationEvidence: 'I inspected the frozen value.ts content: export const value = 1. No automated test was run.' }, async () => {})
    expect(result.snapshot.status, JSON.stringify(result.snapshot)).toBe('completed')
    expect(result.completion?.manualEvidence?.status).toBe('manual_accepted')
    expect(result.completion?.testEvidence).toBeUndefined()
    expect(await fixture.store.listTestEvidence('workflow')).toEqual([])
    expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toContain('value = 1')
  } finally { await fixture.executor.shutdown(); fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

it('routes a delegated question through restart to a human and collects its sourced result in the original parent', async () => {
  let sequence = 0
  const fixture = await codingHarnessFixture(async request => {
    const results = request.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content))
    const reply = (name: string, args: unknown) => codingToolReply(`call-${++sequence}`, name, args)
    const isChild = request.messages[0]?.content?.includes('rootObjective')
    if (isChild) {
      if (!results.length) return reply('request_user_input', { text: 'Should value remain one?' })
      expect(results[0]).toMatchObject({ answer: 'Yes', source: 'human' })
      return reply('report_findings', { summary: 'Confirmed by the human; value is one.', sources: ['value.ts'] })
    }
    if (!results.length) return reply('delegate_task', { title: 'Inspect value', prompt: 'Check value with the user', mode: 'read_only', paths: [], maxTokens: 1000, maxCostUsd: 0.1 })
    if (!results.some(item => item.findings)) return reply('await_task', { codingRunId: results[0].codingRunId })
    expect(results.at(-1).findings.sources[0]).toMatchObject({ path: 'value.ts' })
    return reply('propose_changeset', { summary: 'Child evidence reviewed; no change needed' })
  })
  let store = fixture.store, executor = fixture.executor
  try {
    await fixture.authorize(); await fixture.executor.settled('coding')
    const parent = (await fixture.get()).snapshot
    expect(parent.status, JSON.stringify(parent)).toBe('waiting_task')
    expect(parent.children).toHaveLength(1)
    await executor.shutdown(); await store.close()
    store = await createLocalStore({ dbPath: path.join(fixture.root, 'local.sqlite') })
    executor = createNativeCodingExecutorV3({ store, root: path.join(fixture.root, 'harness'), configVersion: 1, provider: fixture.provider })
    const savedRun = (await store.listCodingAgentRuns()).find(run => run.id === 'coding')!
    await executor.harness!.recover(savedRun, async () => {})
    const child = (await executor.harness!.command({ protocolVersion: 2, type: 'get', codingRunId: parent.children[0]!.id }, async () => {})).snapshot
    expect(child.status).toBe('waiting_input')
    await executor.harness!.command({ protocolVersion: 2, type: 'reply', codingRunId: child.codingRunId, commandId: 'human-child-answer', expectedVersion: child.version, objectiveVersion: child.objectiveVersion, questionId: child.question!.id, text: 'Yes' }, async () => {})
    await executor.settled(child.codingRunId)
    await executor.settled('coding')
    const reviewed = (await executor.harness!.command({ protocolVersion: 2, type: 'get', codingRunId: 'coding' }, async () => {})).snapshot
    expect(reviewed.status, JSON.stringify(reviewed)).toBe('review')
    expect(reviewed.revision?.summary).toContain('Child evidence reviewed')
  } finally { await executor.shutdown(); await store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

it('keeps coding children isolated until the parent explicitly merges their frozen revision', async () => {
  let sequence = 0
  const fixture = await codingHarnessFixture(async request => {
    const results = request.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content))
    const reply = (name: string, args: unknown) => codingToolReply(`call-${++sequence}`, name, args)
    if (request.messages[0]?.content?.includes('rootObjective')) {
      if (!results.length) return reply('read_file', { path: 'value.ts' })
      if (results.length === 1) return reply('write_file', { path: 'value.ts', expectedHash: results[0].hash, content: 'export const value = 2\n' })
      if (results.length === 2) return reply('run_test_plan', {})
      if (!results.at(-1).receipt || ['starting', 'running'].includes(results.at(-1).receipt.status)) {
        await new Promise(resolve => setTimeout(resolve, 150))
        return reply('read_command', { id: results[2].id })
      }
      expect(results.at(-1).receipt.status, JSON.stringify(results.at(-1))).toBe('passed')
      return reply('propose_changeset', { summary: 'Child proposes value two' })
    }
    if (!results.length) return reply('delegate_task', { title: 'Implement value', prompt: 'Change value to two', mode: 'isolated_coding', paths: ['value.ts'], maxTokens: 2000, maxCostUsd: 0.2 })
    if (!results.some(item => item.revision?.id)) return reply('await_task', { codingRunId: results[0].codingRunId })
    if (!results.some(item => item.changed)) {
      expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe('export const value = 1\n')
      return reply('inspect_diff', {})
    }
    if (!results.some(item => item.childChangeSetId)) return reply('merge_task', { codingRunId: results[0].codingRunId, childChangeSetId: results.find(item => item.revision?.id).revision.id, expectedParentRevision: results.find(item => item.changed).revision })
    return reply('propose_changeset', { summary: 'Parent reviewed and merged child' })
  }, 'node -e "if(!require(\'fs\').readFileSync(\'value.ts\',\'utf8\').includes(\'value = 2\'))process.exit(1)"')
  try {
    await fixture.authorize(); await fixture.executor.settled('coding')
    const review = (await fixture.get()).snapshot
    const children = await Promise.all(review.children.map(async child => (await fixture.get(child.id)).snapshot))
    const sessions = await fixture.store.listNativeCodingSessions('project')
    expect(review.status, JSON.stringify({ review, children, attempts: sessions.map(session => ({ id: session.id, attempts: session.attempts })) })).toBe('review')
    expect(review.revision!.files.map(file => file.path)).toEqual(['value.ts'])
    expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe('export const value = 1\n')
    const completed = await fixture.executor.harness!.command({ protocolVersion: 2, type: 'approve', codingRunId: 'coding', commandId: 'approve-child-merge', expectedVersion: review.version, objectiveVersion: review.objectiveVersion, revisionDigest: review.revision!.digest }, async () => {})
    expect(completed.snapshot.status).toBe('completed')
    expect(completed.completion?.testEvidence?.status).toBe('passed')
    expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe('export const value = 2\n')
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
// This fixture creates parent/child/base/verification Git snapshots and runs
// both child and final test processes. Linux CI exceeded the generic 5 s limit.
}, process.platform === 'win32' ? 30000 : 15000)

it('cancels the real child command when collection races its first load', async () => {
  let sequence = 0, childLoads = 0, commandStarted = () => {}, commandPid: number | undefined
  const runners = new Set<CodingCommandRunner>()
  const started = new Promise<void>(resolve => { commandStarted = resolve })
  const fixture = await codingHarnessFixture(async request => {
    const results = request.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content))
    const reply = (name: string, args: unknown) => codingToolReply(`race-${++sequence}`, name, args)
    if (!request.messages[0]?.content?.includes('rootObjective')) {
      if (!results.length) return reply('delegate_task', { title: 'Verify', prompt: 'Run the saved test', mode: 'isolated_coding', paths: ['value.ts'], maxTokens: 2000, maxCostUsd: 0.2 })
      if (results.length === 1) return reply('await_task', { codingRunId: results[0].codingRunId })
      return reply('report_blocked', { reason: 'Parent has collected the child result for this test' })
    }
    if (!results.length) {
      const child = (await fixture.store.listNativeCodingSessions('project')).find(session => session.parent)!
      await mutateNativeCodingSession(fixture.store, child.id, draft => { draft.limits.batchSteps = 1 })
      return reply('run_test_plan', {})
    }
    if (!results.at(-1).receipt || ['starting', 'running'].includes(results.at(-1).receipt.status)) {
      await new Promise(resolve => setTimeout(resolve, 150))
      return reply('read_command', { id: results[0].id })
    }
    expect(results.at(-1).receipt.status, JSON.stringify(results.at(-1))).toBe('passed')
    return reply('propose_changeset', { summary: 'The child executed its saved test' })
  }, 'node -e "setInterval(()=>{},100)"')
  const open = CodingCandidateWorkspace.open, start = CodingCommandRunner.prototype.start
  const openSpy = vi.spyOn(CodingCandidateWorkspace, 'open').mockImplementation(async root => {
    const workspace = await open(root)
    const child = (await fixture.store.listNativeCodingSessions('project')).find(session => session.parent && session.binding?.workspaceRoot === root)
    if (child) {
      childLoads++
      // Keep both real callers in flight; a duplicate loader must not replace
      // the process owner after the first loader has started a real command.
      if (childLoads === 1) await new Promise(resolve => setTimeout(resolve, 200))
      else await started
    }
    return workspace
  })
  const startSpy = vi.spyOn(CodingCommandRunner.prototype, 'start').mockImplementation(async function (this: CodingCommandRunner, ...args) {
    const receipt = await start.apply(this, args)
    if (args[0].startsWith('native-child-')) { runners.add(this); commandPid = receipt.pid; commandStarted() }
    return receipt
  })
  try {
    await fixture.authorize(); await started
    await new Promise<void>(resolve => setImmediate(resolve))
    const codingRun = (await fixture.store.listCodingAgentRuns()).find(run => run.id === 'coding')!
    await fixture.executor.cancel({ codingRun })
    expect((await fixture.get()).snapshot.status).toBe('cancelled')
    expect(commandPid).toBeDefined()
    expect(() => process.kill(commandPid!, 0)).toThrow()
  } finally {
    commandStarted(); openSpy.mockRestore(); startSpy.mockRestore()
    await Promise.all([...runners].map(runner => runner.cancelAll()))
    await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true })
  }
})
