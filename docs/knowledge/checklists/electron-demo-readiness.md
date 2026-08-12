---
title: Electron Demo Readiness Checklist
category: review_checklist
ownerId: u-erich
tags: electron, demo, smoke, local, github-delivery
summary: Electron demos should prove Desktop schema v15, production boundaries, governed GitHub Delivery, restart recovery, and credential containment.
---

# Electron Demo Readiness Checklist

Before using the desktop app for a demo or signoff, confirm the real Electron path is active.

- Start the app with `corepack pnpm dev:electron`.
- Confirm the window title is `AI DevFlow Studio` or `ai-devflow-studio`.
- Confirm Electron launched `apps/desktop`, not `default_app.asar`.
- Confirm the intended desktop renderer is listening on `127.0.0.1:5173`.
- Clear stale DevFlow listeners on `5173` before trusting a demo run.
- Confirm the local SQLite database reports Desktop schema v15 and refuses an unknown newer schema.
- Open the Workbench and select a Gate node to confirm Inspector state is live.
- Use `corepack pnpm test:electron-smoke` for automated signoff of preload, main process, SQLite, and local execution behavior.
- For V1.5 GitHub Delivery, prepare the Delivery Intent from the canonical managed worktree and one
  expected tested commit; never trust renderer-supplied source, repository, branch, or commit data.
- Confirm a separate signed Web lead/owner approves the exact redacted Delivery Request before
  Electron main requests a publication credential.
- Confirm Electron main publishes without force and the canonical Run records the verified remote
  head and one matching Draft pull request before Acceptance.
- Verify **Revise** creates a new pre-publication revision and invalidates approval.
- Verify **Resume** continues the same `recovery_required` attempt.
- Verify **Retry** creates the next attempt only after the exact predecessor is proven terminal.
- Verify **Stop** parks the exact active attempt without claiming remote rollback.
- Run `corepack pnpm test:v15-github-delivery-packaged-smoke` to exercise the packaged
  main/preload/renderer path, local fake API, local bare remote, crash/restart reconciliation, and
  credential non-persistence without an external GitHub write.
- Confirm the GitHub App private key stays in the API and the short-lived token stays only in
  Electron main memory; it must not reach the renderer, SQLite, logs, evidence, or error payloads.
- Confirm GitHub Delivery and Acceptance never merge, force-push, delete a branch, publish a tag, or
  otherwise mutate the Draft pull request.
- Treat port conflicts or a default Electron welcome page as environment failures that must be fixed before signoff.
- This checklist does not authorize paid-provider smoke; packaged GitHub Delivery verification uses
  no model-provider request.
