import { describe, expect, it } from 'vitest'
import type { CodingPermissionRequest } from '../packages/shared/src/domain'
import { join } from 'node:path'
import {
  assertCleanCandidateStatus,
  assertCleanFixtureStatus,
  assertCandidateIdentity,
  assertOpencodeSmokeChangedPaths,
  assertOpencodeSmokePermission,
  buildIsolatedOpencodeSmokeRuntimeEnv,
  buildOpencodeSmokeRuntimeEnv,
  combineOpencodeSmokeFailures,
  opencodeSmokeErrorMessages,
  OPENCODE_SMOKE_MARKER,
} from './opencode-smoke-policy'

describe('opencode smoke safety policy', () => {
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
