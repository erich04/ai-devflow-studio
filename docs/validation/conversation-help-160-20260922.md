# Conversation help and creation flow — issue #160

## Behavior

- The question-mark button beside conversation information opens a dismissible, keyboard-accessible
  explanation of shared project sources, independent chat/drafts, explicitly saved node proposals,
  available query tools and Direct Provider/OpenCode permissions.
- Conversation message inclusion/omission counts are no longer displayed. Existing context limits,
  persisted messages, model-call settings and actual capacity/failure notices remain intact.
- Plus, project questions and node discussions open a creation dialog first. The user chooses the
  executor and explicitly creates the conversation. Cancelling has no creation/model-call effect;
  prefilled questions are retained as unsent drafts. Existing sessions display their saved executor.
- This is a renderer change. There is no schema, credential, Provider selection, conversation
  contract or workflow-state migration.

## Verification

- `corepack pnpm verify`: typechecks passed; 300 test files / 4,085 tests passed, 15 opt-in Postgres
  tests skipped locally; cross-platform static checks passed.
- `corepack pnpm --filter @ai-devflow/desktop build`: passed.
- `node scripts/build-desktop-pilot.mjs`: unsigned local macOS package built successfully.
- `node scripts/workbench-conversation-electron-smoke.mjs`: passed against isolated Electron,
  SQLite and a synthetic local SSE Provider. No paid model or OS keychain credential was used.
  This covers explicit create/cancel, unchanged active tab on cancel, help close/Escape/focus loop,
  a scrollable help body at 480 × 600, read-only executor labels, Direct Provider/OpenCode
  coexistence across a real process restart, unsent drafts and history, node query/proposal paths,
  bounded malformed-output recovery, cancellation, and existing light/dark/window-width checks.
- UI component regression tests also cover project switching, creation failure/retry with the
  selected executor and prefill retained, archived notes, the capacity notice and existing Inspector.

Local screenshots and the structured report are under `out/workbench-conversation-qa/`.

## Rollout boundary

The user's business Run is not used as a test fixture. Local rollout takes fresh SQLite and
Postgres backups, retains the existing desktop data directory/application identity and running
API/Web databases, and compares persisted rows after restart. The packaged Electron executable,
Info.plist, Main and preload must match the existing installation before the renderer is replaced.
Per-installation backups and preservation results stay local and are recorded in the rollout report.
