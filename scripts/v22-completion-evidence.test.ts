import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createV22EvaluationRecord, V22_SCENARIO_TESTS } from './v22-multi-agent-evaluator'
import {
  evaluateV22CompletionSignoff,
  parseV22RequiredGates,
  V22_COMPLETION_EVIDENCE_PATHS,
  V22_COMPLETION_SIGNOFF_FILES,
} from './v22-completion-evidence'

const candidateSha = '1'.repeat(40)
const signoffSha = '2'.repeat(40)
const contractSha256 = '3'.repeat(64)
const datasetBytes = readFileSync('scripts/fixtures/v2.2-multi-agent-evaluation.json')
const evaluationRecord = createV22EvaluationRecord({
  datasetBytes,
  candidateSha,
  contractSha256,
  recordedAt: '2026-08-13T23:00:00.000Z',
  scenarioExecutions: V22_SCENARIO_TESTS.map((scenario) => ({
    scenarioId: scenario.scenarioId,
    passed: true,
    durationMs: 1,
  })),
})

function requiredGates() {
  return {
    schemaVersion: 1,
    targetMilestone: 'v2.2',
    candidateSha,
    status: 'passed',
    recordedAt: '2026-08-13T23:30:00.000Z',
    localMatrix: {
      candidateSha,
      verify: 'passed',
      evaluator: 'passed',
      postgres: 'passed',
      docker: 'passed',
      packagedDesktop: 'passed',
      singleAgentRegression: 'passed',
      worktreeCleanAfter: true,
    },
    verifyRun: {
      workflow: 'Verify',
      event: 'workflow_dispatch',
      runId: 31_800_000_001,
      runAttempt: 1,
      url: 'https://github.com/erich04/ai-devflow-studio/actions/runs/31800000001',
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
      path: V22_COMPLETION_EVIDENCE_PATHS.evaluation,
      datasetId: evaluationRecord.datasetId,
      datasetVersion: evaluationRecord.datasetVersion,
      datasetSha256: evaluationRecord.datasetSha256,
      contractSha256: evaluationRecord.contractSha256,
      coordinationContractVersion: evaluationRecord.coordinationContractVersion,
      executionTenancyContractVersion: evaluationRecord.executionTenancyContractVersion,
      scenarioCount: evaluationRecord.scenarioResults.length,
      aggregateSingleQuality: evaluationRecord.candidate.aggregateSingleQuality,
      aggregateMultiQuality: evaluationRecord.candidate.aggregateMultiQuality,
      aggregateImprovementOverSingle:
        evaluationRecord.candidate.aggregateImprovementOverSingle,
      costMultiplierOverSingle: evaluationRecord.candidate.costMultiplierOverSingle,
      latencyMultiplierOverSingle: evaluationRecord.candidate.latencyMultiplierOverSingle,
      additionalHumanInterventions:
        evaluationRecord.candidate.additionalHumanInterventions,
      isolationViolations: evaluationRecord.candidate.isolationViolations,
      authorityViolations: evaluationRecord.candidate.authorityViolations,
      terminationViolations: evaluationRecord.candidate.terminationViolations,
      replayViolations: evaluationRecord.candidate.replayViolations,
      redactionViolations: evaluationRecord.candidate.redactionViolations,
      paidProviderCalls: evaluationRecord.paidProviderCalls,
      scans: evaluationRecord.scans,
      status: evaluationRecord.status,
    },
    roadmapClosure: {
      versionLine: '2.x',
      status: 'completed',
      automaticNextMilestone: false,
    },
  }
}

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateV22CompletionSignoff({
    datasetBytes,
    evaluationRecord,
    requiredGates: requiredGates(),
    signoffSha,
    candidateSha,
    signoffParentSha: candidateSha,
    changedFiles: [...V22_COMPLETION_SIGNOFF_FILES],
    evidenceImmutable: true,
    worktreeClean: true,
    ...overrides,
  })
}

describe('V2.2 and finite 2.x completion evidence', () => {
  it('starts through the exact tsx runtime without requiring unpublished evidence', () => {
    const result = spawnSync(process.execPath, [
      resolve('node_modules/tsx/dist/cli.mjs'),
      'scripts/v22-completion-evidence.ts',
    ], { encoding: 'utf8', windowsHide: true })
    const evidenceExists = V22_COMPLETION_SIGNOFF_FILES.every((path) => existsSync(path))

    if (evidenceExists) {
      expect([0, 1]).toContain(result.status)
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: expect.stringMatching(/^(passed|failed)$/u),
        candidateSha: expect.stringMatching(/^[a-f0-9]{40}$/u),
        signoffSha: expect.stringMatching(/^[a-f0-9]{40}$/u),
      })
    } else {
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('v22_completion_evidence_unavailable')
    }
    expect(result.stderr).not.toContain('Top-level await is currently not supported')
  })

  it('accepts one exact direct-child signoff that closes the finite 2.x line', () => {
    expect(evaluate()).toEqual({ ready: true, failures: [] })
  })

  it('requires an immutable clean direct child with the exact signoff file set', () => {
    expect(evaluate({ changedFiles: V22_COMPLETION_SIGNOFF_FILES.slice(1) }).failures)
      .toContain('signoff_file_set')
    expect(evaluate({ signoffParentSha: '4'.repeat(40) }).failures)
      .toContain('not_direct_child')
    expect(evaluate({ evidenceImmutable: false }).failures)
      .toContain('evidence_history_mismatch')
    expect(evaluate({ worktreeClean: false }).failures).toContain('worktree_dirty')
  })

  it('rejects replayed CI, incomplete local gates, and a tampered evaluation summary', () => {
    const replayed = requiredGates()
    replayed.verifyRun.runAttempt = 2
    expect(() => parseV22RequiredGates(replayed)).toThrow('v22_required_gates_invalid')

    const incomplete = requiredGates()
    incomplete.localMatrix.singleAgentRegression = 'failed'
    expect(() => parseV22RequiredGates(incomplete)).toThrow('v22_required_gates_invalid')

    const tampered = requiredGates()
    tampered.evaluation.aggregateMultiQuality = 0
    expect(evaluate({ requiredGates: tampered }).failures).toContain('evaluation_summary')
  })

  it('rejects unknown fields and any automatic next milestone', () => {
    expect(() => parseV22RequiredGates({ ...requiredGates(), extra: true }))
      .toThrow('v22_required_gates_invalid')
    const automatic = requiredGates()
    automatic.roadmapClosure.automaticNextMilestone = true
    expect(() => parseV22RequiredGates(automatic)).toThrow('v22_required_gates_invalid')
  })
})
