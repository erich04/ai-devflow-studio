// @vitest-environment node
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentProviderRequestError, type NativeConversationRequest } from '@ai-devflow/shared'
import { codingHarnessFixture, codingToolReply } from './native-coding-test-fixture'
import { CodingCandidateWorkspace, codingDigest } from './coding-candidate-workspace'
import { mutateNativeCodingSession } from './native-coding-session'
import { codingAcceptanceWorkers } from './native-coding-acceptance-worker'
import { createNativeCodingExecutorV3 } from './native-coding-harness'
import * as dependencies from './coding-dependency-preparation'
import { restoreCodingDependencySeed } from './coding-dependency-seed'

const fixtures: Awaited<ReturnType<typeof codingHarnessFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.executor.shutdown()
    await fixture.store.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})
const original = 'export const value = 1\n'
const changed = 'export const value = 2\n'
const privateBody = "const fs=await import('node:fs/promises'); /* PRIVATE-CASE-ONLY */ check((await fs.readFile('value.ts','utf8')) === 'export const value = 2\\n');"
const plan = () => codingToolReply('private-plan', 'submit_independent_checks', {
  checks: [{ criterionId: 'objective', body: privateBody }],
})
const timebox = async (fixture: Awaited<ReturnType<typeof codingHarnessFixture>>, maxSteps = 80) => {
  await mutateNativeCodingSession(fixture.store, 'native-coding', session => {
    session.operatorDeadlineAt = new Date(Date.now() + 60000).toISOString()
    session.limits.maxSteps = maxSteps
  })
}

it.each(['complete', 'pause'] as const)('overlaps baseline dependency preparation with authoring and coding, then drains it on %s', async (outcome) => {
  let releaseDependencies!: () => void
  const gate = new Promise<void>(resolve => { releaseDependencies = resolve })
  const packageFile = '.cache/devflow-pnpm-store/v3/files/ab/package-content'
  const prepare = vi.spyOn(dependencies, 'prepareCodingDependencies').mockImplementation(async input => {
    input.signal!.addEventListener('abort', releaseDependencies, { once: true })
    expect(await readFile(path.join(input.directory, 'value.ts'), 'utf8')).toBe(original)
    await gate
    input.signal!.throwIfAborted()
    await mkdir(path.dirname(path.join(input.directory, packageFile)), { recursive: true })
    await writeFile(path.join(input.directory, packageFile), 'baseline-package')
    return { inputDigest: input.plan.inputDigest, logId: `${input.operationId}:prepared` }
  })
  let turn = 0
  const author = vi.fn(async () => plan())
  const fixture = await codingHarnessFixture(async () => ++turn === 1
    ? codingToolReply('edit', 'write_file', { path: 'value.ts', expectedHash: codingDigest(original), content: changed })
    : codingToolReply('submit', 'propose_changeset', { summary: 'Review' }), undefined, {}, author, {
      baselineFiles: { 'package.json': '{"private":true,"packageManager":"pnpm@9.15.0"}', 'pnpm-lock.yaml': 'lockfileVersion: 9.0\n' },
    })
  fixtures.push(fixture)
  await timebox(fixture)
  try {
    await fixture.authorize()
    await vi.waitFor(async () => {
      expect(prepare).toHaveBeenCalledTimes(1)
      expect(author).toHaveBeenCalledTimes(1)
      const root = (await fixture.store.getNativeCodingSession('native-coding'))!
      expect(root.toolReceipts.some(receipt => receipt.name === 'propose_changeset' && receipt.status === 'started')).toBe(true)
    })
    const pending = await fixture.get()
    expect(pending.snapshot.status).toBe('running')
    const root = (await fixture.store.getNativeCodingSession('native-coding'))!
    const workspace = await CodingCandidateWorkspace.open(root.binding!.workspaceRoot)
    expect(await readFile(path.join(workspace.candidatePath, 'value.ts'), 'utf8')).toBe(changed)
    if (outcome === 'pause') {
      await fixture.executor.harness!.command({ protocolVersion: 2, type: 'pause', codingRunId: 'coding', commandId: 'pause', expectedVersion: pending.snapshot.version }, async () => {})
      expect((await fixture.get()).snapshot.status).toBe('paused')
      expect((await fixture.store.getNativeCodingSession('native-coding'))!.revisions).toHaveLength(0)
    } else {
      releaseDependencies()
      await fixture.executor.settled('coding')
      expect((await fixture.get()).snapshot.status).toBe('review')
      const dependencyPlan = await dependencies.codingDependencyPlan(workspace.candidatePath, root.binding!.profile, workspace.identity.base.excludedPaths, { isolatedStore: true })
      expect((await restoreCodingDependencySeed({ workspace, directory: workspace.candidatePath, plan: dependencyPlan })).status).toBe('restored')
      expect(await readFile(path.join(workspace.candidatePath, packageFile), 'utf8')).toBe('baseline-package')
    }
    expect((await readdir(workspace.root)).some(name => name.startsWith('baseline-dependencies-'))).toBe(false)
    expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(original)
  } finally { releaseDependencies() }
})

