import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkflowRunFromRequest } from '@ai-devflow/shared'
import { createDesktopAgentRuntime } from './agent-runtime-runtime'
import { createLocalStore } from './local-store'
import { createNativeToolRegistry } from './native-tool-registry'
import { createAcceptedNativeToolRegistrations } from './native-tools'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

async function runtimeFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'devflow-agent-runtime-'))
  tempDirs.push(dir)
  const store = await createLocalStore({ dbPath: path.join(dir, 'devflow.sqlite') })
  const project = {
    id: 'agent-runtime-project-1',
    name: 'agent-runtime-fixture',
    path: '/tmp/agent-runtime-fixture',
    packageManager: 'pnpm' as const,
    detectedTestCommand: 'pnpm test',
    testCommand: 'pnpm test',
    createdAt: '2026-08-12T20:00:00.000Z',
    updatedAt: '2026-08-12T20:00:00.000Z',
  }
  const creation = createWorkflowRunFromRequest({
    runId: 'run-agent-runtime-1',
    title: 'Exercise the durable fake runtime',
    request: 'Complete one bounded no-side-effect observation.',
    projectId: project.id,
    creatorId: 'user-agent-runtime-1',
    branchName: 'devflow/agent-runtime-1',
    now: '2026-08-12T20:00:00.000Z',
  })
  await store.upsertProject(project)
  await store.saveRun(creation.run)
  return { dir, store, project, run: creation.run }
}

function tickingClock(...values: string[]) {
  let index = 0
  return () => {
    const value = values[Math.min(index, values.length - 1)]
    index += 1
    if (!value) throw new Error('Agent Runtime test clock is exhausted')
    return value
  }
}

