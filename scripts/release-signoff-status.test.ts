import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  collectReleaseSignoffSnapshot,
  evaluateReleaseSignoffSnapshot,
  formatReleaseSignoffItems,
  packagePaths,
  parseReleaseMode,
  releaseEvidencePaths,
  releaseProfileFor,
  requiredDocPaths,
  requiredGateIds,
} from './release-signoff-status.mjs'

type ReleaseMode = 'pre-tag' | 'tagged'

type EvidenceRecord = {
  path: string
  exists: boolean
  parseError: string | null
  value: Record<string, unknown> | null
}

type ReleaseSignoffSnapshot = {
  mode: ReleaseMode
  targetVersion: string
  headSha: string
  candidateSha: string | null
  changedFilesFromCandidate: string[] | null
  packageVersions: Record<string, string | null>
  requiredDocs: Record<string, boolean>
  workingTreeClean: boolean
  currentBranch: string
  releaseTagExists: boolean
  releaseTagTarget: string | null
  walkthroughEvidence: EvidenceRecord
  requiredGateRecord: EvidenceRecord
  realOpencodeRecord: EvidenceRecord
}

const currentRootVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
const candidateSha = '1234567890abcdef1234567890abcdef12345678'
const signoffSha = 'abcdef1234567890abcdef1234567890abcdef12'

function record(path: string, value: Record<string, unknown>): EvidenceRecord {
  return {
    path,
    exists: true,
    parseError: null,
    value,
  }
}

function snapshot(overrides: Partial<ReleaseSignoffSnapshot> = {}): ReleaseSignoffSnapshot {
  const targetVersion = overrides.targetVersion ?? '1.3.0'
  const releaseSeries = targetVersion.split('.').slice(0, 2).join('.')
  const profile = releaseProfileFor(targetVersion)
  const evidencePaths = releaseEvidencePaths(targetVersion)

  return {
    mode: 'pre-tag',
    targetVersion,
    headSha: signoffSha,
    candidateSha,
    changedFilesFromCandidate: [
      evidencePaths.walkthrough,
      evidencePaths.requiredGates,
      evidencePaths.realOpencode,
      `docs/guides/devflow-studio-v${releaseSeries}-walkthrough-result-2026-07-31.md`,
    ],
    packageVersions: Object.fromEntries(packagePaths.map((path) => [path, targetVersion])),
    requiredDocs: Object.fromEntries(
      (profile?.requiredDocPaths ?? []).map((path) => [path, true]),
    ),
    workingTreeClean: true,
    currentBranch: `codex/v${releaseSeries}-closeout`,
    releaseTagExists: false,
    releaseTagTarget: null,
    walkthroughEvidence: record(evidencePaths.walkthrough, {
      targetVersion,
      candidateSha,
      status: 'passed',
      date: '2026-07-31',
      method: 'computer-use',
      evidencePath: `docs/guides/devflow-studio-v${releaseSeries}-walkthrough-result-2026-07-31.md`,
      evidenceExists: true,
    }),
    requiredGateRecord: record(evidencePaths.requiredGates, {
      targetVersion,
      candidateSha,
      status: 'passed',
      gates: Object.fromEntries((profile?.requiredGateIds ?? []).map((gate) => [gate, 'passed'])),
    }),
    realOpencodeRecord: record(evidencePaths.realOpencode, {
      targetVersion,
      candidateSha,
      status: 'passed',
      recordedAt: '2026-07-31T12:00:00.000Z',
      opencodeVersion: '1.17.5',
      provider: 'double',
      model: 'ark-code-latest',
      keyEnvName: 'ANTHROPIC_AUTH_TOKEN',
      duration: '1m38s',
      permissionRelay: 'bash -> edit',
      diffEvidence: ['devflow-opencode-smoke.txt'],
      testEvidence: 'passed',
      cleanup: 'passed',
      redactionCheck: 'passed',
      ...(releaseSeries === '1.4'
        ? {
            attemptCount: 1,
            automaticRetry: false,
            costCapUsd: null,
            releaseProfile: 'v1.4',
            providerApiMode: 'responses',
            resolvedConfigPreflight: 'passed',
            providerRetryObserved: false,
            egressGate: {
              armedSegmentCount: 3,
              forwardedRequestCount: 3,
              completedResponseCount: 3,
              blockedUncreditedRequestCount: 0,
              blockedInvalidCount: 0,
              failedSegmentCount: 0,
              activeRequestCount: 0,
              closed: true,
            },
            opencodeVersion: '1.18.15',
          }
        : {}),
    }),
    ...overrides,
  }
}

