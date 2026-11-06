// @vitest-environment node
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createFakeAgentProvider, type AgentProvider, type NativeToolCall } from '@ai-devflow/shared'
import { createLocalStore } from './local-store'
import { createNativeCodingExecutorV3 } from './native-coding-harness'
import { codingHarnessFixture, codingToolReply } from './native-coding-test-fixture'
import { NativeCodingLoop } from './native-coding-loop'
import { codingPlanContext, currentCodingPlan, unfinishedPlanWork, updateCodingPlan } from './native-coding-plan'
import { createNativeCodingSession, parseNativeCodingSession, updateNativeCodingSession, type CodingToolReceipt, type NativeCodingSession } from './native-coding-session'

function session() {
  return createNativeCodingSession({ id: 'session', localProjectId: 'project', codingRunId: 'run', workflowRunId: 'workflow', nodeId: 'build',
    objective: 'Change the export', providerId: 'fake', model: 'test', now: new Date().toISOString() })
}
function patch(draft: NativeCodingSession, id: string, fields: Record<string, unknown>) {
  return updateCodingPlan(draft, { objectiveVersion: draft.objectiveVersion, expectedVersion: currentCodingPlan(draft)?.version ?? 0, id, ...fields })
}
const implement = { kind: 'implement', title: 'Change the export' }
const investigate = { kind: 'investigate', title: 'Trace the export' }
function receipt(id: string, name: string, effect: CodingToolReceipt['effect'], result: unknown, objectiveVersion = 1): CodingToolReceipt {
  return { id, name, effect, result, objectiveVersion, input: {}, inputDigest: '0'.repeat(64), status: 'completed' }
}

it('accepts old sessions and scopes append-only revisions to the current objective', () => {
  const original = session()
  expect(parseNativeCodingSession(original).planHistory).toBeUndefined()
  const first = updateNativeCodingSession(original, original.updatedAt, draft => { patch(draft, 'edit', implement) })
  expect(unfinishedPlanWork(first)).toContain('edit')
  expect(() => patch(first, 'edit', { status: 'dropped' })).toThrow(/dropReason/)
  const second = updateNativeCodingSession(first, first.updatedAt, draft => { patch(draft, 'edit', { status: 'dropped', dropReason: 'Existing behavior already matches' }) })
  expect(unfinishedPlanWork(second)).toBeUndefined()
  expect(() => patch(second, 'edit', { status: 'in_progress' })).toThrow(/immutable/)
  expect(() => updateNativeCodingSession(second, second.updatedAt, draft => { draft.planHistory![0]!.nodes[0]!.title = 'rewritten' })).toThrow(/append-only/)
  const steered = updateNativeCodingSession(second, second.updatedAt, draft => { draft.objectiveVersion++; draft.objective = 'New request' })
  expect(currentCodingPlan(steered)).toBeUndefined()
  expect(unfinishedPlanWork(steered)).toBeUndefined()
  expect(() => updateCodingPlan(steered, { objectiveVersion: 1, expectedVersion: 2, id: 'stale', ...implement })).toThrow(/Stale/)
  expect(patch(steered, 'edit', implement)).toMatchObject({ version: 1, objectiveVersion: 2 })
  expect(steered.planHistory).toHaveLength(3)
})

it('rejects stale versions, protected nodes, bogus criteria, unsafe paths and ungrounded dependencies without consuming a revision', () => {
  const draft = session()
  draft.acceptance.push({ id: 'criterion', objectiveVersion: 1, sourceRef: 'brief', text: 'New export', confirmation: 'approved_source', resolution: 'unresolved' })
  patch(draft, 'first', { ...investigate, acceptanceRefs: ['criterion'] })
  patch(draft, 'second', { ...implement, dependsOn: ['first'] })
  for (const [id, update] of [
    ['second', { expectedVersion: 0 }], ['host-verify', { status: 'done' }], ['fake-verify', { kind: 'verify', title: 'Forged' }],
    ['second', { owner: 'host' }], ['first', { dependsOn: ['second'] }], ['second', { dependsOn: ['missing'] }],
    ['second', { dependsOn: ['first', 'first'] }], ['first', { dependsOn: ['host-verify'] }],
    ['second', { status: 'in_progress' }], ['second', { acceptanceRefs: ['invented'] }], ['second', { writeScope: ['../secret'] }],
  ] as const) expect(() => patch(draft, id, update)).toThrow()
  expect(currentCodingPlan(draft)?.version).toBe(2)
  expect(() => patch({ ...draft, parent: { sessionId: 'root', codingRunId: 'root-run', objectiveVersion: 1, baseDigest: 'a'.repeat(64), mode: 'read_only', paths: [] } }, 'new', implement)).toThrow(/root/)
  const forged = structuredClone(draft)
  Object.assign(forged.planHistory![1]!.nodes.at(-1)!, { status: 'done', evidenceRefs: ['not-a-delivery'] })
  expect(() => parseNativeCodingSession(forged)).toThrow(/delivery evidence/)
})

