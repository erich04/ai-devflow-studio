import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectReleaseSignoffSnapshot,
  collectDesktopArtifactEvidence,
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
  referencedEvidenceExists?: boolean
  referencedEvidenceContent?: string | null
  referencedEvidenceReadError?: string | null
}

type DesktopArtifactEvidence = {
  indexPath: string
  exists: boolean
  parseError: string | null
  version: string | null
  platform: string | null
  declaredSha256: string | null
  actualSha256: string | null
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
  releaseTagObjectType: string | null
  desktopArtifactEvidence: DesktopArtifactEvidence
  walkthroughEvidence: EvidenceRecord
  requiredGateRecord: EvidenceRecord
  realOpencodeRecord?: EvidenceRecord
  githubSandboxRecord?: EvidenceRecord
}

const currentRootVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
const candidateSha = '1234567890abcdef1234567890abcdef12345678'
const signoffSha = 'abcdef1234567890abcdef1234567890abcdef12'
const desktopArtifactSha = '9'.repeat(64)
const revocationIntentId =
  'github-delivery-intent-123e4567-e89b-42d3-a456-426614174000'
const otherRevocationIntentId =
  'github-delivery-intent-123e4567-e89b-42d3-b456-426614174001'
const revocationCheckedAt = '2026-08-11T12:30:00.000Z'

