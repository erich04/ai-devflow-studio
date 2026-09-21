# Workbench requirement context and output recovery

Issues: #153, #154. Baseline: `535b4e42c084ea710e9450b221e3fce602f08270`.

## Reproduction

The original service sent only workflow metadata on the first call and removed body
content from node artifact indexes. A deterministic service/SQLite test failed because
the actual Provider prompt omitted the original requirement. The initial output-recovery
test also failed: an `invalid_model_output` response immediately ended the conversation.

The observed real failure had HTTP 200 and recorded usage, but no retained invalid
response body. Its precise JSON/completion failure cannot be reconstructed. The fix
does not claim otherwise: it records specific safe reason codes for future failures,
keeps strict validation, regenerates at most once, and explains any remaining failure.

## Automated validation

- Full suite: 298 files passed, one skipped; 4,062 tests passed, 15 skipped.
- Workspace typecheck, Desktop/shared final typechecks, production build, source-free
  API/Web/Worker build smoke, and cross-platform checks passed.
- Service tests cover the complete original request at a later-stage node, long-body
  continuation, escaping/limits, context trimming, explicit draft targets, ambiguous
  Runs, failed reads, project/conversation isolation, and legacy persistence.
- Real parser fixtures cover invalid JSON, empty content, arrays, exact safe diagnostics,
  bounded regeneration, preserved usage/input, and reopening SQLite after failure.
- Terminal SSE usage survives `finish_reason=length`; a later `stop` cannot override
  the first incomplete terminal reason. Cancellation/auth/network/filter errors do not
  trigger automatic format regeneration.
- Electron smoke uses a controlled local SSE endpoint through the real Provider,
  IPC, UI and SQLite implementation. All requests carry the full original requirement;
  a malformed HTTP-200 reply recovers with exactly one additional call. Markdown,
  reasoning, proposal saving, manual retry, cancellation, tab history and restart pass.
  No external provider is contacted by this deterministic smoke.

## Real DeepSeek verification

A separate temporary project/profile in the packaged Electron app reused the encrypted
saved Provider credential without exporting a plaintext key. It had no team pairing and
an unreachable API endpoint, so no test workflow could sync to the user's backend.

The original six-condition filter requirement was submitted in that isolated Run, then
the conversation was asked: “现在进行到哪里了，下一步做什么？”

- Three real DeepSeek calls, thinking enabled, low effort; 7,776 reported tokens.
- A request-boundary observer confirmed every call contained the complete original body.
- The answer correctly listed all six conditions, including resetting the filter while
  preserving task data. Its follow-up asked for the unspecified Chinese empty-state
  wording, instead of repeating the already specified options/persistence behavior.
- Run stayed at clarification with only the original request artifact; no proposal was
  published and no Gate advanced. The temporary credential/profile copy was removed.

## User-data preservation

Implementation and tests use a separate Git worktree and temporary databases. No schema
migration, reset, credential rotation or data-profile change is introduced. SQLite and
Postgres backups were taken before rollout; a fresh snapshot is taken at the restart
boundary. The replacement app keeps the existing app identity and data directory.
Exact before/after comparison of local project, Run/node/edge, artifact, conversation,
Provider and pairing records is required during rollout; backend business data is reused.

#135 remains open by maintainer choice. Its delivered asynchronous credential handling
is unchanged; formal Developer ID signed-install acceptance remains outstanding.
