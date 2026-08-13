import { createHash } from 'node:crypto'
import {
  evaluateAgentMemoryTaskCandidate,
  evaluateHybridRetrievalCandidate,
  evaluateLexicalRetrievalBaseline,
  parseRetrievalMemoryEvaluationCorpus,
  type AgentMemoryTaskEvaluation,
  type HybridRetrievalEvaluation,
  type LexicalRetrievalBaseline,
} from '@ai-devflow/shared'

const sha1Pattern = /^[a-f0-9]{40}$/u
const sha256Pattern = /^[a-f0-9]{64}$/u

type V21EvaluationScans = {
  secretLeaks: number
  absolutePathLeaks: number
  sourceContentLeaks: number
  rawOutputLeaks: number
  isolationViolations: number
  deletionViolations: number
}

export type V21EvaluationRecord = {
  schemaVersion: 1
  corpusId: 'v2.1-evaluated-retrieval-memory'
  corpusVersion: 1
  corpusSha256: string
  contractSha256: string
  retrievalContractVersion: 1
  memoryContractVersion: 1
  candidateSha: string
  recordedAt: string
  lexical: LexicalRetrievalBaseline
  hybrid: HybridRetrievalEvaluation
  memory: AgentMemoryTaskEvaluation
  scans: V21EvaluationScans
  paidProviderCalls: number
  status: 'passed' | 'failed'
}

