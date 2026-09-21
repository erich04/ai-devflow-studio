# Workbench OpenCode harness validation — 2026-09-20

Scope: #147. The original user's To Do project, Provider row, Run and conversations
were not edited or advanced. Tests used an independent SQLite profile and local
clone of the To Do repository. The executor design is recorded in ADR 0022.

## Real Desktop and DeepSeek

The packaged Electron 42.11.6 test build exposed the new-conversation selector.
Selecting OpenCode and creating a chat displayed `OpenCode` separately from the
saved `DeepSeek Flash` model. Node generation retained its own Direct Provider
selection. OpenCode 1.18.15 handled the actual agent/tool loop.

One successful UI request used the saved `deepseek-flash` configuration at
`https://api.deepseek.com`. It queried workflow, the test node, the current
clarification node and README.md through the scoped MCP bridge. The answer
correctly reported clarification in progress and tests not yet run. Four source
records and a validated node-navigation action were saved. The navigation action
opened the clarification details without advancing the workflow.

The persisted usage was 6,811 input and 869 output tokens, total 7,680; reported
cache reads were 2,304 tokens. The separate reasoning record contained 1,493
characters. No reasoning-strength value or monetary cost was invented. The
repository remained clean, the Run remained `clarifying`, and its only artifact
was still the raw request. A second OpenCode conversation was independently
persisted. After installing the final build and restarting, the original answer,
reasoning, four sources, usage and OpenCode selection remained available.

The second conversation's request reached a new OS credential wait. Clicking
the UI's Stop button immediately changed both the conversation and its own
credential operation to cancelled, with retry available and no reported model
usage. Switching back showed the first conversation unchanged. No second paid
call is claimed for this cancellation check.

Initial attempts failed before contacting the Provider. The isolated packaged
test app used a different application name from the user's development app;
macOS safeStorage consequently selected a different keychain namespace. Matching
the test bootstrap to the original development application name and obtaining
the user's OS authorization resolved the test-environment problem. Credentials
were never printed, exported as plaintext, or rewritten in the original profile.
These failed credential attempts are not counted as model success or model usage.

## Real CLI protocol and lifecycle

`DEVFLOW_OPENCODE_BIN=/path/to/opencode pnpm test:workbench-opencode-contract`
uses the real CLI with a local synthetic OpenAI-compatible streaming server.
It does **not** use a paid LLM. With 1.18.15 it passed:

- Only the seven allowed `devflow_*` MCP tools were sent to the model; no native
  shell, edit, task, question or unrelated MCP capability was exposed.
- A real tool round trip returned a host source ID and a validated JSON answer.
- Provider completion tokens that include reasoning were counted once.
- Cancelling conversation A closed its own request while conversation B finished.
- B's model input did not contain A's private marker. An explicit retry of A used
  a fresh runtime and completed. All owned runtimes and bridges were closed.

This lifecycle evidence is deliberately distinguished from the paid UI request;
cancel/retry assertions were run against the real CLI and synthetic model server.

## Focused regression coverage

56 tests across the conversation service, MCP bridge, executor, credential access
and workbench UI passed. Desktop and smoke-script TypeScript checks passed, and
the production Desktop build passed. Existing Direct Provider fixtures remain
covered alongside the external path.

Coverage includes legacy records, immutable per-chat execution choice, project
and object authorization, denied mutation/unknown tool arguments, secret-safe
queries, bounded calls and output, real reasoning deltas, wrong-model rejection,
failed-response usage, cancellation during startup, explicit retry, restart,
history isolation and cleanup. A conversation abort now cancels only its own
pending credential wait; late OS results cannot restart it.

## Independent review disposition

Cursor read-only review `7d9276c8-5399-46a6-8e91-49605c84ef65` returned
`pass_with_risks`, with no claimed blockers. Each suggestion was checked locally:

- Added startup-abort coverage and moved workspace creation inside cleanup's
  protected scope.
- Explicitly denied native question/task tools and repeated the real CLI protocol
  check with the seven-tool allowlist.
- Added an OpenCode-specific regression for already-reported billed usage on an
  invalid response, and scoped cancellation of credential waits.
- Completed the previously pending real DeepSeek request after user authorization.
- Retained strict whole-object/whole-JSON-fence parsing. Extracting an arbitrary
  object from surrounding prose can hide malformed or conflicting answers. A bad
  final response remains a visible recoverable failure with known usage retained.

Limits: OpenCode is the first adapter; Codex is researched but not implemented.
Chat is read-only investigation plus the existing explicit pending-proposal save;
it cannot approve Gates or execute formal stages. CLI permission rules and host
tool validation are used, not an OS security sandbox. Unknown upstream usage or
reasoning effort stays unknown.
