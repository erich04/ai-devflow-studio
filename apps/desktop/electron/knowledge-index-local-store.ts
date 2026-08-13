import type { Database } from 'sql.js'
import {
  KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION,
  KNOWLEDGE_RETRIEVAL_VECTOR_DIMENSIONS_MAX,
} from '@ai-devflow/shared'

export type KnowledgeIndexSnapshotScope =
  | {
      kind: 'local'
      organizationId: null
      projectId: null
      localProjectId: string
    }
  | {
      kind: 'team'
      organizationId: string
      projectId: string
      localProjectId: string
    }

export type KnowledgeIndexEmbedding = {
  modelId: string
  modelVersion: string
  dimensions: number
}

export type KnowledgeIndexChunk = {
  stateVersion: typeof KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION
  documentId: string
  chunkId: string
  sourcePath: string
  headingPath: string[]
  contentHash: string
  content: string
  ordinal: number
  vector: KnowledgeIndexEmbedding & {
    values: number[]
    createdAt: string
  }
}

export type KnowledgeIndexSnapshotInput = {
  stateVersion: typeof KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION
  id: string
  scope: KnowledgeIndexSnapshotScope
  knowledgeSnapshotHash: string
  embedding: KnowledgeIndexEmbedding
  createdAt: string
}

export type KnowledgeIndexSnapshot = KnowledgeIndexSnapshotInput & {
  status: 'current' | 'superseded'
  updatedAt: string
  activatedAt: string
  chunks: KnowledgeIndexChunk[]
}

export type ActivateKnowledgeIndexSnapshotInput = {
  expectedCurrentSnapshotId: string | null
  snapshot: KnowledgeIndexSnapshotInput
  chunks: KnowledgeIndexChunk[]
  activatedAt: string
}

export type ActivateKnowledgeIndexSnapshotResult =
  | {
      activated: true
      replayed: boolean
      snapshot: KnowledgeIndexSnapshot
    }
  | {
      activated: false
      reason: 'invalid_input' | 'project_not_found' | 'snapshot_conflict' | 'id_conflict'
    }

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const hashPattern = /^sha256:[a-f0-9]{64}$/u

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && identifierPattern.test(value)
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isSafeSourcePath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 500 ||
    value.trim() !== value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('//')
  ) return false
  return value.split('/').every(
    (segment) => segment.length > 0 && segment !== '.' && segment !== '..',
  )
}

function parseEmbedding(value: unknown): KnowledgeIndexEmbedding {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['modelId', 'modelVersion', 'dimensions']) ||
    !isIdentifier(value.modelId) ||
    !isIdentifier(value.modelVersion) ||
    !Number.isInteger(value.dimensions) ||
    Number(value.dimensions) < 1 ||
    Number(value.dimensions) > KNOWLEDGE_RETRIEVAL_VECTOR_DIMENSIONS_MAX
  ) throw new Error('invalid_knowledge_index_snapshot')
  return {
    modelId: value.modelId,
    modelVersion: value.modelVersion,
    dimensions: Number(value.dimensions),
  }
}

