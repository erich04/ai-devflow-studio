import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(relativePath, 'utf8')

describe('V1.5 living documentation truth', () => {
  it('describes governed GitHub Delivery as implemented without claiming V1.5 is released', () => {
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

    expect(productDefinition).toContain('V1.5 implementation is complete')
    expect(productDefinition).toContain('v1.4.0 remains the current release')
    expect(currentPrd).toContain('V1.5 release and the 1.x completion gate remain pending')
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

    for (const markdown of [testingStrategy, demoAndSmoke]) {
      expect(markdown).toContain('Team schema v12')
      expect(markdown).toContain('Desktop schema v15')
      expect(markdown).toContain('corepack pnpm test:v15-github-delivery')
      expect(markdown).toContain('corepack pnpm v15-github-delivery-packaged-smoke')
      expect(markdown).toContain('corepack pnpm test:postgres-smoke')
      expect(markdown).toContain('corepack pnpm test:docker-lifecycle-smoke')
      expect(markdown).toContain('private GitHub sandbox')
      expect(markdown).toContain('does not authorize paid-provider smoke')
    }

    expect(demoAndSmoke).toContain('v1.4.0 remains the current release')
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

    expect(postgres).toContain('Team schema v12')
    expect(postgres).toContain('v11-to-v12')
    expect(postgres).toContain('GitHub Delivery')
    expect(postgres).toContain('GitHub App repository binding')
    expect(postgres).toContain('Delivery Request')
    expect(postgres).toContain('signed Web approval')
    expect(postgres).toContain('credential grant')
    expect(postgres).toContain('Draft')
    expect(postgres).toContain('revocation')
    expect(postgres).toContain('redacted')
    expect(postgres).toContain('does not authorize paid-provider smoke')

    expect(electron).toContain('Desktop schema v15')
    expect(electron).toContain('corepack pnpm v15-github-delivery-packaged-smoke')
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
})
