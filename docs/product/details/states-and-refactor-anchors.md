# Product States And UI Refactor Anchors

## Product States

### Empty

The user has no real Run or no synced team data.

The UI should:

- Explain what is missing.
- Provide the next action.
- Avoid pretending fixture data is real user work.

### Active

The Run is progressing through clarification, design, build, test, PR, or acceptance.

The UI should:

- Highlight current node.
- Show available actions for that node.
- Show evidence already attached to the Run.
- Show blockers and warnings near the action they affect.

### Paused At Gate

The Run is waiting for human decision.

The UI should:

- Show required role.
- Show enforcement decision.
- Show missing evidence.
- Show Knowledge Review and policy findings.
- Offer approve, reject, or override only when the write path allows it.

### Completed

The Run has final acceptance.

The UI should:

- Show the final evidence bundle.
- Show final Gate decision.
- Preserve audit trail.
- Keep follow-up actions separate from the completed Run state.

### Failed / Cancelled / Timed Out

The product should make terminal failures explicit.

The UI should:

- Show where the failure occurred.
- Preserve partial evidence.
- Offer retry or remediation only through explicit user action.

## UI Refactor Anchors

The next UI refactor should preserve these product anchors:

- Evidence Chain is the center of gravity.
- Desktop is for local action and private execution.
- Web is for team visibility and redacted oversight.
- Gates are decision points, not decorative statuses.
- Agents are runtime participants, not the whole product.
- Knowledge, policy, tests, and budget should appear as evidence and constraints around delivery.
- The user should always know the current stage, blocking reason, next action, and evidence status.

## Near-Term Product Gaps

These are product gaps, not necessarily immediate implementation tasks:

- Better request intake ergonomics.
- Clearer stage-completion controls for clarify and design.
- Deeper PR draft editing and handoff.
- Acceptance bundle preview and final signoff polish.
- Review provider setup flow.
- Runtime budget administration UX.
- Team collaboration and conflict visibility.
- GitHub delivery integration after PR draft is stable.

## Out Of Scope For The UI Refactor

Unless explicitly promoted by a future plan, the UI refactor should not introduce:

- Public SaaS onboarding.
- Billing.
- Enterprise SSO.
- Hosted multi-tenancy.
- Automatic cloud deployment.
- Signed installer or auto-update flows.
- Real MCP process execution.
- Full RAG/vector retrieval provider integration.
- Autonomous push, merge, or PR creation.
