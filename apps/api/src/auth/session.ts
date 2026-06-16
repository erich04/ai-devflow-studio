import type { IncomingHttpHeaders } from 'node:http'
import type { ProjectMembership, RequiredGateRole, Role, TeamSession } from '@ai-devflow/shared'

const ROLE_RANK: Record<Role, number> = {
  member: 1,
  lead: 2,
  owner: 3,
}

export type ResolveRequestSessionOptions = {
  allowDemoFallback?: boolean
}

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

export function createDemoSession(): TeamSession {
  return {
    organizationId: 'org-demo',
    userId: 'u-erich',
    role: 'owner',
    projectMemberships: [],
  }
}

export function resolveRequestSession(
  headers: HeaderBag,
  options: ResolveRequestSessionOptions = {},
): TeamSession | null {
  const allowDemoFallback = options.allowDemoFallback ?? true
  const userId = readHeader(headers, 'x-devflow-user-id')

  if (!userId) {
    return allowDemoFallback ? createDemoSession() : null
  }

  const role = parseRole(readHeader(headers, 'x-devflow-user-role'))
  if (!role) {
    return null
  }

  try {
    return {
      organizationId: readHeader(headers, 'x-devflow-organization-id') ?? 'org-demo',
      userId,
      role,
      projectMemberships: parseProjectMemberships(
        readHeader(headers, 'x-devflow-project-roles'),
        userId,
      ),
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
