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

    expect(prd).toContain('Status: Approved for implementation')
    expect(prd).toContain('bounded first-party Agent loop')
    expect(prd).toContain('one deliberately narrow DevFlow-owned Coding Agent')
    expect(prd).toContain('trusted local MCP installation')
    expect(prd).toContain('checkpoint and resume')
    expect(prd).toContain('versioned scenario dataset')
    expect(prd).toContain('quality, cost, latency, human intervention, recovery, and isolation')
    expect(prd).toContain('Default verification is deterministic and no-cost')
    expect(prd).toContain('Workflow and human Gate authority remain outside the Agent loop')
    expect(prd).toContain('Public SaaS')
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
      expect(roadmap).toContain('### Now — Release V2.3 Workflow Improvements')
      expect(roadmap).toContain('V2.0, V2.1, and V2.2 are complete')
    } else if (hasV21CompletionEvidence) {
      expect(roadmap).toMatch(/^### Now — .*V2\.2/gmu)
      expect(roadmap).toContain('V2.0 and V2.1 are complete')
    } else if (hasCompletionEvidence) {
      expect(roadmap).toMatch(/^### Now — .*V2\.1/gmu)
      expect(roadmap).toContain('V2.0 is complete')
    } else {
      expect(roadmap).toContain('### Now — Run The V2.0 Evaluation And Completion Gate')
      expect(roadmap).toContain('Slices 1–7 are complete')
      expect(roadmap).toContain('### Next — Begin V2.1 Evaluated Retrieval And Memory After V2.0 Completion')
    }
  })

  it('provides an executable TDD slice plan before product code starts', () => {
    const plan = read('docs/plans/v2.0-native-agent-runtime.md')
    const roadmap = read('docs/roadmap.md')
    const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

    for (const slice of [
      'Slice 0 — Contract Freeze',
      'Slice 1 — Runtime Domain And Deterministic Kernel',
      'Slice 2 — Durable Desktop Runtime',
      'Slice 3 — Native Tool Registry',
      'Slice 4 — Trusted Local MCP',
      'Slice 5 — Governed Coding Executor',
      'Slice 6 — Narrow Native Coding Agent',
      'Slice 7 — Runtime UX And Team Projection',
      'Slice 8 — V2.0 Evaluation And Completion Gate',
    ]) {
      expect(plan).toContain(slice)
    }

    expect(plan).toContain('RED')
    expect(plan).toContain('GREEN')
    expect(plan).toContain('Desktop schema 18')
    expect(plan).toContain('Team schema 16')
    expect(plan).toContain('no raw prompt, source, patch, stdout, stderr, credential, or absolute path')
    expect(plan).toContain('OpenCode and native executor parity')
    expect(plan).toContain('V2.0 completion evidence')
    expect(plan).toContain('| Slice 2 | Complete |')
    expect(plan).toContain('| Slice 3 | Complete |')
    expect(plan).toContain('| Slice 4 | Complete |')
    expect(plan).toContain('| Slice 5 | Complete |')
    expect(plan).toContain('| Slice 6 | Complete |')
    expect(plan).toContain('| Slice 7 | Complete |')
    expect(plan).toContain(hasCompletionEvidence
      ? '| Slice 8 | Complete |'
      : '| Slice 8 | In progress |')
    expect(plan).toContain('scripts/fixtures/v2.0-agent-runtime-scenarios.json')
    expect(plan).toContain('scripts/v20-agent-runtime-evaluator.mjs')
    expect(plan).toContain('scripts/v20-agent-runtime-evaluation-runner.mjs')
    expect(packageJson.scripts?.['test:v20-agent-runtime-evaluator']).toBe(
      'node scripts/v20-agent-runtime-evaluation-runner.mjs',
    )
    expect(packageJson.scripts?.['v20:completion-status']).toBe(
      'node scripts/v20-completion-evidence.mjs',
    )
    expect(plan).toContain('strict main-owned renderer projection')
    expect(plan).toContain('exact version/checkpoint optimistic concurrency')
    expect(plan).toContain('Desktop schema 21')
    expect(plan).toContain('agent_runtime_summaries')
    expect(plan).toContain('agent_runtime_projection_audits')
    expect(plan).toContain('/api/sync/agent-runtime-summary')
    expect(plan).toContain('Team cannot resume, issue capabilities, or advance Workflow')
    expect(plan).toContain('path-free main-owned request')
    expect(plan).toContain('no-permission completion')
    expect(plan).toContain('uniform terminal result')
    expect(plan).toContain('Desktop schema 19')
    expect(plan).toContain('Desktop schema 20')
    expect(plan).toContain('local_mcp_installations')
    expect(plan).toContain('negotiated capability-set digest')

    expect(roadmap).toMatch(/Slice 7\s+is complete/)
    if (hasV22CompletionEvidence) {
      expect(roadmap).toContain('### Now — Release V2.3 Workflow Improvements')
    } else if (hasV21CompletionEvidence) {
      expect(roadmap).toMatch(/^### Now — .*V2\.2/gmu)
    } else if (hasCompletionEvidence) {
      expect(roadmap).toMatch(/^### Now — .*V2\.1/gmu)
    } else {
      expect(roadmap).toContain('### Now — Run The V2.0 Evaluation And Completion Gate')
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
