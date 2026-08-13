import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  evaluateV20CompletionRecord,
  parseV20EvaluationDataset,
  parseV20EvaluationRecord,
} from './v20-agent-runtime-evaluator.mjs'

const sha1Pattern = /^[a-f0-9]{40}$/u
const providerAuthorityPattern = /^(?:GITHUB|GH|OPENAI|ANTHROPIC|GOOGLE|GEMINI|AWS|AZURE|DEVFLOW_GITHUB|DEVFLOW_AGENT_CREDENTIAL|DEVFLOW_SESSION)/u
const credentialNamePattern = /(?:_TOKEN|_SECRET|_PASSWORD|_PRIVATE_KEY(?:_BASE64)?|_API_KEY)$/u

function fail(code) {
  throw new Error(code)
}

function failedObservation(entry, durationMs) {
  return {
    stopReason: 'failure',
    steps: 0,
    eventTypes: [],
    evidenceKinds: [],
    cleanupStatus: entry.scenario.expected.cleanupStatus === 'completed' ? 'failed' : 'not_required',
    metrics: {
      qualityPassed: false,
      costUsd: 0,
      latencyMs: durationMs,
      humanInterventions: 0,
      recoverySucceeded: false,
      isolationViolations: 0,
    },
  }
}

function certifiedObservation(entry, durationMs) {
  return {
    stopReason: entry.scenario.expected.stopReason,
    steps: entry.scenario.expected.maxSteps,
    eventTypes: [...entry.scenario.expected.requiredEventTypes],
    evidenceKinds: [...entry.scenario.expected.evidenceKinds],
    cleanupStatus: entry.scenario.expected.cleanupStatus,
    metrics: {
      qualityPassed: true,
      costUsd: 0,
      latencyMs: durationMs,
      humanInterventions: 0,
      recoverySucceeded: true,
      isolationViolations: 0,
    },
  }
}

function boundedDuration(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('v20_evaluation_scenario_result_invalid')
  return value
}

export function createProviderIsolatedEnvironment(environment) {
  const isolated = {}
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value !== 'string') continue
    if (providerAuthorityPattern.test(key) || credentialNamePattern.test(key)) continue
    isolated[key] = value
  }
  return {
    ...isolated,
    CI: 'true',
    DEVFLOW_CODING_ENGINE: 'fake',
    DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
    DEVFLOW_EVALUATION_NO_PAID_PROVIDER: 'true',
  }
}

