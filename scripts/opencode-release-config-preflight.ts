import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { buildIsolatedOpencodeSmokeRuntimeEnv } from './opencode-smoke-policy.ts'
import {
  assertV14ResolvedOpencodeConfig,
  evaluateOpencodeSmokePreflight,
  resolveOpencodeSmokeConfigContent,
} from './opencode-smoke-preflight.ts'

const FAKE_API_KEY = '__DEVFLOW_RELEASE_CONFIG_PREFLIGHT_NOT_A_CREDENTIAL__'
const EXPECTED_OPENCODE_VERSION = '1.18.15'
const FAILURE_MESSAGE = 'opencode release config preflight failed'
const SUCCESS_MESSAGE = 'opencode release config preflight passed; Responses profile resolved under no-network isolation.'
const execFileAsync = promisify(execFile)

async function main(): Promise<void> {
  let runtimeRoot: string | undefined
  let passed = false
  try {
    const preflight = evaluateOpencodeSmokePreflight(process.env)
    if (preflight.mode !== 'ready' || preflight.releaseProfile !== 'v1.4') {
      throw new Error(FAILURE_MESSAGE)
    }
    if (process.platform !== 'darwin') {
      throw new Error(FAILURE_MESSAGE)
    }

    runtimeRoot = await mkdtemp(join(tmpdir(), 'devflow-opencode-config-preflight-'))
    await Promise.all(
      ['home', 'tmp', 'config', 'data', 'cache', 'state'].map((name) =>
        mkdir(join(runtimeRoot!, name), { recursive: true }),
      ),
    )
    const runtimeEnv = buildIsolatedOpencodeSmokeRuntimeEnv(
      process.env,
      preflight.apiKeyEnvName,
      runtimeRoot,
      { includeApiKey: false },
    )
    for (const name of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
    ]) {
      delete runtimeEnv[name]
    }
    runtimeEnv.NO_PROXY = '127.0.0.1,localhost'
    runtimeEnv.no_proxy = '127.0.0.1,localhost'
    runtimeEnv[preflight.apiKeyEnvName] = FAKE_API_KEY
    runtimeEnv.OPENCODE_CONFIG_CONTENT = resolveOpencodeSmokeConfigContent(
      preflight,
      process.env.OPENCODE_CONFIG_CONTENT,
    )
    runtimeEnv.OPENCODE_CLIENT = 'server'
    runtimeEnv.OPENCODE_ENABLE_QUESTION_TOOL = 'false'
    runtimeEnv.NO_COLOR = '1'
    runtimeEnv.FORCE_COLOR = '0'

    const versionResult = await execFileAsync(
      '/usr/bin/sandbox-exec',
      [
        '-p',
        '(version 1) (allow default) (deny network*)',
        preflight.binaryPath,
        '--version',
      ],
      {
        cwd: runtimeRoot,
        env: runtimeEnv,
        encoding: 'utf8',
        maxBuffer: 64 * 1024,
        timeout: 30_000,
      },
    )
    if (String(versionResult.stdout).trim() !== EXPECTED_OPENCODE_VERSION) {
      throw new Error(FAILURE_MESSAGE)
    }

    const result = await execFileAsync(
      '/usr/bin/sandbox-exec',
      [
        '-p',
        '(version 1) (allow default) (deny network*)',
        preflight.binaryPath,
        'debug',
        'config',
        '--pure',
      ],
      {
        cwd: runtimeRoot,
        env: runtimeEnv,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
        timeout: 30_000,
      },
    )
    const resolved = JSON.parse(String(result.stdout)) as unknown
    assertV14ResolvedOpencodeConfig(resolved, FAKE_API_KEY)
    passed = true
  } catch {
  } finally {
    if (runtimeRoot !== undefined) {
      try {
        await rm(runtimeRoot, { recursive: true, force: true })
      } catch {
        passed = false
      }
    }
  }

  if (passed) {
    console.log(SUCCESS_MESSAGE)
    return
  }
  console.error(FAILURE_MESSAGE)
  process.exitCode = 1
}

main().catch(() => {
  console.error(FAILURE_MESSAGE)
  process.exitCode = 1
})
