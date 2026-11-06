import { getCodingActionCosts } from './coding-action-costs'
import { verifyCodingChangeSetDisplay } from './coding-change-set'
// @vitest-environment node

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type RequestListener, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildChangeSetDiffView,
  createOpenAiCompatibleAgentProvider,
  governAgentProvider,
  modelBudgetUsageWithRuntime,
  modelCallActualUsage,
  modelCallBudgetRollup,
  type CodingAgentRun,
  type EffectiveProviderThinking,
  type LocalProject,
  type ModelCallAttempt,
  type ModelCallGovernance,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { createCodingRuntime } from './coding-runtime.js'
import { createLocalStore, type LocalStore } from './local-store.js'
import {
  createAgentProviderNativeCodingV2DecisionProvider,
  createNativeCodingExecutorV2,
} from './native-coding-executor-v2.js'
import type { LocalTestCommandResult } from './test-runner.js'

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []
const servers: Server[] = []
const stores = new Set<LocalStore>()
// This local server checks response parsing and cost traces, not provider latency.
// A hosted Windows run hit the 1 s deadline instead of receiving the delayed reply.
const providerFixtureTimeoutMs = process.platform === 'win32' ? 10_000 : 1_000
// Timeout cases deliberately consume the whole Provider deadline. Allow the
// existing 15 s Git/store lifecycle budget in addition to that intentional wait.
const providerTimeoutTestDeadlineMs = providerFixtureTimeoutMs + 15_000

afterEach(async () => {
  for (const store of stores) store.close()
  stores.clear()
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })))
  servers.length = 0
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  )
  temporaryDirectories.length = 0
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  temporaryDirectories.push(directory)
  return directory
}

async function startCompatibleServer(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Provider fixture did not bind')
  return `http://127.0.0.1:${address.port}`
}

function sendStructuredResponse(
  response: Parameters<RequestListener>[1],
  value: Record<string, unknown>,
  responseNumber: number,
): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({
    id: `local-response-${responseNumber}`,
    system_fingerprint: 'local-compatible-fixture',
    choices: [{ message: { content: JSON.stringify(value) } }],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 10,
      total_tokens: 30,
      prompt_tokens_details: { cached_tokens: 0 },
    },
  }))
}

const analysisValue = {
  stateVersion: 2,
  files: ['src/message.ts'],
  searches: [],
  summary: 'Inspect the message module.',
}

const initialValue = {
  stateVersion: 2,
  changes: [{
    path: 'src/message.ts',
    replacements: [{ oldText: 'message = "old"', newText: 'message = "new"' }],
  }],
  summary: 'Replace only the requested message.',
}

/**
 * Team model-call admission as the API records it: every governed request is reserved and then
 * settled under its own attempt ID (apps/api model-call-budget).
 */
function recordingGovernance(userId: string) {
  const attempts = new Map<string, ModelCallAttempt>()
  const governance: ModelCallGovernance = {
    async reserve(quote) {
      attempts.set(quote.id, { ...quote, userId, state: 'reserved', projectedCostUsd: 0, costUsd: null })
      return { accepted: true, decision: { status: 'allowed', blocksRun: false, currentSpendUsd: 0, projectedCostUsd: 0, reason: 'Fixture admission.' } }
    },
    async settle(settlement) {
      const attempt = attempts.get(settlement.id)
      if (attempt) attempts.set(settlement.id, { ...attempt, state: settlement.state, ...(settlement.usage ? { usage: settlement.usage } : {}) })
    },
    async persist() {},
    async pending() { return [] },
  }
  return { governance, attempts }
}

/** The Team overview's budget rows for one coding run plus the recorded model calls. */
function teamBudgetTokens(run: CodingAgentRun, attempts: ModelCallAttempt[]) {
  const rows = modelBudgetUsageWithRuntime([], run.runtimeCostSummary ? [run.runtimeCostSummary] : [])
  return {
    actual: modelCallActualUsage(rows, attempts).reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0),
    budget: modelCallBudgetRollup(rows, attempts, new Date().toISOString())[0]?.totalTokens ?? 0,
  }
}

