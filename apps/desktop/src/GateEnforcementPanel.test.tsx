import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GateEnforcementDecision, GateOverrideDecision, RemediationPlan } from '@ai-devflow/shared'
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

  it('lists the concrete findings without a second verdict or “主要下一步” (plan W6)', () => {
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

    // The task status row is the one conclusion; this panel keeps findings and details only.
    expect(screen.getByText('策略评估详情')).toBeInTheDocument()
    expect(screen.queryByTestId('gate-enforcement-summary')).not.toBeInTheDocument()
    expect(screen.queryByText(/主要下一步|阻断审批|可继续审批/)).not.toBeInTheDocument()
    expect(screen.getAllByTestId('enforcement-finding')).toHaveLength(1)
    expect(screen.getByTestId('enforcement-finding')).toHaveTextContent('知识治理条件未满足')
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

    expect(screen.getByText('没有策略警告或阻断项。')).toBeInTheDocument()
    expect(screen.queryByTestId('gate-enforcement-summary')).not.toBeInTheDocument()
  })

  it('omits recovery steps the task status row already offers (plan W6)', () => {
    render(
      <GateRemediationPanel
        decision={{ ...decision, blockingReasons: [{ ...decision.blockingReasons[0]!, id: 'missing-review', target: 'missing_agent_review', ruleKey: 'require_review' }] }}
        remediationPlan={null}
        overrides={[]}
        isLoading={false}
        canSaveOverride={false}
        pairingState="paired"
        isStartingRetry={false}
        isInspectorWriteBlocked={false}
        hiddenCtaKinds={['knowledge_review']}
        onSyncTeam={vi.fn()}
        onOpenTests={vi.fn()}
        onOpenOverride={vi.fn()}
        onRunKnowledgeReview={vi.fn()}
        onStartRetry={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: '运行门禁审查' })).not.toBeInTheDocument()
  })

  it('keeps remediation actions in the dedicated action-only panel', () => {
    const onStartRetry = vi.fn()

    render(
      <GateRemediationPanel
        decision={decision}
        remediationPlan={remediationPlan}
        overrides={[]}
        isLoading={false}
        canSaveOverride={false}
        pairingState="paired"
        isStartingRetry={false}
        isInspectorWriteBlocked={false}
        onSyncTeam={vi.fn()}
        onOpenTests={vi.fn()}
        onOpenOverride={vi.fn()}
        onRunKnowledgeReview={vi.fn()}
        onStartRetry={onStartRetry}
      />,
    )

    expect(screen.getByText('Remediation · 恢复计划')).toBeInTheDocument()
    expect(screen.getByText('Fix API contract violation')).toBeInTheDocument()
    expect(screen.getByText('阻断')).toBeInTheDocument()
    expect(screen.getByText('必做')).toBeInTheDocument()
    expect(screen.getByText('来源：governance_check · check-api')).toBeInTheDocument()
    expect(screen.getByText('api_contract:violated')).toBeInTheDocument()
    expect(screen.getByText(/负责角色/).parentElement).toHaveTextContent('开发者执行，人工批准 Retry')
    expect(screen.queryByText('Gate Enforcement · 详细结论')).not.toBeInTheDocument()

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
        overrides={[]}
        isLoading={false}
        canSaveOverride={false}
        pairingState="paired"
        isStartingRetry={false}
        isInspectorWriteBlocked={false}
        onSyncTeam={vi.fn()}
        onOpenTests={vi.fn()}
        onOpenOverride={vi.fn()}
        onRunKnowledgeReview={onRunKnowledgeReview}
        onStartRetry={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '运行门禁审查' }))
    expect(onRunKnowledgeReview).toHaveBeenCalledOnce()
  })

  it('routes Test Evidence to the existing Tests surface', () => {
    const onOpenTests = vi.fn()
    render(
      <GateRemediationPanel
        decision={decision}
        remediationPlan={{
          ...remediationPlan,
          candidates: [{
            ...remediationPlan.candidates[0]!,
            id: 'candidate-test',
            kind: 'add_test_evidence',
            title: 'Attach passing test evidence',
            eligibleForCodingRetry: false,
          }],
        }}
        overrides={[]}
        isLoading={false}
        canSaveOverride={false}
        pairingState="paired"
        isStartingRetry={false}
        isInspectorWriteBlocked={false}
        onSyncTeam={vi.fn()}
        onOpenTests={onOpenTests}
        onOpenOverride={vi.fn()}
        onRunKnowledgeReview={vi.fn()}
        onStartRetry={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '查看测试步骤' }))
    expect(onOpenTests).toHaveBeenCalledOnce()
  })

  it('keeps unavailable policy recovery explicit when Team is not paired', () => {
    render(
      <GateRemediationPanel
        decision={{
          ...decision,
          status: 'blocked_policy_unavailable',
          canOverride: false,
          blockingReasons: [{
            id: 'policy-unavailable',
            target: 'governance_check',
            ruleKey: 'policy-unavailable',
            action: 'block',
            summary: 'Team Policy snapshot is unavailable.',
          }],
        }}
        remediationPlan={null}
        overrides={[]}
        isLoading={false}
        canSaveOverride={false}
        pairingState="unpaired"
        isStartingRetry={false}
        isInspectorWriteBlocked={false}
        onSyncTeam={vi.fn()}
        onOpenTests={vi.fn()}
        onOpenOverride={vi.fn()}
        onRunKnowledgeReview={vi.fn()}
        onStartRetry={vi.fn()}
      />,
    )

    expect(screen.getByText('先绑定 Team Project，再同步团队策略。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '同步团队策略' })).not.toBeInTheDocument()
  })

  it('shows Override as a separately authorized path with its audit reason', () => {
    const onOpenOverride = vi.fn()
    const override: GateOverrideDecision = {
      id: 'override-1',
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      userId: 'lead-1',
      role: 'lead',
      reason: 'Approved temporary exception.',
      blockedReasonIds: decision.blockingReasons.map((reason) => reason.id),
      policyVersion: decision.policyVersion,
      provisional: false,
      status: 'accepted',
      createdAt: '2026-08-30T00:00:00.000Z',
    }
    render(
      <GateRemediationPanel
        decision={decision}
        remediationPlan={remediationPlan}
        overrides={[override]}
        isLoading={false}
        canSaveOverride
        pairingState="paired"
        isStartingRetry={false}
        isInspectorWriteBlocked={false}
        onSyncTeam={vi.fn()}
        onOpenTests={vi.fn()}
        onOpenOverride={onOpenOverride}
        onRunKnowledgeReview={vi.fn()}
        onStartRetry={vi.fn()}
      />,
    )

    expect(screen.getByTestId('remediation-override')).toHaveTextContent('治理例外（非整改）')
    expect(screen.getByTestId('remediation-override')).toHaveTextContent('Approved temporary exception.')
    fireEvent.click(screen.getByRole('button', { name: '前往独立 Lead Override' }))
    expect(onOpenOverride).toHaveBeenCalledOnce()
  })

  it('shows an empty recovery state when the current decision passes', () => {
    render(
      <GateRemediationPanel
        decision={{ ...decision, status: 'pass', blocksApproval: false, blockingReasons: [], requiredActions: [] }}
        remediationPlan={{ ...remediationPlan, status: 'pass', blockingReasonIds: [], candidates: [] }}
        overrides={[]}
        isLoading={false}
        canSaveOverride={false}
        pairingState="paired"
        isStartingRetry={false}
        isInspectorWriteBlocked={false}
        onSyncTeam={vi.fn()}
        onOpenTests={vi.fn()}
        onOpenOverride={vi.fn()}
        onRunKnowledgeReview={vi.fn()}
        onStartRetry={vi.fn()}
      />,
    )

    expect(screen.getByText('当前没有需要整改的事项；Gate 可按现有条件继续。')).toBeInTheDocument()
  })
})
