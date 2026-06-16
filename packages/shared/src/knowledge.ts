import type {
  Artifact,
  KnowledgeDocument,
  KnowledgeDocumentCategory,
  KnowledgeEntity,
  KnowledgeGovernanceCheck,
  KnowledgeReference,
  KnowledgeRelation,
  KnowledgeSourceFile,
  TestEvidence,
  WorkflowNode,
  WorkflowRun,
} from './domain'

export type KnowledgeGraph = {
  entities: KnowledgeEntity[]
  relations: KnowledgeRelation[]
}

export type KnowledgeIndex = KnowledgeGraph & {
  documents: KnowledgeDocument[]
}

export type KnowledgeReferenceInput = {
  run: WorkflowRun
  artifacts: Artifact[]
  documents: KnowledgeDocument[]
  testEvidence: TestEvidence[]
}

export type KnowledgeGovernanceInput = KnowledgeReferenceInput & {
  node: WorkflowNode
}

const DEFAULT_UPDATED_AT = '2026-06-16T00:00:00.000Z'

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

function slugify(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/\.md$/u, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
}

function basenameWithoutExtension(sourcePath: string): string {
  return sourcePath.split('/').at(-1)?.replace(/\.md$/u, '') ?? sourcePath
}

function parseFrontmatter(markdown: string): { fields: Record<string, string>; body: string } {
  if (!markdown.startsWith('---')) {
    return { fields: {}, body: markdown }
  }

  const endIndex = markdown.indexOf('\n---', 3)
  if (endIndex === -1) {
    return { fields: {}, body: markdown }
  }

  const rawFrontmatter = markdown.slice(3, endIndex).trim()
  const body = markdown.slice(endIndex + 4).trim()
  const fields: Record<string, string> = {}

  for (const line of rawFrontmatter.split('\n')) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    if (key) {
      fields[key] = value
    }
  }

  return { fields, body }
}

function parseTags(value: string | undefined): string[] {
  if (!value) {
    return []
  }

  return value
    .replace(/^\[/u, '')
    .replace(/\]$/u, '')
    .split(',')
    .map((tag) => tag.trim().replace(/^"|"$/gu, '').toLocaleLowerCase())
    .filter(Boolean)
}

function titleFromMarkdown(body: string, sourcePath: string): string {
  const heading = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('# '))

  if (heading) {
    return heading.replace(/^#\s+/u, '').trim()
  }

  return basenameWithoutExtension(sourcePath)
    .split(/[-_]/u)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(' ')
}

function summaryFromMarkdown(body: string): string {
  const paragraph = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#') && !line.startsWith('- '))

  return paragraph ?? 'No summary available.'
}

function parseCategory(value: string | undefined, sourcePath: string): KnowledgeDocumentCategory {
  const normalized = value?.trim() as KnowledgeDocumentCategory | undefined
  const allowed = new Set<KnowledgeDocumentCategory>([
    'development_standard',
    'testing_standard',
    'review_checklist',
    'adr',
    'api_contract',
    'onboarding',
    'skill_rule',
    'mcp_rule',
  ])

  if (normalized && allowed.has(normalized)) {
    return normalized
  }

  if (sourcePath.includes('/adr/')) {
    return 'adr'
  }
  if (sourcePath.includes('test')) {
    return 'testing_standard'
  }
  if (sourcePath.includes('review') || sourcePath.includes('checklist')) {
    return 'review_checklist'
  }
  if (sourcePath.includes('api')) {
    return 'api_contract'
  }
  if (sourcePath.includes('mcp')) {
    return 'mcp_rule'
  }
  if (sourcePath.includes('skill')) {
    return 'skill_rule'
  }
  if (sourcePath.includes('onboarding')) {
    return 'onboarding'
  }

  return 'development_standard'
}

function documentEntityKind(category: KnowledgeDocumentCategory): KnowledgeEntity['kind'] {
  if (category === 'adr') {
    return 'decision'
  }
  if (category === 'skill_rule' || category === 'mcp_rule') {
    return 'skill'
  }

  return 'standard'
}