function parseActivation(value: unknown): ActivateKnowledgeIndexSnapshotInput {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'expectedCurrentSnapshotId',
      'snapshot',
      'chunks',
      'activatedAt',
    ]) ||
    !(
      value.expectedCurrentSnapshotId === null ||
      isIdentifier(value.expectedCurrentSnapshotId)
    ) ||
    !isCanonicalIsoTimestamp(value.activatedAt) ||
    !isPlainRecord(value.snapshot) ||
    !hasExactKeys(value.snapshot, [
      'stateVersion',
      'id',
      'scope',
      'knowledgeSnapshotHash',
      'embedding',
      'createdAt',
    ]) ||
    value.snapshot.stateVersion !== KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION ||
    !isIdentifier(value.snapshot.id) ||
    typeof value.snapshot.knowledgeSnapshotHash !== 'string' ||
    !hashPattern.test(value.snapshot.knowledgeSnapshotHash) ||
    !isCanonicalIsoTimestamp(value.snapshot.createdAt) ||
    Date.parse(value.activatedAt) < Date.parse(value.snapshot.createdAt) ||
    !isPlainRecord(value.snapshot.scope) ||
    !hasExactKeys(value.snapshot.scope, [
      'kind',
      'organizationId',
      'projectId',
      'localProjectId',
    ]) ||
    !isIdentifier(value.snapshot.scope.localProjectId) ||
    !Array.isArray(value.chunks)
  ) throw new Error('invalid_knowledge_index_snapshot')

  const scope: KnowledgeIndexSnapshotScope = (() => {
    if (
      value.snapshot.scope.kind === 'local' &&
      value.snapshot.scope.organizationId === null &&
      value.snapshot.scope.projectId === null
    ) {
      return {
        kind: 'local',
        organizationId: null,
        projectId: null,
        localProjectId: value.snapshot.scope.localProjectId as string,
      }
    }
    if (
      value.snapshot.scope.kind === 'team' &&
      isIdentifier(value.snapshot.scope.organizationId) &&
      isIdentifier(value.snapshot.scope.projectId)
    ) {
      return {
        kind: 'team',
        organizationId: value.snapshot.scope.organizationId,
        projectId: value.snapshot.scope.projectId,
        localProjectId: value.snapshot.scope.localProjectId as string,
      }
    }
    throw new Error('invalid_knowledge_index_snapshot')
  })()
  const embedding = parseEmbedding(value.snapshot.embedding)
  const snapshotCreatedAt = value.snapshot.createdAt
  const activatedAt = value.activatedAt
  const chunks = value.chunks.map((candidate): KnowledgeIndexChunk => {
    if (
      !isPlainRecord(candidate) ||
      !hasExactKeys(candidate, [
        'stateVersion',
        'documentId',
        'chunkId',
        'sourcePath',
        'headingPath',
        'contentHash',
        'content',
        'ordinal',
        'vector',
      ]) ||
      candidate.stateVersion !== KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION ||
      !isIdentifier(candidate.documentId) ||
      !isIdentifier(candidate.chunkId) ||
      !isSafeSourcePath(candidate.sourcePath) ||
      !Array.isArray(candidate.headingPath) ||
      candidate.headingPath.length < 1 ||
      candidate.headingPath.length > 32 ||
      !candidate.headingPath.every(
        (heading) => typeof heading === 'string' &&
          heading.length > 0 &&
          heading.length <= 200 &&
          heading.trim() === heading,
      ) ||
      typeof candidate.contentHash !== 'string' ||
      !hashPattern.test(candidate.contentHash) ||
      typeof candidate.content !== 'string' ||
      candidate.content.length < 1 ||
      candidate.content.length > 65_536 ||
      candidate.content.trim() !== candidate.content ||
      !Number.isInteger(candidate.ordinal) ||
      Number(candidate.ordinal) < 0 ||
      Number(candidate.ordinal) > 2_147_483_647 ||
      !isPlainRecord(candidate.vector) ||
      !hasExactKeys(candidate.vector, [
        'modelId',
        'modelVersion',
        'dimensions',
        'values',
        'createdAt',
      ]) ||
      !isCanonicalIsoTimestamp(candidate.vector.createdAt) ||
      Date.parse(candidate.vector.createdAt) < Date.parse(snapshotCreatedAt) ||
      Date.parse(candidate.vector.createdAt) > Date.parse(activatedAt) ||
      !Array.isArray(candidate.vector.values)
    ) throw new Error('invalid_knowledge_index_snapshot')
    const vector = parseEmbedding({
      modelId: candidate.vector.modelId,
      modelVersion: candidate.vector.modelVersion,
      dimensions: candidate.vector.dimensions,
    })
    if (
      vector.modelId !== embedding.modelId ||
      vector.modelVersion !== embedding.modelVersion ||
      vector.dimensions !== embedding.dimensions ||
      candidate.vector.values.length !== embedding.dimensions ||
      !candidate.vector.values.every(
        (entry) => typeof entry === 'number' && Number.isFinite(entry),
      )
    ) throw new Error('invalid_knowledge_index_snapshot')
    return {
      stateVersion: KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION,
      documentId: candidate.documentId,
      chunkId: candidate.chunkId,
      sourcePath: candidate.sourcePath,
      headingPath: [...candidate.headingPath] as string[],
      contentHash: candidate.contentHash,
      content: candidate.content,
      ordinal: Number(candidate.ordinal),
      vector: {
        ...vector,
        values: [...candidate.vector.values] as number[],
        createdAt: candidate.vector.createdAt,
      },
    }
  }).sort((left, right) =>
    left.documentId.localeCompare(right.documentId) ||
    left.ordinal - right.ordinal ||
    left.chunkId.localeCompare(right.chunkId),
  )
  if (new Set(chunks.map((chunk) => chunk.chunkId)).size !== chunks.length) {
    throw new Error('invalid_knowledge_index_snapshot')
  }

  return {
    expectedCurrentSnapshotId: value.expectedCurrentSnapshotId as string | null,
    snapshot: {
      stateVersion: KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION,
      id: value.snapshot.id,
      scope,
      knowledgeSnapshotHash: value.snapshot.knowledgeSnapshotHash,
      embedding,
      createdAt: value.snapshot.createdAt,
    },
    chunks,
    activatedAt: value.activatedAt,
  }
}

