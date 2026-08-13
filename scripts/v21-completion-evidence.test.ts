import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createV21EvaluationRecord } from './v21-retrieval-memory-evaluator'
import {
  evaluateV21CompletionSignoff,
  parseV21RequiredGates,
  V21_COMPLETION_SIGNOFF_FILES,
  V21_COMPLETION_EVIDENCE_PATHS,
} from './v21-completion-evidence'

const candidateSha = '1'.repeat(40)
const signoffSha = '2'.repeat(40)
const contractSha256 = '3'.repeat(64)
const corpusBytes = readFileSync('scripts/fixtures/v2.1-retrieval-memory-evaluation.json')
const evaluationRecord = createV21EvaluationRecord({
  corpusBytes,
  candidateSha,
  contractSha256,
  recordedAt: '2026-08-13T15:00:00.000Z',
})

function requiredGates() {
  return {
    schemaVersion: 1,
    targetMilestone: 'v2.1',
    candidateSha,
    status: 'passed',
    recordedAt: '2026-08-13T15:30:00.000Z',
    localMatrix: {
      candidateSha,
      verify: 'passed',
      evaluator: 'passed',
      postgres: 'passed',
      docker: 'passed',
      packagedDesktop: 'passed',
      worktreeCleanAfter: true,
    },
    verifyRun: {
      workflow: 'Verify',
      event: 'workflow_dispatch',
      runId: 31_700_000_001,
      runAttempt: 1,
      url: 'https://github.com/erich04/ai-devflow-studio/actions/runs/31700000001',
      headSha: candidateSha,
      conclusion: 'success',
      jobs: {
        'Docker smoke': 'success',
        'Postgres integration': 'success',
        'Windows compatibility': 'success',
        'Docker lifecycle smoke': 'success',
        'macOS verify': 'success',
      },
    },
    desktopArtifact: {
      name: 'ai-devflow-studio-v15-candidate-desktop',
      productVersion: '1.5.0',
      platform: 'darwin',
      arch: 'arm64',
      electronVersion: '33.4.11',
      archiveSha256: '4'.repeat(64),
      archiveSizeBytes: 107_000_000,
      signed: false,
      installer: false,
    },
    evaluation: {
      path: V21_COMPLETION_EVIDENCE_PATHS.evaluation,
      corpusId: evaluationRecord.corpusId,
      corpusVersion: evaluationRecord.corpusVersion,
      corpusSha256: evaluationRecord.corpusSha256,
      contractSha256: evaluationRecord.contractSha256,
      retrievalContractVersion: evaluationRecord.retrievalContractVersion,
      memoryContractVersion: evaluationRecord.memoryContractVersion,
      lexicalRecallAtK: evaluationRecord.lexical.recallAtK,
      hybridRecallAtK: evaluationRecord.hybrid.recallAtK,
      hybridNdcgAtK: evaluationRecord.hybrid.ndcgAtK,
      hybridMeanReciprocalRank: evaluationRecord.hybrid.meanReciprocalRank,
      aggregateImprovementOverLexical:
        evaluationRecord.hybrid.aggregateImprovementOverLexical,
      citationPrecision: evaluationRecord.hybrid.citationPrecision,
      citationFaithfulness: evaluationRecord.hybrid.citationFaithfulness,
      noMemoryTaskSuccessRate: evaluationRecord.memory.noMemoryTaskSuccessRate,
      memoryTaskSuccessRate: evaluationRecord.memory.memoryTaskSuccessRate,
      aggregateImprovementOverNoMemory:
        evaluationRecord.memory.aggregateImprovementOverNoMemory,
      additionalHumanInterventions: evaluationRecord.memory.additionalHumanInterventions,
      paidProviderCalls: evaluationRecord.paidProviderCalls,
      scans: evaluationRecord.scans,
      status: evaluationRecord.status,
    },
  }
}

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateV21CompletionSignoff({
    corpusBytes,
    evaluationRecord,
    requiredGates: requiredGates(),
    signoffSha,
    candidateSha,
    signoffParentSha: candidateSha,
    changedFiles: [...V21_COMPLETION_SIGNOFF_FILES],
    evidenceImmutable: true,
    worktreeClean: true,
    ...overrides,
  })
}

describe('V2.1 completion evidence', () => {
  it('starts through the exact tsx CommonJS package runtime', () => {
    const result = spawnSync(process.execPath, [
      resolve('node_modules/tsx/dist/cli.mjs'),
      'scripts/v21-completion-evidence.ts',
    ], {
      encoding: 'utf8',
      windowsHide: true,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('v21_completion_evidence_unavailable')
    expect(result.stderr).not.toContain('Top-level await is currently not supported')
  })

  it('accepts one exact direct-child signoff bound to evaluator, CI, and artifact', () => {
    expect(evaluate()).toEqual({ ready: true, failures: [] })
  })

  it('requires the exact signoff file set and clean direct-child identity', () => {
    expect(evaluate({ changedFiles: V21_COMPLETION_SIGNOFF_FILES.slice(1) }).failures)
      .toContain('signoff_file_set')
    expect(evaluate({
      changedFiles: [...V21_COMPLETION_SIGNOFF_FILES, 'unexpected.txt'],
    }).failures).toContain('signoff_file_set')
    expect(evaluate({ signoffParentSha: '4'.repeat(40) }).failures).toContain('not_direct_child')
    expect(evaluate({ evidenceImmutable: false }).failures)
      .toContain('evidence_history_mismatch')
    expect(evaluate({ worktreeClean: false }).failures).toContain('worktree_dirty')
  })

  it('rejects replayed or incomplete CI and a tampered evaluator summary', () => {
    const replayed = requiredGates()
    replayed.verifyRun.runAttempt = 2
    expect(() => parseV21RequiredGates(replayed)).toThrow('v21_required_gates_invalid')

    const missingJob = requiredGates()
    delete (missingJob.verifyRun.jobs as Record<string, string>)['Windows compatibility']
    expect(() => parseV21RequiredGates(missingJob)).toThrow('v21_required_gates_invalid')

    const tampered = requiredGates()
    tampered.evaluation.memoryTaskSuccessRate = 0
    expect(evaluate({ requiredGates: tampered }).failures).toContain('evaluation_summary')
  })

  it('rejects unknown fields at every required-gate boundary', () => {
    expect(() => parseV21RequiredGates({ ...requiredGates(), extra: true })).toThrow(
      'v21_required_gates_invalid',
    )
    expect(() => parseV21RequiredGates({
      ...requiredGates(),
      localMatrix: { ...requiredGates().localMatrix, extra: true },
    })).toThrow('v21_required_gates_invalid')
  })
})
