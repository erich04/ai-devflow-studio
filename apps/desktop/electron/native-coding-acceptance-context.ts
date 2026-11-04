import path from 'node:path'
import ts from 'typescript'
import { rankMemoryByRelevance, redactSensitiveText } from '@ai-devflow/shared'
import type { CodingFileEntry } from './coding-candidate-workspace'

type Entry = Pick<CodingFileEntry, 'path' | 'hash' | 'size'>
type Evidence = { path: string; content: string; truncated: boolean }
export const privateAcceptancePath =
  /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.ssh|\.aws|credentials|\.npmrc)(?:\/|$)|\.(?:pem|key|p12|pfx)$/iu
const documentPath = /^(?:CONTEXT(?:\.[\w-]+)?\.md|README(?:\.[\w-]+)?\.md|docs\/(?:adr|plans)\/.+\.md)$/iu
const maxDocumentBytes = 2 * 1024 * 1024

/** Resolve only public test-data imports on the immutable manifest. A fixture's
 * default scenario may differ from the mode named in the approved request. */
export async function fixtureInputExamples(
  manifest: readonly Entry[],
  read: (hash: string) => Promise<Buffer>,
  objective: string,
  tests: Array<{ path: string; source: string }>,
) {
  const terms = new Map<string, string>()
  for (const match of objective.matchAll(/\b[A-Za-z][\w-]{1,39}\b/gu)) terms.set(match[0].toLowerCase(), match[0])
  const result: Array<{
    path: string
    term: string
    field: string
    value: string
    observedValues: string[]
    excerpt: string
  }> = []
  if (!terms.size) return result
  const paths = new Map(manifest.filter((f) => !privateAcceptancePath.test(f.path)).map((f) => [f.path, f]))
  const modules = new Set<string>(),
    packageImports = new Set<string>()
  for (const test of tests) {
    for (const { fileName } of ts.preProcessFile(test.source).importedFiles) {
      if (!/(?:fixture|test-data|test-utils|mock-data)/iu.test(fileName)) continue
      if (fileName.startsWith('.')) modules.add(path.posix.join(path.posix.dirname(test.path), fileName))
      else packageImports.add(fileName)
    }
  }
  if (packageImports.size) {
    for (const file of manifest
      .filter((f) => /(?:^|\/)package\.json$/u.test(f.path) && f.size <= 32768 && paths.has(f.path))
      .slice(0, 48)) {
      let pkg
      try {
        pkg = JSON.parse((await read(file.hash)).toString('utf8'))
      } catch {
        continue
      }
      if (typeof pkg?.name !== 'string') continue
      for (const specifier of packageImports) {
        if (!specifier.startsWith(pkg.name + '/')) continue
        const target = pkg.exports?.['.' + specifier.slice(pkg.name.length)]
        if (typeof target === 'string' && target.startsWith('./') && !target.split('/').includes('..'))
          modules.add(path.posix.join(path.posix.dirname(file.path), target))
      }
    }
  }
  for (const module of [...modules].slice(0, 8)) {
    const file = [module, module + '.ts', module + '.tsx', module + '.js', module + '/index.ts']
      .map((name) => paths.get(name))
      .find((f) => f && f.size <= 256 * 1024)
    if (!file) continue
    const source = redactSensitiveText((await read(file.hash)).toString('utf8')).value
    const lines = source.split('\n')
    const tree = ts.createSourceFile(file.path, source, ts.ScriptTarget.Latest, false)
    const valuesByField = new Map<string, Set<string>>()
    const matches: Array<{ field: string; value: string; term: string; line: number }> = []
    function visit(node: ts.Node) {
      if (
        ts.isPropertyAssignment(node) &&
        (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
        ts.isStringLiteralLike(node.initializer) &&
        /^(kind|stage|mode|type|status|state)$/u.test(node.name.text)
      ) {
        const field = node.name.text,
          value = node.initializer.text
        if (/^[\w-]{1,100}$/u.test(value)) {
          const values = valuesByField.get(field) ?? new Set<string>()
          values.add(value)
          valuesByField.set(field, values)
          const term = terms.get(value.toLowerCase())
          if (term && matches.length < 12 && !matches.some((m) => m.field === field && m.value === value)) {
            matches.push({ field, value, term, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
    for (const { field, value, term, line } of matches) {
      result.push({
        path: file.path,
        term,
        field,
        value,
        observedValues: [...valuesByField.get(field)!].slice(0, 64),
        excerpt: lines
          .slice(Math.max(0, line - 4), line + 9)
          .join('\n')
          .slice(0, 1000),
      })
      if (result.length >= 12) return result
    }
  }
  return result
}

function excerpt(text: string, limit: number): string {
  if (text.length <= limit) return text
  const marker = '\n[... omitted ...]\n'
  if (limit < marker.length + 2) return text.slice(0, limit)
  const head = Math.ceil((limit - marker.length) * 0.6)
  return text.slice(0, head) + marker + text.slice(-(limit - marker.length - head))
}

export function focusFixtureEvidence(file: Evidence | undefined, query: string, limit: number): Evidence | undefined {
  if (!file || file.content.length <= limit) return file
  const chunks: Array<{ index: number; text: string }> = []
  let lines: string[] = [],
    size = 0
  for (const line of file.content.split('\n')) {
    if (size + line.length > 1000 && lines.length) {
      chunks.push({ index: chunks.length, text: lines.join('\n') })
      lines = []
      size = 0
    }
    lines.push(line)
    size += line.length + 1
  }
  if (lines.length) chunks.push({ index: chunks.length, text: lines.join('\n') })
  const ranked = rankMemoryByRelevance(chunks, query, (c) => c.text, { minMatchedTerms: 1 })
  if (!ranked.length) return { ...file, content: excerpt(file.content, limit), truncated: true }
  const marker = '\n[... omitted ...]\n'
  const picked = new Map<number, string>()
  let remaining = limit
  for (const chunk of [ranked[0]!.item, chunks[0]!, chunks[chunks.length - 1]!, ...ranked.map((r) => r.item)]) {
    if (!picked.has(chunk.index) && remaining > marker.length + 80) {
      const text = excerpt(chunk.text, Math.min(remaining - marker.length, 1100))
      picked.set(chunk.index, text)
      remaining -= text.length + marker.length
    }
  }
  return {
    ...file,
    content: [...picked]
      .sort((a, b) => a[0] - b[0])
      .map(([, text]) => text)
      .join(marker),
    truncated: true,
  }
}

/** Use only immutable B blobs. Repository conventions help interpret approved terms,
 * while the approved objective remains the source of acceptance requirements. */
export async function acceptanceContext(
  manifest: readonly Entry[],
  blob: (hash: string) => Promise<Buffer>,
  objective: string,
  targets: string[],
  budget = 384000,
) {
  const available = new Map(
    manifest.filter((file) => !privateAcceptancePath.test(file.path)).map((file) => [file.path, file]),
  )
  const focused = [...new Set(targets.flatMap((file) => [file.replace(/\.(?:test|spec)(\.[^.]+)$/u, '$1'), file]))].filter(
    (file) => available.has(file),
  )
  const query = [objective, ...focused.map((file) => path.posix.basename(file))].join('\n')
  const candidates = [...available.values()].filter((file) => documentPath.test(file.path) && file.size <= 256 * 1024)
  const byPath = rankMemoryByRelevance(candidates, query, (file) => file.path).map((result) => result.item)
  const priority = candidates.filter((file) => !file.path.includes('/') || file.path.startsWith('docs/adr/'))
  const sections: Evidence[] = []
  let remainingBytes = maxDocumentBytes
  for (const file of [...new Set([...priority, ...byPath, ...candidates])].slice(0, 128)) {
    if (file.size > remainingBytes) continue
    remainingBytes -= file.size
    const bytes = await blob(file.hash)
    if (bytes.includes(0)) continue
    const text = redactSensitiveText(bytes.toString('utf8')).value
    const parts = text.split(/(?=^#{1,6}\s)/mu)
    for (const part of parts) {
      if (!part.trim()) continue
      const content = part.trim().slice(0, 4500)
      sections.push({ path: file.path, content, truncated: content.length < part.trim().length })
    }
  }
  const contracts: Evidence[] = []
  let documentRoom = Math.min(14000, Math.floor(budget / 4))
  for (const { item } of rankMemoryByRelevance(sections, objective, (section) => section.content, { minMatchedTerms: 2 })) {
    if (contracts.length === 8 || documentRoom < 140) break
    if (contracts.filter((section) => section.path === item.path).length >= 2) continue
    const content = excerpt(item.content, Math.min(2400, documentRoom))
    contracts.push({ ...item, content, truncated: item.truncated || content.length < item.content.length })
    documentRoom -= content.length
  }
  const metadata = new Set([
    'package.json',
    'pnpm-workspace.yaml',
    'vitest.config.ts',
    'tsconfig.json',
    'tsconfig.base.json',
  ])
  for (const file of focused) {
    let parent = path.posix.dirname(file)
    while (parent !== '.') {
      metadata.add(`${parent}/package.json`)
      parent = path.posix.dirname(parent)
    }
  }
  const files: Evidence[] = []
  let room = budget - contracts.reduce((size, item) => size + item.content.length, 0)
  // Assign every named target an equal first opportunity, redistributing space
  // left by small files before excerpting large UI suites and implementation files.
  const entries = [...new Set([...metadata, ...focused])].flatMap((name) => available.get(name) ?? [])
  const lengths = new Map<string, number>()
  const texts = new Map<string, string>()
  let inputRoom = 8 * 1024 * 1024
  for (const entry of entries.slice(0, 128)) {
    if (entry.size > 1024 * 1024 || entry.size > inputRoom) continue
    inputRoom -= entry.size
    const bytes = await blob(entry.hash)
    if (bytes.includes(0)) continue
    const value = redactSensitiveText(bytes.toString('utf8')).value
    texts.set(entry.path, value)
    lengths.set(entry.path, Math.min(value.length, metadata.has(entry.path) ? 16000 : 96000))
  }
  const smallest = [...lengths].sort((a, b) => a[1] - b[1])
  for (const [i, [name, length]] of smallest.entries()) {
    const allowance = Math.min(length, Math.floor(room / (smallest.length - i)))
    lengths.set(name, allowance)
    room -= allowance
  }
  for (const [name, value] of texts) {
    const content = excerpt(value, lengths.get(name)!)
    files.push({ path: name, content, truncated: content.length < value.length })
  }
  return { files, contracts }
}
