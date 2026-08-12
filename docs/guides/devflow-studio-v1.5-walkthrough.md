# DevFlow Studio V1.5 GitHub Delivery Walkthrough

Status: Stable operator procedure; no result claimed

This walkthrough verifies the final planned 1.x delivery boundary against one frozen Candidate
commit `C`. It proves that an authenticated Work Request can become one local, tested commit and one
human-approved GitHub Draft pull request without giving Web, the renderer, or durable storage a
repository credential. A dated result is written only after every step passes.

## Preconditions

- Use a clean checkout at the full SHA of `C` and fresh, isolated Web/API/Postgres/Desktop state.
- Use a non-sensitive fixture repository and a dedicated private GitHub sandbox repository. The
  sandbox must not be the DevFlow product repository or another production repository.
- Install the V1.5 GitHub App only on that sandbox. Grant repository Metadata read, Contents write,
  and Pull requests write; do not enable administration, merge, workflow, issue, or organization
  permissions.
- For Draft lookup and creation, the API narrows its short-lived token to the exact pair
  `Contents: read + Pull requests: write`; this lets GitHub read the approved refs without widening
  the installation or giving PR authority to Desktop.
- Keep the App private key in API process configuration. Never place the key, installation token,
  OAuth token, pairing code, Cookie, Bearer value, or credential URL in evidence or shell history.
- Use normal GitHub OAuth for browser identity, one signed Web session, one explicit Team Project,
  and one short-lived project pairing code. Development identity headers are forbidden.
- Record the candidate SHA, package digest, non-secret sandbox identity, and isolated service names
  before starting. Keep raw local paths out of the result.
- Dispatch the `Verify` workflow against the exact candidate ref. Its `macOS verify` job uploads the
  artifact named `ai-devflow-studio-v15-candidate-desktop`; that indexed archive, not a later
  runner rebuild, is the candidate Desktop artifact used by signoff and release publication.
- Download and integrity-check that exact workflow artifact before the private-sandbox run. Run the
  private-sandbox walkthrough with that exact downloaded archive; a local rebuild is not a
  substitute for the Desktop bytes that will be published.
- Signoff accepts only `run_attempt: 1`. If any Verify job fails, do not rerun that workflow run;
  correct only setup outside `C` when permitted, then dispatch a new exact-candidate Verify run.
- For this completion gate, the **non-maintainer operator** is an independent operator who does not
  author or modify `C`, release evidence, the database, or service configuration after the frozen
  run starts. The operator uses only the documented normal Web and packaged Desktop surfaces and
  does not use shell, direct HTTP, SQL, or GitHub CLI to complete or repair the product story. A
  separate setup principal may create/install the sandbox App and inject its secrets before the run;
  those setup actions and their completion time are recorded separately and are not operator steps.
  If a maintainer supplies an undocumented command, data repair, API call, or state mutation after
  the run starts, `adHocMaintainerAssistance` is true and the walkthrough fails.

## Operator Path

1. Start the candidate-bound self-hosted stack and the packaged Desktop extracted from the exact
   downloaded Verify artifact. Confirm API and Web readiness, current Team schema, fresh Desktop
   state, the artifact's recorded SHA-256, and absence of prior Delivery records.
2. Sign in through the identity-only GitHub OAuth path. In Web, select the intended Team Project and
   configure its repository binding with the sandbox installation id and repository id. Confirm the
   API resolves the canonical private repository and `main` base branch.
3. Create one project pairing code, pair Desktop, select the controlled Local Project, and synchronize
   the active repository binding. Do not retain the pairing value.
4. Create one bounded Work Request in Web. In Desktop, claim it and materialize exactly one canonical
   Run. Confirm Team did not fabricate a Run before Desktop acknowledged materialization.
5. Complete Clarify and Design through their human Gates. Execute Build in the managed worktree,
   retain its canonical diff, and run Test against the exact source commit.
6. At the PR node, create the redacted PR Delivery Package. Prepare GitHub Delivery and review the
   full repository, base/head branches, expected commit, Run version, changed paths, evidence
   digests, package digest, title, and body projection.
7. In Web, use a live lead or owner signed session to approve that exact request. Desktop bearer
   authority must be unable to approve it. Any changed commit, evidence, package, binding, or Run
   version must require **Revise** and a new approval.
