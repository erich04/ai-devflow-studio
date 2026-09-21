# Desktop lifecycle, credentials and thinking configuration — 2026-09-19

## #125 native Quit

The old packaged Electron 41.10.5 candidate reproduced the failure both with
and without a debugger. Two `before-quit` callbacks occurred in the same
millisecond, followed by `window-all-closed`, but never `will-quit`. The owned
process remained alive and required SIGTERM. This establishes an application
callback reentrancy problem independently of the keychain symptom in #135.

After cleanup, schedule the second `app.quit()` with `setImmediate`, allowing
the original native Quit callback to finish. Changing only this line in the
same 41.10.5 package made native menu Quit terminate normally in 291 ms.
The rebuilt 42.11.6 package subsequently passed two cold launches and native
menu quits with the same isolated profile, code 0 and no termination signal.
The final observer records process lifetime including operator time, **not**
Quit latency. Native menu actions were performed through CUA.

Local evidence: `out/issue-resolution-20260919/plain-quit-baseline.json`,
`plain-quit-probe-result.json`, `quit-probe-result.json`, and
`out/desktop-menu-quit-smoke/report.json`. The observer is
`scripts/desktop-menu-quit-smoke.mjs`; it waits for an operator's native Quit.

## #135 system credential waits

Upgrade Electron from 41.10.5 to 42.11.6 and use its asynchronous safeStorage
APIs. The application keeps responding during the native keychain wait and
shows operation/category, elapsed time, safe outcome and diagnostic ID.
Cancellation/timeout rejects the caller and discards late native results;
it does not claim to dismiss macOS's own authorization dialog. Errors contain
no native exception text or credentials. Team and Provider paths both await
decryption and recheck mutable pairing/Provider identity after the wait.

Official API reference: [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).
42.4.1 includes the async initialization fix; 42.11.6 is the selected patch.

Real isolated macOS check passed after the user manually allowed authorization:

- Native async encryption/decryption round trip succeeded.
- A synthetic ciphertext generated with 41.10.5 decrypted correctly under
  42.11.6 (`shouldReEncrypt: false`). No actual Provider key was read.
- Controlled OS-port delay kept page navigation responsive; cancellation
  prevented the later completion from saving a Provider.
- Controlled denial was redacted, followed by a successful native encrypted
  save and a recovered UI. History records success, failure and cancellation.

Evidence: `out/desktop-credential-smoke/report.json` and its two screenshots;
`scripts/desktop-credential-smoke.mjs` distinguishes the real native crypto
checks from injected delay/denial cases. Unit coverage additionally includes
timeout/unavailable storage, retry and identity changes during a wait.

Remaining acceptance: a normal Developer ID signed installation. This machine
has zero valid signing identities; the user has been asked for an existing
signed build or CI environment. Do not represent the unsigned test-copy result
as signed-distribution verification. #135 remains open for this evidence.

## #146 Provider thinking controls

Provider metadata stores an optional thinking setting. Old supported official
DeepSeek configurations resolve to enabled/low. Settings can be changed without
reading, decrypting or resubmitting the key; a durable compare-and-swap rejects
stale edits. The existing cipher and historical records remain intact.

Recognized official DeepSeek models expose enabled/disabled and low/high/max.
Other endpoints/models use provider defaults and reject unsupported explicit
settings. All built-in calls inherit the same configuration: conversations,
clarification, design, knowledge review and Native Coding. Reasoning display
callbacks cannot override model settings. OpenCode remains separately managed.
New requests use the saved configuration; an in-flight request retains its
captured configuration. Conversation history, stage/review traces and Native
provider-call traces retain effective settings. Expanding a reasoning block
only changes display state.

Official references checked on 2026-09-19:
[thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/),
[Chat Completions parameters](https://api-docs.deepseek.com/api/create-chat-completion/).
Tests inspect emitted request bodies; they do not spend a user's LLM quota.
Validation and consultation disposition:

- Cursor review 2d4f825c-9e52-428e-a581-3775c8db50c4 found a real IPC allowlist
  defect: the thinking update reused the removal parser and rejected the
  thinking field. A regression reproduced it, then a dedicated update parser
  fixed it. 99 IPC/configuration/store tests passed, including unchanged
  ciphertext and stale-version rejection through the parser and store.
- Credential writes now reject overlapping saves/pairing rather than queueing
  stale intents behind an OS authorization wait. A cancellation/retry test and
  OpenCode identity-change-during-decryption test passed.
- A separate packaged Electron profile was operated via CUA: explicitly save
  enabled/low, change to enabled/high, save, and use native menu Quit. Reopening
  its SQLite store confirmed the saved setting and unchanged synthetic cipher.
  No keychain access or paid provider request was needed for this settings test.
  Evidence: out/issue-resolution-20260919/batch2-ui-result.json.
- The settings form now clears its previous success notice when edited and
  describes the selected value as taking effect after saving.
- The initial focused regression found three test expectations that needed
  alignment with the new controlled messages/metadata and one ambiguous text
  matcher. Corrected focused checks passed: 174 tests across App, settings,
  diagnostics and pairing; 17 final settings/pairing boundary tests passed.
- All five workspace typecheck commands passed, including the production Web
  build. Desktop renderer/main/preload and the unsigned package build passed.
  This does not replace the pending signed-install evidence above.

Final repository regression on 2026-09-20 ran 4,002 tests: 3,940 passed and
62 failures were confined to three test files. Those files still supplied no
approved clarification artifact to the stricter Coding brief, expected unknown
billing after measured failed output, or expected the former English error.
Updated their fixtures/expectations without weakening the production checks;
all 86 tests in those three files then passed. Logs:
`out/issue-resolution-20260919/batch2-full-suite.log` and
`out/issue-resolution-20260919/full-suite-regressions-fixed.log`.
The full root `pnpm typecheck` (including both smoke-script typechecks) and
`pnpm test:cross-platform` also passed. These are local results; Windows CI and
signed-install verification remain separate evidence.
