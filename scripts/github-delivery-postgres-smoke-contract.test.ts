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

describe('Postgres GitHub Delivery smoke contract', () => {
  const source = readFileSync('scripts/postgres-smoke.mjs', 'utf8')

  it('migrates a populated retained v11 delivery row to v12 without data loss', () => {
    expectInOrder(source, [
      'const retainedV11Fixture = await prepareRetainedV11DeliveryFixture(',
      "['pnpm', '--filter', '@ai-devflow/api', 'db:setup']",
      'await assertRetainedV11DeliveryAfterV12(retainedV11Fixture)',
    ])
    expect(source).toContain('version: 11')
    expect(source).toContain('snapshotBeforeV12')
    expect(source).toContain("delivery_series_key")
    expect(source).toContain("delivery_attempt")
    expect(source).toContain(
      "github_delivery_requests_series_attempt_unique",
    )
    expect(source).toContain('retainedRowWithoutV12Fields')
  })

  it('uses an offline GitHub boundary for the canonical delivery sequence', () => {
    expect(source).toContain(
      'src/test-fixtures/postgres-github-delivery-server.ts',
    )
    expectInOrder(source, [
      'const githubWorkRequest = await postJson(',
      'const githubClaim = await postJsonWithBearer(',
      'const githubMaterialization = await postJsonWithBearer(',
      'const githubRunProjection = await postJsonWithBearer(',
      'const githubBinding = await putJsonBody(',
      'const githubSubmission = await postJsonWithBearer(',
      'const githubApproval = await postJson(',
      'const githubCredential = await postJsonWithBearer(',
      'const githubPublication = await postJsonWithBearer(',
      'const githubPullRequest = await postJsonWithBearer(',
      'const githubRecoverySnapshot = await getJsonWithBearer(',
      'const githubBindingRevocation = await postJson(',
      'const blockedCredentialGrant = await postJsonResult(',
    ])

    const fixture = readFileSync(
      'apps/api/src/test-fixtures/postgres-github-delivery-server.ts',
      'utf8',
    )
    expect(fixture).toContain("url.origin !== 'https://api.github.com'")
    expect(fixture).toContain('globalThis.fetch = fakeGitHubFetch')
    expect(fixture).toContain("throw new Error('Unexpected outbound request')")
    expect(fixture).toContain("await import('../server')")
  })

  it('queries exact durable counts, authority, idempotency, audit, and leak safety', () => {
    expect(source).toContain('async function assertGitHubDeliveryDatabaseState(')
    for (const table of [
      'github_repository_bindings',
      'github_delivery_requests',
      'github_delivery_approvals',
      'github_delivery_credential_grants',
      'github_branch_publications',
      'github_pull_request_outcomes',
      'collaboration_idempotency',
      'collaboration_audit_events',
    ]) {
      expect(source).toContain(table)
    }
    expect(source).toContain('github_delivery:candidate-authority-smoke')
    expect(source).toContain('expectedGitHubOperationCounts')
    expect(source).toContain('credentialLeakNeedles')
    expect(source).toContain('forbiddenJsonFieldNames')
    expect(source).toContain("'authorization'")
    expect(source).toContain("'privatekey'")
    expect(source).toContain("'rawpath'")
    expect(source).toContain(
      'await assertGitHubDeliveryDatabaseState({',
    )
  })
})
