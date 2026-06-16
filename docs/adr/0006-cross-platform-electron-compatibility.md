# ADR 0006: Cross-Platform Electron Compatibility

## Status

Accepted

## Context

AI DevFlow Studio is an Electron-first developer client that must run on the machines where team
developers actually work. The current local execution slice has been validated primarily on macOS,
but the product also needs to land on Windows for team adoption.

## Decision

Treat macOS and Windows as first-class desktop targets for DevFlow Studio. Windows 11 is the primary
Windows target; Windows 10 is best-effort.

All Electron local execution, persistence, and smoke-test work must avoid macOS-only assumptions:

- Do not hard-code POSIX paths, `/tmp`, forward-slash separators, or shell-specific quoting.
- Do not require `bash`, `zsh`, or Unix utilities for app behavior.
- Use Node/Electron cross-platform APIs such as `path`, `os.tmpdir()`, `spawn` with explicit
  `cwd`/`env`, and Electron `app.getPath('userData')`.
- Keep command safety checks aware of Windows command surfaces such as PowerShell and `cmd`.
- Keep Playwright/Electron smoke tests written in a way that can run on macOS and Windows.

Electron packaging, installers, code signing, notarization, and auto-update are separate release
distribution concerns and are not part of v0.3 unless explicitly scoped later.

## Consequences

- v0.3 backend synchronization work must preserve Windows compatibility in API, Web, Electron sync,
  local execution, SQLite storage, path display, and test automation.
- The project should add Windows CI or a documented Windows smoke path before declaring team desktop
  support complete.
- Local evidence sync must not assume macOS filesystem paths or shell behavior.
- Future packaging work must handle macOS and Windows as separate release tracks.
