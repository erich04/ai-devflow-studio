# ADR 0004: Shared Theme Token Strategy

## Status

Accepted

## Context

The desktop app and web console must support light mode, dark mode, and following the system setting.

## Decision

Use shared theme names and CSS variables. Components consume semantic tokens instead of hard-coded
colors. Desktop stores theme preference locally; web stores it in user settings later.

## Consequences

- The same UI language works across Electron and Web.
- Workflow canvas, logs, diffs, charts, and graphs can be tuned separately for low-glare dark mode.
