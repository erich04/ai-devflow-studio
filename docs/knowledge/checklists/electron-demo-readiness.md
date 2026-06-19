---
title: Electron Demo Readiness Checklist
category: review_checklist
ownerId: u-erich
tags: electron, demo, smoke, local
summary: Electron demos should prove the real DevFlow app path, expected renderer port, preload boundary, and local persistence path.
---

# Electron Demo Readiness Checklist

Before using the desktop app for a demo or signoff, confirm the real Electron path is active.

- Start the app with `corepack pnpm dev:electron`.
- Confirm the window title is `AI DevFlow Studio` or `ai-devflow-studio`.
- Confirm Electron launched `apps/desktop`, not `default_app.asar`.
- Confirm the intended desktop renderer is listening on `127.0.0.1:5173`.
- Clear stale DevFlow listeners on `5173` before trusting a demo run.
- Open the Workbench and select a Gate node to confirm Inspector state is live.
- Use `corepack pnpm test:electron-smoke` for automated signoff of preload, main process, SQLite, and local execution behavior.
- Treat port conflicts or a default Electron welcome page as environment failures that must be fixed before signoff.
