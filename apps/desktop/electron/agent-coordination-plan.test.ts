import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  AgentRuntimeState,
  DesktopPairingCredential,
  LocalProject,
  PolicySnapshot,
  WorkflowRun,
} from '@ai-devflow/shared'
import { createBoundedAgentCoordinationPlan } from './agent-coordination-plan'
import { createLocalStore } from './local-store'
import { createSpecialistRuntimeCoordinator } from './specialist-runtime-coordinator'
import { createSpecialistTaskAuthorityBroker } from './specialist-task-authority'

const now = '2026-08-13T18:00:00.000Z'

const project: LocalProject = {
  id: 'local-project-1',
  name: 'Checkout',
  path: '/redacted/checkout',
  packageManager: 'pnpm',
  detectedTestCommand: 'pnpm test',
  testCommand: 'pnpm test',
  createdAt: now,
  updatedAt: now,
}

const run: WorkflowRun = {
  id: 'run-1',
  version: 7,
  title: 'Repair one bounded defect',
  request: 'Inspect contracts and tests before applying one repair.',
  projectId: project.id,
  creatorId: 'user-1',
  status: 'building',
  currentNodeId: 'run-1-build',
  branchName: 'devflow/run-1',
  createdAt: now,
  updatedAt: now,
  nodes: [{
    id: 'run-1-build',
    title: 'Build',
    subtitle: 'Implement the bounded repair.',
    kind: 'agent',
    stage: 'build',
    status: 'running',
    ownerId: 'agent-runtime',
    retryCount: 0,
    artifactIds: [],
  }],
  edges: [],
}

const pairing: DesktopPairingCredential = {
  tokenId: 'desktop-session-1',
  organizationId: 'organization-1',
  projectId: 'team-project-1',
  userId: 'user-1',
  role: 'lead',
  authAccountId: 'account-1',
  projectMemberships: [{ projectId: 'team-project-1', userId: 'user-1', role: 'lead' }],
  createdAt: now,
}

const policy = {
  projectId: project.id,
  version: 3,
} as PolicySnapshot

function fixture() {
  let runtime: AgentRuntimeState | null = null
  const store = {
    getRun: vi.fn().mockResolvedValue(run),
    listProjects: vi.fn().mockResolvedValue([project]),
    getDesktopPairingCredential: vi.fn().mockResolvedValue({ ...pairing, localProjectId: project.id }),
    getPolicySnapshot: vi.fn().mockResolvedValue(policy),
    getAgentRuntime: vi.fn(async () => runtime),
    isAgentRuntimeContextCurrent: vi.fn().mockResolvedValue(true),
    commitAgentRuntimeTransition: vi.fn(async ({ transition }) => {
      runtime = transition.runtime
      return { committed: true, replayed: false, runtime: transition.runtime }
    }),
    createCoordinationSession: vi.fn(async ({ coordination, graph, startedAt }) => ({
      committed: true,
      replayed: false,
      state: {
        id: coordination.id,
        graphId: graph.id,
        startedAt,
      },
    })),
  }
  return {
    store,
    planner: createBoundedAgentCoordinationPlan({
      store: store as never,
      clock: () => now,
    }),
  }
}

const request = {
  planId: 'bounded-repair-v1' as const,
  runId: run.id,
  nodeId: run.currentNodeId,
  localProjectId: project.id,
  expectedRunVersion: run.version,
}

