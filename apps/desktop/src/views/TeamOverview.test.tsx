import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  createRecommendedEnforcementPreset,
  resolveEffectivePolicy,
  type EffectiveEnforcementRule,
  type GateEnforcementDecision,
  type PolicySnapshot,
} from '@ai-devflow/shared'
import { members as fixtureMembers, projects as fixtureProjects, runs as fixtureRuns } from '@ai-devflow/shared/fixtures'
import { formatLocalTime } from '../app/desktop-view-model'
import { TeamOverview } from './TeamOverview'

const run = fixtureRuns[0]!
const syncedAt = '2026-09-10T12:00:00.000Z'
const effectivePolicy = resolveEffectivePolicy(createRecommendedEnforcementPreset({ organizationId: 'org-demo' }), null)
const unknownRule: EffectiveEnforcementRule = {
  ...effectivePolicy.rules[1]!,
  ruleKey: 'governance_check:testing_standard:needs_evidence_9',
  statusOrSeverity: 'needs_evidence_9',
}
const policySnapshot: PolicySnapshot = {
  projectId: run.projectId,
  organizationPolicy: null,
  projectOverride: null,
  effectivePolicy: { ...effectivePolicy, version: 3, rules: [...effectivePolicy.rules, unknownRule] },
  version: 3,
  updatedAt: syncedAt,
  syncedAt,
  source: 'remote_cache',
}
const decision: GateEnforcementDecision = {
  status: 'blocked',
  blocksApproval: true,
  blockingReasons: [{
    id: 'missing_agent_review:protected_gate:missing',
    target: 'missing_agent_review',
    ruleKey: 'missing_agent_review:protected_gate:missing',
    action: 'block',
    summary: '此受保护 Gate 尚未运行基于知识的门禁审查。',
  }],
  warningReasons: [],
  requiredActions: ['运行门禁审查'],
  canOverride: true,
  overrideRoleRequired: 'lead',
  policySource: 'remote_cache',
  policyVersion: 3,
  provisional: false,
}

function renderTeam(overrides: Partial<Parameters<typeof TeamOverview>[0]> = {}) {
  const props: Parameters<typeof TeamOverview>[0] = {
    projects: [fixtureProjects[0]!],
    members: fixtureMembers,
    projectRollups: [],
    memberRollups: [],
    totalCost: '$0.00',
    dataOrigin: 'remote',
    runtimeDataSource: {
      status: 'real IPC/API',
      label: 'remote snapshot + local merge',
      detail: '1 local runs and 0 remote runs are visible after sync.',
      tone: 'accent',
    },
    selectedRun: run,
    policySnapshot,
    gateEnforcementDecision: decision,
    isLoadingGateEnforcement: false,
    onSyncTeam: vi.fn(),
    isSyncingTeam: false,
    syncFeedback: { status: 'success', message: '团队数据已更新 · 策略 v3' },
    ...overrides,
  }
  render(<TeamOverview {...props} />)
  return props
}

function closedDetailsOf(element: HTMLElement): HTMLDetailsElement {
  const details = element.closest('details')
  expect(details, `${element.textContent} is on the first layer`).not.toBeNull()
  expect(details).not.toHaveAttribute('open')
  return details!
}

