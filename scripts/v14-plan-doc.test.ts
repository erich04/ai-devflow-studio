import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const roadmap = readFileSync(join(process.cwd(), 'docs/roadmap.md'), 'utf8')
const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8')
const productDefinition = readFileSync(
  join(process.cwd(), 'docs/product/product-definition.md'),
  'utf8',
)
const currentProductPrd = readFileSync(
  join(process.cwd(), 'docs/product/prd/current-product-prd.md'),
  'utf8',
)
const pilotGuide = readFileSync(
  join(process.cwd(), 'docs/guides/devflow-studio-self-hosted-pilot.md'),
  'utf8',
)
const walkthrough = readFileSync(
  join(process.cwd(), 'docs/guides/devflow-studio-v1.4-walkthrough.md'),
  'utf8',
)
const prd = readFileSync(
  join(process.cwd(), 'docs/product/prd/v1.4-pilot-trust-boundary-prd.md'),
  'utf8',
)
const plan = readFileSync(
  join(process.cwd(), 'docs/plans/v1.4-pilot-trust-boundary.md'),
  'utf8',
)
const releaseSignoffPlan = readFileSync(
  join(process.cwd(), 'docs/plans/v1.4-release-signoff.md'),
  'utf8',
)

describe('v1.4 pilot trust boundary contract', () => {
  it('preserves the released v1.4 history under the current v1.5 baseline', () => {
    expect(roadmap).toContain('`v2.3.0` 是已发布基线')
    expect(roadmap).toContain('已发布 `v1.4.0`')
    expect(roadmap).toContain('docs/releases/v1.4.0/')
    expect(roadmap).toContain('v1.4-pilot-trust-boundary-prd.md')
    expect(roadmap).toContain('v1.4-pilot-trust-boundary.md')
    expect(roadmap).toContain('持久同步发件箱')
    expect(roadmap).not.toContain('V1.4 scoped implementation complete at `5b64354`')
    expect(roadmap).not.toContain('Version alignment occurs during V1.4 candidate formation')
    expect(prd).toContain('## 产品目标')
    expect(prd).toContain('## 发布必须项')
    expect(prd).toContain('生命周期：已作为 `v1.4.0` 发布')
    expect(plan).toContain('生命周期：已完成并作为 `v1.4.0` 发布')
    expect(releaseSignoffPlan).toContain(
      '生命周期：已完成；`v1.4.0` 已签收、打标签并发布',
    )
  })

  it('delegates current release and future milestone truth to the roadmap', () => {
    expect(readme).toContain('发布与路线图状态')
    expect(readme).toContain('[路线图](docs/roadmap.md)')
    expect(readme).not.toContain('正在准备 V1.4 候选版本')
    expect(readme).toContain('付费 Coding 与 Gate Review 运行时在调用提供方前拒绝继续')
    expect(readme).toContain('持久化发件箱保存脱敏同步任务')
    expect(readme).not.toContain('付费运行时拒绝不确定请求的加固尚未完成')

    expect(productDefinition).toContain('发布状态与后续里程碑统一记录在')
    expect(productDefinition).toContain('[路线图](../roadmap.md)')
    expect(productDefinition).not.toContain('V1.4 scoped implementation is complete')
    expect(productDefinition).not.toContain('candidate-bound signoff is in preparation')
    expect(productDefinition).not.toContain('Production auth and paid-budget trust remain v1.4 work')
    expect(productDefinition).not.toContain(
      'Repository knowledge indexing, complete Web management paths',
    )

    expect(currentProductPrd).toContain('运行时运维和协作')
    expect(currentProductPrd).toContain('仍需证据推动')
    expect(currentProductPrd).toContain('只有路线图定义当前发布和里程碑状态')
    expect(currentProductPrd).not.toContain('roadmap candidates move into implementation')
    expect(currentProductPrd).not.toContain(
      'Roadmap and release-signoff documents may carry milestone status separately',
    )

    expect(roadmap).toContain('V1.4 API Review 知识来源仍为 `none`')
    expect(roadmap).not.toContain(
      'Connect repository Markdown indexing to the real Electron, API Review',
    )
    expect(pilotGuide).toContain('发布与里程碑状态由[路线图](../roadmap.md)统一维护')
    expect(pilotGuide).not.toContain('Version alignment occurs during V1.4 candidate formation')
  })

  it('defines a stable v1.4 operator walkthrough without claiming a result', () => {
    expect(walkthrough).toContain('状态：稳定的操作流程；本文件不声明验证通过。')
    expect(walkthrough).toContain('候选提交 `C`')
    expect(walkthrough).toContain('团队策略')
    expect(walkthrough).toContain('桌面结果：`human_rejected`')
    expect(walkthrough).toContain('团队命令：`applied`')
    expect(walkthrough).toContain('回执确认：`acknowledged`')
    expect(walkthrough).toContain('冷启动')
    expect(walkthrough).toContain('仓库原文、提示词、补丁正文、stdout/stderr、凭据及本地绝对路径均不能越过边界')
    expect(walkthrough).not.toMatch(/Status: passed|状态：已通过/iu)
  })

  it('keeps durable sync and paid fail-closed behavior in the release contract', () => {
    expect(prd).toContain('持久化发件箱是 V1.4 发布必须项')
    expect(prd).toContain('真实付费运行时未配置预算守卫')
    expect(prd).toContain('以 `unavailable` 阻止')
    expect(prd).toContain('显式保存的 `enabled: false` 策略')
    expect(plan).toContain('## 切片 A1：编码运行时付费预算拒绝不确定请求')
    expect(plan).toContain('## 切片 A2：知识审查付费预检与审计')
  })

  it('records the completed durable outbox before repository knowledge integration', () => {
    expect(plan).toContain('## 切片 B：持久远端同步发件箱 ✅')
    expect(plan).toContain('完整单元回归通过 870/870')
    expect(plan).toContain('下一步为切片 C 集成')
  })

  it('records completed repository knowledge and Web collaboration authority', () => {
    expect(plan).toContain('## 切片 C：仓库知识集成 ✅')
    expect(plan).toContain('完整单元回归通过 944/944')
    expect(plan).toContain('Web D1 完成')
    expect(plan).toContain('工作请求纵向切片完成')
    expect(plan).toContain('完整单元回归通过 1162/1162')
    expect(plan).toContain('## 切片 D：Web 管理闭环 ✅')
    expect(plan).toContain(
      '[x] 增加带版本的 Gate 命令预检、投递、本地应用、确认回执及 Web 流程。',
    )
    expect(plan).toContain('`human_rejected` 加确认回执')
  })

  it('records completed reproducible lifecycle evidence without claiming release', () => {
    expect(plan).toContain('## 切片 E：可复现试点生命周期 ✅')
    expect(plan).toContain('Postgres 迁移包已到结构 v10')
    expect(plan).toContain('桌面 SQLite 已到结构 v12')
    expect(plan).toContain('保留 V1.3 数据升级到 V1.4')
    expect(plan).toContain('事务性升级失败恢复')
    expect(plan).toContain('旧 V1.3 API 对升级数据库的有限读取回退')
    expect(plan).toContain('桌面试点产物也已构建并通过打包冒烟')
    expect(plan).toContain('该日期的计划不宣称 V1.4 已发布或已签收。')
  })

  it('keeps deferred delivery and packaging work outside v1.4', () => {
    expect(prd).toContain('真实 GitHub 推送、PR 创建、合并或分支发布（留给 V1.5）')
    expect(prd).toContain('签名/公证安装器')
    expect(prd).toContain('auto-update')
  })
})