8. Let Desktop obtain one short-lived, repository-scoped Contents credential in Electron main,
   publish the approved SHA to the approved `devflow/` branch without force, and report the result.
9. Let the API independently verify the remote head and create or reconcile exactly one Draft pull
   request. Confirm the PR node advances only after durable branch and Draft evidence exists. If
   GitHub returns a `403` or `422` with a canonical bounded `Retry-After`, the product must report
   `github_rate_limited` and persist only the derived provider retry not-before. Use only the
   documented Resume action: it reconciles the exact marker first and cannot create before the
   provider backoff expires.
10. Stop Desktop after the remote effect is durable, then cold-start it with the same isolated state.
    Confirm it reconciles without a second credential grant, push, or pull-request creation.
11. At Acceptance, inspect the exact remote commit, Draft URL, passing Test Evidence, and completed
    Delivery evidence. Approve Acceptance and confirm the canonical Run becomes `completed` while
    the pull request remains Draft and unmerged.
12. Revoke the repository binding in Web, return to the completed Delivery in packaged Desktop,
    and invoke **Verify credential revocation**. This bounded Electron-main probe derives the exact
    remote request from the completed local evidence and uses the encrypted pairing authority. The
    probe command/result adds no remote request or repository fields to its exact local-CAS envelope,
    and the renderer never receives the Desktop Bearer or credential response. Only the exact
    `binding_inactive` rejection passes. If an issuance reserved before revocation still has an
    unresolved non-secret quarantine marker, the probe returns `credential_revocation_pending` and
    records no passing check. Elapsed time alone never clears that marker. The operator may only wait
    and retry **Verify credential revocation** through packaged Desktop after the product has durably
    confirmed provider revocation; they must not bypass quarantine with direct HTTP, SQL, evidence
    edits, or another manual state change. A `200`/other `2xx` response is
    treated as `credential_unexpectedly_issued`: Desktop cancels the unread response body, performs
    no git/publisher/PR action, and the walkthrough fails and must restart from fresh isolated state.
13. Exercise one safe operator recovery path if needed: **Stop** moves an active local attempt to
    manual recovery; **Resume** continues the same `recovery_required` attempt; **Revise** replaces
    changed pre-publication material in the same series/attempt; **Retry** creates only the next
    attempt after `failed` or `revoked`. No action may reuse an older approval.
14. Inspect durable Team/Desktop projections and operator-visible output for secret values, raw git
    output, patch bodies, repository contents, and local absolute paths. Clean the isolated services
    and local state. Leave the sandbox Draft unmerged for evidence review; do not delete or rewrite
    its branch as part of DevFlow.

## Acceptance Criteria

The walkthrough passes only when all observations bind to the same `C` and show:

- one Work Request, one canonical Run, one managed-worktree source commit, and one Delivery attempt;
- one signed Web approval bound to the exact repository, commit, Run/evidence versions, and package;
- one short-lived credential grant, one exact branch publication, and one Draft pull request;
- remote head SHA equal to the approved expected commit SHA;
- PR and Acceptance nodes `success`, with the canonical Run `completed`;
- restart recovery with zero repeated credential, push, or pull-request side effects;
- binding revocation followed by the packaged Desktop **Verify credential revocation** action
  recording exactly one redacted durable check for the completed intent, the newer revoked binding
  version, canonical check time, and `binding_inactive` outcome only after every overlapping marker
  has a durable pre-POST credential-absence or exact-`204` revocation confirmation, with no second
  git or pull-request effect;
- no merge, force-push, tag publication, remote branch deletion, or permission widening;
- no App private key, installation token, pairing value, Cookie, Bearer value, raw patch/output,
  repository content, credential URL, or local absolute path in durable or release evidence.

A product, test, workflow, configuration, or ordinary-document change invalidates `C`; freeze a new
candidate and repeat the full matrix. A setup-only failure may be corrected without changing `C`,
but the dated result must disclose the non-sensitive correction.

## Candidate-Bound Result

After a complete pass, add exactly these four files in the direct-child signoff commit `S`:

- `docs/releases/v1.5.0/walkthrough.json`
- `docs/releases/v1.5.0/required-gates.json`
- `docs/releases/v1.5.0/github-sandbox.json`
- `docs/guides/devflow-studio-v1.5-walkthrough-result-YYYY-MM-DD.md`

