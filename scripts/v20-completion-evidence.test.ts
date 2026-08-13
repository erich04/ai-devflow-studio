import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  evaluateV20CompletionSignoff,
  parseV20RequiredGates,
  v20CompletionSignoffFiles,
} from './v20-completion-evidence.mjs'

const candidateSha = '1'.repeat(40)
const signoffSha = '2'.repeat(40)
const datasetBytes = readFileSync('scripts/fixtures/v2.0-agent-runtime-scenarios.json')
const dataset = JSON.parse(datasetBytes.toString('utf8')) as {
  datasetId: string
  datasetVersion: number
  runtimeContractVersion: number
  codingExecutorContractVersion: number
  nativeToolContractVersion: number
  scenarios: Array<{
    scenario: {
      id: string
      version: number
      expected: {
        stopReason: string
        maxSteps: number
        requiredEventTypes: string[]
        evidenceKinds: string[]
        cleanupStatus: string
      }
    }
  }>
}
const datasetSha256 = createHash('sha256').update(datasetBytes).digest('hex')
const recordedAt = '2026-08-13T06:15:00.000Z'

function evaluationRecord() {
  return {
    schemaVersion: 1,
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    datasetSha256,
    runtimeContractVersion: dataset.runtimeContractVersion,
    codingExecutorContractVersion: dataset.codingExecutorContractVersion,
    nativeToolContractVersion: dataset.nativeToolContractVersion,
    candidateSha,
    recordedAt: '2026-08-13T06:05:58.978Z',
    scenarioResults: dataset.scenarios.map(({ scenario }, index) => ({
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      status: 'passed',
      observation: {
        stopReason: scenario.expected.stopReason,
        steps: scenario.expected.maxSteps,
        eventTypes: scenario.expected.requiredEventTypes,
        evidenceKinds: scenario.expected.evidenceKinds,
        cleanupStatus: scenario.expected.cleanupStatus,
        metrics: {
          qualityPassed: true,
          costUsd: 0,
          latencyMs: index + 1,
          humanInterventions: 0,
          recoverySucceeded: true,
          isolationViolations: 0,
        },
      },
    })),
    executorParity: [{
      groupId: 'governed-coding-repair',
      nativeScenarioId: 'native-coding-repair',
      opencodeScenarioId: 'opencode-coding-contract',
      eventContract: true,
      cancellation: true,
      evidence: true,
      terminalResult: true,
      cleanup: true,
    }],
    scans: {
      secretLeaks: 0,
      absolutePathLeaks: 0,
      sourceLeaks: 0,
      rawOutputLeaks: 0,
      isolationViolations: 0,
    },
    paidProviderCalls: 0,
    status: 'passed',
  }
}

function requiredGates() {
  return {
    schemaVersion: 1,
    targetMilestone: 'v2.0',
    candidateSha,
    status: 'passed',
    recordedAt,
    localMatrix: {
      candidateSha,
      verify: 'passed',
      evaluator: 'passed',
      worktreeCleanAfter: true,
    },
    verifyRun: {
      workflow: 'Verify',
      event: 'workflow_dispatch',
      runId: 31_672_644_978,
      runAttempt: 1,
      url: 'https://github.com/erich04/ai-devflow-studio/actions/runs/31672644978',
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
      archiveSha256: '3'.repeat(64),
      archiveSizeBytes: 107_068_016,
      signed: false,
      installer: false,
    },
    evaluation: {
      path: 'docs/releases/v2.0.0/agent-runtime-evaluation.json',
      datasetId: dataset.datasetId,
      datasetVersion: dataset.datasetVersion,
      datasetSha256,
      scenarioCount: dataset.scenarios.length,
      passedScenarioCount: dataset.scenarios.length,
      totalLatencyMs: 120,
      totalCostUsd: 0,
      totalHumanInterventions: 0,
      paidProviderCalls: 0,
      scans: {
        secretLeaks: 0,
        absolutePathLeaks: 0,
        sourceLeaks: 0,
        rawOutputLeaks: 0,
        isolationViolations: 0,
      },
      status: 'passed',
    },
  }
}

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateV20CompletionSignoff({
    datasetBytes,
    evaluationRecord: evaluationRecord(),
    requiredGates: requiredGates(),
    signoffSha,
    candidateSha,
    signoffParentSha: candidateSha,
    changedFiles: [...v20CompletionSignoffFiles],
    worktreeClean: true,
    ...overrides,
  })
}

describe('V2.0 completion evidence', () => {
  it('accepts one exact direct-child signoff bound to the evaluator, CI, and artifact', () => {
    expect(evaluate()).toEqual({ ready: true, failures: [] })
  })

  it('requires the exact evidence and living-document file set', () => {
    expect(evaluate({ changedFiles: v20CompletionSignoffFiles.slice(1) })).toEqual({
      ready: false,
      failures: ['signoff_file_set'],
    })
    expect(evaluate({ changedFiles: [...v20CompletionSignoffFiles, 'unexpected.txt'] })).toEqual({
      ready: false,
      failures: ['signoff_file_set'],
    })
  })

  it('requires a clean direct child whose candidate identity matches every layer', () => {
    expect(evaluate({ signoffParentSha: '4'.repeat(40) }).failures).toContain('not_direct_child')
    expect(evaluate({ worktreeClean: false }).failures).toContain('worktree_dirty')

    const gates = requiredGates()
    gates.verifyRun.headSha = '4'.repeat(40)
    expect(evaluate({ requiredGates: gates }).failures).toContain('candidate_mismatch')
  })

  it('rejects incomplete or replayed CI and tampered artifact/evaluation summaries', () => {
    const replayed = requiredGates()
    replayed.verifyRun.runAttempt = 2
    expect(() => parseV20RequiredGates(replayed)).toThrowError('v20_required_gates_invalid')

    const missingJob = requiredGates()
    delete (missingJob.verifyRun.jobs as Record<string, string>)['Windows compatibility']
    expect(() => parseV20RequiredGates(missingJob)).toThrowError('v20_required_gates_invalid')

    const artifact = requiredGates()
    artifact.desktopArtifact.archiveSha256 = 'not-a-digest'
    expect(() => parseV20RequiredGates(artifact)).toThrowError('v20_required_gates_invalid')

    const summary = requiredGates()
    summary.evaluation.passedScenarioCount -= 1
    expect(evaluate({ requiredGates: summary }).failures).toContain('evaluation_summary')
  })

  it('rejects unknown fields at every strict evidence boundary', () => {
    expect(() => parseV20RequiredGates({ ...requiredGates(), extra: true })).toThrowError(
      'v20_required_gates_invalid',
    )
    expect(() => parseV20RequiredGates({
      ...requiredGates(),
      localMatrix: { ...requiredGates().localMatrix, extra: true },
    })).toThrowError('v20_required_gates_invalid')
  })
})