function materializeSnapshot(
  input: ActivateKnowledgeIndexSnapshotInput,
): KnowledgeIndexSnapshot {
  return {
    ...input.snapshot,
    status: 'current',
    updatedAt: input.activatedAt,
    activatedAt: input.activatedAt,
    chunks: input.chunks,
  }
}

function readSnapshot(
  db: Database,
  where: 'id = ?' | "local_project_id = ? and status = 'current'",
  value: string,
): KnowledgeIndexSnapshot | null {
  const snapshotRow = db.exec(
    `select id, local_project_id, organization_id, team_project_id, snapshot_hash,
            embedding_model_id, embedding_model_version, vector_dimensions,
            status, state_version, created_at, updated_at, activated_at
       from knowledge_index_snapshots where ${where} limit 1`,
    [value],
  )[0]?.values[0]
  if (!snapshotRow) return null
  const status = String(snapshotRow[8])
  const activatedAt = snapshotRow[12] === null ? null : String(snapshotRow[12])
  if (
    !['current', 'superseded'].includes(status) ||
    activatedAt === null ||
    !isCanonicalIsoTimestamp(String(snapshotRow[11]))
  ) throw new Error('Stored Knowledge index snapshot is invalid')

  const chunkRows = db.exec(
    `select c.document_id, c.chunk_id, c.source_path, c.heading_path_json,
            c.content_hash, c.content_text, c.ordinal, c.state_version,
            v.model_id, v.model_version, v.vector_dimensions, v.vector_json, v.created_at
       from knowledge_index_chunks c
       left join knowledge_index_vectors v
         on v.snapshot_id = c.snapshot_id and v.chunk_id = c.chunk_id
      where c.snapshot_id = ?
      order by c.document_id asc, c.ordinal asc, c.chunk_id asc`,
    [String(snapshotRow[0])],
  )[0]?.values ?? []
  let chunks: unknown[]
  try {
    chunks = chunkRows.map((row) => ({
      stateVersion: Number(row[7]),
      documentId: String(row[0]),
      chunkId: String(row[1]),
      sourcePath: String(row[2]),
      headingPath: JSON.parse(String(row[3])) as unknown,
      contentHash: String(row[4]),
      content: String(row[5]),
      ordinal: Number(row[6]),
      vector: {
        modelId: String(row[8]),
        modelVersion: String(row[9]),
        dimensions: Number(row[10]),
        values: JSON.parse(String(row[11])) as unknown,
        createdAt: String(row[12]),
      },
    }))
  } catch {
    throw new Error('Stored Knowledge index snapshot is invalid')
  }
  const organizationId = snapshotRow[2] === null ? null : String(snapshotRow[2])
  const projectId = snapshotRow[3] === null ? null : String(snapshotRow[3])
  let parsed: ActivateKnowledgeIndexSnapshotInput
  try {
    parsed = parseActivation({
      expectedCurrentSnapshotId: null,
      snapshot: {
        stateVersion: Number(snapshotRow[9]),
        id: String(snapshotRow[0]),
        scope: {
          kind: organizationId === null && projectId === null ? 'local' : 'team',
          organizationId,
          projectId,
          localProjectId: String(snapshotRow[1]),
        },
        knowledgeSnapshotHash: String(snapshotRow[4]),
        embedding: {
          modelId: String(snapshotRow[5]),
          modelVersion: String(snapshotRow[6]),
          dimensions: Number(snapshotRow[7]),
        },
        createdAt: String(snapshotRow[10]),
      },
      chunks,
      activatedAt,
    })
  } catch {
    throw new Error('Stored Knowledge index snapshot is invalid')
  }
  return {
    ...materializeSnapshot(parsed),
    status: status as KnowledgeIndexSnapshot['status'],
    updatedAt: String(snapshotRow[11]),
  }
}

