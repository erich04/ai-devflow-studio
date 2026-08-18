import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { evaluateV20CompletionRecord } from './v20-agent-runtime-evaluator.mjs'
import {
  collectV20EvaluationRecord,
  createProviderIsolatedEnvironment,
  parseV20EvaluationRunnerArguments,
  runV20EvaluationCli,
  runVitestScenario,
  validateCandidateWorkspace,
} from './v20-agent-runtime-evaluation-runner.mjs'

const datasetBytes = readFileSync('scripts/fixtures/v2.0-agent-runtime-scenarios.json')
const candidateSha = '1234567890abcdef1234567890abcdef12345678'

describe('V2.0 Agent Runtime evaluation runner', () => {
  it('executes every frozen scenario and emits one candidate-bound safe completion record', async () => {
    const runScenario = vi.fn(async () => ({
      passed: true,
      durationMs: 17,
      stdout: '/Users/private/source should never enter the record',
      stderr: 'token=secret should never enter the record',
    }))

    const result = await collectV20EvaluationRecord({
      datasetBytes,
      candidateSha,
      recordedAt: '2026-08-13T06:00:00.000Z',
      runScenario,
    })

    expect(runScenario).toHaveBeenCalledTimes(result.dataset.scenarios.length)
    expect(runScenario).toHaveBeenNthCalledWith(1, {
      scenarioId: 'native-tool-no-side-effect',
      testFile: 'apps/desktop/electron/agent-runtime-runtime.test.ts',
      testName: 'derives authority in Electron main and completes one durable native Tool runtime',
    })
    expect(result.record).toMatchObject({
      candidateSha,
      datasetSha256: createHash('sha256').update(datasetBytes).digest('hex'),
      paidProviderCalls: 0,
      scans: {
        secretLeaks: 0,
        absolutePathLeaks: 0,
        sourceLeaks: 0,
        rawOutputLeaks: 0,
        isolationViolations: 0,
      },
      status: 'passed',
    })
    expect(JSON.stringify(result.record)).not.toContain('/Users/private')
    expect(JSON.stringify(result.record)).not.toContain('token=secret')
    expect(evaluateV20CompletionRecord({
      dataset: result.dataset,
      record: result.record,
      expectedCandidateSha: candidateSha,
      expectedDatasetSha256: result.record.datasetSha256,
    })).toEqual({ ready: true, failures: [] })
  })

  it('records a safe failed scenario without copying process output or claiming parity', async () => {
    const result = await collectV20EvaluationRecord({
      datasetBytes,
      candidateSha,
      recordedAt: '2026-08-13T06:00:00.000Z',
      runScenario: async ({ scenarioId }) => ({
        passed: scenarioId !== 'native-coding-repair',
        durationMs: 19,
        stdout: 'raw source output',
        stderr: 'ghp_forbidden',
      }),
    })

    expect(result.record.status).toBe('failed')
    expect(result.record.scenarioResults.find(
      (scenario) => scenario.scenarioId === 'native-coding-repair',
    )).toMatchObject({
      status: 'failed',
      observation: {
        stopReason: 'failure',
        eventTypes: [],
        evidenceKinds: [],
        cleanupStatus: 'failed',
      },
    })
    expect(result.record.executorParity[0]).toMatchObject({
      eventContract: false,
      cancellation: false,
      evidence: false,
      terminalResult: false,
      cleanup: false,
    })
    expect(JSON.stringify(result.record)).not.toContain('ghp_forbidden')
  })

  it('removes provider credentials while preserving the minimum test environment', () => {
    const isolated = createProviderIsolatedEnvironment({
      PATH: '/usr/bin',
      HOME: '/tmp/evaluator-home',
      CI: 'false',
      GITHUB_TOKEN: 'forbidden',
      GH_TOKEN: 'forbidden',
      OPENAI_API_KEY: 'forbidden',
      ANTHROPIC_API_KEY: 'forbidden',
      DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64: 'forbidden',
      DEVFLOW_SESSION_SECRET: 'forbidden',
    })

    expect(isolated).toMatchObject({
      PATH: '/usr/bin',
      HOME: '/tmp/evaluator-home',
      CI: 'true',
      DEVFLOW_CODING_ENGINE: 'fake',
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
      DEVFLOW_EVALUATION_NO_PAID_PROVIDER: 'true',
    })
    expect(isolated).not.toHaveProperty('GITHUB_TOKEN')
    expect(isolated).not.toHaveProperty('GH_TOKEN')
    expect(isolated).not.toHaveProperty('OPENAI_API_KEY')
    expect(isolated).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(isolated).not.toHaveProperty('DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64')
    expect(isolated).not.toHaveProperty('DEVFLOW_SESSION_SECRET')
  })

  it('requires the exact clean candidate before executing a scenario', () => {
    expect(validateCandidateWorkspace({
      expectedCandidateSha: candidateSha,
      actualCandidateSha: candidateSha,
      statusPorcelain: '',
    })).toBe(candidateSha)
    expect(() => validateCandidateWorkspace({
      expectedCandidateSha: candidateSha,
      actualCandidateSha: 'a'.repeat(40),
      statusPorcelain: '',
    })).toThrow('v20_evaluation_candidate_mismatch')
    expect(() => validateCandidateWorkspace({
      expectedCandidateSha: candidateSha,
      actualCandidateSha: candidateSha,
      statusPorcelain: ' M packages/shared/src/agent-runtime.ts',
    })).toThrow('v20_evaluation_worktree_dirty')
  })

  it('accepts exactly one executed Vitest assertion and treats a skipped selector as failed', () => {
    const spawn = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({
        success: true,
        numPassedTests: 1,
        numFailedTests: 0,
      }),
      stderr: '',
    }))
    expect(runVitestScenario({
      scenarioId: 'schema-special',
      testFile: 'packages/shared/src/native-tool.test.ts',
      testName: 'rejects input [without] coercion',
    }, {
      cwd: '/workspace',
      environment: { PATH: '/usr/bin', OPENAI_API_KEY: 'forbidden' },
      spawn,
      clockMs: (() => {
        const values = [100, 119]
        return () => values.shift() ?? 119
      })(),
    })).toEqual({ passed: true, durationMs: 19, stdout: expect.any(String), stderr: '' })
    expect(spawn).toHaveBeenCalledWith('corepack', [
      'pnpm',
      'exec',
      'vitest',
      'run',
      'packages/shared/src/native-tool.test.ts',
      '-t',
      'rejects input \\[without\\] coercion',
      '--reporter=json',
      '--silent=true',
    ], expect.objectContaining({
      cwd: '/workspace',
      encoding: 'utf8',
      timeout: 120_000,
      env: expect.not.objectContaining({ OPENAI_API_KEY: 'forbidden' }),
    }))

    expect(runVitestScenario({
      scenarioId: 'skipped-selector',
      testFile: 'packages/shared/src/native-tool.test.ts',
      testName: 'missing test',
    }, {
      cwd: '/workspace',
      environment: {},
      spawn: () => ({
        status: 0,
        stdout: JSON.stringify({ success: true, numPassedTests: 0, numFailedTests: 0 }),
        stderr: '',
      }),
      clockMs: () => 100,
    }).passed).toBe(false)
  })

  it('revalidates the clean candidate and writes one mode-0600 record to the candidate path', async () => {
    const writeRecord = vi.fn()
    const readCandidateState = vi.fn(() => ({
      actualCandidateSha: candidateSha,
      statusPorcelain: '',
    }))
    const result = await runV20EvaluationCli({
      candidateSha,
      outputPath: `out/v20-evaluation/${candidateSha}.json`,
    }, {
      cwd: '/workspace',
      datasetBytes,
      recordedAt: '2026-08-13T06:00:00.000Z',
      readCandidateState,
      runScenario: async () => ({ passed: true, durationMs: 4, stdout: '', stderr: '' }),
      writeRecord,
    })

    expect(readCandidateState).toHaveBeenCalledTimes(2)
    expect(writeRecord).toHaveBeenCalledOnce()
    expect(writeRecord).toHaveBeenCalledWith(
      resolve('/workspace', `out/v20-evaluation/${candidateSha}.json`),
      expect.stringMatching(/^\{[\s\S]+\}\n$/u),
      { encoding: 'utf8', mode: 0o600 },
    )
    expect(JSON.parse(writeRecord.mock.calls[0][1])).toEqual(result.record)
    expect(result.evaluation).toEqual({ ready: true, failures: [] })
  })

  it('rejects unsafe output paths before reading candidate state', async () => {
    const readCandidateState = vi.fn()
    await expect(runV20EvaluationCli({
      candidateSha,
      outputPath: '/tmp/v20-record.json',
    }, {
      cwd: '/workspace',
      datasetBytes,
      recordedAt: '2026-08-13T06:00:00.000Z',
      readCandidateState,
      runScenario: vi.fn(),
      writeRecord: vi.fn(),
    })).rejects.toThrow('v20_evaluation_output_path_invalid')
    expect(readCandidateState).not.toHaveBeenCalled()
  })

  it('rejects ignored local environment files before executing any scenario', async () => {
    const runScenario = vi.fn()
    await expect(runV20EvaluationCli({
      candidateSha,
      outputPath: `out/v20-evaluation/${candidateSha}.json`,
    }, {
      cwd: '/workspace',
      datasetBytes,
      recordedAt: '2026-08-13T06:00:00.000Z',
      localProviderFiles: ['.env.local'],
      readCandidateState: () => ({
        actualCandidateSha: candidateSha,
        statusPorcelain: '',
      }),
      runScenario,
      writeRecord: vi.fn(),
    })).rejects.toThrow('v20_evaluation_local_provider_environment_present')
    expect(runScenario).not.toHaveBeenCalled()
  })

  it('accepts only the exact candidate and output CLI arguments', () => {
    expect(parseV20EvaluationRunnerArguments([
      '--candidate-sha',
      candidateSha,
      '--output',
      `out/v20-evaluation/${candidateSha}.json`,
    ])).toEqual({
      candidateSha,
      outputPath: `out/v20-evaluation/${candidateSha}.json`,
    })
    expect(parseV20EvaluationRunnerArguments([
      '--',
      '--candidate-sha',
      candidateSha,
      '--output',
      `out/v20-evaluation/${candidateSha}.json`,
    ])).toEqual({
      candidateSha,
      outputPath: `out/v20-evaluation/${candidateSha}.json`,
    })
    expect(() => parseV20EvaluationRunnerArguments([
      '--candidate-sha',
      candidateSha,
      '--output',
      `out/v20-evaluation/${candidateSha}.json`,
      '--allow-dirty',
    ])).toThrow('v20_evaluation_arguments_invalid')
  })
})
