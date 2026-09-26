import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
const hasCompletionEvidence = existsSync('docs/releases/v2.0.0/required-gates.json') &&
  existsSync('docs/releases/v2.0.0/agent-runtime-evaluation.json')
const hasV21CompletionEvidence = existsSync('docs/releases/v2.1.0/required-gates.json') &&
  existsSync('docs/releases/v2.1.0/retrieval-memory-evaluation.json')
const hasV22CompletionEvidence = existsSync('docs/releases/v2.2.0/required-gates.json') &&
  existsSync('docs/releases/v2.2.0/multi-agent-evaluation.json')

describe('V2.0 Native Agent Runtime contract', () => {
  it('records the bounded runtime and observable trajectory decision', () => {
    const adr = read('docs/adr/0014-bounded-agent-runtime.md')

    expect(adr).toContain('状态：已接受（Accepted）')
    expect(adr).toContain('ADR 0008')
    expect(adr).toContain('确定性工作流仍是外层权威')
    expect(adr).toContain('Agent 运行时不是工作流')
    expect(adr).toContain('success')
    expect(adr).toContain('step_limit')
    expect(adr).toContain('budget_exhausted')
    expect(adr).toContain('checkpoint')
    expect(adr).toContain('乐观并发')
    expect(adr).toContain('不持久化隐藏推理')
    expect(adr).toContain('确定性、无费用的假运行时')
  })

  it('evolves the managed coding adapter into one governed executor contract', () => {
    const adr = read('docs/adr/0015-governed-coding-executor.md')

    expect(adr).toContain('状态：已接受（Accepted）')
    expect(adr).toContain('ADR 0009')
    expect(adr).toContain('Coding Executor')
    expect(adr).toContain('能力协商')
    expect(adr).toContain('OpenCode')
    expect(adr).toContain('DevFlow 自有 Coding Agent')
    expect(adr).toContain('相同终态结果契约')
    expect(adr).toContain('绝不能发布、合并、批准门禁或扩大范围')
    expect(adr).toContain('不声称了解 OpenCode 私有内部轨迹')
  })

  it('keeps Tool and MCP execution behind main-owned authority', () => {
    const adr = read('docs/adr/0016-tool-mcp-execution-authority.md')

    expect(adr).toContain('状态：已接受（Accepted）')
    expect(adr).toContain('McpServerDefinition')
    expect(adr).toContain('LocalMcpInstallation')
    expect(adr).toContain('绝不能作为进程启动权限来源')
    expect(adr).toContain('Electron main')
    expect(adr).toContain('ToolCapabilityGrant')
    expect(adr).toContain('严格校验输入和输出模式')
    expect(adr).toContain('截止期限')
    expect(adr).toContain('取消')
    expect(adr).toContain('组织、项目、用户、会话和本地项目')
    expect(adr).toContain('stdio')
    expect(adr).toContain('固定且不含秘密的隔离哨兵')
    expect(adr).toContain('远程 MCP 传输推迟')
  })

  it('defines a scoped V2.0 product contract and measurable exit gate', () => {
    const prd = read('docs/product/prd/v2.0-native-agent-runtime-prd.md')

    expect(prd).toContain('状态：已批准实施')
    expect(prd).toContain('有界的自有 Agent 循环')
    expect(prd).toContain('一个刻意限定范围的 DevFlow 自有编码 Agent')
    expect(prd).toContain('可信本地 MCP 安装')
    expect(prd).toContain('检查点恢复')
    expect(prd).toContain('版本化场景数据集')
    expect(prd).toContain('质量、费用、延迟、人工介入、恢复和隔离')
    expect(prd).toContain('默认验证确定且无费用')
    expect(prd).toContain('工作流和人工 Gate 权限位于 Agent 循环之外')
    expect(prd).toContain('公共 SaaS')
    expect(prd).toContain('V2.1')
    expect(prd).toContain('V2.2')
  })

  it('promotes the exact V2.0 contract set through the single Roadmap', () => {
    const roadmap = read('docs/roadmap.md')

    for (const path of [
      'docs/product/prd/v2.0-native-agent-runtime-prd.md',
      'docs/adr/0014-bounded-agent-runtime.md',
      'docs/adr/0015-governed-coding-executor.md',
      'docs/adr/0016-tool-mcp-execution-authority.md',
      'docs/plans/v2.0-native-agent-runtime.md',
    ]) {
      expect(roadmap).toContain(path)
    }

    if (hasV22CompletionEvidence) {
      expect(roadmap).toContain('### 当前：验证并交付已报告问题的修复')
      expect(roadmap).toContain('V2.0、V2.1 和 V2.2 均已完成')
    } else if (hasV21CompletionEvidence) {
      expect(roadmap).toMatch(/^### 当前： .*V2\.2/gmu)
      expect(roadmap).toContain('V2.0 和 V2.1 均已完成')
    } else if (hasCompletionEvidence) {
      expect(roadmap).toMatch(/^### 当前： .*V2\.1/gmu)
      expect(roadmap).toContain('V2.0 已完成')
    } else {
      expect(roadmap).toContain('### 当前：执行 V2.0 评估与完成门禁')
      expect(roadmap).toContain('切片 1–7 已完成')
      expect(roadmap).toContain('### 下一步：V2.0 完成后启动 V2.1 经评估检索与记忆')
    }
  })

  it('provides an executable TDD slice plan before product code starts', () => {
    const plan = read('docs/plans/v2.0-native-agent-runtime.md')
    const roadmap = read('docs/roadmap.md')
    const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

    for (const slice of [
      '第 0 批：冻结契约',
      '第 1 批：领域与确定性内核',
      '第 2 批：持久桌面运行时',
      '第 3 批：原生工具注册表',
      '第 4 批：可信本地 MCP',
      '第 5 批：受治理编码执行器',
      '第 6 批：有限范围原生编码 Agent',
      '第 7 批：运行时界面与团队投影',
      '第 8 批：V2.0 评估与完成门禁',
    ]) {
      expect(plan).toContain(slice)
    }

    expect(plan).toContain('失败测试')
    expect(plan).toContain('最小实现')
    expect(plan).toContain('桌面模式 18')
    expect(plan).toContain('团队模式 16')
    expect(plan).toContain('不含原始提示词、源码、补丁、标准输出/错误、凭据或绝对路径')
    expect(plan).toContain('原生/OpenCode 对等')
    expect(plan).toContain('V2.0 证据')
    expect(plan).toContain('| 第 2 批 | 已完成 |')
    expect(plan).toContain('| 第 3 批 | 已完成 |')
    expect(plan).toContain('| 第 4 批 | 已完成 |')
    expect(plan).toContain('| 第 5 批 | 已完成 |')
    expect(plan).toContain('| 第 6 批 | 已完成 |')
    expect(plan).toContain('| 第 7 批 | 已完成 |')
    expect(plan).toContain(hasCompletionEvidence
      ? '| 第 8 批 | 已完成 |'
      : '| 第 8 批 | 进行中 |')
    expect(plan).toContain('scripts/fixtures/v2.0-agent-runtime-scenarios.json')
    expect(plan).toContain('scripts/v20-agent-runtime-evaluator.mjs')
    expect(plan).toContain('scripts/v20-agent-runtime-evaluation-runner.mjs')
    expect(packageJson.scripts?.['test:v20-agent-runtime-evaluator']).toBe(
      'node scripts/v20-agent-runtime-evaluation-runner.mjs',
    )
    expect(packageJson.scripts?.['v20:completion-status']).toBe(
      'node scripts/v20-completion-evidence.mjs',
    )
    expect(plan).toContain('主进程严格投影')
    expect(plan).toContain('精确版本/检查点乐观并发')
    expect(plan).toContain('桌面模式 21')
    expect(plan).toContain('agent_runtime_summaries')
    expect(plan).toContain('agent_runtime_projection_audits')
    expect(plan).toContain('/api/sync/agent-runtime-summary')
    expect(plan).toContain('不能恢复、授权能力或推进工作流')
    expect(plan).toContain('主进程生成的无路径请求')
    expect(plan).toContain('无权限请求完成')
    expect(plan).toContain('统一终态')
    expect(plan).toContain('桌面模式 19')
    expect(plan).toContain('桌面模式 20')
    expect(plan).toContain('local_mcp_installations')
    expect(plan).toContain('协商能力摘要')

    expect(roadmap).toMatch(/切片 7\s*已完成/)
    if (hasV22CompletionEvidence) {
      expect(roadmap).toContain('### 当前：验证并交付已报告问题的修复')
    } else if (hasV21CompletionEvidence) {
      expect(roadmap).toMatch(/^### 当前： .*V2\.2/gmu)
    } else if (hasCompletionEvidence) {
      expect(roadmap).toMatch(/^### 当前： .*V2\.1/gmu)
    } else {
      expect(roadmap).toContain('### 当前：执行 V2.0 评估与完成门禁')
    }
  })

  it('adds stable V2.0 domain language without redefining workflow authority', () => {
    const context = read('CONTEXT.md')

    for (const term of [
      '## Agent 运行时（Agent Runtime）',
      '## Agent 执行轨迹（Agent Trajectory）',
      '## Agent 检查点（Agent Checkpoint）',
      '## Agent 停止原因（Agent Stop Reason）',
      '## 工具定义（Tool Definition）',
      '## 工具能力授予（Tool Capability Grant）',
      '## 本地 MCP 安装（Local MCP Installation）',
      '## 编码执行器（Coding Executor）',
      '## 编码执行器能力（Coding Executor Capability）',
      '## Agent 评估场景（Agent Evaluation Scenario）',
    ]) {
      expect(context).toContain(term)
    }

    expect(context).toContain('确定性工作流仍掌握 Run 状态、策略、证据接纳和人工 Gate 的权威')
    expect(context).toContain('团队 MCP 元数据不构成本地执行权限')
  })
})
