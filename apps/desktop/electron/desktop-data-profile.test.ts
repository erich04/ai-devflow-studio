import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDesktopDataProfileDiagnostics,
  classifyDesktopDataProfileOpenError,
  persistDesktopDataProfileSelection,
  readDesktopDataProfileRegistry,
  resolveDesktopDataProfile,
  safeDesktopDataProfileSummary,
} from './desktop-data-profile'

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-data-profile-'))
  return {
    root,
    productDataRoot: path.join(root, 'AI DevFlow Studio'),
    defaultUserDataDirectory: path.join(root, '@ai-devflow', 'desktop'),
    registryPath: path.join(root, 'profiles.json'),
  }
}

function createDatabase(directory: string) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, 'devflow.sqlite'), 'valid-for-profile-resolution')
}

describe('Desktop data profile resolver', () => {
  it('uses one stable development profile when no prior database exists', async () => {
    const input = await fixture()
    const resolution = resolveDesktopDataProfile({
      ...input,
      mode: 'development',
      env: {},
    })

    expect(resolution.status).toBe('selected')
    if (resolution.status !== 'selected') return
    expect(resolution.profile.directory).toBe(path.join(input.productDataRoot, 'local-development'))
    expect(resolution.profile.source).toBe('development_default')
  })

  it('treats an explicit directory as an intentional profile selection', async () => {
    const input = await fixture()
    const explicit = path.join(input.root, 'operator-selected')
    const resolution = resolveDesktopDataProfile({
      ...input,
      mode: 'development',
      env: {
        DEVFLOW_USER_DATA_DIR: explicit,
        DEVFLOW_DATA_PROFILE_NAME: 'primary-dev',
      },
    })

    expect(resolution.status).toBe('selected')
    if (resolution.status !== 'selected') return
    expect(resolution.profile).toMatchObject({
      name: 'primary-dev',
      directory: explicit,
      source: 'explicit_env',
    })
  })

  it('keeps smoke and test registries isolated when an explicit registry path is provided', async () => {
    const input = await fixture()
    const isolatedRegistry = path.join(input.root, 'smoke-profile', 'registry.json')
    const resolution = resolveDesktopDataProfile({
      mode: 'development',
      defaultUserDataDirectory: input.defaultUserDataDirectory,
      productDataRoot: input.productDataRoot,
      env: {
        DEVFLOW_USER_DATA_DIR: path.join(input.root, 'smoke-profile'),
        DEVFLOW_DATA_PROFILE_REGISTRY_PATH: isolatedRegistry,
      },
    })

    expect(resolution).toMatchObject({ status: 'selected', registryPath: isolatedRegistry })
  })

  it('reuses a persisted explicit profile when the next launch omits the environment variable', async () => {
    const input = await fixture()
    const explicit = path.join(input.root, 'operator-selected')
    createDatabase(explicit)
    const first = resolveDesktopDataProfile({
      ...input,
      mode: 'development',
      env: { DEVFLOW_USER_DATA_DIR: explicit },
    })
    expect(first.status).toBe('selected')
    if (first.status !== 'selected') return
    persistDesktopDataProfileSelection({
      registryPath: input.registryPath,
      profile: first.profile,
      openedAt: '2026-08-30T12:00:00.000Z',
    })

    const restarted = resolveDesktopDataProfile({ ...input, mode: 'development', env: {} })
    expect(restarted.status).toBe('selected')
    if (restarted.status !== 'selected') return
    expect(restarted.profile.directory).toBe(explicit)
    expect(restarted.profile.source).toBe('saved_profile')
  })

  it('blocks an explicit directory that conflicts with the saved profile without changing the registry', async () => {
    const input = await fixture()
    const savedDirectory = path.join(input.root, 'saved-profile')
    const alternateDirectory = path.join(input.root, 'alternate-profile')
    const selected = resolveDesktopDataProfile({
      ...input,
      mode: 'development',
      env: { DEVFLOW_USER_DATA_DIR: savedDirectory },
    })
    expect(selected.status).toBe('selected')
    if (selected.status !== 'selected') return
    persistDesktopDataProfileSelection({
      registryPath: input.registryPath,
      profile: selected.profile,
      openedAt: '2026-08-30T12:00:00.000Z',
    })
    const registryBefore = readFileSync(input.registryPath, 'utf8')

    const conflicted = resolveDesktopDataProfile({
      ...input,
      mode: 'development',
      env: { DEVFLOW_USER_DATA_DIR: alternateDirectory },
    })

    expect(conflicted).toMatchObject({
      status: 'blocked',
      code: 'explicit_profile_conflict',
    })
    if (conflicted.status !== 'blocked') return
    expect(conflicted.message).toContain('Unset DEVFLOW_USER_DATA_DIR')
    expect(conflicted.message).toContain('DEVFLOW_DATA_PROFILE_REGISTRY_PATH')
    expect(readFileSync(input.registryPath, 'utf8')).toBe(registryBefore)
  })

  it('allows an explicit directory when it identifies the same saved profile', async () => {
    const input = await fixture()
    const directory = path.join(input.root, 'same-profile')
    const selected = resolveDesktopDataProfile({
      ...input,
      mode: 'development',
      env: { DEVFLOW_USER_DATA_DIR: directory },
    })
    expect(selected.status).toBe('selected')
    if (selected.status !== 'selected') return
    persistDesktopDataProfileSelection({ registryPath: input.registryPath, profile: selected.profile })

    const restarted = resolveDesktopDataProfile({
      ...input,
      mode: 'development',
      env: { DEVFLOW_USER_DATA_DIR: directory },
    })

    expect(restarted).toMatchObject({
      status: 'selected',
      profile: { directory, source: 'explicit_env' },
    })
  })

  it('refuses to overwrite a saved profile even when persistence is called directly', async () => {
    const input = await fixture()
    const saved = resolveDesktopDataProfile({
      ...input,
      mode: 'development',
      env: { DEVFLOW_USER_DATA_DIR: path.join(input.root, 'saved-profile') },
    })
    const alternate = resolveDesktopDataProfile({
      ...input,
      mode: 'development',
      env: { DEVFLOW_USER_DATA_DIR: path.join(input.root, 'alternate-profile') },
      registryPath: path.join(input.root, 'isolated-profile-selection.json'),
    })
    expect(saved.status).toBe('selected')
    expect(alternate.status).toBe('selected')
    if (saved.status !== 'selected' || alternate.status !== 'selected') return
    persistDesktopDataProfileSelection({ registryPath: input.registryPath, profile: saved.profile })
    const registryBefore = readFileSync(input.registryPath, 'utf8')

    expect(() => persistDesktopDataProfileSelection({
      registryPath: input.registryPath,
      profile: alternate.profile,
    })).toThrow('Desktop data profile selection conflict')
    expect(readFileSync(input.registryPath, 'utf8')).toBe(registryBefore)
    expect(classifyDesktopDataProfileOpenError(
      new Error('Desktop data profile selection conflict'),
    )).toMatchObject({ code: 'selection_conflict' })
  })

  it('blocks instead of guessing when two valid databases exist and no selection was saved', async () => {
    const input = await fixture()
    createDatabase(input.defaultUserDataDirectory)
    createDatabase(path.join(input.productDataRoot, 'local-development'))

    const resolution = resolveDesktopDataProfile({ ...input, mode: 'development', env: {} })
    expect(resolution).toMatchObject({
      status: 'blocked',
      code: 'ambiguous_profiles',
    })
    expect(resolution.candidates).toHaveLength(2)
  })

  it('blocks when the selected profile directory disappears instead of opening another database', async () => {
    const input = await fixture()
    const missing = path.join(input.root, 'removed-profile')
    mkdirSync(missing, { recursive: true })
    const selected = resolveDesktopDataProfile({
      ...input,
      mode: 'development',
      env: { DEVFLOW_USER_DATA_DIR: missing },
    })
    expect(selected.status).toBe('selected')
    if (selected.status !== 'selected') return
    persistDesktopDataProfileSelection({ registryPath: input.registryPath, profile: selected.profile })
    const registry = readDesktopDataProfileRegistry(input.registryPath)
    registry.profiles[0]!.directory = path.join(input.root, 'does-not-exist')
    writeFileSync(input.registryPath, JSON.stringify(registry))

    const restarted = resolveDesktopDataProfile({ ...input, mode: 'development', env: {} })
    expect(restarted).toMatchObject({ status: 'blocked', code: 'saved_profile_missing' })
  })

  it('keeps absolute paths out of the safe renderer and remote summary', async () => {
    const input = await fixture()
    const resolution = resolveDesktopDataProfile({
      ...input,
      mode: 'development',
      env: { DEVFLOW_USER_DATA_DIR: path.join(input.root, 'private', 'profile') },
    })
    expect(resolution.status).toBe('selected')
    if (resolution.status !== 'selected') return
    const summary = safeDesktopDataProfileSummary(resolution.profile)
    expect(summary).not.toHaveProperty('directory')
    expect(summary).not.toHaveProperty('databasePath')
    expect(JSON.stringify(summary)).not.toContain(input.root)
  })

  it('builds renderer diagnostics without exposing the database path', async () => {
    const input = await fixture()
    const resolution = resolveDesktopDataProfile({
      ...input,
      mode: 'development',
      env: { DEVFLOW_USER_DATA_DIR: path.join(input.root, 'private', 'profile') },
    })
    expect(resolution.status).toBe('selected')
    if (resolution.status !== 'selected') return

    const diagnostics = buildDesktopDataProfileDiagnostics({
      profile: resolution.profile,
      schemaVersion: 34,
      projectCount: 2,
      runs: [
        { updatedAt: '2026-08-29T10:00:00.000Z' },
        { updatedAt: '2026-08-30T12:00:00.000Z' },
      ],
    })
    expect(diagnostics).toMatchObject({
      schemaVersion: 34,
      projectCount: 2,
      runCount: 2,
      latestRunUpdatedAt: '2026-08-30T12:00:00.000Z',
    })
    expect(JSON.stringify(diagnostics)).not.toContain(input.root)
    expect(diagnostics).not.toHaveProperty('directory')
    expect(diagnostics).not.toHaveProperty('databasePath')
  })

  it('fails closed on a corrupt registry', async () => {
    const input = await fixture()
    writeFileSync(input.registryPath, '{not-json')
    const resolution = resolveDesktopDataProfile({ ...input, mode: 'development', env: {} })
    expect(resolution).toMatchObject({ status: 'blocked', code: 'invalid_registry' })
  })

  it.each([
    ['schema version 99 is newer than supported', 'incompatible_schema'],
    ['EACCES: permission denied', 'unwritable_profile'],
    ['file is not a database', 'unreadable_database'],
  ] as const)('classifies startup failure %s as %s', (message, code) => {
    expect(classifyDesktopDataProfileOpenError(new Error(message))).toMatchObject({ code })
  })
})
