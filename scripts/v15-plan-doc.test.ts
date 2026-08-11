import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8')

describe('v1.5 GitHub Delivery contract', () => {
  it('defines a finite product outcome and one authenticated delivery story', () => {
    const prd = read('docs/product/prd/v1.5-github-delivery-prd.md')

    expect(prd).toContain('## Problem Statement')
    expect(prd).toContain('## Solution')
    expect(prd).toContain('## User Stories')
    expect(prd).toContain('## Implementation Decisions')
    expect(prd).toContain('## Testing Decisions')
    expect(prd).toContain('## Out of Scope')
    expect(prd).toContain('managed worktree')
    expect(prd).toContain('expected commit')
    expect(prd).toContain('explicit human approval')
    expect(prd).toContain('Draft pull request')
    expect(prd).toContain('revocation')
    expect(prd).toContain('idempotent')
    expect(prd).toContain('Acceptance')
  })

  it('chooses a GitHub App without widening the identity OAuth boundary', () => {
    const adr = read('docs/adr/0013-github-app-delivery-authority.md')

    expect(adr).toContain('Status: Accepted')
    expect(adr).toContain('GitHub App')
    expect(adr).toContain('installation access token')
    expect(adr).toContain('one repository')
    expect(adr).toContain('Contents: write')
    expect(adr).toContain('Pull requests: write')
    expect(adr).toContain('signed browser session')
    expect(adr).toContain('Desktop bearer authority cannot approve')
    expect(adr).toContain('independently reads the remote branch head')
    expect(adr).toContain('one hour')
    expect(adr).toContain('renderer')
    expect(adr).toContain('read:user user:email')
    expect(adr).toContain('never merge')
    expect(adr).toContain('never force-push')
  })

  it('defines vertical delivery slices and blocks 2.x until the 1.x gate passes', () => {
    const plan = read('docs/plans/v1.5-github-delivery.md')

    expect(plan).toContain('## Slice 1 — Delivery Intent')
    expect(plan).toContain('## Slice 2 — Durable Approval')
    expect(plan).toContain('## Slice 3 — Repository-Scoped GitHub App Credential')
    expect(plan).toContain('## Slice 4 — Idempotent Branch Publication')
    expect(plan).toContain('## Slice 5 — Draft Pull Request')
    expect(plan).toContain('## Slice 6 — Recovery, Revocation, And Operator UX')
    expect(plan).toContain('## Slice 7 — 1.x Completion Gate')
    expect(plan).toContain('2.x implementation remains blocked')
  })

  it('indexes the scoped contract from the existing documentation entrypoints', () => {
    const prdIndex = read('docs/product/prd/README.md')
    const roadmap = read('docs/roadmap.md')

    expect(prdIndex).toContain('v1.5-github-delivery-prd.md')
    expect(roadmap).toContain('v1.5-github-delivery-prd.md')
    expect(roadmap).toContain('0013-github-app-delivery-authority.md')
    expect(roadmap).toContain('v1.5-github-delivery.md')
  })

  it('documents the bounded GitHub App setup and recoverable operator path', () => {
    const guide = read('docs/guides/devflow-studio-self-hosted-pilot.md')

    expect(guide).toContain('## Configure GitHub Delivery')
    expect(guide).toContain('DEVFLOW_GITHUB_APP_ID')
    expect(guide).toContain('DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64')
    expect(guide).toContain('Contents: write')
    expect(guide).toContain('Pull requests: write')
    expect(guide).toContain('selected repositories')
    expect(guide).toContain('approval_required')
    expect(guide).toContain('recovery_required')
    expect(guide).toContain('creating_pr')
    expect(guide).toContain('never force-push')
    expect(guide).toContain('never merge')
    expect(guide).toContain('installation access token')
    expect(guide).toContain('Desktop main memory')
  })
})
