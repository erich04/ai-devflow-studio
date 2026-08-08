import type { LocalProject, RepositoryKnowledgeSnapshot } from '@ai-devflow/shared'
import { createRepositoryKnowledgeService } from './repository-knowledge'

export type RepositoryKnowledgeCacheService = {
  index(project: LocalProject): Promise<RepositoryKnowledgeSnapshot>
}

export type RepositoryKnowledgeCache = {
  load(project: LocalProject): Promise<RepositoryKnowledgeSnapshot>
  refresh(project: LocalProject): Promise<RepositoryKnowledgeSnapshot>
}

type ProjectCacheState = {
  project: LocalProject
  snapshot?: RepositoryKnowledgeSnapshot
  activeIndex?: Promise<RepositoryKnowledgeSnapshot>
  refreshRequested: boolean
  refreshCycle?: Promise<RepositoryKnowledgeSnapshot>
}

export function createRepositoryKnowledgeCache(options: {
  service?: RepositoryKnowledgeCacheService
} = {}): RepositoryKnowledgeCache {
  const service = options.service ?? createRepositoryKnowledgeService()
  const projects = new Map<string, ProjectCacheState>()

  function stateFor(project: LocalProject): ProjectCacheState {
    const existing = projects.get(project.id)
    if (existing) {
      existing.project = project
      return existing
    }
    const created: ProjectCacheState = {
      project,
      refreshRequested: false,
    }
    projects.set(project.id, created)
    return created
  }

  function indexOnce(state: ProjectCacheState): Promise<RepositoryKnowledgeSnapshot> {
    if (state.activeIndex) return state.activeIndex

    let serviceResult: Promise<RepositoryKnowledgeSnapshot>
    try {
      serviceResult = service.index(state.project)
    } catch (error) {
      serviceResult = Promise.reject(error)
    }
    const indexing = serviceResult
      .then((indexed) => {
        state.snapshot = indexed
        return indexed
      })
      .finally(() => {
        if (state.activeIndex === indexing) {
          delete state.activeIndex
        }
      })
    state.activeIndex = indexing
    return indexing
  }

  function startRefreshCycle(state: ProjectCacheState): Promise<RepositoryKnowledgeSnapshot> {
    const drain = (async () => {
      if (state.activeIndex) {
        try {
          await state.activeIndex
        } catch {
          // A queued refresh still gets its own indexing attempt after an initial failure.
        }
      }

      let finalError: unknown
      while (state.refreshRequested) {
        state.refreshRequested = false
        try {
          await indexOnce(state)
          finalError = undefined
        } catch (error) {
          finalError = error
        }
      }

      if (finalError !== undefined) throw finalError
      if (!state.snapshot) {
        throw new Error('Repository knowledge indexing completed without a snapshot.')
      }
      return state.snapshot
    })()
    const tracked = drain.finally(() => {
      if (state.refreshCycle === tracked) {
        delete state.refreshCycle
      }
    })
    state.refreshCycle = tracked
    return tracked
  }

  return {
    load(project) {
      const state = stateFor(project)
      if (state.snapshot) return Promise.resolve(state.snapshot)
      if (state.refreshCycle) return state.refreshCycle
      return indexOnce(state)
    },
    refresh(project) {
      const state = stateFor(project)
      state.refreshRequested = true
      return state.refreshCycle ?? startRefreshCycle(state)
    },
  }
}
