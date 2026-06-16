# ADR 0003: Postgres And SQLite Data Boundary

## Status

Accepted

## Context

Team collaboration data and local developer state have different lifecycles.

## Decision

Use Postgres as the team source of truth and SQLite in Electron for local repository configuration,
MCP settings, draft state, theme preference, and offline cache.

## Consequences

- Team dashboards are consistent and queryable.
- Local sensitive paths and tool settings do not need to be globally stored.
- Synchronization boundaries must be explicit.
