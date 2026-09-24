import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('release README truth', () => {
  it('distinguishes the published V2.3 package from subsequent main-source changes', () => {
    const readme = readFileSync('README.md', 'utf8')

    expect(readme).toContain('the latest published release is')
    expect(readme).toContain('`v2.3.0`')
    expect(readme).toContain('releases/tag/v2.3.0')
    expect(readme).toContain('current `main` source')
    expect(readme).toContain('the published installer does not acquire them automatically')
    expect(readme).toContain('docs/releases/v2.3.0/notes.md')
    expect(readme).toContain('Candidate verification and formal signoff are recorded separately')
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

  it('indexes delivery verification and the current product boundaries', () => {
    const readme = readFileSync('README.md', 'utf8')

    expect(readme).toContain('corepack pnpm test:v15-github-delivery')
    expect(readme).toContain('corepack pnpm test:v15-github-delivery-packaged-smoke')
    expect(readme).toContain('docs/guides/devflow-studio-v1.5-walkthrough.md')
    expect(readme).toContain('trusted local stdio MCP')
    expect(readme).toContain('scope, revision, expiry, and deletion checks')
    expect(readme).toContain('Automatic learning after every Coding Run is not implemented')
    expect(readme).toContain('DEVFLOW_MULTI_ORGANIZATION_ENABLED=true')
    expect(readme).toContain('Default onboarding remains single-team')
    expect(readme).toContain('historical `/legacy-shell` URL redirects')
    expect(readme).toContain('docs/engineering/testing-strategy.md')
  })
})
