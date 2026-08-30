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
      expect(markdown).toContain('Delivery Intent')
      expect(markdown).toContain('Delivery Request')
      expect(markdown).toContain('GitHub App')
      expect(markdown).toContain('Draft pull request')
    }

    expect(productDefinition).toContain('V1.5 is released as `v1.5.0`')
    expect(productDefinition).toContain('finite 1.x product line is complete')
    expect(currentPrd).toContain('finite 1.x completion gate passed')
    expect(currentPrd).toContain('V2.0 Native Agent Runtime is complete')
    expect(currentPrd).toContain('V2.1 Evaluated Retrieval and Memory is complete')
    expect(currentPrd).toContain('V2.2 Multi-Agent and Execution Tenancy is the')
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
      expect(markdown).toContain('never merge')
    }
  })

  it('documents current V1.5 verification layers without authorizing paid-provider work', () => {
    const testingStrategy = read('docs/engineering/testing-strategy.md')
    const demoAndSmoke = read('docs/engineering/demo-and-smoke.md')
    const v15Prd = read('docs/product/prd/v1.5-github-delivery-prd.md')

    for (const markdown of [testingStrategy, demoAndSmoke]) {
      expect(markdown).toContain('Team schema v21')
      expect(markdown).toContain('provider-authoritative expiry')
      expect(markdown).toContain('verified publication adoption')
      expect(markdown).toContain('corepack pnpm test:v15-github-delivery')
      expect(markdown).toContain('corepack pnpm test:v15-github-delivery-packaged-smoke')
      expect(markdown).toContain('corepack pnpm test:postgres-smoke')
      expect(markdown).toContain('corepack pnpm test:docker-lifecycle-smoke')
      expect(markdown).toContain('private GitHub sandbox')
      expect(markdown).toContain('does not authorize paid-provider smoke')
    }

    expect(testingStrategy).toContain('corepack pnpm test:local-auth-postgres-smoke')
    expect(demoAndSmoke).toContain('corepack pnpm test:local-auth-postgres-smoke')

    expect(testingStrategy).toContain('Desktop schema v33')
    expect(testingStrategy).toContain('Desktop schema 17-to-18')
    expect(testingStrategy).toContain('18-to-19')
    expect(testingStrategy).toContain('19-to-20')
    expect(testingStrategy).toContain('20-to-21')
    expect(testingStrategy).toContain('21-to-22')
    expect(testingStrategy).toContain('32-to-33')
    expect(testingStrategy).toContain('Local MCP')
    expect(testingStrategy).toContain('accepted action count remains exactly one after cold restart')
    expect(demoAndSmoke).toContain('Desktop schema v33')

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

    expect(demoAndSmoke).toContain('`v1.5.0` is the current release')
    expect(demoAndSmoke).toContain('Revise')
    expect(demoAndSmoke).toContain('Resume')
    expect(demoAndSmoke).toContain('Retry')
    expect(demoAndSmoke).toContain('Stop')
    expect(demoAndSmoke).toContain('Draft pull request')
    expect(demoAndSmoke).toContain('Acceptance')
    expect(demoAndSmoke).toContain('never merge')
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
    expect(postgres).toContain('Coordination')
    expect(postgres).toContain('v19-to-v20')
    expect(postgres).toContain('v20-to-v21')
    expect(postgres).toContain('local-development')
    expect(postgres).toContain('agent_runtime_summaries')
    expect(postgres).toContain('agent_runtime_projection_audits')
    expect(postgres).toContain('agent_memory_summaries')
    expect(postgres).toContain('agent_memory_projection_audits')
    expect(postgres).toContain('provider_credential_expires_at')
    expect(postgres).toContain('source_publication_id')
    expect(postgres).toContain('legacy issued credential')
    expect(postgres).toContain('fail closed')
    expect(postgres).toContain('GitHub Delivery')
    expect(postgres).toContain('GitHub App repository binding')
    expect(postgres).toContain('Delivery Request')
    expect(postgres).toContain('signed Web approval')
    expect(postgres).toContain('credential grant')
    expect(postgres).toContain('Draft')
    expect(postgres).toContain('revocation')
    expect(postgres).toContain('redacted')
    expect(postgres).toContain('does not authorize paid-provider smoke')

    expect(electron).toContain('Desktop schema v26')
    expect(electron).toContain('Local MCP')
    expect(electron).toContain('accepted action count remains exactly one after cold restart')
    expect(electron).toContain('corepack pnpm test:v15-github-delivery-packaged-smoke')
    expect(electron).toContain('V1.5 GitHub Delivery')
    expect(electron).toContain('Revise')
    expect(electron).toContain('Resume')
    expect(electron).toContain('Retry')
    expect(electron).toContain('Stop')
    expect(electron).toContain('Draft pull request')
    expect(electron).toContain('Acceptance')
    expect(electron).toContain('never merge')
    expect(electron).toContain('renderer')
    expect(electron).toContain('does not authorize paid-provider smoke')
  })

  it('keeps paid OpenCode smoke conditional and marks the generic V1.3 walkthrough historical', () => {
    const opencodeSignoff = read('docs/knowledge/checklists/opencode-runtime-signoff.md')
    const historicalWalkthrough = read('docs/guides/devflow-studio-full-feature-walkthrough.md')

    expect(opencodeSignoff).not.toContain('For every future product release')
    expect(opencodeSignoff).toContain(
      'V1.5 does not require or authorize another paid-provider smoke',
    )
    expect(opencodeSignoff).toContain('candidate-bound authorization')

    expect(historicalWalkthrough).toContain('Historical V1.3 guide')
    expect(historicalWalkthrough).toContain('../engineering/demo-and-smoke.md')
    expect(historicalWalkthrough).toContain('./devflow-studio-v1.5-walkthrough.md')
    expect(historicalWalkthrough).toContain('does not authorize paid-provider smoke')
    expect(historicalWalkthrough).not.toContain('`v1.3.0` 候选与后续产品体验基线')
  })

  it('keeps the backend matrix and UI rationale aligned with implemented V1.5 delivery', () => {
    const backendMatrix = read('docs/engineering/backend-data-source-matrix.md')
    const uiRationale = read('docs/product/details/ui-design-rationale.md')

    for (const markdown of [backendMatrix, uiRationale]) {
      expect(markdown).toContain('PR Delivery Package')
      expect(markdown).toContain('Delivery Intent')
      expect(markdown).toContain('Delivery Request')
      expect(markdown).toContain('GitHub App repository binding')
      expect(markdown).toContain('signed Web approval')
      expect(markdown).toContain('Draft pull request')
      expect(markdown).toContain('Revise')
      expect(markdown).toContain('Resume')
      expect(markdown).toContain('Retry')
      expect(markdown).toContain('Stop')
    }

    expect(backendMatrix).toContain('Team schema v21')
    expect(backendMatrix).toContain('Desktop schema v33')
    expect(backendMatrix).toContain('Agent Runtime')
    expect(backendMatrix).toContain('Local MCP')
    expect(backendMatrix).toContain('provider-authoritative expiry')
    expect(backendMatrix).toContain('verified publication adoption')
    expect(backendMatrix).toContain('remote_sync_outbox')
    expect(backendMatrix).not.toContain('durable outbox/backoff 留到 v1.4')
    expect(backendMatrix).not.toContain('Durable sync outbox/backoff：')

    expect(uiRationale).toContain('production path 已接入 Electron IPC、API/Postgres 和 SQLite')
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
      'test evidence, governed pull-request delivery, and business acceptance',
    )

    for (const markdown of [keynote, prReview]) {
      expect(markdown).toContain('PR Delivery Package')
      expect(markdown).toContain('Delivery Intent')
      expect(markdown).toContain('Delivery Request')
      expect(markdown).toContain('signed Web approval')
      expect(markdown).toContain('verified remote head')
      expect(markdown).toContain('Draft pull request')
      expect(markdown).toContain('never merge')
    }

    expect(keynote).not.toContain('a handoff artifact for later PR creation')
    expect(keynote).toContain('first-party Agent Runtime')
    expect(prdIndex).toContain('Implemented final 1.x feature contract')
    expect(prdIndex).toContain('release/signoff pending')

    expect(lessons).toContain('Team schema v21')
    expect(lessons).toContain('v11-to-v12')
    expect(lessons).toContain('v12-to-v13')
    expect(lessons).toContain('provider-authoritative expiry')
    expect(lessons).toContain('verified publication adoption')
    expect(lessons).toContain('GitHub App repository binding')
    expect(lessons).toContain('Delivery Request')
    expect(lessons).toContain('Draft completion')
  })
})
