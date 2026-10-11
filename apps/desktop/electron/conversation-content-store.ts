import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, open, link, unlink, appendFile } from 'node:fs/promises'
import { join } from 'node:path'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
type StoredContent = { format: 'devflow-private-content-v1'; scope: string; document: unknown; strings: Array<{ path: Array<string | number>; hash: string; bytes: number }> }
/** Main-process-only, append-only content. SQLite stores references; no paths cross IPC. */
export class ConversationContentStore {
  constructor(private readonly root: string) {}
  contentPath(scope: string, digest: string): string {
    if (!/^[a-f0-9]{64}$/u.test(scope) || !/^[a-f0-9]{64}$/u.test(digest)) throw new Error('Invalid private content reference')
    return join(this.root, scope, digest)
  }
  async appendStream(scopeId: string, requestId: string, channel: 'content' | 'reasoning', text: string): Promise<void> {
    const directory = join(this.root, hash(scopeId), 'streams')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await appendFile(join(directory, `${hash(requestId)}.${channel}`), text, { mode: 0o600 })
  }
  async readStreamReasoning(scopeId: string, requestId: string): Promise<string | undefined> {
    try { return await readFile(join(this.root, hash(scopeId), 'streams', `${hash(requestId)}.reasoning`), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  }
  async encode(scopeId: string, value: unknown): Promise<StoredContent> {
    const scope = hash(scopeId)
    const strings: StoredContent['strings'] = []
    const visit = async (item: unknown, path: Array<string | number>): Promise<unknown> => {
      if (typeof item === 'string' && Buffer.byteLength(item) > 16_384) {
        const digest = hash(item)
        await mkdir(join(this.root, scope), { recursive: true, mode: 0o700 })
        const destination = this.contentPath(scope, digest)
        let exists = false
        try { if (hash(await readFile(destination, 'utf8')) !== digest) throw new Error('Private content integrity check failed'); exists = true }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        if (!exists) {
          const temporary = `${destination}.${randomUUID()}.tmp`
          try {
            const handle = await open(temporary, 'wx', 0o600)
            try { await handle.writeFile(item, 'utf8'); await handle.sync() }
            finally { await handle.close() }
            // Publish the complete immutable file without replacing concurrent readers
            // or another writer's identical blob (rename-over-existing can fail on Windows).
            try { await link(temporary, destination) }
            catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
              if (hash(await readFile(destination, 'utf8')) !== digest) throw new Error('Private content integrity check failed')
            }
          }
          finally { await unlink(temporary).catch(() => undefined) }
        }
        strings.push({ path, hash: digest, bytes: Buffer.byteLength(item) })
        return ''
      }
      if (Array.isArray(item)) return Promise.all(item.map((child, index) => visit(child, [...path, index])))
      if (item && typeof item === 'object') return Object.fromEntries(await Promise.all(Object.entries(item).map(async ([key, child]) => [key, await visit(child, [...path, key])])))
      return item
    }
    return { format: 'devflow-private-content-v1', scope, document: await visit(value, []), strings }
  }
  async decode<T>(value: unknown): Promise<T> {
    const stored = value as StoredContent
    if (stored?.format !== 'devflow-private-content-v1') return value as T
    const document = structuredClone(stored.document) as Record<string, unknown>
    if (typeof document.id === 'string' && stored.scope !== hash(document.id)) throw new Error('Private content scope mismatch')
    for (const reference of stored.strings) {
      const text = await readFile(this.contentPath(stored.scope, reference.hash), 'utf8')
      if (Buffer.byteLength(text) !== reference.bytes || hash(text) !== reference.hash) throw new Error('Private content integrity check failed')
      let owner = document as Record<string | number, unknown>
      for (const segment of reference.path.slice(0, -1)) {
        if (typeof segment === 'string' && ['__proto__', 'prototype', 'constructor'].includes(segment)) throw new Error('Invalid private content path')
        if (!Object.hasOwn(owner, segment) || !owner[segment] || typeof owner[segment] !== 'object') throw new Error('Invalid private content path')
        owner = owner[segment] as Record<string | number, unknown>
      }
      const key = reference.path.at(-1)
      if (key === undefined || !Object.hasOwn(owner, key) || owner[key] !== '') throw new Error('Invalid private content slot')
      Object.defineProperty(owner, key, { value: text, enumerable: true, writable: true, configurable: true })
    }
    return document as T
  }
}
