import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  collectV21EvaluationRecord,
  createProviderIsolatedEnvironment,
  createV21ContractDigest,
  parseV21EvaluationRunnerArguments,
  runV21EvaluationCli,
  validateV21CandidateWorkspace,
  V21_EVALUATION_CONTRACT_PATHS,
} from './v21-retrieval-memory-evaluation-runner'

const candidateSha = '1'.repeat(40)
const corpusBytes = readFileSync('scripts/fixtures/v2.1-retrieval-memory-evaluation.json')
const contractEntries = V21_EVALUATION_CONTRACT_PATHS.map((path) => ({
  path,
  bytes: readFileSync(path),
}))

describe('V2.1 Retrieval and Memory evaluation runner', () => {
  it('starts through the exact tsx CommonJS package runtime', () => {
    const result = spawnSync(process.execPath, [
      resolve('node_modules/tsx/dist/cli.mjs'),
      'scripts/v21-retrieval-memory-evaluation-runner.ts',
      '--candidate-sha',
      'invalid',
    ], {
      encoding: 'utf8',
      windowsHide: true,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('v21_evaluation_arguments_invalid')
    expect(result.stderr).not.toContain('Top-level await is currently not supported')
  })

  it('is wired into the package scripts and exact-SHA Verify workflow', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }
    const workflow = readFileSync('.github/workflows/verify.yml', 'utf8')

    expect(packageJson.scripts['test:v21-retrieval-memory-evaluator']).toBe(
      'tsx scripts/v21-retrieval-memory-evaluation-runner.ts',
    )
    expect(packageJson.scripts['v21:completion-status']).toBe(
      'tsx scripts/v21-completion-evidence.ts',
    )
    expect(workflow).toContain('name: V2.1 candidate-bound evaluator')
    expect(workflow).toContain(
      'corepack pnpm test:v21-retrieval-memory-evaluator -- --candidate-sha "${GITHUB_SHA}" --output "out/v21-evaluation/${GITHUB_SHA}.json"',
    )
  })

  it('removes provider and credential authority from the no-cost environment', () => {
    expect(createProviderIsolatedEnvironment({
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'forbidden',
      GITHUB_TOKEN: 'forbidden',
      DEVFLOW_SESSION_SECRET: 'forbidden',
      SAFE_FLAG: 'kept',
    })).toEqual({
      PATH: '/usr/bin',
      SAFE_FLAG: 'kept',
      CI: 'true',
      DEVFLOW_EVALUATION_NO_PAID_PROVIDER: 'true',
    })
  })

  it('collects one deterministic candidate-bound record and exact contract digest', () => {
    const contractSha256 = createV21ContractDigest(contractEntries)
    const result = collectV21EvaluationRecord({
      corpusBytes,
      contractEntries,
      candidateSha,
      recordedAt: '2026-08-13T14:30:00.000Z',
    })

    expect(contractSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(result.record).toMatchObject({
      candidateSha,
      contractSha256,
      status: 'passed',
      paidProviderCalls: 0,
    })
    expect(result.evaluation).toEqual({ ready: true, failures: [] })
    expect(createV21ContractDigest([
      ...contractEntries.slice(0, -1),
      {
        ...contractEntries.at(-1)!,
        bytes: Buffer.concat([contractEntries.at(-1)!.bytes, Buffer.from('\nchanged')]),
      },
    ])).not.toBe(contractSha256)
  })

  it('requires the exact clean candidate and exact CLI output path', () => {
    expect(validateV21CandidateWorkspace({
      expectedCandidateSha: candidateSha,
      actualCandidateSha: candidateSha,
      statusPorcelain: '',
    })).toBe(candidateSha)
    expect(() => validateV21CandidateWorkspace({
      expectedCandidateSha: candidateSha,
      actualCandidateSha: '2'.repeat(40),
      statusPorcelain: '',
    })).toThrow('v21_evaluation_candidate_mismatch')
    expect(() => validateV21CandidateWorkspace({
      expectedCandidateSha: candidateSha,
      actualCandidateSha: candidateSha,
      statusPorcelain: 'M source.ts',
    })).toThrow('v21_evaluation_worktree_dirty')

    expect(parseV21EvaluationRunnerArguments([
      '--candidate-sha',
      candidateSha,
      '--output',
      `out/v21-evaluation/${candidateSha}.json`,
    ])).toEqual({
      candidateSha,
      outputPath: `out/v21-evaluation/${candidateSha}.json`,
    })
    expect(parseV21EvaluationRunnerArguments([
      '--',
      '--candidate-sha',
      candidateSha,
      '--output',
      `out/v21-evaluation/${candidateSha}.json`,
    ])).toEqual({
      candidateSha,
      outputPath: `out/v21-evaluation/${candidateSha}.json`,
    })
    expect(() => parseV21EvaluationRunnerArguments([
      '--candidate-sha',
      candidateSha,
      '--output',
      'outside.json',
    ])).toThrow('v21_evaluation_arguments_invalid')
  })

  it('checks the candidate before and after evaluation and writes one bounded record', async () => {
    const readCandidateState = vi.fn(() => ({
      actualCandidateSha: candidateSha,
      statusPorcelain: '',
    }))
    const writeRecord = vi.fn()
    const result = await runV21EvaluationCli({
      candidateSha,
      outputPath: `out/v21-evaluation/${candidateSha}.json`,
    }, {
      cwd: '/workspace',
      corpusBytes,
      contractEntries,
      localProviderFiles: [],
      recordedAt: '2026-08-13T14:30:00.000Z',
      readCandidateState,
      writeRecord,
    })

    expect(result.evaluation).toEqual({ ready: true, failures: [] })
    expect(readCandidateState).toHaveBeenCalledTimes(2)
    expect(writeRecord).toHaveBeenCalledOnce()
    expect(writeRecord.mock.calls[0]?.[0]).toBe(
      resolve('/workspace', `out/v21-evaluation/${candidateSha}.json`),
    )
    expect(JSON.parse(String(writeRecord.mock.calls[0]?.[1]))).toEqual(result.record)
  })
})
