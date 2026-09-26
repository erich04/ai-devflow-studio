import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(relativePath, 'utf8')

describe('V1.5 living documentation truth', () => {
  it('describes governed GitHub Delivery as the released V1.5 baseline', () => {
    const context = read('CONTEXT.md')
    const productDefinition = read('docs/product/product-definition.md')
    const currentPrd = read('docs/product/prd/current-product-prd.md')
    const workflow = read('docs/product/details/workflow.md')
    const productStates = read('docs/product/details/states-and-refactor-anchors.md')
    const objectModel = read('docs/product/details/object-model.md')
    const evidence = read('docs/product/details/evidence-and-trust.md')
    const surfaces = read('docs/product/details/surfaces.md')
    const userJobs = read('docs/product/details/user-jobs.md')
    const nodeSemantics = read('docs/product/details/workflow-node-semantics.md')

    for (const markdown of [context, productDefinition, currentPrd, workflow, objectModel]) {
      expect(markdown).toMatch(/Delivery Intent|交付意图/u)
      expect(markdown).toMatch(/Delivery Request|交付请求/u)
      expect(markdown).toContain('GitHub App')
      expect(markdown).toMatch(/Draft pull request|草稿拉取请求|草稿 PR/u)
    }

    expect(productDefinition).toContain('V1.5 已发布为 `v1.5.0`')
    expect(productDefinition).toContain('1.x 产品线已完成')
    expect(currentPrd).toContain('1.x 完成门禁已通过')
    expect(currentPrd).toContain('V2.0 原生 Agent 运行时已完成')
    expect(currentPrd).toContain('V2.1 检索与记忆评估已完成')
    expect(currentPrd).toContain('V2.2 多 Agent 与执行租户隔离是')
    expect(currentPrd).not.toContain(
      'Real GitHub PR creation, pushing, merging, and branch publication require a future scoped PRD',
    )
    expect(workflow).not.toContain(
      'v1.3 does not create real GitHub PRs, push branches, or merge code',
    )
    expect(productStates).not.toContain('GitHub delivery integration after PR draft is stable')
    expect(productStates).not.toContain('Autonomous push, merge, or PR creation')

    for (const markdown of [evidence, surfaces, userJobs, nodeSemantics]) {
      expect(markdown).toContain('GitHub Delivery')
      expect(markdown).toContain('Draft')
      expect(markdown).toContain('Acceptance')
    }

    for (const markdown of [
      context,
      productDefinition,
      currentPrd,
      workflow,
      productStates,
      objectModel,
      evidence,
      surfaces,
      userJobs,
      nodeSemantics,
    ]) {
      expect(markdown).toMatch(/never merge|不会合并|绝不合并/u)
    }
  })

  it('documents current V1.5 verification layers without authorizing paid-provider work', () => {
    const testingStrategy = read('docs/engineering/testing-strategy.md')
    const demoAndSmoke = read('docs/engineering/demo-and-smoke.md')
    const v15Prd = read('docs/product/prd/v1.5-github-delivery-prd.md')

    for (const markdown of [testingStrategy, demoAndSmoke]) {
      expect(markdown).toContain('Team schema v21')
      expect(markdown).toMatch(/provider-authoritative expiry|服务商权威过期/u)
      expect(markdown).toMatch(/verified publication adoption|已验证发布证据采用/u)
      expect(markdown).toContain('corepack pnpm test:v15-github-delivery')
      expect(markdown).toContain('corepack pnpm test:v15-github-delivery-packaged-smoke')
      expect(markdown).toContain('corepack pnpm test:postgres-smoke')
      expect(markdown).toContain('corepack pnpm test:docker-lifecycle-smoke')
      expect(markdown).toMatch(/private GitHub sandbox|私有 GitHub 沙箱/u)
      expect(markdown).toMatch(/does not authorize paid-provider smoke|不授权付费服务商冒烟/u)
    }

    expect(testingStrategy).toContain('corepack pnpm test:local-auth-postgres-smoke')
    expect(demoAndSmoke).toContain('corepack pnpm test:local-auth-postgres-smoke')

    expect(testingStrategy).toContain('Desktop schema v35')
    expect(testingStrategy).toContain('Desktop schema 17→18')
    expect(testingStrategy).toContain('18→19')
    expect(testingStrategy).toContain('19→20')
    expect(testingStrategy).toContain('20→21')
    expect(testingStrategy).toContain('21→22')
    expect(testingStrategy).toContain('32→33')
    expect(testingStrategy).toContain('Local MCP')
    expect(testingStrategy).toContain('冷启动后已接受动作数仍精确为一')
    expect(demoAndSmoke).toContain('Desktop schema v35')

    for (const command of [
      'corepack pnpm test:build-output-smoke',
      'corepack pnpm test:docker-smoke',
      'corepack pnpm build:desktop-pilot',
      'corepack pnpm test:desktop-pilot-smoke',
    ]) {
      expect(testingStrategy).toContain(command)
    }

    expect(v15Prd).toContain('Lifecycle: Implemented; release/signoff pending')
    expect(testingStrategy).toContain('ai-devflow-studio-v22-candidate-desktop')

    expect(demoAndSmoke).toContain('当前发布版本为 `v1.5.0`')
    expect(demoAndSmoke).toContain('Revise')
    expect(demoAndSmoke).toContain('Resume')
    expect(demoAndSmoke).toContain('Retry')
    expect(demoAndSmoke).toContain('Stop')
    expect(demoAndSmoke).toContain('Draft PR')
    expect(demoAndSmoke).toContain('业务验收')
    expect(demoAndSmoke).toContain('绝不能合并')
  })

  it('keeps Postgres and packaged Electron readiness checklists on current schemas and delivery truth', () => {
    const postgres = read('docs/knowledge/checklists/postgres-smoke-readiness.md')
    const electron = read('docs/knowledge/checklists/electron-demo-readiness.md')

    expect(postgres).toContain('Team schema v21')
    expect(postgres).toContain('v11-to-v12')
    expect(postgres).toContain('v12-to-v13')
    expect(postgres).toContain('v14-to-v15')
    expect(postgres).toContain('v15-to-v16')
    expect(postgres).toContain('v16-to-v17')
    expect(postgres).toContain('v17-to-v18')
    expect(postgres).toContain('协作')
    expect(postgres).toContain('v19-to-v20')
    expect(postgres).toContain('v20-to-v21')
    expect(postgres).toContain('local-development')
    expect(postgres).toContain('agent_runtime_summaries')
    expect(postgres).toContain('agent_runtime_projection_audits')
    expect(postgres).toContain('agent_memory_summaries')
    expect(postgres).toContain('agent_memory_projection_audits')
    expect(postgres).toContain('provider_credential_expires_at')
    expect(postgres).toContain('source_publication_id')
    expect(postgres).toContain('旧版已签发凭据')
    expect(postgres).toContain('在无法确认时拒绝放行')
    expect(postgres).toContain('GitHub 交付')
    expect(postgres).toContain('GitHub App 仓库绑定')
    expect(postgres).toContain('交付请求')
    expect(postgres).toContain('签名 Web 审批')
    expect(postgres).toContain('凭据授权')
    expect(postgres).toContain('草稿 PR')
    expect(postgres).toContain('撤销')
    expect(postgres).toContain('脱敏')
    expect(postgres).toContain('不授权付费模型冒烟测试')

    expect(electron).toContain('Desktop schema v26')
    expect(electron).toContain('本地 MCP')
    expect(electron).toContain('冷启动后已接受动作数仍精确为一')
    expect(electron).toContain('corepack pnpm test:v15-github-delivery-packaged-smoke')
    expect(electron).toContain('V1.5 GitHub 交付')
    expect(electron).toContain('Revise')
    expect(electron).toContain('Resume')
    expect(electron).toContain('Retry')
    expect(electron).toContain('Stop')
    expect(electron).toContain('草稿 PR')
    expect(electron).toContain('业务验收')
    expect(electron).toContain('绝不能合并')
    expect(electron).toContain('渲染进程')
    expect(electron).toContain('不授权付费模型冒烟测试')
  })

  it('keeps paid OpenCode smoke conditional and marks the generic V1.3 walkthrough historical', () => {
    const opencodeSignoff = read('docs/knowledge/checklists/opencode-runtime-signoff.md')
    const historicalWalkthrough = read('docs/guides/devflow-studio-full-feature-walkthrough.md')

    expect(opencodeSignoff).not.toContain('For every future product release')
    expect(opencodeSignoff).toContain(
      'V1.5 不要求也不授权再次进行付费模型冒烟测试',
    )
    expect(opencodeSignoff).toContain('与候选版本绑定的单独授权')

    expect(historicalWalkthrough).toContain('V1.3 历史指南')
    expect(historicalWalkthrough).toContain('../engineering/demo-and-smoke.md')
    expect(historicalWalkthrough).toContain('./devflow-studio-v1.5-walkthrough.md')
    expect(historicalWalkthrough).toContain('不授权付费服务商冒烟')
    expect(historicalWalkthrough).not.toContain('`v1.3.0` 候选与后续产品体验基线')
  })

  it('keeps the backend matrix and UI rationale aligned with implemented V1.5 delivery', () => {
    const backendMatrix = read('docs/engineering/backend-data-source-matrix.md')
    const uiRationale = read('docs/product/details/ui-design-rationale.md')

    for (const markdown of [backendMatrix, uiRationale]) {
      expect(markdown).toMatch(/PR Delivery Package|PR 交付包/u)
      expect(markdown).toMatch(/Delivery Intent|交付意图/u)
      expect(markdown).toMatch(/Delivery Request|交付请求/u)
      expect(markdown).toMatch(/GitHub App repository binding|GitHub App 仓库绑定/u)
      expect(markdown).toMatch(/signed Web approval|签名 Web\s*审批/u)
      expect(markdown).toMatch(/Draft pull request|草稿拉取请求|草稿 PR/u)
      expect(markdown).toContain('Revise')
      expect(markdown).toContain('Resume')
      expect(markdown).toContain('Retry')
      expect(markdown).toContain('Stop')
    }

    expect(backendMatrix).toContain('Team schema v21')
    expect(backendMatrix).toContain('Desktop schema v35')
    expect(backendMatrix).toContain('Agent 运行时')
    expect(backendMatrix).toContain('本地 MCP')
    expect(backendMatrix).toContain('提供方确认的过期时间')
    expect(backendMatrix).toContain('已核实发布的采用来源')
    expect(backendMatrix).toContain('remote_sync_outbox')
    expect(backendMatrix).not.toContain('durable outbox/backoff 留到 v1.4')
    expect(backendMatrix).not.toContain('Durable sync outbox/backoff：')

    expect(uiRationale).toContain('生产链路已接入 Electron IPC、API/Postgres 和 SQLite')
    expect(uiRationale).not.toContain('但在当前原型里，它仍然是前端模拟')
    expect(uiRationale).not.toContain('真实实现时需要接入：')
  })

  it('keeps product narrative, indexes, and review knowledge on governed delivery truth', () => {
    const context = read('CONTEXT.md')
    const keynote = read(
      'docs/product/design-references/ai-devflow-studio-keynote-decisions.md',
    )
    const prdIndex = read('docs/product/prd/README.md')
    const lessons = read('docs/engineering/lessons-learned.md')
    const prReview = read('docs/knowledge/checklists/pr-review.md')

    expect(context).toContain(
      '测试证据、受控的拉取请求交付，以及业务验收',
    )

    for (const markdown of [keynote, prReview]) {
      expect(markdown).toMatch(/PR Delivery Package|PR 交付包/u)
      expect(markdown).toMatch(/Delivery Intent|交付意图/u)
      expect(markdown).toMatch(/Delivery Request|交付请求/u)
      expect(markdown).toMatch(/signed Web approval|签名 Web\s*审批/u)
      expect(markdown).toMatch(/verified remote head|已核实的远端分支提交/u)
      expect(markdown).toMatch(/Draft pull request|草稿拉取请求|草稿 PR/u)
      expect(markdown).toMatch(/never merge|不会合并|绝不合并/u)
    }

    expect(keynote).not.toContain('a handoff artifact for later PR creation')
    expect(keynote).toContain('自有 Agent 运行时')
    expect(prdIndex).toContain('已实现的 1.x 最终功能契约')
    expect(prdIndex).toContain('发布/验收待完成')

    expect(lessons).toContain('Team schema v21')
    expect(lessons).toContain('v11→v12')
    expect(lessons).toContain('v12→v13')
    expect(lessons).toContain('服务商权威过期')
    expect(lessons).toContain('已核验发布证据采用')
    expect(lessons).toContain('GitHub App 仓库绑定')
    expect(lessons).toContain('交付请求')
    expect(lessons).toContain('Draft 完成')
  })
})
