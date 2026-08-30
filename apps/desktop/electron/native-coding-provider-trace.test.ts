// @vitest-environment node

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type RequestListener, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createOpenAiCompatibleAgentProvider,
  type CodingAgentRun,
  type LocalProject,
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

async function createFixture(
  baseUrl: string,
  runSavedTest?: () => Promise<LocalTestCommandResult>,
): Promise<{
  dbPath: string
  project: LocalProject
  run: WorkflowRun
  worktreeRoot: string
  openRuntime: () => Promise<{ store: LocalStore; runtime: ReturnType<typeof createCodingRuntime> }>
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
      const provider = createOpenAiCompatibleAgentProvider({
        id: 'local-compatible',
        name: 'Local compatible fixture',
        model: 'local-test-model',
        apiKey: 'CREDENTIAL_MUST_NOT_PERSIST',
        baseUrl: `${baseUrl}/v1`,
        structuredRequestTimeoutMs: 25,
      })
      const executor = createNativeCodingExecutorV2({
        store,
        decisionProvider: createAgentProviderNativeCodingV2DecisionProvider(provider),
        configVersion: 1,
        ...(runSavedTest ? { runSavedTest } : {}),
      })
      const runtime = createCodingRuntime({
        store,
        executor,
        worktreeRoot,
        budgetGuard: async () => ({
          status: 'allowed',
          blocksRun: false,
          currentSpendUsd: 0,
          projectedCostUsd: 0.01,
          limitUsd: 1,
          reason: 'Within the fixture budget.',
        }),
      })
      return { store, runtime }
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

describe('Native Coding v2 persistent Provider call Trace', () => {
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
      message: 'local-compatible · analysis · Provider 调用已开始。',
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
        setTimeout(() => {
          if (!response.destroyed) response.end('{}')
        }, 150)
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
    expect(failed.summary).toContain('analysis · provider_timeout')
    expect(failed.summary).toContain('费用状态未知 · 可以手动重试')
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
    expect(failedTrace[1]?.durationMs).toBeGreaterThanOrEqual(20)
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
  })

  it('persists an initial timeout without leaving an approval request', async () => {
    let requestNumber = 0
    const baseUrl = await startCompatibleServer((_request, response) => {
      requestNumber += 1
      if (requestNumber === 1) {
        sendStructuredResponse(response, analysisValue, requestNumber)
        return
      }
      setTimeout(() => {
        if (!response.destroyed) response.end('{}')
      }, 150)
    })
    const fixture = await createFixture(baseUrl)
    const { store, runtime } = await fixture.openRuntime()

    await expect(runtime.runCodingAgent(runInput(fixture))).rejects.toMatchObject({
      code: 'provider_timeout',
    })
    const failed = (await store.listCodingAgentRuns(fixture.run.id))[0]!
    expect(failed.summary).toContain('initial · provider_timeout')
    expect(providerTrace(await store.listCodingAgentEvents(failed.id))).toMatchObject([
      { phase: 'analysis', status: 'started' },
      { phase: 'analysis', status: 'succeeded' },
      { phase: 'initial', status: 'started' },
      { phase: 'initial', status: 'failed', errorCode: 'provider_timeout' },
    ])
    expect(await store.listCodingPermissionRequests(failed.id)).toEqual([])
  })

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
      setTimeout(() => {
        if (!response.destroyed) response.end('{}')
      }, 150)
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
    expect(failed.summary).toContain('repair · provider_timeout')
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
  })
})
