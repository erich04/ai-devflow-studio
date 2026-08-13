import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acceptAgentActionResult,
  assembleAgentRuntimeContext,
  createAgentRuntime,
  createWarnOnlyDefaultPolicy,
  createWorkflowRunFromRequest,
  requestAgentAction,
  resumeAgentRuntime,
  resolveEffectivePolicy,
  type AgentTaskGraph,
  type CoordinationSessionRequest,
} from '@ai-devflow/shared'
import { createLocalStore } from './local-store'
import { createSpecialistRuntimeCoordinator } from './specialist-runtime-coordinator'
import { createSpecialistTaskAuthorityBroker } from './specialist-task-authority'

const tempDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

async function authorityFixture(
  capabilityIds = ['repository_read'],
  withDependentTask = false,
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'devflow-specialist-authority-'))
  tempDirs.push(dir)
  const dbPath = path.join(dir, 'devflow.sqlite')
  const store = await createLocalStore({ dbPath })
  const now = '2026-08-13T15:00:00.000Z'
  const deadline = '2026-08-13T15:10:00.000Z'
  const project = {
    id: 'specialist-local-project-1',
    name: 'specialist-authority-fixture',
    path: '/tmp/specialist-authority-fixture',
    packageManager: 'pnpm' as const,
    detectedTestCommand: 'pnpm test',
    testCommand: 'pnpm test',
    createdAt: now,
    updatedAt: now,
  }
  const run = createWorkflowRunFromRequest({
    runId: 'specialist-run-1',
    title: 'Coordinate one bounded Specialist',
    request: 'Analyze one exact contract under Supervisor authority.',
    projectId: project.id,
    creatorId: 'specialist-user-1',
    branchName: 'devflow/specialist-authority-1',
    now,
  }).run
  const pairing = {
    tokenId: 'specialist-session-1',
    organizationId: 'specialist-org-1',
    projectId: 'specialist-team-project-1',
    userId: run.creatorId,
    role: 'owner' as const,
    authAccountId: 'specialist-account-1',
    projectMemberships: [{
      projectId: 'specialist-team-project-1',
      userId: run.creatorId,
      role: 'owner' as const,
    }],
    createdAt: now,
    localProjectId: project.id,
  }
  await store.upsertProject(project)
  await store.saveRun(run)
  await store.saveDesktopPairingCredential(pairing, 'encrypted-specialist-token')
  const organizationPolicy = createWarnOnlyDefaultPolicy({
    organizationId: pairing.organizationId,
    updatedAt: now,
  })
  const policy = {
    projectId: project.id,
    organizationPolicy,
    projectOverride: null,
    effectivePolicy: resolveEffectivePolicy(organizationPolicy, null),
    version: organizationPolicy.version,
    updatedAt: now,
    syncedAt: now,
    source: 'remote_cache' as const,
  }
  await store.savePolicySnapshot(policy)

  const supervisorRuntimeId = 'specialist-supervisor-runtime-1'
  const scope = {
    kind: 'team' as const,
    organizationId: pairing.organizationId,
    projectId: pairing.projectId,
    userId: pairing.userId,
    sessionId: pairing.tokenId,
    localProjectId: project.id,
  }
  const authority = {
    runId: run.id,
    nodeId: run.currentNodeId,
    runVersion: run.version,
    policyVersion: 1,
  }
  const contextAttachment = await assembleAgentRuntimeContext({
    id: 'specialist-supervisor-context-1',
    runtimeId: supervisorRuntimeId,
    checkpointVersion: 1,
    scope,
    authority,
    citationSources: [],
    memorySources: [],
    attachedAt: now,
  })
  const supervisor = createAgentRuntime({
    stateVersion: 1,
    id: supervisorRuntimeId,
    scope,
    authority,
    contextDigest: contextAttachment.contextDigest,
    capabilitySetDigest: 'b'.repeat(64),
    bounds: {
      maxSteps: 4,
      maxWallTimeMs: 10 * 60_000,
      maxToolCalls: 4,
      maxToolResultBytes: 64 * 1_024,
      maxTrajectoryMetadataBytes: 16 * 1_024,
      maxCheckpointBytes: 128 * 1_024,
      maxTokens: 10_000,
      maxCostUsd: 1,
    },
    requestedAt: now,
    deadline,
  })
  await store.commitAgentRuntimeTransition({
    expectedRuntime: null,
    transition: supervisor,
    contextAttachment,
  })

  const coordination: CoordinationSessionRequest = {
    stateVersion: 1,
    id: 'specialist-coordination-1',
    scope: {
      organizationId: pairing.organizationId,
      projectId: pairing.projectId,
      userId: pairing.userId,
      sessionId: pairing.tokenId,
      localProjectId: project.id,
    },
    authority: {
      ...authority,
      supervisorRuntimeId,
      supervisorRuntimeVersion: supervisor.runtime.version,
    },
    contextDigest: supervisor.runtime.contextDigest,
    capabilitySetDigest: supervisor.runtime.capabilitySetDigest,
    bounds: {
      maxSpecialists: 2,
      maxTaskNodes: 2,
      maxDependencyEdges: 1,
      maxDelegationDepth: 1,
      maxParallelSpecialists: 2,
      maxAcceptedHandoffs: 1,
      maxSpecialistRetries: 1,
      maxHandoffSummaryBytes: 4_096,
      maxSteps: 4,
      maxWallTimeMs: 10 * 60_000,
      maxToolCalls: 4,
      maxTokens: 10_000,
      maxCostUsd: 1,
    },
    requestedAt: now,
    deadline,
  }
  const graph: AgentTaskGraph = {
    stateVersion: 1,
    id: 'specialist-graph-1',
    coordinationId: coordination.id,
    version: 1,
    entryTaskIds: ['specialist-task-1'],
    nodes: [
      {
        id: 'specialist-task-1',
        roleId: 'contract-analyst',
        contextDigest: 'c'.repeat(64),
        capabilityIds,
        resourceRequirements: [{
          resourceId: 'specialist-repository-1',
          resourceDigest: 'd'.repeat(64),
          mode: 'read',
        }],
      },
      ...(withDependentTask ? [{
        id: 'specialist-task-2',
        roleId: 'test-analyst',
        contextDigest: 'e'.repeat(64),
        capabilityIds: ['repository_read'],
        resourceRequirements: [{
          resourceId: 'specialist-repository-1',
          resourceDigest: 'd'.repeat(64),
          mode: 'read' as const,
        }],
      }] : []),
    ],
    edges: withDependentTask ? [{
      id: 'specialist-edge-1-2',
      sourceTaskId: 'specialist-task-1',
      targetTaskId: 'specialist-task-2',
    }] : [],
  }
  await expect(store.createCoordinationSession({
    coordination,
    graph,
    startedAt: now,
  })).resolves.toMatchObject({ committed: true, replayed: false })

  return {
    store,
    dbPath,
    coordination,
    graph,
    run,
    pairing,
    policy,
    supervisor: supervisor.runtime,
    now,
  }
}

