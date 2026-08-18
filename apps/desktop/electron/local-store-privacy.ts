import type { Database, SqlValue } from 'sql.js'
import {
  redactCodingAgentEventForStorage,
  redactSensitiveText,
  redactTestEvidenceForStorage,
  sanitizeCodingDiffArtifact,
  type AgentEvent,
  type Artifact,
  type CodingAgentEvent,
  type CodingDiffArtifact,
  type TestEvidence,
} from '@ai-devflow/shared'

export const STORED_EVIDENCE_PRIVACY_VERSION = 1

export type StoredEvidencePrivacyWriters = {
  writeArtifact(db: Database, artifact: Artifact): void
  writeAgentEvent(db: Database, event: AgentEvent): void
  writeCodingAgentEvent(db: Database, event: CodingAgentEvent): void
  writeCodingDiffArtifact(db: Database, artifact: CodingDiffArtifact): void
  writeTestEvidence(db: Database, evidence: TestEvidence): void
}

function selectJson<T>(db: Database, sql: string, params: SqlValue[] = []): T[] {
  const result = db.exec(sql, params)
  return (result[0]?.values ?? []).map((row) => JSON.parse(String(row[0])) as T)
}

export function redactArtifactForStorage(artifact: Artifact): Artifact {
  if (artifact.kind !== 'test_report') return artifact
  return {
    ...artifact,
    title: redactSensitiveText(artifact.title).value,
    summary: redactSensitiveText(artifact.summary).value,
    content: redactSensitiveText(artifact.content).value,
    redacted: true,
  }
}

export function redactAgentEventForStorage(event: AgentEvent): AgentEvent {
  return event.kind === 'test_result'
    ? { ...event, message: redactSensitiveText(event.message).value }
    : event
}

export function maintainStoredEvidencePrivacy(
  db: Database,
  writers: StoredEvidencePrivacyWriters,
): void {
  for (const table of ['artifacts', 'agent_events', 'coding_agent_events', 'test_evidence']) {
    const unsupportedVersion = db.exec(
      `select privacy_version from ${table}
       where privacy_version > ${STORED_EVIDENCE_PRIVACY_VERSION}
       order by privacy_version desc limit 1`,
    )[0]?.values[0]?.[0]
    if (unsupportedVersion !== undefined) {
      throw new Error(
        `Stored evidence privacy version ${String(unsupportedVersion)} is newer than supported`,
      )
    }
  }

  const unsupportedFutureVersion = db.exec(`
    select sanitizer_version
    from coding_diff_artifacts
    where sanitizer_version > 2
    order by sanitizer_version desc
    limit 1
  `)[0]?.values[0]?.[0]
  if (unsupportedFutureVersion !== undefined) {
    throw new Error(
      `Coding Diff sanitizer version ${String(unsupportedFutureVersion)} is newer than supported`,
    )
  }

  const sanitizedAt = new Date().toISOString()
  for (const artifact of selectJson<CodingDiffArtifact>(
    db,
    `select json from coding_diff_artifacts
     where sanitizer_version is null or sanitizer_version < 2
     order by created_at asc, id asc`,
  )) {
    writers.writeCodingDiffArtifact(db, sanitizeCodingDiffArtifact({
      id: artifact.id,
      runId: artifact.runId,
      nodeId: artifact.nodeId,
      projectId: artifact.projectId,
      changedPaths: artifact.changedPaths,
      patch: artifact.patch,
      ...(artifact.sourceDigest ? { sourceDigest: artifact.sourceDigest } : {}),
      sanitizedAt,
      createdAt: artifact.createdAt,
    }))
  }

  for (const artifact of selectJson<Artifact>(
    db,
    `select json from artifacts
     where privacy_version is null or privacy_version < ${STORED_EVIDENCE_PRIVACY_VERSION}
     order by updated_at asc, id asc`,
  )) {
    writers.writeArtifact(db, redactArtifactForStorage(artifact))
  }
  for (const event of selectJson<AgentEvent>(
    db,
    `select json from agent_events
     where privacy_version is null or privacy_version < ${STORED_EVIDENCE_PRIVACY_VERSION}
     order by timestamp asc, id asc`,
  )) {
    writers.writeAgentEvent(db, redactAgentEventForStorage(event))
  }
  for (const event of selectJson<CodingAgentEvent>(
    db,
    `select json from coding_agent_events
     where privacy_version is null or privacy_version < ${STORED_EVIDENCE_PRIVACY_VERSION}
     order by timestamp asc, id asc`,
  )) {
    writers.writeCodingAgentEvent(db, redactCodingAgentEventForStorage(event))
  }
  for (const evidence of selectJson<TestEvidence>(
    db,
    `select json from test_evidence
     where privacy_version is null or privacy_version < ${STORED_EVIDENCE_PRIVACY_VERSION}
     order by created_at asc, id asc`,
  )) {
    writers.writeTestEvidence(db, redactTestEvidenceForStorage(evidence))
  }
}
