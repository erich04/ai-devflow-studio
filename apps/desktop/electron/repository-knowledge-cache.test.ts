import { describe, expect, it, vi } from 'vitest'
import type { LocalProject, RepositoryKnowledgeSnapshot } from '@ai-devflow/shared'
import {
  createRepositoryKnowledgeCache,
  type RepositoryKnowledgeCacheService,
} from './repository-knowledge-cache'

function project(id: string): LocalProject {
  return {
    id,
    name: id,
    path: `/trusted/${id}`,
    packageManager: 'pnpm',
    detectedTestCommand: 'pnpm test',
    testCommand: 'pnpm test',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

function snapshot(projectId: string, version: number): RepositoryKnowledgeSnapshot {
  return {
    projectId,
    contentHash: `sha256:${projectId}-${version}`,
    documents: [],
    chunks: [],
    entities: [],
    relations: [],
    indexedAt: `2026-08-01T00:00:0${version}.000Z`,
    truncated: false,
    warnings: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('repository knowledge cache', () => {
  it('returns the last-good snapshot immediately without reindexing', async () => {
    const projectA = project('project-a')
    const first = snapshot(projectA.id, 1)
    const service: RepositoryKnowledgeCacheService = {
      index: vi.fn(async () => first),
    }
    const cache = createRepositoryKnowledgeCache({ service })

    await expect(cache.load(projectA)).resolves.toBe(first)
    await expect(cache.load(projectA)).resolves.toBe(first)

    expect(service.index).toHaveBeenCalledTimes(1)
  })

  it('single-flights concurrent loads when no snapshot is cached', async () => {
    const projectA = project('project-a')
    const first = snapshot(projectA.id, 1)
    const indexing = deferred<RepositoryKnowledgeSnapshot>()
    const service: RepositoryKnowledgeCacheService = {
      index: vi.fn(() => indexing.promise),
    }
    const cache = createRepositoryKnowledgeCache({ service })

    const left = cache.load(projectA)
    const right = cache.load(projectA)

    expect(service.index).toHaveBeenCalledTimes(1)
    indexing.resolve(first)
    await expect(Promise.all([left, right])).resolves.toEqual([first, first])
  })

  it('indexes different project IDs independently without cross-project blocking', async () => {
    const projectA = project('project-a')
    const projectB = project('project-b')
    const indexingA = deferred<RepositoryKnowledgeSnapshot>()
    const indexingB = deferred<RepositoryKnowledgeSnapshot>()
    const service: RepositoryKnowledgeCacheService = {
      index: vi.fn((candidate) =>
        candidate.id === projectA.id ? indexingA.promise : indexingB.promise,
      ),
    }
    const cache = createRepositoryKnowledgeCache({ service })

    const loadA = cache.load(projectA)
    const loadB = cache.load(projectB)

    expect(service.index).toHaveBeenCalledTimes(2)
    indexingB.resolve(snapshot(projectB.id, 1))
    await expect(loadB).resolves.toMatchObject({ projectId: projectB.id })
    indexingA.resolve(snapshot(projectA.id, 1))
    await expect(loadA).resolves.toMatchObject({ projectId: projectA.id })
  })

  it('rebuilds and atomically replaces a last-good snapshot on idle refresh', async () => {
    const projectA = project('project-a')
    const first = snapshot(projectA.id, 1)
    const second = snapshot(projectA.id, 2)
    const service: RepositoryKnowledgeCacheService = {
      index: vi.fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second),
    }
    const cache = createRepositoryKnowledgeCache({ service })

    await cache.load(projectA)
    await expect(cache.refresh(projectA)).resolves.toBe(second)
    await expect(cache.load(projectA)).resolves.toBe(second)
    expect(service.index).toHaveBeenCalledTimes(2)
  })

  it('coalesces refreshes during an initial load into exactly one trailing rebuild', async () => {
    const projectA = project('project-a')
    const initial = deferred<RepositoryKnowledgeSnapshot>()
    const trailing = deferred<RepositoryKnowledgeSnapshot>()
    const first = snapshot(projectA.id, 1)
    const second = snapshot(projectA.id, 2)
    const service: RepositoryKnowledgeCacheService = {
      index: vi.fn()
        .mockImplementationOnce(() => initial.promise)
        .mockImplementationOnce(() => trailing.promise),
    }
    const cache = createRepositoryKnowledgeCache({ service })

    const load = cache.load(projectA)
    const refreshLeft = cache.refresh(projectA)
    const refreshRight = cache.refresh(projectA)

    expect(service.index).toHaveBeenCalledTimes(1)
    initial.resolve(first)
    await expect(load).resolves.toBe(first)
    await vi.waitFor(() => expect(service.index).toHaveBeenCalledTimes(2))
    trailing.resolve(second)

    await expect(Promise.all([refreshLeft, refreshRight])).resolves.toEqual([second, second])
    await expect(cache.load(projectA)).resolves.toBe(second)
    expect(service.index).toHaveBeenCalledTimes(2)
  })

  it('coalesces refreshes during an active refresh into one trailing rebuild', async () => {
    const projectA = project('project-a')
    const first = snapshot(projectA.id, 1)
    const second = snapshot(projectA.id, 2)
    const third = snapshot(projectA.id, 3)
    const activeRefresh = deferred<RepositoryKnowledgeSnapshot>()
    const trailingRefresh = deferred<RepositoryKnowledgeSnapshot>()
    const service: RepositoryKnowledgeCacheService = {
      index: vi.fn()
        .mockResolvedValueOnce(first)
        .mockImplementationOnce(() => activeRefresh.promise)
        .mockImplementationOnce(() => trailingRefresh.promise),
    }
    const cache = createRepositoryKnowledgeCache({ service })
    await cache.load(projectA)

    const refreshStartedIdle = cache.refresh(projectA)
    const refreshDuringActive = cache.refresh(projectA)

    expect(service.index).toHaveBeenCalledTimes(2)
    await expect(cache.load(projectA)).resolves.toBe(first)
    activeRefresh.resolve(second)
    await vi.waitFor(() => expect(service.index).toHaveBeenCalledTimes(3))
    trailingRefresh.resolve(third)

    await expect(
      Promise.all([refreshStartedIdle, refreshDuringActive]),
    ).resolves.toEqual([third, third])
    await expect(cache.load(projectA)).resolves.toBe(third)
    expect(service.index).toHaveBeenCalledTimes(3)
  })

  it('rejects a failed refresh while retaining the last-good snapshot', async () => {
    const projectA = project('project-a')
    const first = snapshot(projectA.id, 1)
    const refreshError = new Error('index unavailable')
    const service: RepositoryKnowledgeCacheService = {
      index: vi.fn()
        .mockResolvedValueOnce(first)
        .mockRejectedValueOnce(refreshError),
    }
    const cache = createRepositoryKnowledgeCache({ service })
    await cache.load(projectA)

    await expect(cache.refresh(projectA)).rejects.toBe(refreshError)
    await expect(cache.load(projectA)).resolves.toBe(first)
    expect(service.index).toHaveBeenCalledTimes(2)
  })

  it('propagates an initial indexing failure without fabricating an empty snapshot', async () => {
    const projectA = project('project-a')
    const initialError = new Error('not a repository')
    const recovered = snapshot(projectA.id, 1)
    const service: RepositoryKnowledgeCacheService = {
      index: vi.fn()
        .mockRejectedValueOnce(initialError)
        .mockResolvedValueOnce(recovered),
    }
    const cache = createRepositoryKnowledgeCache({ service })

    await expect(cache.load(projectA)).rejects.toBe(initialError)
    await expect(cache.load(projectA)).resolves.toBe(recovered)
    expect(service.index).toHaveBeenCalledTimes(2)
  })
})
