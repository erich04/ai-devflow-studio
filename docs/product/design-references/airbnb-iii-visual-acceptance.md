# Airbnb-III Visual Acceptance

This file tracks the manual visual acceptance pass for the React/Electron port of
the OpenDesign Airbnb-III prototype.

## Capture Command

Run:

```bash
corepack pnpm visual:desktop
```

Output:

- `test-results/airbnb-iii-visual/manifest.json`
- `test-results/airbnb-iii-visual/<viewport>-<route>.png`

Reference images stay in this folder and are not runtime source.

## Acceptance Standard

- Primary viewport: `3840x2160`.
- Secondary safety viewports: `1920x1080`, `1440x900`.
- Light theme is the pixel target.
- Dark/system only need to remain usable.
- Do not claim pixel-level completion until every row below is `pass`.

## Manual Review Matrix

| Surface | Reference | Primary Capture | Status | Notes |
|---|---|---|---|---|
| Workbench | `airbnb-iii-workbench-reference.png` | `3840x2160-workbench.png` | needs-fix | 1920 compression is fixed; remaining gaps: Inspector is still more diagnostic-heavy than the compact handoff panel and the board density needs final side-by-side tuning. |
| Team Policy | `airbnb-iii-team-policy-reference.png` | `3840x2160-team.png` | needs-review | Verify policy matrix density, snapshot panel height, and table row spacing after CSS convergence. |
| Knowledge | `airbnb-iii-knowledge-reference.png` | `3840x2160-knowledge.png` | needs-review | Verify two-panel layout, graph proportions, and source card density. |
| Agents | `airbnb-iii-agents-reference.png` | `3840x2160-agents.png` | needs-fix | Main surface now uses a two-panel Review / Coding layout; remaining gaps: empty runtime fixture leaves too much vertical whitespace and provider status still sits below the main console. |
| Skills | `airbnb-iii-skills-reference.png` | `3840x2160-skills.png` | needs-review | Verify six-card catalog density and header chip alignment. |
| MCP | `airbnb-iii-mcp-reference.png` | `3840x2160-mcp.png` | needs-review | Verify table width, row height, and permission/security columns. |
| Tests | `airbnb-iii-tests-reference.png` | `3840x2160-tests.png` | needs-review | Verify two-panel split, progress bar, and evidence list spacing. |

## Regression Checklist

- Workbench still shows board provenance and `ART / EVD / TRC` chips.
- Search results deep-link Artifact and Event back into the Inspector.
- Team sync preserves local and remote runs in the visible run list.
- Inspector status matrix and Gate condition matrix remain visible.
- `corepack pnpm verify` passes before updating any status to `pass`.
