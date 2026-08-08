# DevFlow Studio V1.4 Computer Use walkthrough result — 2026-08-01

## Outcome

The V1.4 pilot trust-boundary implementation passed a development-tree walkthrough across the real
Web UI and a packaged Electron Desktop application. The final path covered Web pairing and Work
Request intake, Desktop claim/materialization and clarification, project-scoped Policy v1 refresh,
a Web rejection command, and Desktop receipt processing and acknowledgement. The terminal local
outcome was `human_rejected`; Team recorded the command as `applied` and its receipt as
acknowledged.

This result is implementation evidence only. It is not candidate-bound and is not a formal V1.4
release signoff.

| Field | Result |
| --- | --- |
| Target scope | V1.4 Pilot Trust Boundary implementation |
| Source state | Development worktree; not yet a signed release candidate |
| Package metadata | Still `1.3.0` pending V1.4 candidate formation |
| Web/Desktop walkthrough | Passed after one defect was found, fixed, and rerun |
| Team Project | `p-payments` (`Payments API`) |
| Final Gate action | Reject |
| Final Desktop outcome | `human_rejected` |
| Team command / acknowledgement | `applied` / receipt acknowledged |
| Paid provider call | Not run |
| Formal V1.4 signoff | Not complete |

No pairing code, exchanged Bearer token, signed browser Cookie, provider credential, local absolute
repository path, or raw Run evidence is recorded in this document.

## Environment and authority boundaries

The walkthrough used the local API and Web services plus the built, packaged Desktop executable
with a fresh isolated `userData` directory. All direct Web and Desktop interactions were performed
with Computer Use. Local test authentication used a short-lived signed Session Cookie and the
normal pairing exchange; unsigned browser identity headers were not used.

The test kept the intended authority split:

- Team owned the project, versioned Work Request, redacted Run Projection, Gate Command, receipt,
  and acknowledgement record.
- Desktop owned the canonical Run, complete evidence, Team policy snapshot, Gate evaluation, and
  terminal local outcome.
- Web submitted collaboration intent. It did not directly patch the Run or infer that a command
  acknowledgement changed the projected workflow state.

## End-to-end Computer Use path

| Step | Observed result |
| --- | --- |
| Packaged Desktop launch | The built application loaded its packaged `file://` renderer with isolated local storage. |
| Local Project selection | Computer Use selected the V1.4 development checkout as the Desktop Local Project. |
| Web pairing | Web generated a short-lived code for `p-payments`; Desktop exchanged it and persisted the Local ↔ Team Project binding. |
| Work Request intake | Web created a bounded V1.4 acceptance Work Request in `p-payments`. |
| Claim and materialization | Desktop refreshed the inbox, claimed the expected Work Request version, and created the single canonical local Run before acknowledging materialization. |
| Clarification | Desktop generated the clarification artifact and advanced the Run to its Gate. |
| Policy and projection sync | Desktop refreshed project-scoped Team Policy v1 and synchronized the redacted Run projection. |
| Web Gate action | Web opened that projected Run, supplied a reason, and submitted a version- and policy-bound rejection command. |
| Receipt and local decision | The claiming Desktop acquired the command receipt, rechecked local scope and evidence, and persisted a human rejection without advancing the Gate. |
| Acknowledgement | Desktop acknowledged the exact receipt with `human_rejected`; Team exposed the command as `applied` with its receipt acknowledged. |

The flow did not create a paid Coding Agent run, a provider request, a GitHub pull request, or a
release tag.

## Defect discovered and verified fix

The first Gate Command attempt failed closed with `stale_policy`. That outcome protected the local
Run—Desktop did not apply the rejection—but it was unexpected because the current Policy v1 had
already been synchronized.

Investigation showed that Team overview projections omitted `projectId` when a project inherited
the organization policy without an override. Desktop intentionally accepts an authoritative policy
only when the returned policy is explicitly scoped to its paired Team Project. The unscoped
projection therefore looked unavailable and produced the safe `stale_policy` outcome.

The API's in-memory repository, Postgres repository, and route fallback projection were corrected
to attach each owning `projectId` to its effective policy. Regression tests were added for all three
paths. After the API was restarted, pairing and the Work Request/Gate path were repeated from fresh
Team state. Desktop then refreshed the project-scoped Policy v1 and the same rejection scenario
ended as `human_rejected` with a recorded acknowledgement.

This is an important positive negative-path result: the original defect caused a conservative
denial rather than a cross-project policy fallback or unauthorized local mutation.

## Infrastructure and packaging evidence

The V1.4 implementation also passed these real, no-cost checks during development:

| Check | Result |
| --- | --- |
| Real Postgres integration smoke | Passed against PostgreSQL 16. |
| Compose pilot smoke | Passed API/Web readiness, authenticated pairing, Work Request, Gate Command, visibility, and cleanup. |
| Docker lifecycle smoke | Passed fresh schema v10, retained V1.3 schema v7 → V1.4 schema v10 upgrade, transactional failed-upgrade recovery, and bounded V1.3 API read rollback. |
| Desktop pilot build | Produced the current-host packaged app, deterministic archive, manifest, and artifact index. |
| Packaged Desktop smoke | Passed isolated-store launch, `file://` renderer loading, and rejection of an injected development-server URL. |

These checks validate the implementation and operator path, but they are not tied here to a V1.4
candidate SHA. The Desktop artifact remains unsigned and unnotarized, is not an installer, and is
not approved for public distribution.

## Remaining release work

Before formal V1.4 signoff:

1. form the V1.4 candidate and align package/release metadata;
2. rerun the complete deterministic gate matrix against the exact candidate SHA;
3. execute any separately authorized release-only paid-provider smoke without retrying merely to
   obtain a preferred result;
4. record candidate-bound walkthrough, CI, release, and signoff evidence; and
5. complete the normal credential-rotation prerequisite before handling provider-backed release
   evidence.

## Verdict

The scoped V1.4 Web → Desktop trust-boundary flow is implemented and has passed its real UI pilot
walkthrough after the discovered project-policy scoping defect was fixed and retested. The correct
current status is **implementation walkthrough passed; formal V1.4 signoff pending**.