it('counts the host node and its edges in the 12-node and 24-edge limits', () => {
  const draft = session()
  for (let i = 0; i < 11; i++) patch(draft, 'n' + i, investigate)
  expect(() => patch(draft, 'extra', implement)).toThrow(/12/)
  for (let i = 1; i <= 6; i++) patch(draft, 'n' + i, { dependsOn: Array.from({ length: i }, (_, j) => 'n' + j) })
  patch(draft, 'n7', { dependsOn: ['n0', 'n1', 'n2'] })
  expect(() => patch(draft, 'n8', { dependsOn: ['n0'] })).toThrow(/24/)
})

it('only accepts successful receipts and completed commands launched under the same objective', () => {
  const draft = session()
  draft.objectiveVersion = 2
  const cmd = { id: 'session:launch', status: 'running', exitCode: null }
  draft.toolReceipts.push(receipt('old-read', 'read_file', 'read', { text: 'old' }, 1),
    receipt('launch', 'run_command', 'command', cmd, 2),
    receipt('bad', 'write_file', 'write', { error: 'hash mismatch' }, 2),
    receipt('revoked', 'write_file', 'write', { executed: false }, 2),
    receipt('foreign', 'read_command', 'read', { receipt: { id: 'session:old', status: 'passed', exitCode: 0 } }, 2))
  patch(draft, 'edit', implement)
  for (const ref of ['missing', 'old-read', 'launch', cmd.id, 'bad', 'revoked', 'foreign']) {
    expect(() => patch(draft, 'edit', { status: 'done', evidenceRefs: [ref] })).toThrow(/successful/)
  }
  expect(() => patch(draft, 'edit', { status: 'done' })).toThrow(/successful/)
  draft.toolReceipts.push(receipt('finished', 'read_command', 'read', { receipt: { ...cmd, status: 'passed', exitCode: 0 } }, 2))
  patch(draft, 'edit', { status: 'done', evidenceRefs: [cmd.id, 'finished'] })
  expect(unfinishedPlanWork(draft)).toBeUndefined()
  expect(codingPlanContext(draft)?.recentEvidenceIds).toContain(cmd.id)
  expect(() => patch(draft, 'edit', { title: 'rewrite' })).toThrow(/immutable/)
})