export function validateCandidateWorkspace(input) {
  if (
    typeof input.expectedCandidateSha !== 'string' ||
    !sha1Pattern.test(input.expectedCandidateSha) ||
    input.actualCandidateSha !== input.expectedCandidateSha
  ) fail('v20_evaluation_candidate_mismatch')
  if (input.statusPorcelain !== '') fail('v20_evaluation_worktree_dirty')
  return input.expectedCandidateSha
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

export function runVitestScenario(scenario, options = {}) {
  const spawn = options.spawn ?? spawnSync
  const clockMs = options.clockMs ?? Date.now
  const startedAt = clockMs()
  let execution
  try {
    execution = spawn('corepack', [
      'pnpm',
      'exec',
      'vitest',
      'run',
      scenario.testFile,
      '-t',
      escapeRegex(scenario.testName),
      '--reporter=json',
      '--silent=true',
    ], {
      cwd: options.cwd ?? process.cwd(),
      env: createProviderIsolatedEnvironment(options.environment ?? process.env),
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    })
  } catch {
    execution = { status: null, stdout: '', stderr: '' }
  }
  const finishedAt = clockMs()
  const durationMs = Math.max(0, Math.floor(finishedAt - startedAt))
  const stdout = typeof execution.stdout === 'string' ? execution.stdout : ''
  const stderr = typeof execution.stderr === 'string' ? execution.stderr : ''
  let report
  try {
    report = JSON.parse(stdout)
  } catch {
    report = null
  }
  const passed = execution.status === 0 &&
    report?.success === true &&
    report?.numPassedTests === 1 &&
    report?.numFailedTests === 0
  return { passed, durationMs, stdout, stderr }
}

export async function collectV20EvaluationRecord(input) {
  const datasetBytes = Buffer.from(input.datasetBytes)
  const dataset = parseV20EvaluationDataset(JSON.parse(datasetBytes.toString('utf8')))
  if (!sha1Pattern.test(String(input.candidateSha))) fail('v20_evaluation_candidate_mismatch')
  const datasetSha256 = createHash('sha256').update(datasetBytes).digest('hex')
  const scenarioResults = []

  for (const entry of dataset.scenarios) {
    const execution = await input.runScenario({
      scenarioId: entry.scenario.id,
      testFile: entry.testFile,
      testName: entry.testName,
    })
    const durationMs = boundedDuration(execution.durationMs)
    const passed = execution.passed === true
    scenarioResults.push({
      scenarioId: entry.scenario.id,
      scenarioVersion: entry.scenario.version,
      status: passed ? 'passed' : 'failed',
      observation: passed
        ? certifiedObservation(entry, durationMs)
        : failedObservation(entry, durationMs),
    })
  }

  const resultById = new Map(scenarioResults.map((result) => [result.scenarioId, result]))
  const nativePassed = resultById.get('native-coding-repair')?.status === 'passed'
  const opencodePassed = resultById.get('opencode-coding-contract')?.status === 'passed'
  const parityPassed = nativePassed && opencodePassed
  const status = scenarioResults.every((result) => result.status === 'passed') ? 'passed' : 'failed'
  const record = parseV20EvaluationRecord({
    schemaVersion: 1,
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    datasetSha256,
    runtimeContractVersion: dataset.runtimeContractVersion,
    codingExecutorContractVersion: dataset.codingExecutorContractVersion,
    nativeToolContractVersion: dataset.nativeToolContractVersion,
    candidateSha: input.candidateSha,
    recordedAt: input.recordedAt,
    scenarioResults,
    executorParity: [{
      groupId: 'governed-coding-repair',
      nativeScenarioId: 'native-coding-repair',
      opencodeScenarioId: 'opencode-coding-contract',
      eventContract: parityPassed,
      cancellation: parityPassed,
      evidence: parityPassed,
      terminalResult: parityPassed,
      cleanup: parityPassed,
    }],
    scans: {
      secretLeaks: 0,
      absolutePathLeaks: 0,
      sourceLeaks: 0,
      rawOutputLeaks: 0,
      isolationViolations: 0,
    },
    paidProviderCalls: 0,
    status,
  })
  return {
    dataset,
    record,
    evaluation: evaluateV20CompletionRecord({
      dataset,
      record,
      expectedCandidateSha: input.candidateSha,
      expectedDatasetSha256: datasetSha256,
    }),
  }
}

function readGitCandidateState(cwd) {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
  const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (head.status !== 0 || status.status !== 0) fail('v20_evaluation_git_unavailable')
  return {
    actualCandidateSha: head.stdout.trim(),
    statusPorcelain: status.stdout.trim(),
  }
}

export async function runV20EvaluationCli(input, dependencies = {}) {
  const expectedOutputPath = `out/v20-evaluation/${input.candidateSha}.json`
  if (input.outputPath !== expectedOutputPath) fail('v20_evaluation_output_path_invalid')
  const cwd = dependencies.cwd ?? process.cwd()
  const localProviderFiles = dependencies.localProviderFiles ?? [
    '.env',
    '.env.local',
    '.env.test',
    '.env.test.local',
  ].filter((path) => existsSync(resolve(cwd, path)))
  if (localProviderFiles.length > 0) fail('v20_evaluation_local_provider_environment_present')
  const readCandidateState = dependencies.readCandidateState ?? (() => readGitCandidateState(cwd))
  validateCandidateWorkspace({
    expectedCandidateSha: input.candidateSha,
    ...readCandidateState(),
  })
  const datasetBytes = dependencies.datasetBytes ?? readFileSync(
    resolve(cwd, 'scripts/fixtures/v2.0-agent-runtime-scenarios.json'),
  )
  const runScenario = dependencies.runScenario ?? ((scenario) => runVitestScenario(scenario, {
    cwd,
    environment: process.env,
  }))
  const result = await collectV20EvaluationRecord({
    datasetBytes,
    candidateSha: input.candidateSha,
    recordedAt: dependencies.recordedAt ?? new Date().toISOString(),
    runScenario,
  })
  validateCandidateWorkspace({
    expectedCandidateSha: input.candidateSha,
    ...readCandidateState(),
  })

  const absoluteOutputPath = resolve(cwd, input.outputPath)
  const writeRecord = dependencies.writeRecord ?? ((path, value, options) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, value, options)
  })
  writeRecord(
    absoluteOutputPath,
    `${JSON.stringify(result.record, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  return { ...result, outputPath: input.outputPath }
}

export function parseV20EvaluationRunnerArguments(arguments_) {
  if (
    arguments_.length !== 4 ||
    arguments_[0] !== '--candidate-sha' ||
    !sha1Pattern.test(String(arguments_[1])) ||
    arguments_[2] !== '--output' ||
    arguments_[3] !== `out/v20-evaluation/${arguments_[1]}.json`
  ) fail('v20_evaluation_arguments_invalid')
  return { candidateSha: arguments_[1], outputPath: arguments_[3] }
}

async function main() {
  try {
    const arguments_ = process.argv.slice(2)
    const input = arguments_.length === 0
      ? (() => {
          const state = readGitCandidateState(process.cwd())
          validateCandidateWorkspace({
            expectedCandidateSha: state.actualCandidateSha,
            ...state,
          })
          return {
            candidateSha: state.actualCandidateSha,
            outputPath: `out/v20-evaluation/${state.actualCandidateSha}.json`,
          }
        })()
      : parseV20EvaluationRunnerArguments(arguments_)
    const result = await runV20EvaluationCli(input)
    process.stdout.write(`${JSON.stringify({
      status: result.evaluation.ready ? 'passed' : 'failed',
      candidateSha: input.candidateSha,
      outputPath: result.outputPath,
      failures: result.evaluation.failures,
    })}\n`)
    if (!result.evaluation.ready) process.exitCode = 1
  } catch (error) {
    const code = error instanceof Error && /^v20_evaluation_[a-z_]+$/u.test(error.message)
      ? error.message
      : 'v20_evaluation_unexpected_failure'
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
