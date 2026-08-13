import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createV21EvaluationRecord,
  evaluateV21CompletionRecord,
} from './v21-retrieval-memory-evaluator'

const sha1Pattern = /^[a-f0-9]{40}$/u
const providerAuthorityPattern = /^(?:GITHUB|GH|OPENAI|ANTHROPIC|GOOGLE|GEMINI|AWS|AZURE|DEVFLOW_GITHUB|DEVFLOW_AGENT_CREDENTIAL|DEVFLOW_SESSION)/u
const credentialNamePattern = /(?:_TOKEN|_SECRET|_PASSWORD|_PRIVATE_KEY(?:_BASE64)?|_API_KEY)$/u

export const V21_EVALUATION_CONTRACT_PATHS = Object.freeze([
  'packages/shared/src/retrieval-memory.ts',
  'docs/adr/0017-evaluated-hybrid-retrieval-and-citation.md',
  'docs/adr/0018-scoped-agent-memory-lifecycle.md',
  'docs/product/prd/v2.1-evaluated-retrieval-memory-prd.md',
])

type ContractEntry = { path: string; bytes: Uint8Array }

function fail(code: string): never {
  throw new Error(code)
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
    DEVFLOW_EVALUATION_NO_PAID_PROVIDER: 'true',
  }
}

export function createV21ContractDigest(entries: readonly ContractEntry[]): string {
  if (
    entries.length !== V21_EVALUATION_CONTRACT_PATHS.length ||
    entries.some((entry, index) => entry.path !== V21_EVALUATION_CONTRACT_PATHS[index])
  ) fail('v21_evaluation_contract_invalid')
  const hash = createHash('sha256')
  for (const entry of entries) {
    hash.update(entry.path, 'utf8')
    hash.update('\0', 'utf8')
    hash.update(entry.bytes)
    hash.update('\0', 'utf8')
  }
  return hash.digest('hex')
}

export function validateV21CandidateWorkspace(input: {
  expectedCandidateSha: string
  actualCandidateSha: string
  statusPorcelain: string
}): string {
  if (
    !sha1Pattern.test(input.expectedCandidateSha) ||
    input.actualCandidateSha !== input.expectedCandidateSha
  ) fail('v21_evaluation_candidate_mismatch')
  if (input.statusPorcelain !== '') fail('v21_evaluation_worktree_dirty')
  return input.expectedCandidateSha
}

export function collectV21EvaluationRecord(input: {
  corpusBytes: Uint8Array
  contractEntries: readonly ContractEntry[]
  candidateSha: string
  recordedAt: string
}) {
  const contractSha256 = createV21ContractDigest(input.contractEntries)
  const record = createV21EvaluationRecord({
    corpusBytes: input.corpusBytes,
    candidateSha: input.candidateSha,
    contractSha256,
    recordedAt: input.recordedAt,
  })
  return {
    record,
    evaluation: evaluateV21CompletionRecord({
      corpusBytes: input.corpusBytes,
      record,
      expectedCandidateSha: input.candidateSha,
      expectedContractSha256: contractSha256,
    }),
  }
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
  if (head.status !== 0 || status.status !== 0) fail('v21_evaluation_git_unavailable')
  return {
    actualCandidateSha: head.stdout.trim(),
    statusPorcelain: status.stdout.trim(),
  }
}

type RunnerDependencies = {
  cwd?: string
  corpusBytes?: Uint8Array
  contractEntries?: readonly ContractEntry[]
  localProviderFiles?: string[]
  recordedAt?: string
  readCandidateState?: () => { actualCandidateSha: string; statusPorcelain: string }
  writeRecord?: (
    path: string,
    value: string,
    options: { encoding: 'utf8'; mode: number },
  ) => void
}

export async function runV21EvaluationCli(
  input: { candidateSha: string; outputPath: string },
  dependencies: RunnerDependencies = {},
) {
  const expectedOutputPath = `out/v21-evaluation/${input.candidateSha}.json`
  if (input.outputPath !== expectedOutputPath) fail('v21_evaluation_output_path_invalid')
  const cwd = dependencies.cwd ?? process.cwd()
  const localProviderFiles = dependencies.localProviderFiles ?? [
    '.env',
    '.env.local',
    '.env.test',
    '.env.test.local',
  ].filter((path) => existsSync(resolve(cwd, path)))
  if (localProviderFiles.length > 0) fail('v21_evaluation_local_provider_environment_present')
  const readState = dependencies.readCandidateState ?? (() => readCandidateState(cwd))
  validateV21CandidateWorkspace({ expectedCandidateSha: input.candidateSha, ...readState() })

  const corpusBytes = dependencies.corpusBytes ?? readFileSync(
    resolve(cwd, 'scripts/fixtures/v2.1-retrieval-memory-evaluation.json'),
  )
  const contractEntries = dependencies.contractEntries ?? V21_EVALUATION_CONTRACT_PATHS.map(
    (path) => ({ path, bytes: readFileSync(resolve(cwd, path)) }),
  )
  const result = collectV21EvaluationRecord({
    corpusBytes,
    contractEntries,
    candidateSha: input.candidateSha,
    recordedAt: dependencies.recordedAt ?? new Date().toISOString(),
  })
  validateV21CandidateWorkspace({ expectedCandidateSha: input.candidateSha, ...readState() })

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

export function parseV21EvaluationRunnerArguments(arguments_: string[]) {
  const normalizedArguments = arguments_[0] === '--' ? arguments_.slice(1) : arguments_
  if (
    normalizedArguments.length !== 4 ||
    normalizedArguments[0] !== '--candidate-sha' ||
    !sha1Pattern.test(String(normalizedArguments[1])) ||
    normalizedArguments[2] !== '--output' ||
    normalizedArguments[3] !== `out/v21-evaluation/${normalizedArguments[1]}.json`
  ) fail('v21_evaluation_arguments_invalid')
  return { candidateSha: normalizedArguments[1]!, outputPath: normalizedArguments[3]! }
}

async function main() {
  try {
    const arguments_ = process.argv.slice(2)
    const input = arguments_.length === 0
      ? (() => {
          const state = readCandidateState(process.cwd())
          validateV21CandidateWorkspace({
            expectedCandidateSha: state.actualCandidateSha,
            ...state,
          })
          return {
            candidateSha: state.actualCandidateSha,
            outputPath: `out/v21-evaluation/${state.actualCandidateSha}.json`,
          }
        })()
      : parseV21EvaluationRunnerArguments(arguments_)
    const result = await runV21EvaluationCli(input)
    process.stdout.write(`${JSON.stringify({
      status: result.evaluation.ready ? 'passed' : 'failed',
      candidateSha: input.candidateSha,
      outputPath: result.outputPath,
      failures: result.evaluation.failures,
    })}\n`)
    if (!result.evaluation.ready) process.exitCode = 1
  } catch (error) {
    const code = error instanceof Error && /^v21_evaluation_[a-z_]+$/u.test(error.message)
      ? error.message
      : 'v21_evaluation_unexpected_failure'
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main()
}
