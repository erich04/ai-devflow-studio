import { describe, expect, it } from 'vitest'
import { createWorkflowRunFromRequest } from '@ai-devflow/shared'
import { createRunningRun, getRunStatusLabel } from './desktop-view-model'

describe('desktop view model', () => {
  it('maps internal run status values to user-facing workflow labels', () => {
    expect(getRunStatusLabel('building')).toBe('开发实现中')
    expect(getRunStatusLabel('testing')).toBe('测试证据中')
    expect(getRunStatusLabel('completed')).toBe('已完成')
  })

  it('marks the previous active build node successful when local tests become current', () => {
    const created = createWorkflowRunFromRequest({
      runId: 'run-local-tests',
      title: 'Run local tests',
      request: 'Move from build to test.',
      projectId: 'p-payments',
      creatorId: 'u-wang',
      branchName: 'ai/local-tests',
      now: '2026-06-21T16:00:00.000Z',
    })
    const buildCurrentRun = {
      ...created.run,
      status: 'building' as const,
      currentNodeId: 'run-local-tests-build',
      nodes: created.run.nodes.map((node) =>
        node.id === 'run-local-tests-build'
          ? { ...node, status: 'running' as const }
          : node,
      ),
    }

    const testingRun = createRunningRun(buildCurrentRun, 'run-local-tests-test')

    expect(testingRun.status).toBe('testing')
    expect(testingRun.currentNodeId).toBe('run-local-tests-test')
    expect(testingRun.nodes.find((node) => node.id === 'run-local-tests-build')?.status).toBe('success')
    expect(testingRun.nodes.find((node) => node.id === 'run-local-tests-test')?.status).toBe('running')
    expect(testingRun.nodes.find((node) => node.id === 'run-local-tests-pr')?.status).toBe('pending')
    expect(testingRun.nodes.find((node) => node.id === 'run-local-tests-accept')?.status).toBe('pending')
  })
})
