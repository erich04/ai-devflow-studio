import type { HindsightTodoPhase, HindsightTodoQuestion } from './hindsight-todo-fixture'

export type HindsightTodoRetrievalMode = 'local-lexical' | 'hindsight-hybrid'
export interface HindsightTodoRetrievalObservation {
  questionId: string
  matches: { path: string; digest?: string }[]
  elapsedMs: number
  degraded?: boolean
  error?: string
}

const ratio = (count: number, total: number) => total === 0 ? null : count / total
const percentile = (sorted: number[], fraction: number) =>
  sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1]! : null

/**
 * Score observed rankings, never generate rankings or model answers. Supplying observations
 * is the runner's responsibility; a synthetic service and a live provider are different evidence.
 */
export function scoreHindsightTodoRetrieval(input: {
  mode: HindsightTodoRetrievalMode
  questions: readonly HindsightTodoQuestion[]
  observations: readonly HindsightTodoRetrievalObservation[]
  /** Current, authorized source digests captured by the runner at each phase. Omit means not checked. */
  allowedSourcesByPhase?: Partial<Record<HindsightTodoPhase, Readonly<Record<string, string>>>>
}) {
  const questionIds = new Set<string>()
  for (const question of input.questions) {
    if (questionIds.has(question.id)) throw new Error(`Duplicate question: ${question.id}`)
    questionIds.add(question.id)
  }
  const byId = new Map<string, HindsightTodoRetrievalObservation>()
  for (const observation of input.observations) {
    if (!questionIds.has(observation.questionId)) throw new Error(`Unknown question: ${observation.questionId}`)
    if (byId.has(observation.questionId)) throw new Error(`Duplicate observation: ${observation.questionId}`)
    if (!Number.isFinite(observation.elapsedMs) || observation.elapsedMs < 0) {
      throw new Error(`Invalid elapsed time: ${observation.questionId}`)
    }
    byId.set(observation.questionId, observation)
  }
  const rows = input.questions.map((question) => {
    const observation = byId.get(question.id)
    const successful = observation !== undefined && !observation.error
    const paths: string[] = []
    const duplicatePaths: string[] = []
    const invalidSources: { path: string; reason: 'unauthorized-source' | 'digest-mismatch' }[] = []
    const allowed = input.allowedSourcesByPhase?.[question.phase]
    for (const match of observation?.matches ?? []) {
      if (paths.includes(match.path)) duplicatePaths.push(match.path)
      else {
        paths.push(match.path)
        if (allowed !== undefined) {
          if (!Object.hasOwn(allowed, match.path)) invalidSources.push({ path: match.path, reason: 'unauthorized-source' })
          else if (allowed[match.path] !== match.digest) invalidSources.push({ path: match.path, reason: 'digest-mismatch' })
        }
      }
    }
    const expected = new Set(question.expectedPaths)
    const invalid = new Set(invalidSources.map((source) => source.path))
    const validExpected = (source: string) => expected.has(source) && !invalid.has(source)
    const topFive = paths.slice(0, 5)
    const missingExpectedPaths = [...expected].filter((source) => !successful || invalid.has(source) || !topFive.includes(source))
    return {
      id: question.id, kind: question.kind, phase: question.phase,
      observed: observation !== undefined, successful,
      error: observation?.error ?? null, degraded: observation?.degraded ?? null,
      paths, duplicatePaths,
      currentnessChecked: allowed !== undefined, invalidSources,
      top1: expected.size ? successful && validExpected(paths[0] ?? '') : null,
      top5: expected.size ? successful && topFive.some(validExpected) : null,
      correctAbstention: expected.size === 0 && successful && paths.length === 0,
      noAnswerFalsePositive: expected.size === 0 && paths.length > 0,
      missingExpectedPaths,
      requiredSourceCount: expected.size,
      matchedSourceCount: expected.size - missingExpectedPaths.length,
      elapsedMs: observation?.elapsedMs ?? null,
    }
  })
  const answerable = rows.filter((row) => row.requiredSourceCount > 0)
  const noAnswer = rows.filter((row) => row.requiredSourceCount === 0)
  const missingQuestionIds = rows.filter((row) => !row.observed).map((row) => row.id)
  const failedQuestionIds = rows.filter((row) => row.error).map((row) => row.id)
  const latencies = rows.flatMap((row) => row.elapsedMs === null ? [] : [row.elapsedMs]).sort((a, b) => a - b)
  return {
    mode: input.mode,
    complete: rows.length > 0 && missingQuestionIds.length === 0 && failedQuestionIds.length === 0,
    missingQuestionIds,
    failedQuestionIds,
    answerQualityEvaluated: false as const,
    baselines: {
      lexical: { status: input.mode === 'local-lexical' ? 'observations-scored' : 'not-evaluated' },
      hybrid: { status: input.mode === 'hindsight-hybrid' ? 'observations-scored' : 'not-evaluated' },
      investigation: { status: 'not-evaluated' as const,
        reason: 'list/read + repo_search requires a separately executed tool investigation and answer evaluation.' },
    },
    metrics: {
      top1Rate: ratio(answerable.filter((row) => row.top1).length, answerable.length),
      top5HitRate: ratio(answerable.filter((row) => row.top5).length, answerable.length),
      allRequiredTop5Rate: ratio(answerable.filter((row) => !row.missingExpectedPaths.length).length, answerable.length),
      sourceRecallAt5: ratio(rows.reduce((sum, row) => sum + row.matchedSourceCount, 0),
        rows.reduce((sum, row) => sum + row.requiredSourceCount, 0)),
      noAnswerCorrectRate: ratio(noAnswer.filter((row) => row.correctAbstention).length, noAnswer.length),
      noAnswerFalsePositiveRate: ratio(noAnswer.filter((row) => row.noAnswerFalsePositive).length, noAnswer.length),
      noAnswerUnresolved: noAnswer.filter((row) => !row.successful).length,
      invalidSourceCount: rows.reduce((sum, row) => sum + row.invalidSources.length, 0),
      latencyP50Ms: percentile(latencies, 0.5),
      latencyP95Ms: percentile(latencies, 0.95),
    },
    rows,
  }
}
