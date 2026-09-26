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

    expect(roadmap).toContain('V2.2 contract set is frozen')
    if (hasCompletionEvidence) {
      expect(roadmap).toContain('### Now — Release V2.3 Workflow Improvements')
      expect(roadmap).toContain('| Current 2.x state | V2.2 published; V2.3 candidate signoff in progress |')
      expect(roadmap).toContain('| Next gate | Verify the V2.3 candidate, complete independent packaged signoff, then tag and publish |')
      expect(roadmap).toContain('docs/plans/v2.2-release-signoff.md')
      expect(roadmap).toContain('docs/releases/v2.2.0/')
    } else {
      expect(roadmap).toContain('### Now — Evaluate And Close V2.2')
      expect(roadmap).toContain('| Active milestone | V2.2 Slice 7 — Evaluation And 2.x Completion Gate |')
      expect(roadmap).toContain('| Next gate | Freeze the exact V2.2 candidate and run the full completion matrix |')
    }
    expect(roadmap.match(/^### Now —/gmu)).toHaveLength(1)
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

    expect(prd).toMatch(/Status: (Approved for implementation|Complete)/u)
    expect(prd).toContain('measurably improves selected task outcomes over the frozen V2.0 single-Agent baseline')
    expect(prd).toContain('quality, cost, latency, and human intervention')
    expect(prd).toContain('zero authority, isolation, termination, or replay violations')
    expect(prd).toContain('No specialist can create another Agent')
    expect(prd).toContain('Public SaaS')
    expect(prd).toContain('There is no automatic V2.3')
  })

  it('provides an ordered RED to GREEN implementation plan before product code', () => {
    const plan = read('docs/plans/v2.2-multi-agent-execution-tenancy.md')

    for (const slice of [
      'Slice 0 — Contract Freeze',
      'Slice 1 — Shared Coordination Domain',
      'Slice 2 — Durable Desktop Coordinator',
      'Slice 3 — Specialist Runtime And Attenuated Authority',
      'Slice 4 — Execution Tenancy And Resource Arbitration',
      'Slice 5 — Recovery, Cancellation, And Desktop UX',
      'Slice 6 — Redacted Team Projection',
      'Slice 7 — Evaluation And 2.x Completion Gate',
    ]) {
      expect(plan).toContain(slice)
    }

    expect(plan).toContain('RED → GREEN')
    expect(plan).toContain('Desktop schema 28')
    expect(plan).toContain('Team schema 19')
    expect(plan).toContain('full single-Agent baseline remains executable')
    expect(plan).toContain('clean direct child')
    expect(plan).toContain(hasCompletionEvidence
      ? 'Status: Complete'
      : 'Status: Active — Slice 7 in progress')
    expect(plan).toMatch(/\| Slice 1 \| Complete \|/u)
    expect(plan).toMatch(/\| Slice 2 \| Complete \|/u)
    expect(plan).toMatch(/\| Slice 3 \| Complete \|/u)
    expect(plan).toMatch(/\| Slice 4 \| Complete \|/u)
    expect(plan).toMatch(/\| Slice 5 \| Complete \|/u)
    expect(plan).toMatch(/\| Slice 6 \| Complete \|/u)
    expect(plan).toMatch(hasCompletionEvidence
      ? /\| Slice 7 \| Complete \|/u
      : /\| Slice 7 \| In progress \|/u)
    expect(plan).toContain('task_retried')
    expect(plan).toContain('repository_read')
    expect(plan).toContain('settleCoordinationResourceLease')
    expect(plan).toContain('369 focused Tool, MCP, Coding, coordination, and persistence tests pass')
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
