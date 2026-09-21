import { createHash } from 'node:crypto'
import path from 'node:path'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { redactSensitiveText } from '@ai-devflow/shared'

const excluded = /^(?:\.git|\.devflow|\.ssh|\.aws|\.env(?:\..*)?|node_modules|dist(?:-.*)?|out|coverage|\.pnpm-store|\.npmrc|\.netrc|credentials(?:\..*)?|id_rsa|id_ed25519)$|\.(?:pem|key|p12|pfx|sqlite|db)$/i
const textExtension = /\.(?:[cm]?[jt]sx?|json|md|mdx|txt|ya?ml|toml|html|css|scss|py|rs|go|java|sql|sh|vue|svelte|xml|ini)$/i
function relativeInput(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500 || value.includes('\0') || value.includes('\\') || path.isAbsolute(value) || /^[a-z]:/i.test(value)) throw new Error('只允许读取项目内的相对路径。')
  if (value.split('/').some((part) => part === '..' || excluded.test(part))) throw new Error('该路径不在会话可读取的范围内。')
  return value || '.'
}

// Do not execute shell, load plugins, or follow symlinks from a model request.
export async function readWorkbenchRepository(rootPath: string, input: {
  operation: 'list' | 'read' | 'search'; path?: string; query?: string
}, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted()
  const root = await realpath(rootPath)
  async function safeFile(relative: string): Promise<string> {
    const parts = relativeInput(relative).split('/').filter((part) => part && part !== '.')
    let current = root
    for (const part of parts) {
      current = path.join(current, part)
      if ((await lstat(current)).isSymbolicLink()) throw new Error('会话不会读取符号链接。')
    }
    const actual = await realpath(current)
    const within = path.relative(root, actual)
    if (within === '..' || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) throw new Error('路径超出了当前项目。')
    return actual
  }
  async function read(relative: string) {
    signal.throwIfAborted()
    const absolute = await safeFile(relative)
    const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > 256 * 1024 || stat.nlink > 1) throw new Error('仅支持读取 256 KB 内的普通文本文件。')
      const data = Buffer.alloc(Math.min(stat.size, 32 * 1024))
      const { bytesRead } = await handle.read(data, 0, data.length, 0)
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, bytesRead), { stream: stat.size > bytesRead })
      if (text.includes('\0')) throw new Error('该文件不是文本文件。')
      signal.throwIfAborted()
      const after = await lstat(await safeFile(relative))
      if (after.ino !== stat.ino || after.dev !== stat.dev || after.mtimeMs !== stat.mtimeMs || after.size !== stat.size) throw new Error('文件在读取时发生了变化，请重新读取。')
      return { path: relative, contentHash: createHash('sha256').update(data.subarray(0, bytesRead)).digest('hex'), modifiedAt: stat.mtime.toISOString(), content: redactSensitiveText(text).value, truncated: stat.size > bytesRead }
    } finally { await handle.close() }
  }
  const relative = relativeInput(input.path ?? '.')
  if (input.operation === 'read') return read(relative)
  if (input.operation === 'list') {
    const entries = (await readdir(await safeFile(relative), { withFileTypes: true }))
      .filter((entry) => !entry.isSymbolicLink() && !excluded.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { path: relative, entries: entries.slice(0, 160).map((entry) => ({ path: path.posix.join(relative, entry.name), kind: entry.isDirectory() ? 'directory' : 'file' })), truncated: entries.length > 160 }
  }
  const query = input.query?.trim()
  if (!query || query.length > 200) throw new Error('请提供 1–200 字的搜索文本。')
  const queue = [{ relative, depth: 0 }]
  const matches: Array<{ path: string; line: number; excerpt: string }> = []
  let files = 0
  let bytes = 0
  let entriesSeen = 0
  const started = Date.now()
  while (queue.length && files < 400 && bytes < 2 * 1024 * 1024 && matches.length < 40 && entriesSeen < 2000 && Date.now() - started < 5000) {
    signal.throwIfAborted()
    const dir = queue.shift()!
    const entries = (await readdir(await safeFile(dir.relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      signal.throwIfAborted()
      entriesSeen++
      if (entriesSeen >= 2000 || files >= 400 || bytes >= 2 * 1024 * 1024 || matches.length >= 40 || Date.now() - started >= 5000) break
      if (entry.isSymbolicLink() || excluded.test(entry.name)) continue
      const name = path.posix.join(dir.relative, entry.name)
      if (entry.isDirectory() && dir.depth < 6) queue.push({ relative: name, depth: dir.depth + 1 })
      else if (entry.isFile() && textExtension.test(entry.name)) {
        files++
        try {
          const file = await read(name)
          bytes += file.content.length
          file.content.split('\n').forEach((line, index) => {
            if (matches.length < 40 && line.toLocaleLowerCase().includes(query.toLocaleLowerCase())) matches.push({ path: name, line: index + 1, excerpt: line.slice(0, 400) })
          })
        } catch { signal.throwIfAborted() /* unreadable/binary/oversize files are skipped */ }
      }
    }
  }
  return { matches, scannedFiles: files, boundedSearch: true, note: '搜索有目录深度、文件数、时间和大小限制；没有命中不代表整个项目不存在该内容。' }
}
