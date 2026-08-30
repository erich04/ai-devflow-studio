import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  CodingEngineContinuationCleanupError,
  CodingEnginePermissionDiscoveryError,
  CodingEngineStartupCleanupError,
} from '../apps/desktop/electron/coding-engine-lifecycle'
import { OpencodeMessageResponseError } from '../apps/desktop/electron/opencode-http-adapter'
import type { CodingPermissionRequest } from '../packages/shared/src/domain'
import { join, resolve } from 'node:path'
import {
  assertCleanCandidateStatus,
  assertCleanFixtureStatus,
  assertCandidateIdentity,
  assertOpencodeSmokeChangedPaths,
  assertOpencodeSmokeOpaqueBilling,
  assertOpencodeSmokePermission,
  buildIsolatedOpencodeSmokeRuntimeEnv,
  buildOpencodeSmokeRuntimeEnv,
  combineOpencodeSmokeFailures,
  createOpencodeSmokeStageError,
  opencodeSmokeErrorMessages,
  OPENCODE_SMOKE_MARKER,
} from './opencode-smoke-policy'

describe('opencode smoke safety policy', () => {
  it('classifies engine failures across the production script/module boundary', () => {
    expect(() =>
      execFileSync(
        process.execPath,
        ['--import', 'tsx', resolve('scripts/fixtures/opencode-smoke-classification-boundary.ts')],
        {
          cwd: process.cwd(),
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            TMPDIR: process.env.TMPDIR,
            USERPROFILE: process.env.USERPROFILE,
            TEMP: process.env.TEMP,
            TMP: process.env.TMP,
            SystemRoot: process.env.SystemRoot,
            ComSpec: process.env.ComSpec,
            PATHEXT: process.env.PATHEXT,
            WINDIR: process.env.WINDIR,
          },
          stdio: 'pipe',
          timeout: 5_000,
        },
      ),
    ).not.toThrow()
  })

  it('allows only an exact pwd shell probe', () => {
    expect(() => assertOpencodeSmokePermission(permission({ permission: 'bash', command: 'pwd' }))).not.toThrow()
    expect(() => assertOpencodeSmokePermission(permission({ permission: 'bash', command: '/bin/pwd' }))).not.toThrow()

    for (const command of [
      'pwd && touch devflow-opencode-smoke.txt',
      'printf success > devflow-opencode-smoke.txt',
      'rm -rf .',
      undefined,
    ]) {
      expect(() => assertOpencodeSmokePermission(permission({ permission: 'bash', command }))).toThrow(
        'opencode smoke blocked an unexpected permission request',
      )
    }
  })

  it('allows file mutation tools only for the expected marker', () => {
    expect(() =>
      assertOpencodeSmokePermission(
        permission({ permission: 'edit', filePath: OPENCODE_SMOKE_MARKER }),
      ),
    ).not.toThrow()
    for (const tool of ['edit', 'write', 'patch'] as const) {
      const filePath = tool === 'edit' ? 'package.json' : OPENCODE_SMOKE_MARKER
      expect(() => assertOpencodeSmokePermission(permission({ permission: tool, filePath }))).toThrow(
        'opencode smoke blocked an unexpected permission request',
      )
    }
  })

  it('blocks install, external directory, and normalized unknown permissions', () => {
    for (const tool of ['install', 'external_directory'] as const) {
      expect(() => assertOpencodeSmokePermission(permission({ permission: tool }))).toThrow(
        'opencode smoke blocked an unexpected permission request',
      )
    }
    expect(() =>
      assertOpencodeSmokePermission(
        permission({
          permission: 'bash',
          title: 'opencode requested mystery-tool permission',
          command: 'pwd',
        }),
      ),
    ).toThrow('opencode smoke blocked an unexpected permission request')
  })

  it('requires the managed diff to contain exactly the expected marker', () => {
    expect(() => assertOpencodeSmokeChangedPaths([OPENCODE_SMOKE_MARKER])).not.toThrow()

    for (const changedPaths of [
      [],
      ['package.json'],
      [OPENCODE_SMOKE_MARKER, 'package.json'],
      [`../${OPENCODE_SMOKE_MARKER}`],
    ]) {
      expect(() => assertOpencodeSmokeChangedPaths(changedPaths)).toThrow(
        'opencode smoke produced an unexpected changed path',
      )
    }
  })

  it('reports unavailable OpenCode usage as unknown/opaque instead of fabricated zeroes', () => {
    expect(assertOpencodeSmokeOpaqueBilling({})).toEqual({
      usage: 'unknown',
      cost: 'opaque',
    })
    expect(() => assertOpencodeSmokeOpaqueBilling({
      tokenUsageId: 'fabricated-zero-token-usage',
    })).toThrow('must not fabricate token usage or dollar cost evidence')
    expect(() => assertOpencodeSmokeOpaqueBilling({
      runtimeCostSummary: {
        id: 'fabricated-zero-cost',
        runId: 'run-1',
        nodeId: 'node-1',
        userId: 'user-1',
        projectId: 'project-1',
        provider: 'openai',
        providerId: 'openai',
        model: 'gpt-4.1-mini',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: null,
        costUsd: 0,
        timestamp: '2026-08-30T00:00:00.000Z',
        source: 'estimated',
        redacted: true,
      },
    })).toThrow('must not fabricate token usage or dollar cost evidence')
  })

  it('requires the candidate worktree to remain clean', () => {
    expect(() => assertCleanCandidateStatus('')).not.toThrow()
    expect(() => assertCleanCandidateStatus('?? devflow-opencode-smoke.txt\n')).toThrow(
      'opencode smoke detected candidate worktree pollution',
    )
  })

  it('requires the candidate HEAD and branch to remain unchanged', () => {
    const initial = { head: 'abc123', branch: 'codex/v1.4-release-signoff' }

    expect(() => assertCandidateIdentity(initial, { ...initial })).not.toThrow()
    expect(() => assertCandidateIdentity(initial, { ...initial, head: 'def456' })).toThrow(
      'opencode smoke detected candidate Git identity changes',
    )
    expect(() => assertCandidateIdentity(initial, { ...initial, branch: 'other-branch' })).toThrow(
      'opencode smoke detected candidate Git identity changes',
    )
  })

  it('requires the fixture source repository to remain clean', () => {
    expect(() => assertCleanFixtureStatus('')).not.toThrow()
    expect(() => assertCleanFixtureStatus(' M package.json\n')).toThrow(
      'opencode smoke detected fixture source repository pollution',
    )
  })

  it('passes only the provider key and operational allowlist to opencode', () => {
    const runtimeEnv = buildOpencodeSmokeRuntimeEnv(
      {
        PATH: '/usr/bin',
        HOME: '/tmp/home',
        HTTPS_PROXY: 'http://proxy.invalid',
        OPENCODE_CONFIG_CONTENT: '{"provider":{}}',
        CUSTOM_PROVIDER_KEY: 'provider-secret',
        UNRELATED_CLOUD_SECRET: 'must-not-pass',
      },
      'CUSTOM_PROVIDER_KEY',
    )

    expect(runtimeEnv).toEqual({
      PATH: '/usr/bin',
      HOME: '/tmp/home',
      HTTPS_PROXY: 'http://proxy.invalid',
      OPENCODE_CONFIG_CONTENT: '{"provider":{}}',
      CUSTOM_PROVIDER_KEY: 'provider-secret',
    })
    expect(runtimeEnv).not.toHaveProperty('UNRELATED_CLOUD_SECRET')
  })

  it('overrides ambient OpenCode storage with smoke-owned isolated directories', () => {
    const runtimeRoot = join('devflow-smoke', 'runtime')
    const runtimeEnv = buildIsolatedOpencodeSmokeRuntimeEnv(
      {
        PATH: '/usr/bin',
        HOME: '/real/home',
        OPENCODE_CONFIG: '/real/home/.config/opencode.json',
        OPENCODE_CONFIG_CONTENT: '{"provider":{}}',
        CUSTOM_PROVIDER_KEY: 'provider-secret',
      },
      'CUSTOM_PROVIDER_KEY',
      runtimeRoot,
    )

    expect(runtimeEnv).toMatchObject({
      HOME: join(runtimeRoot, 'home'),
      TMPDIR: join(runtimeRoot, 'tmp'),
      XDG_CONFIG_HOME: join(runtimeRoot, 'config'),
      XDG_DATA_HOME: join(runtimeRoot, 'data'),
      XDG_CACHE_HOME: join(runtimeRoot, 'cache'),
      XDG_STATE_HOME: join(runtimeRoot, 'state'),
      OPENCODE_DISABLE_PROJECT_CONFIG: '1',
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENCODE_DISABLE_MODELS_FETCH: '1',
      OPENCODE_PURE: '1',
      CUSTOM_PROVIDER_KEY: 'provider-secret',
    })
    expect(runtimeEnv).not.toHaveProperty('OPENCODE_CONFIG')
  })

  it('lets the release egress gate install a dummy key without first copying the real key', () => {
    const runtimeEnv = buildIsolatedOpencodeSmokeRuntimeEnv(
      {
        PATH: '/usr/bin',
        CUSTOM_PROVIDER_KEY: 'provider-secret',
      },
      'CUSTOM_PROVIDER_KEY',
      join('devflow-smoke', 'runtime'),
      { includeApiKey: false },
    )

    expect(runtimeEnv).not.toHaveProperty('CUSTOM_PROVIDER_KEY')
  })

  it('preserves primary and integrity failures while redacting the provider key', () => {
    const providerKey = 'provider-key-that-must-not-appear'
    const failure = combineOpencodeSmokeFailures(
      new Error(`provider failed for ${providerKey}`),
      [new Error('opencode smoke detected candidate worktree pollution')],
    )

    expect(failure).toBeInstanceOf(AggregateError)
    expect(opencodeSmokeErrorMessages(failure, providerKey)).toEqual([
      'provider failed for [REDACTED:provider_key]',
      'opencode smoke detected candidate worktree pollution',
    ])
    expect(
      opencodeSmokeErrorMessages(
        new Error('/private/tmp/devflow-smoke failed with OPENAI_API_KEY=other-secret'),
        providerKey,
      ),
    ).toEqual([
      '[REDACTED:local_absolute_path] failed with [REDACTED:env_secret_assignment]',
    ])
  })

  it.each([
    [
      new OpencodeMessageResponseError({
        code: 'provider_api_error',
        statusCode: 401,
        retryable: false,
      }),
      {
        stage: 'engine_start',
        code: 'provider_api_error',
        statusCode: 401,
        retryable: false,
        message: 'opencode smoke failed; stage=engine_start; code=provider_api_error; status=401; retryable=false',
      },
    ],
    [
      new CodingEnginePermissionDiscoveryError('message_completed_without_permission'),
      {
        stage: 'engine_start',
        code: 'message_completed_without_permission',
        message: 'opencode smoke failed; stage=engine_start; code=message_completed_without_permission',
      },
    ],
    [
      new CodingEnginePermissionDiscoveryError('permission_discovery_timed_out'),
      {
        stage: 'engine_start',
        code: 'permission_discovery_timed_out',
        message: 'opencode smoke failed; stage=engine_start; code=permission_discovery_timed_out',
      },
    ],
    [
      new CodingEngineStartupCleanupError([
        new OpencodeMessageResponseError({
          code: 'provider_api_error',
          statusCode: 429,
          retryable: true,
        }),
        new Error('RAW_PROVIDER_MESSAGE'),
      ]),
      {
        stage: 'engine_start',
        code: 'provider_api_error',
        statusCode: 429,
        retryable: true,
        cleanup: 'failed',
        message: 'opencode smoke failed; stage=engine_start; code=provider_api_error; status=429; retryable=true; cleanup=failed',
      },
    ],
  ] as const)('classifies an engine-start failure using only allowlisted diagnostics', (failure, expected) => {
    const classified = createOpencodeSmokeStageError('engine_start', failure)

    expect(classified).toMatchObject(expected)
    expect(JSON.stringify(classified)).not.toContain('RAW_PROVIDER_MESSAGE')
    expect(opencodeSmokeErrorMessages(classified, 'provider-key')).toEqual([expected.message])
  })

  it('preserves a continuation provider code when permission-relay cleanup fails', () => {
    const failure = new CodingEngineContinuationCleanupError([
      new OpencodeMessageResponseError({
        code: 'provider_api_error',
        statusCode: 429,
        retryable: true,
      }),
      new Error('RAW_CONTINUATION_CLEANUP_DETAIL'),
    ])

    const classified = createOpencodeSmokeStageError('permission_relay', failure)

    expect(classified).toMatchObject({
      stage: 'permission_relay',
      code: 'provider_api_error',
      statusCode: 429,
      retryable: true,
      cleanup: 'failed',
      message: 'opencode smoke failed; stage=permission_relay; code=provider_api_error; status=429; retryable=true; cleanup=failed',
    })
    expect(JSON.stringify(classified)).not.toContain('RAW_CONTINUATION_CLEANUP_DETAIL')
  })

  it('accepts only allowlisted structured error fields at the module boundary', () => {
    expect(
      createOpencodeSmokeStageError('engine_start', {
        name: 'OpencodeHttpRequestError',
        code: 'transport_error',
        statusCode: 999,
        rawBody: 'RAW_PROVIDER_BODY',
      }),
    ).toMatchObject({
      code: 'transport_error',
      statusCode: undefined,
      message: 'opencode smoke failed; stage=engine_start; code=transport_error',
    })
    expect(
      createOpencodeSmokeStageError('engine_start', {
        name: 'OpencodeHttpRequestError',
        code: 'RAW_UNTRUSTED_CODE',
      }),
    ).toMatchObject({ code: 'unclassified' })
  })
})

function permission(
  overrides: Partial<CodingPermissionRequest>,
): CodingPermissionRequest {
  const permissionName = overrides.permission ?? 'bash'
  return {
    id: 'permission-1',
    codingRunId: 'coding-run-1',
    runId: 'run-1',
    nodeId: 'node-1',
    permission: permissionName,
    title: `opencode requested ${permissionName} permission`,
    risk: 'warn',
    reasons: [],
    status: 'pending',
    requestedAt: '2026-08-08T00:00:00.000Z',
    expiresAt: '2026-08-08T00:01:00.000Z',
    ...overrides,
  }
}
