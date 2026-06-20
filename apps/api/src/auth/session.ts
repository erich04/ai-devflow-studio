import type { IncomingHttpHeaders } from 'node:http'
import type {
  AuthenticatedSession,
  DemoSession,
  ProjectMembership,
  RequiredGateRole,
  Role,
  TeamSession,
} from '@ai-devflow/shared'

const ROLE_RANK: Record<Role, number> = {
  member: 1,
  lead: 2,
  owner: 3,
}

export type ResolveRequestSessionOptions = {
  allowDemoFallback?: boolean
}

export type CreateAuthenticatedSessionInput = Omit<AuthenticatedSession, 'source'>

type HeaderBag = IncomingHttpHeaders | Record<string, string | string[] | undefined>

function readHeader(headers: HeaderBag, key: string): string | undefined {
  const raw = headers[key.toLowerCase()] ?? headers[key]
  const value = Array.isArray(raw) ? raw[0] : raw
  return value?.trim() || undefined
}

function parseRole(value: string | undefined): Role | null {
  if (value === 'owner' || value === 'lead' || value === 'member') {
    return value
  }

  return null
}

function parseSessionSource(value: string | undefined): TeamSession['source'] | null {
  if (value === undefined || value === 'demo') {
    return 'demo'
  }

  if (value === 'authenticated') {
    return 'authenticated'
  }

  return null
}

function parseProjectMemberships(value: string | undefined, userId: string): ProjectMembership[] {
  if (!value) {
    return []
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [projectId, rawRole] = entry.split(':').map((part) => part.trim())
      const role = parseRole(rawRole)
      if (!projectId || !role) {
        throw new Error(`Invalid project membership header entry: ${entry}`)
      }

      return { projectId, userId, role }
    })
}

export function createDemoSession(): DemoSession {
  return {
    source: 'demo',
    organizationId: 'org-demo',
    userId: 'u-erich',
    role: 'owner',
    projectMemberships: [],
  }
}

export function createAuthenticatedSession(
  input: CreateAuthenticatedSessionInput,
): AuthenticatedSession {
  return {
    source: 'authenticated',
    ...input,
  }
}

export function isDemoSession(session: TeamSession): session is DemoSession {
  return session.source === 'demo'
}

export function isAuthenticatedSession(session: TeamSession): session is AuthenticatedSession {
  return session.source === 'authenticated'
}

export function resolveRequestSession(
  headers: HeaderBag,
  options: ResolveRequestSessionOptions = {},
): TeamSession | null {
  const allowDemoFallback = options.allowDemoFallback ?? true
  const userId = readHeader(headers, 'x-devflow-user-id')
  const source = parseSessionSource(readHeader(headers, 'x-devflow-session-source'))

  if (!source) {
    return null
  }

  if (!userId) {
    return allowDemoFallback ? createDemoSession() : null
  }

  const role = parseRole(readHeader(headers, 'x-devflow-user-role'))
  if (!role) {
    return null
  }

  try {
    const organizationId = readHeader(headers, 'x-devflow-organization-id') ?? 'org-demo'
    const projectMemberships = parseProjectMemberships(
      readHeader(headers, 'x-devflow-project-roles'),
      userId,
    )

    if (source === 'authenticated') {
      const authAccountId = readHeader(headers, 'x-devflow-auth-account-id')
      if (!authAccountId) {
        return null
      }

      return createAuthenticatedSession({
        organizationId,
        userId,
        role,
        authAccountId,
        projectMemberships,
      })
    }

    return {
      source: 'demo',
      organizationId,
      userId,
      role,
      projectMemberships,
    }
  } catch {
    return null
  }
}

export function canSatisfyRole(role: Role, requiredRole: RequiredGateRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[requiredRole]
}

export function getProjectRole(session: TeamSession, projectId: string): Role | null {
  if (session.role === 'owner') {
    return 'owner'
  }

  return session.projectMemberships.find((membership) => membership.projectId === projectId)?.role ?? null
}

export function canAccessProject(session: TeamSession, projectId: string): boolean {
  return getProjectRole(session, projectId) !== null
}

export function canSyncProject(
  session: TeamSession,
  projectId: string,
  requiredRole: RequiredGateRole = 'member',
): boolean {
  const projectRole = getProjectRole(session, projectId)
  return projectRole ? canSatisfyRole(projectRole, requiredRole) : false
}
