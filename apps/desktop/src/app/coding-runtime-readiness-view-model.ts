import type {
  CodingRuntimeReadiness,
  CodingRuntimeReadinessCheck,
  CodingRuntimeReadinessCode,
} from '@ai-devflow/shared'

type ReadinessCopy = {
  label: string
  ready: string
  blocked: string
  remediation: string
}

const readinessCopy: Record<CodingRuntimeReadinessCode, ReadinessCopy> = {
  wrong_workflow_node: {
    label: '工作流节点', ready: '可以执行', blocked: '当前不可执行', remediation: '返回当前开发实现节点。',
  },
  git_unavailable: {
    label: '本地仓库', ready: '支持 managed worktree', blocked: 'Git 不可用', remediation: '选择有效的本地 Git 仓库。',
  },
  test_command_missing: {
    label: '测试命令', ready: '已配置', blocked: '未配置', remediation: '为当前本地项目保存安全测试命令。',
  },
  executor_unconfigured: {
    label: 'Coding Executor', ready: '已配置', blocked: '未配置', remediation: '选择 OpenCode 或 Native Coding Executor。',
  },
  binary_missing: {
    label: 'OpenCode 可执行文件', ready: '已解析', blocked: '未找到', remediation: '重新检测并确认由 Electron Main 解析出的 OpenCode。',
  },
  version_incompatible: {
    label: 'OpenCode 版本', ready: '合同兼容', blocked: '不兼容', remediation: '安装当前发布已验证的 OpenCode 版本。',
  },
  auth_unavailable: {
    label: 'OpenCode 认证', ready: '本地认证目录可用', blocked: '不可用', remediation: '在 OpenCode 中完成登录，并确认本地 auth profile 可访问。',
  },
  profile_unavailable: {
    label: 'OpenCode Profile', ready: '已选择', blocked: '未选择', remediation: '选择本项目使用的 OpenCode Provider/profile。',
  },
  model_unavailable: {
    label: 'OpenCode Model', ready: '已选择', blocked: '未选择', remediation: '选择本项目使用的 OpenCode model。',
  },
  engine_unavailable: {
    label: 'Coding Engine', ready: '可用', blocked: '不可用', remediation: '重新检测本机 OpenCode，或改用 Native Executor。',
  },
  capability_unavailable: {
    label: '执行能力', ready: '满足要求', blocked: '能力不足', remediation: '选择满足 worktree、diff、取消和权限合同的 Executor。',
  },
  provider_unavailable: {
    label: 'Provider', ready: '可用', blocked: '不可用', remediation: '为 Native 选择已安全保存的 Provider，或配置 OpenCode Provider。',
  },
  team_project_unpaired: {
    label: 'Team Project', ready: '已配对', blocked: '未配对', remediation: '绑定当前 Local Project 与 Team Project。',
  },
  budget_policy_missing: {
    label: '预算策略', ready: '已配置', blocked: '未配置', remediation: '保存当前项目的 Runtime Budget Policy。',
  },
  budget_blocked: {
    label: '预算评估', ready: '允许执行', blocked: '阻止执行', remediation: '调整预算策略或取得一次性 Owner/Lead 批准。',
  },
  active_run: {
    label: '运行并发', ready: '可以启动', blocked: '已有活动运行', remediation: '等待、取消或完成当前 Coding Run。',
  },
  permission_pending: {
    label: '权限审批', ready: '没有待处理请求', blocked: '等待处理', remediation: '批准或拒绝当前权限请求。',
  },
}

export type CodingReadinessDisplayItem = {
  code: CodingRuntimeReadinessCode
  label: string
  state: 'ready' | 'blocked'
  statusLabel: string
  detail: string
  remediation?: string
  diagnosticCode?: CodingRuntimeReadinessCode
}

export type CodingReadinessDisplay = {
  status: 'ready' | 'blocked'
  statusLabel: 'Ready' | 'Blocked'
  items: CodingReadinessDisplayItem[]
}

export function buildCodingReadinessDisplay(
  readiness: CodingRuntimeReadiness,
): CodingReadinessDisplay {
  const items = readiness.checks.map(toDisplayItem)
  const status = items.some((item) => item.state === 'blocked') ? 'blocked' : 'ready'
  return {
    status,
    statusLabel: status === 'ready' ? 'Ready' : 'Blocked',
    items,
  }
}

function toDisplayItem(check: CodingRuntimeReadinessCheck): CodingReadinessDisplayItem {
  const copy = readinessCopy[check.code]
  return check.status === 'ready'
    ? {
        code: check.code,
        label: copy.label,
        state: 'ready',
        statusLabel: copy.ready,
        detail: check.message,
      }
    : {
        code: check.code,
        label: copy.label,
        state: 'blocked',
        statusLabel: copy.blocked,
        detail: check.message,
        remediation: copy.remediation,
        diagnosticCode: check.code,
      }
}