describe('Desktop Agent Runtime', () => {
  it('rejects a current Gate node before creating durable runtime state', async () => {
    const { store, run } = await runtimeFixture()
    const gateRun = {
      ...run,
      nodes: run.nodes.map((node) =>
        node.id === run.currentNodeId ? { ...node, kind: 'gate' as const } : node,
      ),
    }
    await store.saveRun(gateRun)
    const runtime = createDesktopAgentRuntime({
      store,
      clock: tickingClock('2026-08-12T20:30:00.000Z'),
      createId: () => 'agent-runtime-ineligible-gate-1',
    })

    await expect(
      runtime.start({ runId: run.id, nodeId: run.currentNodeId }),
    ).rejects.toThrow('Desktop Agent Runtime start authority is invalid')
    await expect(store.getAgentRuntime('agent-runtime-ineligible-gate-1')).resolves.toBeNull()
    store.close()
  })

  it('derives authority in Electron main and completes one durable native Tool runtime', async () => {
    const { store, run, project } = await runtimeFixture()
    const runtime = createDesktopAgentRuntime({
      store,
      clock: tickingClock(
        '2026-08-12T20:30:00.000Z',
        '2026-08-12T20:30:01.000Z',
        '2026-08-12T20:30:02.000Z',
        '2026-08-12T20:30:03.000Z',
        '2026-08-12T20:30:04.000Z',
        '2026-08-12T20:30:05.000Z',
        '2026-08-12T20:30:06.000Z',
        '2026-08-12T20:30:07.000Z',
      ),
      createId: () => 'agent-runtime-main-1',
    })

    const started = await runtime.start({ runId: run.id, nodeId: run.currentNodeId })
    expect(started.runtime).toMatchObject({
      id: 'agent-runtime-main-1',
      status: 'checkpointed',
      scope: {
        kind: 'local',
        organizationId: null,
        projectId: null,
        userId: run.creatorId,
        localProjectId: project.id,
      },
      authority: { runId: run.id, nodeId: run.currentNodeId, runVersion: 1, policyVersion: 1 },
    })
    expect(JSON.stringify(started)).not.toContain(project.path)

    await runtime.advance(started.runtime.id)
    await runtime.advance(started.runtime.id)
    const completed = await runtime.advance(started.runtime.id)
    const toolAudits = await store.listAgentRuntimeToolAudits(started.runtime.id)
    const capabilityGrants = await store.listAgentRuntimeCapabilityGrants(started.runtime.id)

    expect(
      completed.runtime,
      JSON.stringify({ toolAudits, capabilityGrants }),
    ).toMatchObject({ status: 'terminal', stopReason: 'success' })
    expect(completed.terminalSummary).toMatchObject({ stopReason: 'success', redacted: true })
    expect(completed.events.map((event) => event.type)).toEqual([
      'runtime_started',
      'context_attached',
      'checkpointed',
      'runtime_resumed',
      'checkpointed',
      'decision_recorded',
      'action_requested',
      'checkpointed',
      'action_result',
      'observation_recorded',
      'evaluation_recorded',
      'runtime_stopped',
    ])
    expect(toolAudits).toMatchObject([
      { status: 'started', toolId: 'scenario.evaluate', resultDigest: null },
      { status: 'succeeded', toolId: 'scenario.evaluate' },
    ])
    expect(capabilityGrants).toMatchObject([
      { status: 'consumed', capabilityId: 'scenario.evaluate' },
    ])
    store.close()
  })

  it('binds a paired Desktop runtime to exact Team and local project authority', async () => {
    const { store, run, project } = await runtimeFixture()
    await store.saveDesktopPairingCredential(
      {
        tokenId: 'desktop-token-agent-runtime-1',
        organizationId: 'org-agent-runtime-1',
        projectId: 'team-project-agent-runtime-1',
        localProjectId: project.id,
        userId: 'paired-user-agent-runtime-1',
        role: 'member',
        authAccountId: 'account-agent-runtime-1',
        projectMemberships: [
          {
            projectId: 'team-project-agent-runtime-1',
            userId: 'paired-user-agent-runtime-1',
            role: 'member',
          },
        ],
        createdAt: '2026-08-12T20:00:00.000Z',
      },
      'encrypted-desktop-token-agent-runtime-1',
    )
    const runtime = createDesktopAgentRuntime({
      store,
      clock: tickingClock('2026-08-12T20:30:00.000Z'),
      createId: () => 'agent-runtime-team-scope-1',
    })

    await expect(
      runtime.start({ runId: run.id, nodeId: run.currentNodeId }),
    ).resolves.toMatchObject({
      runtime: {
        scope: {
          kind: 'team',
          organizationId: 'org-agent-runtime-1',
          projectId: 'team-project-agent-runtime-1',
          userId: 'paired-user-agent-runtime-1',
          sessionId: 'desktop-token-agent-runtime-1',
          localProjectId: project.id,
        },
      },
    })
    store.close()
  })

  it('recovers the exact active action after restart without creating another action', async () => {
    const { store, run } = await runtimeFixture()
    const firstExecutor = vi.fn(async () => ({
      resultDigest: 'd'.repeat(64),
      evaluationSummary: 'Recovered fake observation.',
    }))
    const first = createDesktopAgentRuntime({
      store,
      clock: tickingClock(
        '2026-08-12T20:30:00.000Z',
        '2026-08-12T20:30:01.000Z',
        '2026-08-12T20:30:02.000Z',
      ),
      createId: () => 'agent-runtime-restart-1',
      executeFakeAction: firstExecutor,
    })
    const started = await first.start({ runId: run.id, nodeId: run.currentNodeId })
    await first.advance(started.runtime.id)
    const waiting = await first.advance(started.runtime.id)
    expect(waiting.runtime.status).toBe('waiting_action')
    expect(firstExecutor).not.toHaveBeenCalled()

    const recoveredExecutor = vi.fn(async () => ({
      resultDigest: 'd'.repeat(64),
      evaluationSummary: 'Recovered fake observation.',
    }))
    const restarted = createDesktopAgentRuntime({
      store,
      clock: tickingClock('2026-08-12T20:30:03.000Z'),
      createId: () => 'must-not-create-another-runtime',
      executeFakeAction: recoveredExecutor,
    })
    const recovered = await restarted.recover()

    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.runtime).toMatchObject({ status: 'terminal', stopReason: 'success' })
    expect(recoveredExecutor).toHaveBeenCalledTimes(1)
    const requestedEvents = recovered[0]?.events.filter(
      (event) => event.type === 'action_requested',
    )
    expect(requestedEvents).toHaveLength(1)
    store.close()
  })

  it('accepts one already-audited native Tool result after a pre-commit crash without re-execution', async () => {
    const { store, run } = await runtimeFixture()
    let beforeCommitCount = 0
    const first = createDesktopAgentRuntime({
      store,
      clock: tickingClock(
        '2026-08-12T20:30:00.000Z',
        '2026-08-12T20:30:01.000Z',
        '2026-08-12T20:30:02.000Z',
        '2026-08-12T20:30:03.000Z',
        '2026-08-12T20:30:04.000Z',
        '2026-08-12T20:30:05.000Z',
        '2026-08-12T20:30:06.000Z',
        '2026-08-12T20:30:07.000Z',
      ),
      createId: () => 'agent-runtime-native-result-crash-1',
      fault: (point) => {
        if (point === 'before_commit' && ++beforeCommitCount === 4) {
          throw new Error('injected-after-native-tool-before-runtime-commit')
        }
      },
    })
    const started = await first.start({ runId: run.id, nodeId: run.currentNodeId })
    await first.advance(started.runtime.id)
    await first.advance(started.runtime.id)
    await expect(first.advance(started.runtime.id)).rejects.toThrow(
      'injected-after-native-tool-before-runtime-commit',
    )
    expect(await store.getAgentRuntime(started.runtime.id)).toMatchObject({
      status: 'waiting_action',
    })
    expect(await store.listAgentRuntimeToolAudits(started.runtime.id)).toHaveLength(2)
    expect(await store.listAgentRuntimeCapabilityGrants(started.runtime.id)).toHaveLength(1)

    const restarted = createDesktopAgentRuntime({
      store,
      clock: tickingClock('2026-08-12T20:30:08.000Z'),
    })
    const [recovered] = await restarted.recover()

    expect(recovered?.runtime).toMatchObject({ status: 'terminal', stopReason: 'success' })
    expect(await store.listAgentRuntimeToolAudits(started.runtime.id)).toHaveLength(2)
    expect(await store.listAgentRuntimeCapabilityGrants(started.runtime.id)).toHaveLength(1)
    store.close()
  })

  it('stops recovery at the exact durable deadline without requesting an action', async () => {
    const { store, run } = await runtimeFixture()
    const first = createDesktopAgentRuntime({
      store,
      clock: tickingClock('2026-08-12T20:30:00.000Z'),
      createId: () => 'agent-runtime-deadline-1',
    })
    await first.start({ runId: run.id, nodeId: run.currentNodeId })

    const executeFakeAction = vi.fn()
    const restarted = createDesktopAgentRuntime({
      store,
      clock: tickingClock('2026-08-12T20:40:00.000Z'),
      executeFakeAction,
    })
    const [recovered] = await restarted.recover()

    expect(recovered?.runtime).toMatchObject({ status: 'terminal', stopReason: 'timeout' })
    expect(recovered?.events.map((event) => event.type)).toEqual([
      'runtime_started',
      'context_attached',
      'checkpointed',
      'runtime_stopped',
    ])
    expect(executeFakeAction).not.toHaveBeenCalled()
    store.close()
  })

  it('does not persist a transition when an injected crash happens before commit', async () => {
    const { store, run } = await runtimeFixture()
    const fault = vi.fn((point: 'before_commit' | 'after_commit') => {
      if (point === 'before_commit') throw new Error('injected-before-commit')
    })
    const runtime = createDesktopAgentRuntime({
      store,
      clock: tickingClock('2026-08-12T20:30:00.000Z'),
      createId: () => 'agent-runtime-crash-before-1',
      executeFakeAction: async () => ({
        resultDigest: 'd'.repeat(64),
        evaluationSummary: 'No side effect.',
      }),
      fault,
    })

    await expect(runtime.start({ runId: run.id, nodeId: run.currentNodeId })).rejects.toThrow(
      'injected-before-commit',
    )
    await expect(store.getAgentRuntime('agent-runtime-crash-before-1')).resolves.toBeNull()
    store.close()
  })

  it('recovers a committed transition after an injected post-commit crash', async () => {
    const { store, run } = await runtimeFixture()
    const fault = vi.fn((point: 'before_commit' | 'after_commit') => {
      if (point === 'after_commit') throw new Error('injected-after-commit')
    })
    const runtime = createDesktopAgentRuntime({
      store,
      clock: tickingClock('2026-08-12T20:30:00.000Z'),
      createId: () => 'agent-runtime-crash-after-1',
      executeFakeAction: async () => ({
        resultDigest: 'd'.repeat(64),
        evaluationSummary: 'No side effect.',
      }),
      fault,
    })

    await expect(runtime.start({ runId: run.id, nodeId: run.currentNodeId })).rejects.toThrow(
      'injected-after-commit',
    )
    await expect(store.getAgentRuntime('agent-runtime-crash-after-1')).resolves.toMatchObject({
      status: 'checkpointed',
      checkpointVersion: 1,
    })
    store.close()
  })

  it('cancels durably and never executes a fake action afterwards', async () => {
    const { store, run } = await runtimeFixture()
    const executeFakeAction = vi.fn()
    const runtime = createDesktopAgentRuntime({
      store,
      clock: tickingClock(
        '2026-08-12T20:30:00.000Z',
        '2026-08-12T20:30:01.000Z',
      ),
      createId: () => 'agent-runtime-cancel-1',
      executeFakeAction,
    })
    const started = await runtime.start({ runId: run.id, nodeId: run.currentNodeId })
    const cancelled = await runtime.cancel(started.runtime.id)

    expect(cancelled.runtime).toMatchObject({ status: 'terminal', stopReason: 'cancelled' })
    await expect(runtime.advance(started.runtime.id)).resolves.toEqual(cancelled)
    expect(executeFakeAction).not.toHaveBeenCalled()
    store.close()
  })

  it('fences a late fake result when cancellation wins the checkpoint race', async () => {
    const { store, run } = await runtimeFixture()
    let releaseAction!: (value: {
      resultDigest: string
      evaluationSummary: string
    }) => void
    const actionResult = new Promise<{
      resultDigest: string
      evaluationSummary: string
    }>((resolve) => {
      releaseAction = resolve
    })
    const executeFakeAction = vi.fn(() => actionResult)
    const runtime = createDesktopAgentRuntime({
      store,
      clock: tickingClock(
        '2026-08-12T20:30:00.000Z',
        '2026-08-12T20:30:01.000Z',
        '2026-08-12T20:30:02.000Z',
        '2026-08-12T20:30:03.000Z',
      ),
      createId: () => 'agent-runtime-cancel-race-1',
      executeFakeAction,
    })
    const started = await runtime.start({ runId: run.id, nodeId: run.currentNodeId })
    await runtime.advance(started.runtime.id)
    await runtime.advance(started.runtime.id)

    const lateAdvance = runtime.advance(started.runtime.id)
    await vi.waitFor(() => expect(executeFakeAction).toHaveBeenCalledTimes(1))
    const cancelled = await runtime.cancel(started.runtime.id)
    releaseAction({
      resultDigest: 'd'.repeat(64),
      evaluationSummary: 'This late result must not be accepted.',
    })

    await expect(lateAdvance).resolves.toEqual(cancelled)
    expect(cancelled.runtime).toMatchObject({ status: 'terminal', stopReason: 'cancelled' })
    expect(cancelled.runtime.acceptedActionIds).toEqual([])
    expect(cancelled.events.map((event) => event.type)).not.toContain('action_result')
    store.close()
  })

  it('aborts an in-flight native Tool when Runtime cancellation wins the checkpoint race', async () => {
    const { store, run, project } = await runtimeFixture()
    let releaseTool!: (value: { passed: boolean; failures: string[] }) => void
    const toolResult = new Promise<{ passed: boolean; failures: string[] }>((resolve) => {
      releaseTool = resolve
    })
    const registrations = createAcceptedNativeToolRegistrations({
      resolveLocalProject: async (localProjectId) =>
        localProjectId === project.id ? project : null,
      resolveManagedWorkspace: async () => null,
    }).map((registration) =>
      registration.definition.id === 'scenario.evaluate'
        ? { ...registration, handler: vi.fn(async () => toolResult) }
        : registration,
    )
    const nativeToolRegistry = createNativeToolRegistry({
      tools: registrations,
      clock: tickingClock(
        '2026-08-12T20:30:04.000Z',
        '2026-08-12T20:30:05.000Z',
        '2026-08-12T20:30:06.000Z',
        '2026-08-12T20:30:07.000Z',
      ),
      persistence: {
        reserveGrant: async (grant) => {
          const result = await store.reserveAgentRuntimeCapabilityGrant(grant)
          return { reserved: result.reserved }
        },
        beginExecution: async (input) => {
          const result = await store.beginAgentRuntimeToolExecution(input)
          return { consumed: result.consumed }
        },
        appendAudit: (audit) => store.appendAgentRuntimeToolAudit(audit),
      },
    })
    const runtime = createDesktopAgentRuntime({
      store,
      nativeToolRegistry,
      clock: tickingClock(
        '2026-08-12T20:30:00.000Z',
        '2026-08-12T20:30:01.000Z',
        '2026-08-12T20:30:02.000Z',
        '2026-08-12T20:30:04.000Z',
        '2026-08-12T20:30:05.000Z',
      ),
      createId: () => 'agent-runtime-native-cancel-race-1',
    })
    const started = await runtime.start({ runId: run.id, nodeId: run.currentNodeId })
    await runtime.advance(started.runtime.id)
    await runtime.advance(started.runtime.id)

    const lateAdvance = runtime.advance(started.runtime.id)
    await vi.waitFor(() =>
      expect(
        registrations.find((item) => item.definition.id === 'scenario.evaluate')?.handler,
      ).toHaveBeenCalledTimes(1),
    )
    const cancelled = await runtime.cancel(started.runtime.id)
    releaseTool({ passed: true, failures: [] })

    await expect(lateAdvance).resolves.toEqual(cancelled)
    expect(cancelled.runtime).toMatchObject({ status: 'terminal', stopReason: 'cancelled' })
    expect(await store.listAgentRuntimeToolAudits(started.runtime.id)).toMatchObject([
      { status: 'started' },
      { status: 'cancelled', code: 'cancelled' },
    ])
    store.close()
  })
})