export function indexKnowledgeSources(sources: KnowledgeSourceFile[]): KnowledgeIndex {
  const documents = sources.map((source) => {
    const { fields, body } = parseFrontmatter(source.markdown)
    const title = fields['title']?.trim() || titleFromMarkdown(body, source.sourcePath)
    const category = parseCategory(fields['category'], source.sourcePath)

    return {
      id: `knowledge-doc-${slugify(basenameWithoutExtension(source.sourcePath))}`,
      title,
      category,
      sourcePath: source.sourcePath,
      summary: fields['summary']?.trim() || summaryFromMarkdown(body),
      tags: parseTags(fields['tags']),
      updatedAt: source.updatedAt || DEFAULT_UPDATED_AT,
      markdown: source.markdown,
      ...(fields['ownerId']?.trim() ? { ownerId: fields['ownerId'].trim() } : {}),
    } satisfies KnowledgeDocument
  })

  const entities = new Map<string, KnowledgeEntity>()
  const relations: KnowledgeRelation[] = []

  for (const document of documents) {
    entities.set(document.id, {
      id: document.id,
      label: document.title,
      kind: documentEntityKind(document.category),
      sourcePath: document.sourcePath,
    })

    for (const tag of document.tags) {
      const tagId = `knowledge-tag-${slugify(tag)}`
      entities.set(tagId, {
        id: tagId,
        label: tag,
        kind: 'term',
        sourcePath: document.sourcePath,
      })
      relations.push({
        id: `knowledge-relation-${document.id}-${tagId}`,
        source: document.id,
        target: tagId,
        label: 'defines',
      })
    }
  }

  return {
    documents,
    entities: Array.from(entities.values()),
    relations,
  }
}

function searchableText(values: Array<string | undefined | null>): string {
  return values.filter(Boolean).join(' ').toLocaleLowerCase()
}

function documentNeedles(document: KnowledgeDocument): string[] {
  const titleTokens = document.title
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 4)

  return Array.from(new Set([...document.tags, ...titleTokens, document.category.replace('_', ' ')]))
}

function documentMatchesText(document: KnowledgeDocument, text: string): boolean {
  const haystack = text.toLocaleLowerCase()
  return documentNeedles(document).some((needle) => haystack.includes(needle))
}

function documentsForNode(node: WorkflowNode, documents: KnowledgeDocument[]): KnowledgeDocument[] {
  return documents.filter((document) => {
    if (node.stage === 'test') {
      return document.category === 'testing_standard'
    }
    if (node.stage === 'pr') {
      return document.category === 'review_checklist'
    }
    if (node.stage === 'accept') {
      return document.category === 'review_checklist' || document.category === 'adr'
    }
    if (node.stage === 'design') {
      return ['api_contract', 'adr', 'review_checklist', 'testing_standard'].includes(
        document.category,
      )
    }
    if (node.stage === 'clarify') {
      return document.category === 'development_standard' || document.category === 'onboarding'
    }

    return document.category === 'development_standard'
  })
}

function pushReference(references: KnowledgeReference[], reference: Omit<KnowledgeReference, 'id'>) {
  const id = [
    'knowledge-ref',
    reference.targetType,
    reference.runId,
    reference.nodeId,
    reference.artifactId,
    reference.evidenceId,
    reference.documentId,
    reference.relation,
  ]
    .filter(Boolean)
    .join('-')

  if (references.some((existing) => existing.id === id)) {
    return
  }

  references.push({ id, ...reference })
}

