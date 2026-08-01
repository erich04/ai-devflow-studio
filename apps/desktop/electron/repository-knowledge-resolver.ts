import type {
  LocalProject,
  RepositoryKnowledgeSnapshot,
  WorkflowRun,
} from '@ai-devflow/shared'
import type { RepositoryKnowledgeCache } from './repository-knowledge-cache.js'

export type RepositoryKnowledgeResolverStore = {
  listProjects(): Promise<LocalProject[]>
  listRuns(): Promise<WorkflowRun[]>
}

export type RepositoryKnowledgeResolver = {
  loadProject(
    projectId: string,
    options?: { refresh?: boolean },
  ): Promise<RepositoryKnowledgeSnapshot>
  loadRun(input: {
    runId: string
    nodeId: string
    projectId: string
  }): Promise<RepositoryKnowledgeSnapshot>
}

export function createRepositoryKnowledgeResolver(deps: {
  getStore(): Promise<RepositoryKnowledgeResolverStore>
  cache: RepositoryKnowledgeCache
}): RepositoryKnowledgeResolver {
  async function loadProject(
    projectId: string,
    options: { refresh?: boolean } = {},
  ): Promise<RepositoryKnowledgeSnapshot> {
    try {
      const store = await deps.getStore()
      const project = (await store.listProjects()).find((candidate) => candidate.id === projectId)
      if (!project) {
        throw new Error('Repository knowledge project not found')
      }
      const snapshot = options.refresh
        ? await deps.cache.refresh(project)
        : await deps.cache.load(project)
      if (snapshot.projectId !== project.id) {
        throw new Error('Repository knowledge project mismatch')
      }
      return snapshot
    } catch {
      throw new Error('Repository knowledge is unavailable for this local project.')
    }
  }

  return {
    loadProject,
    async loadRun(input) {
      const store = await deps.getStore()
      const run = (await store.listRuns()).find((candidate) => candidate.id === input.runId)
      if (!run) {
        throw new Error(`Run not found: ${input.runId}`)
      }
      if (!run.nodes.some((candidate) => candidate.id === input.nodeId)) {
        throw new Error(`Run node not found: ${input.nodeId}`)
      }
      if (run.projectId !== input.projectId) {
        throw new Error('The requested Run does not belong to the selected local project.')
      }

      return loadProject(run.projectId)
    },
  }
}
