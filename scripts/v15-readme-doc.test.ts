import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('V1.5 README truth', () => {
  it('distinguishes implemented GitHub Delivery from the still-current v1.4 release', () => {
    const readme = readFileSync('README.md', 'utf8')

    expect(readme).toContain('`v1.4.0` remains the current release')
    expect(readme).toContain('V1.5 GitHub Delivery implementation is complete')
    expect(readme).toContain('release and 1.x completion gate remain pending')
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
    expect(readme).toContain('Team schema v13')
    expect(readme).toContain('Desktop schema v17')
    expect(readme).toContain('provider-authoritative expiry')
  })
})
