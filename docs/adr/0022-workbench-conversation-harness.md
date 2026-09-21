# ADR 0022: Workbench conversation execution adapters

Status: accepted for implementation; live acceptance tracked by #147.

## Problem

A model Provider selects an API/model, while a harness owns an agent session and
tool execution. The workbench currently exposes only the former. Conversation
history must remain independent, while every conversation may query current
project workflow facts through the same authority checks.

## Capability research

Checked the upstream interfaces on 2026-09-20:

| Candidate | Integration surface | Decision |
| --- | --- | --- |
| OpenCode | HTTP server sessions, message parts, abort, permission rules and remote MCP | First adapter; reuse the existing managed-process and Provider binding infrastructure |
| Codex | SDK thread/resume and streamed run interfaces | A later adapter requires separate approval/tool/identity mapping; do not pretend it is the OpenCode protocol |

Primary references: [OpenCode server](https://opencode.ai/docs/server/),
[permissions](https://opencode.ai/docs/permissions/),
[remote MCP](https://opencode.ai/docs/mcp-servers/), and
[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk).
MCP transport follows the
[Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

## Product decision

Keep one conversation type. Choose Direct Provider or OpenCode when starting a
new conversation in the right panel. The selection is persisted on that
conversation, defaults to Direct Provider for legacy records, and is immutable
after creation. Choosing another execution method creates an independent chat;
it never silently replays an existing conversation into another runtime.

The header distinguishes execution method from model. Both use the selected
saved Provider/model, but OpenCode runs it through a compatible locally installed
CLI discovered when sending. Its credential is supplied only in the managed
process environment. A missing CLI or saved Provider produces a recoverable
error and never falls back to Direct Provider. This does not require switching
the project's Coding executor, and node executors remain independent.

## Execution boundary

The first OpenCode chat adapter runs a fresh managed session per user turn and
restores only that conversation's bounded persisted history. It is an
investigation harness: OpenCode drives its agent/tool loop. An authenticated,
loopback-only, turn-scoped MCP bridge exposes workflow, node, artifact, repository
read/search and knowledge queries. The bridge fixes project identity in its
closure; tools cannot supply a different project or read another chat.

Built-in filesystem/shell/write/network and other MCP tools are denied. Repository
reads pass through DevFlow's existing path, secret, symlink and size checks.
This gives both executors the same query authority without copying a local
database or supplying the harness with an unrestricted repository root.

The bridge expires when the turn ends. Each turn owns its runtime and shutdown;
cancelling one conversation cannot abort another. A restart preserves user
history and marks unfinished work interrupted, awaiting an explicit retry.
Only real execution events, returned reasoning and reported usage are shown.
Unknown reasoning effort/usage remains unknown. Final rich replies use the same
validated message/action/draft contract as Direct Provider.

Chat has no formal stage, Gate or delivery write tool. Explicitly saving a
proposal retains its existing pending-artifact behavior. Navigation buttons
open actual nodes; replacing the harness does not grant approval authority.

## Acceptance

Cover contract migration, selection, sends, real MCP calls, cancellation, retry,
restart, wrong project/object IDs, concurrent conversations and no fallback.
Use isolated data for live OpenCode UI verification. Unit/mock transport tests
do not substitute for that live acceptance. Preserve the user's existing Run.
