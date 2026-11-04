import { redactSensitiveText } from '@ai-devflow/shared'
import { codingDigest, type CodingCandidateWorkspace } from './coding-candidate-workspace'
import { privateAcceptancePath } from './native-coding-acceptance-context'

type Diagnostic = { id: string; kind: string; messageDigest?: string; frames?: Array<{ file: string; line: number }> }
const kinds = new Set([
  'AssertionError',
  'SyntaxError',
  'TypeError',
  'ReferenceError',
  'TestSetupError',
  'MatchedControlFailed',
  'MismatchedInput',
])

/** Pre-implementation only. A stack can suggest a location, but only a literal
 * error in immutable B with the same digest can be shown to the private author. */
export async function privatePreflightDiagnostics(items: unknown, ids: string[], baseline?: CodingCandidateWorkspace) {
  const notes = []
  const files = new Map<string, string[]>()
  let bytesLeft = 4 * 1024 * 1024
  const candidates = baseline?.identity.base.files ?? []
  for (const item of (Array.isArray(items) ? items : []).slice(0, 24) as Diagnostic[]) {
    if (!item || !ids.includes(item.id) || !kinds.has(item.kind)) continue
    let guard: { location: string; reason: string; condition?: string } | undefined
    if (item.kind === 'TestSetupError' && baseline && Array.isArray(item.frames) && typeof item.messageDigest === 'string') {
      for (const frame of item.frames.slice(0, 6)) {
        if (
          !frame ||
          typeof frame.file !== 'string' ||
          !Number.isSafeInteger(frame.line) ||
          frame.line < 1 ||
          privateAcceptancePath.test(frame.file)
        )
          continue
        const source = candidates.find((file) => file.path === frame.file)
        if (
          !source ||
          !/\.[cm]?[jt]sx?$/u.test(source.path) ||
          /\.(test|spec)\.[^.]+$/u.test(source.path) ||
          source.size > 1024 * 1024
        )
          continue
        if (!files.has(source.hash)) {
          if (source.size > bytesLeft) continue
          bytesLeft -= source.size
          const bytes = await baseline.blob(source.hash)
          if (codingDigest(bytes) !== source.hash) continue
          files.set(source.hash, bytes.toString('utf8').split('\n'))
        }
        const line = files.get(source.hash)?.[frame.line - 1]?.trim()
        if (!line || line.length > 600) continue
        const literal = /\bthrow new (?:Error|RangeError|TypeError)\((['"])([\p{L}\p{N} .,:_-]{2,120})\1\)/u.exec(line)
        if (
          !literal ||
          codingDigest(literal[2]!) !== item.messageDigest ||
          redactSensitiveText(literal[2]!).value !== literal[2]
        )
          continue
        const condition = /^if\s*\((.{1,320})\)\s*\{?\s*throw new /u.exec(line)?.[1]
        guard = {
          location: `${source.path}:${frame.line}`,
          reason: literal[2]!,
          ...(condition && /^[\w\s.!<>=&|?:+()\[\]-]+$/u.test(condition) ? { condition } : {}),
        }
        break
      }
    }
    const note = { id: item.id, kind: item.kind, ...(guard ? { baselineGuard: guard } : {}) }
    if (JSON.stringify([...notes, note]).length > 4000) break
    notes.push(note)
  }
  return JSON.stringify(notes)
}
