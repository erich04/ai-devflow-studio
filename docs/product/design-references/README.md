# Design References

This folder stores visual references that should inform DevFlow Studio UI work without becoming runtime source code.

## Airbnb-III Workbench Reference

![Airbnb-III workbench reference](./airbnb-iii-workbench-reference.png)

Source:

- OpenDesign project: `Airbnb-III`
- OpenDesign project id: `a2407ed0-1392-42b1-81ac-eda3bf593560`
- Source artifact: `index.html`
- Captured: 2026-06-23

Use this screenshot as the primary visual reference for the upcoming Electron frontend refactor.

Preserve these product decisions when porting the prototype into React:

- Keep Team Project and Local Project visually separate in the top context area.
- Keep the left rail narrow and stable across Workbench, Team, Knowledge, Agents, Skills, MCP, and Tests.
- Keep the Workbench as a three-zone layout: Local Project + Runs, Workflow Board, and right-side Inspector.
- Keep Workflow Board cards compact; detailed diagnostics belong in the Inspector.
- Keep the right Inspector action-oriented with Next Best Action, tabs, Artifacts, Evidence, and Handoff.
- Keep status chips visible for policy, review, evidence, role, budget, sync, and test states.
- Treat this as a visual and interaction reference, not as a static HTML source to embed directly.
