import { isDeepStrictEqual } from 'node:util'
import type { Database, SqlValue } from 'sql.js'
import {
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  hasSupportedCodingDiffSanitization,
  normalizeWorkflowRunProgress,
  redactCodingAgentEventForStorage,
  redactTestEvidenceForStorage,
  sanitizeCodingDiffArtifact,
  type AgentEvent,
  type Artifact,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingDiffArtifact,
  type CodingPermissionDecision,
  type CodingPermissionRequest,
  type TestEvidence,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import {
  redactAgentEventForStorage,
  redactArtifactForStorage,
  STORED_EVIDENCE_PRIVACY_VERSION,
} from './local-store-privacy'

function selectJson<T>(db: Database, sql: string, params: SqlValue[] = []): T[] {
  const result = db.exec(sql, params)
  return (result[0]?.values ?? []).map((row) => JSON.parse(String(row[0])) as T)
}

type StoredWorkflowRunJson = Omit<WorkflowRun, 'nodes' | 'edges' | 'version'> & {
  version?: number
  nodes?: WorkflowNode[]
  edges?: WorkflowEdge[]
}

function hydrateStoredWorkflowRun(input: {
  storedRun: StoredWorkflowRunJson
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}): WorkflowRun {
  return normalizeWorkflowRunProgress({
    ...input.storedRun,
    version: input.storedRun.version ?? 1,
    nodes: input.nodes,
    edges: input.edges,
  })
}

function workflowRunEnvelope(run: WorkflowRun): Omit<WorkflowRun, 'nodes' | 'edges'> {
  const { nodes: _nodes, edges: _edges, ...envelope } = run
  return envelope
}

function writeWorkflowRunEnvelope(db: Database, run: WorkflowRun): void {
  const envelope = workflowRunEnvelope(run)
  db.run(
    `
    insert into workflow_runs (id, json, created_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at
    `,
    [run.id, JSON.stringify(envelope), run.createdAt, run.updatedAt],
  )
}

function replaceWorkflowNodes(db: Database, run: WorkflowRun): void {
  db.run('delete from workflow_nodes where run_id = ?', [run.id])
  for (const [position, node] of run.nodes.entries()) {
    db.run(
      `
      insert into workflow_nodes (
        id,
        run_id,
        stage,
        title,
        subtitle,
        kind,
        status,
        owner_id,
        required_role,
        retry_count,
        token_usage_id,
        artifact_ids,
        position,
        json,
        created_at,
        updated_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        node.id,
        run.id,
        node.stage,
        node.title,
        node.subtitle,
        node.kind,
        node.status,
        node.ownerId,
        node.requiredRole ?? null,
        node.retryCount,
        node.tokenUsageId ?? null,
        JSON.stringify(node.artifactIds),
        position,
        JSON.stringify(node),
        run.createdAt,
        run.updatedAt,
      ],
    )
  }
}

function replaceWorkflowEdges(db: Database, run: WorkflowRun): void {
  db.run('delete from workflow_edges where run_id = ?', [run.id])
  for (const [position, edge] of run.edges.entries()) {
    db.run(
      `
      insert into workflow_edges (
        id,
        run_id,
        source_node_id,
        target_node_id,
        kind,
        position,
        json,
        created_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        edge.id,
        run.id,
        edge.source,
        edge.target,
        edge.kind,
        position,
        JSON.stringify(edge),
        run.createdAt,
      ],
    )
  }
}

function selectWorkflowNodeRows(db: Database): Array<{ runId: string; node: WorkflowNode }> {
  const result = db.exec('select run_id, json from workflow_nodes order by run_id asc, position asc')
  const first = result[0]
  if (!first) {
    return []
  }

  return first.values.map((row) => ({
    runId: String(row[0]),
    node: JSON.parse(String(row[1])) as WorkflowNode,
  }))
}

function selectWorkflowEdgeRows(db: Database): Array<{ runId: string; edge: WorkflowEdge }> {
  const result = db.exec('select run_id, json from workflow_edges order by run_id asc, position asc')
  const first = result[0]
  if (!first) {
    return []
  }

  return first.values.map((row) => ({
    runId: String(row[0]),
    edge: JSON.parse(String(row[1])) as WorkflowEdge,
  }))
}

function groupRowsByRunId<T>(rows: Array<{ runId: string } & T>): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const existing = grouped.get(row.runId) ?? []
    const { runId: _runId, ...value } = row
    grouped.set(row.runId, [...existing, value as T])
  }
  return grouped
}

