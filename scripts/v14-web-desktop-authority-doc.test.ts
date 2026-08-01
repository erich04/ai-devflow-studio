import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const adrPath = join(
  process.cwd(),
  'docs/adr/0012-web-desktop-work-authority.md',
)

function readAdr(): string {
  return existsSync(adrPath)
    ? readFileSync(adrPath, 'utf8').replace(/\s+/gu, ' ')
    : ''
}

describe('ADR 0012 Web/Desktop work authority contract', () => {
  it('assigns versioned intake and commands to Team while Desktop owns the canonical full Run', () => {
    const adr = readAdr()

    expect(adr).toContain('# ADR 0012: Web/Desktop Work Authority')
    expect(adr).toContain('Team owns the versioned Work Request and Gate Command records')
    expect(adr).toContain('Desktop owns the canonical full-fidelity local Run')
    expect(adr).toContain('explicitly claims')
    expect(adr).toContain('Team Run Projection')
    expect(adr).toContain('Web never directly mutates a Team Run Projection')
    expect(adr).toContain('does not copy the Electron workflow state machine')
  })

  it('turns a Web Gate action into an authenticated version-bound Desktop command lifecycle', () => {
    const adr = readAdr()

    expect(adr).toContain('signed browser Session Cookie')
    expect(adr).toContain('paired Desktop Bearer Token')
    expect(adr).toContain('live project membership and role')
    expect(adr).toContain('idempotency key')
    expect(adr).toContain('expectedRunVersion')
    expect(adr).toContain('expectedPolicyVersion')
    expect(adr).toContain('server-side preflight')
    expect(adr).toContain('inbox → receipt → apply → acknowledgement')
    expect(adr).toContain('re-evaluates the full local evidence')
    expect(adr).toContain('Only a later canonical Desktop summary advances the Team Run Projection')
  })

  it('defines deterministic duplicate, concurrent, stale, expiry, and crash recovery semantics', () => {
    const adr = readAdr()

    expect(adr).toContain('same idempotency key and fingerprint returns the original result')
    expect(adr).toContain('same key with a different fingerprint is a `409 Conflict`')
    expect(adr).toContain('exactly one active command')
    expect(adr).toContain('expired command is never delivered or applied')
    expect(adr).toContain('stale_run')
    expect(adr).toContain('stale_policy')
    expect(adr).toContain('receipt lease expires')
    expect(adr).toContain('applied before acknowledgement')
    expect(adr).toContain('must not apply the transition twice')
    expect(adr).toContain('one claimant wins')
  })

  it('requires an append-only redacted audit without uploading private repository content', () => {
    const adr = readAdr()

    expect(adr).toContain('Audit is append-only')
    expect(adr).toContain('claim/release')
    expect(adr).toContain(
      'command submission, server preflight, receipt, acknowledgement, and expiry',
    )
    expect(adr).toContain('never stores Cookies, Bearer Tokens, API keys, or provider credentials')
    expect(adr).toContain('bounded allowlist projection')
    expect(adr).toContain(
      'raw repository Markdown, source files, prompts, stdout, stderr, patches, and absolute local paths',
    )
    expect(adr).toContain('local repository content is not uploaded')
    expect(adr).toContain('## Rejected alternatives')
  })
})
