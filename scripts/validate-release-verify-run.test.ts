import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalV15GateRecord,
  canonicalV22GateRecord,
  isCanonicalReleaseGateRecord,
  validateRecordedVerifyRun,
  writeVerifiedRunIdOutput,
} from './validate-release-verify-run.mjs'

const candidateSha = '1234567890abcdef1234567890abcdef12345678'
const runId = 123456
const repository = 'erich04/ai-devflow-studio'
const url = `https://github.com/${repository}/actions/runs/${runId}`
const expectedJobs = [
  'macOS verify',
  'Windows compatibility',
  'Postgres integration',
  'Docker smoke',
  'Docker lifecycle smoke',
]

function fixture() {
  return {
    repository,
    record: {
      candidateSha,
      verifyRun: {
        workflow: 'Verify',
        event: 'workflow_dispatch',
        runId,
        runAttempt: 1,
        url,
        headSha: candidateSha,
        conclusion: 'success',
        jobs: Object.fromEntries(expectedJobs.map((name) => [name, 'success'])),
      },
    },
    run: {
      id: runId,
      name: 'Verify',
      path: '.github/workflows/verify.yml',
      event: 'workflow_dispatch',
      run_attempt: 1,
      head_sha: candidateSha,
      conclusion: 'success',
      html_url: url,
      repository: { full_name: repository },
    },
    jobs: expectedJobs.map((name) => ({ name, conclusion: 'success' })),
  }
}

describe('release Verify run authority', () => {
  it('binds the validator to the canonical v1.5 and v2.2 gate records', () => {
    expect(canonicalV15GateRecord).toBe(
      'docs/releases/v1.5.0/required-gates.json',
    )
    expect(canonicalV22GateRecord).toBe(
      'docs/releases/v2.2.0/release-required-gates.json',
    )
    expect(isCanonicalReleaseGateRecord(canonicalV15GateRecord)).toBe(true)
    expect(isCanonicalReleaseGateRecord(canonicalV22GateRecord)).toBe(true)
    expect(isCanonicalReleaseGateRecord('tmp/required-gates.json')).toBe(false)
  })

  it('exports the verified run id through the GitHub step output file', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'devflow-verify-output-'))
    const outputPath = join(fixtureRoot, 'github-output')
    try {
      writeVerifiedRunIdOutput(runId, outputPath)
      expect(readFileSync(outputPath, 'utf8')).toBe(`run-id=${runId}\n`)
      expect(() => writeVerifiedRunIdOutput(0, outputPath)).toThrow(
        'invalid_output',
      )
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('accepts only the exact externally observed workflow_dispatch run and jobs', () => {
    expect(validateRecordedVerifyRun(fixture())).toEqual({ ok: true })
  })

  it('rejects any observed run or job mismatch without returning raw metadata', () => {
    const baseline = fixture()
    const invalid = [
      { ...baseline, run: { ...baseline.run, id: runId + 1 } },
      { ...baseline, run: { ...baseline.run, name: 'Release' } },
      { ...baseline, run: { ...baseline.run, path: '.github/workflows/fake-verify.yml' } },
      { ...baseline, run: { ...baseline.run, event: 'pull_request' } },
      {
        ...baseline,
        record: {
          ...baseline.record,
          verifyRun: { ...baseline.record.verifyRun, runAttempt: 2 },
        },
      },
      { ...baseline, run: { ...baseline.run, run_attempt: 2 } },
      { ...baseline, run: { ...baseline.run, head_sha: 'f'.repeat(40) } },
      { ...baseline, run: { ...baseline.run, conclusion: 'failure' } },
      { ...baseline, run: { ...baseline.run, html_url: `${url}/attempts/1` } },
      {
        ...baseline,
        run: { ...baseline.run, repository: { full_name: 'other/repository' } },
      },
      {
        ...baseline,
        jobs: baseline.jobs.map((job) =>
          job.name === 'Postgres integration'
            ? { ...job, conclusion: 'failure', raw: 'ghs_must_not_leak' }
            : job,
        ),
      },
    ]

    for (const value of invalid) {
      const result = validateRecordedVerifyRun(value)
      expect(result).toEqual({ ok: false, code: expect.any(String) })
      expect(JSON.stringify(result)).not.toContain('ghs_must_not_leak')
    }
  })
})