export function buildKnowledgeReferences({
  run,
  artifacts,
  documents,
  testEvidence,
}: KnowledgeReferenceInput): KnowledgeReference[] {
  const references: KnowledgeReference[] = []
  const runText = searchableText([run.title, run.request, run.branchName, run.status])

  for (const document of documents) {
    if (documentMatchesText(document, runText)) {
      pushReference(references, {
        runId: run.id,
        targetType: 'run',
        documentId: document.id,
        relation: 'cites',
        reason: `Run request matches ${document.title}.`,
      })
    }
  }

  for (const artifact of artifacts.filter((artifact) => artifact.runId === run.id)) {
    const artifactText = searchableText([
      artifact.title,
      artifact.summary,
      artifact.content,
      artifact.kind,
    ])
    for (const document of documents) {
      if (documentMatchesText(document, artifactText)) {
        pushReference(references, {
          runId: run.id,
          targetType: 'artifact',
          artifactId: artifact.id,
          nodeId: artifact.nodeId,
          documentId: document.id,
          relation: 'satisfies',
          reason: `${artifact.title} provides evidence for ${document.title}.`,
        })
      }
    }
  }

  for (const node of run.nodes.filter((node) => node.kind === 'gate')) {
    for (const document of documentsForNode(node, documents)) {
      pushReference(references, {
        runId: run.id,
        targetType: 'gate_decision',
        nodeId: node.id,
        documentId: document.id,
        relation: 'requires_evidence',
        reason: `${node.title} should review ${document.title}.`,
      })
    }
  }

  for (const evidence of testEvidence.filter((item) => item.runId === run.id)) {
    for (const document of documents.filter((item) => item.category === 'testing_standard')) {
      pushReference(references, {
        runId: run.id,
        targetType: 'test_evidence',
        evidenceId: evidence.id,
        nodeId: evidence.nodeId,
        documentId: document.id,
        relation: evidence.status === 'passed' ? 'satisfies' : 'violates',
        reason: `${evidence.command} ${evidence.status} against ${document.title}.`,
      })
    }
  }

  return references
}

export function buildKnowledgeGovernanceChecks({
  run,
  node,
  artifacts,
  documents,
  testEvidence,
}: KnowledgeGovernanceInput): KnowledgeGovernanceCheck[] {
  const references = buildKnowledgeReferences({ run, artifacts, documents, testEvidence })
  const nodeArtifacts = artifacts.filter(
    (artifact) => artifact.runId === run.id && node.artifactIds.includes(artifact.id),
  )
  const runEvidence = testEvidence.filter((evidence) => evidence.runId === run.id)

  return documentsForNode(node, documents).map((document) => {
    const artifactMatches = nodeArtifacts.filter((artifact) =>
      documentMatchesText(
        document,
        searchableText([artifact.title, artifact.summary, artifact.content, artifact.kind]),
      ),
    )
    const matchingEvidence = runEvidence.filter((evidence) =>
      document.category === 'testing_standard' && evidence.nodeId === node.id,
    )
    const referenceIds = references
      .filter(
        (reference) =>
          reference.documentId === document.id &&
          (!reference.nodeId || reference.nodeId === node.id || node.artifactIds.includes(reference.artifactId ?? '')),
      )
      .map((reference) => reference.id)

    if (document.category === 'testing_standard') {
      const hasPassingEvidence = matchingEvidence.some((evidence) => evidence.status === 'passed')
      const hasFailingEvidence = matchingEvidence.some(
        (evidence) => evidence.status === 'failed' || evidence.status === 'timed_out',
      )

      return {
        id: `knowledge-check-${run.id}-${node.id}-${document.id}`,
        runId: run.id,
        nodeId: node.id,
        documentId: document.id,
        title: document.title,
        category: document.category,
        status: hasPassingEvidence ? 'satisfied' : hasFailingEvidence ? 'violated' : 'needs_evidence',
        summary: hasPassingEvidence
          ? 'Passing local test evidence is linked to this standard.'
          : hasFailingEvidence
            ? 'Latest local test evidence violates this testing standard.'
            : 'Testing evidence has not been attached yet.',
        referenceIds,
      } satisfies KnowledgeGovernanceCheck
    }

    return {
      id: `knowledge-check-${run.id}-${node.id}-${document.id}`,
      runId: run.id,
      nodeId: node.id,
      documentId: document.id,
      title: document.title,
      category: document.category,
      status: artifactMatches.length > 0 ? 'satisfied' : 'needs_evidence',
      summary:
        artifactMatches.length > 0
          ? `${artifactMatches.map((artifact) => artifact.id).join(', ')} cites this standard.`
          : 'No artifact evidence is linked yet.',
      referenceIds,
    } satisfies KnowledgeGovernanceCheck
  })
}