describe('main-owned bounded Agent Coordination plan', () => {
  it('persists and replays the fixed plan through the real LocalStore authority boundary', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-coordination-plan-'))
    const store = await createLocalStore({ dbPath: path.join(directory, 'devflow.sqlite') })
    try {
      await store.upsertProject(project)
      await store.saveRun(run)
      await store.saveDesktopPairingCredential(
        { ...pairing, localProjectId: project.id },
        'encrypted-test-token',
      )
      const planner = createBoundedAgentCoordinationPlan({ store, clock: () => now })

      const first = await planner.start(request)
      const second = await planner.start(request)
      const persisted = await store.getCoordinationSession(first.coordinationId)

      expect(first.replayed).toBe(false)
      expect(second).toEqual({ coordinationId: first.coordinationId, replayed: true })
      expect(persisted).toMatchObject({
        state: { status: 'running', version: 1 },
        graph: {
          entryTaskIds: ['inspect-contract', 'inspect-tests'],
          nodes: [
            { id: 'inspect-contract', roleId: 'contract-analyst' },
            { id: 'inspect-tests', roleId: 'test-analyst' },
            { id: 'implement-repair', roleId: 'bounded-implementer' },
          ],
        },
      })
    } finally {
      store.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('resumes one running fixed-plan Specialist after closing and reopening the real LocalStore', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-coordination-restart-'))
    const dbPath = path.join(directory, 'devflow.sqlite')
    const store = await createLocalStore({ dbPath })
    try {
      await store.upsertProject(project)
      await store.saveRun(run)
      await store.saveDesktopPairingCredential(
        { ...pairing, localProjectId: project.id },
        'encrypted-test-token',
      )
      const planner = createBoundedAgentCoordinationPlan({ store, clock: () => now })
      const created = await planner.start(request)
      const coordinator = createSpecialistRuntimeCoordinator({
        store,
        authorityBroker: createSpecialistTaskAuthorityBroker({ store }),
        clock: () => '2026-08-13T18:00:01.000Z',
        createId: (kind) => `restart-specialist-${kind}-1`,
      })
      const started = await coordinator.start({
        coordinationId: created.coordinationId,
        expectedSessionVersion: 1,
        taskId: 'inspect-contract',
        expectedTaskVersion: 1,
      })
      const beforeRestart = await store.getCoordinationRecoverySnapshot(created.coordinationId)
      store.close()

      const reopened = await createLocalStore({ dbPath })
      try {
        await expect(reopened.listRecoverableAgentRuntimes()).resolves.toEqual([])
        await expect(reopened.listAgentRuntimes()).resolves.toHaveLength(2)
        const reopenedCoordinator = createSpecialistRuntimeCoordinator({
          store: reopened,
          authorityBroker: createSpecialistTaskAuthorityBroker({ store: reopened }),
          clock: () => '2026-08-13T18:00:02.000Z',
        })

        await expect(reopenedCoordinator.resume({
          coordinationId: created.coordinationId,
          expectedSessionVersion: started.coordination.version,
        })).resolves.toMatchObject({
          coordination: started.coordination,
          runtimes: [{ id: started.runtime.id, status: 'checkpointed' }],
          readyTaskIds: ['inspect-tests'],
        })
        await expect(reopened.getCoordinationRecoverySnapshot(created.coordinationId))
          .resolves.toEqual(beforeRestart)
      } finally {
        reopened.close()
      }
    } finally {
      store.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('creates one fixed Supervisor and frozen two-readers-then-writer graph', async () => {
    const { store, planner } = fixture()

    const result = await planner.start(request)

    expect(result.replayed).toBe(false)
    expect(store.commitAgentRuntimeTransition).toHaveBeenCalledTimes(1)
    const runtimeCommit = store.commitAgentRuntimeTransition.mock.calls[0]![0]
    expect(runtimeCommit.expectedRuntime).toBeNull()
    expect(runtimeCommit.transition.runtime).toMatchObject({
      scope: {
        kind: 'team',
        organizationId: pairing.organizationId,
        projectId: pairing.projectId,
        userId: pairing.userId,
        sessionId: pairing.tokenId,
        localProjectId: project.id,
      },
      authority: {
        runId: run.id,
        nodeId: run.currentNodeId,
        runVersion: run.version,
        policyVersion: policy.version,
      },
      status: 'checkpointed',
      bounds: {
        maxSteps: 6,
        maxWallTimeMs: 360_000,
        maxToolCalls: 6,
        maxTokens: 15_000,
        maxCostUsd: 1.5,
      },
    })
    expect(runtimeCommit.contextAttachment).toMatchObject({
      runtimeId: runtimeCommit.transition.runtime.id,
      knowledgeCitations: [],
      memoryRevisions: [],
    })

    const creation = store.createCoordinationSession.mock.calls[0]![0]
    expect(creation.coordination.authority).toEqual({
      runId: run.id,
      nodeId: run.currentNodeId,
      runVersion: run.version,
      policyVersion: policy.version,
      supervisorRuntimeId: runtimeCommit.transition.runtime.id,
      supervisorRuntimeVersion: 1,
    })
    expect(creation.graph.entryTaskIds).toEqual([
      'inspect-contract',
      'inspect-tests',
    ])
    expect(creation.graph.nodes).toEqual([
      expect.objectContaining({
        id: 'inspect-contract',
        roleId: 'contract-analyst',
        capabilityIds: ['repository_read'],
        resourceRequirements: [expect.objectContaining({ resourceId: project.id, mode: 'read' })],
      }),
      expect.objectContaining({
        id: 'inspect-tests',
        roleId: 'test-analyst',
        capabilityIds: ['repository_read', 'saved_test'],
        resourceRequirements: [expect.objectContaining({ resourceId: project.id, mode: 'read' })],
      }),
      expect.objectContaining({
        id: 'implement-repair',
        roleId: 'bounded-implementer',
        capabilityIds: [
          'deterministic_evaluation',
          'managed_workspace_edit',
          'repository_read',
          'saved_test',
        ],
        resourceRequirements: [expect.objectContaining({ resourceId: project.id, mode: 'write' })],
      }),
    ])
    expect(creation.graph.edges).toEqual([
      { id: 'contract-to-repair', sourceTaskId: 'inspect-contract', targetTaskId: 'implement-repair' },
      { id: 'tests-to-repair', sourceTaskId: 'inspect-tests', targetTaskId: 'implement-repair' },
    ])
  })

  it('reuses the exact deterministic Supervisor after an interrupted session commit', async () => {
    const { store, planner } = fixture()
    store.createCoordinationSession
      .mockRejectedValueOnce(new Error('simulated process interruption'))
      .mockResolvedValueOnce({
        committed: true,
        replayed: false,
        state: { id: 'coordination-replayed', graphId: 'graph-replayed', startedAt: now },
      })

    await expect(planner.start(request)).rejects.toThrowError(
      'agent_coordination_plan_start_failed',
    )
    await expect(planner.start(request)).resolves.toMatchObject({ replayed: false })

    expect(store.commitAgentRuntimeTransition).toHaveBeenCalledTimes(1)
    expect(store.createCoordinationSession).toHaveBeenCalledTimes(2)
    expect(store.createCoordinationSession.mock.calls[1]![0]).toEqual(
      store.createCoordinationSession.mock.calls[0]![0],
    )
  })

  it('rejects stale or unpaired renderer selection before any persistence', async () => {
    const { store, planner } = fixture()

    await expect(planner.start({ ...request, expectedRunVersion: run.version - 1 }))
      .rejects.toThrowError('agent_coordination_plan_start_failed')
    store.getDesktopPairingCredential.mockResolvedValueOnce(null)
    await expect(planner.start(request))
      .rejects.toThrowError('agent_coordination_plan_start_failed')

    expect(store.commitAgentRuntimeTransition).not.toHaveBeenCalled()
    expect(store.createCoordinationSession).not.toHaveBeenCalled()
  })

  it('does not create a session from a stale Supervisor Context attachment', async () => {
    const { store, planner } = fixture()
    store.isAgentRuntimeContextCurrent.mockResolvedValueOnce(false)

    await expect(planner.start(request))
      .rejects.toThrowError('agent_coordination_plan_start_failed')

    expect(store.commitAgentRuntimeTransition).toHaveBeenCalledTimes(1)
    expect(store.createCoordinationSession).not.toHaveBeenCalled()
  })
})
