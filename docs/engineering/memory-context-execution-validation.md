# Memory / Context / Compact execution validation

Implementation: `codex/memory-context-execution-20260915`, based on main `ff51b991`.
The published v2.3.0 binary is not changed by this work.

## What changed

```text
Promoted Memory in local SQLite
  → existing scope / lifecycle filter
  → bounded relevance selection
  → common Coding Brief + extractive compaction + local receipt
  → Native Coding or OpenCode
  → managed diff + executed saved tests
  → workflow.evaluate evidence checks
```

Source freshness is checked again before continuation. Memory provides background; it does
not replace permissions, tests or business acceptance. See [ADR 0021](../adr/0021-coding-memory-context-and-evidence-evaluation.md).

## Reproduced failures before the fix

1. Captured Native v2 Provider inputs lacked a promoted project Memory statement.
2. A 61 KB historical brief exceeded the target budget and downstream slicing could discard
   the current instruction or tail constraints.
3. Independent Runtime succeeded with no task evidence because its evaluation input was fixed.

Each reproduction failed before implementation and passes against the changed code.
Additional regressions cover paired actor/repository isolation, changed pairing, deleted/expired
Memory before approval, Memory revised during a paid call, restart, OpenCode pre-message fencing,
and evidence changed after evaluation checkpointing.

## Real DeepSeek acceptance

The paid harness is `scripts/memory-context-live-smoke.ts`. It uses real LocalStore, the normal
Coding Runtime, Native v2, isolated Git worktrees and an executed `npm test` command. It does not
mock the Provider or manually write the requested output file.

The identical request changes only the greeting in `src/greeting.js`, using the project Memory
wording when present and a specified default otherwise. The initial repository stays unchanged.

| Case | Actual generated greeting | Memory in both Provider prompts | Saved tests |
| --- | --- | --- | --- |
| No Memory | Standard greeting | No | Passed |
| Promoted/revised project Memory | Welcome to the remembered workspace | Yes | Passed |
| After explicit Memory deletion | Standard greeting | No | Passed |

The Memory is promoted from an accepted evaluation of the first run's actual diff/tests, then
revised using the same human-action service as Desktop. Long supplied design history forces
compaction in every case. The first live acceptance completed at 2026-09-16T04:40:57.974Z:
six real DeepSeek `deepseek-v4-flash` calls, 6,473 tokens, recorded cost USD 0.001287552;
94,485–94,721 byte briefs compacted to 1,868–2,103 bytes while preserving the current request
and tail acceptance constraint. Costs use the existing pricing snapshot and reported token usage.

A second paid run at 2026-09-16T05:04:49.501Z also verified the automatic Coding completion
evaluation in all three cases: six calls, 6,415 tokens, recorded cost USD 0.000961596.
Its Coding Run IDs were `coding-run-a6ac472e-8d43-4160-8317-15fe1e5ee460`,
`coding-run-6e0b6609-2539-4994-8df1-4040591172d7` and
`coding-run-c2194607-f8df-46fd-838c-af9b673156de`.
The sanitized [machine-readable evidence](evidence/memory-context-live-20260916.json) is checked in.
After tightening linked-test provenance, the final evaluator reread a copy of the real-run
database at 2026-09-16T05:14:56.248Z. All three cases passed with the exact same archived
evidence digests; no additional paid Provider call was needed.

Local verification completed:

- Final `corepack pnpm verify`: 276 test files / 3,889 tests, type checks and cross-platform checks.
- Focused provenance and mid-approval Memory deletion regressions also passed.
- `corepack pnpm build`: passed.
- `corepack pnpm test:e2e`: all 41 browser tests passed, including the advanced-area
  visibility check updated for the real `workflow.evaluate` tool.
- `corepack pnpm test:electron-smoke`: passed with an isolated Desktop profile.
- `build:desktop-pilot` and `test:desktop-pilot-smoke`: passed. The packaged IPC check
  rejects a new Run without evidence, archives a clarification through the Stage service,
  requests refinement to retain running-task authority, and then checks that archived evidence.
  It also verifies exact Memory promotion/revision/deletion and restart persistence. This is
  clarification artifact completeness, not approval of the outstanding refinement or Gate.