it('codes against C while the private author sees B, then waits for its frozen plan before review and delivery', async () => {
  let releaseAuthor!: () => void
  const gate = new Promise<void>(resolve => { releaseAuthor = resolve })
  let authorRequest: NativeConversationRequest | undefined
  const author = vi.fn(async (request: NativeConversationRequest) => {
    authorRequest = request
    await gate
    return plan()
  })
  let turn = 0
  const fixture = await codingHarnessFixture(async request => {
    expect(JSON.stringify(request)).not.toContain('PRIVATE-CASE-ONLY')
    return ++turn === 1
      ? codingToolReply('edit', 'write_file', { path: 'value.ts', expectedHash: codingDigest(original), content: changed })
      : codingToolReply('submit', 'propose_changeset', { summary: 'Changed the requested value' })
  }, undefined, {}, author)
  fixtures.push(fixture)
  await timebox(fixture)
  await fixture.authorize()
  try {
    await vi.waitFor(() => { expect(turn).toBe(2); expect(author).toHaveBeenCalledTimes(1) })
    const pending = (await fixture.store.getNativeCodingSession('native-coding'))!
    expect(await readFile(path.join(pending.binding!.workspaceRoot, 'candidate/value.ts'), 'utf8')).toBe(changed)
    expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(original)
    expect(pending.status).toBe('running')
    expect(pending.revisions).toHaveLength(0)
    expect(pending.children).toHaveLength(0)
    expect(pending.acceptanceWorkers).toHaveLength(1)
    const brief = JSON.parse(authorRequest!.messages[0]!.content as string)
    expect(brief.files.find((file: { path: string }) => file.path === 'value.ts').content).toBe(original)
    releaseAuthor()
    await fixture.executor.settled('coding')
    const reviewed = await fixture.get()
    expect(reviewed.snapshot.status).toBe('review')
    expect(reviewed.snapshot.steps).toBe(3)
    expect(reviewed.snapshot.cost).toMatchObject({ inputTokens: 30, outputTokens: 15, unknownAttempts: 0 })
    expect(JSON.stringify(reviewed.snapshot)).not.toContain('PRIVATE-CASE-ONLY')
    const root = (await fixture.store.getNativeCodingSession('native-coding'))!
    const [worker] = await codingAcceptanceWorkers(fixture.store, root)
    expect(worker!.status).toBe('completed')
    expect(worker!.toolReceipts).toHaveLength(0)
    expect(root.independentVerification?.plans).toHaveLength(1)
    await expect(fixture.executor.harness!.command({ protocolVersion: 2, type: 'get', codingRunId: worker!.codingRunId }, async () => {})).rejects.toThrow(/controlled through their root/)
    await fixture.executor.harness!.command({ protocolVersion: 2, type: 'approve', codingRunId: 'coding', commandId: 'approve',
      expectedVersion: reviewed.snapshot.version, revisionDigest: reviewed.snapshot.revision!.digest, objectiveVersion: 1, confirmedCriteria: [] }, async () => {})
    await fixture.executor.settled('coding')
    const delivered = (await fixture.get()).snapshot
    expect(delivered.status, JSON.stringify({ reason: delivered.pauseReason, evidence: delivered.evidence })).toBe('completed')
    expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(changed)
  } finally { releaseAuthor() }
})