function walkthroughContent(releaseSeries: string): string {
  if (releaseSeries !== '1.5') {
    return `# V${releaseSeries} walkthrough\n\nStatus: Passed\n\nCandidate: ${candidateSha}\n`
  }

  return `# V1.5 walkthrough result

Status: Passed

Candidate: ${candidateSha}
Packaged artifact: 1.5.0 darwin-arm64 ${desktopArtifactSha}
Team schema v14; Desktop schema v17.
Verify: https://github.com/devflow/ai-devflow-studio/actions/runs/123456
Delivery series: github-delivery:${'a'.repeat(64)}
Delivery attempt: 1; intent revision: 1.
Intent digest: ${'b'.repeat(64)}
Test evidence digest: ${'c'.repeat(64)}
PR package digest: ${'d'.repeat(64)}
Expected commit: ${'e'.repeat(40)}; remote head: ${'e'.repeat(40)}.
Draft PR: https://github.com/devflow/release-sandbox/pull/17
Acceptance: completed. Restart recovery: passed.
Redaction check: passed. Cleanup: passed. The Draft PR was not merged.
Operator role: non-maintainer. Ad hoc maintainer assistance: false.
Approval role/auth: owner/session_cookie.
Lifecycle counts: Work Request 1, canonical Run 1, credential grant 1, branch publication 1, Draft PR 1.
Sandbox/App: private devflow/release-sandbox via devflow-release-sandbox.
Draft state: true; merged: false; automatic retry: false.
Restart side-effect repeats: credential 0, push 0, pull request 0.
Revocation proof: state version 2; intent ${revocationIntentId}; revoked binding version 2; outcome binding_inactive; checked at ${revocationCheckedAt}; durable check count 1.
`
}

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
  const evidenceDate = releaseSeries === '1.5' ? '2026-08-11' : '2026-07-31'
  const profile = releaseProfileFor(targetVersion)
  const evidencePaths = releaseEvidencePaths(targetVersion)
  const releaseEvidencePath = evidencePaths.githubSandbox ?? evidencePaths.realOpencode

  return {
    mode: 'pre-tag',
    targetVersion,
    headSha: signoffSha,
    candidateSha,
    changedFilesFromCandidate: [
      evidencePaths.walkthrough,
      evidencePaths.requiredGates,
      releaseEvidencePath,
      `docs/guides/devflow-studio-v${releaseSeries}-walkthrough-result-${evidenceDate}.md`,
    ],
    packageVersions: Object.fromEntries(packagePaths.map((path) => [path, targetVersion])),
    requiredDocs: Object.fromEntries(
      (profile?.requiredDocPaths ?? []).map((path) => [path, true]),
    ),
    workingTreeClean: true,
    currentBranch: `codex/v${releaseSeries}-closeout`,
    releaseTagExists: false,
    releaseTagTarget: null,
    releaseTagObjectType: null,
    desktopArtifactEvidence: {
      indexPath: 'out/desktop-pilot/artifact-index.json',
      exists: true,
      parseError: null,
      version: targetVersion,
      platform: 'darwin-arm64',
      declaredSha256: desktopArtifactSha,
      actualSha256: desktopArtifactSha,
    },
    walkthroughEvidence: {
      ...record(evidencePaths.walkthrough, {
        targetVersion,
        candidateSha,
        status: 'passed',
        date: evidenceDate,
        method: 'computer-use',
        evidencePath: `docs/guides/devflow-studio-v${releaseSeries}-walkthrough-result-${evidenceDate}.md`,
      }),
      referencedEvidenceExists: true,
      referencedEvidenceContent: walkthroughContent(releaseSeries),
      referencedEvidenceReadError: null,
    },
    requiredGateRecord: record(evidencePaths.requiredGates, {
      targetVersion,
      candidateSha,
      status: 'passed',
      ...(releaseSeries === '1.5'
        ? {
            recordedAt: '2026-08-11T12:00:00.000Z',
            localMatrix: {
              candidateSha,
              result: 'passed',
              worktreeCleanAfter: true,
            },
            verifyRun: {
              workflow: 'Verify',
              event: 'workflow_dispatch',
              runId: 123456,
              runAttempt: 1,
              url: 'https://github.com/devflow/ai-devflow-studio/actions/runs/123456',
              headSha: candidateSha,
              conclusion: 'success',
              jobs: {
                'macOS verify': 'success',
                'Windows compatibility': 'success',
                'Postgres integration': 'success',
                'Docker smoke': 'success',
                'Docker lifecycle smoke': 'success',
              },
            },
            desktopArtifact: {
              version: targetVersion,
              platform: 'darwin-arm64',
              sha256: desktopArtifactSha,
            },
          }
        : {}),
      gates: Object.fromEntries((profile?.requiredGateIds ?? []).map((gate) => [gate, 'passed'])),
    }),
    ...(releaseSeries === '1.5'
      ? {
          githubSandboxRecord: record(releaseEvidencePath, {
            targetVersion,
            candidateSha,
            status: 'passed',
            recordedAt: '2026-08-11T13:00:00.000Z',
            repository: 'devflow/release-sandbox',
            repositoryVisibility: 'private',
            appSlug: 'devflow-release-sandbox',
            installationIdSuffix: '4321',
            repositoryIdSuffix: '8765',
            bindingVersion: 1,
            deliverySeriesKey: `github-delivery:${'a'.repeat(64)}`,
            deliveryAttempt: 1,
            intentRevision: 1,
            intentDigest: 'b'.repeat(64),
            runVersion: 3,
            testEvidenceDigest: 'c'.repeat(64),
            prPackageDigest: 'd'.repeat(64),
            expectedCommitSha: 'e'.repeat(40),
            remoteHeadSha: 'e'.repeat(40),
            baseBranch: 'main',
            headBranch: 'devflow/v1.5-release',
            pullRequestNumber: 17,
            pullRequestUrl: 'https://github.com/devflow/release-sandbox/pull/17',
            draft: true,
            merged: false,
            approvalRole: 'owner',
            approvalAuthKind: 'session_cookie',
            workRequestCount: 1,
            canonicalRunCount: 1,
            credentialGrantCount: 1,
            branchPublicationCount: 1,
            draftPullRequestCount: 1,
            automaticRetry: false,
            acceptanceStatus: 'completed',
            restartRecovery: 'passed',
            revocationProof: {
              proofStateVersion: 2,
              intentId: revocationIntentId,
              revokedBindingVersion: 2,
              outcomeCode: 'binding_inactive',
              checkedAt: revocationCheckedAt,
              durableCheckCount: 1,
            },
            redactionCheck: 'passed',
            cleanup: 'passed',
            cleanupMethod: 'external-operator-no-merge',
            operatorRole: 'non-maintainer',
            adHocMaintainerAssistance: false,
          }),
        }
      : {
          realOpencodeRecord: record(releaseEvidencePath, {
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
        }),
    ...overrides,
  }
}

function v15SnapshotWithSandbox(
  sandboxOverrides: Record<string, unknown>,
): ReleaseSignoffSnapshot {
  const ready = snapshot({ targetVersion: '1.5.0' })
  return {
    ...ready,
    githubSandboxRecord: record(ready.githubSandboxRecord!.path, {
      ...ready.githubSandboxRecord!.value,
      ...sandboxOverrides,
    }),
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
    expect(collected.desktopArtifactEvidence.indexPath).toBe(
      'out/desktop-pilot/artifact-index.json',
    )
  })

  it('derives the packaged Desktop digest from the indexed archive bytes', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'devflow-release-artifact-'))
    try {
      const archive = Buffer.from('candidate-bound-desktop-archive')
      const label = 'ai-devflow-studio-desktop-1.5.0-darwin-arm64'
      const manifestName = `${label}.manifest.json`
      const archiveName = `${label}.tar.gz`
      writeFileSync(
        join(fixtureRoot, 'artifact-index.json'),
        JSON.stringify({
          schemaVersion: 1,
          platform: 'darwin',
          arch: 'arm64',
          appDirectory: 'app-directory/AI DevFlow Studio-darwin-arm64',
          manifest: manifestName,
          archive: archiveName,
        }),
      )
      writeFileSync(
        join(fixtureRoot, manifestName),
        JSON.stringify({
          schemaVersion: 1,
          artifact: { version: '1.5.0', platform: 'darwin', arch: 'arm64' },
          entries: [],
          archive: {
            path: archiveName,
            sha256: createHash('sha256').update(archive).digest('hex'),
          },
        }),
      )
      writeFileSync(join(fixtureRoot, archiveName), archive)

      expect(
        collectDesktopArtifactEvidence(join(fixtureRoot, 'artifact-index.json')),
      ).toEqual({
        indexPath: join(fixtureRoot, 'artifact-index.json'),
        exists: true,
        parseError: null,
        version: '1.5.0',
        platform: 'darwin-arm64',
        declaredSha256: createHash('sha256').update(archive).digest('hex'),
        actualSha256: createHash('sha256').update(archive).digest('hex'),
      })

      writeFileSync(join(fixtureRoot, archiveName), Buffer.from('tampered archive'))
      expect(
        collectDesktopArtifactEvidence(join(fixtureRoot, 'artifact-index.json')),
      ).toEqual(
        expect.objectContaining({
          exists: true,
          parseError: 'artifact_digest_mismatch',
          declaredSha256: null,
          actualSha256: null,
        }),
      )
      writeFileSync(join(fixtureRoot, archiveName), archive)
      writeFileSync(
        join(fixtureRoot, manifestName),
        JSON.stringify({
          schemaVersion: 1,
          artifact: { version: '1.5.0', platform: 'darwin', arch: 'arm64' },
          entries: [],
          archive: {
            path: 'different.tar.gz',
            sha256: createHash('sha256').update(archive).digest('hex'),
          },
        }),
      )
      expect(
        collectDesktopArtifactEvidence(join(fixtureRoot, 'artifact-index.json')),
      ).toEqual(
        expect.objectContaining({
          exists: true,
          parseError: 'invalid_artifact_manifest',
        }),
      )

      writeFileSync(
        join(fixtureRoot, 'artifact-index.json'),
        JSON.stringify({
          schemaVersion: 1,
          platform: 'darwin',
          arch: 'arm64',
          appDirectory: 'app-directory/AI DevFlow Studio-darwin-arm64',
          manifest: '../outside.manifest.json',
          archive: archiveName,
        }),
      )
      expect(
        collectDesktopArtifactEvidence(join(fixtureRoot, 'artifact-index.json')),
      ).toEqual(
        expect.objectContaining({
          exists: true,
          parseError: 'invalid_artifact_index',
          declaredSha256: null,
          actualSha256: null,
        }),
      )
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
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

  it('defines the exact v1.5 release profile and GitHub sandbox evidence path', () => {
    expect(releaseProfileFor('1.5.0')?.requiredDocPaths).toEqual([
      'docs/product/prd/v1.5-github-delivery-prd.md',
      'docs/plans/v1.5-github-delivery.md',
      'docs/adr/0013-github-app-delivery-authority.md',
      'docs/guides/devflow-studio-v1.5-walkthrough.md',
      'docs/guides/devflow-studio-self-hosted-pilot.md',
    ])
    expect(releaseProfileFor('1.5.0')?.requiredGateIds).toEqual([
      'verify',
      'windows-compatibility',
      'v15-github-delivery-deterministic',
      'e2e',
      'electron-smoke',
      'postgres-smoke',
      'docker-smoke',
      'docker-lifecycle-smoke',
      'build',
      'build-output-smoke',
      'desktop-pilot-build',
      'desktop-pilot-smoke',
      'v15-github-delivery-packaged-smoke',
      'github-sandbox-draft-pr',
    ])
    expect(releaseEvidencePaths('1.5.0')).toEqual({
      walkthrough: 'docs/releases/v1.5.0/walkthrough.json',
      requiredGates: 'docs/releases/v1.5.0/required-gates.json',
      githubSandbox: 'docs/releases/v1.5.0/github-sandbox.json',
    })
  })

  it('collects v1.5 GitHub sandbox evidence without touching paid OpenCode configuration', () => {
    const env = {
      DEVFLOW_RELEASE_TARGET_VERSION: '1.5.0',
    } as NodeJS.ProcessEnv
    Object.defineProperty(env, 'DEVFLOW_RELEASE_OPENCODE_RECORD', {
      get() {
        throw new Error('v1.5 must not read paid OpenCode configuration')
      },
    })

    const collected = collectReleaseSignoffSnapshot('pre-tag', env)

    expect(collected.githubSandboxRecord.path).toBe(
      'docs/releases/v1.5.0/github-sandbox.json',
    )
    expect(collected).not.toHaveProperty('realOpencodeRecord')
  })

  it('refuses every noncanonical v1.5 signoff-record override', () => {
    for (const envName of [
      'DEVFLOW_RELEASE_WALKTHROUGH_RECORD',
      'DEVFLOW_RELEASE_GATE_RECORD',
      'DEVFLOW_RELEASE_GITHUB_SANDBOX_RECORD',
    ]) {
      expect(() =>
        releaseEvidencePaths('1.5.0', {
          [envName]: 'package.json',
        } as NodeJS.ProcessEnv),
      ).toThrow('noncanonical_v15_evidence_path')
    }

    expect(
      releaseEvidencePaths('1.4.0', {
        DEVFLOW_RELEASE_GATE_RECORD: 'tmp/legacy-required-gates.json',
      } as NodeJS.ProcessEnv).requiredGates,
    ).toBe('tmp/legacy-required-gates.json')
  })

  it('accepts one candidate-bound private GitHub sandbox Draft PR for v1.5', () => {
    const ready = snapshot({ targetVersion: '1.5.0' })
    Object.defineProperty(ready, 'realOpencodeRecord', {
      get() {
        throw new Error('v1.5 must not evaluate paid OpenCode evidence')
      },
    })
    const items = evaluateReleaseSignoffSnapshot(ready)

    expect(items.every((item) => item.state === 'ready')).toBe(true)
    expect(items).toContainEqual(
      expect.objectContaining({ id: 'github-sandbox', state: 'ready' }),
    )
    expect(items.some((item) => item.id === 'real-opencode')).toBe(false)
  })

  it('rejects secret-bearing GitHub sandbox evidence', () => {
    for (const secretFields of [
      { installationToken: 'must-not-be-recorded' },
      { privateKey: 'must-not-be-recorded' },
      { authorizationHeader: 'must-not-be-recorded' },
      { nested: { credential: 'must-not-be-recorded' } },
    ]) {
      const items = evaluateReleaseSignoffSnapshot(
        v15SnapshotWithSandbox(secretFields),
      )

      expect(items).toContainEqual(
        expect.objectContaining({
          id: 'github-sandbox',
          state: 'attention',
          detail: expect.stringContaining('Secret-bearing fields'),
        }),
      )
    }
  })

  it('rejects absolute filesystem paths in GitHub sandbox metadata', () => {
    const items = evaluateReleaseSignoffSnapshot(
      v15SnapshotWithSandbox({ repository: '/Users/alice/private/release-sandbox' }),
    )

    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'github-sandbox',
        state: 'attention',
        detail: expect.stringContaining('Local absolute paths are forbidden'),
      }),
    )
  })

  it('rejects a GitHub sandbox remote head that differs from the expected commit', () => {
    const items = evaluateReleaseSignoffSnapshot(
      v15SnapshotWithSandbox({ remoteHeadSha: 'f'.repeat(40) }),
    )

    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'github-sandbox',
        state: 'attention',
        detail: expect.stringContaining('exact expected commit and remote head'),
      }),
    )
  })

  it('rejects duplicate GitHub sandbox lifecycle counts', () => {
    for (const countField of [
      'workRequestCount',
      'canonicalRunCount',
      'credentialGrantCount',
      'branchPublicationCount',
      'draftPullRequestCount',
    ]) {
      const items = evaluateReleaseSignoffSnapshot(
        v15SnapshotWithSandbox({ [countField]: 2 }),
      )

      expect(items).toContainEqual(
        expect.objectContaining({
          id: 'github-sandbox',
          state: 'attention',
          detail: expect.stringContaining('exactly one'),
        }),
      )
    }
  })

  it('requires exact private-repository identity metadata for the GitHub sandbox', () => {
    for (const invalidMetadata of [
      { recordedAt: 'not-a-timestamp' },
      { repository: 'devflow/release-sandbox/extra' },
      { repositoryVisibility: 'public' },
      { appSlug: 'DevFlow App' },
      { installationIdSuffix: '321' },
      { repositoryIdSuffix: '98765' },
      { bindingVersion: 0 },
      { deliverySeriesKey: 'github-delivery:not-a-digest' },
      { deliveryAttempt: 0 },
      { deliveryAttempt: 2 },
      { intentRevision: 0 },
      { intentRevision: 2 },
      { intentDigest: 'not-a-digest' },
      { runVersion: 0 },
      { testEvidenceDigest: 'not-a-digest' },
      { prPackageDigest: 'not-a-digest' },
      { baseBranch: 'main branch' },
      { headBranch: 'feature/v1.5-release' },
      { pullRequestNumber: 0 },
      { pullRequestUrl: 'https://example.com/devflow/release-sandbox/pull/17' },
    ]) {
      const items = evaluateReleaseSignoffSnapshot(
        v15SnapshotWithSandbox(invalidMetadata),
      )

      expect(items).toContainEqual(
        expect.objectContaining({
          id: 'github-sandbox',
          state: 'attention',
          detail: expect.stringContaining('private-repository identity metadata'),
        }),
      )
    }
  })

  it('requires one exact durable binding_inactive revocation proof', () => {
    const ready = snapshot({ targetVersion: '1.5.0' })
    const validProof = ready.githubSandboxRecord!.value!
      .revocationProof as Record<string, unknown>
    const invalidProofs = [
      undefined,
      { ...validProof, proofStateVersion: 1 },
      { ...validProof, proofStateVersion: 3 },
      { ...validProof, outcomeCode: 'blocked' },
      { ...validProof, outcomeCode: 'binding_active' },
      { ...validProof, durableCheckCount: 0 },
      { ...validProof, durableCheckCount: 2 },
      { ...validProof, intentId: 'foo' },
      { ...validProof, intentId: 'delivery-intent-123e4567-e89b-42d3-a456-426614174000' },
      { ...validProof, intentId: 'github-delivery-intent-not-a-uuid' },
      { ...validProof, intentId: 'github-delivery-intent-123E4567-E89B-42D3-A456-426614174000' },
      { ...validProof, intentId: 'github-delivery-intent-123e4567-e89b-12d3-a456-426614174000' },
      { ...validProof, intentId: 'github-delivery-intent-123e4567-e89b-42d3-7456-426614174000' },
      { ...validProof, intentId: '../other-intent' },
      { ...validProof, revokedBindingVersion: 1 },
      { ...validProof, checkedAt: '2026-08-11T12:30:00Z' },
      { ...validProof, checkedAt: '2026-08-11T13:00:00.001Z' },
    ]

    for (const revocationProof of invalidProofs) {
      const items = evaluateReleaseSignoffSnapshot(
        v15SnapshotWithSandbox({ revocationProof }),
      )

      expect(items).toContainEqual(
        expect.objectContaining({ id: 'github-sandbox', state: 'attention' }),
      )
    }

    const vagueOnly = evaluateReleaseSignoffSnapshot(
      v15SnapshotWithSandbox({
        revocationProof: undefined,
        bindingRevocation: 'passed',
        postRevocationGrant: 'blocked',
      }),
    )
    expect(vagueOnly).toContainEqual(
      expect.objectContaining({ id: 'github-sandbox', state: 'attention' }),
    )
  })

  it('binds the dated result to the exact revocation identity, binding version, and time', () => {
    const ready = snapshot({ targetVersion: '1.5.0' })
    const content = ready.walkthroughEvidence.referencedEvidenceContent!
    const validProof = ready.githubSandboxRecord!.value!
      .revocationProof as Record<string, unknown>

    for (const proofOverride of [
      { proofStateVersion: 1 },
      { intentId: otherRevocationIntentId },
      { revokedBindingVersion: 3 },
      { checkedAt: '2026-08-11T12:31:00.000Z' },
    ]) {
      const items = evaluateReleaseSignoffSnapshot(
        v15SnapshotWithSandbox({
          revocationProof: { ...validProof, ...proofOverride },
        }),
      )

      expect(items).toContainEqual(
        expect.objectContaining({ id: 'dated-walkthrough', state: 'attention' }),
      )
    }

    for (const vagueOrTamperedContent of [
      content.replace(/^Revocation proof:.*$/mu, 'Binding revocation: passed. Post-revocation credential grant: blocked.'),
      content.replace('state version 2', 'state version 1'),
      content.replace('outcome binding_inactive', 'outcome blocked'),
      content.replace('durable check count 1.', 'durable check count 0.'),
      content.replace('durable check count 1.', 'durable check count 2.'),
      content.replace(revocationIntentId, otherRevocationIntentId),
      content.replace('revoked binding version 2', 'revoked binding version 3'),
      content.replace(revocationCheckedAt, '2026-08-11T12:31:00.000Z'),
    ]) {
      const items = evaluateReleaseSignoffSnapshot({
        ...ready,
        walkthroughEvidence: {
          ...ready.walkthroughEvidence,
          referencedEvidenceContent: vagueOrTamperedContent,
        },
      })

      expect(items).toContainEqual(
        expect.objectContaining({ id: 'dated-walkthrough', state: 'attention' }),
      )
    }

    for (const [proofOverride, lineReplacement] of [
      [{ outcomeCode: 'blocked' }, 'outcome blocked'],
      [{ durableCheckCount: 0 }, 'durable check count 0.'],
      [{ durableCheckCount: 2 }, 'durable check count 2.'],
    ] as const) {
      const items = evaluateReleaseSignoffSnapshot({
        ...v15SnapshotWithSandbox({
          revocationProof: { ...validProof, ...proofOverride },
        }),
        walkthroughEvidence: {
          ...ready.walkthroughEvidence,
          referencedEvidenceContent:
            'outcomeCode' in proofOverride
              ? content.replace('outcome binding_inactive', lineReplacement)
              : content.replace('durable check count 1.', lineReplacement),
        },
      })

      expect(items).toContainEqual(
        expect.objectContaining({ id: 'dated-walkthrough', state: 'attention' }),
      )
    }
  })

  it('requires every v1.5 release record and revocation proof to use the walkthrough UTC date', () => {
    const ready = snapshot({ targetVersion: '1.5.0' })
    const validProof = ready.githubSandboxRecord!.value!
      .revocationProof as Record<string, unknown>

    for (const overrides of [
      {
        walkthroughEvidence: {
          ...ready.walkthroughEvidence,
          value: { ...ready.walkthroughEvidence.value, date: '2026-08-10' },
        },
      },
      {
        walkthroughEvidence: {
          ...ready.walkthroughEvidence,
          value: {
            ...ready.walkthroughEvidence.value,
            evidencePath:
              'docs/guides/devflow-studio-v1.5-walkthrough-result-2026-08-10.md',
          },
        },
      },
      {
        requiredGateRecord: record(ready.requiredGateRecord.path, {
          ...ready.requiredGateRecord.value,
          recordedAt: '2026-08-10T23:59:59.999Z',
        }),
      },
      {
        githubSandboxRecord: record(ready.githubSandboxRecord!.path, {
          ...ready.githubSandboxRecord!.value,
          recordedAt: '2026-08-10T23:59:59.999Z',
        }),
      },
      {
        githubSandboxRecord: record(ready.githubSandboxRecord!.path, {
          ...ready.githubSandboxRecord!.value,
          revocationProof: {
            ...validProof,
            checkedAt: '2026-08-10T23:59:59.999Z',
          },
        }),
      },
    ] satisfies Array<Partial<ReleaseSignoffSnapshot>>) {
      const items = evaluateReleaseSignoffSnapshot({ ...ready, ...overrides })

      expect(items).toContainEqual(
        expect.objectContaining({ id: 'dated-walkthrough', state: 'attention' }),
      )
    }
  })

  it('rejects a second conflicting Revocation proof line in the dated result', () => {
    const ready = snapshot({ targetVersion: '1.5.0' })
    const content = ready.walkthroughEvidence.referencedEvidenceContent!
    const items = evaluateReleaseSignoffSnapshot({
      ...ready,
      walkthroughEvidence: {
        ...ready.walkthroughEvidence,
        referencedEvidenceContent: `${content}\nRevocation proof: intent ${otherRevocationIntentId}; revoked binding version 3; outcome binding_inactive; checked at 2026-08-11T12:31:00.000Z; durable check count 1.\n`,
      },
    })

    expect(items).toContainEqual(
      expect.objectContaining({ id: 'dated-walkthrough', state: 'attention' }),
    )
  })

  it('requires exact candidate, CI, and packaged Desktop metadata in the v1.5 gate record', () => {
    const ready = snapshot({ targetVersion: '1.5.0' })
    const validRecord = ready.requiredGateRecord.value!
    const invalidRecords = [
      { ...validRecord, recordedAt: 'not-a-timestamp' },
      {
        ...validRecord,
        localMatrix: { candidateSha, result: 'failed', worktreeCleanAfter: true },
      },
      {
        ...validRecord,
        verifyRun: {
          ...(validRecord.verifyRun as Record<string, unknown>),
          event: 'pull_request',
        },
      },
      {
        ...validRecord,
        verifyRun: {
          ...(validRecord.verifyRun as Record<string, unknown>),
          runAttempt: 2,
        },
      },
      {
        ...validRecord,
        verifyRun: {
          ...(validRecord.verifyRun as Record<string, unknown>),
          url: 'https://github.com/devflow/ai-devflow-studio/actions/runs/654321',
        },
      },
      {
        ...validRecord,
        verifyRun: {
          ...(validRecord.verifyRun as Record<string, unknown>),
          headSha: 'f'.repeat(40),
        },
      },
      {
        ...validRecord,
        desktopArtifact: {
          version: '1.4.0',
          platform: 'darwin-arm64',
          sha256: '9'.repeat(64),
        },
      },
      {
        ...validRecord,
        desktopArtifact: {
          version: '1.5.0',
          platform: 'darwin-arm64',
          sha256: '8'.repeat(64),
        },
      },
    ]

    for (const value of invalidRecords) {
      const items = evaluateReleaseSignoffSnapshot({
        ...ready,
        requiredGateRecord: record(ready.requiredGateRecord.path, value),
      })
      expect(items).toContainEqual(
        expect.objectContaining({ id: 'required-gates', state: 'attention' }),
      )
    }
  })

  it('requires exact v1.5 evidence object shapes', () => {
    const ready = snapshot({ targetVersion: '1.5.0' })
    const cases: Array<Partial<ReleaseSignoffSnapshot>> = [
      {
        walkthroughEvidence: {
          ...ready.walkthroughEvidence,
          value: { ...ready.walkthroughEvidence.value, notes: 'extra field' },
        },
      },
      {
        requiredGateRecord: record(ready.requiredGateRecord.path, {
          ...ready.requiredGateRecord.value,
          notes: 'extra field',
        }),
      },
      {
        requiredGateRecord: record(ready.requiredGateRecord.path, {
          ...ready.requiredGateRecord.value,
          verifyRun: {
            ...(ready.requiredGateRecord.value!.verifyRun as Record<string, unknown>),
            notes: 'extra nested field',
          },
        }),
      },
      {
        requiredGateRecord: record(ready.requiredGateRecord.path, {
          ...ready.requiredGateRecord.value,
          gates: {
            ...(ready.requiredGateRecord.value!.gates as Record<string, unknown>),
            convenienceGate: 'passed',
          },
        }),
      },
      {
        githubSandboxRecord: record(ready.githubSandboxRecord!.path, {
          ...ready.githubSandboxRecord!.value,
          notes: 'extra field',
        }),
      },
      {
        githubSandboxRecord: record(ready.githubSandboxRecord!.path, {
          ...ready.githubSandboxRecord!.value,
          revocationProof: {
            ...(ready.githubSandboxRecord!.value!.revocationProof as Record<string, unknown>),
            notes: 'extra nested field',
          },
        }),
      },
    ]

    for (const overrides of cases) {
      const items = evaluateReleaseSignoffSnapshot({ ...ready, ...overrides })
      expect(
        items.some(
          (item) =>
            ['dated-walkthrough', 'required-gates', 'github-sandbox'].includes(item.id) &&
            item.state === 'attention',
        ),
      ).toBe(true)
    }
  })

  it('rejects unsafe content in the dated v1.5 walkthrough result', () => {
    const ready = snapshot({ targetVersion: '1.5.0' })

    for (const unsafeContent of [
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nghs_${'a'.repeat(32)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\n-----BEGIN PRIVATE KEY-----`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nAuthorization: Bearer ${'a'.repeat(24)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nCookie: devflow_session=${'a'.repeat(24)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nSet-Cookie: devflow_session=${'a'.repeat(24)}; HttpOnly`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\ndevflow_session=${'a'.repeat(24)}.${'b'.repeat(24)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\n"password": "hunter2-secret"`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\ntoken: opaque-copy-once-value`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\npostgresql://user:password@db.example/release`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nAuthorization: token ${'a'.repeat(24)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nX-API-Key: ${'a'.repeat(24)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nPrivate-Token: ${'a'.repeat(24)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nxoxb-${'a'.repeat(24)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nAKIA${'A'.repeat(16)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nAIza${'a'.repeat(32)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nglpat-${'a'.repeat(24)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nnpm_${'a'.repeat(24)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\npypi-${'a'.repeat(24)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nsk_live_${'a'.repeat(24)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nAWS_SECRET_ACCESS_KEY=${'a'.repeat(32)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\n_authToken=${'a'.repeat(24)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\ndesktop-pairing-project.${'a'.repeat(24)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\ndesktop-token-${'a'.repeat(24)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\neyJ${'a'.repeat(16)}.${'b'.repeat(16)}.${'c'.repeat(16)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nsk-${'a'.repeat(24)}`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nhttps://user:password@example.com/result`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\ndiff --git a/secret.ts b/secret.ts\n@@ -1 +1 @@`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\n  diff --git a/secret.ts b/secret.ts\n  @@ -1 +1 @@`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\n/Users/alice/private/release.log`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\n/opt/devflow/release.log`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\n/workspace/devflow/release.log`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\n/Volumes/build/release.log`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\n/root/release.log`,
      `${ready.walkthroughEvidence.referencedEvidenceContent}\nC:\\Users\\alice\\release.log`,
    ]) {
      const items = evaluateReleaseSignoffSnapshot({
        ...ready,
        walkthroughEvidence: {
          ...ready.walkthroughEvidence,
          referencedEvidenceContent: unsafeContent,
        },
      })
      expect(items).toContainEqual(
        expect.objectContaining({ id: 'dated-walkthrough', state: 'attention' }),
      )
      expect(formatReleaseSignoffItems(items)).not.toContain(unsafeContent)
    }
  })

  it('binds the dated v1.5 walkthrough to exact schema, delivery, and evidence identities', () => {
    const ready = snapshot({ targetVersion: '1.5.0' })
    const content = ready.walkthroughEvidence.referencedEvidenceContent!

    for (const requiredIdentity of [
      'Team schema v14',
      'Desktop schema v17',
      ready.githubSandboxRecord!.value!.deliverySeriesKey as string,
      ready.githubSandboxRecord!.value!.intentDigest as string,
      ready.githubSandboxRecord!.value!.testEvidenceDigest as string,
      ready.githubSandboxRecord!.value!.prPackageDigest as string,
      ready.githubSandboxRecord!.value!.expectedCommitSha as string,
      'Operator role: non-maintainer',
      'Ad hoc maintainer assistance: false',
      `Packaged artifact: 1.5.0 darwin-arm64 ${desktopArtifactSha}`,
      `Expected commit: ${ready.githubSandboxRecord!.value!.expectedCommitSha as string}; remote head: ${ready.githubSandboxRecord!.value!.remoteHeadSha as string}.`,
      `Revocation proof: state version 2; intent ${revocationIntentId}; revoked binding version 2; outcome binding_inactive; checked at ${revocationCheckedAt}; durable check count 1.`,
    ]) {
      const items = evaluateReleaseSignoffSnapshot({
        ...ready,
        walkthroughEvidence: {
          ...ready.walkthroughEvidence,
          referencedEvidenceContent: content.replaceAll(requiredIdentity, 'missing'),
        },
      })
      expect(items).toContainEqual(
        expect.objectContaining({ id: 'dated-walkthrough', state: 'attention' }),
      )
    }

    for (const requiredStatement of [
      'Lifecycle counts:',
      'Sandbox/App:',
      'Draft state: true',
      'Restart side-effect repeats:',
      'Revocation proof:',
    ]) {
      const items = evaluateReleaseSignoffSnapshot({
        ...ready,
        walkthroughEvidence: {
          ...ready.walkthroughEvidence,
          referencedEvidenceContent: content
            .split('\n')
            .filter((line) => !line.startsWith(requiredStatement))
            .join('\n'),
        },
      })
      expect(items).toContainEqual(
        expect.objectContaining({ id: 'dated-walkthrough', state: 'attention' }),
      )
    }

    for (const ambiguousCount of [
      content.replace('Delivery attempt: 1;', 'Delivery attempt: 10;'),
      content.replace('intent revision: 1.', 'intent revision: 10.'),
      content.replace('Work Request 1,', 'Work Request 10,'),
      content.replace('credential grant 1,', 'credential grant 10,'),
      content.replace('durable check count 1.', 'durable check count 10.'),
    ]) {
      const items = evaluateReleaseSignoffSnapshot({
        ...ready,
        walkthroughEvidence: {
          ...ready.walkthroughEvidence,
          referencedEvidenceContent: ambiguousCount,
        },
      })
      expect(items).toContainEqual(
        expect.objectContaining({ id: 'dated-walkthrough', state: 'attention' }),
      )
    }
  })

  it('rejects secret-bearing fields and local absolute paths in every v1.5 evidence record', () => {
    const ready = snapshot({ targetVersion: '1.5.0' })
    const cases: Array<Partial<ReleaseSignoffSnapshot>> = [
      {
        walkthroughEvidence: record(ready.walkthroughEvidence.path, {
          ...ready.walkthroughEvidence.value,
          nested: { authorization: 'must-not-be-recorded' },
        }),
      },
      {
        requiredGateRecord: record(ready.requiredGateRecord.path, {
          ...ready.requiredGateRecord.value,
          diagnosticPath: '/Users/alice/private/release.log',
        }),
      },
      {
        githubSandboxRecord: record(ready.githubSandboxRecord!.path, {
          ...ready.githubSandboxRecord!.value,
          notes: 'file:///private/tmp/release-output',
        }),
      },
    ]

    for (const overrides of cases) {
      const items = evaluateReleaseSignoffSnapshot({ ...ready, ...overrides })
      expect(
        items.some(
          (item) =>
            ['dated-walkthrough', 'required-gates', 'github-sandbox'].includes(item.id) &&
            item.state === 'attention',
        ),
      ).toBe(true)
    }
  })

  it('requires exact approval, Draft, Acceptance, recovery, and cleanup outcomes', () => {
    for (const invalidOutcome of [
      { draft: false },
      { merged: true },
      { approvalRole: 'member' },
      { approvalAuthKind: 'desktop_bearer' },
      { automaticRetry: true },
      { acceptanceStatus: 'building' },
      { restartRecovery: 'failed' },
      { redactionCheck: 'failed' },
      { cleanup: 'failed' },
      { cleanupMethod: 'remote-branch-deletion' },
      { operatorRole: 'maintainer' },
      { adHocMaintainerAssistance: true },
    ]) {
      const items = evaluateReleaseSignoffSnapshot(
        v15SnapshotWithSandbox(invalidOutcome),
      )

      expect(items).toContainEqual(
        expect.objectContaining({
          id: 'github-sandbox',
          state: 'attention',
          detail: expect.stringContaining('approved Draft and completed lifecycle'),
        }),
      )
    }
  })

  it('whitelists only v1.5 walkthrough, gates, sandbox, and dated-result files in C..S', () => {
    const ready = snapshot({ targetVersion: '1.5.0' })
    const withPaidOpenCode = evaluateReleaseSignoffSnapshot({
      ...ready,
      changedFilesFromCandidate: [
        ...ready.changedFilesFromCandidate!,
        'docs/releases/v1.5.0/real-opencode.json',
      ],
    })
    const withoutSandbox = evaluateReleaseSignoffSnapshot({
      ...ready,
      changedFilesFromCandidate: ready.changedFilesFromCandidate!.filter(
        (path) => path !== 'docs/releases/v1.5.0/github-sandbox.json',
      ),
    })

    for (const items of [withPaidOpenCode, withoutSandbox]) {
      expect(items).toContainEqual(
        expect.objectContaining({ id: 'signoff-contents', state: 'attention' }),
      )
    }
  })

  it('does not let relocated v1.5 records redefine the C..S whitelist', () => {
    const ready = snapshot({ targetVersion: '1.5.0' })

    for (const [recordKey, originalPath] of [
      ['walkthroughEvidence', ready.walkthroughEvidence.path],
      ['requiredGateRecord', ready.requiredGateRecord.path],
      ['githubSandboxRecord', ready.githubSandboxRecord!.path],
    ] as const) {
      const relocatedPath = `tmp/${originalPath.split('/').at(-1)}`
      const relocatedRecord = {
        ...ready[recordKey]!,
        path: relocatedPath,
      }
      const items = evaluateReleaseSignoffSnapshot({
        ...ready,
        [recordKey]: relocatedRecord,
        changedFilesFromCandidate: ready.changedFilesFromCandidate!.map((path) =>
          path === originalPath ? relocatedPath : path,
        ),
      })

      expect(items).toContainEqual(
        expect.objectContaining({ id: 'signoff-contents', state: 'attention' }),
      )
    }
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
    expect(releaseProfileFor('1.6.0')).toBeNull()

    const items = evaluateReleaseSignoffSnapshot(snapshot({ targetVersion: '1.6.0' }))

    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'release-profile',
        state: 'attention',
        detail: expect.stringContaining('1.6.0'),
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
        releaseTagObjectType: 'tag',
      }),
    )
    const lightweightTagItems = evaluateReleaseSignoffSnapshot(
      snapshot({
        mode: 'tagged',
        releaseTagExists: true,
        releaseTagTarget: signoffSha,
        releaseTagObjectType: 'commit',
      }),
    )
    const readyItems = evaluateReleaseSignoffSnapshot(
      snapshot({
        mode: 'tagged',
        releaseTagExists: true,
        releaseTagTarget: signoffSha,
        releaseTagObjectType: 'tag',
      }),
    )

    expect(missingTagItems).toContainEqual(
      expect.objectContaining({ id: 'release-tag', state: 'attention' }),
    )
    expect(wrongTargetItems).toContainEqual(
      expect.objectContaining({ id: 'release-tag', state: 'attention' }),
    )
    expect(lightweightTagItems).toContainEqual(
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

  it('does not echo an untrusted evidence value while rejecting its release binding', () => {
    const sentinel = `ghs_${'z'.repeat(24)}`
    const ready = snapshot({ targetVersion: '1.5.0' })
    const items = evaluateReleaseSignoffSnapshot({
      ...ready,
      walkthroughEvidence: {
        ...ready.walkthroughEvidence,
        value: { ...ready.walkthroughEvidence.value, targetVersion: sentinel },
      },
    })

    expect(items).toContainEqual(
      expect.objectContaining({ id: 'dated-walkthrough', state: 'attention' }),
    )
    expect(formatReleaseSignoffItems(items)).not.toContain(sentinel)
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