export function migrateWorkflowRunsIntoRelationalTables(db: Database): void {
  const storedRuns = selectJson<StoredWorkflowRunJson>(
    db,
    'select json from workflow_runs order by updated_at desc, created_at desc',
  )
  for (const storedRun of storedRuns) {
    const runNodes = storedRun.nodes ?? []
    const runEdges = storedRun.edges ?? []
    if (runNodes.length === 0 && runEdges.length === 0) {
      continue
    }

    const run = hydrateStoredWorkflowRun({
      storedRun,
      nodes: runNodes,
      edges: runEdges,
    })
    writeWorkflowRunEnvelope(db, run)
    replaceWorkflowNodes(db, run)
    replaceWorkflowEdges(db, run)
  }
}

export function readWorkflowRuns(db: Database): WorkflowRun[] {
  const storedRuns = selectJson<StoredWorkflowRunJson>(
    db,
    'select json from workflow_runs order by updated_at desc, created_at desc',
  )
  const nodesByRun = groupRowsByRunId(selectWorkflowNodeRows(db)).entries()
  const edgesByRun = groupRowsByRunId(selectWorkflowEdgeRows(db)).entries()
  const nodeMap = new Map(
    Array.from(nodesByRun).map(([runId, rows]) => [
      runId,
      rows.map((row) => row.node),
    ]),
  )
  const edgeMap = new Map(
    Array.from(edgesByRun).map(([runId, rows]) => [
      runId,
      rows.map((row) => row.edge),
    ]),
  )

  return storedRuns.map((storedRun) =>
    hydrateStoredWorkflowRun({
      storedRun,
      nodes: nodeMap.get(storedRun.id) ?? storedRun.nodes ?? [],
      edges: edgeMap.get(storedRun.id) ?? storedRun.edges ?? [],
    }),
  )
}

export function writeWorkflowRun(db: Database, run: WorkflowRun): void {
  writeWorkflowRunEnvelope(db, run)
  replaceWorkflowNodes(db, run)
  replaceWorkflowEdges(db, run)
}

export function writeArtifact(db: Database, artifact: Artifact): void {
  const safeArtifact = redactArtifactForStorage(artifact)
  db.run(
    `
    insert into artifacts (id, run_id, json, updated_at, privacy_version)
    values (?, ?, ?, ?, ?)
    on conflict(id) do update set
      json = excluded.json,
      updated_at = excluded.updated_at,
      privacy_version = excluded.privacy_version
    `,
    [
      safeArtifact.id,
      safeArtifact.runId,
      JSON.stringify(safeArtifact),
      safeArtifact.updatedAt,
      STORED_EVIDENCE_PRIVACY_VERSION,
    ],
  )
}

export function writeAgentEvent(db: Database, event: AgentEvent): void {
  const safeEvent = redactAgentEventForStorage(event)
  db.run(
    `
    insert into agent_events (id, run_id, sequence, json, timestamp, privacy_version)
    values (?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      json = excluded.json,
      sequence = excluded.sequence,
      timestamp = excluded.timestamp,
      privacy_version = excluded.privacy_version
    `,
    [
      safeEvent.id,
      safeEvent.runId,
      safeEvent.sequence,
      JSON.stringify(safeEvent),
      safeEvent.timestamp,
      STORED_EVIDENCE_PRIVACY_VERSION,
    ],
  )
}

export function writeCodingAgentEvent(db: Database, event: CodingAgentEvent): void {
  const safeEvent = redactCodingAgentEventForStorage(event)
  db.run(
    `
    insert into coding_agent_events (
      id, coding_run_id, run_id, node_id, sequence, json, timestamp, privacy_version
    )
    values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      json = excluded.json,
      sequence = excluded.sequence,
      timestamp = excluded.timestamp,
      privacy_version = excluded.privacy_version
    `,
    [
      safeEvent.id,
      safeEvent.codingRunId,
      safeEvent.runId,
      safeEvent.nodeId,
      safeEvent.sequence,
      JSON.stringify(safeEvent),
      safeEvent.timestamp,
      STORED_EVIDENCE_PRIVACY_VERSION,
    ],
  )
}

