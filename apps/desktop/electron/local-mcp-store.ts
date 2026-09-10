import type { Database, SqlValue } from 'sql.js'
import { parseLocalMcpInstallation, type LocalMcpInstallation } from './local-mcp-installation'

export type CommitLocalMcpInstallationResult =
  | { committed: true; installation: LocalMcpInstallation }
  | { committed: false; reason: 'invalid_installation' | 'version_conflict' }

export type DeleteLocalMcpInstallationResult =
  | { deleted: true }
  | { deleted: false; reason: 'invalid_installation' | 'version_conflict' }

function selectJson(db: Database, sql: string, params: SqlValue[] = []): unknown[] {
  const result = db.exec(sql, params)
  return (result[0]?.values ?? []).map((row) => JSON.parse(String(row[0])) as unknown)
}

function isNonEmptyIdentifier(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    return false
  }
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

// The caller supplies its current Database and owns serialization and persistence.
// A rollback can replace that Database, so this module retains no connection.
export function commitLocalMcpInstallation(
  db: Database,
  { expectedInstallation, installation }: {
    expectedInstallation: LocalMcpInstallation | null
    installation: LocalMcpInstallation
  },
): CommitLocalMcpInstallationResult {
  let next: LocalMcpInstallation
  let expected: LocalMcpInstallation | null
  try {
    next = parseLocalMcpInstallation(installation)
    expected = expectedInstallation === null
      ? null
      : parseLocalMcpInstallation(expectedInstallation)
  } catch {
    return { committed: false, reason: 'invalid_installation' }
  }

  const serialized = JSON.stringify(next)
  if (expected === null) {
    if (next.version !== 1 || next.createdAt !== next.updatedAt) {
      return { committed: false, reason: 'invalid_installation' }
    }
    db.run(
      `
      insert into local_mcp_installations (
        id, version, enabled, transport, executable_sha256,
        state_version, json, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do nothing
      `,
      [
        next.id,
        next.version,
        next.enabled ? 1 : 0,
        next.transport,
        next.executableSha256,
        next.stateVersion,
        serialized,
        next.createdAt,
        next.updatedAt,
      ],
    )
  } else {
    if (
      next.id !== expected.id ||
      next.version !== expected.version + 1 ||
      next.createdAt !== expected.createdAt ||
      next.updatedAt <= expected.updatedAt
    ) {
      return { committed: false, reason: 'invalid_installation' }
    }
    db.run(
      `
      update local_mcp_installations
      set version = ?, enabled = ?, transport = ?, executable_sha256 = ?,
          state_version = ?, json = ?, updated_at = ?
      where id = ? and version = ? and json = ?
      `,
      [
        next.version,
        next.enabled ? 1 : 0,
        next.transport,
        next.executableSha256,
        next.stateVersion,
        serialized,
        next.updatedAt,
        expected.id,
        expected.version,
        JSON.stringify(expected),
      ],
    )
  }

  if (db.getRowsModified() !== 1) {
    return { committed: false, reason: 'version_conflict' }
  }
  return { committed: true, installation: next }
}

export function getLocalMcpInstallation(db: Database, installationId: string): LocalMcpInstallation | null {
  if (!isNonEmptyIdentifier(installationId) || installationId.length > 200) {
    throw new Error('Invalid Local MCP installation id')
  }
  const [value] = selectJson(
    db,
    'select json from local_mcp_installations where id = ?',
    [installationId],
  )
  return value === undefined ? null : parseLocalMcpInstallation(value)
}

export function deleteLocalMcpInstallation(
  db: Database,
  expectedInstallation: LocalMcpInstallation,
): DeleteLocalMcpInstallationResult {
  let expected: LocalMcpInstallation
  try {
    expected = parseLocalMcpInstallation(expectedInstallation)
  } catch {
    return { deleted: false, reason: 'invalid_installation' }
  }
  db.run(
    'delete from local_mcp_installations where id = ? and version = ? and json = ?',
    [expected.id, expected.version, JSON.stringify(expected)],
  )
  if (db.getRowsModified() !== 1) {
    return { deleted: false, reason: 'version_conflict' }
  }
  return { deleted: true }
}

export function listLocalMcpInstallations(db: Database): LocalMcpInstallation[] {
  return selectJson(
    db,
    'select json from local_mcp_installations order by id asc',
  ).map(parseLocalMcpInstallation)
}
