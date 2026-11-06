import { Worker } from 'node:worker_threads'
import path from 'node:path'
import ts from 'typescript'
import type { CodingCandidateWorkspace } from './coding-candidate-workspace'

/** Regex runs off the Electron main thread with a hard deadline, including pathological expressions. */
export async function codingMatchingLines(text: string, query: string, regex: boolean, signal: AbortSignal): Promise<number[]> {
  if (!regex) return text.split('\n').flatMap((line, index) => line.includes(query) ? [index] : [])
  const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
    try { const re=new RegExp(workerData.query,'u'); parentPort.postMessage({lines:workerData.text.split('\\n').flatMap((line,i)=>re.test(line)?[i]:[])}); }
    catch(error){parentPort.postMessage({error:String(error.message)})}`, { eval: true, workerData: { text, query } })
  let timer: ReturnType<typeof setTimeout> | undefined
  const abort = () => { void worker.terminate() }
  try {
    signal.throwIfAborted(); signal.addEventListener('abort', abort, { once: true })
    return await new Promise<number[]>((resolve, reject) => {
      timer = setTimeout(() => { void worker.terminate(); reject(new Error('Regex exceeded one second; narrow the expression or use literal search')) }, 1000)
      worker.once('error', reject)
      worker.once('exit', code => { if (code !== 0 || signal.aborted) reject(new Error('Regex search interrupted')) })
      worker.once('message', (result: { error?: string; lines: number[] }) => result.error ? reject(new Error(result.error)) : resolve(result.lines))
    })
  } finally { if (timer) clearTimeout(timer); signal.removeEventListener('abort', abort); await worker.terminate() }
}

/** A TypeScript/JavaScript semantic index over a content-bound, authorized source snapshot. */
export async function queryCodingSymbols(workspace: CodingCandidateWorkspace, readable: (path: string) => void, name: string, input: Record<string, unknown>) {
  const manifest = await workspace.inspect(), files = new Map<string, { content: string; hash: string }>()
  let size = 0
  for (const entry of manifest.files.filter(file => /\.[cm]?[jt]sx?$/iu.test(file.path))) {
    try { readable(entry.path) } catch { continue }
    if ((size += entry.size) > 32 * 1024 * 1024) return { available: false, reason: 'Semantic index exceeds 32 MiB; use paged text search', revision: manifest.digest }
    files.set(entry.path, { content: (await workspace.read(entry.path)).bytes.toString('utf8'), hash: entry.hash })
  }
  if (!files.size) return { available: false, reason: 'Only TypeScript/JavaScript language service is configured; use text search for other languages', revision: manifest.digest }
  const normalize = (file: string) => path.posix.relative('/candidate', path.posix.resolve('/candidate', file))
  const service = ts.createLanguageService({
    getCompilationSettings: () => ({ allowJs: true, checkJs: true, noLib: true, target: ts.ScriptTarget.ESNext, moduleResolution: ts.ModuleResolutionKind.Node10 }),
    getScriptFileNames: () => [...files.keys()].map(file => `/candidate/${file}`),
    getScriptVersion: file => files.get(normalize(file))?.hash ?? 'absent',
    getScriptSnapshot: file => { const source = files.get(normalize(file)); return source ? ts.ScriptSnapshot.fromString(source.content) : undefined },
    getCurrentDirectory: () => '/candidate', getDefaultLibFileName: () => '/unavailable/lib.d.ts',
    fileExists: file => files.has(normalize(file)), readFile: file => files.get(normalize(file))?.content,
    readDirectory: () => [...files.keys()].map(file => `/candidate/${file}`),
  })
  try {
    const location = (file: string, span: ts.TextSpan) => {
      const relative = normalize(file), source = files.get(relative)
      if (!source) return null
      const head = source.content.slice(0, span.start).split('\n')
      return { path: relative, line: head.length, column: head.at(-1)!.length + 1, length: span.length, hash: source.hash }
    }
    let entries: unknown[]
    if (name === 'find_symbol') entries = service.getNavigateToItems(String(input.query), undefined, undefined, true).map(item => ({ name: item.name, kind: item.kind, ...location(item.fileName, item.textSpan) }))
    else {
      const relative = String(input.path); readable(relative)
      const source = files.get(relative)
      if (!source || source.hash !== input.expectedHash) throw new Error('Read the current source before requesting references')
      const lines = source.content.split('\n'), line = Number(input.line), column = Number(input.column)
      if (line < 1 || line > lines.length || column < 1 || column > lines[line - 1]!.length + 1) throw new Error('Invalid symbol position')
      const position = lines.slice(0, line - 1).reduce((sum, part) => sum + part.length + 1, 0) + column - 1
      entries = service.getReferencesAtPosition(`/candidate/${relative}`, position)?.flatMap(item => { const place = location(item.fileName, item.textSpan); return place ? [{ ...place, isWriteAccess: item.isWriteAccess }] : [] }) ?? []
    }
    const offset = Number(input.offset ?? 0), limit = Math.max(1, Math.min(100, Number(input.limit ?? 50)))
    if ((await workspace.inspect()).digest !== manifest.digest) throw new Error('Sources changed during language query')
    return { available: true, languageService: `typescript-${ts.version}`, revision: manifest.digest, entries: entries.slice(offset, offset + limit), nextOffset: offset + limit < entries.length ? offset + limit : null }
  } finally { service.dispose() }
}