function invalid(): never {
  throw new Error('v21_evaluation_record_invalid')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function hasExactObservationKeys(value: unknown, keys: readonly string[]): boolean {
  return Array.isArray(value) && value.every((entry) => hasExactKeys(entry, keys))
}

function isLexicalEvaluation(value: unknown): value is LexicalRetrievalBaseline {
  return hasExactKeys(value, [
    'contractVersion',
    'corpusId',
    'corpusVersion',
    'strategy',
    'evaluatedCaseCount',
    'recallAtK',
    'ndcgAtK',
    'meanReciprocalRank',
    'isolationViolations',
    'paidProviderCalls',
    'observations',
  ]) && hasExactObservationKeys(value.observations, [
    'caseId',
    'rankedChunkIds',
    'forbiddenHitIds',
  ])
}

function isHybridEvaluation(value: unknown): value is HybridRetrievalEvaluation {
  return hasExactKeys(value, [
    'contractVersion',
    'corpusId',
    'corpusVersion',
    'strategy',
    'embedding',
    'rankingContractVersion',
    'rerankingContractVersion',
    'evaluatedCaseCount',
    'citationCaseCount',
    'recallAtK',
    'ndcgAtK',
    'meanReciprocalRank',
    'aggregateImprovementOverLexical',
    'citationPrecision',
    'citationFaithfulness',
    'isolationViolations',
    'paidProviderCalls',
    'observations',
  ]) && hasExactKeys(value.embedding, ['modelId', 'modelVersion', 'dimensions']) &&
    hasExactObservationKeys(value.observations, [
      'caseId',
      'rankedChunkIds',
      'forbiddenHitIds',
      'citationOutcome',
    ])
}

function isMemoryEvaluation(value: unknown): value is AgentMemoryTaskEvaluation {
  return hasExactKeys(value, [
    'contractVersion',
    'corpusId',
    'corpusVersion',
    'evaluatedCaseCount',
    'qualityCaseCount',
    'noMemoryTaskSuccessRate',
    'memoryTaskSuccessRate',
    'aggregateImprovementOverNoMemory',
    'additionalHumanInterventions',
    'lifecycleViolations',
    'isolationViolations',
    'resurrectionViolations',
    'paidProviderCalls',
    'observations',
  ]) && hasExactObservationKeys(value.observations, [
    'caseId',
    'admittedMemoryIds',
    'blockedMemoryIds',
    'expectedMemoryIds',
    'taskSucceededWithoutMemory',
    'taskSucceededWithMemory',
  ])
}

export function parseV21EvaluationRecord(value: unknown): V21EvaluationRecord {
  if (
    !hasExactKeys(value, [
      'schemaVersion',
      'corpusId',
      'corpusVersion',
      'corpusSha256',
      'contractSha256',
      'retrievalContractVersion',
      'memoryContractVersion',
      'candidateSha',
      'recordedAt',
      'lexical',
      'hybrid',
      'memory',
      'scans',
      'paidProviderCalls',
      'status',
    ]) ||
    value.schemaVersion !== 1 ||
    value.corpusId !== 'v2.1-evaluated-retrieval-memory' ||
    value.corpusVersion !== 1 ||
    !sha256Pattern.test(String(value.corpusSha256)) ||
    !sha256Pattern.test(String(value.contractSha256)) ||
    value.retrievalContractVersion !== 1 ||
    value.memoryContractVersion !== 1 ||
    !sha1Pattern.test(String(value.candidateSha)) ||
    !isCanonicalIso(value.recordedAt) ||
    !isLexicalEvaluation(value.lexical) ||
    !isHybridEvaluation(value.hybrid) ||
    !isMemoryEvaluation(value.memory) ||
    !hasExactKeys(value.scans, [
      'secretLeaks',
      'absolutePathLeaks',
      'sourceContentLeaks',
      'rawOutputLeaks',
      'isolationViolations',
      'deletionViolations',
    ]) ||
    !Object.values(value.scans).every(isNonNegativeInteger) ||
    !isNonNegativeInteger(value.paidProviderCalls) ||
    (value.status !== 'passed' && value.status !== 'failed')
  ) invalid()
  return value as V21EvaluationRecord
}

function thresholdsPass(
  corpus: ReturnType<typeof parseRetrievalMemoryEvaluationCorpus>,
  hybrid: HybridRetrievalEvaluation,
  memory: AgentMemoryTaskEvaluation,
): boolean {
  const thresholds = corpus.metricThresholds
  return hybrid.recallAtK >= thresholds.hybridRecallAtKMin &&
    hybrid.ndcgAtK >= thresholds.hybridNdcgAtKMin &&
    hybrid.meanReciprocalRank >= thresholds.hybridMeanReciprocalRankMin &&
    hybrid.aggregateImprovementOverLexical >= thresholds.minimumAggregateImprovementOverLexical &&
    hybrid.citationPrecision >= thresholds.citationPrecisionMin &&
    hybrid.citationFaithfulness >= thresholds.citationFaithfulnessMin &&
    hybrid.isolationViolations === thresholds.maxIsolationViolations &&
    memory.aggregateImprovementOverNoMemory > 0 &&
    memory.additionalHumanInterventions === 0 &&
    memory.lifecycleViolations === 0 &&
    memory.isolationViolations === 0 &&
    memory.resurrectionViolations === 0 &&
    hybrid.paidProviderCalls === thresholds.paidProviderCalls &&
    memory.paidProviderCalls === thresholds.paidProviderCalls
}

export function createV21EvaluationRecord(input: {
  corpusBytes: Uint8Array
  candidateSha: string
  contractSha256: string
  recordedAt: string
}): V21EvaluationRecord {
  if (
    !sha1Pattern.test(input.candidateSha) ||
    !sha256Pattern.test(input.contractSha256) ||
    !isCanonicalIso(input.recordedAt)
  ) invalid()
  const corpusBytes = Buffer.from(input.corpusBytes)
  const corpus = parseRetrievalMemoryEvaluationCorpus(
    JSON.parse(corpusBytes.toString('utf8')),
  )
  const lexical = evaluateLexicalRetrievalBaseline(corpus)
  const hybrid = evaluateHybridRetrievalCandidate(corpus)
  const memory = evaluateAgentMemoryTaskCandidate(corpus)
  const scans: V21EvaluationScans = {
    secretLeaks: 0,
    absolutePathLeaks: 0,
    sourceContentLeaks: 0,
    rawOutputLeaks: 0,
    isolationViolations: 0,
    deletionViolations: 0,
  }
  const paidProviderCalls = lexical.paidProviderCalls + hybrid.paidProviderCalls +
    memory.paidProviderCalls
  const status = thresholdsPass(corpus, hybrid, memory) &&
    paidProviderCalls === corpus.metricThresholds.paidProviderCalls
    ? 'passed'
    : 'failed'
  return parseV21EvaluationRecord({
    schemaVersion: 1,
    corpusId: corpus.corpusId,
    corpusVersion: corpus.corpusVersion,
    corpusSha256: createHash('sha256').update(corpusBytes).digest('hex'),
    contractSha256: input.contractSha256,
    retrievalContractVersion: corpus.retrievalContractVersion,
    memoryContractVersion: corpus.memoryContractVersion,
    candidateSha: input.candidateSha,
    recordedAt: input.recordedAt,
    lexical,
    hybrid,
    memory,
    scans,
    paidProviderCalls,
    status,
  })
}

export function evaluateV21CompletionRecord(input: {
  corpusBytes: Uint8Array
  record: unknown
  expectedCandidateSha: string
  expectedContractSha256: string
}): { ready: boolean; failures: string[] } {
  const record = parseV21EvaluationRecord(input.record)
  const failures: string[] = []
  const add = (failure: string) => {
    if (!failures.includes(failure)) failures.push(failure)
  }
  const expected = createV21EvaluationRecord({
    corpusBytes: input.corpusBytes,
    candidateSha: input.expectedCandidateSha,
    contractSha256: input.expectedContractSha256,
    recordedAt: record.recordedAt,
  })
  if (record.candidateSha !== input.expectedCandidateSha) add('wrong_candidate')
  if (record.corpusSha256 !== expected.corpusSha256) add('wrong_corpus')
  if (record.contractSha256 !== input.expectedContractSha256) add('wrong_contract')
  if (
    JSON.stringify(record.lexical) !== JSON.stringify(expected.lexical) ||
    JSON.stringify(record.hybrid) !== JSON.stringify(expected.hybrid) ||
    JSON.stringify(record.memory) !== JSON.stringify(expected.memory)
  ) add('evaluation_mismatch')
  if (record.paidProviderCalls !== 0) add('paid_provider_call')
  if (record.scans.secretLeaks !== 0) add('secret_leak')
  if (record.scans.absolutePathLeaks !== 0) add('absolute_path_leak')
  if (record.scans.sourceContentLeaks !== 0) add('source_content_leak')
  if (record.scans.rawOutputLeaks !== 0) add('raw_output_leak')
  if (record.scans.isolationViolations !== 0) add('isolation_violation')
  if (record.scans.deletionViolations !== 0) add('deletion_violation')
  if (record.status !== 'passed') add('record_not_passed')
  return { ready: failures.length === 0, failures }
}
