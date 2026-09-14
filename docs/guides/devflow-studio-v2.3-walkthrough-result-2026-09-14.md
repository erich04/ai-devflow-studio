# V2.3 independent candidate walkthrough — 2026-09-14

Status: Passed, with the disclosed non-blocking observations below.

Candidate: `9cec16052149c2a11749f28458152e423bca260b`. UI acceptance ran from 2026-09-14T01:58:38Z to 2026-09-14T03:08:56Z. Recorded at 2026-09-14T03:14:13.914Z.

Team schema v28; Desktop schema v34.

Packaged artifact: 2.3.0 darwin-arm64; SHA-256 53a2e8f0e562d8115c7651a2d617144b24ada06c1a345f698bb5879ff5409a68.

Verify: https://github.com/erich04/ai-devflow-studio/actions/runs/34763986095 — workflow_dispatch, attempt 1, exact candidate; all five jobs succeeded.

## Method and independence

Operator role: non-maintainer. The independent operator did not author the candidate or change source, databases, business APIs, or the formal signoff records during acceptance.

Ad hoc maintainer assistance: false for product operation and business-state repair. The user explicitly authorized Playwright real-UI driving after native control failures; normal System Events operated the native directory chooser. These authorized UI transport and lifecycle methods are an exception to the original native-control-only procedure. The user assisted normal GitHub login/2FA only. The operator selected the local repository, created and bound the Team Project, paired Desktop, and performed all workflow actions through normal UI. No dialog mock, injected authentication, or direct business-state repair was used.

After the operator finished, the release owner supplemented fields not exposed by UI using a read-only PostgreSQL transaction and SQLite opened in read-only mode. This separate audit verified schema versions, delivery counts, the intent identifier and durable revocation fields. Those bottom-layer counts are audited observations, not claims that the operator saw them in the UI. The audit did not advance or repair the workflow.

An earlier native-control attempt was interrupted and is not included as a passing run. This attempt used fresh Team/Desktop workflow state and one new Team Project/Work Request; the private repository and saved Provider credential were prepared fixtures. It does not claim to recreate an empty GitHub repository in this release walkthrough; the earlier blank-project walkthrough is separate historical evidence.

## Observed flow

| Check | Actual result |
| --- | --- |
| Intake and pairing | One Team Project, one active repository binding v1 on main, one paired Local Project, one Web Work Request and one canonical local Run. |
| Clarification | Real DeepSeek generated v1; real Gate Review prompted structured revision to v2. Budget was saved through the normal form after a pre-call budget block. Explicit re-review fee confirmation and normal Gate approval followed. |
| Design and review | Real DeepSeek produced the unique Design Artifact. Design remained a Task, review a separate Gate. Read-only Task impact selected the actual downstream Gate and associated artifact; Task had no approval/Override control. Real review preceded explicit normal approval. |
| Runtime | One standalone scenario.evaluate Runtime reached success, checkpoint v4, accepted result 1, step 1/tool 1. This bounded diagnostic used zero model tokens; it was not a paid model call. |
| Memory | One candidate was promoted once, revised once, explicitly deleted and purged; deletion v3/head v4 persisted. |
| Coordination | One bounded session and one read-only Specialist were started. Partial-session cold restart preserved cumulative starts 1 and zero actions. Explicit cancellation stopped the session and child; no repeated start or effect was observed. |
| Coding readiness | The project Native executor used the saved real DeepSeek Provider. Readiness and active-run permissions prevented a second concurrent start. |
| Coding cancellation | One deliberate attempt was cancelled while its exact diff awaited permission: zero changed paths and workspace deleted. A normal explicit retry confirmation started the final attempt in the same canonical Run. |
| Implementation | The second real Native Coding attempt completed after explicit approval of its newly checked diff. Only README changed: two added lines, no deletions; existing content was preserved. |
| Tests | Native npm test: 17 passed, 0 failed. Separate formal Workflow test: 17 passed, 0 failed against the delivered change. |
| Delivery | One exact intent was approved in Web by the authenticated owner; Desktop published one branch and one Draft PR. |
| Acceptance | Real final Gate Review remained advisory. The operator checked the delivery/test facts and explicitly approved Acceptance. Desktop and Web showed completed; Web evidence chain was 100%. No Lead Override was performed. |
| Revocation | Web revoked binding v1 to v2. One normal Desktop check produced binding_inactive, still visible after navigation. |
| Redaction | Team Runtime, Memory, Coordination and delivery projections exposed bounded metadata rather than local contents or credentials. Public evidence contains no raw patch, Provider output, credential or local path. |

