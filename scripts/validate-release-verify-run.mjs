import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { readBoundedJsonFileSync } from './release-evidence-file.mjs'

export const canonicalV15GateRecord =
  'docs/releases/v1.5.0/required-gates.json'

const expectedJobNames = [
  'macOS verify',
  'Windows compatibility',
  'Postgres integration',
  'Docker smoke',
  'Docker lifecycle smoke',
]

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateRecordedVerifyRun({ repository, record, run, jobs }) {
  if (
    typeof repository !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    !isRecord(record) ||
    !isRecord(record.verifyRun) ||
    !isRecord(run) ||
    !Array.isArray(jobs)
  ) {
    return { ok: false, code: 'invalid_input' }
  }

  const expected = record.verifyRun
  const canonicalUrl = `https://github.com/${repository}/actions/runs/${expected.runId}`
  if (
    !Number.isSafeInteger(expected.runId) ||
    expected.runId <= 0 ||
    expected.workflow !== 'Verify' ||
    expected.event !== 'workflow_dispatch' ||
    expected.runAttempt !== 1 ||
    expected.headSha !== record.candidateSha ||
    expected.conclusion !== 'success' ||
    expected.url !== canonicalUrl
  ) {
    return { ok: false, code: 'invalid_recorded_run' }
  }

  if (
    run.id !== expected.runId ||
    run.name !== expected.workflow ||
    run.path !== '.github/workflows/verify.yml' ||
    run.event !== expected.event ||
    run.run_attempt !== expected.runAttempt ||
    run.head_sha !== expected.headSha ||
    run.conclusion !== expected.conclusion ||
    run.html_url !== expected.url ||
    run.repository?.full_name !== repository
  ) {
    return { ok: false, code: 'observed_run_mismatch' }
  }

  if (
    !isRecord(expected.jobs) ||
    Object.keys(expected.jobs).length !== expectedJobNames.length ||
    !expectedJobNames.every((name) => expected.jobs[name] === 'success')
  ) {
    return { ok: false, code: 'invalid_recorded_jobs' }
  }

  const observedJobs = new Map()
  for (const job of jobs) {
    if (!isRecord(job) || typeof job.name !== 'string' || observedJobs.has(job.name)) {
      return { ok: false, code: 'observed_jobs_mismatch' }
    }
    observedJobs.set(job.name, job.conclusion)
  }
  if (
    observedJobs.size !== expectedJobNames.length ||
    !expectedJobNames.every((name) => observedJobs.get(name) === 'success')
  ) {
    return { ok: false, code: 'observed_jobs_mismatch' }
  }

  return { ok: true }
}

function readGitHubJson(endpoint) {
  return JSON.parse(
    execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', endpoint], {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    }),
  )
}

export function writeVerifiedRunIdOutput(runId, outputPath) {
  if (
    !Number.isSafeInteger(runId) ||
    runId <= 0 ||
    typeof outputPath !== 'string' ||
    outputPath.length === 0
  ) {
    throw new Error('invalid_output')
  }
  appendFileSync(outputPath, `run-id=${runId}\n`, { encoding: 'utf8' })
}

function runCli() {
  try {
    const recordPath = process.argv[2]
    const repository = process.env.GITHUB_REPOSITORY
    if (recordPath !== canonicalV15GateRecord || !repository) {
      throw new Error('missing_input')
    }
    const record = readBoundedJsonFileSync(recordPath)
    const runId = record?.verifyRun?.runId
    if (!Number.isSafeInteger(runId) || runId <= 0) {
      throw new Error('invalid_run_id')
    }
    const run = readGitHubJson(`repos/${repository}/actions/runs/${runId}`)
    const jobsResponse = readGitHubJson(
      `repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
    )
    const result = validateRecordedVerifyRun({
      repository,
      record,
      run,
      jobs: jobsResponse?.jobs,
    })
    if (!result.ok) {
      throw new Error(result.code)
    }
    writeVerifiedRunIdOutput(runId, process.env.GITHUB_OUTPUT)
    console.log(`Verified exact workflow_dispatch run ${runId}.`)
  } catch {
    console.error('Recorded Verify run could not be independently validated.')
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCli()
}