describe('Specialist task authority broker', () => {
  it('derives one opaque main-owned authority and rechecks it before child creation', async () => {
    const fixture = await authorityFixture()
    const broker = createSpecialistTaskAuthorityBroker({ store: fixture.store })
    const authorization = await broker.authorize({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: 1,
      taskId: fixture.graph.nodes[0]!.id,
      expectedTaskVersion: 1,
      now: fixture.now,
    })

    expect(authorization.task).toMatchObject({
      coordinationId: fixture.coordination.id,
      sessionVersion: 1,
      graphId: fixture.graph.id,
      graphVersion: 1,
      taskId: fixture.graph.nodes[0]!.id,
      taskVersion: 1,
      roleId: 'contract-analyst',
      roleVersion: 1,
      capabilityIds: ['repository_read'],
      supervisorRuntimeId: fixture.coordination.authority.supervisorRuntimeId,
      supervisorRuntimeVersion: 1,
    })
    expect(JSON.stringify(authorization.capability)).toBe('{}')
    await expect(broker.resolve(authorization.capability, fixture.now)).resolves.toEqual(
      authorization.task,
    )
    await expect(broker.resolve({}, fixture.now)).rejects.toThrowError(
      'specialist_task_authority_invalid',
    )

    await fixture.store.saveDesktopPairingCredential({
      ...fixture.pairing,
      tokenId: 'specialist-session-rotated',
      createdAt: '2026-08-13T15:00:01.000Z',
    }, 'rotated-encrypted-token')
    await expect(broker.resolve(authorization.capability, fixture.now)).rejects.toThrowError(
      'specialist_task_authority_invalid',
    )
    fixture.store.close()
  })

  it('rejects a role capability escalation before issuing authority', async () => {
    const fixture = await authorityFixture(['managed_workspace_edit'])
    const broker = createSpecialistTaskAuthorityBroker({ store: fixture.store })

    await expect(broker.authorize({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: 1,
      taskId: fixture.graph.nodes[0]!.id,
      expectedTaskVersion: 1,
      now: fixture.now,
    })).rejects.toThrowError('specialist_task_authority_invalid')
    fixture.store.close()
  })

  it('rejects stale Supervisor Context without returning an opaque authority', async () => {
    const fixture = await authorityFixture()
    vi.spyOn(fixture.store, 'isAgentRuntimeContextCurrent').mockResolvedValue(false)
    const broker = createSpecialistTaskAuthorityBroker({ store: fixture.store })

    await expect(broker.authorize({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: 1,
      taskId: fixture.graph.nodes[0]!.id,
      expectedTaskVersion: 1,
      now: fixture.now,
    })).rejects.toThrowError('specialist_task_authority_invalid')
    fixture.store.close()
  })

  it('rechecks Workflow, policy, and Supervisor versions on every capability use', async () => {
    const fixture = await authorityFixture()
    const broker = createSpecialistTaskAuthorityBroker({ store: fixture.store })
    const authorization = await broker.authorize({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: 1,
      taskId: fixture.graph.nodes[0]!.id,
      expectedTaskVersion: 1,
      now: fixture.now,
    })

    const runSpy = vi.spyOn(fixture.store, 'getRun').mockResolvedValue({
      ...fixture.run,
      version: fixture.run.version + 1,
    })
    await expect(broker.resolve(authorization.capability, fixture.now)).rejects.toThrowError(
      'specialist_task_authority_invalid',
    )
    runSpy.mockRestore()

    const policySpy = vi.spyOn(fixture.store, 'getPolicySnapshot').mockResolvedValue({
      ...fixture.policy,
      version: fixture.policy.version + 1,
    })
    await expect(broker.resolve(authorization.capability, fixture.now)).rejects.toThrowError(
      'specialist_task_authority_invalid',
    )
    policySpy.mockRestore()

    vi.spyOn(fixture.store, 'getAgentRuntime').mockResolvedValue({
      ...fixture.supervisor,
      version: fixture.supervisor.version + 1,
    })
    await expect(broker.resolve(authorization.capability, fixture.now)).rejects.toThrowError(
      'specialist_task_authority_invalid',
    )
    fixture.store.close()
  })
})