function hasRow(db: Database, sql: string, value: string): boolean {
  return (db.exec(sql, [value])[0]?.values.length ?? 0) > 0
}

export function activateKnowledgeIndexSnapshot(
  db: Database,
  value: ActivateKnowledgeIndexSnapshotInput,
): ActivateKnowledgeIndexSnapshotResult {
  let input: ActivateKnowledgeIndexSnapshotInput
  try {
    input = parseActivation(value)
  } catch {
    return { activated: false, reason: 'invalid_input' }
  }
  if (!hasRow(db, 'select id from local_projects where id = ? limit 1', input.snapshot.scope.localProjectId)) {
    return { activated: false, reason: 'project_not_found' }
  }

  const desired = materializeSnapshot(input)
  if (hasRow(db, 'select id from knowledge_index_snapshots where id = ? limit 1', input.snapshot.id)) {
    const existing = readSnapshot(db, 'id = ?', input.snapshot.id)
    if (
      existing?.status === 'current' &&
      JSON.stringify(existing) === JSON.stringify(desired)
    ) return { activated: true, replayed: true, snapshot: existing }
    return { activated: false, reason: 'id_conflict' }
  }

  const current = readSnapshot(
    db,
    "local_project_id = ? and status = 'current'",
    input.snapshot.scope.localProjectId,
  )
  if ((current?.id ?? null) !== input.expectedCurrentSnapshotId) {
    return { activated: false, reason: 'snapshot_conflict' }
  }

  db.run('begin transaction')
  try {
    if (current) {
      db.run(
        `update knowledge_index_snapshots
            set status = 'superseded', updated_at = ?
          where id = ? and status = 'current'`,
        [input.activatedAt, current.id],
      )
    }
    db.run(
      `insert into knowledge_index_snapshots (
         id, local_project_id, organization_id, team_project_id, snapshot_hash,
         embedding_model_id, embedding_model_version, vector_dimensions,
         status, state_version, created_at, updated_at, activated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?, ?)`,
      [
        input.snapshot.id,
        input.snapshot.scope.localProjectId,
        input.snapshot.scope.organizationId,
        input.snapshot.scope.projectId,
        input.snapshot.knowledgeSnapshotHash,
        input.snapshot.embedding.modelId,
        input.snapshot.embedding.modelVersion,
        input.snapshot.embedding.dimensions,
        input.snapshot.stateVersion,
        input.snapshot.createdAt,
        input.activatedAt,
        input.activatedAt,
      ],
    )
    for (const chunk of input.chunks) {
      db.run(
        `insert into knowledge_index_chunks (
           snapshot_id, document_id, chunk_id, source_path, heading_path_json,
           content_hash, content_text, ordinal, state_version
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.snapshot.id,
          chunk.documentId,
          chunk.chunkId,
          chunk.sourcePath,
          JSON.stringify(chunk.headingPath),
          chunk.contentHash,
          chunk.content,
          chunk.ordinal,
          chunk.stateVersion,
        ],
      )
      db.run(
        `insert into knowledge_index_vectors (
           snapshot_id, chunk_id, model_id, model_version,
           vector_dimensions, vector_json, created_at
         ) values (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.snapshot.id,
          chunk.chunkId,
          chunk.vector.modelId,
          chunk.vector.modelVersion,
          chunk.vector.dimensions,
          JSON.stringify(chunk.vector.values),
          chunk.vector.createdAt,
        ],
      )
    }
    db.run('commit')
  } catch (error) {
    db.run('rollback')
    throw error
  }
  return { activated: true, replayed: false, snapshot: desired }
}

export function getCurrentKnowledgeIndexSnapshot(
  db: Database,
  localProjectId: string,
): KnowledgeIndexSnapshot | null {
  if (!isIdentifier(localProjectId)) throw new Error('Invalid Local Project id')
  return readSnapshot(
    db,
    "local_project_id = ? and status = 'current'",
    localProjectId,
  )
}
