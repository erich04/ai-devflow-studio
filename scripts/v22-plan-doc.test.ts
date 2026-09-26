import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
const hasCompletionEvidence = existsSync('docs/releases/v2.2.0/required-gates.json') &&
  existsSync('docs/releases/v2.2.0/multi-agent-evaluation.json')

describe('V2.2 Multi-Agent and Execution Tenancy contract', () => {
  it('promotes one frozen contract set through the single Roadmap', () => {
    const roadmap = read('docs/roadmap.md')
    const contractPaths = [
      'docs/product/prd/v2.2-multi-agent-execution-tenancy-prd.md',
      'docs/adr/0019-bounded-multi-agent-coordination.md',
      'docs/plans/v2.2-multi-agent-execution-tenancy.md',
      'scripts/fixtures/v2.2-multi-agent-evaluation.json',
    ]

    for (const path of contractPaths) {
      expect(roadmap).toContain(path)
      expect(read(path).length).toBeGreaterThan(0)
    }

    expect(roadmap).toContain('V2.2 契约集已冻结')
    if (hasCompletionEvidence) {
      expect(roadmap).toContain('### 当前：验证并交付已报告问题的修复')
      expect(roadmap).toContain('| 当前 2.x 状态 | V2.3 已发布；后续修复逐项验证 |')
      expect(roadmap).toContain('| 下一门禁 | 完成真实仓库全流程与逐项证据核验，再关闭已解决 Issue |')
      expect(roadmap).toContain('docs/plans/v2.2-release-signoff.md')
      expect(roadmap).toContain('docs/releases/v2.2.0/')
    } else {
      expect(roadmap).toContain('### 当前：评估并完成 V2.2')
      expect(roadmap).toContain('| 活动里程碑 | V2.2 切片 7 — 评估与 2.x 完成门禁 |')
      expect(roadmap).toContain('| 下一门禁 | 冻结精确 V2.2 候选并执行完整完成矩阵 |')
    }
    expect(roadmap.match(/^### 当前：/gmu)).toHaveLength(1)
  })

  it('defines stable coordination and tenancy language without creating new authority', () => {
    const context = read('CONTEXT.md')

    for (const term of [
      '## 协调会话（Coordination Session）',
      '## 监督 Agent（Supervisor Agent）',
      '## 专职 Agent（Specialist Agent）',
      '## Agent 任务图（Agent Task Graph）',
      '## Agent 交接（Agent Handoff）',
      '## 执行租户隔离（Execution Tenancy）',
    ]) {
      expect(context).toContain(term)
    }

    expect(context).toContain('协调会话不能推进工作流状态、批准 Gate 或发布')
    expect(context).toContain('范围、能力和预算均取交集，绝不通过回退扩大')
  })

  it('accepts bounded coordination and capability attenuation as the architecture', () => {
    const adr = read('docs/adr/0019-bounded-multi-agent-coordination.md')

    expect(adr).toContain('状态：已接受（Accepted）')
    expect(adr).toContain('一个监督 Agent 和最多四个专职 Agent')
    expect(adr).toContain('专职 Agent 不能委托')
    expect(adr).toContain('有向无环 Agent 任务图')
    expect(adr).toContain('能力及预算是监督 Agent 的子集')
    expect(adr).toContain('单写者租约')
    expect(adr).toContain('取消从协调会话传播')
    expect(adr).toContain('绝不跨越执行租户隔离边界')
    expect(adr).toContain('工作流与门禁权限保持在协调之外')
    expect(adr).toContain('不在渲染进程或 Team 可见状态持久化隐藏推理')
  })

  it('defines measurable user outcomes and a finite V2.2 exit gate', () => {
    const prd = read('docs/product/prd/v2.2-multi-agent-execution-tenancy-prd.md')

    expect(prd).toMatch(/状态：(已批准实施|已完成)/u)
    expect(prd).toContain('多 Agent 相对冻结基线')
    expect(prd).toContain('质量、费用、延迟及人工介入')
    expect(prd).toContain('权限、隔离、终止和重放违规为零')
    expect(prd).toContain('子 Agent 不能再创建 Agent')
    expect(prd).toContain('公共 SaaS')
    expect(prd).toContain('不自动延伸出 V2.3')
  })

  it('provides an ordered RED to GREEN implementation plan before product code', () => {
    const plan = read('docs/plans/v2.2-multi-agent-execution-tenancy.md')

    for (const slice of [
      '第 0 批：冻结契约',
      '第 1 批：共享协调领域',
      '第 2 批：持久桌面协调器',
      '第 3 批：专职运行时与权限收窄',
      '第 4 批：执行租户与资源仲裁',
      '第 5 批：恢复、取消与桌面界面',
      '第 6 批：脱敏团队投影',
      '第 7 批：评估与 2.x 完成门禁',
    ]) {
      expect(plan).toContain(slice)
    }

    expect(plan).toContain('先失败后通过')
    expect(plan).toContain('桌面模式 28')
    expect(plan).toContain('团队模式 19')
    expect(plan).toContain('完整单 Agent 基线仍可执行')
    expect(plan).toContain('干净直接子提交')
    expect(plan).toContain(hasCompletionEvidence
      ? '状态：已完成'
      : '状态：进行中——第 7 批')
    expect(plan).toMatch(/\| 第 1 批 \| 已完成 \|/u)
    expect(plan).toMatch(/\| 第 2 批 \| 已完成 \|/u)
    expect(plan).toMatch(/\| 第 3 批 \| 已完成 \|/u)
    expect(plan).toMatch(/\| 第 4 批 \| 已完成 \|/u)
    expect(plan).toMatch(/\| 第 5 批 \| 已完成 \|/u)
    expect(plan).toMatch(/\| 第 6 批 \| 已完成 \|/u)
    expect(plan).toMatch(hasCompletionEvidence
      ? /\| 第 7 批 \| 已完成 \|/u
      : /\| 第 7 批 \| 进行中 \|/u)
    expect(plan).toContain('task_retried')
    expect(plan).toContain('repository_read')
    expect(plan).toContain('settleCoordinationResourceLease')
    expect(plan).toContain('369 项针对性测试、完整单测、生产构建和 Electron 冒烟通过')
    expect(plan).toContain('coordinationRestartDuplicateEffects: 0')
  })

  it('freezes no-cost quality, termination, replay, and isolation scenarios', () => {
    const fixture = JSON.parse(read('scripts/fixtures/v2.2-multi-agent-evaluation.json')) as {
      schemaVersion: number
      datasetId: string
      datasetVersion: number
      coordinationContractVersion: number
      executionTenancyContractVersion: number
      defaultNoCost: boolean
      bounds: Record<string, number>
      metricThresholds: Record<string, number>
      scenarios: Array<{ id: string; category: string }>
    }

    expect(fixture).toMatchObject({
      schemaVersion: 1,
      datasetId: 'v2.2-multi-agent-execution-tenancy',
      datasetVersion: 1,
      coordinationContractVersion: 1,
      executionTenancyContractVersion: 1,
      defaultNoCost: true,
      bounds: {
        maxSpecialists: 4,
        maxTaskNodes: 12,
        maxDependencyEdges: 24,
        maxDelegationDepth: 1,
        maxParallelSpecialists: 3,
      },
      metricThresholds: {
        minimumAggregateImprovementOverSingle: 0.25,
        maxAdditionalHumanInterventions: 0,
        maxIsolationViolations: 0,
        maxAuthorityViolations: 0,
        maxTerminationViolations: 0,
        maxReplayViolations: 0,
        paidProviderCalls: 0,
      },
    })
    expect(new Set(fixture.scenarios.map((entry) => entry.category))).toEqual(new Set([
      'single_agent_baseline',
      'multi_agent_quality',
      'dependency_join',
      'cycle_rejection',
      'shared_budget',
      'cancellation',
      'tenant_isolation',
      'capability_attenuation',
      'failure_attribution',
      'restart_recovery',
    ]))
  })
})