Two Coding attempts are intentional (one cancellation, one success). There was still only one Work Request, one canonical Run and one Delivery attempt; the explicit Coding retry is not an automatic GitHub delivery retry.

## Exact delivery and recovery evidence

Sandbox/App: private erich04/devflow-blank-mini-agent-20260911 via devflow-v1-5-sandbox-20260812.

Approval role/auth: owner / session_cookie. Desktop pairing role was lead.

Delivery series: github-delivery:7f4a85a6822cd5c24386b36280734e5b35dd15d937f784c818f74b34cac306d5

Delivery attempt: 1; intent revision: 1; Run version: 10.

Intent digest: e9f08637a59e27da51077863b53f3303356b0aab695e064cf82f498cc530623a

Test evidence digest: c9d71dc16528f86ef479268d3e1cf84f760d903d967b29ec6158332340c22f6d

PR package digest: 4c9ae03f074a0a4f60c6b3b02af97a3c44a4d464c161f13227266d20f4d1fee7

Expected commit: fbd82be0c7b02e37ce6e2233f3470709d7fd8f94; remote head: fbd82be0c7b02e37ce6e2233f3470709d7fd8f94.

Draft PR: https://github.com/erich04/devflow-blank-mini-agent-20260911/pull/2

Draft state: true; merged: false; automatic retry: false.

Lifecycle counts: Work Request 1; canonical Run 1; credential grant 1; branch publication 1; Draft PR 1. The supplemental read-only audit also found exactly one approval and one delivery request.

Restart side-effect repeats: credential 0; push 0; pull request 0.

Restart recovery: passed. The post-delivery UI retained the same completed intent, attempt 1, Run version 10, request version 8, PR and completion timestamp. Final audit found no additional credential grant, branch publication or PR outcome. Standalone Runtime, purged Memory and cancelled Coordination retained their versions and effect counts.

Both cold restarts retained the original profile. The normal menu Quit command returned success but the process remained alive; the second occurrence was observed for 10.122 seconds. SIGTERM then exited in 0.210 seconds without SIGKILL. Normal menu Quit is not claimed as passed. Recovery after controlled process termination passed; investigation is tracked in #125.

Acceptance: completed while the PR remained Draft and not merged.

Revocation proof: state version 2; intent github-delivery-intent-fae3046a-a419-4075-8261-356b735b2a9c; revoked binding version 2; outcome binding_inactive; checked at 2026-09-14T03:05:04.761Z; durable check count 1.

Redaction: passed for inspected projections and published evidence.

Cleanup: passed, external-operator-no-merge. The operator closed Draft PR #2 through GitHub at 2026-09-14T03:06:50Z and deleted its branch at 03:07:12Z. GitHub confirmed closed with unmerged commits; no merge, ready-for-review promotion, force push or sandbox tag occurred.

## Deterministic verification and known observations

The exact candidate passed production dependency audit, typecheck, 3,866 tests, cross-platform checks, 41 browser tests, Electron and Native Coding smoke, PostgreSQL, all three Agent evaluators, production/build-output checks, and the five-job Verify matrix. The downloaded CI Desktop artifact passed integrity, packaged Desktop and packaged GitHub Delivery smoke. These automated checks supplement the independent UI walkthrough; controlled-provider smoke is not represented as paid DeepSeek evidence.

- [#124](https://github.com/erich04/ai-devflow-studio/issues/124): a positive no-blocking-finding review statement appeared as an optional pending-remediation warning. The Gate remained normally approvable. The old findings were superseded correctly.
- [#125](https://github.com/erich04/ai-devflow-studio/issues/125): automated app-menu Quit left the process alive until controlled SIGTERM. The root cause between UI control and application shutdown is not established; ordinary manual Quit is not claimed as broken or verified.
- Some newly changed Memory/Runtime panels required ordinary navigation refresh. No database or API repair was needed.

These observations remain disclosed. This result does not assert zero open issues, tested Override execution, a signed/notarized installer, or production deployment.