describe('release signoff status', () => {
  it('requires one explicit release mode', () => {
    expect(parseReleaseMode(['--mode=pre-tag'])).toBe('pre-tag')
    expect(parseReleaseMode(['--mode=tagged'])).toBe('tagged')
    expect(() => parseReleaseMode([])).toThrow('--mode=pre-tag|tagged')
    expect(() => parseReleaseMode(['--mode=preview'])).toThrow('--mode=pre-tag|tagged')
  })

  it('derives the target release version and candidate SHA from repository state', () => {
    const collected = collectReleaseSignoffSnapshot('pre-tag')

    expect(collected.mode).toBe('pre-tag')
    expect(collected.targetVersion).toBe(currentRootVersion)
    expect(collected.packageVersions['package.json']).toBe(currentRootVersion)
    expect(collected.headSha).toMatch(/^[0-9a-f]{40}$/)
    expect(collected.candidateSha).toMatch(/^[0-9a-f]{40}$/)
    expect(collected.changedFilesFromCandidate).toEqual(expect.any(Array))
    expect(collected.walkthroughEvidence.path).toBe(
      `docs/releases/v${currentRootVersion}/walkthrough.json`,
    )
  })

  it('requires the v1.3 closeout, walkthrough, and paid-smoke policy docs', () => {
    expect(requiredDocPaths).toEqual(
      expect.arrayContaining([
        'docs/plans/v1.3-closeout-execution-2026-07-31.md',
        'docs/plans/v1.3-delivery-flow-completion.md',
        'docs/guides/devflow-studio-v1.3-walkthrough.md',
        'docs/plans/release-only-real-opencode-smoke.md',
      ]),
    )
  })

  it('requires the v1.4 PRD, plan, walkthrough, and paid-smoke policy docs', () => {
    expect(releaseProfileFor('1.4.0')?.requiredDocPaths).toEqual([
      'docs/product/prd/v1.4-pilot-trust-boundary-prd.md',
      'docs/plans/v1.4-pilot-trust-boundary.md',
      'docs/plans/v1.4-release-signoff.md',
      'docs/guides/devflow-studio-v1.4-walkthrough.md',
      'docs/plans/release-only-real-opencode-smoke.md',
    ])
  })

  it('requires every deterministic v1.3 release gate in the candidate-bound record', () => {
    expect(requiredGateIds).toEqual(
      expect.arrayContaining([
        'verify',
        'windows-compatibility',
        'e2e',
        'electron-smoke',
        'postgres-smoke',
        'docker-smoke',
        'build',
        'build-output-smoke',
      ]),
    )
  })

  it('requires every deterministic v1.4 release gate in the candidate-bound record', () => {
    expect(releaseProfileFor('1.4.0')?.requiredGateIds).toEqual([
      'verify',
      'windows-compatibility',
      'e2e',
      'electron-smoke',
      'postgres-smoke',
      'docker-smoke',
      'docker-lifecycle-smoke',
      'build',
      'build-output-smoke',
      'desktop-pilot-build',
      'desktop-pilot-smoke',
    ])
  })

  it('evaluates v1.4 docs and gates against the v1.4 profile', () => {
    const ready = snapshot({ targetVersion: '1.4.0' })
    const items = evaluateReleaseSignoffSnapshot({
      ...ready,
      requiredDocs: {
        ...ready.requiredDocs,
        'docs/guides/devflow-studio-v1.4-walkthrough.md': false,
      },
      requiredGateRecord: record(ready.requiredGateRecord.path, {
        ...ready.requiredGateRecord.value,
        gates: {
          ...(ready.requiredGateRecord.value?.gates as Record<string, unknown>),
          'docker-lifecycle-smoke': 'failed',
        },
      }),
    })

    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'release-docs',
        label: 'v1.4 release docs',
        state: 'attention',
      }),
    )
    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'required-gates',
        state: 'attention',
        detail: expect.stringContaining('docker-lifecycle-smoke'),
      }),
    )
  })

  it('rejects an unknown release series instead of falling back to a known profile', () => {
    expect(releaseProfileFor('1.5.0')).toBeNull()

    const items = evaluateReleaseSignoffSnapshot(snapshot({ targetVersion: '1.5.0' }))

    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'release-profile',
        state: 'attention',
        detail: expect.stringContaining('1.5.0'),
      }),
    )
  })

  it('fails closed when the target release version is missing', () => {
    const items = evaluateReleaseSignoffSnapshot({
      ...snapshot(),
      targetVersion: null as unknown as string,
    })

    expect(items).toContainEqual(
      expect.objectContaining({ id: 'release-profile', state: 'attention' }),
    )
  })

  it('requires one no-retry attempt with an explicit uncapped authorization in v1.4 paid-smoke evidence', () => {
    const ready = snapshot({ targetVersion: '1.4.0' })
    expect(evaluateReleaseSignoffSnapshot(ready).every((item) => item.state === 'ready')).toBe(true)

    for (const invalidControls of [
      { attemptCount: 2 },
      { automaticRetry: true },
      { costCapUsd: 20 },
      { releaseProfile: 'ambient' },
      { providerApiMode: 'chat-completions' },
      { resolvedConfigPreflight: 'failed' },
      { providerRetryObserved: true },
      { provider: 'other' },
      { model: 'other-model' },
      { keyEnvName: 'OTHER_KEY' },
      { opencodeVersion: '1.18.14' },
      { permissionRelay: 'bash -> edit -> bash' },
      { diffEvidence: ['/private/tmp/devflow-opencode-smoke.txt'] },
      { diffEvidence: ['../devflow-opencode-smoke.txt'] },
      {
        egressGate: {
          ...(ready.realOpencodeRecord.value?.egressGate as Record<string, unknown>),
          blockedUncreditedRequestCount: 1,
        },
      },
      {
        egressGate: {
          ...(ready.realOpencodeRecord.value?.egressGate as Record<string, unknown>),
          forwardedRequestCount: 2,
        },
      },
      {
        egressGate: {
          ...(ready.realOpencodeRecord.value?.egressGate as Record<string, unknown>),
          armedSegmentCount: 2,
          forwardedRequestCount: 2,
          completedResponseCount: 2,
        },
      },
      {
        egressGate: {
          ...(ready.realOpencodeRecord.value?.egressGate as Record<string, unknown>),
          armedSegmentCount: 4,
          forwardedRequestCount: 4,
          completedResponseCount: 4,
        },
      },
    ]) {
      const items = evaluateReleaseSignoffSnapshot({
        ...ready,
        realOpencodeRecord: record(ready.realOpencodeRecord.path, {
          ...ready.realOpencodeRecord.value,
          ...invalidControls,
        }),
      })

      expect(items).toContainEqual(
        expect.objectContaining({ id: 'real-opencode', state: 'attention' }),
      )
    }
  })

  it('binds all evidence to the signoff commit first parent candidate', () => {
    const items = evaluateReleaseSignoffSnapshot(snapshot())

    expect(items.every((item) => item.state === 'ready')).toBe(true)
  })

  it('rejects any non-evidence file in the signoff commit', () => {
    const unexpectedItems = evaluateReleaseSignoffSnapshot(
      snapshot({
        changedFilesFromCandidate: [
          ...snapshot().changedFilesFromCandidate!,
          'packages/shared/src/domain.ts',
        ],
      }),
    )
    const missingItems = evaluateReleaseSignoffSnapshot(
      snapshot({
        changedFilesFromCandidate: snapshot().changedFilesFromCandidate!.slice(0, 3),
      }),
    )

    expect(unexpectedItems).toContainEqual(
      expect.objectContaining({
        id: 'signoff-contents',
        state: 'attention',
      }),
    )
    expect(missingItems).toContainEqual(
      expect.objectContaining({
        id: 'signoff-contents',
        state: 'attention',
      }),
    )
  })

  it('requires the exact version tag to exist and resolve to HEAD in tagged mode', () => {
    const missingTagItems = evaluateReleaseSignoffSnapshot(snapshot({ mode: 'tagged' }))
    const wrongTargetItems = evaluateReleaseSignoffSnapshot(
      snapshot({
        mode: 'tagged',
        releaseTagExists: true,
        releaseTagTarget: candidateSha,
      }),
    )
    const readyItems = evaluateReleaseSignoffSnapshot(
      snapshot({
        mode: 'tagged',
        releaseTagExists: true,
        releaseTagTarget: signoffSha,
      }),
    )

    expect(missingTagItems).toContainEqual(
      expect.objectContaining({ id: 'release-tag', state: 'attention' }),
    )
    expect(wrongTargetItems).toContainEqual(
      expect.objectContaining({ id: 'release-tag', state: 'attention' }),
    )
    expect(readyItems.every((item) => item.state === 'ready')).toBe(true)
  })

  it('requires the version tag to remain absent in pre-tag mode', () => {
    const items = evaluateReleaseSignoffSnapshot(
      snapshot({
        releaseTagExists: true,
        releaseTagTarget: signoffSha,
      }),
    )

    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'release-tag',
        state: 'attention',
      }),
    )
  })

  it('rejects evidence recorded for a different target version or candidate SHA', () => {
    const evidencePaths = releaseEvidencePaths('1.3.0')
    const items = evaluateReleaseSignoffSnapshot(
      snapshot({
        walkthroughEvidence: record(evidencePaths.walkthrough, {
          targetVersion: '1.3.0',
          candidateSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          status: 'passed',
          date: '2026-07-31',
          method: 'computer-use',
          evidencePath: 'docs/guides/devflow-studio-v1.3-walkthrough-result-2026-07-31.md',
          evidenceExists: true,
        }),
        realOpencodeRecord: record(evidencePaths.realOpencode, {
          targetVersion: '1.2.0',
          candidateSha,
          status: 'passed',
          recordedAt: '2026-07-31T12:00:00.000Z',
        }),
      }),
    )

    expect(items).toContainEqual(
      expect.objectContaining({ id: 'dated-walkthrough', state: 'attention' }),
    )
    expect(items).toContainEqual(
      expect.objectContaining({ id: 'real-opencode', state: 'attention' }),
    )
  })

  it('rejects missing deterministic gates and secret-bearing opencode records', () => {
    const evidencePaths = releaseEvidencePaths('1.3.0')
    const items = evaluateReleaseSignoffSnapshot(
      snapshot({
        requiredGateRecord: record(evidencePaths.requiredGates, {
          targetVersion: '1.3.0',
          candidateSha,
          status: 'passed',
          gates: {
            verify: 'passed',
          },
        }),
        realOpencodeRecord: record(evidencePaths.realOpencode, {
          targetVersion: '1.3.0',
          candidateSha,
          status: 'passed',
          date: '2026-07-31',
          apiKey: 'must-not-be-recorded',
        }),
      }),
    )

    expect(items).toContainEqual(
      expect.objectContaining({ id: 'required-gates', state: 'attention' }),
    )
    expect(items).toContainEqual(
      expect.objectContaining({ id: 'real-opencode', state: 'attention' }),
    )
  })

  it('keeps absent evidence visibly pending instead of accepting an environment-only claim', () => {
    const missing: EvidenceRecord = {
      path: 'docs/releases/v1.3.0/missing.json',
      exists: false,
      parseError: null,
      value: null,
    }
    const items = evaluateReleaseSignoffSnapshot(
      snapshot({
        walkthroughEvidence: missing,
        requiredGateRecord: missing,
        realOpencodeRecord: missing,
      }),
    )

    expect(items).toContainEqual(
      expect.objectContaining({ id: 'dated-walkthrough', state: 'pending' }),
    )
    expect(items).toContainEqual(
      expect.objectContaining({ id: 'required-gates', state: 'pending' }),
    )
    expect(items).toContainEqual(
      expect.objectContaining({ id: 'real-opencode', state: 'pending' }),
    )
  })

  it('formats status output without relying on terminal color', () => {
    const output = formatReleaseSignoffItems(evaluateReleaseSignoffSnapshot(snapshot()))

    expect(output).toContain('OK Candidate SHA')
    expect(output).toContain('OK Required deterministic gates')
    expect(output).toContain('OK Real opencode release smoke')
  })
})
