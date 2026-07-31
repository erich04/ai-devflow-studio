# Windows ZIP Smoke Guide

Use this source-validation path when a Windows machine cannot reliably clone the repository from GitHub. It covers source launch, ZIP Git limitations, and validation against another local Git repository.

## Recommended Environment

- Windows 11. Windows 10 is best-effort.
- Node.js 24 with Corepack.
- PowerShell.
- Git for Windows when validating Git-backed local project behavior.

## Run From a GitHub ZIP

Download the `main` branch ZIP, extract it to a short path such as `C:\dev\ai-devflow-studio`, and open PowerShell in that directory.

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm dev:electron
```

`dev:electron` builds the Electron main and preload bundles, starts Vite on `http://127.0.0.1:5173`, and opens the real desktop app.

Local folder selection, controlled IPC, command safety checks, and SQLite persistence should be available.

## ZIP Git Boundary

A GitHub ZIP does not include a `.git` directory. DevFlow itself can run, but selecting that extracted folder as the local project limits Git-backed features.

Expected limitations include branch refresh, branch watchers, managed coding worktrees, and Git diff capture. The Branch field should report that the folder is not a Git repository.

For a fuller validation, run DevFlow from the extracted ZIP and select another small, committed Git repository with a test script inside the app.

Check that:

- the local project card shows the selected repository;
- the project path uses the expected Windows path;
- Branch shows the selected repository's current branch;
- Branch refresh reflects an external branch switch;
- a new Run uses the selected repository instead of demo fixture data;
- local test execution uses the detected package script.

## Optional Local Git Initialization

If the extracted DevFlow directory must be the selected local project, initialize it first:

```powershell
git init
git checkout -b main
git add .
git commit -m "local windows smoke"
```

This creates local Git state only. It does not restore the original repository history or configure a remote.

## Current Support Boundary

Windows support currently covers source and development validation. CI runs type checks, unit tests, and static cross-platform audits on Windows.

The project does not yet claim a signed Windows installer or complete Windows Electron full-smoke signoff. Record failures with the exact command, terminal output, and source method: ZIP, clone, or bundle.
