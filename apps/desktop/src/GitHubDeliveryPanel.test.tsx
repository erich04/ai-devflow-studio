import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type {
  GitHubDeliveryIntent,
  GitHubDeliveryOperatorOutcome,
} from '@ai-devflow/shared'
import { GitHubDeliveryPanel } from './GitHubDeliveryPanel'

function intent(
  status: GitHubDeliveryIntent['status'],
  overrides: Partial<GitHubDeliveryIntent> = {},
): GitHubDeliveryIntent {
  return {
    stateVersion: 1,
    id: 'github-delivery-intent-1',
    organizationId: 'org-demo',
    teamProjectId: 'team-project-1',
    localProjectId: 'local-project-1',
    runId: 'run-1',
    runVersion: 12,
    nodeId: 'node-pr',
    repositoryBindingId: 'binding-1',
    repositoryBindingVersion: 4,
    installationId: '12345',
    repositoryId: '98765',
    codingRunId: 'coding-run-1',
    codingRunCompletedAt: '2026-08-11T11:30:00.000Z',
    workspaceId: 'workspace-1',
    deliverySeriesKey: `github-delivery:${'e'.repeat(64)}`,
    deliveryAttempt: 1,
    repository: 'erich/ai-devflow-studio',
    baseBranch: 'main',
    headBranch: 'devflow/run-1',
    baseCommitSha: '1'.repeat(40),
    expectedCommitSha: '2'.repeat(40),
    diffArtifactId: 'diff-1',
    diffSourceDigest: 'a'.repeat(64),
    testEvidenceId: 'test-evidence-1',
    testEvidenceCreatedAt: '2026-08-11T11:45:00.000Z',
    testEvidenceDigest: 'b'.repeat(64),
    prPackageArtifactId: 'artifact-pr-delivery-package',
    prPackageUpdatedAt: '2026-08-11T12:00:00.000Z',
    prPackageDigest: 'c'.repeat(64),
    changedPaths: ['apps/desktop/src/App.tsx'],
    intentDigest: 'd'.repeat(64),
    idempotencyKey: 'github-delivery:v1:fixture',
    status,
    createdAt: '2026-08-11T12:01:00.000Z',
    updatedAt: '2026-08-11T12:02:00.000Z',
    redacted: true,
    ...overrides,
  }
}

describe('GitHubDeliveryPanel', () => {
  it('shows only an exact safe local operator outcome after restart', () => {
    const recoveryIntent = intent('recovery_required')
    const outcome: GitHubDeliveryOperatorOutcome = {
      stateVersion: 1,
      intentId: recoveryIntent.id,
      intentUpdatedAt: recoveryIntent.updatedAt,
      outcomeCode: 'operation_cancelled',
      recordedAt: recoveryIntent.updatedAt,
      redacted: true,
    }
    const { rerender } = render(
      <GitHubDeliveryPanel
        intent={recoveryIntent}
        operatorOutcome={outcome}
        hasExactPrPackage
      />,
    )

    expect(screen.getByTestId('github-delivery-panel')).toHaveTextContent(
      'operation_cancelled',
    )
    rerender(
      <GitHubDeliveryPanel
        intent={{
          ...recoveryIntent,
          updatedAt: '2026-08-11T12:03:00.000Z',
        }}
        operatorOutcome={outcome}
        hasExactPrPackage
      />,
    )
    expect(screen.getByTestId('github-delivery-panel')).not.toHaveTextContent(
      'operation_cancelled',
    )
  })

  it('shows the exact delivery evidence while keeping token and local-path material out', () => {
    render(<GitHubDeliveryPanel intent={intent('approval_required')} hasExactPrPackage />)

    const panel = screen.getByTestId('github-delivery-panel')
    expect(panel).toHaveTextContent('approval_required')
    expect(panel).toHaveTextContent('等待 Web Team Console 的 lead/owner 显式批准')
    expect(panel).toHaveTextContent('erich/ai-devflow-studio')
    expect(panel).toHaveTextContent('main')
    expect(panel).toHaveTextContent('devflow/run-1')
    expect(panel).toHaveTextContent('2'.repeat(40))
    expect(panel).toHaveTextContent('runVersion 12')
    expect(panel).toHaveTextContent(`github-delivery:${'e'.repeat(64)}`)
    expect(panel).toHaveTextContent('attempt 1')
    expect(panel).toHaveTextContent('a'.repeat(64))
    expect(panel).toHaveTextContent('b'.repeat(64))
    expect(panel).toHaveTextContent('c'.repeat(64))
    expect(panel).toHaveTextContent('d'.repeat(64))
    expect(panel).not.toHaveTextContent('installation token')
    expect(panel).not.toHaveTextContent('/Users/erich')
    expect(panel).not.toHaveTextContent('/tmp/')
  })

  it('exposes only the safe Draft PR handoff after completion', () => {
    render(<GitHubDeliveryPanel
      hasExactPrPackage
      intent={intent('completed', {
        completion: {
          stateVersion: 1,
          remoteRequestId: 'delivery-request-1',
          publicationId: 'publication-1',
          pullRequestOutcomeId: 'pull-request-outcome-1',
          pullRequestId: '123456',
          pullRequestNumber: 17,
          pullRequestUrl: 'https://github.com/erich/ai-devflow-studio/pull/17',
          providerCreatedAt: '2026-08-11T12:03:00.000Z',
          recordedAt: '2026-08-11T12:03:01.000Z',
          draft: true,
          redacted: true,
        },
      })}
    />)

    expect(screen.getByText('Draft PR 已创建并记录为交付证据；Workflow 会自动推进到 Acceptance。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Draft PR #17' })).toHaveAttribute(
      'href',
      'https://github.com/erich/ai-devflow-studio/pull/17',
    )
    expect(screen.getByTestId('github-delivery-panel')).not.toHaveTextContent('publication-1')
  })

  it('keeps failed status factual without inferring authorization consumption', () => {
    render(<GitHubDeliveryPanel intent={intent('failed')} hasExactPrPackage />)

    const panel = screen.getByTestId('github-delivery-panel')
    expect(panel).toHaveTextContent('交付已安全停止')
    expect(panel).toHaveTextContent('不会自动重试')
    expect(panel).toHaveTextContent('核对远端记录')
    expect(panel).toHaveTextContent('显式 Retry')
    expect(panel).toHaveTextContent('新的 attempt')
    expect(panel).not.toHaveTextContent(/授权.*消耗/)
  })
})
