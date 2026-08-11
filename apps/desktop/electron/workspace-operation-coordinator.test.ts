import { describe, expect, it } from 'vitest'
import { createWorkspaceOperationCoordinator } from './workspace-operation-coordinator'

describe('workspace operation coordinator', () => {
  it('serializes operations for one workspace', async () => {
    const coordinator = createWorkspaceOperationCoordinator()
    const order: string[] = []
    let markFirstEntered!: () => void
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve
    })
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const first = coordinator.runExclusive('workspace-1', async () => {
      order.push('first:start')
      markFirstEntered()
      await firstBlocked
      order.push('first:end')
    })
    const second = coordinator.runExclusive('workspace-1', async () => {
      order.push('second:start')
      order.push('second:end')
    })

    await firstEntered
    expect(order).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ])
  })

  it('allows different workspaces to progress concurrently', async () => {
    const coordinator = createWorkspaceOperationCoordinator()
    const entered: string[] = []
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = coordinator.runExclusive('workspace-1', async () => {
      entered.push('workspace-1')
      await blocked
    })
    const second = coordinator.runExclusive('workspace-2', async () => {
      entered.push('workspace-2')
    })

    await second
    expect(entered).toEqual(['workspace-1', 'workspace-2'])
    release()
    await first
  })

  it('releases a workspace after an operation fails', async () => {
    const coordinator = createWorkspaceOperationCoordinator()

    await expect(coordinator.runExclusive('workspace-1', async () => {
      throw new Error('failed')
    })).rejects.toThrow('failed')
    await expect(coordinator.runExclusive('workspace-1', async () => 'recovered'))
      .resolves.toBe('recovered')
  })
})
