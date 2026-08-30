import { describe, expect, it } from 'vitest'
import type {
  GateEnforcementDecision,
  GateEnforcementReason,
  GateOverrideDecision,
  RemediationCandidate,
  RemediationPlan,
} from '@ai-devflow/shared'
import { buildGateRemediationViewModel } from './gate-remediation-view-model'

const reviewReason: GateEnforcementReason = {
  id: 'missing-review',
  target: 'missing_agent_review',
  ruleKey: 'missing_agent_review:protected_gate:missing',
  action: 'warn',
  summary: '当前 Gate 缺少基于知识的门禁审查。',
  remediation: '运行门禁审查后重新评估 Gate。',
}

function decision(overrides: Partial<GateEnforcementDecision> = {}): GateEnforcementDecision {
  return {
    status: 'warn',
    blocksApproval: false,
    blockingReasons: [],
    warningReasons: [reviewReason],
    requiredActions: ['运行门禁审查后重新评估 Gate。'],
    canOverride: false,
    overrideRoleRequired: 'lead',
    policySource: 'built_in_default',
    policyVersion: 3,
    provisional: false,
    ...overrides,
  }
}

function candidate(overrides: Partial<RemediationCandidate> = {}): RemediationCandidate {
  return {
    id: 'candidate-review',
    kind: 'run_agent_review',
    title: '运行门禁审查',
    summary: '运行门禁审查后重新评估 Gate。',
    priority: 'medium',
    sourceReasonIds: [reviewReason.id],
    governanceCheckIds: [],
    agentFindingIds: [],
    evidenceIds: [],
    knowledgeReferenceIds: [],
    requiresHumanApproval: true,
    eligibleForCodingRetry: false,
    ...overrides,
  }
}

function plan(overrides: Partial<RemediationPlan> = {}): RemediationPlan {
  return {
    id: 'remediation-run-gate-3',
    runId: 'run-1',
    nodeId: 'gate-1',
    status: 'warn',
    policyVersion: 3,
    blockingReasonIds: [],
    warningReasonIds: [reviewReason.id],
    remainingEvidenceGaps: [],
    candidates: [candidate()],
    createdAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  }
}

function build(input: {
  decision?: GateEnforcementDecision | null
  remediationPlan?: RemediationPlan | null
  overrides?: GateOverrideDecision[]
  canSaveOverride?: boolean
  isStartingRetry?: boolean
} = {}) {
  return buildGateRemediationViewModel({
    decision: input.decision === undefined ? decision() : input.decision,
    remediationPlan: input.remediationPlan === undefined ? plan() : input.remediationPlan,
    overrides: input.overrides ?? [],
    canSaveOverride: input.canSaveOverride ?? false,
    isStartingRetry: input.isStartingRetry ?? false,
  })
}

