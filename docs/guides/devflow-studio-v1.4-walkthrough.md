# DevFlow Studio V1.4 Candidate Walkthrough

Status: Stable operator procedure; no result claimed

This walkthrough verifies the V1.4 pilot trust boundary against one frozen Candidate commit `C`.
It defines the repeatable operator path and acceptance criteria. A dated result is written only
after the entire path passes; this document is not evidence that a candidate passed.

## Preconditions

- Use a clean checkout at the exact full SHA of `C` and the packaged Desktop application built from
  that same commit.
- Use an operator-controlled fixture repository with no secrets and a fresh, isolated Desktop
  `userData` directory.
- Start the self-hosted Web/API/Postgres pilot with signed-session authentication. Unsigned
  `x-devflow-*` identity headers are forbidden.
- Use one explicit Team Project, one matching Local Project, and a short-lived pairing code created
  during this walkthrough.
- Keep the default deterministic runtime. This walkthrough does not authorize or replace the
  separate paid-provider smoke.

## Operator Path

1. Sign in to Web with the normal signed session and select the intended Team Project explicitly.
2. Create one Desktop pairing code for that project. Treat it as a short-lived secret and do not
   include it in screenshots, logs, or the result document.
3. In the packaged Desktop app, select the controlled Local Project, pair it to the selected Team
   Project, and sync Team state.
4. Create one bounded V1.4 Work Request in Web for the same Team Project.
5. Refresh the Desktop Work Request inbox, claim that request, and materialize exactly one canonical
   local Run. Confirm that Team did not fabricate a Run before Desktop acknowledged materialization.
6. Generate Clarification and advance the local workflow to the expected Gate. Preserve the
   canonical local Run and its evidence as the transition authority.
7. Refresh the project-scoped Team Policy in Desktop. Confirm the returned policy projection names
   the exact selected `projectId`; an absent, wrong-scope, or unavailable policy must fail closed.
8. Sync the redacted Run projection and confirm Web shows the selected project, Run, current Node,
   and version without raw local evidence.
9. In Web, submit a version- and policy-bound rejection Gate Command for the selected Run and Node.
   The command is collaboration intent, not a direct Team Run mutation.
10. Let Desktop acquire the exact delivery receipt, re-evaluate its full local evidence and policy,
    and apply the human rejection through the canonical local command path.
11. Confirm Team records the terminal command and matching receipt acknowledgement. A later redacted
    Run summary may update the projection; acknowledgement itself must not mutate the Run.
12. Fully stop Desktop, cold-start it with the same isolated `userData`, and confirm recovery of the
    paired scope, canonical Run, command receipt/outcome, and durable outbox state.
13. Confirm repository knowledge is available to the local Gate, Knowledge Review, and Coding
    context. Team and API Review receive no raw repository content, and API knowledge provenance
    remains `none`.

## Acceptance Criteria

The walkthrough passes only when all steps use the same `C` and the final observed states are:

- Desktop outcome: `human_rejected`
- Team command: `applied`
- Receipt acknowledgement: `acknowledged`
- The recovered Local Project is still bound to the original Team Project.
- Exactly one canonical local Run exists for the Work Request.
- The Team projection contains only bounded redacted summaries; no raw repository content, prompt,
  patch body, stdout/stderr, credential, or local absolute path crosses the boundary.

Any product, test, workflow, configuration, or ordinary-document change invalidates `C` and this
walkthrough. Freeze a new candidate and restart the complete signoff matrix. A setup-only failure
may be corrected without changing `C`, but the final dated result must disclose it.

## Result Record

After a complete pass, create a new
`docs/guides/devflow-studio-v1.4-walkthrough-result-YYYY-MM-DD.md`. Record the candidate SHA,
non-sensitive environment identity, observed step outcomes, cold-start recovery, and redaction
checks. Do not modify or reuse the 2026-08-01 development result, and never record pairing codes,
Cookies, Bearer tokens, provider values, raw evidence, raw repository content, or local absolute
paths.