describe('TeamOverview', () => {
  it('describes policy rules in Chinese and keeps each rule key in 详情', () => {
    renderTeam()

    const matrix = screen.getByLabelText('团队策略规则')
    const rows = within(matrix).getAllByTestId('team-policy-rule')
    expect(rows).toHaveLength(effectivePolicy.rules.length + 1)
    const missingReview = rows[0]!
    expect(missingReview.querySelector('strong')).toHaveTextContent('缺少本阶段要求的 AI 审查')
    expect(missingReview).toHaveTextContent('AI 审查')
    expect(missingReview).toHaveTextContent('阻断审批')
    expect(missingReview).toHaveTextContent('组织策略')
    closedDetailsOf(within(missingReview).getByText('missing_agent_review:protected_gate:missing'))
    expect(rows[1]!.querySelector('strong')).toHaveTextContent('测试规范：缺少证据')

    const unknown = rows.at(-1)!
    expect(unknown.querySelector('strong')).toHaveTextContent('测试规范：待核实')
    closedDetailsOf(within(unknown).getByText('governance_check:testing_standard:needs_evidence_9'))
    expect(unknown).toHaveTextContent('无法识别这条规则')

    for (const row of rows) {
      const firstLayer = row.querySelector('strong')!.textContent!
      expect(firstLayer).not.toContain(':')
      expect(firstLayer).not.toContain('_')
    }
    // The raw key is reachable once 详情 is opened.
    fireEvent.click(within(unknown).getByText('详情'))
    expect(within(unknown).getByText('governance_check:testing_standard:needs_evidence_9')).toBeVisible()
  })

  it('shows local time on the first layer and the ISO value and raw source in 详情', () => {
    renderTeam()

    const source = screen.getByTestId('team-policy-source')
    expect(source).toHaveTextContent(`团队远端缓存 · 策略 v3 · 同步于 ${formatLocalTime(syncedAt)}`)
    closedDetailsOf(within(source).getByText(`remote_cache snapshot v3 · synced ${syncedAt}`))
    for (const element of screen.queryAllByText(new RegExp(syncedAt.replace(/[.]/g, '\\.')))) closedDetailsOf(element)
    expect(screen.getByTestId('team-overview')).toHaveTextContent('snapshot v3')
  })

  it('uses Chinese headers, statuses and accessible names without changing test ids or actions', () => {
    const props = renderTeam()

    const team = screen.getByTestId('team-overview')
    for (const text of ['团队概览', '团队项目策略', '策略快照 · 本机读取', '预算检查', '总费用', '成员 Token 用量', '项目交付健康']) {
      expect(team).toHaveTextContent(text)
    }
    for (const english of ['Team Overview', 'Gate policy matrix', 'Policy Snapshot', 'Budget Guard', 'Total cost', 'Member tokens', 'Selected Run', 'Used by', 'admin config', 'not loaded']) {
      expect(team).not.toHaveTextContent(english)
    }
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '项目', '仓库', '交付状况', '测试命令', '当前或最近任务', 'Gate 状态', 'Gate 汇总', '成员', 'Token 与费用', '数据来源',
    ])
    expect(screen.getByLabelText('团队成员')).toHaveTextContent('Erich')
    expect(screen.queryByLabelText('Team members')).not.toBeInTheDocument()

    const row = screen.getAllByRole('row')[1]!
    expect(within(row).getByText('有风险')).toHaveAttribute('title', 'at_risk')
    expect(within(row).getByText('审批受阻')).toHaveAttribute('title', 'blocked')
    expect(row).toHaveTextContent('缺少本阶段要求的 AI 审查')
    expect(row).toHaveTextContent('1 项阻断 · 0 条建议 · 1 项待处理')
    expect(within(row).getByText('团队远端缓存')).toHaveAttribute('title', 'remote_cache')
    expect(screen.getByText('团队数据与本地数据').getAttribute('title')).toContain('remote snapshot + local merge')
    expect(screen.getByText('团队数据')).toHaveAttribute('title', 'remote')

    expect(screen.getByTestId('team-sync-feedback')).toHaveAttribute('role', 'status')
    fireEvent.click(screen.getByRole('button', { name: '更新团队数据' }))
    expect(props.onSyncTeam).toHaveBeenCalledTimes(1)
  })

  it('keeps an unread policy distinct from unmet conditions and shows Chinese empty states', () => {
    renderTeam({
      projects: [],
      members: [],
      policySnapshot: null,
      gateEnforcementDecision: { ...decision, status: 'blocked_policy_unavailable', blockingReasons: [] },
      syncFeedback: null,
    })

    const team = screen.getByTestId('team-overview')
    expect(team).toHaveTextContent('尚未加载团队项目')
    expect(team).toHaveTextContent('尚未加载团队策略规则')
    expect(team).toHaveTextContent('尚未加载策略快照')
    expect(team).toHaveTextContent('状态待核实 · 团队策略未读取')
    expect(team).not.toHaveTextContent('审批受阻')
    expect(screen.getAllByText('未加载团队成员').length).toBeGreaterThan(0)
  })
})