async function createFixture(
  baseUrl: string,
  runSavedTest?: () => Promise<LocalTestCommandResult>,
  governance?: ModelCallGovernance,
  /** Overrides the Provider's resolved thinking, as a DeepSeek Provider reports it. */
  thinking?: EffectiveProviderThinking,
  options?: { now?: () => string; autoChangeReview?: boolean; runtime?: Pick<Parameters<typeof createCodingRuntime>[0], 'schedulePermissionTimeout' | 'budgetGuard'> },
): Promise<{
  dbPath: string
  project: LocalProject
  run: WorkflowRun
  worktreeRoot: string
  openRuntime: () => Promise<{ store: LocalStore; runtime: ReturnType<typeof createCodingRuntime>; executor: ReturnType<typeof createNativeCodingExecutorV2> }>
}> {
  const repositoryPath = await temporaryDirectory('devflow-provider-trace-repository')
  const worktreeRoot = await temporaryDirectory('devflow-provider-trace-worktrees')
  const storeDirectory = await temporaryDirectory('devflow-provider-trace-store')
  await mkdir(path.join(repositoryPath, 'src'))
  await writeFile(path.join(repositoryPath, 'src/message.ts'), 'export const message = "old"\n', 'utf8')
  await writeFile(path.join(repositoryPath, 'package.json'), '{"name":"provider-trace-fixture","version":"1.0.0"}\n', 'utf8')
  await execFileAsync('git', ['-C', repositoryPath, 'init', '-b', 'main'])
  await execFileAsync('git', ['-C', repositoryPath, 'config', 'user.email', 'provider-trace@example.invalid'])
  await execFileAsync('git', ['-C', repositoryPath, 'config', 'user.name', 'Provider Trace Test'])
  await execFileAsync('git', ['-C', repositoryPath, 'add', '.'])
  await execFileAsync('git', ['-C', repositoryPath, 'commit', '-m', 'baseline'])

  const project: LocalProject = {
    id: 'provider-trace-project',
    name: 'provider-trace-fixture',
    path: repositoryPath,
    packageManager: 'npm',
    detectedTestCommand: 'npm test',
    testCommand: 'npm test',
    createdAt: '2026-08-30T14:00:00.000Z',
    updatedAt: '2026-08-30T14:00:00.000Z',
  }
  const run: WorkflowRun = {
    id: 'provider-trace-workflow',
    version: 1,
    title: 'Provider trace workflow',
    request: 'Change the message from old to new.',
    projectId: project.id,
    creatorId: 'u-local-owner',
    status: 'building',
    currentNodeId: 'provider-trace-build',
    branchName: 'devflow/provider-trace',
    createdAt: '2026-08-30T14:00:00.000Z',
    updatedAt: '2026-08-30T14:00:00.000Z',
    nodes: [{
      id: 'provider-trace-build',
      stage: 'build',
      title: 'Implement locally',
      subtitle: 'Exercise provider trace failures.',
      kind: 'task',
      status: 'running',
      ownerId: 'u-local-owner',
      retryCount: 0,
      artifactIds: [],
    }],
    edges: [],
  }
  const dbPath = path.join(storeDirectory, 'devflow.sqlite')
  let initialized = false
  return {
    dbPath,
    project,
    run,
    worktreeRoot,
    async openRuntime() {
      const store = await createLocalStore({ dbPath })
      stores.add(store)
      if (!initialized) {
        await store.upsertProject(project)
        await store.saveRun(run)
        initialized = true
      }
      const compatible = createOpenAiCompatibleAgentProvider({
        id: 'local-compatible',
        name: 'Local compatible fixture',
        model: 'local-test-model',
        apiKey: 'CREDENTIAL_MUST_NOT_PERSIST',
        baseUrl: `${baseUrl}/v1`,
        structuredRequestTimeoutMs: providerFixtureTimeoutMs,
      })
      const provider = thinking ? { ...compatible, effectiveThinking: thinking } : compatible
      const executor = createNativeCodingExecutorV2({
        store,
        // main.ts governs the Native Provider per project the same way (resolveAgentProvider).
        decisionProvider: createAgentProviderNativeCodingV2DecisionProvider(
          governance ? governAgentProvider(provider, project.id, governance) : provider,
        ),
        configVersion: 1,
        ...(options?.now ? { clock: options.now } : {}),
        ...(runSavedTest ? { runSavedTest } : {}),
      })
      const runtime = createCodingRuntime({
        store,
        executor,
        worktreeRoot,
        ...(options?.now ? { now: options.now } : {}),
        ...(options?.autoChangeReview === undefined ? {} : { autoChangeReview: options.autoChangeReview }),
        budgetGuard: async () => ({
          status: 'allowed',
          blocksRun: false,
          currentSpendUsd: 0,
          projectedCostUsd: 0.01,
          limitUsd: 1,
          reason: 'Within the fixture budget.',
        }),
        ...options?.runtime,
      })
      return { store, runtime, executor }
    },
  }
}

function providerTrace(events: Awaited<ReturnType<LocalStore['listCodingAgentEvents']>>) {
  return events.flatMap((event) => event.metadata?.providerCall
    ? [event.metadata.providerCall as Record<string, unknown>]
    : [])
}

function runInput(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return {
    runId: fixture.run.id,
    nodeId: fixture.run.currentNodeId,
    projectId: fixture.project.id,
    requestedBy: fixture.run.creatorId,
    userInstruction: 'Change the message from old to new.',
  }
}