it('stops on an unknown private request and requires the root command to authorize a new attempt', async () => {
  let releaseAuthor!: () => void
  const gate = new Promise<void>(resolve => { releaseAuthor = resolve })
  const author = vi.fn(async () => {
    if (author.mock.calls.length === 1) {
      await gate
      throw new AgentProviderRequestError({ code: 'connection_reset', deliveryState: 'possibly_delivered', billingState: 'unknown', retryable: false, sanitizedCause: 'response_stream_reset' })
    }
    return plan()
  })
  let turn = 0
  const fixture = await codingHarnessFixture(async () => ++turn === 1
    ? codingToolReply('edit', 'write_file', { path: 'value.ts', expectedHash: codingDigest(original), content: changed })
    : codingToolReply(`submit-${turn}`, 'propose_changeset', { summary: 'Review' }), undefined, {}, author)
  fixtures.push(fixture)
  let restarted: ReturnType<typeof createNativeCodingExecutorV3> | undefined
  await timebox(fixture)
  await fixture.authorize()
  try {
    await vi.waitFor(() => { expect(turn).toBe(2); expect(author).toHaveBeenCalledTimes(1) })
    releaseAuthor()
    await fixture.executor.settled('coding')
    const blocked = await fixture.get()
    expect(blocked.snapshot).toMatchObject({ status: 'reconciling', pauseReason: 'model_delivery_unknown' })
    expect(blocked.snapshot.cost.unknownAttempts).toBe(1)
    expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(original)
    await fixture.executor.shutdown()
    restarted = createNativeCodingExecutorV3({ store: fixture.store, provider: fixture.provider, root: path.join(fixture.root, 'harness'), configVersion: 2 })
    await restarted.harness!.recover(blocked.codingRun, async () => {})
    await restarted.settled('coding')
    const recovered = await fixture.get()
    expect(recovered.snapshot).toMatchObject({ status: 'reconciling', pauseReason: 'model_delivery_unknown' })
    await expect(restarted.harness!.command({ protocolVersion: 2, type: 'resume', codingRunId: 'coding', commandId: 'resume', expectedVersion: recovered.snapshot.version }, async () => {})).rejects.toThrow(/Reconciliation/)
    expect(author).toHaveBeenCalledTimes(1)
    const current = await fixture.get()
    await restarted.harness!.command({ protocolVersion: 2, type: 'retry_unknown', codingRunId: 'coding', commandId: 'retry', expectedVersion: current.snapshot.version }, async () => {})
    await restarted.settled('coding')
    expect(author).toHaveBeenCalledTimes(2)
    expect((await fixture.get()).snapshot.status).toBe('review')
    const root = (await fixture.store.getNativeCodingSession('native-coding'))!
    const [worker] = await codingAcceptanceWorkers(fixture.store, root)
    expect(worker!.attempts[0]).toMatchObject({ status: 'unknown', acknowledgedBy: 'retry' })
    expect(worker!.attempts[1]?.status).toBe('completed')
  } finally { releaseAuthor(); await restarted?.shutdown() }
})

it('pauses both workers during a pending submission and resumes a definitively unsent author request', async () => {
  const author = vi.fn(async (request: NativeConversationRequest) => {
    if (author.mock.calls.length === 1) await new Promise<never>((_, reject) => {
      request.signal!.addEventListener('abort', () => reject(new AgentProviderRequestError({ code: 'cancelled_by_user', deliveryState: 'not_sent', billingState: 'not_incurred', retryable: false, sanitizedCause: 'caller_abort_signal' })), { once: true })
    })
    return plan()
  })
  let turn = 0
  const fixture = await codingHarnessFixture(async () => ++turn === 1
    ? codingToolReply('edit', 'write_file', { path: 'value.ts', expectedHash: codingDigest(original), content: changed })
    : codingToolReply(`submit-${turn}`, 'propose_changeset', { summary: 'Review' }), undefined, {}, author)
  fixtures.push(fixture)
  await timebox(fixture)
  await fixture.authorize()
  await vi.waitFor(async () => {
    expect(author).toHaveBeenCalledTimes(1)
    const root = (await fixture.store.getNativeCodingSession('native-coding'))!
    expect(root.toolReceipts.some(receipt => receipt.name === 'propose_changeset' && receipt.status === 'started')).toBe(true)
  })
  const running = await fixture.get()
  await fixture.executor.harness!.command({ protocolVersion: 2, type: 'pause', codingRunId: 'coding', commandId: 'pause', expectedVersion: running.snapshot.version }, async () => {})
  const paused = await fixture.get()
  expect(paused.snapshot.status).toBe('paused')
  const root = (await fixture.store.getNativeCodingSession('native-coding'))!
  const [worker] = await codingAcceptanceWorkers(fixture.store, root)
  expect(worker).toMatchObject({ status: 'paused', pauseReason: 'parent_pause' })
  expect(worker!.attempts[0]?.status).toBe('not_sent')
  expect(root.revisions).toHaveLength(0)
  expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(original)
  await fixture.executor.harness!.command({ protocolVersion: 2, type: 'resume', codingRunId: 'coding', commandId: 'resume', expectedVersion: paused.snapshot.version }, async () => {})
  await fixture.executor.settled('coding')
  expect(author).toHaveBeenCalledTimes(2)
  expect((await fixture.get()).snapshot.status).toBe('review')
})