it('saves updates with the tool response, blocks premature proposals, and reopens the same graph from SQLite', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-plan-'))
  const dbPath = path.join(directory, 'local.sqlite')
  let store = await createLocalStore({ dbPath })
  try {
    const initial = session(), now = initial.createdAt
    await store.upsertProject({ id: 'project', name: 'test', path: directory, packageManager: 'npm', testCommand: '', createdAt: now, updatedAt: now })
    await store.saveNativeCodingSession(initial, 0)
    const script: Array<[name: string, input: Record<string, unknown>]> = [
      ['update_plan', { objectiveVersion: 1, expectedVersion: 0, id: 'edit', ...implement }],
      ['propose_changeset', {}],
      ['update_plan', { objectiveVersion: 1, expectedVersion: 0, id: 'edit', status: 'in_progress' }],
      ['update_plan', { objectiveVersion: 1, expectedVersion: 1, id: 'edit', status: 'dropped', dropReason: 'Already present' }],
      ['report_blocked', { reason: 'End fixture' }],
    ]
    let step = 0
    const provider: AgentProvider = { ...createFakeAgentProvider(), supportsNativeTools: true, serializeNativeRequest: JSON.stringify,
      completeNativeConversation: async request => {
        expect(request.tools.some(tool => tool.function.name === 'update_plan')).toBe(true)
        const [name, input] = script[step++]!
        const toolCalls: NativeToolCall[] = [{ id: 'call-' + step, type: 'function', function: { name, arguments: JSON.stringify(input) } }]
        return { kind: 'tools', toolCalls, assistantMessage: { role: 'assistant', content: null, tool_calls: toolCalls } }
      } }
    let submissions = 0
    const loop = new NativeCodingLoop({ store, provider, tools: { definitions: [{ type: 'function', function: { name: 'propose_changeset', description: 'Freeze',
      parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] } } }], effects: { propose_changeset: 'write' }, execute: async () => { submissions++; return {} } } })
    const result = await loop.runBatch(initial.id)
    expect(result.status).toBe('paused')
    expect(submissions).toBe(0)
    const replies = result.transcript.filter(item => item.role === 'tool').map(item => JSON.parse(item.content))
    expect(replies.slice(0, 4)).toEqual([{ updatedVersion: 1 }, { error: expect.stringContaining('edit'), executed: false },
      { error: expect.stringContaining('Stale'), executed: false }, { updatedVersion: 2 }])
    await store.close()
    store = await createLocalStore({ dbPath })
    const restored = (await store.getNativeCodingSession(initial.id))!
    expect(restored.planHistory).toEqual(result.planHistory)
    expect(currentCodingPlan(restored)?.nodes.map(node => node.status)).toEqual(['dropped', 'pending'])
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }) }
})

it('recovers host verification exactly once when delivery succeeds before the SQLite checkpoint is saved', async () => {
  const fixture = await codingHarnessFixture(async request => {
    if (!request.messages.some(message => message.role === 'tool'))
      return codingToolReply('plan', 'update_plan', { objectiveVersion: 1, expectedVersion: 0, id: 'inspect', ...investigate, status: 'dropped', dropReason: 'Read-only fixture' })
    return codingToolReply('freeze', 'propose_changeset', { summary: 'Confirm the unchanged revision' })
  })
  const restartDb = path.join(fixture.root, 'crash-checkpoint.sqlite')
  try {
    await fixture.authorize()
    await fixture.executor.settled('coding')
    const review = (await fixture.get()).snapshot
    expect(review.status).toBe('review')
    let captured = false
    const approved = await fixture.executor.harness!.command({ protocolVersion: 2, type: 'approve', codingRunId: 'coding', commandId: 'approve',
      expectedVersion: review.version, objectiveVersion: review.objectiveVersion, revisionDigest: review.revision!.digest }, async () => {
      // Restart with the real approval checkpoint and the on-disk delivery transaction, as after a lost final DB write.
      if (captured) return
      const checkpoint = await fixture.store.getNativeCodingSession('native-coding')
      if (checkpoint?.status === 'applying' || checkpoint?.status === 'verifying') {
        await copyFile(path.join(fixture.root, 'local.sqlite'), restartDb)
        captured = true
      }
    })
    expect(captured).toBe(true)
    expect(approved.snapshot.status).toBe('completed')
    await fixture.executor.shutdown()
    const store = await createLocalStore({ dbPath: restartDb })
    const restarted = createNativeCodingExecutorV3({ store, root: path.join(fixture.root, 'harness'), configVersion: 1, provider: fixture.provider })
    try {
      expect(currentCodingPlan((await store.getNativeCodingSession('native-coding'))!)?.nodes.at(-1)?.status).toBe('pending')
      const run = (await store.listCodingAgentRuns())[0]!
      const recovered = await restarted.harness!.recover(run, async () => {})
      expect(recovered?.snapshot.status).toBe('completed')
      expect(recovered?.snapshot.plan?.nodes.at(-1)).toMatchObject({ owner: 'host', status: 'done', evidenceRefs: [approved.snapshot.evidence.at(-1)!.id] })
      expect((await restarted.harness!.recover(run, async () => {}))?.snapshot.plan).toEqual(recovered?.snapshot.plan)
    } finally { await restarted.shutdown(); await store.close() }
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})
