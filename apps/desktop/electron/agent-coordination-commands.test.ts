import { describe, expect, it, vi } from 'vitest'
import { createAgentCoordinationCommands } from './agent-coordination-commands'

const snapshot = {
  projectionVersion: 1 as const,
  session: {
    coordinationId: 'coordination-1',
    version: 4,
    runId: 'run-1',
    localProjectId: 'project-1',
  },
  redacted: true as const,
}

function fixture() {
  const access = {
    get: vi.fn().mockResolvedValue(snapshot),
  }
  const coordinator = {
    resume: vi.fn().mockResolvedValue({ coordination: {}, runtimes: [], readyTaskIds: [] }),
    start: vi.fn().mockResolvedValue({ coordination: {}, runtime: {} }),
    cancel: vi.fn().mockResolvedValue({ coordination: {}, runtimes: [], leases: [] }),
  }
  const planner = {
    start: vi.fn().mockResolvedValue({ coordinationId: 'coordination-1', replayed: false }),
  }
  return {
    access,
    coordinator,
    planner,
    commands: createAgentCoordinationCommands({
      access: access as never,
      coordinator: coordinator as never,
      planner: planner as never,
    }),
  }
}

describe('Agent Coordination commands', () => {
  it('starts only the fixed main-owned plan and returns its exact projection', async () => {
    const { access, planner, commands } = fixture()
    const input = {
      planId: 'bounded-repair-v1' as const,
      runId: 'run-1',
      nodeId: 'run-1-build',
      localProjectId: 'project-1',
      expectedRunVersion: 3,
    }

    await expect(commands.startPlan(input)).resolves.toBe(snapshot)
    expect(planner.start).toHaveBeenCalledWith(input)
    expect(access.get).toHaveBeenCalledWith({
      coordinationId: 'coordination-1',
      runId: 'run-1',
      localProjectId: 'project-1',
    })
  })

  it('revalidates the exact renderer selection before and after a recovery resume', async () => {
    const { access, coordinator, commands } = fixture()
    const input = {
      coordinationId: 'coordination-1',
      runId: 'run-1',
      localProjectId: 'project-1',
      expectedSessionVersion: 4,
    }

    await expect(commands.resume(input)).resolves.toBe(snapshot)
    expect(access.get.mock.invocationCallOrder[0]).toBeLessThan(
      coordinator.resume.mock.invocationCallOrder[0]!,
    )
    expect(coordinator.resume).toHaveBeenCalledWith({
      coordinationId: 'coordination-1',
      expectedSessionVersion: 4,
    })
    expect(access.get).toHaveBeenNthCalledWith(2, {
      coordinationId: 'coordination-1',
      runId: 'run-1',
      localProjectId: 'project-1',
    })
  })

  it('starts only one exact ready task through the main-owned coordinator', async () => {
    const { access, coordinator, commands } = fixture()
    await expect(commands.startTask({
      coordinationId: 'coordination-1',
      runId: 'run-1',
      localProjectId: 'project-1',
      expectedSessionVersion: 4,
      taskId: 'task-contract',
      expectedTaskVersion: 2,
    })).resolves.toBe(snapshot)

    expect(coordinator.start).toHaveBeenCalledWith({
      coordinationId: 'coordination-1',
      expectedSessionVersion: 4,
      taskId: 'task-contract',
      expectedTaskVersion: 2,
    })
    expect(access.get).toHaveBeenCalledTimes(2)
  })

  it('cancels the exact current session and rejects stale selection before effects', async () => {
    const { access, coordinator, commands } = fixture()
    const input = {
      coordinationId: 'coordination-1',
      runId: 'run-1',
      localProjectId: 'project-1',
      expectedSessionVersion: 4,
      confirmation: 'cancel-coordination' as const,
    }
    await expect(commands.cancel(input)).resolves.toBe(snapshot)
    expect(coordinator.cancel).toHaveBeenCalledWith({
      coordinationId: 'coordination-1',
      expectedSessionVersion: 4,
    })

    access.get.mockRejectedValueOnce(new Error('stale selection'))
    await expect(commands.cancel(input)).rejects.toThrowError('stale selection')
    expect(coordinator.cancel).toHaveBeenCalledTimes(1)
  })
})
