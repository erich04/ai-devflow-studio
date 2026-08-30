# Desktop data profiles

Electron treats a LocalStore directory as an explicit data profile. A profile owns one
`devflow.sqlite` plus the local project, Run, pairing, Provider, Evidence, and workflow state stored
inside it. Profiles are never merged, copied, deleted, or selected by comparing workflow progress.

## Resolution order

The profile is resolved before the Electron single-instance lock and before LocalStore, recovery, or
Team synchronization starts:

1. If a profile is already saved for the current mode, reuse it. An explicit
   `DEVFLOW_USER_DATA_DIR` is accepted only when it resolves to that same directory.
2. With no saved profile, `DEVFLOW_USER_DATA_DIR` is an explicit operator selection.
3. With no saved selection, reuse one uniquely discovered existing database.
4. With no existing database, development uses the stable `AI DevFlow Studio/local-development`
   profile and packaged builds use Electron's product default.

If multiple valid databases exist and no explicit or saved selection identifies one, startup stops
before opening either database. Set `DEVFLOW_USER_DATA_DIR` once to select the intended profile. If a
saved profile disappears, startup also stops instead of silently opening a different database.

If `DEVFLOW_USER_DATA_DIR` points somewhere other than the saved profile, startup stops before
LocalStore, workflow IPC handlers, Team synchronization, or recovery schedulers start. The registry
is not overwritten. Unset `DEVFLOW_USER_DATA_DIR` to reopen the saved profile. For an intentional
isolated run, set both `DEVFLOW_USER_DATA_DIR` and a separate
`DEVFLOW_DATA_PROFILE_REGISTRY_PATH`; changing only the data directory is not a profile switch.

The successful selection is recorded in a local `data-profiles.json` registry. Smoke tests set
`DEVFLOW_DATA_PROFILE_REGISTRY_PATH` to a temporary path so they cannot replace the operator's saved
selection.

## Privacy and recovery boundaries

- Renderer-safe diagnostics use profile name, source, mode, and a one-way path fingerprint. They do
  not include the absolute database path.
- Absolute paths and the registry stay local; they are not part of Team sync or Provider context.
- A profile switch does not modify either SQLite file.
- Recovery is an explicit selection operation, not an automatic database merge.
- Database corruption, an unsupported registry, and an unavailable saved profile are separate
  fail-closed startup errors.

For the first explicit selection, when the current registry has no saved profile:

```bash
DEVFLOW_USER_DATA_DIR="/absolute/local/profile" corepack pnpm dev:electron
```

For an isolated one-off launch after a profile has already been saved:

```bash
DEVFLOW_USER_DATA_DIR="/absolute/local/alternate-profile" \
DEVFLOW_DATA_PROFILE_REGISTRY_PATH="/absolute/local/alternate-registry.json" \
corepack pnpm dev:electron
```

After the database opens successfully, ordinary development launches reuse that profile. A different
directory must use an isolated registry or a deliberate registry-management operation; startup never
silently replaces the saved selection.
