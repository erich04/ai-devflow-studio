import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const DESKTOP_DATA_PROFILE_REGISTRY_VERSION = 1
export const DESKTOP_DATA_PROFILE_DATABASE_NAME = 'devflow.sqlite'

export type DesktopDataProfileMode = 'development' | 'packaged'
export type DesktopDataProfileSource =
  | 'explicit_env'
  | 'saved_profile'
  | 'discovered_existing'
  | 'development_default'
  | 'product_default'

export type DesktopDataProfile = {
  id: string
  name: string
  mode: DesktopDataProfileMode
  source: DesktopDataProfileSource
  directory: string
  databasePath: string
  pathFingerprint: string
}

export type DesktopDataProfileRegistryEntry = Omit<
  DesktopDataProfile,
  'source' | 'databasePath'
> & {
  lastOpenedAt: string
}

export type DesktopDataProfileRegistry = {
  version: typeof DESKTOP_DATA_PROFILE_REGISTRY_VERSION
  selectedByMode: Partial<Record<DesktopDataProfileMode, string>>
  profiles: DesktopDataProfileRegistryEntry[]
}

export type DesktopDataProfileResolution =
  | {
      status: 'selected'
      profile: DesktopDataProfile
      registryPath: string
      candidates: DesktopDataProfile[]
    }
  | {
      status: 'blocked'
      code:
        | 'ambiguous_profiles'
        | 'explicit_profile_conflict'
        | 'saved_profile_missing'
        | 'invalid_registry'
      message: string
      registryPath: string
      candidates: DesktopDataProfile[]
    }

export type DesktopDataProfileOpenFailure = {
  code:
    | 'selection_conflict'
    | 'incompatible_schema'
    | 'unwritable_profile'
    | 'unreadable_database'
  title: string
  message: string
}

export type ResolveDesktopDataProfileInput = {
  mode: DesktopDataProfileMode
  defaultUserDataDirectory: string
  productDataRoot: string
  env: NodeJS.ProcessEnv
  registryPath?: string
}

const emptyRegistry = (): DesktopDataProfileRegistry => ({
  version: DESKTOP_DATA_PROFILE_REGISTRY_VERSION,
  selectedByMode: {},
  profiles: [],
})

function normalizeDirectory(directory: string) {
  return path.resolve(directory)
}

function fingerprintDirectory(directory: string) {
  return createHash('sha256').update(normalizeDirectory(directory)).digest('hex').slice(0, 16)
}

function profileName(directory: string, requestedName?: string) {
  const trimmed = requestedName?.trim()
  if (trimmed) return trimmed.slice(0, 80)
  return path.basename(directory) || 'default'
}

function createProfile(input: {
  directory: string
  mode: DesktopDataProfileMode
  source: DesktopDataProfileSource
  name?: string
}): DesktopDataProfile {
  const directory = normalizeDirectory(input.directory)
  const pathFingerprint = fingerprintDirectory(directory)
  return {
    id: `${input.mode}-${pathFingerprint}`,
    name: profileName(directory, input.name),
    mode: input.mode,
    source: input.source,
    directory,
    databasePath: path.join(directory, DESKTOP_DATA_PROFILE_DATABASE_NAME),
    pathFingerprint,
  }
}

function parseRegistry(raw: string): DesktopDataProfileRegistry {
  const value = JSON.parse(raw) as Partial<DesktopDataProfileRegistry>
  if (
    value.version !== DESKTOP_DATA_PROFILE_REGISTRY_VERSION ||
    !value.selectedByMode ||
    !Array.isArray(value.profiles)
  ) {
    throw new Error('Desktop data profile registry has an unsupported shape')
  }
  if (
    Object.values(value.selectedByMode).some(
      (selectedId) => selectedId !== undefined && typeof selectedId !== 'string',
    )
  ) {
    throw new Error('Desktop data profile registry contains an invalid selection')
  }
  for (const profile of value.profiles) {
    if (
      !profile ||
      typeof profile.id !== 'string' ||
      typeof profile.name !== 'string' ||
      typeof profile.directory !== 'string' ||
      typeof profile.pathFingerprint !== 'string' ||
      typeof profile.lastOpenedAt !== 'string' ||
      (profile.mode !== 'development' && profile.mode !== 'packaged') ||
      !path.isAbsolute(profile.directory)
    ) {
      throw new Error('Desktop data profile registry contains an invalid profile')
    }
  }
  return value as DesktopDataProfileRegistry
}

export function readDesktopDataProfileRegistry(registryPath: string): DesktopDataProfileRegistry {
  if (!existsSync(registryPath)) return emptyRegistry()
  return parseRegistry(readFileSync(registryPath, 'utf8'))
}

