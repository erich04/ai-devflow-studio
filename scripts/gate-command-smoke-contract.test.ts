import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function expectInOrder(source: string, fragments: string[]): void {
  let cursor = -1
  for (const fragment of fragments) {
    const next = source.indexOf(fragment, cursor + 1)
    expect(next, `Missing or out-of-order smoke step: ${fragment}`).toBeGreaterThan(
      cursor,
    )
    cursor = next
  }
}

describe.each([
  ['Postgres', 'scripts/postgres-smoke.mjs'],
  ['Docker', 'scripts/docker-smoke.mjs'],
])('%s Gate Command vertical smoke contract', (_name, path) => {
  const source = readFileSync(path, 'utf8')

  it('uses signed browser Cookie authority followed by paired Desktop Bearer authority', () => {
    expect(source).toContain('DEVFLOW_SESSION_SECRET')
    expect(source).toContain('cookie: pilotSessionCookie')
    expect(source).toContain('authorization: `Bearer ${token}`')
  })

  it('covers the authoritative Work Request and Gate delivery sequence', () => {
    expectInOrder(source, [
      '/api/team/projects/p-payments/work-requests',
      '/api/desktop/work-requests/${workRequest.id}/claim',
      '/api/desktop/work-requests/${workRequest.id}/materialized',
      '/api/sync/run-summary',
      '/api/enforcement/evaluate',
      '/api/team/projects/p-payments/gate-commands',
      '/api/desktop/projects/p-payments/gate-commands/inbox',
      '/api/desktop/gate-commands/${command.id}/receipts',
      '/api/desktop/gate-command-receipts/${receipt.id}/acknowledgements',
    ])
    expect(source).toContain("version: 3")
    expect(source).toContain("status: 'paused_at_gate'")
    expect(source).toContain("outcomeCode: 'human_rejected'")
  })

  it('asserts Team projection immutability and credential non-disclosure', () => {
    expect(source).toMatch(
      /teamRun\.version === teamRunBefore(?:Ack|Acknowledgement)\.version/,
    )
    expect(source).toMatch(
      /teamRun\.status === teamRunBefore(?:Ack|Acknowledgement)\.status/,
    )
    expect(source).toMatch(
      /teamRun\.currentNodeId ===\s*teamRunBefore(?:Ack|Acknowledgement)\.currentNodeId/,
    )
    expect(source).toContain('expectNoCredentialLeak(')
  })
})

describe('Postgres authority race smoke contract', () => {
  const source = readFileSync('scripts/postgres-smoke.mjs', 'utf8')

  it('runs concurrent Gate create and release-versus-upload operations', () => {
    expect(source).toContain('const concurrentGateResults = await Promise.all([')
    expect(source).toContain("'201,409'")
    expect(source).toContain("'active_command_conflict'")
    expect(source).toContain('activeRaceCommands.length === 1')
    expect(source).toContain('const releaseRaceResults = await Promise.all([')
    expect(source).toContain('work-request:release:${releaseRaceRunId}')
    expect(source).toContain('length === 1 &&')
    expect(source).toContain('projection state did not match its single winning operation')
  })
})