describe('Gate remediation view model', () => {
  it('turns the Mini Agent warn-only review gap into one optional controlled action', () => {
    const viewModel = build()

    expect(viewModel.activeItems).toHaveLength(1)
    expect(viewModel.activeItems[0]).toMatchObject({
      title: '运行门禁审查',
      source: 'missing_agent_review',
      severity: 'warning',
      mandatory: false,
      why: reviewReason.summary,
      action: reviewReason.remediation,
      requiredRole: '当前 Run 的执行成员',
      requiredEvidence: '当前 Run/Node 的 Review advisory 与 Knowledge 引用',
      status: 'open',
      statusLabel: '待处理',
      cta: { kind: 'knowledge_review', label: '运行门禁审查' },
    })
  })

  it('keeps known recovery actions controlled when the ephemeral plan is unavailable', () => {
    const policyReason: GateEnforcementReason = {
      id: 'policy-unavailable',
      target: 'governance_check',
      ruleKey: 'policy-unavailable',
      action: 'block',
      summary: 'Team Policy snapshot is unavailable.',
      remediation: 'Sync team policy.',
    }
    const viewModel = build({
      decision: decision({
        status: 'blocked_policy_unavailable',
        blocksApproval: true,
        blockingReasons: [policyReason],
        warningReasons: [],
      }),
      remediationPlan: null,
    })

    expect(viewModel.activeItems).toHaveLength(1)
    expect(viewModel.activeItems[0]).toMatchObject({
      mandatory: true,
      cta: { kind: 'sync_policy', label: '同步团队策略' },
    })
  })

  it('shows a clean pass state without copying successful Gate conditions', () => {
    const viewModel = build({
      decision: decision({ status: 'pass', warningReasons: [], requiredActions: [] }),
      remediationPlan: plan({ status: 'pass', warningReasonIds: [], candidates: [] }),
    })

    expect(viewModel.activeItems).toEqual([])
    expect(viewModel.resolvedItems).toEqual([])
    expect(viewModel.emptyMessage).toBe('当前没有需要整改的事项；Gate 可按现有条件继续。')
  })

  it('marks blocking and hard-blocking items mandatory but keeps hard blocks manual', () => {
    const hardReason = { ...reviewReason, id: 'hard-test', target: 'governance_check' as const, action: 'block' as const }
    const hardDecision = decision({
      status: 'hard_blocked',
      blocksApproval: true,
      blockingReasons: [hardReason],
      warningReasons: [],
    })
    const hardPlan = plan({
      status: 'hard_blocked',
      blockingReasonIds: [hardReason.id],
      warningReasonIds: [],
      candidates: [candidate({
        id: 'candidate-hard',
        kind: 'resolve_hard_block',
        sourceReasonIds: [hardReason.id],
        eligibleForCodingRetry: false,
      })],
    })

    expect(build({ decision: hardDecision, remediationPlan: hardPlan }).activeItems[0]).toMatchObject({
      severity: 'hard_block',
      mandatory: true,
      status: 'open',
      manualGuidance: expect.stringContaining('没有自动修复入口'),
    })
  })

  it.each([
    ['add_test_evidence', 'tests', '去 Tests 处理'],
    ['sync_policy', 'sync_policy', '同步团队策略'],
    ['fix_test_failure', 'retry_coding', 'Retry Coding'],
  ] as const)('maps %s to its controlled CTA', (kind, ctaKind, label) => {
    const blockingReason = { ...reviewReason, action: 'block' as const }
    const viewModel = build({
      decision: decision({
        status: kind === 'sync_policy' ? 'blocked_policy_unavailable' : 'blocked',
        blocksApproval: true,
        blockingReasons: [blockingReason],
        warningReasons: [],
      }),
      remediationPlan: plan({
        status: kind === 'sync_policy' ? 'blocked_policy_unavailable' : 'blocked',
        blockingReasonIds: [blockingReason.id],
        warningReasonIds: [],
        candidates: [candidate({
          kind,
          sourceReasonIds: [blockingReason.id],
          eligibleForCodingRetry: kind === 'fix_test_failure',
        })],
      }),
    })

    expect(viewModel.activeItems[0]?.cta).toEqual({ kind: ctaKind, label })
  })

  it('marks an active Coding retry in progress', () => {
    const retryCandidate = candidate({ kind: 'fix_api_contract', eligibleForCodingRetry: true })
    expect(build({
      remediationPlan: plan({ candidates: [retryCandidate] }),
      isStartingRetry: true,
    }).activeItems[0]).toMatchObject({ status: 'in_progress', statusLabel: '处理中' })
  })

  it('marks old policy plans stale and cleared same-policy items resolved', () => {
    const stale = build({ remediationPlan: plan({ policyVersion: 2 }) })
    expect(stale.activeItems.find((item) => item.status === 'stale')).toMatchObject({
      status: 'stale',
      statusLabel: '已过期',
    })
    expect(stale.activeItems.find((item) => item.status === 'open')).toMatchObject({
      ruleKey: reviewReason.ruleKey,
      cta: { kind: 'knowledge_review' },
    })

    const resolved = build({
      decision: decision({ status: 'pass', warningReasons: [], requiredActions: [] }),
      remediationPlan: plan(),
    })
    expect(resolved.activeItems).toEqual([])
    expect(resolved.resolvedItems[0]).toMatchObject({ status: 'resolved', statusLabel: '已解决' })
  })

  it('keeps overridden facts visible but no longer marks them mandatory', () => {
    const overridden = build({
      decision: decision({
        status: 'overridden',
        blocksApproval: false,
        blockingReasons: [{ ...reviewReason, action: 'block' }],
        warningReasons: [],
        canOverride: true,
      }),
      remediationPlan: plan({
        status: 'overridden',
        blockingReasonIds: [reviewReason.id],
        warningReasonIds: [],
      }),
    })

    expect(overridden.activeItems[0]).toMatchObject({ severity: 'block', mandatory: false, status: 'open' })
  })

  it('exposes Override separately only for an eligible lead and preserves active audit state', () => {
    const activeOverride: GateOverrideDecision = {
      id: 'override-1',
      runId: 'run-1',
      nodeId: 'gate-1',
      projectId: 'project-1',
      userId: 'lead-1',
      role: 'lead',
      reason: 'Reviewed exception.',
      blockedReasonIds: [reviewReason.id],
      policyVersion: 3,
      provisional: false,
      status: 'accepted',
      createdAt: '2026-08-30T00:00:00.000Z',
    }
    const blockedDecision = decision({
      status: 'blocked',
      blocksApproval: true,
      blockingReasons: [{ ...reviewReason, action: 'block' }],
      warningReasons: [],
      canOverride: true,
    })

    expect(build({
      decision: blockedDecision,
      overrides: [activeOverride],
      canSaveOverride: true,
    }).override).toEqual({ active: activeOverride, canOpen: true, requiredRole: 'lead' })
    expect(build({ decision: blockedDecision, canSaveOverride: false }).override.canOpen).toBe(false)
  })
})
