import type { KnowledgeEntity, KnowledgeRelation } from './domain'

export type KnowledgeGraph = {
  entities: KnowledgeEntity[]
  relations: KnowledgeRelation[]
}

export function findEntityNeighborhood(graph: KnowledgeGraph, entityId: string): KnowledgeGraph {
  const relations = graph.relations.filter(
    (relation) => relation.source === entityId || relation.target === entityId,
  )
  const entityIds = new Set([entityId])

  for (const relation of relations) {
    entityIds.add(relation.source)
    entityIds.add(relation.target)
  }

  return {
    entities: graph.entities.filter((entity) => entityIds.has(entity.id)),
    relations,
  }
}