The JSON and dated result record only bounded non-secret metadata. They must not include screenshots,
raw HTTP/git/provider output, source content, prompts, patches, local paths, or any credential value.
V1.5 does not authorize or require another paid OpenCode provider smoke; the V1.4 paid-smoke record
remains immutable and candidate-bound to V1.4.

Use these exact record shapes. Replace every example identity, numeric version/count, role, URL, and
angle-bracket placeholder with the observed non-secret value while preserving the exact keys and
fixed lifecycle outcomes. Do not add convenience fields containing local diagnostics or credentials.
The revocation `intentId` must use the production
`github-delivery-intent-<lowercase RFC4122 v4 UUID>` form, including UUID version nibble `4` and
variant nibble `8`, `9`, `a`, or `b`.
For V1.5, `walkthrough.json.date`, the date embedded in its `evidencePath`,
`required-gates.json.recordedAt`, `github-sandbox.json.recordedAt`, and
`revocationProof.checkedAt` must all have the same UTC calendar date. The dated result must contain
exactly one `Revocation proof:` line, and that line must exactly encode the sandbox record values.
`revocationProof.proofStateVersion` must equal `2`; version `1` proof rows are deliberately discarded
and must be recreated by a fresh packaged remote check.
This result proves the absence of post-revocation new issuance across the active-binding CAS
linearization boundary. It does not claim that every pre-revocation credential is invalid: a token
normally issued or consumed before revocation may remain valid until use, provider revocation, or
expiry, and no token value is ever persisted. `credential_revocation_pending` is not signoff
evidence; elapsed time alone does not clear it, and the operator must wait and retry the packaged
action only after the product durably confirms pre-POST provider credential absence or exact-`204`
provider revocation and records the exact passing outcome.

`docs/releases/v1.5.0/walkthrough.json`:

```json
{
  "targetVersion": "1.5.0",
  "candidateSha": "<C-full-40-hex-SHA>",
  "status": "passed",
  "date": "YYYY-MM-DD",
  "method": "computer-use",
  "evidencePath": "docs/guides/devflow-studio-v1.5-walkthrough-result-YYYY-MM-DD.md"
}
```

`docs/releases/v1.5.0/required-gates.json`:

```json
{
  "targetVersion": "1.5.0",
  "candidateSha": "<C-full-40-hex-SHA>",
  "status": "passed",
  "recordedAt": "<ISO-8601 timestamp>",
  "gates": {
    "verify": "passed",
    "windows-compatibility": "passed",
    "v15-github-delivery-deterministic": "passed",
    "e2e": "passed",
    "electron-smoke": "passed",
    "postgres-smoke": "passed",
    "docker-smoke": "passed",
    "docker-lifecycle-smoke": "passed",
    "build": "passed",
    "build-output-smoke": "passed",
    "desktop-pilot-build": "passed",
    "desktop-pilot-smoke": "passed",
    "v15-github-delivery-packaged-smoke": "passed",
    "github-sandbox-draft-pr": "passed"
  },
  "localMatrix": {
    "candidateSha": "<C-full-40-hex-SHA>",
    "result": "passed",
    "worktreeCleanAfter": true
  },
  "verifyRun": {
    "workflow": "Verify",
    "event": "workflow_dispatch",
    "runId": 123456789,
    "runAttempt": 1,
    "url": "https://github.com/erich04/ai-devflow-studio/actions/runs/123456789",
    "headSha": "<C-full-40-hex-SHA>",
    "conclusion": "success",
    "jobs": {
      "macOS verify": "success",
      "Windows compatibility": "success",
      "Postgres integration": "success",
      "Docker smoke": "success",
      "Docker lifecycle smoke": "success"
    }
  },
  "desktopArtifact": {
    "version": "1.5.0",
    "platform": "darwin-arm64",
    "sha256": "<64-hex packaged-artifact SHA-256>"
  }
}
```

`docs/releases/v1.5.0/github-sandbox.json`:

