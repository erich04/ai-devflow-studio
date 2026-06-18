import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GateEnforcementDecision, RemediationPlan } from '@ai-devflow/shared'
import { GateEnforcementPanel } from './GateEnforcementPanel'

const decision: GateEnforcementDecision = {
  status: 'blocked',
  blocksApproval: true,
  blockingReasons: [
    {
      id: 'governance_check:api_contract:violated:check-api',
      target: 'governance_check',
      sourceId: 'check-api',
      ruleKey: 'api_contract:violated',
      action: 'block',
      summary: 'API contract check is violated.',
      remediation: 'Fix the API response shape before approving.',
    },
  ],
  warningReasons: [],
  requiredActions: ['Fix the API response shape before approving.'],
  canOverride: true,
  overrideRoleRequired: 'lead',
  policySource: 'remote_cache',
  policyVersion: 7,
  provisional: false,
}

const remediationPlan: RemediationPlan = {
  id: 'remediation-run-1-node-build-7',
  runId: 'run-1',
  nodeId: 'node-build',
  status: 'blocked',
  policyVersion: 7,
  blockingReasonIds: ['governance_check:api_contract:violated:check-api'],
  warningReasonIds: [],
  remainingEvidenceGaps: [],
  candidates: [
    {
      id: 'candidate-api',
      kind: 'fix_api_contract',
      title: 'Fix API contract violation',
      summary: 'Update the implementation to match the documented API response.',
      priority: 'high',
      sourceReasonIds: ['governance_check:api_contract:violated:check-api'],
      governanceCheckIds: ['check-api'],
      agentFindingIds: [],
      evidenceIds: [],
      knowledgeReferenceIds: ['knowledge-ref-api'],
      requiresHumanApproval: true,
      eligibleForCodingRetry: true,
    },
  ],
  createdAt: '2026-06-18T10:08:00.000Z',
}

describe('GateEnforcementPanel', () => {
  it('renders remediation candidates and starts a human-approved coding retry', () => {
    const onStartRetry = vi.fn()

    render(
      <GateEnforcementPanel
        policySnapshot={null}
        decision={decision}
        overrides={[]}
        remediationPlan={remediationPlan}
        isLoading={false}
        canSaveOverride={false}
        onSaveOverride={vi.fn()}
        onStartRetry={onStartRetry}
      />,
    )

    expect(screen.getByText('Remediation Plan')).toBeInTheDocument()
    expect(screen.getByText('Fix API contract violation')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Retry Coding/ }))

    expect(onStartRetry).toHaveBeenCalledWith('candidate-api')
  })
})
