# ADR 0005: v0.2 Local Execution First

## Status

Accepted

## Context

AI DevFlow Studio had a polished workflow UI, but the workbench was fixture-backed. The next product
step needed to make the desktop client perform a real developer action without expanding into the full
team backend, authentication, or agent orchestration surface.

## Decision

For v0.2, build the local execution slice first. The Electron client selects a local repository,
detects and stores a test command, runs that command through controlled main-process IPC, and archives
test evidence in local SQLite.

## Consequences

- The product gains a real local developer workflow before team synchronization exists.
- SQLite is the source of truth for local projects, test commands, runs, artifacts, events, and test
  evidence in this slice.
- Team backend sync, auth, Postgres persistence, and manager-wide real data remain v0.3 concerns.
- Renderer code must not directly access filesystem or shell APIs; it uses preload-exposed commands.
