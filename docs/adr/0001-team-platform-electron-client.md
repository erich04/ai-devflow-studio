# ADR 0001: Team Platform With Electron Developer Client

## Status

Accepted

## Context

The product needs local repository access, MCP server configuration, terminal/test execution, and a
manager view across people and projects.

## Decision

Build AI DevFlow Studio as a team platform with an Electron developer client. Local execution happens
on the developer machine. Team state, audit, costs, and overview data are synchronized to the backend.

## Consequences

- The desktop app can safely work with local repositories and tools.
- Managers see team-wide state from the backend instead of private local-only data.
- The product needs clear upload and redaction policy because local evidence is synchronized.
