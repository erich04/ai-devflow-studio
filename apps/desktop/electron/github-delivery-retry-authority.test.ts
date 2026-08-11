import { describe, expect, it } from 'vitest'
import type {
  GitHubDeliveryIntent,
  GitHubRepositoryBinding,
} from '@ai-devflow/shared'
import type { GitHubDeliveryRequestRecord } from './github-delivery-remote-client'
import {
  GitHubDeliveryRetryAuthorityError,
  assertGitHubDeliveryRetryAuthority,
} from './github-delivery-retry-authority'

const binding: GitHubRepositoryBinding = {
  stateVersion: 1,
  id: 'github-binding-1',
  version: 3,
  organizationId: 'org-1',
  teamProjectId: 'team-project-1',
  installationId: '123456',
  repositoryId: '987654321',
  repository: 'erich04/ai-devflow-studio',
  defaultBranch: 'main',
  status: 'active',
  validatedAt: '2026-08-11T10:00:00.000Z',
  updatedAt: '2026-08-11T10:00:00.000Z',
  redacted: true,
}

function intent(
  overrides: Partial<GitHubDeliveryIntent> = {},
): GitHubDeliveryIntent {
  return {
    stateVersion: 1,
    id: 'delivery-intent-1',
    organizationId: binding.organizationId,
    teamProjectId: binding.teamProjectId,
    localProjectId: 'local-project-1',
    runId: 'run-1',
    runVersion: 4,
    nodeId: 'run-1-pr',
    repositoryBindingId: binding.id,
    repositoryBindingVersion: binding.version,
    installationId: binding.installationId,
    repositoryId: binding.repositoryId,
    codingRunId: 'coding-run-1',
    codingRunCompletedAt: '2026-08-11T10:10:00.000Z',
    workspaceId: 'workspace-1',
    deliverySeriesKey: `github-delivery:${'a'.repeat(64)}`,
    deliveryAttempt: 1,
    repository: binding.repository,
    baseBranch: 'main',
    headBranch: 'devflow/run-1-pr',
    baseCommitSha: '0'.repeat(40),
    expectedCommitSha: '1'.repeat(40),
    diffArtifactId: 'diff-1',
    diffSourceDigest: '2'.repeat(64),
    testEvidenceId: 'test-1',
    testEvidenceCreatedAt: '2026-08-11T10:20:00.000Z',
    testEvidenceDigest: '3'.repeat(64),
    prPackageArtifactId: 'pr-package-1',
    prPackageUpdatedAt: '2026-08-11T10:25:00.000Z',
    prPackageDigest: '4'.repeat(64),
    changedPaths: ['src/delivery.ts'],
    intentDigest: '5'.repeat(64),
    idempotencyKey: `github-delivery:${'6'.repeat(64)}`,
    status: 'failed',
    createdAt: '2026-08-11T10:30:00.000Z',
    updatedAt: '2026-08-11T10:31:00.000Z',
    redacted: true,
    ...overrides,
  }
}

function request(
  source: GitHubDeliveryIntent,
  overrides: Partial<GitHubDeliveryRequestRecord> = {},
): GitHubDeliveryRequestRecord {
  return {
    id: 'delivery-request-1',
    stateVersion: 7,
    intentRevision: 1,
    organizationId: source.organizationId,
    projectId: source.teamProjectId,
    requestedByUserId: 'user-1',
    localIntentId: source.id,
    localProjectId: source.localProjectId,
    runId: source.runId,
    runVersion: source.runVersion,
    nodeId: source.nodeId,
    repositoryBindingId: source.repositoryBindingId,
    repositoryBindingVersion: source.repositoryBindingVersion,
    installationId: source.installationId,
    repositoryId: source.repositoryId,
    repository: source.repository,
    codingRunId: source.codingRunId,
    workspaceId: source.workspaceId,
    diffArtifactId: source.diffArtifactId,
    testEvidenceId: source.testEvidenceId,
    prPackageArtifactId: source.prPackageArtifactId,
    status: source.status,
    outcomeCode: source.status === 'failed' ? 'pull_request_failed' : 'binding_revoked',
    expectedRunVersion: source.runVersion,
    baseBranch: source.baseBranch,
    headBranch: source.headBranch,
    baseCommitSha: source.baseCommitSha,
    expectedCommitSha: source.expectedCommitSha,
    intentDigest: source.intentDigest,
    deliverySeriesKey: source.deliverySeriesKey,
    deliveryAttempt: source.deliveryAttempt,
    logicalIdempotencyKey: source.idempotencyKey,
    diffDigest: source.diffSourceDigest,
    testEvidenceDigest: source.testEvidenceDigest,
    packageDigest: source.prPackageDigest,
    changedPaths: source.changedPaths,
    prTitle: 'Delivery',
    prBody: 'Safe redacted body.',
    expiresAt: '2026-08-12T10:30:00.000Z',
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    redacted: true,
    ...overrides,
  }
}

describe('GitHub Delivery Retry authority', () => {
  it.each(['failed', 'revoked'] as const)(
    'allows a next attempt only when the exact same-series remote request is %s',
    (status) => {
      const source = intent({ status })
      expect(assertGitHubDeliveryRetryAuthority({
        intent: source,
        binding,
        requests: [request(source)],
      })).toBe('next_attempt')
    },
  )

  it.each([
    { name: 'missing', requests: (source: GitHubDeliveryIntent) => [] },
    {
      name: 'still approval-required',
      requests: (source: GitHubDeliveryIntent) => [request(source, {
        status: 'approval_required',
        outcomeCode: null,
      })],
    },
    {
      name: 'authority-mismatched',
      requests: (source: GitHubDeliveryIntent) => [request(source, {
        expectedCommitSha: '9'.repeat(40),
      })],
    },
    {
      name: 'ambiguous',
      requests: (source: GitHubDeliveryIntent) => [
        request(source),
        request(source, { id: 'delivery-request-2' }),
      ],
    },
  ])('fails closed when the same-series remote predecessor is $name', ({ requests }) => {
    const source = intent({ status: 'revoked' })
    expect(() => assertGitHubDeliveryRetryAuthority({
      intent: source,
      binding,
      requests: requests(source),
    })).toThrow(GitHubDeliveryRetryAuthorityError)
  })

  it('allows a rebound repository to start a new series only after proving the old terminal request', () => {
    const source = intent({ status: 'revoked' })
    expect(assertGitHubDeliveryRetryAuthority({
      intent: source,
      binding: { ...binding, id: 'github-binding-2', version: 1 },
      requests: [request(source)],
    })).toBe('new_series')
  })

  it('fails a rebound repository closed when the current claimant cannot see the old terminal request', () => {
    const source = intent({ status: 'revoked' })
    expect(() => assertGitHubDeliveryRetryAuthority({
      intent: source,
      binding: { ...binding, id: 'github-binding-2', version: 1 },
      requests: [],
    })).toThrow(GitHubDeliveryRetryAuthorityError)
  })

  it('fails closed when the current pairing claimant cannot prove the prior terminal request', () => {
    const source = intent({ status: 'failed' })
    expect(() => assertGitHubDeliveryRetryAuthority({
      intent: source,
      binding,
      requests: [],
    })).toThrow(GitHubDeliveryRetryAuthorityError)
  })

  it('rejects local nonterminal state even when a remote terminal is supplied', () => {
    const source = intent({ status: 'recovery_required' })
    expect(() => assertGitHubDeliveryRetryAuthority({
      intent: source,
      binding,
      requests: [request({ ...source, status: 'failed' })],
    })).toThrow(GitHubDeliveryRetryAuthorityError)
  })
})
