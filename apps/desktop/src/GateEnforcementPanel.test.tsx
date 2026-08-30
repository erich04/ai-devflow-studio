import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GateEnforcementDecision, RemediationPlan } from '@ai-devflow/shared'
import { GateEnforcementPanel, GateRemediationPanel } from './GateEnforcementPanel'

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
  it('submits only the lead override reason', () => {
    const onSaveOverride = vi.fn()

    render(
      <GateEnforcementPanel
        policySnapshot={null}
        decision={decision}
        overrides={[]}
        isLoading={false}
        canSaveOverride
        onSaveOverride={onSaveOverride}
      />,
    )

    fireEvent.change(screen.getByLabelText('Lead override reason'), {
      target: { value: 'Reviewed the canonical blocking evidence.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save lead override' }))

    expect(onSaveOverride).toHaveBeenCalledWith('Reviewed the canonical blocking evidence.')
  })

  it('uses human language for the verdict, approval impact, cause, and one next step', () => {
    render(
      <GateEnforcementPanel
        policySnapshot={null}
        decision={decision}
        overrides={[]}
        isLoading={false}
        canSaveOverride={false}
        onSaveOverride={vi.fn()}
      />,
    )

    expect(screen.getByTestId('gate-enforcement-summary')).toHaveTextContent('存在 1 项阻断')
    expect(screen.getByTestId('gate-enforcement-summary')).toHaveTextContent('阻断审批')
    expect(screen.getByTestId('gate-enforcement-summary')).toHaveTextContent('知识治理条件未满足')
    expect(screen.getByTestId('gate-enforcement-summary')).toHaveTextContent('Fix the API response shape before approving.')
    expect(screen.getAllByTestId('enforcement-finding')).toHaveLength(1)
    expect(screen.getByTestId('gate-technical-details')).not.toHaveAttribute('open')
    expect(screen.getByText('api_contract:violated')).toBeInTheDocument()
  })

  it('renders a textual pass state without relying on color', () => {
    render(
      <GateEnforcementPanel
        policySnapshot={null}
        decision={{
          ...decision,
          status: 'pass',
          blocksApproval: false,
          blockingReasons: [],
          canOverride: false,
          requiredActions: [],
        }}
        overrides={[]}
        isLoading={false}
        canSaveOverride={false}
        onSaveOverride={vi.fn()}
      />,
    )

    expect(screen.getByTestId('gate-enforcement-summary')).toHaveTextContent('Gate Enforcement 已通过')
    expect(screen.getByTestId('gate-enforcement-summary')).toHaveTextContent('可继续审批')
    expect(screen.getByText('没有 Enforcement 警告或阻断项。')).toBeInTheDocument()
  })

  it('keeps remediation actions in the dedicated action-only panel', () => {
    const onStartRetry = vi.fn()

    render(
      <GateRemediationPanel
        decision={decision}
        remediationPlan={remediationPlan}
        isLoading={false}
        pairingState="paired"
        isStartingRetry={false}
        isInspectorWriteBlocked={false}
        onSyncTeam={vi.fn()}
        onRunKnowledgeReview={vi.fn()}
        onStartRetry={onStartRetry}
      />,
    )

    expect(screen.getByText('Remediation · 处理动作')).toBeInTheDocument()
    expect(screen.getByText('Fix API contract violation')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Retry Coding/ }))

    expect(onStartRetry).toHaveBeenCalledWith('candidate-api')
  })

  it('routes a missing review remediation to the review action', () => {
    const onRunKnowledgeReview = vi.fn()
    const reviewPlan: RemediationPlan = {
      ...remediationPlan,
      candidates: [{
        ...remediationPlan.candidates[0]!,
        id: 'candidate-review',
        kind: 'run_agent_review',
        title: '运行门禁审查',
        eligibleForCodingRetry: false,
      }],
    }

    render(
      <GateRemediationPanel
        decision={decision}
        remediationPlan={reviewPlan}
        isLoading={false}
        pairingState="paired"
        isStartingRetry={false}
        isInspectorWriteBlocked={false}
        onSyncTeam={vi.fn()}
        onRunKnowledgeReview={onRunKnowledgeReview}
        onStartRetry={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '运行门禁审查' }))
    expect(onRunKnowledgeReview).toHaveBeenCalledOnce()
  })
})
