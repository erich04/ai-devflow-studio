import type {
  Artifact,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeDocumentCategory,
  KnowledgeEntity,
  KnowledgeGovernanceCheck,
  KnowledgeReference,
  KnowledgeRetrievalHit,
  KnowledgeRetrievalQuery,
  KnowledgeRetrievalStrategy,
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
  chunks: KnowledgeChunk[]
}

export type KnowledgeReferenceInput = {
  run: WorkflowRun
  artifacts: Artifact[]
  documents: KnowledgeDocument[]
  chunks?: KnowledgeChunk[]
  testEvidence: TestEvidence[]
  retriever?: KnowledgeRetriever
}

export type KnowledgeGovernanceInput = KnowledgeReferenceInput & {
  node: WorkflowNode
}

export type KnowledgeRetriever = {
  strategy: KnowledgeRetrievalStrategy
  retrieve: (query: KnowledgeRetrievalQuery, index: KnowledgeIndex) => KnowledgeRetrievalHit[]
}

const DEFAULT_UPDATED_AT = '2026-06-16T00:00:00.000Z'
const DEFAULT_MIN_SCORE = 2
const DEFAULT_TOP_K = 3

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

function stableContentHash(value: string): string {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return `kh-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function tokenize(value: string): string[] {
  return (
    value
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((token) => token.length >= 3) ?? []
  )
}

function uniqueTokens(value: string): string[] {
  return Array.from(new Set(tokenize(value)))
}

function countTokens(value: string): number {
  return tokenize(value).length
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

function buildKnowledgeChunksForDocument(
  document: KnowledgeDocument,
  body: string,
): KnowledgeChunk[] {
  const lines = body.split('\n')
  const chunks: KnowledgeChunk[] = []
  const headingStack: string[] = []
  let currentHeadingPath = [document.title]
  let currentLines: string[] = []

  function flushChunk() {
    const content = currentLines.join('\n').trim()
    if (!content) {
      return
    }

    const chunkNumber = chunks.length + 1
    const headingSlug = slugify(currentHeadingPath.at(-1) ?? document.title) || 'body'

    chunks.push({
      id: `knowledge-chunk-${slugify(basenameWithoutExtension(document.sourcePath))}-${chunkNumber}-${headingSlug}`,
      documentId: document.id,
      sourcePath: document.sourcePath,
      headingPath: currentHeadingPath,
      content,
      contentHash: stableContentHash(content),
      tokenCount: countTokens(content),
      tags: document.tags,
      updatedAt: document.updatedAt,
    })
  }

  for (const line of lines) {
    const headingMatch = /^(#{1,3})\s+(.+)$/u.exec(line.trim())

    if (headingMatch) {
      flushChunk()
      const level = headingMatch[1]!.length
      const heading = headingMatch[2]!.trim()
      headingStack.length = level - 1
      headingStack[level - 1] = heading
      currentHeadingPath = headingStack.filter(Boolean)
      currentLines = [line]
      continue
    }

    currentLines.push(line)
  }

  flushChunk()

  if (chunks.length > 0) {
    return chunks
  }

  const fallbackContent = body.trim() || document.summary
  return [
    {
      id: `knowledge-chunk-${slugify(basenameWithoutExtension(document.sourcePath))}-1-body`,
      documentId: document.id,
      sourcePath: document.sourcePath,
      headingPath: [document.title],
      content: fallbackContent,
      contentHash: stableContentHash(fallbackContent),
      tokenCount: countTokens(fallbackContent),
      tags: document.tags,
      updatedAt: document.updatedAt,
    },
  ]
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
  const indexedDocuments = sources.map((source) => {
    const { fields, body } = parseFrontmatter(source.markdown)
    const title = fields['title']?.trim() || titleFromMarkdown(body, source.sourcePath)
    const category = parseCategory(fields['category'], source.sourcePath)

    return {
      document: {
        id: `knowledge-doc-${slugify(basenameWithoutExtension(source.sourcePath))}`,
        title,
        category,
        sourcePath: source.sourcePath,
        summary: fields['summary']?.trim() || summaryFromMarkdown(body),
        tags: parseTags(fields['tags']),
        updatedAt: source.updatedAt || DEFAULT_UPDATED_AT,
        markdown: source.markdown,
        ...(fields['ownerId']?.trim() ? { ownerId: fields['ownerId'].trim() } : {}),
      } satisfies KnowledgeDocument,
      body,
    }
  })
  const documents = indexedDocuments.map((item) => item.document)
  const chunks = indexedDocuments.flatMap((item) =>
    buildKnowledgeChunksForDocument(item.document, item.body),
  )

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
    chunks,
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

function indexFromDocuments(
  documents: KnowledgeDocument[],
  chunks: KnowledgeChunk[] | undefined,
): KnowledgeIndex {
  return {
    documents,
    chunks:
      chunks ??
      documents.flatMap((document) => {
        const { body } = parseFrontmatter(document.markdown)
        return buildKnowledgeChunksForDocument(document, body)
      }),
    entities: [],
    relations: [],
  }
}

function formatMatchedText(tokens: string[]): string | undefined {
  return tokens.length > 0 ? tokens.slice(0, 6).join(', ') : undefined
}

function scoreLexicalHit(
  query: KnowledgeRetrievalQuery,
  document: KnowledgeDocument,
  chunk: KnowledgeChunk,
): { score: number; matchedTokens: string[] } {
  const queryTokens = uniqueTokens(searchableText([query.text, ...(query.tags ?? [])]))
  const chunkTokens = new Set(
    uniqueTokens(
      searchableText([
        document.title,
        document.summary,
        document.category,
        ...document.tags,
        ...chunk.headingPath,
        chunk.content,
      ]),
    ),
  )
  const matchedTokens: string[] = []
  let score = 0

  for (const token of queryTokens) {
    if (!chunkTokens.has(token)) {
      continue
    }

    matchedTokens.push(token)
    score += document.tags.includes(token) ? 3 : 1
    if (document.title.toLocaleLowerCase().includes(token)) {
      score += 1
    }
  }

  if (query.categories?.includes(document.category)) {
    score += 2
  }

  if (query.stage && documentsForNodeStage(query.stage).includes(document.category)) {
    score += 1
  }

  return { score, matchedTokens }
}

function documentsForNodeStage(stage: WorkflowNode['stage']): KnowledgeDocumentCategory[] {
  if (stage === 'test') {
    return ['testing_standard']
  }
  if (stage === 'pr') {
    return ['review_checklist']
  }
  if (stage === 'accept') {
    return ['review_checklist', 'adr']
  }
  if (stage === 'design') {
    return ['api_contract', 'adr', 'review_checklist', 'testing_standard']
  }
  if (stage === 'clarify') {
    return ['development_standard', 'onboarding']
  }

  return ['development_standard']
}

export const lexicalKnowledgeRetriever: KnowledgeRetriever = {
  strategy: 'lexical',
  retrieve(query, index) {
    const documentById = new Map(index.documents.map((document) => [document.id, document]))
    const minScore = query.minScore ?? DEFAULT_MIN_SCORE
    const topK = query.topK ?? DEFAULT_TOP_K

    return index.chunks
      .flatMap((chunk) => {
        const document = documentById.get(chunk.documentId)
        if (!document) {
          return []
        }
        if (query.categories?.length && !query.categories.includes(document.category)) {
          return []
        }

        const { score, matchedTokens } = scoreLexicalHit(query, document, chunk)
        if (score < minScore) {
          return []
        }
        const matchedText = formatMatchedText(matchedTokens)

        return [
          {
            documentId: document.id,
            chunkId: chunk.id,
            sourcePath: chunk.sourcePath,
            headingPath: chunk.headingPath,
            contentHash: chunk.contentHash,
            score,
            strategy: 'lexical',
            reason: `Matched ${matchedTokens.length} terms for ${document.title}.`,
            ...(matchedText ? { matchedText } : {}),
            category: document.category,
          } satisfies KnowledgeRetrievalHit,
        ]
      })
      .sort((left, right) => right.score - left.score || left.documentId.localeCompare(right.documentId))
      .slice(0, topK)
  },
}

export const heuristicKnowledgeRetriever: KnowledgeRetriever = {
  strategy: 'heuristic',
  retrieve(query, index) {
    return index.documents
      .filter((document) => documentMatchesText(document, query.text))
      .slice(0, query.topK ?? DEFAULT_TOP_K)
      .map((document) => {
        const chunk = index.chunks.find((item) => item.documentId === document.id)
        const fallbackContent = document.markdown || document.summary
        const headingPath = chunk?.headingPath ?? [document.title]
        const contentHash = chunk?.contentHash ?? stableContentHash(fallbackContent)
        const matchedText = documentNeedles(document).find((needle) =>
          query.text.toLocaleLowerCase().includes(needle),
        )

        return {
          documentId: document.id,
          chunkId: chunk?.id ?? `knowledge-chunk-${slugify(basenameWithoutExtension(document.sourcePath))}-1-body`,
          sourcePath: document.sourcePath,
          headingPath,
          contentHash,
          score: 1,
          strategy: 'heuristic',
          reason: `Heuristic match for ${document.title}.`,
          ...(matchedText ? { matchedText } : {}),
          category: document.category,
        } satisfies KnowledgeRetrievalHit
      })
  },
}

function referenceMetadataFromHit(hit: KnowledgeRetrievalHit) {
  return {
    chunkId: hit.chunkId,
    score: hit.score,
    strategy: hit.strategy,
    contentHash: hit.contentHash,
    headingPath: hit.headingPath,
  }
}

function firstChunkMetadataForDocument(
  document: KnowledgeDocument,
  chunks: KnowledgeChunk[],
): Pick<KnowledgeReference, 'chunkId' | 'contentHash' | 'headingPath'> {
  const chunk = chunks.find((item) => item.documentId === document.id)

  if (!chunk) {
    return {
      chunkId: `knowledge-chunk-${slugify(basenameWithoutExtension(document.sourcePath))}-1-body`,
      contentHash: stableContentHash(document.markdown || document.summary),
      headingPath: [document.title],
    }
  }

  return {
    chunkId: chunk.id,
    contentHash: chunk.contentHash,
    headingPath: chunk.headingPath,
  }
}

function documentsForNode(node: WorkflowNode, documents: KnowledgeDocument[]): KnowledgeDocument[] {
  const categories = documentsForNodeStage(node.stage)
  return documents.filter((document) => categories.includes(document.category))
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
  chunks,
  testEvidence,
  retriever = lexicalKnowledgeRetriever,
}: KnowledgeReferenceInput): KnowledgeReference[] {
  const references: KnowledgeReference[] = []
  const index = indexFromDocuments(documents, chunks)
  const runText = searchableText([run.title, run.request, run.branchName, run.status])

  for (const hit of retriever.retrieve(
    {
      id: `knowledge-query-run-${run.id}`,
      runId: run.id,
      targetType: 'run',
      text: runText,
      topK: 3,
      minScore: 2,
    },
    index,
  )) {
    pushReference(references, {
      runId: run.id,
      targetType: 'run',
      documentId: hit.documentId,
      relation: 'cites',
      reason: hit.reason,
      ...referenceMetadataFromHit(hit),
    })
  }

  for (const artifact of artifacts.filter((artifact) => artifact.runId === run.id)) {
    const artifactText = searchableText([
      artifact.title,
      artifact.summary,
      artifact.content,
      artifact.kind,
    ])
    for (const hit of retriever.retrieve(
      {
        id: `knowledge-query-artifact-${artifact.id}`,
        runId: run.id,
        targetType: 'artifact',
        artifactId: artifact.id,
        nodeId: artifact.nodeId,
        text: artifactText,
        topK: 3,
        minScore: 2,
      },
      index,
    )) {
      pushReference(references, {
        runId: run.id,
        targetType: 'artifact',
        artifactId: artifact.id,
        nodeId: artifact.nodeId,
        documentId: hit.documentId,
        relation: 'satisfies',
        reason: `${artifact.title} provides evidence. ${hit.reason}`,
        ...referenceMetadataFromHit(hit),
      })
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
        ...firstChunkMetadataForDocument(document, index.chunks),
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
        ...firstChunkMetadataForDocument(document, index.chunks),
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
  chunks,
  testEvidence,
  retriever = lexicalKnowledgeRetriever,
}: KnowledgeGovernanceInput): KnowledgeGovernanceCheck[] {
  const references = buildKnowledgeReferences({
    run,
    artifacts,
    documents,
    ...(chunks ? { chunks } : {}),
    testEvidence,
    retriever,
  })
  const runEvidence = testEvidence.filter((evidence) => evidence.runId === run.id)

  return documentsForNode(node, documents).map((document) => {
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
    const satisfyingArtifactReferences = references.filter(
      (reference) =>
        reference.documentId === document.id &&
        reference.targetType === 'artifact' &&
        reference.relation === 'satisfies' &&
        node.artifactIds.includes(reference.artifactId ?? ''),
    )

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
      status: satisfyingArtifactReferences.length > 0 ? 'satisfied' : 'needs_evidence',
      summary:
        satisfyingArtifactReferences.length > 0
          ? `${satisfyingArtifactReferences
              .map((reference) => reference.artifactId)
              .filter(Boolean)
              .join(', ')} cites this standard.`
          : 'No artifact evidence is linked yet.',
      referenceIds,
    } satisfies KnowledgeGovernanceCheck
  })
}
