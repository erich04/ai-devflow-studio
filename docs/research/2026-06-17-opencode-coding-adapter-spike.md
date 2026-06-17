# opencode Coding Adapter Spike

## Summary

Decision: use `opencode serve` HTTP endpoints as the v0.6 managed coding transport.

`opencode acp` remains useful as an IDE integration reference, but the first DevFlow integration
should not speak ACP directly. ACP adds a stdin/stdout Agent Client Protocol connection and then
delegates cancellation to the same backing session abort capability. DevFlow's Electron main process
can use the HTTP API directly with fewer moving parts.

## Environment

- opencode version: `1.14.40`
- Spike repo: temporary local fixture repo under the OS temp directory
- Model used for no-cost tool-flow validation: opencode built-in fake provider
- Live configured provider was probed only enough to confirm credentials/provider errors are
  possible and must not drive default verification.

## HTTP Findings

Validated with `opencode serve --hostname 127.0.0.1 --port 4097`:

- `POST /session` creates a coding session with per-permission ask rules.
- `POST /session/{sessionID}/message` sends a task prompt.
- `GET /permission` exposes pending permission requests.
- `POST /permission/{requestID}/reply` can approve or reject permission requests.
- `GET /session/{sessionID}/diff` returns repo-relative file diffs after edits.
- `POST /session/{sessionID}/abort` aborts an in-flight session.

Observed successful path:

- DevFlow-style script created a temp repo session.
- Agent requested edit permissions for two files and a bash permission for the test command.
- Script approved each request programmatically.
- opencode applied the changes, ran the test command, and the diff endpoint returned changed file
  patches.

Observed failure/guardrail paths:

- If DevFlow does not answer a permission request, the request remains pending and DevFlow can
  default-reject it by calling the permission reply endpoint.
- A bash `sleep 30` request approved for abort testing was cancelled through
  `POST /session/{sessionID}/abort`; opencode returned a `MessageAbortedError` and cleared pending
  permissions.

## ACP Findings

Validated with `opencode acp --hostname 127.0.0.1 --port 4098 --cwd <fixture>`.

- The command starts the normal HTTP server as a backing service.
- The ACP control plane itself is stdin/stdout NDJSON using Agent Client Protocol.
- ACP permission relay depends on an ACP client implementing `requestPermission`.
- ACP cancel delegates to the backing session abort path.

Conclusion: ACP is a good future compatibility layer for editor-style integrations, but it is not
the simplest v0.6 Electron-hosted runtime.

## Go / No-Go

Go for HTTP server transport.

No-go for direct ACP as the first implementation path.

## Product Constraints Confirmed

- Do not use `--dangerously-skip-permissions`.
- Use ask-by-default permission rules for edit/bash/write/patch.
- Treat permission timeout as a DevFlow-level reject decision.
- Treat cancel as an interrupt that calls session abort and marks the coding run interrupted.
- Capture diffs through opencode's diff endpoint, then redact and cap before storing/syncing.
- Do not sync prompt text, raw trace, raw patch, cwd, stdout, stderr, or provider secrets.
