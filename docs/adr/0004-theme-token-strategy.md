# ADR 0004: Shared Theme Token Strategy

## Status

Accepted

## Context

The desktop app and web console must support light mode, dark mode, and following the system setting.

## Decision

Use shared theme names and CSS variables. Components consume semantic tokens instead of hard-coded
colors. Desktop stores theme preference locally. Web stores the system/light/dark preference in browser
localStorage and applies it in the document head before content paints; CSS follows system changes.
Storage failures fall back to the system and do not prevent an in-page theme change. Preferences
remain on the same public origin across logout. Account-synced Web preferences remain future work.

## Consequences

- The same UI language works across Electron and Web.
- Workflow canvas, logs, diffs, charts, and graphs can be tuned separately for low-glare dark mode.
