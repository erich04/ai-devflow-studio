import { describe, expect, it } from 'vitest'
import { createWorkflowRunFromRequest } from '@ai-devflow/shared'
import {
  buildKnowledgeDataSource,
  createRunningRun,
  getRunStatusLabel,
  mergeLocalAndRemoteSnapshot,
} from './desktop-view-model'

describe('desktop view model', () => {
  it('distinguishes repository knowledge loading, indexed, and truncated states', () => {
    expect(
      buildKnowledgeDataSource({
        desktopConnected: true,
        dataOrigin: 'local',
        isLoading: true,
      }),
    ).toMatchObject({
      status: 'local indexing',
      label: 'indexing',
      tone: 'soft',
    })

    expect(
      buildKnowledgeDataSource({
        desktopConnected: true,
        dataOrigin: 'local',
        isLoading: false,
        snapshot: {
          projectId: 'local-project-1',
          contentHash: 'repository-hash-1',
          documents: [],
          chunks: [],
          entities: [],
          relations: [],
          indexedAt: '2026-08-01T00:00:00.000Z',
          truncated: false,
          warnings: [],
        },
      }),
    ).toMatchObject({
      status: 'local indexed',
      label: 'indexed',
      tone: 'good',
    })

    expect(
      buildKnowledgeDataSource({
        desktopConnected: true,
        dataOrigin: 'local',
        isLoading: false,
        snapshot: {
          projectId: 'local-project-1',
          contentHash: 'repository-hash-1',
          documents: [],
          chunks: [],
          entities: [],
          relations: [],
          indexedAt: '2026-08-01T00:00:00.000Z',
          truncated: true,
          warnings: ['file_count_limit_exceeded'],
        },
      }),
    ).toMatchObject({
      status: 'local indexed',
      label: 'indexed · truncated',
      tone: 'warn',
    })

    expect(
      buildKnowledgeDataSource({
        desktopConnected: true,
        dataOrigin: 'local',
        isLoading: false,
        error: '仓库知识索引不可用',
        snapshot: {
          projectId: 'local-project-1',
          contentHash: 'repository-hash-1',
          documents: [],
          chunks: [],
          entities: [],
          relations: [],
          indexedAt: '2026-08-01T00:00:00.000Z',
          truncated: false,
          warnings: [],
        },
      }),
    ).toMatchObject({
      status: 'local indexed',
      label: 'indexed · refresh failed',
      tone: 'warn',
    })
  })

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

  it('preserves complete local records when a remote snapshot reuses their ids', () => {
    const local = createWorkflowRunFromRequest({
      runId: 'run-synced',
      title: 'Local workflow',
      request: 'Keep the complete local workflow after sync.',
      projectId: 'local-project-1',
      creatorId: 'u-wang',
      branchName: 'ai/local-sync',
      now: '2026-06-21T16:00:00.000Z',
    })
    const localArtifact = local.artifacts[0]!
    const localEvent = local.events[0]!
    const remoteRun = {
      ...local.run,
      title: 'Lossy remote summary',
      request: 'Synced from DevFlow Electron.',
      projectId: 'p-payments',
      status: 'completed' as const,
      currentNodeId: 'run-synced:remote-node',
      nodes: [],
      edges: [],
    }
    const remoteArtifact = {
      ...localArtifact,
      title: 'Redacted remote artifact',
      content: 'redacted',
      redacted: true,
    }
    const remoteEvent = {
      ...localEvent,
      message: 'Redacted remote event',
    }

    const merged = mergeLocalAndRemoteSnapshot({
      localRuns: [local.run],
      remoteRuns: [remoteRun],
      localArtifacts: [localArtifact],
      remoteArtifacts: [remoteArtifact],
      localEvents: [localEvent],
      remoteEvents: [remoteEvent],
    })

    expect(merged.runs).toEqual([local.run])
    expect(merged.artifacts).toEqual([localArtifact])
    expect(merged.events).toEqual([localEvent])
    expect(merged.remoteRunIds).toEqual([])
  })

  it('appends remote-only records and marks only those runs as remote', () => {
    const local = createWorkflowRunFromRequest({
      runId: 'run-local',
      title: 'Local workflow',
      request: 'Keep local state.',
      projectId: 'local-project-1',
      creatorId: 'u-wang',
      branchName: 'ai/local',
      now: '2026-06-21T16:00:00.000Z',
    })
    const remote = createWorkflowRunFromRequest({
      runId: 'run-remote',
      title: 'Remote workflow',
      request: 'Show remote-only state.',
      projectId: 'p-payments',
      creatorId: 'u-ling',
      branchName: 'ai/remote',
      now: '2026-06-21T16:05:00.000Z',
    })

    const merged = mergeLocalAndRemoteSnapshot({
      localRuns: [local.run],
      remoteRuns: [remote.run],
      localArtifacts: local.artifacts,
      remoteArtifacts: remote.artifacts,
      localEvents: local.events,
      remoteEvents: remote.events,
    })

    expect(merged.runs).toEqual([local.run, remote.run])
    expect(merged.artifacts).toEqual([...local.artifacts, ...remote.artifacts])
    expect(merged.events).toEqual([...local.events, ...remote.events])
    expect(merged.remoteRunIds).toEqual(['run-remote'])
  })
})
