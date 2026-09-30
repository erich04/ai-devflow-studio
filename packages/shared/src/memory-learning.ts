/**
 * Deterministic Memory learning helpers (ADR 0024).
 *
 * - `deriveCodingRunMemoryStatements` turns observable facts of a completed, test-passing
 *   Coding Run into fixed-template candidate statements. It never calls a model and never
 *   invents facts; the output is only a candidate until a human or a bounded policy
 *   promotes it.
 * - `findDuplicateMemory` decides whether a statement repeats an active memory (reject and
 *   point at it) or is close enough that revising the existing memory through its
 *   `supersedes` chain is preferable to creating a new one.
 */
import { redactSensitiveText } from './redaction'
import {
  AGENT_MEMORY_RECALLABLE_STATEMENT_MAX_BYTES,
  memoryStatementBytes,
  tokenizeMemoryText,
} from './memory-relevance'
import type { TestFailureLocation } from './test-failure-locations'

/** Token Jaccard similarity at or above which a revision is suggested instead of a new memory. */
export const MEMORY_SIMILARITY_REVISION_THRESHOLD = 0.8

export function normalizeMemoryStatement(statement: string): string {
  return statement
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[\s.。!！?？;；,，:：]+$/u, '')
}

export function memoryStatementSimilarity(left: string, right: string): number {
  if (normalizeMemoryStatement(left) === normalizeMemoryStatement(right)) return 1
  const leftTokens = new Set(tokenizeMemoryText(left))
  const rightTokens = new Set(tokenizeMemoryText(right))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  let shared = 0
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1
  return shared / (leftTokens.size + rightTokens.size - shared)
}

export type MemoryDuplicateMatch<T> = {
  /** `exact`: same statement after normalization. `similar`: at or above the threshold. */
  kind: 'exact' | 'similar'
  item: T
  similarity: number
}

export function findDuplicateMemory<T>(
  statement: string,
  existing: readonly T[],
  statementOf: (item: T) => string,
  threshold: number = MEMORY_SIMILARITY_REVISION_THRESHOLD,
): MemoryDuplicateMatch<T> | null {
  const normalized = normalizeMemoryStatement(statement)
  let best: MemoryDuplicateMatch<T> | null = null
  for (const item of existing) {
    const other = statementOf(item)
    if (normalizeMemoryStatement(other) === normalized) return { kind: 'exact', item, similarity: 1 }
    const similarity = memoryStatementSimilarity(statement, other)
    if (similarity >= threshold && (best === null || similarity > best.similarity)) {
      best = { kind: 'similar', item, similarity }
    }
  }
  return best
}

export type CodingRunMemoryStatementKind = 'test_command' | 'change_map' | 'repair_pattern'

export type CodingRunMemoryStatement = {
  kind: CodingRunMemoryStatementKind
  statement: string
}

export type CodingRunMemoryFacts = {
  runTitle: string
  nodeTitle: string
  /** The saved canonical test command that produced the passing evidence. */
  testCommand: string
  /** Latest canonical test evidence passed. Nothing is learned otherwise. */
  testPassed: boolean
  changedPaths: readonly string[]
  /** Present only when a first test failure was fixed by an accepted repair. */
  repair?: {
    failureSummary: string
    failureLocations: readonly TestFailureLocation[]
    repairedPaths: readonly string[]
  }
}

const MAX_TITLE_CHARS = 120
const MAX_COMMAND_CHARS = 300
const MAX_SUMMARY_CHARS = 200
const MAX_LISTED_PATHS = 12
const MAX_LISTED_LOCATIONS = 3

function inlineText(value: string, maxChars: number): string {
  const collapsed = value.replace(/\s+/gu, ' ').replace(/"/gu, "'").trim()
  return collapsed.length > maxChars ? `${collapsed.slice(0, maxChars - 1).trimEnd()}…` : collapsed
}

function isSafeRelativePath(value: string): boolean {
  return value.length > 0 && value.length <= 500 && !value.startsWith('/') &&
    !value.includes('\\') && !value.includes('//') &&
    value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function pathList(paths: readonly string[]): string {
  const safe = [...new Set(paths.filter(isSafeRelativePath))]
  const listed = safe.slice(0, MAX_LISTED_PATHS).join(', ')
  return safe.length > MAX_LISTED_PATHS ? `${listed} and ${safe.length - MAX_LISTED_PATHS} more` : listed
}

function finalize(kind: CodingRunMemoryStatementKind, statement: string): CodingRunMemoryStatement | null {
  const trimmed = statement.trim()
  if (
    !trimmed ||
    memoryStatementBytes(trimmed) > AGENT_MEMORY_RECALLABLE_STATEMENT_MAX_BYTES ||
    // Candidates must already be redaction-stable (same rule as existing candidates).
    redactSensitiveText(trimmed).value !== trimmed
  ) return null
  return { kind, statement: trimmed }
}

/**
 * Bounded policy that saves Coding Run facts without review (ADR 0024 §5). Only the
 * project's own saved test command qualifies: it is configured by the user, and the
 * statement carries no task title or model-chosen text. The local store re-checks all of it.
 */
export const CODING_RUN_MEMORY_POLICY_ID = 'desktop-coding-run-memory-policy'
export const CODING_RUN_MEMORY_POLICY_VERSION = 1
export const CODING_RUN_MEMORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
export const CODING_RUN_MEMORY_POLICY_KINDS: readonly CodingRunMemoryStatementKind[] = ['test_command']

/** Title-free, so every later task derives the same statement and finds it as a duplicate. */
export function codingRunTestCommandStatement(testCommand: string): string | null {
  const command = inlineText(testCommand, MAX_COMMAND_CHARS + 1)
  return command && command.length <= MAX_COMMAND_CHARS ? `Verified test command for this project: ${command}.` : null
}

export function deriveCodingRunMemoryStatements(facts: CodingRunMemoryFacts): CodingRunMemoryStatement[] {
  if (!facts.testPassed) return []
  const runTitle = inlineText(facts.runTitle, MAX_TITLE_CHARS)
  const nodeTitle = inlineText(facts.nodeTitle, MAX_TITLE_CHARS)
  const statements: Array<CodingRunMemoryStatement | null> = []

  const testCommand = codingRunTestCommandStatement(facts.testCommand)
  if (testCommand) statements.push(finalize('test_command', testCommand))

  const changed = pathList(facts.changedPaths)
  if (changed) {
    statements.push(finalize(
      'change_map',
      `Change map: "${runTitle}"${nodeTitle ? ` (${nodeTitle})` : ''} was implemented by changing ${changed}.`,
    ))
  }

  if (facts.repair) {
    const repaired = pathList(facts.repair.repairedPaths)
    if (repaired) {
      const summary = inlineText(facts.repair.failureSummary, MAX_SUMMARY_CHARS)
      const locations = facts.repair.failureLocations
        .filter((location) => isSafeRelativePath(location.path))
        .slice(0, MAX_LISTED_LOCATIONS)
        .map((location) => `${location.path}:${location.line}`)
        .join(', ')
      statements.push(finalize(
        'repair_pattern',
        `Repair pattern: in "${runTitle}", the first attempt failed the saved test${summary ? ` (${summary})` : ''}${locations ? `, first reported at ${locations}` : ''}; the accepted repair changed ${repaired}.`,
      ))
    }
  }
  return statements.filter((entry): entry is CodingRunMemoryStatement => entry !== null)
}
