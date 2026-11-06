import type { ChangeSetDiffView } from './coding-change-view'
import { redactSensitiveText } from './redaction'

export type ChangeReviewFinding = {
  index: number; path: string; line: number; lineText: string
  importance?: 'important' | 'suggestion'
  consequence: string; reason: string; item: string; becomes?: string
  anchor?: { path: string; side: 'old' | 'new'; line: number }
}
export type CodingChangeReview = {
  id: string; stateVersion: 1; codingRunId: string; runId: string; nodeId: string; projectId: string
  changeSetId: string; changeSetDigest: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'; trigger: 'automatic' | 'manual'
  providerId: string; model: string; startedAt: string; completedAt?: string
  findings: ChangeReviewFinding[]; levelsKnown: boolean; failure?: { code: string }; redacted: true
}
export function redactChangeReviewText(text: string): string {
  return redactSensitiveText(text).value.replace(/(?:\/(?:Users|home)\/[^\s'"`<>]+|[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\r\n'"`<>]+)/gu, '[local path]')
}

export function buildChangeReviewPayload(input: { brief: unknown; view: ChangeSetDiffView }) {
  const payload = {
    stateVersion: 2 as const, brief: input.brief, phase: 'change_review' as const,
    changeSet: { files: input.view.files.map(file => ({ path: file.path, rows: file.rows.flatMap(row =>
      row.kind === 'add' || row.kind === 'del' ? [{ kind: row.kind === 'add' ? '+' as const : '-' as const, line: row.kind === 'add' ? row.newLine : row.oldLine, text: redactChangeReviewText(row.text) }] : []), truncated: false })) },
    limits: { maxFindings: 6, lineTextMaxChars: 500 },
  }
  while (JSON.stringify(payload).length > 30_000) {
    const largest = [...payload.changeSet.files].filter(f => f.rows.length).sort((a, b) => JSON.stringify(b.rows).length - JSON.stringify(a.rows).length)[0]
    if (!largest) throw new Error('Change review brief exceeds the payload limit')
    largest.rows.splice(Math.max(0, largest.rows.length - Math.max(1, Math.ceil(largest.rows.length / 10))))
    largest.truncated = true
  }
  return payload
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function invalid(): never { throw new Error('invalid_model_output') }
function bounded(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > maximum || value.includes('\0')) return invalid()
  return redactChangeReviewText(value)
}
export function groundChangeFinding(view: ChangeSetDiffView, finding: Pick<ChangeReviewFinding, 'path' | 'lineText'>): ChangeReviewFinding['anchor'] {
  const rows = view.files.find(f => f.path === finding.path)?.rows.filter(row => (row.kind === 'add' || row.kind === 'del') && row.text.trimEnd() === finding.lineText.trimEnd()) ?? []
  if (rows.length !== 1) return undefined
  const row = rows[0]!
  return row.kind === 'add' ? { path: finding.path, side: 'new', line: row.newLine } : row.kind === 'del' ? { path: finding.path, side: 'old', line: row.oldLine } : undefined
}
export function parseChangeReviewOutput(value: unknown, view: ChangeSetDiffView): { findings: ChangeReviewFinding[]; levelsKnown: boolean; summary?: string } {
  if (!record(value) || value.stateVersion !== 2 || Object.keys(value).some(k => !['stateVersion', 'findings', 'summary'].includes(k)) || !Array.isArray(value.findings) || value.findings.length > 6) return invalid()
  const summary = value.summary === undefined ? undefined : bounded(value.summary, 1000, true)
  const findings = value.findings.map((entry: unknown, index): ChangeReviewFinding => {
    if (!record(entry) || Object.keys(entry).some(k => !['path', 'line', 'lineText', 'importance', 'consequence', 'reason', 'item', 'becomes'].includes(k)) || typeof entry.path !== 'string' || !view.files.some(f => f.path === entry.path) || !Number.isSafeInteger(entry.line) || Number(entry.line) < 1 || Number(entry.line) > 1_000_000 || (entry.importance !== undefined && entry.importance !== 'important' && entry.importance !== 'suggestion')) return invalid()
    const lineText = bounded(entry.lineText, 500)
    if (/[\r\n]/u.test(lineText)) return invalid()
    const finding: ChangeReviewFinding = { index, path: entry.path, line: Number(entry.line), lineText,
      consequence: bounded(entry.consequence, 200), reason: bounded(entry.reason, 300), item: bounded(entry.item, 300),
      ...(entry.importance ? { importance: entry.importance as 'important' | 'suggestion' } : {}),
      ...(entry.becomes === undefined ? {} : { becomes: bounded(entry.becomes, 500, true) }),
    }
    const anchor = groundChangeFinding(view, finding)
    return { ...finding, ...(anchor ? { anchor } : {}) }
  })
  return { findings, levelsKnown: findings.every(f => f.importance !== undefined), ...(summary === undefined ? {} : { summary }) }
}
export function splitBacktickSegments(text: string): Array<{ text: string; raw?: true }> {
  const parts = text.split('`')
  if (parts.length % 2 === 0) return [{ text }]
  return parts.flatMap((part, index) => part ? [{ text: part, ...(index % 2 ? { raw: true as const } : {}) }] : [])
}
