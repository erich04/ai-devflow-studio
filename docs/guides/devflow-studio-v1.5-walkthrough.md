# DevFlow Studio V1.5 GitHub Delivery Walkthrough

Status: Stable operator procedure; no result claimed

This walkthrough verifies the final planned 1.x delivery boundary against one frozen Candidate
commit `C`. It proves that an authenticated Work Request can become one local, tested commit and one
human-approved GitHub Draft pull request without giving Web, the renderer, or durable storage a
repository credential. A dated result is written only after every step passes.

## Preconditions

- Use a clean checkout at the full SHA of `C`, a package built from that same commit, and fresh,
  isolated Web/API/Postgres/Desktop state.
- Use a non-sensitive fixture repository and a dedicated private GitHub sandbox repository. The
  sandbox must not be the DevFlow product repository or another production repository.
- Install the V1.5 GitHub App only on that sandbox. Grant repository Metadata read, Contents write,
  and Pull requests write; do not enable administration, merge, workflow, issue, or organization
  permissions.
- Keep the App private key in API process configuration. Never place the key, installation token,
  OAuth token, pairing code, Cookie, Bearer value, or credential URL in evidence or shell history.
- Use normal GitHub OAuth for browser identity, one signed Web session, one explicit Team Project,
  and one short-lived project pairing code. Development identity headers are forbidden.
- Record the candidate SHA, package digest, non-secret sandbox identity, and isolated service names
  before starting. Keep raw local paths out of the result.

## Operator Path

1. Start the candidate-bound self-hosted stack and packaged Desktop. Confirm API and Web readiness,
   current Team schema, fresh Desktop state, and absence of prior Delivery records.
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
   request. Confirm the PR node advances only after durable branch and Draft evidence exists.
10. Stop Desktop after the remote effect is durable, then cold-start it with the same isolated state.
    Confirm it reconciles without a second credential grant, push, or pull-request creation.
11. At Acceptance, inspect the exact remote commit, Draft URL, passing Test Evidence, and completed
    Delivery evidence. Approve Acceptance and confirm the canonical Run becomes `completed` while
    the pull request remains Draft and unmerged.
12. Revoke the repository binding in Web. Attempt a new credential grant for a separate bounded
    request and confirm it is blocked before token minting or git/network mutation.
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
- binding revocation followed by a blocked new credential grant;
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