export function writeCodingAgentRun(db: Database, run: CodingAgentRun): void {
  db.run(
    `
    insert into coding_agent_runs (id, run_id, node_id, json, started_at, updated_at)
    values (?, ?, ?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at
    `,
    [
      run.id,
      run.runId,
      run.nodeId,
      JSON.stringify(run),
      run.startedAt,
      run.completedAt ?? run.startedAt,
    ],
  )
}

export function writeCodingPermissionRequest(db: Database, request: CodingPermissionRequest): void {
  db.run(
    `
    insert into coding_permission_requests (id, coding_run_id, run_id, node_id, json, requested_at)
    values (?, ?, ?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, requested_at = excluded.requested_at
    `,
    [
      request.id,
      request.codingRunId,
      request.runId,
      request.nodeId,
      JSON.stringify(request),
      request.requestedAt,
    ],
  )
}

export function writeCodingPermissionDecision(db: Database, decision: CodingPermissionDecision): void {
  db.run(
    `
    insert into coding_permission_decisions (id, request_id, coding_run_id, json, decided_at)
    values (?, ?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, decided_at = excluded.decided_at
    `,
    [
      decision.id,
      decision.requestId,
      decision.codingRunId,
      JSON.stringify(decision),
      decision.decidedAt,
    ],
  )
}

export function writeCodingDiffArtifact(db: Database, artifact: CodingDiffArtifact): void {
  if (!hasSupportedCodingDiffSanitization(artifact)) {
    throw new Error('Coding Diff Artifact must carry supported sanitizer provenance')
  }
  const canonicalArtifact = sanitizeCodingDiffArtifact({
    id: artifact.id,
    runId: artifact.runId,
    nodeId: artifact.nodeId,
    projectId: artifact.projectId,
    changedPaths: artifact.changedPaths,
    patch: artifact.patch,
    ...(artifact.sourceDigest ? { sourceDigest: artifact.sourceDigest } : {}),
    sanitizedAt: artifact.sanitizedAt!,
    createdAt: artifact.createdAt,
  })
  if (!isDeepStrictEqual(canonicalArtifact, artifact)) {
    throw new Error('Coding Diff Artifact must be canonically sanitized')
  }
  db.run(
    `
    insert into coding_diff_artifacts (
      id, run_id, node_id, project_id, json, sanitizer_version,
      sanitized_at, secret_replacement_count, created_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      json = excluded.json,
      sanitizer_version = excluded.sanitizer_version,
      sanitized_at = excluded.sanitized_at,
      secret_replacement_count = excluded.secret_replacement_count,
      created_at = excluded.created_at
    `,
    [
      artifact.id,
      artifact.runId,
      artifact.nodeId,
      artifact.projectId,
      JSON.stringify(artifact),
      artifact.sanitizerVersion!,
      artifact.sanitizedAt!,
      artifact.secretReplacementCount!,
      artifact.createdAt,
    ],
  )
}

export function writeTestEvidence(db: Database, evidence: TestEvidence): void {
  const safeEvidence = redactTestEvidenceForStorage(evidence)
  db.run(
    `
    insert into test_evidence (
      id, run_id, node_id, project_id, json, created_at, privacy_version
    )
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      json = excluded.json,
      created_at = excluded.created_at,
      privacy_version = excluded.privacy_version
    `,
    [
      safeEvidence.id,
      safeEvidence.runId,
      safeEvidence.nodeId,
      safeEvidence.projectId,
      JSON.stringify(safeEvidence),
      safeEvidence.createdAt,
      STORED_EVIDENCE_PRIVACY_VERSION,
    ],
  )
  const artifact = selectJson<Artifact>(
    db,
    'select json from artifacts where id = ? limit 1',
    [`artifact-${safeEvidence.id}`],
  )[0]
  if (
    artifact?.kind === 'test_report' &&
    artifact.runId === safeEvidence.runId &&
    artifact.nodeId === safeEvidence.nodeId
  ) {
    writeArtifact(db, createTestEvidenceArtifact(safeEvidence))
  }
  const event = selectJson<AgentEvent>(
    db,
    'select json from agent_events where id = ? limit 1',
    [`event-${safeEvidence.id}`],
  )[0]
  if (
    event?.kind === 'test_result' &&
    event.runId === safeEvidence.runId &&
    event.nodeId === safeEvidence.nodeId
  ) {
    writeAgentEvent(db, createTestEvidenceEvent(safeEvidence, event.sequence))
  }
}