function candidateProfiles(input: ResolveDesktopDataProfileInput, registry: DesktopDataProfileRegistry) {
  const developmentDefault = path.join(input.productDataRoot, 'local-development')
  const directories = new Map<string, { directory: string; name?: string }>()
  const register = (directory: string, name?: string) => {
    const normalized = normalizeDirectory(directory)
    directories.set(normalized, { directory: normalized, ...(name ? { name } : {}) })
  }

  register(input.mode === 'development' ? developmentDefault : input.defaultUserDataDirectory)
  register(input.defaultUserDataDirectory)
  for (const profile of registry.profiles.filter((profile) => profile.mode === input.mode)) {
    register(profile.directory, profile.name)
  }

  return [...directories.values()]
    .filter(({ directory }) => existsSync(path.join(directory, DESKTOP_DATA_PROFILE_DATABASE_NAME)))
    .map(({ directory, name }) => createProfile({
      directory,
      mode: input.mode,
      source: 'discovered_existing',
      ...(name ? { name } : {}),
    }))
}

export function resolveDesktopDataProfile(
  input: ResolveDesktopDataProfileInput,
): DesktopDataProfileResolution {
  const registryPath = normalizeDirectory(
    input.registryPath ??
      input.env['DEVFLOW_DATA_PROFILE_REGISTRY_PATH'] ??
      path.join(input.productDataRoot, 'data-profiles.json'),
  )
  let registry: DesktopDataProfileRegistry
  try {
    registry = readDesktopDataProfileRegistry(registryPath)
  } catch (error) {
    return {
      status: 'blocked',
      code: 'invalid_registry',
      message: error instanceof Error ? error.message : 'Desktop data profile registry is invalid',
      registryPath,
      candidates: [],
    }
  }

  const candidates = candidateProfiles(input, registry)
  const explicitDirectory = input.env['DEVFLOW_USER_DATA_DIR']?.trim()
  if (explicitDirectory) {
    const selectedId = registry.selectedByMode[input.mode]
    if (selectedId) {
      const saved = registry.profiles.find(
        (profile) => profile.id === selectedId && profile.mode === input.mode,
      )
      if (!saved) {
        return {
          status: 'blocked',
          code: 'saved_profile_missing',
          message: 'The saved Desktop data profile selection is incomplete. Repair or isolate the profile registry before opening a database; no database or registry was modified.',
          registryPath,
          candidates,
        }
      }
      if (normalizeDirectory(saved.directory) !== normalizeDirectory(explicitDirectory)) {
        return {
          status: 'blocked',
          code: 'explicit_profile_conflict',
          message: `DEVFLOW_USER_DATA_DIR conflicts with the saved ${input.mode} profile (${saved.name}, ${saved.pathFingerprint}). Unset DEVFLOW_USER_DATA_DIR to reuse the saved profile, or set DEVFLOW_DATA_PROFILE_REGISTRY_PATH to an isolated registry for an intentional alternate profile. No database or registry was modified.`,
          registryPath,
          candidates,
        }
      }
    }
    return {
      status: 'selected',
      profile: createProfile({
        directory: explicitDirectory,
        mode: input.mode,
        source: 'explicit_env',
        ...(input.env['DEVFLOW_DATA_PROFILE_NAME']
          ? { name: input.env['DEVFLOW_DATA_PROFILE_NAME'] }
          : {}),
      }),
      registryPath,
      candidates,
    }
  }

  const selectedId = registry.selectedByMode[input.mode]
  if (selectedId) {
    const saved = registry.profiles.find(
      (profile) => profile.id === selectedId && profile.mode === input.mode,
    )
    if (!saved || !existsSync(path.join(saved.directory, DESKTOP_DATA_PROFILE_DATABASE_NAME))) {
      return {
        status: 'blocked',
        code: 'saved_profile_missing',
        message: 'The previously selected Desktop data profile is unavailable. Select a profile explicitly instead of opening a different database.',
        registryPath,
        candidates,
      }
    }
    return {
      status: 'selected',
      profile: createProfile({
        directory: saved.directory,
        mode: input.mode,
        source: 'saved_profile',
        name: saved.name,
      }),
      registryPath,
      candidates,
    }
  }

  if (candidates.length > 1) {
    return {
      status: 'blocked',
      code: 'ambiguous_profiles',
      message: 'Multiple Desktop data profiles contain a valid devflow.sqlite. Set DEVFLOW_USER_DATA_DIR once to choose one; no database was opened or modified.',
      registryPath,
      candidates,
    }
  }

  if (candidates.length === 1) {
    return { status: 'selected', profile: candidates[0]!, registryPath, candidates }
  }

  const defaultDirectory = input.mode === 'development'
    ? path.join(input.productDataRoot, 'local-development')
    : input.defaultUserDataDirectory
  return {
    status: 'selected',
    profile: createProfile({
      directory: defaultDirectory,
      mode: input.mode,
      source: input.mode === 'development' ? 'development_default' : 'product_default',
      name: input.mode === 'development' ? 'local-development' : 'default',
    }),
    registryPath,
    candidates,
  }
}

