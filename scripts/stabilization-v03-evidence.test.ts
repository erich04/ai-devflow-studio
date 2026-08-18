import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const evidencePath = 'docs/releases/stabilization-v0.3-2026-08-17/verification.json'
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as Record<string, unknown>

describe('Stabilization V0.3 acceptance evidence', () => {
  it('binds the accepted implementation candidate to the current durable schemas', () => {
    expect(evidence).toMatchObject({
      schemaVersion: 1,
      plan: 'stabilization-v0.3',
      status: 'passed',
      implementationCandidateSha: '1cb0482a9afe157c4e1dcdd7ae4e8026939f2b9d',
      schemas: {
        team: 19,
        desktop: 32,
      },
    })
  })

  it('records one complete, sealed, zero-finding standard security scan', () => {
    expect(evidence.securityScan).toEqual({
      scanId: '026f692b-780a-4ba8-b726-26e8bb12c789',
      status: 'completed',
      coverage: 'complete',
      reviewedSurfaces: 8,
      findings: 0,
      deferred: 0,
      openQuestions: 0,
      warnings: 0,
      targetRevision: evidence.implementationCandidateSha,
      sealedAt: '2026-08-18T04:14:24.603160Z',
      manifestSha256: '8103c8f5d577cf3171452801bf2191433d76f9ae3a1a8930dbe1656a907d0786',
      findingsSha256: 'afe5f238b35781c3d8d98b929a9207d6dc48675e6f2ab2565507238740b94793',
      coverageSha256: '541aafa1e887950d682c61f859dd1913d62c35e16ad3258425513f0d1527b291',
      reportSha256: '7b3e96cf26d7b4d32c4cb3bba13d0671e9dbf626593d55143dd1b269c89abe32',
    })
  })

  it('records every required final gate as passed', () => {
    const gates = evidence.gates as Array<Record<string, unknown>>
    expect(gates).toHaveLength(16)
    expect(gates.every(({ status }) => status === 'passed')).toBe(true)
    expect(gates[0]).toEqual({
      command: 'corepack pnpm verify',
      status: 'passed',
      testFiles: 222,
      tests: 3108,
    })
    expect(gates.map(({ command }) => command)).toEqual([
      'corepack pnpm verify',
      'corepack pnpm build',
      'corepack pnpm test:v15-github-delivery',
      'corepack pnpm test:v20-agent-runtime-evaluator',
      'corepack pnpm v20:completion-status',
      'corepack pnpm test:v21-retrieval-memory-evaluator',
      'corepack pnpm v21:completion-status',
      'corepack pnpm test:v22-multi-agent-evaluator',
      'corepack pnpm v22:completion-status',
      'corepack pnpm test:postgres-smoke',
      'corepack pnpm test:docker-smoke',
      'corepack pnpm test:docker-lifecycle-smoke',
      'corepack pnpm build:desktop-pilot',
      'corepack pnpm test:desktop-pilot-smoke',
      'DEVFLOW_PACKAGED_SMOKE_NETWORK_MODE=offline corepack pnpm test:v15-github-delivery-packaged-smoke',
      'node scripts/desktop-artifact-trio.mjs verify <exclusive-index> --exclusive',
    ])
  })

  it('locks the reproducible Desktop artifact and zero-duplicate packaged outcome', () => {
    expect(evidence.desktopArtifact).toEqual({
      productVersion: '1.5.0',
      electronVersion: '33.4.11',
      platform: 'darwin',
      arch: 'arm64',
      archive: 'ai-devflow-studio-desktop-1.5.0-darwin-arm64.tar.gz',
      archiveSha256: '893d13f0d6b8f9ea38b38df56adefaf27b40b226e9490f5d465e692d9898d038',
      archiveSizeBytes: 103_961_220,
      signed: false,
      installer: false,
      exclusiveTrioVerified: true,
    })
    expect(evidence.packagedDelivery).toMatchObject({
      branchPublication: 'exact-non-force-once',
      draftPullRequests: 1,
      restartDuplicateEffects: 0,
      coordinationRestartDuplicateEffects: 0,
      durableSecretLeaks: 0,
    })
  })

  it('records complete disposable-resource cleanup', () => {
    expect(Object.values(evidence.cleanup as Record<string, unknown>).every(Boolean)).toBe(true)
  })
})