```json
{
  "targetVersion": "1.5.0",
  "candidateSha": "<C-full-40-hex-SHA>",
  "status": "passed",
  "recordedAt": "<ISO-8601 timestamp>",
  "repository": "erich04/ai-devflow-studio-v15-sandbox",
  "repositoryVisibility": "private",
  "appSlug": "<lowercase-hyphenated-app-slug>",
  "installationIdSuffix": "<exactly-4-digits>",
  "repositoryIdSuffix": "<exactly-4-digits>",
  "bindingVersion": 2,
  "deliverySeriesKey": "github-delivery:<64-hex>",
  "deliveryAttempt": 1,
  "intentRevision": 1,
  "intentDigest": "<64-hex>",
  "runVersion": 7,
  "testEvidenceDigest": "<64-hex>",
  "prPackageDigest": "<64-hex>",
  "expectedCommitSha": "<40-hex sandbox source commit>",
  "remoteHeadSha": "<same-40-hex sandbox source commit>",
  "baseBranch": "main",
  "headBranch": "devflow/<safe-branch-name>",
  "pullRequestNumber": 17,
  "pullRequestUrl": "https://github.com/erich04/ai-devflow-studio-v15-sandbox/pull/17",
  "draft": true,
  "merged": false,
  "approvalRole": "lead",
  "approvalAuthKind": "session_cookie",
  "workRequestCount": 1,
  "canonicalRunCount": 1,
  "credentialGrantCount": 1,
  "branchPublicationCount": 1,
  "draftPullRequestCount": 1,
  "automaticRetry": false,
  "acceptanceStatus": "completed",
  "restartRecovery": "passed",
  "revocationProof": {
    "proofStateVersion": 2,
    "intentId": "github-delivery-intent-<lowercase-RFC4122-v4-UUID>",
    "revokedBindingVersion": 3,
    "outcomeCode": "binding_inactive",
    "checkedAt": "<canonical-ISO-8601-check-timestamp>",
    "durableCheckCount": 1
  },
  "redactionCheck": "passed",
  "cleanup": "passed",
  "cleanupMethod": "external-operator-no-merge",
  "operatorRole": "non-maintainer",
  "adHocMaintainerAssistance": false
}
```

The dated result must say `Status: Passed` and record `C`, the packaged artifact platform and
SHA-256, Team schema v15, Desktop schema v17, exact-SHA Verify URL, non-secret sandbox/App identity,
series/attempt/revision and digests, lifecycle counts, approval role/auth kind, expected/remote SHA,
Draft URL and state, completed Acceptance, restart zero-repeat observations, and the exact revocation
proof values (`intentId`, newer revoked binding version, `binding_inactive`, canonical `checkedAt`,
and durable check count `1`). It also records the redaction scan, cleanup, the non-maintainer operator
role, zero ad hoc maintainer assistance, and any non-sensitive setup correction. It must not record
`S`, because the dated result itself participates in calculating `S`.

Use this exact label skeleton so the result remains both human-auditable and machine-checkable:

```markdown
# V1.5 walkthrough result

Status: Passed
Candidate: <C-full-40-hex-SHA>
Packaged artifact: 1.5.0 <platform-arch> <64-hex-SHA-256>
Team schema v15; Desktop schema v17.
Verify: <exact-first-attempt-workflow_dispatch-run-URL>
Delivery series: <github-delivery:64-hex>
Delivery attempt: 1; intent revision: 1.
Intent digest: <64-hex>
Test evidence digest: <64-hex>
PR package digest: <64-hex>
Expected commit: <40-hex>; remote head: <same-40-hex>.
Draft PR: <canonical-GitHub-Draft-PR-URL>
Acceptance: completed. Restart recovery: passed.
Redaction check: passed. Cleanup: passed. The Draft PR was not merged.
Operator role: non-maintainer. Ad hoc maintainer assistance: false.
Approval role/auth: <owner-or-lead>/<session_cookie>.
Lifecycle counts: Work Request 1, canonical Run 1, credential grant 1, branch publication 1, Draft PR 1.
Sandbox/App: private <owner/repository> via <app-slug>.
Draft state: true; merged: false; automatic retry: false.
Restart side-effect repeats: credential 0, push 0, pull request 0.
Revocation proof: state version 2; intent github-delivery-intent-<lowercase-RFC4122-v4-UUID>; revoked binding version <positive-integer-newer-than-delivery-binding>; outcome binding_inactive; checked at <canonical-ISO-8601-check-timestamp>; durable check count 1.
```

