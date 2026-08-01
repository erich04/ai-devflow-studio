import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const roadmap = readFileSync(join(process.cwd(), 'docs/roadmap.md'), 'utf8')
const prd = readFileSync(
  join(process.cwd(), 'docs/product/prd/v1.4-pilot-trust-boundary-prd.md'),
  'utf8',
)
const plan = readFileSync(
  join(process.cwd(), 'docs/plans/v1.4-pilot-trust-boundary.md'),
  'utf8',
)

describe('v1.4 pilot trust boundary contract', () => {
  it('records the released v1.3 baseline and the executable v1.4 scope', () => {
    expect(roadmap).toContain('`v1.3.0` is the released baseline')
    expect(roadmap).toContain('v1.4-pilot-trust-boundary-prd.md')
    expect(roadmap).toContain('v1.4-pilot-trust-boundary.md')
    expect(roadmap).toContain('durable remote-sync outbox')
    expect(roadmap).toContain(
      'V1.4 scoped implementation complete from `b7b879c`; candidate formation pending',
    )
    expect(roadmap).toContain('Remains `1.3.0` until V1.4 candidate formation')
    expect(prd).toContain(
      'Status: Implementation complete; candidate formation and formal signoff pending',
    )
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