- `corepack pnpm test:native-coding-electron-smoke`: passed with real Electron Main, controlled
  local model server, exact change approval, worktree edit, executed tests, diff and cost evidence.
- Default `test:memory-context-live` opt-in behavior: skipped without contacting a Provider.
- The v2.0 Runtime, v2.1 retrieval/Memory and v2.2 multi-agent offline evaluators passed against
  clean candidate `b0ca895d544124e766c9b810b3ac7ae78373a412`.

This validates Memory-dependent implementation, scoped recall, deletion, compaction and actual
local evidence. It is not a new cloud onboarding/deployment test, an OpenCode paid-provider
acceptance, or a claim that all business requirements can be evaluated automatically.
OpenCode brief delivery and freshness checks have deterministic HTTP-adapter coverage.

Packaged coverage also verifies that the injected Local MCP registry contains the native
`workflow.evaluate` registration alongside the offline MCP fixture. Their combined capability
digest includes both the MCP installation identity and native evaluator definition. The Native
v2 Git/npm fixture uses the existing Native v1/OpenCode Windows scheduling budgets, disables
irrelevant fixture npm audit/funding requests and retries transient directory cleanup locks.

The live harness keeps its build node running while it exercises the independent evaluator and
the existing human Memory promotion/revision services; it does not install the UI's Workflow
completion callback. Therefore this is service-level Memory lifecycle acceptance, not a claim
that the same post-build interaction is available after the UI advances to a Test or Gate.
Existing saved Memory is now consumed by Coding automatically, but new durable Memory still
requires explicit human promotion/revision. Automatic post-task learning is not implemented in
this slice. The advanced independent Runtime retains its existing running-task precondition;
normal Coding completion records its evidence evaluation directly in the Coding trace.

## Run it again

Use an unused output directory. The harness refuses to overwrite an existing report/repository.
Provide credentials through the local environment; do not put API keys in command arguments or
commit them. The following variables are required for an explicitly paid run:

- `DEVFLOW_MEMORY_LIVE=1`
- `DEVFLOW_AGENT_OPENAI_API_KEY`
- `DEVFLOW_AGENT_OPENAI_BASE_URL`
- `DEVFLOW_AGENT_OPENAI_MODEL`
- Optional `DEVFLOW_MEMORY_LIVE_OUTPUT` (otherwise a new timestamped directory under `out/`)

Run `corepack pnpm test:memory-context-live`. Without the opt-in flag it reports skipped and
does not load credentials or contact a Provider. The sanitized report contains per-case Coding
Run IDs, prompt-content presence checks, Context receipts, automatic and on-demand evidence
checks, token settlements and assertions. It contains no API key or full Provider request.

## Cursor consultation

Cursor was consulted read-only with `cursor-grok-4.6-high`, session
`2a4ab5c4-d000-4cef-af28-d928292422ff`. Codex independently checked each recommendation:

| Advice | Disposition |
| --- | --- |
| Reuse existing Memory lifecycle; inject statements into Coding briefs | Accepted and verified with actual Provider behavior |
| Preserve SHA-256(brief) semantics and immutable recovery | Accepted |
| Recheck Memory before external actions; retain no-replay behavior | Accepted, including deletion/revision/restart regressions |
| Keep offline fixture evaluations distinct from real task evaluation | Accepted |
| Defer compact to a future slice | Not adopted: the user explicitly requested working compact; implemented bounded extractive compaction |
| Keep a fixed independent Runtime demo | Not adopted for the default runtime: user requested real inputs; fixtures remain in offline tests |
| Expand vector retrieval or specialist Memory routing | Deferred; neither is needed to prove this execution slice |

The same Cursor session then performed a focused implementation review (read-only, no test
execution). It reported no blocking counterexample and two nonblocking risks. Both were addressed:
OpenCode rechecks freshness immediately before an approved permission reply and aborts on a
mid-approval Memory deletion; real evidence evaluation requires the Coding Run's own linked
test to have passed, while a later failed saved test still makes the evaluation fail.
The corresponding race and evidence-provenance regressions pass. In-flight OpenCode work
already authorized before deletion cannot be retroactively undone.
