import {
  assembleRetrievedKnowledgeContext, redactSensitiveText, truncateUtf8,
  type NodeStage, type RetrievedKnowledgeManifest,
} from '@ai-devflow/shared'
import type { HindsightService } from './hindsight-service'
import { hindsightDigest } from './hindsight-store'

/** One retrieval per host action. The executor receives verified excerpts, never service access. */
export function createHindsightContextService(service: HindsightService) {
  return {
    async prepareRetrievedKnowledge(input: {
      projectId: string; userId: string; stage: NodeStage; query: string; signal?: AbortSignal
    }) {
      input.signal?.throwIfAborted()
      const scope = { projectId: input.projectId, userId: input.userId }
      const identity = await service.contextIdentity(scope)
      if (!identity) return undefined
      const query = truncateUtf8(redactSensitiveText(input.query).value.trim(), 2048).value || input.stage
      const result = await service.search(scope, { query, stage: input.stage, limit: 5 }, service.createSearchTurn(), input.signal)
      input.signal?.throwIfAborted()
      const context = assembleRetrievedKnowledgeContext({
        stage: input.stage, scope, queryDigest: hindsightDigest(query), ...identity, degraded: result.degraded,
        sources: result.matches.map((match) => ({
          sourceRef: match.readArgs.sourceRef, path: match.path, title: match.title,
          contentDigest: match.contentDigest, matchReason: match.matchReason, content: match.content,
          truncated: match.truncated,
        })),
      })
      await service.assertContextCurrent(context.manifest)
      input.signal?.throwIfAborted()
      return context
    },
    assertRetrievedKnowledgeCurrent: (manifest: RetrievedKnowledgeManifest) => service.assertContextCurrent(manifest),
  }
}
