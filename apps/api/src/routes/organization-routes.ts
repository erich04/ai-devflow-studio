import type { RequestPrincipal } from '../auth/request-auth'
import { createSessionCookie } from '../auth/session-cookie'
import { OrganizationAccessError } from '../repositories/organization-repository'
import type { TeamRepository } from '../repositories/team-repository'
import type { ApiRouteResult } from './team-routes'
import type { OrganizationMemberUpdate } from '../repositories/organization-repository'

const isRole = (value: unknown): value is OrganizationMemberUpdate['role'] => value === 'owner' || value === 'lead' || value === 'member'
function parseMember(value: unknown): OrganizationMemberUpdate {
  const input = value as Partial<OrganizationMemberUpdate> | null
  if (!input || !isRole(input.role) || (input.status !== 'active' && input.status !== 'disabled') || !Array.isArray(input.projects) || input.projects.length > 100 || input.projects.some(p => !p || typeof p.projectId !== 'string' || p.projectId.length > 200 || !isRole(p.role))) {
    throw new OrganizationAccessError(400, 'Provide a role, member status and explicit project access')
  }
  return { role: input.role, status: input.status, projects: input.projects.map(p => ({ projectId: p.projectId, role: p.role })) }
}

export async function resolveOrganizationRoute(input: {
  method: string; pathname: string; body?: unknown; principal: RequestPrincipal | null
  repository: TeamRepository; enabled: boolean; sessionSecret: string; secureCookies?: boolean
}): Promise<ApiRouteResult | null> {
  if (input.pathname !== '/api/organizations' && !input.pathname.startsWith('/api/organizations/')) return null
  const store = input.repository.organizations
  const failure = (status: number, message: string): ApiRouteResult => ({ status, body: { message } })
  if (!store) return failure(404, 'Organization management requires Postgres')
  const principal = input.principal
  if (!principal || principal.session.source !== 'authenticated') return failure(401, 'Sign in required')
  if (principal.authentication.kind !== 'session_cookie') return failure(403, 'A browser session is required')
  const authAccountId = principal.session.authAccountId
  try {
    if (input.method === 'GET' && input.pathname === '/api/organizations') {
      return { status: 200, body: { multiOrganizationEnabled: input.enabled, selectedOrganizationId: principal.session.organizationId, organizations: await store.list(authAccountId) } }
    }
    if (input.method === 'POST' && input.pathname === '/api/organizations') {
      if (!input.enabled) return failure(403, 'New organization onboarding is disabled by the deployment administrator')
      const value = input.body as Record<string, unknown> | null
      if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 || typeof value.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) || value.slug.length > 80) {
        return failure(400, 'Provide a name and a lowercase organization slug (up to 80 characters)')
      }
      return { status: 201, body: await store.create(authAccountId, { name: value.name.trim(), slug: value.slug }) }
    }
    if (input.method === 'POST' && input.pathname === '/api/organizations/invitations/accept') {
      const token = (input.body as { token?: unknown } | null)?.token
      if (typeof token !== 'string' || token.length > 100) return failure(400, 'Provide an invitation token')
      return { status: 200, body: await store.accept(authAccountId, token) }
    }
    const invitations = input.pathname.match(/^\/api\/organizations\/([^/]+)\/invitations(?:\/([^/]+)\/revoke)?$/)
    if (invitations) {
      const organizationId = decodeURIComponent(invitations[1]!)
      if (input.method === 'GET' && !invitations[2]) return { status: 200, body: { invitations: await store.invitations(authAccountId, organizationId) } }
      if (input.method === 'POST' && invitations[2]) {
        await store.revokeInvitation(authAccountId, organizationId, decodeURIComponent(invitations[2]))
        return { status: 200, body: { revoked: true } }
      }
      if (input.method === 'POST') {
        const member = parseMember(input.body)
        const providerAccountId = (input.body as { providerAccountId?: unknown }).providerAccountId
        if (typeof providerAccountId !== 'string' || !/^[1-9]\d{0,19}$/.test(providerAccountId) || member.status !== 'active') return failure(400, 'Provide the immutable numeric GitHub account ID and active member access')
        return { status: 201, body: await store.invite(authAccountId, organizationId, { ...member, providerAccountId }) }
      }
    }
    const audit = input.pathname.match(/^\/api\/organizations\/([^/]+)\/audit$/)
    if (input.method === 'GET' && audit) return { status: 200, body: { events: await store.audit(authAccountId, decodeURIComponent(audit[1]!)) } }
    const select = input.pathname.match(/^\/api\/organizations\/([^/]+)\/select$/)
    if (input.method === 'POST' && select) {
      const organizationId = decodeURIComponent(select[1]!)
      const session = await input.repository.resolveBrowserSession(authAccountId, organizationId)
      if (!session || session.organizationId !== organizationId) return failure(404, 'Organization membership is unavailable')
      return { status: 200, headers: { 'set-cookie': createSessionCookie({ authAccountId, organizationId }, input.sessionSecret, { secure: input.secureCookies === true }) }, body: { organizationId } }
    }
    const organization = input.pathname.match(/^\/api\/organizations\/([^/]+)$/)
    if (input.method === 'PUT' && organization) {
      const value = input.body as Record<string, unknown> | null
      if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 || (value.status !== 'active' && value.status !== 'archived')) return failure(400, 'Provide a name and organization status')
      await store.update(authAccountId, decodeURIComponent(organization[1]!), { name: value.name.trim(), status: value.status })
      return { status: 200, body: { updated: true } }
    }
    const members = input.pathname.match(/^\/api\/organizations\/([^/]+)\/members(?:\/([^/]+))?$/)
    if (members) {
      const organizationId = decodeURIComponent(members[1]!)
      if (input.method === 'GET' && !members[2]) return { status: 200, body: { members: await store.members(authAccountId, organizationId) } }
      if (input.method === 'PUT' && members[2]) {
        await store.updateMember(authAccountId, organizationId, decodeURIComponent(members[2]), parseMember(input.body))
        return { status: 200, body: { updated: true } }
      }
    }
    return failure(404, 'Organization action not found')
  } catch (error) {
    if (error instanceof URIError) return failure(400, 'Invalid organization path')
    if (error instanceof OrganizationAccessError) return failure(error.status, error.message)
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') return failure(409, 'Organization slug already exists')
    throw error
  }
}