describe('Native revision and self-check lifecycle', () => {
  it('cannot approve a proposal if revision claims after the checked snapshot was read', async () => {
    let calls = 0
    const server = await startCompatibleServer((_req, res) => sendStructuredResponse(res, ++calls === 1 ? analysisValue : initialValue, calls))
    const fixture = await createFixture(server)
    const { store, runtime } = await fixture.openRuntime()
    const started = await runtime.runCodingAgent(runInput(fixture))
    const request = (await store.listCodingPermissionRequests(started.codingRun.id))[0]!
    const original = store.listCodingAgentRuns.bind(store)
    vi.spyOn(store, 'listCodingAgentRuns').mockImplementationOnce(async runId => {
      const checked = await original(runId)
      await store.saveCodingAgentRun({ ...checked[0]!, status: 'running', revisionInFlight: {
        previousChangeSetId: request.changeSetId!, previousChangeSetDigest: request.changeSetDigest!, previousRequestId: request.id,
        requestedAt: new Date().toISOString(), itemCount: 1,
      } })
      return checked
    })
    await runtime.replyCodingPermission({ codingRunId: started.codingRun.id, requestId: request.id, decidedBy: fixture.run.creatorId, decision: 'approved', comment: '' })
    expect((await store.listCodingPermissionRequests(started.codingRun.id))[0]?.status).toBe('pending')
    expect(await store.listCodingPermissionDecisions(started.codingRun.id)).toEqual([])
    expect((await original())[0]).toMatchObject({ status: 'running', revisionInFlight: { previousRequestId: request.id } })
    expect(calls).toBe(2)
  }, 20_000)

  it('restores revision approval expiry and settles the interrupted request once on restart', async () => {
    let calls = 0
    const schedule = vi.fn()
    const server = await startCompatibleServer((_req, res) => sendStructuredResponse(res, ++calls === 1 ? analysisValue : initialValue, calls))
    const fixture = await createFixture(server, undefined, undefined, undefined, { runtime: { schedulePermissionTimeout: schedule } })
    const { store, runtime } = await fixture.openRuntime()
    const started = await runtime.runCodingAgent(runInput(fixture))
    const request = (await store.listCodingPermissionRequests(started.codingRun.id))[0]!
    await store.saveCodingAgentRun({ ...started.codingRun, status: 'running', revisionInFlight: {
      previousChangeSetId: request.changeSetId!, previousChangeSetDigest: request.changeSetDigest!, previousRequestId: request.id,
      requestedAt: new Date().toISOString(), itemCount: 1,
    } })
    const trace = providerTrace(await store.listCodingAgentEvents(started.codingRun.id))[0]!
    await store.saveCodingAgentEvent({ id: 'interrupted-revision', codingRunId: started.codingRun.id, runId: fixture.run.id, nodeId: fixture.run.currentNodeId,
      sequence: 100, kind: 'status', message: 'revision started', timestamp: new Date().toISOString(), redacted: true,
      metadata: { providerCall: { ...trace, requestId: 'interrupted-request', phase: 'revision', status: 'started' } } })
    schedule.mockClear()
    await runtime.recoverCodingAgentRuns()
    await runtime.recoverCodingAgentRuns()
    expect((await store.listCodingAgentRuns())[0]).toMatchObject({ status: 'waiting_permission', changeSetId: request.changeSetId })
    expect((await store.listCodingAgentRuns())[0]).not.toHaveProperty('revisionInFlight')
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({ id: request.id }), expect.any(Function))
    const traces = providerTrace(await store.listCodingAgentEvents(started.codingRun.id)).filter(t => t.requestId === 'interrupted-request' && t.status !== 'started')
    expect(traces).toHaveLength(1)
    expect(calls).toBe(2)
  }, 20_000)

  it('records no delivery or cost when self-check is cancelled after trace creation but before dispatch', async () => {
    let calls = 0
    const guard = vi.fn(async () => ({ status: 'allowed' as const, blocksRun: false, currentSpendUsd: 0, projectedCostUsd: 0, reason: 'fixture', approvalId: 'approved-budget' }))
    const server = await startCompatibleServer((_req, res) => sendStructuredResponse(res, ++calls === 1 ? analysisValue : initialValue, calls))
    const fixture = await createFixture(server, undefined, undefined, undefined, { runtime: { budgetGuard: guard } })
    const { store, runtime, executor } = await fixture.openRuntime()
    const started = await runtime.runCodingAgent(runInput(fixture))
    const change = (await store.listCodingChangeSets(started.codingRun.id))[0]!
    const traces: unknown[] = []
    let stopped = false
    await expect(executor.reviewChangeSet!({ codingRun: started.codingRun, changeSet: change, view: buildChangeSetDiffView(verifyCodingChangeSetDisplay(change)), brief: started.codingRun.prompt,
      reportProviderCall: async trace => { traces.push(trace); if (trace.status === 'started') stopped = true },
      assertContextCurrent: async () => { if (stopped) throw new Error('Review stopped before dispatch') },
    })).rejects.toThrow()
    expect(traces).toContainEqual(expect.objectContaining({ phase: 'change_review', status: 'failed', deliveryState: 'not_sent', billingState: 'not_incurred', retryable: false }))
    expect(calls).toBe(2)
  }, 20_000)

  it('reviews and revises an exact proposal without applying it, then fences the old approval', async () => {
    const phases: string[] = []
    const server = await startCompatibleServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += String(chunk)
      const payload = JSON.parse(JSON.parse(body).messages.at(-1).content)
      phases.push(payload.phase)
      sendStructuredResponse(res, payload.phase === 'analysis' ? analysisValue : payload.phase === 'change_review' ? { stateVersion: 2, findings: [{ path: 'src/message.ts', line: 1, lineText: 'export const message = "new"', importance: 'suggestion', consequence: '文字不明确', reason: '需要完整表达', item: '改成完整文字' }] }
        : payload.phase === 'revision' ? { ...initialValue, changes: [{ path: 'src/message.ts', replacements: [{ oldText: '"old"', newText: '"revised"' }] }] } : initialValue, phases.length)
    })
    const guard = vi.fn(async (_input: Parameters<NonNullable<Parameters<typeof createCodingRuntime>[0]['budgetGuard']>>[0]) => ({ status: 'allowed' as const, blocksRun: false, currentSpendUsd: 0, projectedCostUsd: 0, reason: 'fixture', approvalId: 'approved-budget' }))
    const fixture = await createFixture(server, undefined, undefined, undefined, { runtime: { budgetGuard: guard } })
    const { store, runtime, executor } = await fixture.openRuntime()
    const started = await runtime.runCodingAgent(runInput(fixture))
    const original = (await store.listCodingPermissionRequests(started.codingRun.id))[0]!
    const review = await runtime.startCodingChangeReview({ codingRunId: started.codingRun.id, changeSetId: original.changeSetId!, changeSetDigest: original.changeSetDigest! })
    await vi.waitFor(async () => expect((await store.listCodingChangeReviews(started.codingRun.id)).find(r => r.id === review.id)?.status).toBe('completed'))
    expect((await store.listCodingChangeReviews(started.codingRun.id))[0]?.findings[0]?.anchor).toMatchObject({ side: 'new', line: 1 })
    const revised = await runtime.reviseCodingChangeSet({ codingRunId: started.codingRun.id, requestId: original.id, changeSetId: original.changeSetId!, changeSetDigest: original.changeSetDigest!, changeRequest: '改成完整文字', itemCount: 1, requestedBy: fixture.run.creatorId })
    expect(revised.codingRun.changeSetId).not.toBe(original.changeSetId)
    expect((await store.listCodingPermissionRequests(started.codingRun.id)).find(p => p.id === original.id)?.status).toBe('superseded')
    expect((await store.listCodingChangeSets(started.codingRun.id))).toHaveLength(2)
    const workspace = (await store.listManagedCodingWorkspaces(fixture.project.id))[0]!
    expect(await readFile(path.join(workspace.worktreePath, 'src/message.ts'), 'utf8')).toContain('"old"')
    await expect(runtime.replyCodingPermission({ codingRunId: started.codingRun.id, requestId: original.id, decidedBy: fixture.run.creatorId, decision: 'approved', comment: '' })).rejects.toThrow()
    expect(phases).toEqual(['analysis', 'initial', 'change_review', 'revision'])
    expect(guard).toHaveBeenLastCalledWith(expect.objectContaining({ approvalId: 'approved-budget' }))
    const costGuard = vi.fn(guard.getMockImplementation()!)
    await getCodingActionCosts({ projectId: fixture.project.id, store, executor, guard: costGuard })
    expect(costGuard).toHaveBeenCalledTimes(3)
    for (const [input] of costGuard.mock.calls) expect(input).toMatchObject({ approvalId: 'approved-budget' })
  }, 20_000)

  it.each(['stop', 'expire'] as const)('handles %s while a revision is still in flight', async action => {
    let time = '2026-10-31T00:00:00.000Z'
    let release: (() => void) | undefined
    const server = await startCompatibleServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += String(chunk)
      const payload = JSON.parse(JSON.parse(body).messages.at(-1).content)
      if (payload.phase === 'revision') await new Promise<void>(resolve => { release = resolve })
      sendStructuredResponse(res, payload.phase === 'analysis' ? analysisValue : initialValue, 1)
    })
    const fixture = await createFixture(server, undefined, undefined, undefined, { now: () => time })
    const { store, runtime } = await fixture.openRuntime()
    const started = await runtime.runCodingAgent(runInput(fixture))
    const original = (await store.listCodingPermissionRequests(started.codingRun.id))[0]!
    const pending = runtime.reviseCodingChangeSet({ codingRunId: started.codingRun.id, requestId: original.id, changeSetId: original.changeSetId!, changeSetDigest: original.changeSetDigest!, changeRequest: '补充检查', itemCount: 1, requestedBy: fixture.run.creatorId })
    const observed = pending.then(value => ({ value }), error => ({ error }))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await expect(runtime.replyCodingPermission({ codingRunId: started.codingRun.id, requestId: original.id, decidedBy: fixture.run.creatorId, decision: 'approved', comment: '' })).rejects.toThrow('revision_in_flight')
    if (action === 'stop') await runtime.cancelCodingRevision({ codingRunId: started.codingRun.id })
    else {
      time = '2026-10-31T00:20:00.000Z'
      await runtime.replyCodingPermission({ codingRunId: started.codingRun.id, requestId: original.id, decidedBy: 'devflow-timeout', decision: 'expired', comment: '' })
    }
    release!()
    const result = await observed
    if (action === 'stop') {
      expect(result).toHaveProperty('error')
      expect((await store.listCodingChangeSets(started.codingRun.id))).toHaveLength(1)
      expect((await store.listCodingAgentRuns())[0]).toMatchObject({ status: 'waiting_permission', changeSetId: original.changeSetId })
    } else {
      expect(result).toHaveProperty('value')
      const next = (await store.listCodingPermissionRequests(started.codingRun.id)).find(p => p.status === 'pending')!
      expect(next.expiresAt).toBe('2026-10-31T00:35:00.000Z')
      expect((await store.listCodingPermissionRequests(started.codingRun.id)).find(p => p.id === original.id)?.status).toBe('expired')
    }
  }, 20_000)
})