describe('Specialist Runtime coordinator', () => {
  it('atomically binds one attenuated child Runtime to the exact ready task', async () => {
    const fixture = await authorityFixture()
    const broker = createSpecialistTaskAuthorityBroker({ store: fixture.store })
    const ids = {
      allocation: 'specialist-allocation-main-1',
      agent: 'specialist-agent-main-1',
      runtime: 'specialist-runtime-main-1',
      context: 'specialist-runtime-context-main-1',
    }
    const coordinator = createSpecialistRuntimeCoordinator({
      store: fixture.store,
      authorityBroker: broker,
      clock: () => fixture.now,
      createId: (kind) => ids[kind],
    })

    const started = await coordinator.start({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: 1,
      taskId: fixture.graph.nodes[0]!.id,
      expectedTaskVersion: 1,
    })

    expect(started.runtime).toMatchObject({
      id: ids.runtime,
      status: 'checkpointed',
      version: 1,
      scope: {
        kind: 'team',
        organizationId: fixture.coordination.scope.organizationId,
        projectId: fixture.coordination.scope.projectId,
        userId: fixture.coordination.scope.userId,
        sessionId: fixture.coordination.scope.sessionId,
        localProjectId: fixture.coordination.scope.localProjectId,
      },
      authority: {
        runId: fixture.coordination.authority.runId,
        nodeId: fixture.coordination.authority.nodeId,
        runVersion: fixture.coordination.authority.runVersion,
        policyVersion: fixture.coordination.authority.policyVersion,
      },
      bounds: {
        maxSteps: 2,
        maxWallTimeMs: 120_000,
        maxToolCalls: 2,
        maxTokens: 5_000,
        maxCostUsd: 0.5,
      },
    })
    expect(started.coordination.tasks[0]).toMatchObject({
      id: fixture.graph.nodes[0]!.id,
      version: 2,
      status: 'running',
      agentId: ids.agent,
      runtimeId: ids.runtime,
      runtimeVersion: 1,
    })
    await expect(fixture.store.getAgentRuntime(ids.runtime)).resolves.toEqual(started.runtime)
    await expect(fixture.store.getAgentRuntimeContextAttachment(ids.runtime)).resolves.toMatchObject({
      id: ids.context,
      runtimeId: ids.runtime,
      knowledgeCitations: [],
      memoryRevisions: [],
    })
    await expect(fixture.store.getCoordinationSession(fixture.coordination.id)).resolves.toMatchObject({
      state: started.coordination,
    })
    await expect(fixture.store.listAgentRuntimeEvents(ids.runtime)).resolves.toHaveLength(3)
    fixture.store.close()
  })

  it('rejects an opaque authority at a foreign LocalStore without partial writes', async () => {
    const fixture = await authorityFixture()
    const foreignDir = await mkdtemp(path.join(os.tmpdir(), 'devflow-specialist-foreign-'))
    tempDirs.push(foreignDir)
    const foreignStore = await createLocalStore({
      dbPath: path.join(foreignDir, 'devflow.sqlite'),
    })
    const runtimeId = 'specialist-runtime-foreign-1'
    const broker = createSpecialistTaskAuthorityBroker({ store: fixture.store })
    const coordinator = createSpecialistRuntimeCoordinator({
      store: foreignStore,
      authorityBroker: broker,
      clock: () => fixture.now,
      createId: (kind) => ({
        allocation: 'specialist-allocation-foreign-1',
        agent: 'specialist-agent-foreign-1',
        runtime: runtimeId,
        context: 'specialist-runtime-context-foreign-1',
      })[kind],
    })

    await expect(coordinator.start({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: 1,
      taskId: fixture.graph.nodes[0]!.id,
      expectedTaskVersion: 1,
    })).rejects.toThrowError('specialist_runtime_start_failed')

    await expect(foreignStore.getAgentRuntime(runtimeId)).resolves.toBeNull()
    await expect(foreignStore.getAgentRuntimeContextAttachment(runtimeId)).resolves.toBeNull()
    await expect(fixture.store.getCoordinationSession(fixture.coordination.id)).resolves.toMatchObject({
      state: {
        version: 1,
        tasks: [{
          id: fixture.graph.nodes[0]!.id,
          version: 1,
          status: 'ready',
          agentId: null,
          runtimeId: null,
          runtimeVersion: null,
        }],
      },
    })
    foreignStore.close()
    fixture.store.close()
  })

  it('lets one concurrent start win the task and creates one child Runtime', async () => {
    const fixture = await authorityFixture()
    const runtimeId = 'specialist-runtime-concurrent-1'
    const coordinator = createSpecialistRuntimeCoordinator({
      store: fixture.store,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: fixture.store }),
      clock: () => fixture.now,
      createId: (kind) => ({
        allocation: 'specialist-allocation-concurrent-1',
        agent: 'specialist-agent-concurrent-1',
        runtime: runtimeId,
        context: 'specialist-runtime-context-concurrent-1',
      })[kind],
    })
    const request = {
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: 1,
      taskId: fixture.graph.nodes[0]!.id,
      expectedTaskVersion: 1,
    }

    const results = await Promise.allSettled([
      coordinator.start(request),
      coordinator.start(request),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    await expect(fixture.store.getAgentRuntime(runtimeId)).resolves.toMatchObject({
      id: runtimeId,
      version: 1,
    })
    await expect(fixture.store.listAgentRuntimeEvents(runtimeId)).resolves.toHaveLength(3)
    await expect(fixture.store.getCoordinationSession(fixture.coordination.id)).resolves.toMatchObject({
      state: {
        version: 2,
        tasks: [{
          id: fixture.graph.nodes[0]!.id,
          version: 2,
          status: 'running',
          runtimeId,
          runtimeVersion: 1,
        }],
      },
    })
    fixture.store.close()
  })

  it('atomically persists one terminal result and handoff before joining its dependency', async () => {
    const fixture = await authorityFixture(['repository_read'], true)
    const ids = {
      allocation: 'specialist-allocation-completion-1',
      agent: 'specialist-agent-completion-1',
      runtime: 'specialist-runtime-completion-1',
      context: 'specialist-runtime-context-completion-1',
    }
    const coordinator = createSpecialistRuntimeCoordinator({
      store: fixture.store,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: fixture.store }),
      clock: () => fixture.now,
      createId: (kind) => ids[kind],
    })
    const started = await coordinator.start({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: 1,
      taskId: 'specialist-task-1',
      expectedTaskVersion: 1,
    })
    const resumed = resumeAgentRuntime({
      runtime: started.runtime,
      expectedCheckpointVersion: started.runtime.checkpointVersion,
      authority: started.runtime.authority,
      contextDigest: started.runtime.contextDigest,
      capabilitySetDigest: started.runtime.capabilitySetDigest,
      now: '2026-08-13T15:00:01.000Z',
    })
    await fixture.store.commitAgentRuntimeTransition({
      expectedRuntime: started.runtime,
      transition: resumed,
    })
    const waiting = requestAgentAction({
      runtime: resumed.runtime,
      expectedCheckpointVersion: resumed.runtime.checkpointVersion,
      now: '2026-08-13T15:00:02.000Z',
      action: {
        id: 'specialist-action-completion-1',
        kind: 'tool',
        capabilityId: 'repository_read',
        capabilityVersion: 1,
        requestDigest: '4'.repeat(64),
        requiresPermission: false,
      },
    })
    await fixture.store.commitAgentRuntimeTransition({
      expectedRuntime: resumed.runtime,
      transition: waiting,
    })
    const resultDigest = '5'.repeat(64)
    const terminal = acceptAgentActionResult({
      runtime: waiting.runtime,
      expectedCheckpointVersion: waiting.runtime.checkpointVersion,
      actionId: waiting.runtime.activeAction!.id,
      requestDigest: waiting.runtime.activeAction!.requestDigest,
      result: {
        outcome: 'success',
        resultDigest,
        resultBytes: 128,
        tokens: 200,
        costUsd: 0.1,
        evaluation: 'success',
        evaluationSummary: 'The exact contract was validated with bounded evidence.',
      },
      now: '2026-08-13T15:00:03.000Z',
    })

    const completionInput: Parameters<typeof coordinator.complete>[0] = {
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: started.coordination.version,
      taskId: 'specialist-task-1',
      expectedTaskVersion: 2,
      expectedRuntimeVersion: waiting.runtime.version,
      transition: terminal,
      evidenceDigests: ['6'.repeat(64)],
      resourceLeaseOutcome: 'not_required',
      handoffs: [{
        id: 'specialist-handoff-completion-1',
        targetTaskId: 'specialist-task-2',
        expectedTargetTaskVersion: 1,
        summary: 'The contract analysis completed with one bounded Evidence reference.',
      }],
    }
    await expect(coordinator.complete({
      ...completionInput,
      handoffs: [{
        ...completionInput.handoffs[0]!,
        targetTaskId: 'specialist-task-1',
      }],
    })).rejects.toThrowError('specialist_runtime_completion_failed')
    await expect(fixture.store.getAgentRuntime(ids.runtime)).resolves.toEqual(waiting.runtime)
    await expect(fixture.store.getCoordinationSession(fixture.coordination.id)).resolves.toMatchObject({
      state: started.coordination,
    })
    const completed = await coordinator.complete(completionInput)

    expect(completed.runtime).toMatchObject({
      id: ids.runtime,
      version: terminal.runtime.version,
      status: 'terminal',
      stopReason: 'success',
      lastResultDigest: resultDigest,
    })
    expect(completed.coordination).toMatchObject({
      version: 4,
      status: 'running',
      counters: {
        specialistStarts: 1,
        activeSpecialists: 0,
        acceptedHandoffs: 1,
        steps: 1,
        toolCalls: 1,
        tokens: 200,
        costUsd: 0.1,
      },
      tasks: [
        {
          id: 'specialist-task-1',
          version: 3,
          status: 'succeeded',
          runtimeId: ids.runtime,
          runtimeVersion: terminal.runtime.version,
          resultDigest,
        },
        {
          id: 'specialist-task-2',
          version: 2,
          status: 'ready',
          acceptedDependencyHandoffIds: ['specialist-handoff-completion-1'],
        },
      ],
      acceptedHandoffIds: ['specialist-handoff-completion-1'],
    })
    expect(completed.handoffs).toEqual([expect.objectContaining({
      id: 'specialist-handoff-completion-1',
      sourceTaskId: 'specialist-task-1',
      sourceTaskVersion: 3,
      sourceRuntimeId: ids.runtime,
      sourceRuntimeVersion: terminal.runtime.version,
      targetTaskId: 'specialist-task-2',
      resultDigest,
      evidenceDigests: ['6'.repeat(64)],
      contextDigest: fixture.graph.nodes[0]!.contextDigest,
      resourceLeaseOutcome: 'not_required',
    })])
    await expect(fixture.store.getAgentRuntime(ids.runtime)).resolves.toEqual(terminal.runtime)
    await expect(fixture.store.getCoordinationRecoverySnapshot(fixture.coordination.id))
      .resolves.toMatchObject({
        state: completed.coordination,
        handoffs: completed.handoffs,
        audits: [{}, {}, {}, {}],
        checkpoints: [{}, {}, {}, {}],
    })
    await expect(coordinator.complete(completionInput)).resolves.toEqual(completed)
    fixture.store.close()

    const reopenedStore = await createLocalStore({ dbPath: fixture.dbPath })
    const reopenedCoordinator = createSpecialistRuntimeCoordinator({
      store: reopenedStore,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: reopenedStore }),
    })
    await expect(reopenedCoordinator.complete(completionInput)).resolves.toEqual(completed)
    await expect(reopenedStore.getCoordinationRecoverySnapshot(fixture.coordination.id))
      .resolves.toMatchObject({
        state: completed.coordination,
        handoffs: completed.handoffs,
        audits: [{}, {}, {}, {}],
        checkpoints: [{}, {}, {}, {}],
      })
    reopenedStore.close()
  })
})
