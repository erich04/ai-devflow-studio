import { describe, expect, it, vi } from 'vitest'
import type {
  LocalProject,
  RepositoryKnowledgeSnapshot,
  WorkflowRun,
} from '@ai-devflow/shared'
import { createRepositoryKnowledgeResolver } from './repository-knowledge-resolver'

const project: LocalProject = {
  id: 'project-a',
  name: 'Project A',
  path: '/trusted/project-a',
  packageManager: 'pnpm',
  detectedTestCommand: 'pnpm test',
  testCommand: 'pnpm test',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

const run = {
  id: 'run-a',
  projectId: project.id,
  nodes: [{ id: 'node-a' }],
} as WorkflowRun

const snapshot: RepositoryKnowledgeSnapshot = {
  projectId: project.id,
  contentHash: 'sha256:abc',
  documents: [],
  chunks: [],
  entities: [],
  relations: [],
  indexedAt: '2026-08-01T00:00:00.000Z',
  truncated: false,
  warnings: [],
}

function createHarness() {
  const store = {
    listProjects: vi.fn(async () => [project]),
    listRuns: vi.fn(async () => [run]),
  }
  const cache = {
    load: vi.fn(async () => snapshot),
    refresh: vi.fn(async () => snapshot),
  }
  const resolver = createRepositoryKnowledgeResolver({
    getStore: async () => store,
    cache,
  })
  return { cache, resolver }
}

describe('repository knowledge resolver', () => {
  it('passes only the trusted LocalProject stored for an identifier to the cache', async () => {
    const { cache, resolver } = createHarness()

    await expect(resolver.loadProject('project-a')).resolves.toBe(snapshot)

    expect(cache.load).toHaveBeenCalledWith(project)
    expect(cache.refresh).not.toHaveBeenCalled()
  })

  it('uses the refresh path only when explicitly requested', async () => {
    const { cache, resolver } = createHarness()

    await expect(resolver.loadProject('project-a', { refresh: true })).resolves.toBe(snapshot)

    expect(cache.refresh).toHaveBeenCalledWith(project)
    expect(cache.load).not.toHaveBeenCalled()
  })

  it('resolves run knowledge from the canonical run project and validates the claimed scope', async () => {
    const { cache, resolver } = createHarness()

    await expect(resolver.loadRun({
      runId: run.id,
      nodeId: 'node-a',
      projectId: project.id,
    })).resolves.toBe(snapshot)
    expect(cache.load).toHaveBeenCalledWith(project)

    await expect(resolver.loadRun({
      runId: run.id,
      nodeId: 'node-a',
      projectId: 'project-b',
    })).rejects.toThrow('does not belong to the selected local project')
    expect(cache.load).toHaveBeenCalledTimes(1)
  })

  it('does not index before validating the canonical node', async () => {
    const { cache, resolver } = createHarness()

    await expect(resolver.loadRun({
      runId: run.id,
      nodeId: 'node-missing',
      projectId: project.id,
    })).rejects.toThrow('Run node not found')
    expect(cache.load).not.toHaveBeenCalled()
  })

  it('returns a fixed safe error when project lookup, indexing, or snapshot scope fails', async () => {
    const { cache, resolver } = createHarness()
    cache.load.mockRejectedValueOnce(new Error('EACCES /trusted/project-a/secret.md'))
    await expect(resolver.loadProject(project.id)).rejects.toThrow(
      'Repository knowledge is unavailable for this local project.',
    )

    cache.load.mockResolvedValueOnce({ ...snapshot, projectId: 'project-b' })
    await expect(resolver.loadProject(project.id)).rejects.toThrow(
      'Repository knowledge is unavailable for this local project.',
    )

    await expect(resolver.loadProject('missing')).rejects.toThrow(
      'Repository knowledge is unavailable for this local project.',
    )
  })
})
