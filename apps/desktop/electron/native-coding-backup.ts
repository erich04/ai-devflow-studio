import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { atomicCodingFile } from './coding-candidate-workspace'
import { ConversationContentStore } from './conversation-content-store'

const roots = ['devflow.sqlite', 'devflow.sqlite.contents', 'native-coding-harness', 'coding-worktrees', 'native-coding-profile.json']
type BackupEntry = { path: string; sha256: string; bytes: number; mode: number }
type BackupManifest = { schemaVersion: 1; sourceProfile: string; createdAt: string; platform: string; excluded: string[]; files: BackupEntry[] }
const require = createRequire(import.meta.url)
const exists = async (file: string) => { try { await lstat(file); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error } }
const safeRelative = (name: string) => !!name && !path.isAbsolute(name) && !name.includes('\\') && !name.includes('\0') && !name.includes(':') && name.split('/').every(part => part && part !== '.' && part !== '..') && roots.includes(name.split('/')[0]!)
async function hashFile(file: string) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex') }
async function inventory(directory: string): Promise<BackupEntry[]> {
  const files: BackupEntry[] = []
  const walk = async (relative: string): Promise<void> => {
    const file = path.join(directory, relative), info = await lstat(file)
    if (info.isSymbolicLink()) throw new Error('备份不跟随符号链接，请先核对资料目录。')
    if (info.isDirectory()) {
      for (const name of (await readdir(file)).sort()) if (!['node_modules', '.cache', 'coverage'].includes(name)) await walk(`${relative}/${name}`)
    } else if (info.isFile()) files.push({ path: relative, sha256: await hashFile(file), bytes: info.size, mode: info.mode & 0o777 })
    else throw new Error('资料目录包含非普通文件。')
  }
  for (const entry of roots) if (await exists(path.join(directory, entry))) await walk(entry)
  if (!files.some(file => file.path === 'devflow.sqlite')) throw new Error('缺少 devflow.sqlite，无法创建完整资料备份。')
  return files
}
async function assertStopped(profile: string): Promise<void> {
  if (await exists(path.join(profile, 'SingletonLock'))) throw new Error('请先停止 Electron，再备份资料。')
  const SQL = await initSqlJs({ locateFile: name => path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.js')), name) })
  const db = new SQL.Database(await readFile(path.join(profile, 'devflow.sqlite')))
  try {
    if (db.exec("select name from sqlite_master where type='table' and name='native_coding_sessions'").length) {
      const rows = db.exec('select json from native_coding_sessions')[0]?.values ?? []
      for (const [json] of rows) {
        const session = await new ConversationContentStore(path.join(profile, 'devflow.sqlite.contents')).decode<{ status: string; writer?: unknown; activity: Array<{ endedAt?: number }> }>(JSON.parse(String(json)))
        if (['ready', 'running', 'applying', 'verifying'].includes(session.status) || session.writer || session.activity.some(activity => activity.endedAt === undefined)) throw new Error('请先暂停全部任务并停止 Electron；活动资料不能热备份。')
      }
    }
  } finally { db.close() }
}
async function copyEntries(source: string, destination: string, files: BackupEntry[]) {
  for (const file of files) {
    if (!safeRelative(file.path)) throw new Error('Invalid backup path')
    const target = path.join(destination, file.path)
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await copyFile(path.join(source, file.path), target, 1); await chmod(target, file.mode)
  }
}
/** Offline, same-machine snapshot. No migration, credentials decryption, or mutation of the source. */
export async function backupNativeCodingData(profile: string, destination: string): Promise<BackupManifest> {
  profile = path.resolve(profile); destination = path.resolve(destination)
  if (destination === profile || destination.startsWith(profile + path.sep)) throw new Error('备份目录必须位于资料目录之外。')
  if (await exists(destination)) throw new Error('备份目标已存在，拒绝覆盖。')
  await assertStopped(profile)
  const files = await inventory(profile), temporary = `${destination}.creating-${randomUUID()}`
  await mkdir(temporary, { mode: 0o700 })
  try {
    await copyEntries(profile, temporary, files)
    await assertStopped(profile)
    if (JSON.stringify(files) !== JSON.stringify(await inventory(profile))) throw new Error('备份期间资料变化，请关闭应用后重试。')
    const manifest: BackupManifest = { schemaVersion: 1, sourceProfile: profile, createdAt: new Date().toISOString(), platform: process.platform, excluded: ['node_modules', '.cache', 'coverage'], files }
    await atomicCodingFile(path.join(temporary, 'manifest.json'), Buffer.from(JSON.stringify(manifest, null, 2)))
    await verifyNativeCodingBackup(temporary)
    await rename(temporary, destination)
    return manifest
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
export async function verifyNativeCodingBackup(directory: string): Promise<BackupManifest> {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as BackupManifest
  if (manifest.schemaVersion !== 1 || !path.isAbsolute(manifest.sourceProfile) || !Array.isArray(manifest.files) || manifest.files.some(file => !safeRelative(file.path)) || new Set(manifest.files.map(file => file.path)).size !== manifest.files.length) throw new Error('备份清单无效。')
  if (JSON.stringify(await inventory(directory)) !== JSON.stringify(manifest.files)) throw new Error('备份完整性检查失败。')
  return manifest
}
export async function restoreNativeCodingData(backup: string, profile: string): Promise<void> {
  const manifest = await verifyNativeCodingBackup(backup)
  profile = path.resolve(profile)
  if (profile !== manifest.sourceProfile || manifest.platform !== process.platform) throw new Error('仅支持在原机器平台和原资料路径恢复；不重写凭据或工作区身份。')
  if (await exists(profile)) throw new Error('资料目录已经存在，请关闭应用并保留原目录后再恢复；不会覆盖现有数据。')
  const temporary = `${profile}.restoring-${randomUUID()}`
  await mkdir(temporary, { mode: 0o700 })
  try {
    await copyEntries(backup, temporary, manifest.files)
    if (JSON.stringify(await inventory(temporary)) !== JSON.stringify(manifest.files)) throw new Error('恢复完整性检查失败。')
    await rename(temporary, profile)
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