it('reserves a single shared step ceiling for coding and private preparation', async () => {
  let authorStarted!: () => void, releaseAuthor!: () => void
  const started = new Promise<void>(resolve => { authorStarted = resolve })
  const gate = new Promise<void>(resolve => { releaseAuthor = resolve })
  const author = vi.fn(async (request: NativeConversationRequest) => {
    request.signal!.addEventListener('abort', releaseAuthor, { once: true })
    authorStarted(); await gate; return plan()
  })
  let turn = 0
  const fixture = await codingHarnessFixture(async () => {
    await started
    return codingToolReply(`read-${++turn}`, 'read_file', { path: 'value.ts' })
  }, undefined, {}, author)
  fixtures.push(fixture)
  await timebox(fixture, 3)
  try {
    await fixture.authorize()
    await fixture.executor.settled('coding')
    expect((await fixture.get()).snapshot).toMatchObject({ status: 'paused', pauseReason: 'task_limit', steps: 3 })
    expect(turn).toBe(2)
    expect(author).toHaveBeenCalledTimes(1)
  } finally { releaseAuthor() }
})

it('discards a late old-objective plan and prepares the changed objective from the original baseline', async () => {
  let releaseOld!: () => void, noticeAbort!: () => void
  const oldGate = new Promise<void>(resolve => { releaseOld = resolve })
  const aborted = new Promise<void>(resolve => { noticeAbort = resolve })
  const author = vi.fn(async (request: NativeConversationRequest) => {
    const brief = JSON.parse(request.messages[0]!.content as string)
    expect(brief.files.find((file: { path: string }) => file.path === 'value.ts').content).toBe(original)
    if (author.mock.calls.length === 1) {
      request.signal!.addEventListener('abort', noticeAbort, { once: true })
      await oldGate
      return plan()
    }
    expect(JSON.stringify(brief.source.criteria)).toContain('Change target to 3')
    return codingToolReply('new-plan', 'submit_independent_checks', {
      checks: brief.source.criteria.map((criterion: { id: string }) => ({ criterionId: criterion.id, body: privateBody.replace('value = 2', 'value = 3') })),
    })
  })
  let turn = 0
  const fixture = await codingHarnessFixture(async request => {
    expect(JSON.stringify(request)).not.toContain('PRIVATE-CASE-ONLY')
    turn++
    if (turn === 1) return codingToolReply('edit-old', 'write_file', { path: 'value.ts', expectedHash: codingDigest(original), content: changed })
    if (turn === 3) {
      expect(JSON.stringify(request.messages)).toContain('Change target to 3')
      return codingToolReply('edit-new', 'write_file', { path: 'value.ts', expectedHash: codingDigest(changed), content: 'export const value = 3\n' })
    }
    return codingToolReply(`submit-${turn}`, 'propose_changeset', { summary: 'Review current objective' })
  }, undefined, {}, author)
  fixtures.push(fixture)
  await timebox(fixture)
  await fixture.authorize()
  try {
    await vi.waitFor(async () => {
      expect(author).toHaveBeenCalledTimes(1)
      const root = (await fixture.store.getNativeCodingSession('native-coding'))!
      expect(root.toolReceipts.some(receipt => receipt.name === 'propose_changeset' && receipt.status === 'started')).toBe(true)
    })
    const running = await fixture.get()
    const steering = fixture.executor.harness!.command({ protocolVersion: 2, type: 'steer', codingRunId: 'coding', commandId: 'steer', expectedVersion: running.snapshot.version, text: 'Change target to 3' }, async () => {})
    await aborted
    releaseOld()
    await steering
    await fixture.executor.settled('coding')
    const reviewed = await fixture.get()
    expect(reviewed.snapshot, JSON.stringify({ reason: reviewed.snapshot.pauseReason, messages: reviewed.snapshot.messages })).toMatchObject({ status: 'review', objectiveVersion: 2 })
    const root = (await fixture.store.getNativeCodingSession('native-coding'))!
    const workers = await codingAcceptanceWorkers(fixture.store, root)
    expect(workers).toHaveLength(2)
    expect(workers[0]!.independentVerification?.plans).toHaveLength(0)
    expect(workers[0]!.attempts[0]?.error).toContain('Late response')
    expect(workers[1]!.independentVerification?.plans).toHaveLength(1)
    expect(root.revisions.map(revision => revision.objectiveVersion)).toEqual([2])
    await fixture.executor.harness!.command({ protocolVersion: 2, type: 'approve', codingRunId: 'coding', commandId: 'approve-new', expectedVersion: reviewed.snapshot.version, objectiveVersion: 2, revisionDigest: reviewed.snapshot.revision!.digest, confirmedCriteria: [] }, async () => {})
    expect((await fixture.get()).snapshot.status).toBe('completed')
    expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe('export const value = 3\n')
  } finally { releaseOld() }
})
