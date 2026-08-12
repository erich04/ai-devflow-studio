import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('V1.5 README truth', () => {
  it('records the released V1.5 GitHub Delivery baseline and active V2.0 line', () => {
    const readme = readFileSync('README.md', 'utf8')

    expect(readme).toContain('`v1.5.0` is released and the finite 1.x line is complete')
    expect(readme).toContain('V2.0 Native Agent Runtime implementation is now the active priority')
    expect(readme).toContain('Delivery Intent')
    expect(readme).toContain('signed Web approval')
    expect(readme).toContain('GitHub App')
    expect(readme).toContain('Draft pull request')
    expect(readme).toContain('never merges')
    expect(readme).not.toContain('planned GitHub delivery integration')
    expect(readme).not.toContain(
      'The PR stage creates a reviewable handoff artifact. It does not silently push, open, merge, or publish a real GitHub pull request.',
    )
  })

  it('indexes the two V1.5 deterministic/package gates and current operator walkthrough', () => {
    const readme = readFileSync('README.md', 'utf8')

    expect(readme).toContain('corepack pnpm test:v15-github-delivery')
    expect(readme).toContain('corepack pnpm test:v15-github-delivery-packaged-smoke')
    expect(readme).toContain('docs/guides/devflow-studio-v1.5-walkthrough.md')
    expect(readme).toContain('Team schema v15')
    expect(readme).toContain('Desktop schema v19')
    expect(readme).toContain('accepted action count remains exactly one after cold restart')
    expect(readme).toContain('provider-authoritative expiry')
    expect(readme).toContain('verified publication adoption')
  })
})
