import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Database } from 'sql.js'

export async function persistDatabase(db: Database, dbPath: string): Promise<void> {
  return persistDatabaseSnapshot(db.export(), dbPath)
}

export async function persistDatabaseSnapshot(
  snapshot: Uint8Array,
  dbPath: string,
): Promise<void> {
  await mkdir(path.dirname(dbPath), { recursive: true })
  const temporaryPath = `${dbPath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, Buffer.from(snapshot))
    await rename(temporaryPath, dbPath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
