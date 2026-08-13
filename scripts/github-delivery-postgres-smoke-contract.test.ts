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

  it('migrates a populated retained v12 legacy credential to v13 without inventing expiry proof', () => {
    expectInOrder(source, [
      'const retainedV12Fixture = await prepareRetainedV12CredentialFixture(',
      "['pnpm', '--filter', '@ai-devflow/api', 'db:setup']",
      'await assertRetainedV12CredentialAfterCurrentMigration(retainedV12Fixture)',
    ])
    expect(source).toContain('version: 12')
    expect(source).toContain('snapshotBeforeV12')
    expect(source).toContain('retainedRowWithoutV12Fields')
    expect(source).toContain('github_delivery_requests_series_attempt_unique')
    expect(source).toContain('snapshotBeforeV13')
    expect(source).toContain('provider_expiry_contract_version')
    expect(source).toContain('provider_credential_expires_at')
    expect(source).toContain('provider_expiry_observed_at')
    expect(source).toContain('credential_provider_expiry_confirmed')
    expect(source).toContain(
      'github_delivery_grants_provider_expiry_contract',
    )
    expect(source).toContain("expiryConfirmationError?.code === '23514'")
    expect(source).toContain('retainedGrantWithoutV13Fields')
    expect(source).toContain('snapshotBeforeV15')
    expect(source).toContain('retainedPublicationWithoutV15Fields')
    expect(source).toContain('source_publication_id')
    expect(source).toContain('github_branch_publications_authority_exactly_one')
    expect(source).toContain("publicationAuthorityError?.code === '23514'")
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
    expect(fixture).toContain("const repositoryOwner = repository.split('/')[0]")
    expect(fixture).toContain("const ownerQualifiedHead = String(body['head'] ?? '')")
    expect(fixture).toContain('const expectedHeadPrefix = `${repositoryOwner}:`')
    expect(fixture).toContain('ref: headBranch')
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
    expect(source).toContain('provider_retry_not_before')
    expect(source).toContain("'authorization'")
    expect(source).toContain("'privatekey'")
    expect(source).toContain("'rawpath'")
    expect(source).toContain(
      'await assertGitHubDeliveryDatabaseState({',
    )
  })

  it('exercises the metadata-only Agent Runtime projection through the public sync API', () => {
    expectInOrder(source, [
      "'/api/sync/run-summary'",
      "'/api/sync/agent-runtime-summary'",
      'await assertAgentRuntimeProjectionDatabaseState({',
    ])
    expect(source).toContain('agent_runtime_summaries')
    expect(source).toContain('agent_runtime_projection_audits')
    expect(source).toContain("runtimeConstraintError?.code === '23514'")
    expect(source).toContain('runtimeVersion: 2')
    expect(source).toContain('checkpointVersion: 2')
    expect(source).toContain('rawOutput')
    expect(source).toContain('agentRuntimeSummaries')
  })
})
