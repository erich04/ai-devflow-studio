import type {
  AgentPolicyFindingCategory,
  AgentPolicyFindingSeverity,
  DataOrigin,
  EffectiveEnforcementRule,
  EnforcementAction,
  EnforcementTarget,
  KnowledgeGovernanceStatus,
  PolicySnapshotSource,
  Project,
  Role,
} from '@ai-devflow/shared'
import { knownKnowledgeCategoryLabel } from './knowledge-view-copy'

/**
 * First-layer Chinese copy for the team page (plan §6.3, Y9). Rule keys, sources and statuses are
 * stored values; the page keeps them in a 详情 disclosure or a title attribute.
 */

export type EnforcementRuleDescription = {
  /** Chinese reason, e.g. “缺少本阶段要求的 AI 审查”; “待核实” when the rule is not recognised. */
  label: string
  recognized: boolean
}

const governanceStatusLabels: Record<KnowledgeGovernanceStatus, string> = {
  satisfied: '已满足',
  needs_evidence: '缺少证据',
  violated: '不符合',
}

const findingCategoryLabels: Record<AgentPolicyFindingCategory, string> = {
  missing_evidence: '缺少证据',
  test_risk: '测试风险',
  api_contract_risk: '接口契约风险',
  security_risk: '安全风险',
  review_gap: '审查遗漏',
}

const findingSeverityLabels: Record<AgentPolicyFindingSeverity, string> = {
  low: '低',
  medium: '中',
  high: '高',
}

/**
 * Accepts both a policy rule (with `category` and `statusOrSeverity`) and a Gate reason (only
 * `ruleKey` and `target`); missing parts are read from `target:category:status` in the key.
 */
export function describeEnforcementRule(rule: {
  ruleKey: string
  target?: string | undefined
  category?: string | undefined
  statusOrSeverity?: string | undefined
}): EnforcementRuleDescription {
  if (rule.ruleKey === 'policy-unavailable') return { label: '团队策略尚未同步', recognized: true }

  const segments = rule.ruleKey.split(':')
  const target = rule.target ?? segments[0]
  if (segments[0] === target) segments.shift()
  const category = rule.category ?? segments[0]
  const status = rule.statusOrSeverity ?? (segments.length > 1 ? segments.slice(1).join(':') : undefined)

  if (target === 'missing_agent_review') {
    return category === 'protected_gate' && status === 'missing'
      ? { label: '缺少本阶段要求的 AI 审查', recognized: true }
      : { label: 'AI 审查规则待核实', recognized: false }
  }
  if (target === 'governance_check') {
    const categoryLabel = knownKnowledgeCategoryLabel(category)
    const statusLabel = status ? governanceStatusLabels[status as KnowledgeGovernanceStatus] : undefined
    if (categoryLabel && statusLabel) return { label: `${categoryLabel}：${statusLabel}`, recognized: true }
    return { label: categoryLabel ? `${categoryLabel}：待核实` : '规范检查待核实', recognized: false }
  }
  if (target === 'agent_finding') {
    const categoryLabel = category ? findingCategoryLabels[category as AgentPolicyFindingCategory] : undefined
    const severityLabel = status ? findingSeverityLabels[status as AgentPolicyFindingSeverity] : undefined
    if (categoryLabel && severityLabel) {
      return { label: `AI 审查发现：${categoryLabel}（${severityLabel}）`, recognized: true }
    }
    return { label: categoryLabel ? `AI 审查发现：${categoryLabel}（待核实）` : 'AI 审查发现待核实', recognized: false }
  }
  return { label: '规则待核实', recognized: false }
}

const targetLabels: Record<EnforcementTarget, string> = {
  governance_check: '规范检查',
  agent_finding: 'AI 审查发现',
  missing_agent_review: 'AI 审查',
}

export function enforcementTargetLabel(target: string): string {
  return targetLabels[target as EnforcementTarget] ?? '待核实'
}

const actionLabels: Record<EnforcementAction, string> = {
  block: '阻断审批',
  warn: '仅提醒',
  ignore: '不检查',
}

export function enforcementActionLabel(action: string): string {
  return actionLabels[action as EnforcementAction] ?? '待核实'
}

const ruleSourceLabels: Record<EffectiveEnforcementRule['source'], string> = {
  organization: '组织策略',
  project_override: '项目调整',
  project_clamped: '项目调整（受组织下限约束）',
}

export function enforcementRuleSourceLabel(source: string): string {
  return ruleSourceLabels[source as EffectiveEnforcementRule['source']] ?? '待核实'
}

const policySourceLabels: Record<PolicySnapshotSource, string> = {
  remote_cache: '团队远端缓存',
  built_in_default: '内置默认策略',
  unavailable: '不可用',
}

export function policySourceLabel(source: string): string {
  return policySourceLabels[source as PolicySnapshotSource] ?? '来源待核实'
}

/**
 * Gate evaluation status for the selected team project. `warn` counts suggestions, the blocked
 * states say approval is held; “策略未读取” stays distinct from “条件不满足” (plan §6.3).
 */
export function gateSnapshotStatusLabel(status: string, counts: { warnings: number }): string {
  switch (status) {
    case 'loading':
      return '正在读取'
    case 'pass':
      return '条件已满足'
    case 'warn':
      return counts.warnings > 0 ? `有 ${counts.warnings} 条建议` : '有建议'
    case 'blocked':
      return '审批受阻'
    case 'hard_blocked':
      return '审批受阻 · 不可例外'
    case 'overridden':
      return '已按例外处理'
    case 'blocked_policy_unavailable':
      return '状态待核实 · 团队策略未读取'
    case 'loaded':
      return '策略已加载'
    case 'not loaded':
      return '尚未加载'
    default:
      return '状态待核实'
  }
}

const healthLabels: Record<Project['health'], string> = {
  on_track: '正常',
  at_risk: '有风险',
  blocked: '受阻',
}

export function projectHealthLabel(health: string): string {
  return healthLabels[health as Project['health']] ?? '待核实'
}

const dataOriginLabels: Record<DataOrigin, string> = {
  seed: '示例数据',
  local: '本地数据',
  remote: '团队数据',
  adapter: '适配数据',
}

export function dataOriginLabel(origin: string): string {
  return dataOriginLabels[origin as DataOrigin] ?? '来源待核实'
}

/** Labels produced by `buildRuntimeDataSource` (desktop-view-model.ts). */
const runtimeSourceLabels: Record<string, string> = {
  'browser preview': '浏览器预览',
  'loading local IPC': '正在读取本地数据',
  'local SQLite empty': '本地暂无任务',
  'local SQLite': '本地数据',
  'remote snapshot + local merge': '团队数据与本地数据',
  'desktop adapter': '桌面适配数据',
  'not loaded': '尚未加载',
}

export function runtimeSourceLabel(label: string): string {
  return runtimeSourceLabels[label] ?? '数据来源待核实'
}

const roleLabels: Record<Role, string> = {
  owner: 'Owner',
  lead: 'Lead',
  member: '成员',
}

export function teamRoleLabel(role: string): string {
  return roleLabels[role as Role] ?? '角色待核实'
}
