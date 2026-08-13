import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
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
  type CoordinationResourceLease,
  type CoordinationSessionRequest,
} from '@ai-devflow/shared'
import { createLocalStore, type AgentRuntimeCapabilityGrant } from './local-store'
import type { NativeToolAuditRecord } from './native-tool-registry'
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
  withParallelTask = false,
  coordinationBudgetOverrides: Partial<CoordinationSessionRequest['bounds']> = {},
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

  const coordinationDeadline = new Date(Math.min(
    Date.parse(deadline),
    Date.parse(now) +
      (coordinationBudgetOverrides.maxWallTimeMs ?? 10 * 60_000),
  )).toISOString()
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
      ...coordinationBudgetOverrides,
    },
    requestedAt: now,
    deadline: coordinationDeadline,
  }
  const graph: AgentTaskGraph = {
    stateVersion: 1,
    id: 'specialist-graph-1',
    coordinationId: coordination.id,
    version: 1,
    entryTaskIds: withParallelTask
      ? ['specialist-task-1', 'specialist-task-2']
      : ['specialist-task-1'],
    nodes: [
      {
        id: 'specialist-task-1',
        roleId: 'contract-analyst',
        contextDigest: 'c'.repeat(64),
        capabilityIds,
        resourceRequirements: [{
          resourceId: project.id,
          resourceDigest: 'd'.repeat(64),
          mode: 'read',
        }],
      },
      ...(withDependentTask || withParallelTask ? [{
        id: 'specialist-task-2',
        roleId: 'test-analyst',
        contextDigest: 'e'.repeat(64),
        capabilityIds: ['repository_read'],
        resourceRequirements: [{
          resourceId: project.id,
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
    project,
    now,
  }
}

async function specialistToolFixture(input: {
  withLease: boolean
  toolId?: string
  leaseExpiresAt?: string
}) {
  const toolId = input.toolId ?? 'repo.read_text'
  const fixture = await authorityFixture()
  const broker = createSpecialistTaskAuthorityBroker({ store: fixture.store })
  const coordinator = createSpecialistRuntimeCoordinator({
    store: fixture.store,
    authorityBroker: broker,
    clock: () => fixture.now,
    createId: (kind) => ({
      allocation: 'specialist-allocation-tool-1',
      agent: 'specialist-agent-tool-1',
      runtime: 'specialist-runtime-tool-1',
      context: 'specialist-context-tool-1',
    })[kind],
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
      id: 'specialist-tool-action-1',
      kind: 'tool',
      capabilityId: toolId,
      capabilityVersion: 1,
      requestDigest: '4'.repeat(64),
      requiresPermission: false,
    },
  })
  await fixture.store.commitAgentRuntimeTransition({
    expectedRuntime: resumed.runtime,
    transition: waiting,
  })

  let lease: CoordinationResourceLease | null = null
  if (input.withLease) {
    lease = {
      stateVersion: 1,
      id: 'specialist-resource-lease-tool-1',
      coordinationId: fixture.coordination.id,
      taskId: 'specialist-task-1',
      taskVersion: 2,
      runtimeId: waiting.runtime.id,
      runtimeVersion: 1,
      scope: fixture.coordination.scope,
      capabilityId: 'repository_read',
      capabilityVersion: 1,
      resourceId: fixture.project.id,
      resourceDigest: 'd'.repeat(64),
      mode: 'read',
      status: 'active',
      version: 1,
      acquiredAt: '2026-08-13T15:00:02.000Z',
      expiresAt: input.leaseExpiresAt ?? '2026-08-13T15:01:02.000Z',
      releasedAt: null,
    }
    await expect(fixture.store.acquireCoordinationResourceLease({
      expectedState: started.coordination,
      lease,
    })).resolves.toEqual({ committed: true, replayed: false, lease })
  }

  const grant: AgentRuntimeCapabilityGrant = {
    stateVersion: 1,
    id: 'specialist-tool-grant-1',
    runtimeId: waiting.runtime.id,
    capabilityId: toolId,
    capabilityVersion: 1,
    requestDigest: waiting.runtime.activeAction!.requestDigest,
    permissionClass: 'read',
    resourceKind: 'local_project',
    resourceId: fixture.project.id,
    status: 'active',
    grantedAt: '2026-08-13T15:00:03.000Z',
    expiresAt: '2026-08-13T15:01:00.000Z',
    settledAt: null,
  }
  await expect(fixture.store.reserveAgentRuntimeCapabilityGrant(grant)).resolves.toEqual({
    reserved: true,
    grant,
  })
  const audit: NativeToolAuditRecord = {
    stateVersion: 1,
    id: 'specialist-tool-audit-start-1',
    runtimeId: waiting.runtime.id,
    actionId: waiting.runtime.activeAction!.id,
    grantId: grant.id,
    organizationId: waiting.runtime.scope.organizationId,
    projectId: waiting.runtime.scope.projectId,
    userId: waiting.runtime.scope.userId,
    sessionId: waiting.runtime.scope.sessionId,
    localProjectId: waiting.runtime.scope.localProjectId,
    toolId: grant.capabilityId,
    toolVersion: grant.capabilityVersion,
    source: 'native',
    installationId: null,
    installationVersion: null,
    permissionClass: grant.permissionClass,
    sideEffectClass: 'none',
    resourceKind: grant.resourceKind,
    resourceId: grant.resourceId,
    status: 'started',
    code: null,
    inputDigest: grant.requestDigest,
    resultDigest: null,
    resultBytes: null,
    redactionState: 'not_recorded',
    createdAt: '2026-08-13T15:00:04.000Z',
  }
  return { ...fixture, started, waiting: waiting.runtime, lease, grant, audit }
}

async function specialistLeaseCompletionFixture() {
  const fixture = await specialistToolFixture({ withLease: true })
  await expect(fixture.store.beginAgentRuntimeToolExecution({
    expectedGrant: fixture.grant,
    audit: fixture.audit,
  })).resolves.toEqual({ consumed: true })
  const terminal = acceptAgentActionResult({
    runtime: fixture.waiting,
    expectedCheckpointVersion: fixture.waiting.checkpointVersion,
    actionId: fixture.waiting.activeAction!.id,
    requestDigest: fixture.waiting.activeAction!.requestDigest,
    result: {
      outcome: 'success',
      resultDigest: '5'.repeat(64),
      resultBytes: 128,
      tokens: 200,
      costUsd: 0.1,
      evaluation: 'success',
      evaluationSummary: 'The leased repository read completed with bounded evidence.',
    },
    now: '2026-08-13T15:00:05.000Z',
  })
  const coordinator = createSpecialistRuntimeCoordinator({
    store: fixture.store,
    authorityBroker: createSpecialistTaskAuthorityBroker({ store: fixture.store }),
  })
  const completionInput: Parameters<typeof coordinator.complete>[0] = {
    coordinationId: fixture.coordination.id,
    expectedSessionVersion: fixture.started.coordination.version,
    taskId: 'specialist-task-1',
    expectedTaskVersion: 2,
    expectedRuntimeVersion: fixture.waiting.version,
    transition: terminal,
    evidenceDigests: [],
    resourceLeaseOutcome: 'released',
    handoffs: [],
  }
  return { ...fixture, coordinator, terminal, completionInput }
}

async function specialistLeaseRecoveryFixture() {
  const fixture = await specialistToolFixture({ withLease: true })
  await expect(fixture.store.beginAgentRuntimeToolExecution({
    expectedGrant: fixture.grant,
    audit: fixture.audit,
  })).resolves.toEqual({ consumed: true })
  const terminal = acceptAgentActionResult({
    runtime: fixture.waiting,
    expectedCheckpointVersion: fixture.waiting.checkpointVersion,
    actionId: fixture.waiting.activeAction!.id,
    requestDigest: fixture.waiting.activeAction!.requestDigest,
    result: {
      outcome: 'failure',
      resultDigest: '6'.repeat(64),
      resultBytes: 128,
      tokens: 100,
      costUsd: 0.05,
      evaluation: 'failure',
      evaluationSummary: 'The idempotent leased repository read failed before producing a result.',
    },
    now: '2026-08-13T15:00:05.000Z',
  })
  const coordinator = createSpecialistRuntimeCoordinator({
    store: fixture.store,
    authorityBroker: createSpecialistTaskAuthorityBroker({ store: fixture.store }),
  })
  const recoveryInput: Parameters<typeof coordinator.recover>[0] = {
    recoveryId: 'specialist-lease-recovery-1',
    coordinationId: fixture.coordination.id,
    expectedSessionVersion: fixture.started.coordination.version,
    taskId: 'specialist-task-1',
    expectedTaskVersion: 2,
    expectedRuntimeVersion: fixture.waiting.version,
    transition: terminal,
  }
  return { ...fixture, coordinator, terminal, recoveryInput }
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

  it('subtracts active child Runtime reservations before authorizing a parallel task', async () => {
    const fixture = await authorityFixture(['repository_read'], false, true)
    const broker = createSpecialistTaskAuthorityBroker({ store: fixture.store })
    const coordinator = createSpecialistRuntimeCoordinator({
      store: fixture.store,
      authorityBroker: broker,
      clock: () => fixture.now,
      createId: (kind) => ({
        allocation: 'specialist-allocation-budget-a',
        agent: 'specialist-agent-budget-a',
        runtime: 'specialist-runtime-budget-a',
        context: 'specialist-context-budget-a',
      })[kind],
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
    const second = await broker.authorize({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: started.coordination.version,
      taskId: 'specialist-task-2',
      expectedTaskVersion: 1,
      now: fixture.now,
    })

    expect(second.task.remainingBudget).toEqual({
      maxSteps: 2,
      maxWallTimeMs: 8 * 60_000,
      maxToolCalls: 2,
      maxTokens: 5_000,
      maxCostUsd: 0.5,
    })
    fixture.store.close()
  })

  it('stops before a second child Runtime at the exact shared allocation boundary', async () => {
    const fixture = await authorityFixture(['repository_read'], false, true, {
      maxSteps: 2,
      maxWallTimeMs: 2 * 60_000,
      maxToolCalls: 2,
      maxTokens: 5_000,
      maxCostUsd: 0.5,
    })
    const broker = createSpecialistTaskAuthorityBroker({ store: fixture.store })
    const startCommit = vi.spyOn(fixture.store, 'commitSpecialistRuntimeStart')
    const ids = [
      {
        allocation: 'specialist-allocation-boundary-a',
        agent: 'specialist-agent-boundary-a',
        runtime: 'specialist-runtime-boundary-a',
        context: 'specialist-context-boundary-a',
      },
      {
        allocation: 'specialist-allocation-boundary-b',
        agent: 'specialist-agent-boundary-b',
        runtime: 'specialist-runtime-boundary-b',
        context: 'specialist-context-boundary-b',
      },
    ]
    let startIndex = 0
    const coordinator = createSpecialistRuntimeCoordinator({
      store: fixture.store,
      authorityBroker: broker,
      clock: () => fixture.now,
      createId: (kind) => ids[startIndex]![kind],
    })
    const first = await coordinator.start({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: 1,
      taskId: 'specialist-task-1',
      expectedTaskVersion: 1,
    })
    startIndex = 1
    await expect(coordinator.start({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: first.coordination.version,
      taskId: 'specialist-task-2',
      expectedTaskVersion: 1,
    })).rejects.toThrowError('specialist_runtime_start_failed')
    expect(startCommit).toHaveBeenCalledTimes(1)
    await expect(fixture.store.getAgentRuntime(
      'specialist-runtime-boundary-b',
    )).resolves.toBeNull()
    fixture.store.close()
  })
})

describe('Specialist Runtime coordinator', () => {
  it('does not consume a Specialist Tool grant without an exact active resource lease', async () => {
    const fixture = await specialistToolFixture({ withLease: false })

    await expect(fixture.store.beginAgentRuntimeToolExecution({
      expectedGrant: fixture.grant,
      audit: fixture.audit,
    })).resolves.toEqual({ consumed: false, reason: 'grant_stale' })
    await expect(fixture.store.listAgentRuntimeCapabilityGrants(fixture.waiting.id))
      .resolves.toEqual([fixture.grant])
    await expect(fixture.store.listAgentRuntimeToolAudits(fixture.waiting.id))
      .resolves.toEqual([])
    fixture.store.close()
  })

  it('atomically consumes one Specialist Tool grant under its exact active resource lease', async () => {
    const fixture = await specialistToolFixture({ withLease: true })

    await expect(fixture.store.beginAgentRuntimeToolExecution({
      expectedGrant: fixture.grant,
      audit: fixture.audit,
    })).resolves.toEqual({ consumed: true })
    await expect(fixture.store.reserveAgentRuntimeCapabilityGrant({
      ...fixture.grant,
      id: 'specialist-tool-grant-duplicate-action',
    })).resolves.toEqual({ reserved: false, reason: 'grant_exists' })
    await expect(fixture.store.listAgentRuntimeCapabilityGrants(fixture.waiting.id))
      .resolves.toEqual([{
        ...fixture.grant,
        status: 'consumed',
        settledAt: fixture.audit.createdAt,
      }])
    await expect(fixture.store.listAgentRuntimeToolAudits(fixture.waiting.id))
      .resolves.toEqual([fixture.audit])
    await expect(fixture.store.getCoordinationRecoverySnapshot(fixture.coordination.id))
      .resolves.toMatchObject({ leases: [fixture.lease] })
    fixture.store.close()
  })

  it('rejects an unknown Specialist Tool without consuming its grant', async () => {
    const fixture = await specialistToolFixture({
      withLease: true,
      toolId: 'renderer.tool',
    })

    await expect(fixture.store.beginAgentRuntimeToolExecution({
      expectedGrant: fixture.grant,
      audit: fixture.audit,
    })).resolves.toEqual({ consumed: false, reason: 'grant_stale' })
    await expect(fixture.store.listAgentRuntimeCapabilityGrants(fixture.waiting.id))
      .resolves.toEqual([fixture.grant])
    await expect(fixture.store.listAgentRuntimeToolAudits(fixture.waiting.id))
      .resolves.toEqual([])
    fixture.store.close()
  })

  it('requires the Tool grant lifetime to remain inside the Specialist lease', async () => {
    const fixture = await specialistToolFixture({
      withLease: true,
      leaseExpiresAt: '2026-08-13T15:00:30.000Z',
    })

    await expect(fixture.store.beginAgentRuntimeToolExecution({
      expectedGrant: fixture.grant,
      audit: fixture.audit,
    })).resolves.toEqual({ consumed: false, reason: 'grant_stale' })
    await expect(fixture.store.listAgentRuntimeCapabilityGrants(fixture.waiting.id))
      .resolves.toEqual([fixture.grant])
    await expect(fixture.store.listAgentRuntimeToolAudits(fixture.waiting.id))
      .resolves.toEqual([])
    fixture.store.close()
  })

  it('rechecks Supervisor authority immediately before a Specialist Tool side effect', async () => {
    const fixture = await specialistToolFixture({ withLease: true })
    await fixture.store.saveDesktopPairingCredential({
      ...fixture.pairing,
      tokenId: 'specialist-session-rotated-before-tool',
      createdAt: '2026-08-13T15:00:03.500Z',
    }, 'rotated-before-tool-token')

    await expect(fixture.store.beginAgentRuntimeToolExecution({
      expectedGrant: fixture.grant,
      audit: fixture.audit,
    })).resolves.toEqual({ consumed: false, reason: 'grant_stale' })
    await expect(fixture.store.listAgentRuntimeCapabilityGrants(fixture.waiting.id))
      .resolves.toEqual([fixture.grant])
    await expect(fixture.store.listAgentRuntimeToolAudits(fixture.waiting.id))
      .resolves.toEqual([])
    fixture.store.close()
  })

  it('refuses to commit a Specialist result while its resource lease remains active', async () => {
    const fixture = await specialistLeaseCompletionFixture()

    await expect(fixture.coordinator.complete(fixture.completionInput))
      .rejects.toThrowError('specialist_runtime_completion_failed')
    await expect(fixture.store.getAgentRuntime(fixture.waiting.id))
      .resolves.toEqual(fixture.waiting)
    await expect(fixture.store.getCoordinationSession(fixture.coordination.id))
      .resolves.toMatchObject({ state: fixture.started.coordination })
    fixture.store.close()
  })

  it('commits a Specialist result only after its exact lease is durably released', async () => {
    const fixture = await specialistLeaseCompletionFixture()
    await expect(fixture.store.settleCoordinationResourceLease({
      expectedState: fixture.started.coordination,
      expectedLease: fixture.lease!,
      outcome: 'released',
      now: '2026-08-13T15:00:04.500Z',
    })).resolves.toMatchObject({
      committed: true,
      replayed: false,
      lease: { status: 'released', version: 2 },
    })

    const completed = await fixture.coordinator.complete(fixture.completionInput)
    expect(completed).toMatchObject({
      runtime: fixture.terminal.runtime,
      coordination: {
        status: 'terminal',
        tasks: [{ status: 'succeeded' }],
      },
    })
    await expect(fixture.coordinator.complete(fixture.completionInput)).resolves.toEqual(completed)
    fixture.store.close()
  })

  it('refuses to replace a failed Specialist while its resource lease remains active', async () => {
    const fixture = await specialistLeaseRecoveryFixture()

    await expect(fixture.coordinator.recover(fixture.recoveryInput))
      .rejects.toThrowError('specialist_runtime_recovery_failed')
    await expect(fixture.store.getAgentRuntime(fixture.waiting.id))
      .resolves.toEqual(fixture.waiting)
    await expect(fixture.store.getCoordinationSession(fixture.coordination.id))
      .resolves.toMatchObject({ state: fixture.started.coordination })
    fixture.store.close()
  })

  it('replaces one failed read-only Specialist after its exact lease is released', async () => {
    const fixture = await specialistLeaseRecoveryFixture()
    await expect(fixture.store.settleCoordinationResourceLease({
      expectedState: fixture.started.coordination,
      expectedLease: fixture.lease!,
      outcome: 'released',
      now: '2026-08-13T15:00:04.500Z',
    })).resolves.toMatchObject({ committed: true, replayed: false })

    await expect(fixture.coordinator.recover(fixture.recoveryInput)).resolves.toMatchObject({
      failedRuntime: fixture.terminal.runtime,
      runtime: {
        status: 'checkpointed',
        bounds: {
          maxSteps: 1,
          maxToolCalls: 1,
          maxTokens: 4_900,
          maxCostUsd: 0.45,
        },
      },
      coordination: {
        status: 'running',
        counters: { retries: 1, activeSpecialists: 1 },
      },
    })
    fixture.store.close()
  })

  it('durably cancels every child boundary before invoking the live Runtime cancellation hook', async () => {
    const fixture = await specialistToolFixture({ withLease: true })
    const cancellationHook = vi.fn(async (runtimeIds: string[]) => {
      await expect(fixture.store.getCoordinationRecoverySnapshot(fixture.coordination.id))
        .resolves.toMatchObject({
          state: { status: 'terminal', stopReason: 'cancelled' },
          leases: [{ status: 'cancelled', version: 2 }],
        })
      await expect(fixture.store.getAgentRuntime(fixture.waiting.id)).resolves.toMatchObject({
        status: 'terminal',
        stopReason: 'cancelled',
      })
      expect(runtimeIds).toEqual([fixture.waiting.id])
    })
    const coordinator = createSpecialistRuntimeCoordinator({
      store: fixture.store,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: fixture.store }),
      cancelRuntimeEffects: cancellationHook,
    })
    const cancellationInput = {
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: fixture.started.coordination.version,
      now: '2026-08-13T15:00:04.500Z',
    }

    const cancelled = await coordinator.cancel(cancellationInput)
    expect(cancelled).toMatchObject({
      coordination: {
        status: 'terminal',
        stopReason: 'cancelled',
        tasks: [{ status: 'cancelled' }],
      },
      runtimes: [{ id: fixture.waiting.id, status: 'terminal', stopReason: 'cancelled' }],
      leases: [{ id: fixture.lease!.id, status: 'cancelled', version: 2 }],
    })
    await expect(fixture.store.listAgentRuntimeCapabilityGrants(fixture.waiting.id))
      .resolves.toEqual([{ ...fixture.grant, status: 'cancelled', settledAt: cancellationInput.now }])
    await expect(fixture.store.beginAgentRuntimeToolExecution({
      expectedGrant: fixture.grant,
      audit: fixture.audit,
    })).resolves.toEqual({ consumed: false, reason: 'grant_stale' })
    await expect(coordinator.cancel(cancellationInput)).resolves.toEqual(cancelled)
    expect(cancellationHook).toHaveBeenCalledTimes(2)
    fixture.store.close()

    const reopenedStore = await createLocalStore({ dbPath: fixture.dbPath })
    const reopenedCancellationHook = vi.fn(async (runtimeIds: string[]) => {
      await expect(reopenedStore.getCoordinationRecoverySnapshot(fixture.coordination.id))
        .resolves.toMatchObject({
          state: { status: 'terminal', stopReason: 'cancelled' },
          leases: [{ status: 'cancelled', version: 2 }],
        })
      expect(runtimeIds).toEqual([fixture.waiting.id])
    })
    const reopenedCoordinator = createSpecialistRuntimeCoordinator({
      store: reopenedStore,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: reopenedStore }),
      cancelRuntimeEffects: reopenedCancellationHook,
    })
    await expect(reopenedCoordinator.cancel(cancellationInput)).resolves.toEqual(cancelled)
    expect(cancellationHook).toHaveBeenCalledTimes(2)
    expect(reopenedCancellationHook).toHaveBeenCalledTimes(1)
    reopenedStore.close()
  })

  it('terminalizes one in-flight Tool audit and rejects a late Specialist result after cancellation', async () => {
    const fixture = await specialistLeaseCompletionFixture()
    const coordinator = createSpecialistRuntimeCoordinator({
      store: fixture.store,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: fixture.store }),
    })
    const cancellationInput = {
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: fixture.started.coordination.version,
      now: '2026-08-13T15:00:04.500Z',
    }

    await expect(coordinator.cancel(cancellationInput)).resolves.toMatchObject({
      coordination: { status: 'terminal', stopReason: 'cancelled' },
      runtimes: [{ status: 'terminal', stopReason: 'cancelled' }],
      leases: [{ status: 'cancelled' }],
    })
    const cancelledAudit = {
      ...fixture.audit,
      id: expect.stringMatching(/^specialist-tool-cancel-/u),
      status: 'cancelled' as const,
      code: 'cancelled' as const,
      createdAt: cancellationInput.now,
    }
    await expect(fixture.store.listAgentRuntimeToolAudits(fixture.waiting.id)).resolves.toEqual([
      fixture.audit,
      cancelledAudit,
    ])
    await expect(fixture.store.appendAgentRuntimeToolAudit({
      ...fixture.audit,
      id: 'specialist-tool-cancel-late-process-callback',
      status: 'cancelled',
      code: 'cancelled',
      createdAt: '2026-08-13T15:00:04.600Z',
    })).resolves.toBeUndefined()
    await expect(fixture.store.listAgentRuntimeToolAudits(fixture.waiting.id)).resolves.toHaveLength(2)
    await expect(coordinator.complete(fixture.completionInput))
      .rejects.toThrowError('specialist_runtime_completion_failed')
    fixture.store.close()
  })

  it('cancels two parallel Specialist Runtimes and both concurrent read leases atomically', async () => {
    const fixture = await authorityFixture(['repository_read'], false, true)
    const ids = [
      {
        allocation: 'specialist-allocation-cancel-a',
        agent: 'specialist-agent-cancel-a',
        runtime: 'specialist-runtime-cancel-a',
        context: 'specialist-context-cancel-a',
      },
      {
        allocation: 'specialist-allocation-cancel-b',
        agent: 'specialist-agent-cancel-b',
        runtime: 'specialist-runtime-cancel-b',
        context: 'specialist-context-cancel-b',
      },
    ]
    let index = 0
    const cancelledRuntimeIds: string[][] = []
    const coordinator = createSpecialistRuntimeCoordinator({
      store: fixture.store,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: fixture.store }),
      clock: () => fixture.now,
      createId: (kind) => ids[index]![kind],
      cancelRuntimeEffects: (runtimeIds) => {
        cancelledRuntimeIds.push(runtimeIds)
      },
    })
    const first = await coordinator.start({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: 1,
      taskId: 'specialist-task-1',
      expectedTaskVersion: 1,
    })
    index = 1
    const second = await coordinator.start({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: first.coordination.version,
      taskId: 'specialist-task-2',
      expectedTaskVersion: 1,
    })
    const leases: CoordinationResourceLease[] = ids.map((identity, leaseIndex) => ({
      stateVersion: 1,
      id: `specialist-resource-lease-cancel-${leaseIndex + 1}`,
      coordinationId: fixture.coordination.id,
      taskId: `specialist-task-${leaseIndex + 1}`,
      taskVersion: 2,
      runtimeId: identity.runtime,
      runtimeVersion: 1,
      scope: fixture.coordination.scope,
      capabilityId: 'repository_read',
      capabilityVersion: 1,
      resourceId: fixture.project.id,
      resourceDigest: 'd'.repeat(64),
      mode: 'read',
      status: 'active',
      version: 1,
      acquiredAt: '2026-08-13T15:00:00.000Z',
      expiresAt: '2026-08-13T15:01:00.000Z',
      releasedAt: null,
    }))
    for (const lease of leases) {
      await expect(fixture.store.acquireCoordinationResourceLease({
        expectedState: second.coordination,
        lease,
      })).resolves.toMatchObject({ committed: true, replayed: false })
    }

    await expect(coordinator.cancel({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: second.coordination.version,
      now: '2026-08-13T15:00:10.000Z',
    })).resolves.toMatchObject({
      coordination: {
        status: 'terminal',
        stopReason: 'cancelled',
        counters: { activeSpecialists: 0 },
        tasks: [{ status: 'cancelled' }, { status: 'cancelled' }],
      },
      runtimes: [
        { id: ids[0]!.runtime, status: 'terminal', stopReason: 'cancelled' },
        { id: ids[1]!.runtime, status: 'terminal', stopReason: 'cancelled' },
      ],
      leases: [
        { id: leases[0]!.id, status: 'cancelled' },
        { id: leases[1]!.id, status: 'cancelled' },
      ],
    })
    expect(cancelledRuntimeIds).toEqual([[ids[0]!.runtime, ids[1]!.runtime]])
    fixture.store.close()
  })

  it('keeps the durable cancellation fence when the live hook fails and converges on replay', async () => {
    const fixture = await specialistToolFixture({ withLease: true })
    const failingCoordinator = createSpecialistRuntimeCoordinator({
      store: fixture.store,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: fixture.store }),
      cancelRuntimeEffects: () => {
        throw new Error('injected_live_cancel_failure')
      },
    })
    const cancellationInput = {
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: fixture.started.coordination.version,
      now: '2026-08-13T15:00:04.500Z',
    }

    await expect(failingCoordinator.cancel(cancellationInput))
      .rejects.toThrowError('specialist_runtime_cancellation_failed')
    await expect(fixture.store.getCoordinationRecoverySnapshot(fixture.coordination.id))
      .resolves.toMatchObject({
        state: { status: 'terminal', stopReason: 'cancelled' },
        leases: [{ status: 'cancelled' }],
      })
    const recoveredHook = vi.fn()
    const recoveredCoordinator = createSpecialistRuntimeCoordinator({
      store: fixture.store,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: fixture.store }),
      cancelRuntimeEffects: recoveredHook,
    })
    await expect(recoveredCoordinator.cancel(cancellationInput)).resolves.toMatchObject({
      coordination: { status: 'terminal', stopReason: 'cancelled' },
    })
    expect(recoveredHook).toHaveBeenCalledWith([fixture.waiting.id])
    fixture.store.close()
  })

  it('rolls every cancellation boundary back when durable persistence fails', async () => {
    const fixture = await specialistToolFixture({ withLease: true })
    const backupPath = `${fixture.dbPath}.backup`
    const cancellationHook = vi.fn()
    const coordinator = createSpecialistRuntimeCoordinator({
      store: fixture.store,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: fixture.store }),
      cancelRuntimeEffects: cancellationHook,
    })
    await rename(fixture.dbPath, backupPath)
    await mkdir(fixture.dbPath)

    await expect(coordinator.cancel({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: fixture.started.coordination.version,
      now: '2026-08-13T15:00:04.500Z',
    })).rejects.toThrowError('specialist_runtime_cancellation_failed')
    expect(cancellationHook).not.toHaveBeenCalled()
    await expect(fixture.store.getCoordinationRecoverySnapshot(fixture.coordination.id))
      .resolves.toMatchObject({
        state: fixture.started.coordination,
        leases: [fixture.lease],
      })
    await expect(fixture.store.getAgentRuntime(fixture.waiting.id)).resolves.toEqual(fixture.waiting)
    await expect(fixture.store.listAgentRuntimeCapabilityGrants(fixture.waiting.id))
      .resolves.toEqual([fixture.grant])

    await rm(fixture.dbPath, { recursive: true })
    await rename(backupPath, fixture.dbPath)
    fixture.store.close()
    const reopened = await createLocalStore({ dbPath: fixture.dbPath })
    await expect(reopened.getCoordinationRecoverySnapshot(fixture.coordination.id))
      .resolves.toMatchObject({ state: fixture.started.coordination, leases: [fixture.lease] })
    await expect(reopened.getAgentRuntime(fixture.waiting.id)).resolves.toEqual(fixture.waiting)
    reopened.close()
  })

  it('recovers the exact running Specialist after cold restart without repeating a start', async () => {
    const fixture = await authorityFixture()
    const coordinator = createSpecialistRuntimeCoordinator({
      store: fixture.store,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: fixture.store }),
      clock: () => fixture.now,
      createId: (kind) => ({
        allocation: 'specialist-allocation-cold-recovery-1',
        agent: 'specialist-agent-cold-recovery-1',
        runtime: 'specialist-runtime-cold-recovery-1',
        context: 'specialist-context-cold-recovery-1',
      })[kind],
    })
    const started = await coordinator.start({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: 1,
      taskId: 'specialist-task-1',
      expectedTaskVersion: 1,
    })
    const before = await fixture.store.getCoordinationRecoverySnapshot(fixture.coordination.id)
    const beforeRuntimes = await fixture.store.listAgentRuntimes()
    fixture.store.close()

    const reopened = await createLocalStore({ dbPath: fixture.dbPath })
    const recoveredCoordinator = createSpecialistRuntimeCoordinator({
      store: reopened,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: reopened }),
    })
    const recoveryInput = {
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: started.coordination.version,
      now: '2026-08-13T15:00:01.000Z',
    }
    const recovered = await recoveredCoordinator.resume(recoveryInput)
    expect(recovered).toEqual({
      coordination: started.coordination,
      runtimes: [started.runtime],
      readyTaskIds: [],
    })
    await expect(recoveredCoordinator.resume(recoveryInput)).resolves.toEqual(recovered)
    await expect(reopened.getCoordinationRecoverySnapshot(fixture.coordination.id))
      .resolves.toEqual(before)
    await expect(reopened.listAgentRuntimes()).resolves.toEqual(beforeRuntimes)
    reopened.close()
  })

  it('rejects cold recovery when the Supervisor Context is no longer current', async () => {
    const fixture = await authorityFixture()
    const coordinator = createSpecialistRuntimeCoordinator({
      store: fixture.store,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: fixture.store }),
      clock: () => fixture.now,
      createId: (kind) => ({
        allocation: 'specialist-allocation-stale-supervisor-1',
        agent: 'specialist-agent-stale-supervisor-1',
        runtime: 'specialist-runtime-stale-supervisor-1',
        context: 'specialist-context-stale-supervisor-1',
      })[kind],
    })
    const started = await coordinator.start({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: 1,
      taskId: 'specialist-task-1',
      expectedTaskVersion: 1,
    })
    fixture.store.close()

    const reopened = await createLocalStore({ dbPath: fixture.dbPath })
    const contextCheck = vi.spyOn(reopened, 'isAgentRuntimeContextCurrent')
      .mockImplementation(async (runtimeId) => runtimeId !== fixture.supervisor.id)
    const recoveredCoordinator = createSpecialistRuntimeCoordinator({
      store: reopened,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: reopened }),
    })
    const before = await reopened.getCoordinationRecoverySnapshot(fixture.coordination.id)
    await expect(recoveredCoordinator.resume({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: started.coordination.version,
      now: '2026-08-13T15:00:01.000Z',
    })).rejects.toThrowError('specialist_runtime_resume_failed')
    expect(contextCheck).toHaveBeenCalledWith(fixture.supervisor.id, '2026-08-13T15:00:01.000Z')
    await expect(reopened.getCoordinationRecoverySnapshot(fixture.coordination.id))
      .resolves.toEqual(before)
    reopened.close()
  })

  it('blocks cold recovery at the exact expiry of an unsettled active resource lease', async () => {
    const fixture = await specialistToolFixture({
      withLease: true,
      leaseExpiresAt: '2026-08-13T15:00:30.000Z',
    })
    const before = await fixture.store.getCoordinationRecoverySnapshot(fixture.coordination.id)
    fixture.store.close()

    const reopened = await createLocalStore({ dbPath: fixture.dbPath })
    const recoveredCoordinator = createSpecialistRuntimeCoordinator({
      store: reopened,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: reopened }),
    })
    await expect(recoveredCoordinator.resume({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: fixture.started.coordination.version,
      now: '2026-08-13T15:00:30.000Z',
    })).rejects.toThrowError('specialist_runtime_resume_failed')
    await expect(reopened.getCoordinationRecoverySnapshot(fixture.coordination.id))
      .resolves.toEqual(before)
    await expect(reopened.listAgentRuntimeCapabilityGrants(fixture.waiting.id))
      .resolves.toEqual([fixture.grant])
    await expect(reopened.listAgentRuntimeToolAudits(fixture.waiting.id))
      .resolves.toEqual([])
    reopened.close()
  })

  it('reopens one in-flight Specialist Tool boundary without repeating its grant or audit', async () => {
    const fixture = await specialistToolFixture({ withLease: true })
    await expect(fixture.store.beginAgentRuntimeToolExecution({
      expectedGrant: fixture.grant,
      audit: fixture.audit,
    })).resolves.toEqual({ consumed: true })
    const before = await fixture.store.getCoordinationRecoverySnapshot(fixture.coordination.id)
    const grantsBefore = await fixture.store.listAgentRuntimeCapabilityGrants(fixture.waiting.id)
    const auditsBefore = await fixture.store.listAgentRuntimeToolAudits(fixture.waiting.id)
    fixture.store.close()

    const reopened = await createLocalStore({ dbPath: fixture.dbPath })
    const recoveredCoordinator = createSpecialistRuntimeCoordinator({
      store: reopened,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: reopened }),
    })
    const recoveryInput = {
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: fixture.started.coordination.version,
      now: '2026-08-13T15:00:05.000Z',
    }
    const recovered = await recoveredCoordinator.resume(recoveryInput)
    expect(recovered).toEqual({
      coordination: fixture.started.coordination,
      runtimes: [fixture.waiting],
      readyTaskIds: [],
    })
    await expect(recoveredCoordinator.resume(recoveryInput)).resolves.toEqual(recovered)
    await expect(reopened.getCoordinationRecoverySnapshot(fixture.coordination.id))
      .resolves.toEqual(before)
    await expect(reopened.listAgentRuntimeCapabilityGrants(fixture.waiting.id))
      .resolves.toEqual(grantsBefore)
    await expect(reopened.listAgentRuntimeToolAudits(fixture.waiting.id))
      .resolves.toEqual(auditsBefore)
    reopened.close()
  })

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
    const beforeResume = await reopenedStore.getCoordinationRecoverySnapshot(
      fixture.coordination.id,
    )
    const runtimesBeforeResume = await reopenedStore.listAgentRuntimes()
    await expect(reopenedCoordinator.resume({
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: completed.coordination.version,
      now: '2026-08-13T15:00:04.000Z',
    })).resolves.toEqual({
      coordination: completed.coordination,
      runtimes: [],
      readyTaskIds: ['specialist-task-2'],
    })
    await expect(reopenedStore.getCoordinationRecoverySnapshot(fixture.coordination.id))
      .resolves.toEqual(beforeResume)
    await expect(reopenedStore.listAgentRuntimes()).resolves.toEqual(runtimesBeforeResume)
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

  it('atomically attributes one fail-fast result and blocks its dependency without a handoff', async () => {
    const fixture = await authorityFixture(['repository_read'], true)
    const ids = {
      allocation: 'specialist-allocation-failure-1',
      agent: 'specialist-agent-failure-1',
      runtime: 'specialist-runtime-failure-1',
      context: 'specialist-runtime-context-failure-1',
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
        id: 'specialist-action-failure-1',
        kind: 'tool',
        capabilityId: 'repository_read',
        capabilityVersion: 1,
        requestDigest: '7'.repeat(64),
        requiresPermission: false,
      },
    })
    await fixture.store.commitAgentRuntimeTransition({
      expectedRuntime: resumed.runtime,
      transition: waiting,
    })
    const terminal = acceptAgentActionResult({
      runtime: waiting.runtime,
      expectedCheckpointVersion: waiting.runtime.checkpointVersion,
      actionId: waiting.runtime.activeAction!.id,
      requestDigest: waiting.runtime.activeAction!.requestDigest,
      result: {
        outcome: 'failure',
        resultDigest: '8'.repeat(64),
        resultBytes: 128,
        tokens: 50,
        costUsd: 0.02,
        evaluation: 'failure',
        evaluationSummary: 'The bounded repository read failed.',
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
      evidenceDigests: [],
      resourceLeaseOutcome: 'not_required',
      handoffs: [],
    }

    const completed = await coordinator.complete(completionInput)

    expect(completed).toMatchObject({
      runtime: {
        id: ids.runtime,
        version: terminal.runtime.version,
        status: 'terminal',
        stopReason: 'failure',
      },
      coordination: {
        version: 3,
        status: 'terminal',
        stopReason: 'failure',
        counters: {
          specialistStarts: 1,
          activeSpecialists: 0,
          acceptedHandoffs: 0,
          steps: 1,
          toolCalls: 1,
          tokens: 50,
          costUsd: 0.02,
        },
        tasks: [
          {
            id: 'specialist-task-1',
            version: 3,
            status: 'failed',
            runtimeId: ids.runtime,
            runtimeVersion: terminal.runtime.version,
            resultDigest: null,
            failure: {
              category: 'tool_error',
              code: 'specialist_tool_failed',
              sourceTaskId: 'specialist-task-1',
            },
          },
          {
            id: 'specialist-task-2',
            version: 2,
            status: 'blocked',
            failure: {
              category: 'dependency_failed',
              code: 'dependency_task_failed',
              sourceTaskId: 'specialist-task-1',
            },
          },
        ],
      },
      handoffs: [],
    })
    await expect(coordinator.complete(completionInput)).resolves.toEqual(completed)
    await expect(fixture.store.getCoordinationRecoverySnapshot(fixture.coordination.id))
      .resolves.toMatchObject({
        state: completed.coordination,
        handoffs: [],
        audits: [{}, {}, {}],
        checkpoints: [{}, {}, {}],
      })
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
        handoffs: [],
        audits: [{}, {}, {}],
        checkpoints: [{}, {}, {}],
      })
    reopenedStore.close()
  })

  it('atomically replaces one explicitly recoverable read-only failure exactly once', async () => {
    const fixture = await authorityFixture()
    const ids = {
      allocation: 'specialist-allocation-recovery-1',
      agent: 'specialist-agent-recovery-1',
      runtime: 'specialist-runtime-recovery-source-1',
      context: 'specialist-runtime-context-recovery-source-1',
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
        id: 'specialist-action-recovery-1',
        kind: 'tool',
        capabilityId: 'repo.read_text',
        capabilityVersion: 1,
        requestDigest: '9'.repeat(64),
        requiresPermission: false,
      },
    })
    await fixture.store.commitAgentRuntimeTransition({
      expectedRuntime: resumed.runtime,
      transition: waiting,
    })
    const lease: CoordinationResourceLease = {
      stateVersion: 1,
      id: 'specialist-resource-lease-recovery-1',
      coordinationId: fixture.coordination.id,
      taskId: 'specialist-task-1',
      taskVersion: 2,
      runtimeId: waiting.runtime.id,
      runtimeVersion: 1,
      scope: fixture.coordination.scope,
      capabilityId: 'repository_read',
      capabilityVersion: 1,
      resourceId: fixture.project.id,
      resourceDigest: 'd'.repeat(64),
      mode: 'read',
      status: 'active',
      version: 1,
      acquiredAt: '2026-08-13T15:00:02.000Z',
      expiresAt: '2026-08-13T15:01:02.000Z',
      releasedAt: null,
    }
    await expect(fixture.store.acquireCoordinationResourceLease({
      expectedState: started.coordination,
      lease,
    })).resolves.toMatchObject({ committed: true, replayed: false })
    await expect(fixture.store.settleCoordinationResourceLease({
      expectedState: started.coordination,
      expectedLease: lease,
      outcome: 'released',
      now: '2026-08-13T15:00:02.500Z',
    })).resolves.toMatchObject({ committed: true, replayed: false })
    const terminal = acceptAgentActionResult({
      runtime: waiting.runtime,
      expectedCheckpointVersion: waiting.runtime.checkpointVersion,
      actionId: waiting.runtime.activeAction!.id,
      requestDigest: waiting.runtime.activeAction!.requestDigest,
      result: {
        outcome: 'failure',
        resultDigest: 'a'.repeat(64),
        resultBytes: 128,
        tokens: 50,
        costUsd: 0.02,
        evaluation: 'failure',
        evaluationSummary: 'The idempotent repository read failed and is safe to retry once.',
      },
      now: '2026-08-13T15:00:03.000Z',
    })
    const recoveryInput = {
      recoveryId: 'specialist-recovery-1',
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: started.coordination.version,
      taskId: 'specialist-task-1',
      expectedTaskVersion: 2,
      expectedRuntimeVersion: waiting.runtime.version,
      transition: terminal,
    }

    const recovered = await coordinator.recover(recoveryInput)

    expect(recovered.failedRuntime).toEqual(terminal.runtime)
    expect(recovered.runtime).toMatchObject({
      status: 'checkpointed',
      stopReason: null,
      version: 1,
      checkpointVersion: 1,
      scope: started.runtime.scope,
      authority: started.runtime.authority,
      capabilitySetDigest: started.runtime.capabilitySetDigest,
      bounds: {
        maxSteps: 1,
        maxToolCalls: 1,
        maxTokens: 4_950,
        maxCostUsd: 0.48,
      },
      requestedAt: terminal.runtime.updatedAt,
      deadline: started.runtime.deadline,
    })
    expect(recovered.runtime.id).not.toBe(started.runtime.id)
    expect(recovered.coordination).toMatchObject({
      version: 3,
      status: 'running',
      stopReason: null,
      counters: {
        specialistStarts: 2,
        activeSpecialists: 1,
        retries: 1,
        steps: 1,
        toolCalls: 1,
        tokens: 50,
        costUsd: 0.02,
      },
      tasks: [{
        id: 'specialist-task-1',
        version: 3,
        status: 'running',
        agentId: ids.agent,
        runtimeId: recovered.runtime.id,
        runtimeVersion: 1,
        resultDigest: null,
        failure: null,
        attemptFailures: [{
          category: 'tool_error',
          code: 'specialist_tool_failed',
          sourceTaskId: 'specialist-task-1',
        }],
      }],
    })
    await expect(coordinator.recover(recoveryInput)).resolves.toEqual(recovered)
    fixture.store.close()

    const reopenedStore = await createLocalStore({ dbPath: fixture.dbPath })
    const reopenedCoordinator = createSpecialistRuntimeCoordinator({
      store: reopenedStore,
      authorityBroker: createSpecialistTaskAuthorityBroker({ store: reopenedStore }),
    })
    await expect(reopenedCoordinator.recover(recoveryInput)).resolves.toEqual(recovered)
    await expect(reopenedStore.getCoordinationRecoverySnapshot(fixture.coordination.id))
      .resolves.toMatchObject({
        state: recovered.coordination,
        handoffs: [],
        audits: [{}, {}, {}],
        checkpoints: [{}, {}, {}],
      })
    const retryResumed = resumeAgentRuntime({
      runtime: recovered.runtime,
      expectedCheckpointVersion: recovered.runtime.checkpointVersion,
      authority: recovered.runtime.authority,
      contextDigest: recovered.runtime.contextDigest,
      capabilitySetDigest: recovered.runtime.capabilitySetDigest,
      now: '2026-08-13T15:00:04.000Z',
    })
    await reopenedStore.commitAgentRuntimeTransition({
      expectedRuntime: recovered.runtime,
      transition: retryResumed,
    })
    const retryWaiting = requestAgentAction({
      runtime: retryResumed.runtime,
      expectedCheckpointVersion: retryResumed.runtime.checkpointVersion,
      now: '2026-08-13T15:00:05.000Z',
      action: {
        id: 'specialist-action-recovery-2',
        kind: 'tool',
        capabilityId: 'repo.read_text',
        capabilityVersion: 1,
        requestDigest: 'b'.repeat(64),
        requiresPermission: false,
      },
    })
    await reopenedStore.commitAgentRuntimeTransition({
      expectedRuntime: retryResumed.runtime,
      transition: retryWaiting,
    })
    const retryLease: CoordinationResourceLease = {
      ...lease,
      id: 'specialist-resource-lease-recovery-2',
      taskVersion: 3,
      runtimeId: retryWaiting.runtime.id,
      acquiredAt: '2026-08-13T15:00:05.000Z',
      expiresAt: '2026-08-13T15:01:05.000Z',
    }
    await expect(reopenedStore.acquireCoordinationResourceLease({
      expectedState: recovered.coordination,
      lease: retryLease,
    })).resolves.toMatchObject({ committed: true, replayed: false })
    await expect(reopenedStore.settleCoordinationResourceLease({
      expectedState: recovered.coordination,
      expectedLease: retryLease,
      outcome: 'released',
      now: '2026-08-13T15:00:05.500Z',
    })).resolves.toMatchObject({ committed: true, replayed: false })
    const retryTerminal = acceptAgentActionResult({
      runtime: retryWaiting.runtime,
      expectedCheckpointVersion: retryWaiting.runtime.checkpointVersion,
      actionId: retryWaiting.runtime.activeAction!.id,
      requestDigest: retryWaiting.runtime.activeAction!.requestDigest,
      result: {
        outcome: 'failure',
        resultDigest: 'c'.repeat(64),
        resultBytes: 128,
        tokens: 10,
        costUsd: 0.01,
        evaluation: 'failure',
        evaluationSummary: 'The bounded retry also failed.',
      },
      now: '2026-08-13T15:00:06.000Z',
    })
    await expect(reopenedCoordinator.recover({
      recoveryId: 'specialist-recovery-2',
      coordinationId: fixture.coordination.id,
      expectedSessionVersion: recovered.coordination.version,
      taskId: 'specialist-task-1',
      expectedTaskVersion: 3,
      expectedRuntimeVersion: retryWaiting.runtime.version,
      transition: retryTerminal,
    })).rejects.toThrowError('specialist_runtime_recovery_failed')
    await expect(reopenedStore.getCoordinationSession(fixture.coordination.id))
      .resolves.toMatchObject({ state: recovered.coordination })
    reopenedStore.close()
  })
})
