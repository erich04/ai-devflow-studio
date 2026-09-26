import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('V2.1 Evaluated Retrieval and Memory contract', () => {
  it('promotes one complete contract set through the single Roadmap before product code', () => {
    const roadmap = read('docs/roadmap.md')
    const contractPaths = [
      'docs/product/prd/v2.1-evaluated-retrieval-memory-prd.md',
      'docs/adr/0017-evaluated-hybrid-retrieval-and-citation.md',
      'docs/adr/0018-scoped-agent-memory-lifecycle.md',
      'docs/plans/v2.1-evaluated-retrieval-memory.md',
      'scripts/fixtures/v2.1-retrieval-memory-evaluation.json',
    ]

    for (const path of contractPaths) {
      expect(roadmap).toContain(path)
      expect(read(path).length).toBeGreaterThan(0)
    }

    expect(roadmap).toContain('V2.1 contract set is frozen')
    expect(roadmap).toContain('V2.1 Slice 1 is complete')
  })

  it('defines stable citation, corpus, and Memory lifecycle language without changing authority', () => {
    const context = read('CONTEXT.md')

    for (const term of [
      '## 知识引用（Knowledge Citation）',
      '## 检索评估语料（Retrieval Evaluation Corpus）',
      '## 记忆候选（Memory Candidate）',
      '## 持久 Agent 记忆（Durable Agent Memory）',
      '## 记忆版本（Memory Revision）',
      '## 记忆删除标记（Memory Tombstone）',
    ]) {
      expect(context).toContain(term)
    }

    expect(context).toContain('Agent 记忆不是工作流状态')
    expect(context).toContain('本身不会变成治理证据')
    expect(context).toContain('记忆可见范围取交集，不能通过回退扩大范围')
  })

  it('keeps hybrid retrieval and citations evaluated, scoped, and advisory', () => {
    const adr = read('docs/adr/0017-evaluated-hybrid-retrieval-and-citation.md')

    expect(adr).toContain('状态：已接受（Accepted）')
    expect(adr).toContain('ADR 0007')
    expect(adr).toContain('词法检索保持为稳定、无费用的基线')
    expect(adr).toContain('只能重排确切范围检索集合已接受的候选')
    expect(adr).toContain('存在引用不等于内容忠实')
    expect(adr).toContain('Recall@K')
    expect(adr).toContain('nDCG@K')
    expect(adr).toContain('禁止范围命中为零')
    expect(adr).toContain('在嵌入、排序、重排或提供方调用前进行范围和生命周期过滤')
    expect(adr).toContain('不选择向量数据库')
  })

  it('makes durable Agent Memory curated, versioned, isolated, and deletion-safe', () => {
    const adr = read('docs/adr/0018-scoped-agent-memory-lifecycle.md')

    expect(adr).toContain('状态：已接受（Accepted）')
    expect(adr).toContain('Agent 记忆是独立、带版本、有范围的产品概念')
    expect(adr).toContain('记忆候选')
    expect(adr).toContain('在权威提升策略接受前，它不生效')
    expect(adr).toContain('乐观并发拒绝过时写入者')
    expect(adr).toContain('冲突的活动记忆不静默合并')
    expect(adr).toContain('已删除或过期记忆在检索前就不可用')
    expect(adr).toContain('防止重放或旧同步使其复活')
    expect(adr).toContain('Team/API 仅可保存明确允许的脱敏记忆投影')
    expect(adr).toContain('默认验证使用确定性时钟')
  })

  it('freezes a no-cost corpus covering retrieval, citation, Memory lifecycle, and isolation gates', () => {
    const corpus = JSON.parse(read('scripts/fixtures/v2.1-retrieval-memory-evaluation.json')) as {
      schemaVersion: number
      corpusId: string
      corpusVersion: number
      retrievalContractVersion: number
      memoryContractVersion: number
      defaultNoCost: boolean
      metricThresholds?: Record<string, number>
      memoryFixtures?: Array<{ id: string; status: string }>
      cases: Array<{ id: string; category: string; scope: Record<string, string> }>
    }

    expect(corpus).toMatchObject({
      schemaVersion: 1,
      corpusId: 'v2.1-evaluated-retrieval-memory',
      corpusVersion: 1,
      retrievalContractVersion: 1,
      memoryContractVersion: 1,
      defaultNoCost: true,
      metricThresholds: {
        citationPrecisionMin: 1,
        citationFaithfulnessMin: 1,
        maxIsolationViolations: 0,
        paidProviderCalls: 0,
      },
    })
    expect(new Set(corpus.cases.map((entry) => entry.category))).toEqual(new Set([
      'retrieval_baseline',
      'hybrid_improvement',
      'citation',
      'citation_staleness',
      'tenant_isolation',
      'memory_quality',
      'memory_conflict',
      'memory_expiry',
      'memory_deletion',
      'memory_isolation',
    ]))
    expect(corpus.memoryFixtures?.map((entry) => entry.status)).toEqual(
      expect.arrayContaining(['active', 'conflict', 'expired', 'deleted']),
    )
    expect(corpus.cases.every((entry) =>
      Object.keys(entry.scope).sort().join(',') === 'organizationId,projectId,sessionId,userId'
    )).toBe(true)
  })

  it('defines a measurable product gate and ordered TDD slices before implementation', () => {
    const prd = read('docs/product/prd/v2.1-evaluated-retrieval-memory-prd.md')
    const plan = read('docs/plans/v2.1-evaluated-retrieval-memory.md')

    expect(prd).toContain('Status: Approved for implementation')
    expect(prd).toContain('ADR 0007')
    expect(prd).toContain('混合检索相对词法基线达到冻结的聚合质量改进阈值')
    expect(prd).toContain('引用准确率/忠实度')
    expect(prd).toContain('记忆在不增加人工介入下改善选定任务结果')
    expect(prd).toContain('桌面模式 22')
    expect(prd).toContain('团队模式 18')
    expect(prd).toContain('范围、预算与文本传输权限通过前，不解析任何服务商凭据')
    expect(prd).toContain('V2.2 多 Agent')

    for (const slice of [
      '第 0 批：冻结契约',
      '第 1 批：共享检索、引用和评估契约',
      '第 2 批：确定性混合检索',
      '第 3 批：持久本地检索索引',
      '第 4 批：限定范围的记忆生命周期',
      '第 5 批：Agent 运行时与桌面界面',
      '第 6 批：脱敏团队投影',
      '第 7 批：评估与完成门禁',
    ]) {
      expect(plan).toContain(slice)
    }
    expect(plan).toContain('先失败后通过')
    expect(plan).toContain('向量化、排序、重排、记忆附着或模型使用前，先按范围及删除状态过滤')
    expect(plan).toContain('团队不能接纳/删除记忆')
    expect(plan).toContain('干净直接子提交')
  })

  it('advances the single active Roadmap priority to the V2.1 completion gate after Team Memory sync', () => {
    const roadmap = read('docs/roadmap.md')
    const plan = read('docs/plans/v2.1-evaluated-retrieval-memory.md')
    const testing = read('docs/engineering/testing-strategy.md')
    const readme = read('README.md')

    expect(plan).toContain('Status: Active — Slice 7 in progress')
    expect(plan).toContain('| 第 1 批 | 已完成 |')
    expect(plan).toContain('| 第 2 批 | 已完成 |')
    expect(plan).toContain('| 第 3 批 | 已完成 |')
    expect(plan).toContain('| 第 4 批 | 已完成 |')
    expect(plan).toContain('| 第 5 批 | 已完成 |')
    expect(plan).toContain('| 第 6 批 | 已完成 |')
    expect(plan).toContain('| Slice 7 | In progress |')
    expect(plan).toContain('agent_memory_summaries')
    expect(plan).toContain('agent_memory_projection_audits')
    expect(plan).toContain('不伪造记忆投影')
    expect(plan).toContain('桌面模式 26')
    expect(plan).toContain('桌面模式 27')
    expect(plan).toContain('acceptedContextCount')
    expect(plan).toContain('qualityVersion')
    expect(plan).toContain('(memoryId, headVersion, qualityVersion)')
    expect(plan).toContain('仅元数据 ID 的发件箱')
    expect(plan).toContain('Web 始终只读')
    expect(plan).toMatch(/197 文件\/2790 测试/u)
    expect(plan).toContain('渲染器投影 v2')
    expect(plan).toContain('知识引用与持久记忆计数')
    expect(plan).toContain('能力授权持久预留')
    expect(plan).toContain('记忆生命周期访问')
    expect(plan).toContain('所选运行时')
    expect(plan).toContain('待清除')
    expect(plan).toMatch(/152 项本地存储、48 项共享检索\/记忆测试/u)
    expect(plan).toMatch(/192 文件\/2743 测试/u)
    expect(roadmap).toContain('### Now — Run V2.1 Evaluation And Completion Gate')
    expect(roadmap).toContain('| Active milestone | V2.1 Slice 7 — Evaluation And Completion Gate |')
    expect(roadmap).toContain('| Next gate | Freeze the exact V2.1 candidate and run the full completion matrix |')
    expect(roadmap).toContain('Desktop schema 27')
    expect(roadmap).toContain('Web read-only Team Memory')
    expect(roadmap).toContain('memoryRestartDuplicateEffects')
    expect(testing).toContain('原子激活保留此前的当前快照')
    expect(testing).toContain('显式且有边界的重建只恢复派生索引状态')
    expect(testing).toContain('143 项本地存储测试和 43 项共享检索测试')
    expect(testing).toContain('渲染投影 v2')
    expect(testing).toContain('Agent Memory 生命周期界面')
    expect(testing).toContain('已删除陈述仅保留在主进程')
    expect(plan).toContain('corepack pnpm test:v21-retrieval-memory-evaluator')
    expect(plan).toContain('docs/releases/v2.1.0/retrieval-memory-evaluation.json')
    expect(plan).toContain('docs/releases/v2.1.0/required-gates.json')
    expect(plan).toContain('无记忆')
    expect(testing).toContain('V2.1 候选版本绑定评估器')
    expect(testing).toContain('qualityVersion')
    expect(readme).toContain('corepack pnpm test:v21-retrieval-memory-evaluator')
    expect(readme).toContain('corepack pnpm v21:completion-status')
    expect(roadmap).toContain('grant reservation')
    expect(roadmap).not.toContain('### Now — Implement V2.1 Shared Retrieval, Citation, And Evaluation Contracts')
    expect(roadmap).not.toContain('### Now — Implement V2.1 Durable Local Retrieval Index')
    expect(roadmap).not.toContain('### Now — Implement V2.1 Scoped Agent Memory Lifecycle')
    expect(roadmap).not.toContain('### Now — Add V2.1 Redacted Team Projection')
    expect(roadmap.match(/^### Now —/gmu)).toHaveLength(1)
  })
})
