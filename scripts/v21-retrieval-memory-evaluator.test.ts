import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createV21EvaluationRecord,
  evaluateV21CompletionRecord,
  parseV21EvaluationRecord,
} from './v21-retrieval-memory-evaluator'

const corpusBytes = readFileSync('scripts/fixtures/v2.1-retrieval-memory-evaluation.json')
const corpusSha256 = createHash('sha256').update(corpusBytes).digest('hex')
const candidateSha = '1'.repeat(40)
const contractSha256 = '2'.repeat(64)

function passingRecord() {
  return createV21EvaluationRecord({
    corpusBytes,
    candidateSha,
    contractSha256,
    recordedAt: '2026-08-13T14:00:00.000Z',
  })
}

describe('V2.1 Retrieval and Memory evaluator', () => {
  it('binds one strict passing record to the exact candidate, corpus, and contract', () => {
    const record = passingRecord()

    expect(record).toMatchObject({
      schemaVersion: 1,
      corpusId: 'v2.1-evaluated-retrieval-memory',
      corpusVersion: 1,
      corpusSha256,
      contractSha256,
      retrievalContractVersion: 1,
      memoryContractVersion: 1,
      candidateSha,
      lexical: {
        recallAtK: 0.5,
        ndcgAtK: 0.5,
        meanReciprocalRank: 0.5,
      },
      hybrid: {
        recallAtK: 1,
        ndcgAtK: 1,
        meanReciprocalRank: 1,
        aggregateImprovementOverLexical: 0.5,
        citationPrecision: 1,
        citationFaithfulness: 1,
      },
      memory: {
        noMemoryTaskSuccessRate: 0,
        memoryTaskSuccessRate: 1,
        aggregateImprovementOverNoMemory: 1,
        lifecycleViolations: 0,
        isolationViolations: 0,
        resurrectionViolations: 0,
      },
      scans: {
        secretLeaks: 0,
        absolutePathLeaks: 0,
        sourceContentLeaks: 0,
        rawOutputLeaks: 0,
        isolationViolations: 0,
        deletionViolations: 0,
      },
      paidProviderCalls: 0,
      status: 'passed',
    })
    expect(parseV21EvaluationRecord(record)).toEqual(record)
    expect(evaluateV21CompletionRecord({
      corpusBytes,
      record,
      expectedCandidateSha: candidateSha,
      expectedContractSha256: contractSha256,
    })).toEqual({ ready: true, failures: [] })
  })

  it('fails closed on candidate, corpus, contract, metric, provider, and leak tampering', () => {
    const record = passingRecord()
    expect(evaluateV21CompletionRecord({
      corpusBytes,
      record: { ...record, candidateSha: '3'.repeat(40) },
      expectedCandidateSha: candidateSha,
      expectedContractSha256: contractSha256,
    }).failures).toContain('wrong_candidate')
    expect(evaluateV21CompletionRecord({
      corpusBytes,
      record: { ...record, corpusSha256: '3'.repeat(64) },
      expectedCandidateSha: candidateSha,
      expectedContractSha256: contractSha256,
    }).failures).toContain('wrong_corpus')
    expect(evaluateV21CompletionRecord({
      corpusBytes,
      record: { ...record, contractSha256: '3'.repeat(64) },
      expectedCandidateSha: candidateSha,
      expectedContractSha256: contractSha256,
    }).failures).toContain('wrong_contract')
    expect(evaluateV21CompletionRecord({
      corpusBytes,
      record: {
        ...record,
        hybrid: { ...record.hybrid, citationFaithfulness: 0 },
      },
      expectedCandidateSha: candidateSha,
      expectedContractSha256: contractSha256,
    }).failures).toContain('evaluation_mismatch')
    expect(evaluateV21CompletionRecord({
      corpusBytes,
      record: { ...record, paidProviderCalls: 1 },
      expectedCandidateSha: candidateSha,
      expectedContractSha256: contractSha256,
    }).failures).toContain('paid_provider_call')
    expect(evaluateV21CompletionRecord({
      corpusBytes,
      record: {
        ...record,
        scans: { ...record.scans, deletionViolations: 1 },
      },
      expectedCandidateSha: candidateSha,
      expectedContractSha256: contractSha256,
    }).failures).toContain('deletion_violation')
  })

  it('rejects unknown evidence fields at the top level and nested scan boundary', () => {
    const record = passingRecord()
    expect(() => parseV21EvaluationRecord({ ...record, extra: true })).toThrow(
      'v21_evaluation_record_invalid',
    )
    expect(() => parseV21EvaluationRecord({
      ...record,
      scans: { ...record.scans, extra: 0 },
    })).toThrow('v21_evaluation_record_invalid')
  })
})
