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
    expect(roadmap).toContain('`v2.2.0` is the released baseline')
    expect(roadmap).toContain('Released `v1.4.0`')
    expect(roadmap).toContain('docs/releases/v1.4.0/')
    expect(roadmap).toContain('v1.4-pilot-trust-boundary-prd.md')
    expect(roadmap).toContain('v1.4-pilot-trust-boundary.md')
    expect(roadmap).toContain('durable sync outbox')
    expect(roadmap).not.toContain('V1.4 scoped implementation complete at `5b64354`')
    expect(roadmap).not.toContain('Version alignment occurs during V1.4 candidate formation')
    expect(prd).toContain('## Product Outcome')
    expect(prd).toContain('## Release Musts')
    expect(prd).toContain('Lifecycle: Released as `v1.4.0`')
    expect(plan).toContain('Lifecycle: Completed and released as `v1.4.0`')
    expect(releaseSignoffPlan).toContain(
      'Lifecycle: Completed; `v1.4.0` was signed off, tagged, and published',
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

    expect(roadmap).toContain('V1.4 API Review knowledge provenance remains `none`')
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
    expect(prd).toContain('The durable outbox is a V1.4 release requirement')
    expect(prd).toContain('Real paid runtime with no budget guard')
    expect(prd).toContain('Block as `unavailable`')
    expect(prd).toContain('explicitly saved `enabled: false` policy')
    expect(plan).toContain('## Slice A1 — Coding Runtime Paid Budget Fail-Closed')
    expect(plan).toContain('## Slice A2 — Knowledge Review Paid Preflight And Audit')
  })

  it('records the completed durable outbox before repository knowledge integration', () => {
    expect(plan).toContain('## Slice B — Durable Remote-Sync Outbox ✅')
    expect(plan).toContain('Full unit regression passed 870/870')
    expect(plan).toContain('Slice C integration is next')
  })

  it('records completed repository knowledge and Web collaboration authority', () => {
    expect(plan).toContain('## Slice C — Repository Knowledge Integration ✅')
    expect(plan).toContain('Full unit regression passed 944/944')
    expect(plan).toContain('Web D1 completed')
    expect(plan).toContain('The Work Request vertical slice completed')
    expect(plan).toContain('Full unit regression passed 1162/1162')
    expect(plan).toContain('## Slice D — Web Management Closure ✅')
    expect(plan).toContain(
      '[x] Add the versioned Gate Command preflight, delivery, local apply, acknowledgement, and Web flow.',
    )
    expect(plan).toContain('`human_rejected` plus acknowledgement')
  })

  it('records completed reproducible lifecycle evidence without claiming release', () => {
    expect(plan).toContain('## Slice E — Reproducible Pilot Lifecycle ✅')
    expect(plan).toContain('Postgres migration bundle now reaches schema v10')
    expect(plan).toContain('Desktop SQLite reaches schema v12')
    expect(plan).toContain('retained V1.3-to-V1.4 data upgrade')
    expect(plan).toContain('transactional failed-upgrade recovery')
    expect(plan).toContain('bounded V1.3 API read rollback')
    expect(plan).toContain('Desktop pilot artifact also built and passed its packaged smoke')
    expect(plan).toContain('This plan does not claim that V1.4 is released or signed.')
  })

  it('keeps deferred delivery and packaging work outside v1.4', () => {
    expect(prd).toContain('Real GitHub push, pull-request creation, merge, or branch publication (V1.5)')
    expect(prd).toContain('signed/notarized installers')
    expect(prd).toContain('auto-update')
  })
})
