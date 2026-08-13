import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createV22EvaluationRecord,
  evaluateV22CompletionRecord,
  V22_SCENARIO_TESTS,
} from './v22-multi-agent-evaluator'

const sha1Pattern = /^[a-f0-9]{40}$/u
const providerAuthorityPattern = /^(?:GITHUB|GH|OPENAI|ANTHROPIC|GOOGLE|GEMINI|AWS|AZURE|DEVFLOW_GITHUB|DEVFLOW_AGENT_CREDENTIAL|DEVFLOW_SESSION)/u
const credentialNamePattern = /(?:_TOKEN|_SECRET|_PASSWORD|_PRIVATE_KEY(?:_BASE64)?|_API_KEY)$/u

export const V22_EVALUATION_CONTRACT_PATHS = Object.freeze([
  'packages/shared/src/agent-coordination.ts',
  'packages/shared/src/agent-coordination-evaluation.ts',
  'packages/shared/src/agent-coordination-team-projection.ts',
  'docs/adr/0019-bounded-multi-agent-coordination.md',
  'docs/product/prd/v2.2-multi-agent-execution-tenancy-prd.md',
  'docs/plans/v2.2-multi-agent-execution-tenancy.md',
])

type ContractEntry = { path: string; bytes: Uint8Array }
type ScenarioExecution = { passed: boolean; durationMs: number }

function fail(code: string): never {
  throw new Error(code)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

export function createProviderIsolatedEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const isolated: NodeJS.ProcessEnv = {}
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

export function createV22ContractDigest(entries: readonly ContractEntry[]): string {
  if (
    entries.length !== V22_EVALUATION_CONTRACT_PATHS.length ||
    entries.some((entry, index) => entry.path !== V22_EVALUATION_CONTRACT_PATHS[index])
  ) fail('v22_evaluation_contract_invalid')
  const hash = createHash('sha256')
  for (const entry of entries) {
    hash.update(entry.path, 'utf8')
    hash.update('\0', 'utf8')
    hash.update(entry.bytes)
    hash.update('\0', 'utf8')
  }
  return hash.digest('hex')
}

function validateCandidateWorkspace(input: {
  expectedCandidateSha: string
  actualCandidateSha: string
  statusPorcelain: string
}): void {
  if (
    !sha1Pattern.test(input.expectedCandidateSha) ||
    input.actualCandidateSha !== input.expectedCandidateSha
  ) fail('v22_evaluation_candidate_mismatch')
  if (input.statusPorcelain !== '') fail('v22_evaluation_worktree_dirty')
}

function readCandidateState(cwd: string) {
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
  if (head.status !== 0 || status.status !== 0) fail('v22_evaluation_git_unavailable')
  return { actualCandidateSha: head.stdout.trim(), statusPorcelain: status.stdout.trim() }
}

export function runV22Scenario(
  scenario: (typeof V22_SCENARIO_TESTS)[number],
  options: { cwd?: string; environment?: NodeJS.ProcessEnv; clockMs?: () => number } = {},
): ScenarioExecution {
  const clockMs = options.clockMs ?? Date.now
  const startedAt = clockMs()
  const result = spawnSync('corepack', [
    'pnpm', 'exec', 'vitest', 'run', scenario.testFile,
    '-t', escapeRegex(scenario.testName), '--reporter=json', '--silent=true',
  ], {
    cwd: options.cwd ?? process.cwd(),
    env: createProviderIsolatedEnvironment(options.environment ?? process.env),
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  })
  let report: { success?: boolean; numPassedTests?: number; numFailedTests?: number } | null = null
  try {
    report = JSON.parse(result.stdout || 'null')
  } catch {
    report = null
  }
  return {
    passed: result.status === 0 && report?.success === true &&
      report.numPassedTests === 1 && report.numFailedTests === 0,
    durationMs: Math.max(0, Math.floor(clockMs() - startedAt)),
  }
}

type RunnerDependencies = {
  cwd?: string
  datasetBytes?: Uint8Array
  contractEntries?: readonly ContractEntry[]
  localProviderFiles?: string[]
  recordedAt?: string
  readCandidateState?: () => { actualCandidateSha: string; statusPorcelain: string }
  runScenario?: (
    scenario: (typeof V22_SCENARIO_TESTS)[number],
  ) => ScenarioExecution | Promise<ScenarioExecution>
  writeRecord?: (
    path: string,
    value: string,
    options: { encoding: 'utf8'; mode: number },
  ) => void
}

export async function runV22EvaluationCli(
  input: { candidateSha: string; outputPath: string },
  dependencies: RunnerDependencies = {},
) {
  const expectedOutputPath = `out/v22-evaluation/${input.candidateSha}.json`
  if (input.outputPath !== expectedOutputPath) fail('v22_evaluation_output_path_invalid')
  const cwd = dependencies.cwd ?? process.cwd()
  const localProviderFiles = dependencies.localProviderFiles ?? [
    '.env', '.env.local', '.env.test', '.env.test.local',
  ].filter((path) => existsSync(resolve(cwd, path)))
  if (localProviderFiles.length > 0) fail('v22_evaluation_local_provider_environment_present')
  const readState = dependencies.readCandidateState ?? (() => readCandidateState(cwd))
  validateCandidateWorkspace({ expectedCandidateSha: input.candidateSha, ...readState() })
  const datasetBytes = dependencies.datasetBytes ?? readFileSync(
    resolve(cwd, 'scripts/fixtures/v2.2-multi-agent-evaluation.json'),
  )
  const contractEntries = dependencies.contractEntries ?? V22_EVALUATION_CONTRACT_PATHS.map(
    (path) => ({ path, bytes: readFileSync(resolve(cwd, path)) }),
  )
  const contractSha256 = createV22ContractDigest(contractEntries)
  const runScenario = dependencies.runScenario ?? ((scenario) =>
    runV22Scenario(scenario, { cwd, environment: process.env }))
  const scenarioExecutions = []
  for (const scenario of V22_SCENARIO_TESTS) {
    const execution = await runScenario(scenario)
    scenarioExecutions.push({ scenarioId: scenario.scenarioId, ...execution })
  }
  const record = createV22EvaluationRecord({
    datasetBytes,
    candidateSha: input.candidateSha,
    contractSha256,
    recordedAt: dependencies.recordedAt ?? new Date().toISOString(),
    scenarioExecutions,
  })
  const evaluation = evaluateV22CompletionRecord({
    datasetBytes,
    record,
    expectedCandidateSha: input.candidateSha,
    expectedContractSha256: contractSha256,
  })
  validateCandidateWorkspace({ expectedCandidateSha: input.candidateSha, ...readState() })
  const absoluteOutputPath = resolve(cwd, input.outputPath)
  const writeRecord = dependencies.writeRecord ?? ((path, value, options) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, value, options)
  })
  writeRecord(absoluteOutputPath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  return { record, evaluation, outputPath: input.outputPath }
}