## Candidate, Signoff, And Tag Sequence

1. Commit every ordinary product, test, workflow, version, and documentation change. With a clean
   worktree, record that commit as `C`; push it and complete the local matrix and exact-SHA Verify
   run without changing `C`. Download `ai-devflow-studio-v15-candidate-desktop` from that exact
   first-attempt `workflow_dispatch` run into a temporary directory. Confirm its index names only sibling
   manifest/archive files and the manifest archive SHA-256 equals the actual archive bytes. Extract
   and use that exact archive for the packaged private-sandbox walkthrough. Only after it passes,
   record the same platform/version/SHA in `required-gates.json`. Do not record the temporary path.
2. Add only the four evidence files above, then create one commit `S`. Require
   `git rev-parse S^1` to equal `C`, and require `git diff --name-only C..S` to list exactly those
   four paths.
3. On `S`, point `DEVFLOW_RELEASE_DESKTOP_ARTIFACT_INDEX` at the downloaded candidate
   `artifact-index.json`, then run `corepack pnpm release:status -- --mode=pre-tag`. The evaluator
   independently hashes the archive and compares it with both its manifest and
   `required-gates.json`. Do not move `C`, amend `S`, or add another evidence commit after it passes.
4. Preserve both original commits when integrating the release branch; squash and rebase are
   forbidden. Create the annotated tag with
   `git tag -a v1.5.0 S -m "AI DevFlow Studio v1.5.0"`.
5. Before pushing the tag, check out `S`, point
   `DEVFLOW_RELEASE_DESKTOP_ARTIFACT_INDEX` at the same downloaded index, and run
   `corepack pnpm release:status -- --mode=tagged`. Push the annotated tag only after it passes. The
   Release workflow independently reads the recorded run from the GitHub API, requires the exact
   `workflow_dispatch` event, candidate SHA, URL, repository, conclusion, and five successful jobs,
   then downloads and revalidates the same artifact. It publishes that archive instead of its
   current-runner rebuild. Wait for the exact tag-triggered `Release` workflow to succeed and confirm
   its `Publish GitHub Release` job succeeded. Independently query `git/ref/tags/v1.5.0`, require its
   object type to be `tag`, query `git/tags/<tag-object-SHA>`, and require its commit target to equal
   `S`. Download the Release assets into a new temporary directory, require exactly seven regular
   files, and run `node scripts/desktop-artifact-trio.mjs inspect
   <temporary-directory>/artifact-index.json`. Its index-bound Desktop archive and manifest plus
   `artifact-index.json`, `manifest.txt`, and the exact `ai-devflow-studio-v1.5.0-{web-next-build,
   api-build,worker-build}.tar.gz` files must be the complete seven-file set. A practical command
   sequence is:

   ```bash
   TAG_OBJECT_SHA="$(gh api repos/erich04/ai-devflow-studio/git/ref/tags/v1.5.0 \
     --jq 'select(.object.type == "tag") | .object.sha')"
   test -n "${TAG_OBJECT_SHA}"
   test "$(gh api repos/erich04/ai-devflow-studio/git/tags/${TAG_OBJECT_SHA} \
     --jq 'select(.object.type == "commit") | .object.sha')" = "$(git rev-parse S)"
   RELEASE_CHECK_DIR="$(mktemp -d)"
   gh release download v1.5.0 --repo erich04/ai-devflow-studio --dir "${RELEASE_CHECK_DIR}"
   test "$(find "${RELEASE_CHECK_DIR}" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" = 7
   test "$(find "${RELEASE_CHECK_DIR}" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" = 7
   node scripts/desktop-artifact-trio.mjs inspect "${RELEASE_CHECK_DIR}/artifact-index.json"
   test -f "${RELEASE_CHECK_DIR}/manifest.txt"
   for kind in web-next-build api-build worker-build; do
     test -f "${RELEASE_CHECK_DIR}/ai-devflow-studio-v1.5.0-${kind}.tar.gz"
   done
   ```

   Remove only that newly created temporary directory after the checks pass, before changing release
   truth.
6. Make the first post-release documentation commit without moving the tag: set Current Release to
   `v1.5.0`, mark 1.x complete, and make the V2.0 contract/ADR the next action.
