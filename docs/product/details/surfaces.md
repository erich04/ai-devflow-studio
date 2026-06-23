# Product Surfaces

## Desktop Workbench

Primary developer surface.

Required screen areas:

- Navigation across Workbench, Team, Knowledge, Agents, Skills, MCP, and Tests.
- Project selector and pairing state.
- New Run intake.
- Workflow canvas.
- Selected-node inspector.
- Local project/test command panel.
- Gate Enforcement panel.
- Agent Workbench and runtime timeline.
- Tests view.
- Team sync controls.

Desktop owns local execution. It can show private details that should not sync raw to the team.

## Web Team Console

Team visibility surface.

Required screen areas:

- Delivery health summary.
- Evidence Chain for the active or latest Run.
- Human Gate summary.
- Active Agents rollup.
- Test Evidence rollup.
- Runtime Budget summary.
- Policy / Warnings summary.
- Desktop pairing entry point.
- Link to legacy shell while the product shell is being refined.

Web should emphasize redacted delivery health, not raw local execution.

## API Backend

Team state and policy source of truth.

Required responsibilities:

- Authenticated session and project membership.
- Team overview.
- Project creation and membership-aware project access.
- Desktop pairing.
- Redacted sync ingestion.
- Policy and budget persistence.
- Agent Review execution against team state.

## Shared Domain Core

Cross-runtime product logic.

Required responsibilities:

- Domain types.
- Workflow creation and advancement.
- Artifact creation helpers.
- Gate policy evaluation.
- Knowledge governance.
- Budget guard logic.
- Redaction-safe contracts.

