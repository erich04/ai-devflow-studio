import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createV22ContractDigest,
  createProviderIsolatedEnvironment,
  parseV22EvaluationRunnerArguments,
  runV22EvaluationCli,
  V22_EVALUATION_CONTRACT_PATHS,
} from './v22-multi-agent-evaluation-runner'

const candidateSha = '1234567890abcdef1234567890abcdef12345678'

describe('V2.2 Multi-Agent evaluation runner', () => {
  it('starts through the exact tsx runtime on every supported platform', () => {
    const result = spawnSync(process.execPath, [
      resolve('node_modules/tsx/dist/cli.mjs'),
      'scripts/v22-multi-agent-evaluation-runner.ts',
      '--candidate-sha',
      'invalid',
    ], {
      encoding: 'utf8',
      windowsHide: true,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('v22_evaluation_arguments_invalid')
    expect(result.stderr).not.toContain('Top-level await is currently not supported')
  })

  it('is wired into package scripts and the exact-SHA Verify workflow', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }
    const workflow = readFileSync('.github/workflows/verify.yml', 'utf8')

    expect(packageJson.scripts['test:v22-multi-agent-evaluator']).toBe(
      'tsx scripts/v22-multi-agent-evaluation-runner.ts',
    )
    expect(packageJson.scripts['v22:completion-status']).toBe(
      'tsx scripts/v22-completion-evidence.ts',
    )
    expect(workflow).toContain('name: V2.2 candidate-bound evaluator')
    expect(workflow).toContain(
      'corepack pnpm test:v22-multi-agent-evaluator -- --candidate-sha "${GITHUB_SHA}" --output "out/v22-evaluation/${GITHUB_SHA}.json"',
    )
  })

  it('binds the exact frozen contract set into one digest', () => {
    const entries = V22_EVALUATION_CONTRACT_PATHS.map((path) => ({
      path,
      bytes: readFileSync(path),
    }))
    const digest = createV22ContractDigest(entries)

    expect(digest).toMatch(/^[a-f0-9]{64}$/u)
    expect(createV22ContractDigest([
      ...entries.slice(0, -1),
      { ...entries.at(-1)!, bytes: Buffer.from('changed') },
    ])).not.toBe(digest)
  })

  it('runs all ten exact scenarios without provider authority and writes one candidate record', async () => {
    const writeRecord = vi.fn()
    const runScenario = vi.fn(async () => ({ passed: true, durationMs: 1 }))
    const result = await runV22EvaluationCli({
      candidateSha,
      outputPath: `out/v22-evaluation/${candidateSha}.json`,
    }, {
      cwd: process.cwd(),
      localProviderFiles: [],
      recordedAt: '2026-08-13T22:00:00.000Z',
      readCandidateState: () => ({ actualCandidateSha: candidateSha, statusPorcelain: '' }),
      runScenario,
      writeRecord,
    })
    expect(result.evaluation).toEqual({ ready: true, failures: [] })
    expect(runScenario).toHaveBeenCalledTimes(10)
    expect(writeRecord).toHaveBeenCalledWith(
      expect.stringContaining(`/out/v22-evaluation/${candidateSha}.json`),
      expect.stringContaining(`"candidateSha": "${candidateSha}"`),
      { encoding: 'utf8', mode: 0o600 },
    )
  })

  it('strips provider credentials and accepts only the exact candidate output path', () => {
    expect(createProviderIsolatedEnvironment({
      PATH: '/bin',
      GH_TOKEN: 'forbidden',
      OPENAI_API_KEY: 'forbidden',
      SOME_PASSWORD: 'forbidden',
    })).toEqual({
      PATH: '/bin',
      CI: 'true',
      DEVFLOW_CODING_ENGINE: 'fake',
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
      DEVFLOW_EVALUATION_NO_PAID_PROVIDER: 'true',
    })
    expect(parseV22EvaluationRunnerArguments([
      '--candidate-sha', candidateSha,
      '--output', `out/v22-evaluation/${candidateSha}.json`,
    ])).toEqual({ candidateSha, outputPath: `out/v22-evaluation/${candidateSha}.json` })
    expect(parseV22EvaluationRunnerArguments([
      '--',
      '--candidate-sha', candidateSha,
      '--output', `out/v22-evaluation/${candidateSha}.json`,
    ])).toEqual({ candidateSha, outputPath: `out/v22-evaluation/${candidateSha}.json` })
    expect(() => parseV22EvaluationRunnerArguments([
      '--candidate-sha', candidateSha,
      '--output', 'elsewhere.json',
    ])).toThrow('v22_evaluation_arguments_invalid')
  })
})
