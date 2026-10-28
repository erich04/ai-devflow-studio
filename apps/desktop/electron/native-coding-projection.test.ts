// @vitest-environment node
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { codingHarnessFixture, codingToolReply } from './native-coding-test-fixture'
import { mutateNativeCodingSession } from './native-coding-session'
import { codingHarnessSnapshot } from './native-coding-projection'
import { createCodingRuntime } from './coding-runtime'
import { createCodingExecutorCompatibilityAdapter } from './coding-executor'
import { createFakeCodingEngineAdapter } from './coding-engine'

it('reports post-approval drift before settlement without rewriting the accepted historical session', async () => {
  const fixture = await codingHarnessFixture(async () => codingToolReply('freeze', 'propose_changeset', { summary: 'Keep the existing value' }))
  try {
    await fixture.authorize(); await fixture.executor.settled('coding')
    const review = (await fixture.get()).snapshot
    await fixture.executor.harness!.command({ protocolVersion: 2, type: 'approve', codingRunId: 'coding', commandId: 'approve', expectedVersion: review.version, objectiveVersion: review.objectiveVersion, revisionDigest: review.revision!.digest }, async () => {})
    const original = (await fixture.store.getNativeCodingSession('native-coding'))!
    await writeFile(path.join(fixture.delivery, 'value.ts'), 'external edit')
    const drifted = await codingHarnessSnapshot(original, { store: fixture.store })
    expect(drifted.status).toBe('delivery_conflict')
    expect(drifted.controlUnavailableReason).toContain('结算')
    const codingRun = (await fixture.store.listCodingAgentRuns())[0]!
    const recovery = await fixture.executor.harness!.recover(codingRun, async () => {})
    expect(recovery?.completion).toBeUndefined()
    expect(recovery?.codingRun.harness?.status).toBe('delivery_conflict')
    expect(await fixture.store.getNativeCodingSession('native-coding')).toEqual(original)
    await writeFile(path.join(fixture.delivery, 'value.ts'), 'export const value = 1\n')
    expect((await fixture.executor.harness!.recover(codingRun, async () => {}))?.completion?.testEvidence?.status).toBe('passed')
    await fixture.store.saveCodingAgentRun({ ...codingRun, status: 'completed', completedAt: new Date().toISOString() })
    await rm(fixture.delivery, { recursive: true })
    const historical = await codingHarnessSnapshot(original, { store: fixture.store })
    expect(historical.status).toBe('completed')
    expect(historical.evidence.some(item => item.status === 'historical_content_unavailable')).toBe(true)
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

it('records why an unsettled v3 task cannot recover with a different executor, without replaying it', async () => {
  const fixture = await codingHarnessFixture(async () => { throw new Error('Must not run a model') })
  try {
    const executor = createCodingExecutorCompatibilityAdapter(createFakeCodingEngineAdapter())
    executor.descriptor = { ...executor.descriptor, id: 'coding-executor-native' }
    await createCodingRuntime({ store: fixture.store, executor }).recoverCodingAgentRuns()
    const codingRun = (await fixture.store.listCodingAgentRuns())[0]!
    expect(codingRun.summary).toContain('切回 Native v3')
    expect(codingRun.harness?.status).toBe('paused')
    expect(codingRun.status).not.toBe('completed')
    expect((await fixture.store.getNativeCodingSession('native-coding'))!.status).toBe('waiting_permission')
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

it('reads complete paged history without a configured executor or model credential', async () => {
  const fixture = await codingHarnessFixture(async () => { throw new Error('A historical read must never call the model') })
  try {
    const text = 'A human constraint with spaces. '.repeat(1800)
    const session = await mutateNativeCodingSession(fixture.store, 'native-coding', draft => { draft.transcript.push({ role: 'user', content: text }) })
    const view = await codingHarnessSnapshot(session, { store: fixture.store })
    expect(view.messages.at(-1)?.truncated).toBe(true)
    let result = '', offset: number | null = 0
    while (offset !== null) {
      const page = await codingHarnessSnapshot(session, { store: fixture.store }, { detail: { kind: 'message', id: 'message-1', offset } })
      result += page.detail!.text; offset = page.detail!.next
    }
    expect(result).toBe(text)
    expect((await fixture.store.getNativeCodingSession(session.id))!.version).toBe(session.version)
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})