export function parseV22EvaluationRunnerArguments(arguments_: string[]) {
  const normalized = arguments_[0] === '--' ? arguments_.slice(1) : arguments_
  if (
    normalized.length !== 4 ||
    normalized[0] !== '--candidate-sha' ||
    !sha1Pattern.test(String(normalized[1])) ||
    normalized[2] !== '--output' ||
    normalized[3] !== `out/v22-evaluation/${normalized[1]}.json`
  ) fail('v22_evaluation_arguments_invalid')
  return { candidateSha: normalized[1]!, outputPath: normalized[3]! }
}

async function main() {
  try {
    const arguments_ = process.argv.slice(2)
    const input = arguments_.length === 0
      ? (() => {
          const state = readCandidateState(process.cwd())
          validateCandidateWorkspace({ expectedCandidateSha: state.actualCandidateSha, ...state })
          return {
            candidateSha: state.actualCandidateSha,
            outputPath: `out/v22-evaluation/${state.actualCandidateSha}.json`,
          }
        })()
      : parseV22EvaluationRunnerArguments(arguments_)
    const result = await runV22EvaluationCli(input)
    process.stdout.write(`${JSON.stringify({
      status: result.evaluation.ready ? 'passed' : 'failed',
      candidateSha: input.candidateSha,
      outputPath: result.outputPath,
      failures: result.evaluation.failures,
    })}\n`)
    if (!result.evaluation.ready) process.exitCode = 1
  } catch (error) {
    const code = error instanceof Error && /^v22_evaluation_[a-z_]+$/u.test(error.message)
      ? error.message
      : 'v22_evaluation_unexpected_failure'
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main()
}