describe('DevFlow Native v2 persistent Provider call Trace', () => {
  it('recovers previously unaccounted failed responses once without calling the model or advancing the workflow', async () => {
    let calls = 0
    const baseUrl = await startCompatibleServer((_request, response) => {
      calls += 1; sendStructuredResponse(response, analysisValue, 1)
    })
    const fixture = await createFixture(baseUrl)
    const { store, runtime } = await fixture.openRuntime()
    const historical: CodingAgentRun = {
      id: 'historical-failed', runId: fixture.run.id, nodeId: fixture.run.currentNodeId,
      projectId: fixture.project.id, requestedBy: fixture.run.creatorId, providerId: 'local-compatible',
      engine: 'fake', status: 'failed', branchName: 'devflow/historical', userInstruction: 'Existing task',
      prompt: '', summary: 'Invalid output', changedPaths: [], startedAt: '2026-09-17T00:00:00.000Z', redacted: true,
    }
    // Seed a pre-upgrade row whose response is present but has no expense summary.
    await store.saveCodingAgentRun(historical)
    await store.saveCodingAgentEvent({
      id: 'historical-response', codingRunId: historical.id, runId: historical.runId, nodeId: historical.nodeId,
      sequence: 1, kind: 'error', message: 'Output rejected', timestamp: historical.startedAt, redacted: true,
      metadata: { providerCall: { requestId: 'historical-call', codingRunId: historical.id,
        providerId: historical.providerId, model: 'local-test-model', phase: 'analysis', status: 'failed',
        startedAt: historical.startedAt, completedAt: historical.startedAt, usage: { inputTokens: 20, outputTokens: 10 } } },
    })
    await store.saveCodingAgentRun({ ...historical, engine: 'native' })
    store.close()
    stores.delete(store)
    const restored = await fixture.openRuntime()
    await restored.runtime.recoverCodingAgentRuns()
    await restored.runtime.recoverCodingAgentRuns()
    expect((await restored.store.listCodingAgentRuns())[0]).toMatchObject({ status: 'failed', runtimeCostSummary: {
      inputTokens: 20, outputTokens: 10, costUsd: null, providerCallIds: ['historical-call'],
    } })
    expect(await restored.store.listCodingAgentEvents(historical.id)).toHaveLength(1)
    expect((await restored.store.getRun(fixture.run.id))?.currentNodeId).toBe(fixture.run.currentNodeId)
    expect(calls).toBe(0)
  })

  it('records known tokens and unknown price even when content cannot be parsed as JSON', async () => {
    const baseUrl = await startCompatibleServer((_request, response) => {
      // A modest scheduling delay must not turn a content-validation test into a timeout.
      setTimeout(() => {
        if (response.destroyed) return
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { content: '{"bad":' } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }))
      }, 75)
    })
    const fixture = await createFixture(baseUrl)
    const { store, runtime } = await fixture.openRuntime()
    await expect(runtime.runCodingAgent(runInput(fixture))).rejects.toMatchObject({ code: 'invalid_model_output' })
    expect((await store.listCodingAgentRuns(fixture.run.id))[0]).toMatchObject({ status: 'failed', runtimeCostSummary: {
      source: 'provider_reported', inputTokens: 20, outputTokens: 10, costUsd: null, costStatus: 'unknown',
    } })
    expect((await store.getRun(fixture.run.id))?.currentNodeId).toBe(fixture.run.currentNodeId)
  })

  it('keeps each governed call identity on its settlement so the Team counts it once (#199)', async () => {
    let requestNumber = 0
    const baseUrl = await startCompatibleServer((_request, response) => {
      requestNumber += 1
      sendStructuredResponse(response, requestNumber === 1 ? analysisValue : initialValue, requestNumber)
    })
    const { governance, attempts } = recordingGovernance('u-local-owner')
    const fixture = await createFixture(baseUrl, undefined, governance)
    const { store, runtime } = await fixture.openRuntime()
    expect((await runtime.runCodingAgent(runInput(fixture))).codingRun.status).toBe('waiting_permission')

    const codingRun = (await store.listCodingAgentRuns(fixture.run.id))[0]!
    const attemptIds = [...attempts.keys()]
    expect(attemptIds).toHaveLength(2)
    expect(codingRun.runtimeCostSummary?.providerCallSettlements?.map((call) => call.budgetAttemptIds))
      .toEqual([[attemptIds[0]], [attemptIds[1]]])
    // Two calls of 30 tokens each: the settlement rows and the recorded calls are one consumption.
    expect(teamBudgetTokens(codingRun, [...attempts.values()])).toEqual({ actual: 60, budget: 60 })
  })

  it('keeps the governed call identity on a failed, billed response (#199)', async () => {
    const baseUrl = await startCompatibleServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: '{"bad":' } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }))
    })
    const { governance, attempts } = recordingGovernance('u-local-owner')
    const fixture = await createFixture(baseUrl, undefined, governance)
    const { store, runtime } = await fixture.openRuntime()
    await expect(runtime.runCodingAgent(runInput(fixture))).rejects.toMatchObject({ code: 'invalid_model_output' })

    const failed = (await store.listCodingAgentRuns(fixture.run.id))[0]!
    expect(failed.runtimeCostSummary?.providerCallSettlements?.map((call) => call.budgetAttemptIds))
      .toEqual([[...attempts.keys()]])
    expect(teamBudgetTokens(failed, [...attempts.values()])).toEqual({ actual: 30, budget: 30 })
  })

  it.each([
    ['thinking enabled', { mode: 'enabled', effort: 'low', source: 'application_default' }, 4_096],
    ['thinking disabled', { mode: 'disabled', source: 'provider_configuration' }, 2_048],
    ['provider default', undefined, 2_048],
  ] as const)('bounds the analysis output for %s so reasoning does not truncate it (#200)', async (_label, thinking, analysisLimit) => {
    const limits: Array<unknown> = []
    const baseUrl = await startCompatibleServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      limits.push(JSON.parse(body).max_tokens)
      sendStructuredResponse(response, limits.length === 1 ? analysisValue : initialValue, limits.length)
    })
    const fixture = await createFixture(baseUrl, undefined, undefined, thinking)
    const { store, runtime } = await fixture.openRuntime()
    expect((await runtime.runCodingAgent(runInput(fixture))).codingRun.status).toBe('waiting_permission')
    // Analysis, then the initial change proposal, which always has the full budget.
    expect(limits).toEqual([analysisLimit, 4_096])
    const codingRun = (await store.listCodingAgentRuns(fixture.run.id))[0]!
    const traces = providerTrace(await store.listCodingAgentEvents(codingRun.id))
    expect(traces.find((trace) => trace.phase === 'analysis' && trace.status === 'succeeded'))
      .toMatchObject({ maxOutputTokens: analysisLimit })
  })

  it('sends the enforced file and replacement bounds as model instructions', async () => {
    const prompts: string[] = []
    const baseUrl = await startCompatibleServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      const payload = JSON.parse(body)
      prompts.push(payload.messages[0].content)
      sendStructuredResponse(response, prompts.length === 1 ? analysisValue : initialValue, prompts.length)
    })
    const fixture = await createFixture(baseUrl)
    const { runtime } = await fixture.openRuntime()
    expect((await runtime.runCodingAgent(runInput(fixture))).codingRun.status).toBe('waiting_permission')
    expect(prompts[0]).toContain('at most 8 unique file paths')
    expect(prompts[1]).toContain('at most 6 unique file paths')
    expect(prompts[1]).toContain('at most 12 replacements in total')
  })

  it.each([
    [{ ...analysisValue, extra: 'RAW_MODEL_CONTENT' }, 'analysis_keys_invalid'],
    [{ ...analysisValue, files: ['RAW_PROVIDER_PATH.ts'] }, 'analysis_path_not_in_manifest'],
    [{ ...analysisValue, files: Array(9).fill('src/message.ts') }, 'analysis_too_many_files'],
    [{ ...analysisValue, files: ['src/message.ts', 'src/message.ts'] }, 'analysis_duplicate_paths'],
  ])('classifies rejected analysis without logging its content (%s)', async (value, cause) => {
    const baseUrl = await startCompatibleServer((_request, response) => {
      sendStructuredResponse(response, value, 1)
    })
    const fixture = await createFixture(baseUrl)
    const { store, runtime } = await fixture.openRuntime()
    await expect(runtime.runCodingAgent(runInput(fixture))).rejects.toMatchObject({
      code: 'invalid_model_output', sanitizedCause: `native_v2_${cause}`,
    })
    const failed = (await store.listCodingAgentRuns(fixture.run.id))[0]!
    const events = await store.listCodingAgentEvents(failed.id)
    expect(providerTrace(events).at(-1)).toMatchObject({ sanitizedCause: `native_v2_${cause}` })
    expect(failed.runtimeCostSummary).toMatchObject({
      source: 'provider_reported', phase: 'provider_settlement', inputTokens: 20, outputTokens: 10, totalTokens: 30,
    })
    expect(JSON.stringify(events)).not.toContain('RAW_MODEL_CONTENT')
    expect(JSON.stringify(events)).not.toContain('RAW_PROVIDER_PATH')
    expect(await store.listCodingPermissionRequests(failed.id)).toEqual([])
  })

  it('persists a precise bounded schema failure without exposing the rejected model content', async () => {
    let requestNumber = 0
    const baseUrl = await startCompatibleServer((_request, response) => {
      requestNumber += 1
      sendStructuredResponse(response, requestNumber === 1 ? analysisValue : {
        ...initialValue, changes: [{ path: 'RAW_PROVIDER_PATH.ts', replacements: [{ oldText: 'RAW_MODEL_CONTENT', newText: 'new' }] }],
      }, requestNumber)
    })
    const fixture = await createFixture(baseUrl)
    const { store, runtime } = await fixture.openRuntime()
    await expect(runtime.runCodingAgent(runInput(fixture))).rejects.toMatchObject({
      code: 'invalid_model_output', sanitizedCause: 'native_v2_path_not_in_context',
    })
    const failed = (await store.listCodingAgentRuns(fixture.run.id))[0]!
    const events = await store.listCodingAgentEvents(failed.id)
    expect(providerTrace(events).at(-1)).toMatchObject({ sanitizedCause: 'native_v2_path_not_in_context' })
    expect(failed.runtimeCostSummary).toMatchObject({
      source: 'provider_reported', inputTokens: 40, outputTokens: 20, totalTokens: 60,
      providerCallSettlements: [{ requestPhase: 'analysis' }, { requestPhase: 'initial' }],
    })
    store.close()
    stores.delete(store)
    const restarted = await fixture.openRuntime()
    await restarted.runtime.recoverCodingAgentRuns()
    expect((await restarted.store.listCodingAgentRuns(fixture.run.id))[0]?.runtimeCostSummary).toEqual(failed.runtimeCostSummary)
    expect(JSON.stringify(events)).not.toContain('RAW_PROVIDER_PATH')
    expect(JSON.stringify(events)).not.toContain('RAW_MODEL_CONTENT')
    expect(await restarted.store.listCodingPermissionRequests(failed.id)).toEqual([])
  })

  it('terminalizes a persisted started call when recovery observes an interrupted runtime', async () => {
    const baseUrl = await startCompatibleServer((_request, response) => {
      sendStructuredResponse(response, analysisValue, 1)
    })
    const fixture = await createFixture(baseUrl)
    const { store, runtime } = await fixture.openRuntime()
    const startedAt = '2026-08-30T14:01:00.000Z'
    const interrupted: CodingAgentRun = {
      id: 'interrupted-provider-run',
      runId: fixture.run.id,
      nodeId: fixture.run.currentNodeId,
      projectId: fixture.project.id,
      requestedBy: fixture.run.creatorId,
      providerId: 'local-compatible',
      engine: 'native',
      configVersion: 1,
      status: 'preparing',
      branchName: 'devflow/interrupted-provider-run',
      userInstruction: 'Change the message from old to new.',
      prompt: 'A prompt that must not be copied into Trace.',
      summary: 'Interrupted while the Provider call was active.',
      changedPaths: [],
      startedAt,
      redacted: true,
    }
    await store.saveCodingAgentRun(interrupted)
    await store.saveCodingAgentEvent({
      id: 'provider-call-started-event',
      codingRunId: interrupted.id,
      runId: interrupted.runId,
      nodeId: interrupted.nodeId,
      sequence: 1,
      kind: 'tool_call',
      message: 'local-test-model · 分析 · 模型调用已开始。',
      timestamp: startedAt,
      metadata: {
        providerCall: {
          stateVersion: 1,
          requestId: 'provider-call-interrupted',
          codingRunId: interrupted.id,
          phase: 'analysis',
          attempt: 1,
          providerId: 'local-compatible',
          model: 'local-test-model',
          targetHost: '127.0.0.1',
          status: 'started',
          startedAt,
          timeoutMs: 30_000,
          promptChars: 200,
          promptBytes: 220,
          promptDigest: 'b'.repeat(64),
          manifestPathCount: 2,
          excerptCount: 0,
          maxOutputTokens: 2_048,
          deliveryState: 'not_sent',
          billingState: 'not_incurred',
          retryable: false,
          redacted: true,
        },
      },
      redacted: true,
    })

    await runtime.recoverCodingAgentRuns()

    expect((await store.listCodingAgentRuns(fixture.run.id)).find(
      (run) => run.id === interrupted.id,
    )).toMatchObject({ status: 'failed' })
    expect(providerTrace(await store.listCodingAgentEvents(interrupted.id))).toMatchObject([
      { status: 'started', phase: 'analysis' },
      {
        status: 'failed',
        phase: 'analysis',
        errorCode: 'unknown_provider_failure',
        deliveryState: 'possibly_delivered',
        billingState: 'unknown',
        retryable: true,
        sanitizedCause: 'runtime_restarted_before_terminal_observation',
      },
    ])
  })

  it('retains an analysis timeout across restart, releases the lock, and distinguishes the next successful run', async () => {
    let requestNumber = 0
    const baseUrl = await startCompatibleServer((_request, response) => {
      requestNumber += 1
      if (requestNumber === 1) {
        // Leave this response open so timeout, rather than a response-timer race, wins.
        return
      }
      sendStructuredResponse(
        response,
        requestNumber === 2 ? analysisValue : initialValue,
        requestNumber,
      )
    })
    const fixture = await createFixture(baseUrl)
    const first = await fixture.openRuntime()

    await expect(first.runtime.runCodingAgent(runInput(fixture))).rejects.toMatchObject({
      code: 'provider_timeout',
      billingState: 'unknown',
      retryable: true,
    })
    const failed = (await first.store.listCodingAgentRuns(fixture.run.id))[0]!
    expect(failed).toMatchObject({ status: 'failed' })
    expect(failed.summary).toMatch(/^local-test-model · 分析 · 模型响应超时（[^）]+） · 费用状态未知 · 可以手动重试。$/u)
    // The internal Provider ID and the raw error code stay in the trace metadata only (H4).
    expect(failed.summary).not.toMatch(/local-compatible|provider_timeout/u)
    expect(Date.parse(failed.completedAt!)).toBeGreaterThan(Date.parse(failed.startedAt))
    const failedTrace = providerTrace(await first.store.listCodingAgentEvents(failed.id))
    expect(failedTrace).toMatchObject([
      { phase: 'analysis', status: 'started', deliveryState: 'not_sent' },
      {
        phase: 'analysis',
        status: 'failed',
        errorCode: 'provider_timeout',
        deliveryState: 'possibly_delivered',
        billingState: 'unknown',
        retryable: true,
      },
    ])
    expect(failedTrace[1]?.durationMs).toBeGreaterThanOrEqual(providerFixtureTimeoutMs - 5)
    expect(Date.parse(String(failedTrace[1]?.completedAt))).toBeGreaterThan(
      Date.parse(String(failedTrace[0]?.startedAt)),
    )
    expect((await first.store.listCodingPermissionRequests(failed.id)).filter(
      (request) => request.status === 'pending',
    )).toEqual([])
    expect((await first.store.listManagedCodingWorkspaces(fixture.project.id))[0])
      .toMatchObject({ cleanupStatus: 'deleted' })

    first.store.close()
    stores.delete(first.store)
    const restarted = await fixture.openRuntime()
    expect(providerTrace(await restarted.store.listCodingAgentEvents(failed.id)))
      .toHaveLength(2)

    const succeeded = await restarted.runtime.runCodingAgent(runInput(fixture))
    expect(succeeded.codingRun.status).toBe('waiting_permission')
    expect(succeeded.codingRun.id).not.toBe(failed.id)
    const successfulTrace = providerTrace(
      await restarted.store.listCodingAgentEvents(succeeded.codingRun.id),
    )
    expect(successfulTrace).toMatchObject([
        { phase: 'analysis', status: 'started' },
        {
          phase: 'analysis',
          status: 'succeeded',
          targetHost: '127.0.0.1',
          httpStatus: 200,
          providerResponseId: 'local-response-2',
          systemFingerprint: 'local-compatible-fixture',
          usage: {
            inputTokens: 20,
            outputTokens: 10,
            cacheReadTokens: 0,
            cacheMissTokens: 20,
            totalTokens: 30,
          },
        },
        { phase: 'initial', status: 'started' },
        { phase: 'initial', status: 'succeeded' },
      ])
    const serialized = JSON.stringify(await restarted.store.listCodingAgentEvents(failed.id))
    expect(serialized).not.toContain('CREDENTIAL_MUST_NOT_PERSIST')
    expect(serialized).not.toContain('Change the message from old to new.')
    expect(serialized).not.toContain('export const message')
    // Git worktrees plus a persisted restart can exceed Vitest's 5s default on Windows.
    // The fixture Provider timeout is separate from the overall test deadline.
  }, providerTimeoutTestDeadlineMs)

  it('persists an initial timeout without leaving an approval request', async () => {
    let requestNumber = 0
    const baseUrl = await startCompatibleServer((_request, response) => {
      requestNumber += 1
      if (requestNumber === 1) {
        sendStructuredResponse(response, analysisValue, requestNumber)
        return
      }
      // Keep the initial response open until the Provider's timeout aborts it.
    })
    const fixture = await createFixture(baseUrl)
    const { store, runtime } = await fixture.openRuntime()

    await expect(runtime.runCodingAgent(runInput(fixture))).rejects.toMatchObject({
      code: 'provider_timeout',
    })
    const failed = (await store.listCodingAgentRuns(fixture.run.id))[0]!
    expect(failed.summary).toContain('生成改动 · 模型响应超时')
    expect(providerTrace(await store.listCodingAgentEvents(failed.id))).toMatchObject([
      { phase: 'analysis', status: 'started' },
      { phase: 'analysis', status: 'succeeded' },
      { phase: 'initial', status: 'started' },
      { phase: 'initial', status: 'failed', errorCode: 'provider_timeout' },
    ])
    expect(await store.listCodingPermissionRequests(failed.id)).toEqual([])
  }, providerTimeoutTestDeadlineMs)

  it('persists a repair timeout after the initial permission is settled', async () => {
    let requestNumber = 0
    const baseUrl = await startCompatibleServer((_request, response) => {
      requestNumber += 1
      if (requestNumber === 1) {
        sendStructuredResponse(response, analysisValue, requestNumber)
        return
      }
      if (requestNumber === 2) {
        sendStructuredResponse(response, initialValue, requestNumber)
        return
      }
      // Keep the repair response open until the Provider's timeout aborts it.
    })
    const fixture = await createFixture(baseUrl, async () => ({
      status: 'failed',
      exitCode: 1,
      durationMs: 5,
      stdout: '',
      stderr: 'expected fixture failure',
      redacted: true,
      summary: 'Saved fixture test failed.',
    }))
    const { store, runtime } = await fixture.openRuntime()
    const waiting = await runtime.runCodingAgent(runInput(fixture))
    const permission = (await store.listCodingPermissionRequests(waiting.codingRun.id)).find(
      (request) => request.status === 'pending',
    )!

    await expect(runtime.replyCodingPermission({
      requestId: permission.id,
      codingRunId: permission.codingRunId,
      decidedBy: fixture.run.creatorId,
      decision: 'approved',
      comment: 'Approve the exact initial Change Set once.',
    })).rejects.toMatchObject({ code: 'provider_timeout' })

    const failed = (await store.listCodingAgentRuns(fixture.run.id))[0]!
    expect(failed.status).toBe('failed')
    expect(failed.summary).toContain('修正改动 · 模型响应超时')
    expect(providerTrace(await store.listCodingAgentEvents(failed.id))).toMatchObject([
      { phase: 'analysis', status: 'started' },
      { phase: 'analysis', status: 'succeeded' },
      { phase: 'initial', status: 'started' },
      { phase: 'initial', status: 'succeeded' },
      { phase: 'repair', status: 'started' },
      {
        phase: 'repair',
        status: 'failed',
        errorCode: 'provider_timeout',
        billingState: 'unknown',
      },
    ])
    expect((await store.listCodingPermissionRequests(failed.id)).filter(
      (request) => request.status === 'pending',
    )).toEqual([])
    expect((await store.listManagedCodingWorkspaces(fixture.project.id))[0])
      .toMatchObject({ cleanupStatus: 'deleted' })
    // Approval, persisted repair failure, and Git cleanup can exceed 5s on Windows.
    // The fixture Provider timeout is separate from the overall test deadline.
  }, providerTimeoutTestDeadlineMs)
})