export function persistDesktopDataProfileSelection(input: {
  registryPath: string
  profile: DesktopDataProfile
  openedAt?: string
}) {
  const registry = readDesktopDataProfileRegistry(input.registryPath)
  const selectedId = registry.selectedByMode[input.profile.mode]
  if (selectedId) {
    const saved = registry.profiles.find(
      (profile) => profile.id === selectedId && profile.mode === input.profile.mode,
    )
    if (
      !saved ||
      saved.id !== input.profile.id ||
      normalizeDirectory(saved.directory) !== normalizeDirectory(input.profile.directory)
    ) {
      throw new Error(
        'Desktop data profile selection conflict: refusing to replace the saved profile. Unset DEVFLOW_USER_DATA_DIR to reuse it, or use an isolated DEVFLOW_DATA_PROFILE_REGISTRY_PATH for an alternate profile.',
      )
    }
  }
  const entry: DesktopDataProfileRegistryEntry = {
    id: input.profile.id,
    name: input.profile.name,
    mode: input.profile.mode,
    directory: input.profile.directory,
    pathFingerprint: input.profile.pathFingerprint,
    lastOpenedAt: input.openedAt ?? new Date().toISOString(),
  }
  const next: DesktopDataProfileRegistry = {
    version: DESKTOP_DATA_PROFILE_REGISTRY_VERSION,
    selectedByMode: { ...registry.selectedByMode, [input.profile.mode]: input.profile.id },
    profiles: [entry, ...registry.profiles.filter((profile) => profile.id !== entry.id)],
  }
  mkdirSync(path.dirname(input.registryPath), { recursive: true })
  const temporaryPath = `${input.registryPath}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaryPath, input.registryPath)
  return next
}

export function safeDesktopDataProfileSummary(profile: DesktopDataProfile) {
  return {
    id: profile.id,
    name: profile.name,
    mode: profile.mode,
    source: profile.source,
    pathFingerprint: profile.pathFingerprint,
  }
}

export function buildDesktopDataProfileDiagnostics(input: {
  profile: DesktopDataProfile
  schemaVersion: number
  projectCount: number
  runs: Array<{ updatedAt: string }>
}) {
  const latestRunUpdatedAt = input.runs.reduce<string | null>(
    (latest, run) => !latest || run.updatedAt > latest ? run.updatedAt : latest,
    null,
  )
  return {
    ...safeDesktopDataProfileSummary(input.profile),
    schemaVersion: input.schemaVersion,
    projectCount: input.projectCount,
    runCount: input.runs.length,
    latestRunUpdatedAt,
  }
}

export function classifyDesktopDataProfileOpenError(error: unknown): DesktopDataProfileOpenFailure {
  const detail = error instanceof Error ? error.message : String(error)
  const normalized = detail.toLowerCase()
  if (normalized.includes('desktop data profile selection conflict')) {
    return {
      code: 'selection_conflict',
      title: 'Desktop data profile selection conflicts with the saved profile',
      message: 'The selected profile was not opened because it conflicts with the saved profile. Unset DEVFLOW_USER_DATA_DIR to reuse the saved profile, or use a separate DEVFLOW_DATA_PROFILE_REGISTRY_PATH for an intentional alternate profile. No registry selection was replaced.',
    }
  }
  if (
    normalized.includes('schema version') ||
    normalized.includes('unsupported schema') ||
    normalized.includes('migration')
  ) {
    return {
      code: 'incompatible_schema',
      title: 'Desktop data profile schema is incompatible',
      message: 'The selected data profile was not opened because its schema is not supported by this Desktop version. Use a compatible application build or select another profile explicitly.',
    }
  }
  if (
    normalized.includes('eacces') ||
    normalized.includes('eperm') ||
    normalized.includes('erofs') ||
    normalized.includes('read-only') ||
    normalized.includes('permission denied')
  ) {
    return {
      code: 'unwritable_profile',
      title: 'Desktop data profile is not writable',
      message: 'The selected data profile cannot be written. Check local directory permissions or select a writable profile explicitly. No alternate database was opened.',
    }
  }
  return {
    code: 'unreadable_database',
    title: 'Desktop data profile cannot be opened',
    message: 'The selected database is unreadable or corrupt. Restore or inspect that profile, or select another profile explicitly. No alternate database was opened.',
  }
}
