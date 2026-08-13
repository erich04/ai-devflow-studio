import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assembleAgentRuntimeContext,
  createAgentRuntime,
  createWarnOnlyDefaultPolicy,
  createWorkflowRunFromRequest,
  resolveEffectivePolicy,
  type AgentTaskGraph,
  type CoordinationSessionRequest,
} from '@ai-devflow/shared'
import { createLocalStore } from './local-store'
import { createSpecialistTaskAuthorityBroker } from './specialist-task-authority'

const tempDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

async function authorityFixture(capabilityIds = ['repository_read']) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'devflow-specialist-authority-'))
  tempDirs.push(dir)
  const store = await createLocalStore({ dbPath: path.join(dir, 'devflow.sqlite') })
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
    nodes: [{
      id: 'specialist-task-1',
      roleId: 'contract-analyst',
      contextDigest: 'c'.repeat(64),
      capabilityIds,
      resourceRequirements: [{
        resourceId: 'specialist-repository-1',
        resourceDigest: 'd'.repeat(64),
        mode: 'read',
      }],
    }],
    edges: [],
  }
  await expect(store.createCoordinationSession({
    coordination,
    graph,
    startedAt: now,
  })).resolves.toMatchObject({ committed: true, replayed: false })

  return { store, coordination, graph, run, pairing, policy, supervisor: supervisor.runtime, now }
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
