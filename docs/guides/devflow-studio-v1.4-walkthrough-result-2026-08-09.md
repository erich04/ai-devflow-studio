# DevFlow Studio V1.4 candidate walkthrough result — 2026-08-09

## Outcome

Candidate `b7986d4faec2f8f1bcc220a0341cb0686286209e` passed the complete V1.4
candidate-bound release path through the no-cost local matrix, exact-SHA pull-request CI, a fresh
GitHub OAuth and packaged Desktop Computer Use walkthrough, and the separately authorized real
OpenCode provider smoke.

The Web-to-Desktop path ended with the Desktop recording `human_rejected`. Team recorded the one
Gate Command as `applied`, acknowledged its receipt, and kept the canonical Run at the same Gate.
No pairing code, browser session value, Desktop bearer value, provider key, raw prompt, raw patch,
raw stdout/stderr, repository path, or evidence body is retained here.

| Field | Observed result |
| --- | --- |
| Candidate | `b7986d4faec2f8f1bcc220a0341cb0686286209e` |
| Candidate branch | `codex/v1.4-release-signoff` |
| Package version | `1.4.0` across all six first-party packages |
| Desktop artifact | `darwin-arm64`, SHA-256 `5c0592e7c40ddc18fb7cd7e973489da999d0aee1cd1a07e2d54a09a39a812d6e` |
| Required deterministic gates | All eleven V1.4 gate IDs passed across the local matrix and exact-SHA CI |
| Exact-SHA Verify | [run 31320603242](https://github.com/erich04/ai-devflow-studio/actions/runs/31320603242), five jobs passed |
| Computer Use walkthrough | Passed with fresh Team and Desktop state |
| Real OpenCode smoke | Passed once; no automatic retry |

## Fresh authority and Computer Use path

The walkthrough started with an empty PostgreSQL schema v10 environment and a fresh Desktop
schema v12 store. No demo seed was used. GitHub OAuth created the first organization owner, after
which Web created one Team Project. Web generated one short-lived Desktop pairing code; it was
transferred directly into the packaged Desktop UI without being logged, captured, or persisted as
evidence. The code was consumed exactly once and one active Desktop pairing remained.

The UI path then completed these checks:

1. Desktop selected one controlled Local Project, paired to the selected Team Project, and synced
   a project-scoped `remote_cache` Policy Snapshot v1.
2. Web created one bounded Work Request. Immediately before claim, Team had one `open` v1 request,
   no claimed Run reference, and zero Team Run projections.
3. Desktop claimed and materialized the request exactly once. The request became `materialized` v3
   and referenced one canonical local Run and one redacted Team projection.
4. Desktop generated clarification and advanced that Run to its Gate. Local and Team projections
   agreed on `paused_at_gate` at Run version 2.
5. Web submitted one version- and policy-bound rejection. Desktop acquired the exact receipt,
   evaluated it as `human_rejected`, acknowledged it, and did not advance or mutate the Run
   version.
6. Web observed the terminal command state and confirmed that the Run remained at its current Gate.

The final authority snapshot contained exactly one Work Request, one canonical Run reference, one
Team Run projection, one Gate Command, one receipt, and one acknowledgement. The command was
`reject` / `applied` / `human_rejected`; the acknowledgement was `human_rejected`, with Run version
2 before and after. No unsigned development-header authority was observed for the scoped records.

The transitional claim-pending absence of a Team Run was not inferred from the terminal database
snapshot. The walkthrough recorded the zero-projection checkpoint immediately before claim; the
claim-pending race itself remains covered by the passing deterministic materialization tests.

## Persistence, knowledge, and trust-boundary checks

After fully closing the packaged Desktop, the same isolated Desktop data was cold-started. Pairing,
the selected Local and Team Projects, the canonical Run, current Gate, Policy Snapshot, rejection
outcome, receipt observation, acknowledgement, and durable outbox state were restored. The outbox
had no scope mismatch or expired sending lease and advanced monotonically.

The local Knowledge view indexed two Markdown documents and exposed local references to the Run and
Gate. Team retained no knowledge-reference payload and reported no API knowledge provenance. A
metadata-only redaction scan across 266 text/JSON columns found zero local absolute-path or
local-file URI patterns. Remote artifact, test, coding, and review records had zero unsafe redaction
flags; the fresh walkthrough stores contained no provider-backed Coding Run.

The isolated Desktop and Compose processes were stopped after the audit. The isolated filesystem
root was moved to the system Trash, and its dedicated Docker volume was removed. Protected prior
walkthrough resources were left unchanged.

## Candidate gates

The clean C9 checkout passed, in the mandated serial order, `verify`, build, build-output smoke,
E2E, Electron smoke, Desktop pilot build and packaged smoke, isolated PostgreSQL smoke, Docker
smoke, and Docker lifecycle smoke. The final worktree and diff checks passed, and all temporary
resources created by those gates were removed. The exact-SHA pull-request Verify run passed macOS,
Windows compatibility, PostgreSQL integration, Docker smoke, and Docker lifecycle smoke.

## Release-only real OpenCode smoke

The authorized candidate-bound invocation used OpenCode `1.18.15`, provider `double`, model
`ark-code-latest`, and the candidate-owned V1.4 Responses profile. Only the environment-variable
name `ANTHROPIC_AUTH_TOKEN` is recorded. The no-network resolved-config preflight passed before the
provider invocation.

The actual smoke completed in 21.037 seconds and relayed exactly `bash -> edit`. Its credential-
owning egress gate armed, forwarded, and completed exactly three credited segments. It observed
zero uncredited requests, invalid requests, failed segments, active connections, or provider retry
states. The only changed path was the repository-relative marker `devflow-opencode-smoke.txt`;
fixture tests, redaction checks, managed worktree cleanup, process-group cleanup, and temporary-root
cleanup all passed.

Before the authorized invocation, the outer release helper failed safely before its atomic latch
and provider child because it cleared a SQL.js input buffer before querying the local encrypted
record. Independent postflight confirmed `attemptCount=0`, no provider process, no latch, and no
runtime residue. The helper, which is outside the candidate tree, moved the buffer clear until after
database close and was re-reviewed byte-for-byte. Candidate C9 did not change. The subsequent
authorized invocation was therefore the first and only top-level paid smoke for this candidate.

## Verdict

The candidate-bound deterministic, cross-platform, packaged UI, authority, persistence,
redaction, cleanup, and real-provider gates recorded above all passed. This document is release
evidence for candidate C9; publication still depends on the evidence-only direct child, its exact
CI and pre-tag Release run, the final tag go/no-go, and the tag-triggered Release workflow.
