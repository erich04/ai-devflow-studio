import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { OrganizationAccess, Role } from '@ai-devflow/shared'
import type { TeamDbRepositoryClient } from '../db/client'
import { withTeamDbTransaction, type TeamDbTransactionClient } from '../db/transaction'

export type OrganizationMemberUpdate = { role: Role; status: 'active' | 'disabled'; projects: { projectId: string; role: Role }[] }
export type OrganizationMember = OrganizationMemberUpdate & { userId: string; name: string; provider: string; providerAccountId: string }

export type OrganizationRepository = {
  list(authAccountId: string): Promise<OrganizationAccess[]>
  create(authAccountId: string, input: { name: string; slug: string }): Promise<OrganizationAccess>
  update(authAccountId: string, organizationId: string, input: { name: string; status: 'active' | 'archived' }): Promise<void>
  members(authAccountId: string, organizationId: string): Promise<OrganizationMember[]>
  updateMember(authAccountId: string, organizationId: string, userId: string, input: OrganizationMemberUpdate): Promise<void>
  invite(authAccountId: string, organizationId: string, input: OrganizationMemberUpdate & { providerAccountId: string }): Promise<{ id: string; token: string; expiresAt: string }>
  accept(authAccountId: string, token: string): Promise<{ organizationId: string }>
  invitations(authAccountId: string, organizationId: string): Promise<unknown[]>
  revokeInvitation(authAccountId: string, organizationId: string, invitationId: string): Promise<void>
  audit(authAccountId: string, organizationId: string): Promise<unknown[]>
}

export class OrganizationAccessError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409, message: string) { super(message) }
}

export function createOrganizationRepository(db: TeamDbRepositoryClient): OrganizationRepository {
  async function owner(tx: TeamDbTransactionClient, authAccountId: string, organizationId: string, allowArchived = false) {
    // Serialize owner/lifecycle edits before reloading the current authority.
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`organization:${organizationId}`])
    const [row] = await tx.query<{ status: string }>(`
      SELECT organizations.status FROM organization_memberships
      JOIN organizations ON organizations.id = organization_memberships.organization_id
      JOIN users ON users.id = organization_memberships.user_id AND users.organization_id = organizations.id
      WHERE organization_memberships.auth_account_id = $1 AND organizations.id = $2
        AND organization_memberships.status = 'active' AND users.role = 'owner'
      FOR UPDATE OF organizations, organization_memberships, users
    `, [authAccountId, organizationId])
    if (!row) throw new OrganizationAccessError(403, 'Organization owner required')
    if (!allowArchived && row.status !== 'active') throw new OrganizationAccessError(403, 'Organization is archived')
  }

  async function audit(tx: TeamDbTransactionClient, authAccountId: string, organizationId: string, action: string, subjectId: string, detail: unknown = {}) {
    await tx.query(`INSERT INTO organization_audit_events (id, organization_id, actor_auth_account_id, action, subject_id, detail)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [randomUUID(), organizationId, authAccountId, action, subjectId, JSON.stringify(detail)])
  }

  async function revokeDesktop(tx: TeamDbTransactionClient, organizationId: string, userId?: string) {
    await tx.query(`UPDATE desktop_tokens SET revoked_at = now() WHERE organization_id = $1 AND ($2::text IS NULL OR user_id = $2) AND revoked_at IS NULL`, [organizationId, userId ?? null])
    await tx.query(`UPDATE desktop_pairing_codes SET revoked_at = now() WHERE organization_id = $1 AND ($2::text IS NULL OR created_by_user_id = $2) AND revoked_at IS NULL`, [organizationId, userId ?? null])
  }

  async function checkProjects(tx: TeamDbTransactionClient, organizationId: string, projects: OrganizationMemberUpdate['projects']) {
    const ids = projects.map(p => p.projectId)
    const scoped = await tx.query<{ id: string }>('SELECT id FROM projects WHERE organization_id = $1 AND id = ANY($2::text[])', [organizationId, ids])
    if (scoped.length !== ids.length) throw new OrganizationAccessError(400, 'Project access must belong to this organization without duplicates')
  }

  return {
    async list(authAccountId) {
      return db.query<OrganizationAccess>(`
        SELECT organizations.id, organizations.name, organizations.slug, organizations.status,
          users.id AS "userId", users.role
        FROM organization_memberships
        JOIN organizations ON organizations.id = organization_memberships.organization_id
        JOIN users ON users.id = organization_memberships.user_id AND users.organization_id = organizations.id
        WHERE organization_memberships.auth_account_id = $1 AND organization_memberships.status = 'active'
        ORDER BY organizations.created_at, organizations.id
      `, [authAccountId])
    },
    async create(authAccountId, input) {
      return withTeamDbTransaction(db, async tx => {
        const [profile] = await tx.query<{ name: string; email: string | null; avatar_url: string | null; avatar_initials: string }>(`
          SELECT users.name, users.email, users.avatar_url, users.avatar_initials
          FROM auth_accounts JOIN users ON users.id = auth_accounts.user_id WHERE auth_accounts.id = $1
        `, [authAccountId])
        if (!profile) throw new OrganizationAccessError(403, 'Authenticated account required')
        const id = `org-${randomUUID()}`
        const userId = `u-${randomUUID()}`
        await tx.query('INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)', [id, input.name, input.slug])
        await tx.query(`INSERT INTO users (id, organization_id, name, email, avatar_url, role, avatar_initials, focus)
          VALUES ($1, $2, $3, $4, $5, 'owner', $6, '')`, [userId, id, profile.name, profile.email, profile.avatar_url, profile.avatar_initials])
        await tx.query('INSERT INTO organization_memberships (auth_account_id, organization_id, user_id) VALUES ($1, $2, $3)', [authAccountId, id, userId])
        await tx.query(`INSERT INTO organization_audit_events (id, organization_id, actor_auth_account_id, action, subject_id)
          VALUES ($1, $2, $3, 'organization.created', $2)`, [randomUUID(), id, authAccountId])
        return { ...input, id, userId, role: 'owner' as Role, status: 'active' as const }
      })
    },
    async update(authAccountId, organizationId, input) {
      await withTeamDbTransaction(db, async tx => {
        await owner(tx, authAccountId, organizationId, true)
        await tx.query('UPDATE organizations SET name = $2, status = $3, updated_at = now() WHERE id = $1', [organizationId, input.name, input.status])
        if (input.status === 'archived') await revokeDesktop(tx, organizationId)
        if (input.status === 'archived') await tx.query('UPDATE organization_invitations SET revoked_at = now() WHERE organization_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL', [organizationId])
        await audit(tx, authAccountId, organizationId, `organization.${input.status === 'archived' ? 'archived' : 'updated'}`, organizationId, input)
      })
    },
    async members(authAccountId, organizationId) {
      return withTeamDbTransaction(db, async tx => {
        await owner(tx, authAccountId, organizationId, true)
        return tx.query<OrganizationMember>(`SELECT users.id AS "userId", users.name, users.role, organization_memberships.status,
          auth_accounts.provider, auth_accounts.provider_account_id AS "providerAccountId",
          COALESCE((SELECT jsonb_agg(jsonb_build_object('projectId', projects.id, 'role', project_members.role))
            FROM project_members JOIN projects ON projects.id = project_members.project_id AND projects.organization_id = users.organization_id
            WHERE project_members.user_id = users.id), '[]'::jsonb) AS projects
          FROM organization_memberships JOIN users ON users.id = organization_memberships.user_id AND users.organization_id = organization_memberships.organization_id
          JOIN auth_accounts ON auth_accounts.id = organization_memberships.auth_account_id
          WHERE organization_memberships.organization_id = $1 ORDER BY users.name, users.id`, [organizationId])
      })
    },
    async updateMember(authAccountId, organizationId, userId, input) {
      await withTeamDbTransaction(db, async tx => {
        await owner(tx, authAccountId, organizationId)
        const [target] = await tx.query<{ role: Role; status: string }>(`SELECT users.role, organization_memberships.status
          FROM organization_memberships JOIN users ON users.id = organization_memberships.user_id AND users.organization_id = organization_memberships.organization_id
          WHERE users.id = $1 AND users.organization_id = $2 FOR UPDATE OF users, organization_memberships`, [userId, organizationId])
        if (!target) throw new OrganizationAccessError(404, 'Organization member not found')
        if (target.role === 'owner' && target.status === 'active' && (input.role !== 'owner' || input.status !== 'active')) {
          const owners = await tx.query<{ id: string }>(`SELECT DISTINCT users.id FROM users JOIN organization_memberships ON organization_memberships.user_id = users.id
            WHERE users.organization_id = $1 AND users.role = 'owner' AND organization_memberships.status = 'active'`, [organizationId])
          if (owners.length <= 1) throw new OrganizationAccessError(409, 'Keep at least one active organization owner')
        }
        await checkProjects(tx, organizationId, input.projects)
        await tx.query('UPDATE users SET role = $3, updated_at = now() WHERE id = $1 AND organization_id = $2', [userId, organizationId, input.role])
        await tx.query('UPDATE organization_memberships SET status = $3, updated_at = now() WHERE user_id = $1 AND organization_id = $2', [userId, organizationId, input.status])
        await tx.query('DELETE FROM project_members WHERE user_id = $1 AND project_id IN (SELECT id FROM projects WHERE organization_id = $2)', [userId, organizationId])
        for (const project of input.projects) await tx.query('INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)', [project.projectId, userId, project.role])
        // Tokens never gain rights from a later role change; re-pair after edits.
        await revokeDesktop(tx, organizationId, userId)
        await audit(tx, authAccountId, organizationId, 'member.updated', userId, input)
      })
    },
    async invite(authAccountId, organizationId, input) {
      return withTeamDbTransaction(db, async tx => {
        await owner(tx, authAccountId, organizationId)
        await checkProjects(tx, organizationId, input.projects)
        const id = randomUUID()
        const secret = randomBytes(32).toString('base64url')
        const tokenHash = createHash('sha256').update(secret).digest('hex')
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()
        await tx.query(`INSERT INTO organization_invitations (id, organization_id, created_by_auth_account_id, provider_account_id, role, project_access, token_hash, expires_at)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`, [id, organizationId, authAccountId, input.providerAccountId, input.role, JSON.stringify(input.projects), tokenHash, expiresAt])
        await audit(tx, authAccountId, organizationId, 'invitation.created', id, { providerAccountId: input.providerAccountId, role: input.role, projects: input.projects })
        return { id, token: `${id}.${secret}`, expiresAt }
      })
    },
    async accept(authAccountId, token) {
      const parts = token.split('.')
      if (parts.length !== 2 || !/^[a-f0-9-]{36}$/.test(parts[0]!) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]!)) throw new OrganizationAccessError(404, 'Invitation is unavailable or expired')
      const hash = createHash('sha256').update(parts[1]!).digest('hex')
      type Invitation = { organization_id: string; created_by_auth_account_id: string; provider_account_id: string; role: Role; project_access: OrganizationMemberUpdate['projects'] }
      return withTeamDbTransaction(db, async tx => {
        const lookup = `SELECT organization_id, created_by_auth_account_id, provider_account_id, role, project_access FROM organization_invitations
          WHERE id = $1 AND token_hash = $2 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()`
        const [preview] = await tx.query<Invitation>(lookup, [parts[0], hash])
        if (!preview) throw new OrganizationAccessError(404, 'Invitation is unavailable or expired')
        const [account] = await tx.query<{ provider_account_id: string; name: string; email: string | null; avatar_url: string | null; avatar_initials: string }>(`
          SELECT auth_accounts.provider_account_id, users.name, users.email, users.avatar_url, users.avatar_initials
          FROM auth_accounts JOIN users ON users.id = auth_accounts.user_id WHERE auth_accounts.id = $1 AND provider = 'github'`, [authAccountId])
        if (!account || account.provider_account_id !== preview.provider_account_id) throw new OrganizationAccessError(403, 'Sign in with the GitHub account named in this invitation')
        await owner(tx, preview.created_by_auth_account_id, preview.organization_id)
        const [invitation] = await tx.query<Invitation>(`${lookup} FOR UPDATE`, [parts[0], hash])
        if (!invitation) throw new OrganizationAccessError(404, 'Invitation is unavailable or expired')
        const [existing] = await tx.query<{ user_id: string }>('SELECT user_id FROM organization_memberships WHERE auth_account_id = $1 AND organization_id = $2', [authAccountId, invitation.organization_id])
        if (existing) throw new OrganizationAccessError(409, 'Membership already exists; ask an owner to change its access')
        await checkProjects(tx, invitation.organization_id, invitation.project_access)
        const userId = `u-${randomUUID()}`
        await tx.query(`INSERT INTO users (id, organization_id, name, email, avatar_url, role, avatar_initials, focus)
          VALUES ($1, $2, $3, $4, $5, $6, $7, '')`, [userId, invitation.organization_id, account.name, account.email, account.avatar_url, invitation.role, account.avatar_initials])
        await tx.query('INSERT INTO organization_memberships (auth_account_id, organization_id, user_id) VALUES ($1, $2, $3)', [authAccountId, invitation.organization_id, userId])
        for (const project of invitation.project_access) await tx.query('INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)', [project.projectId, userId, project.role])
        await tx.query('UPDATE organization_invitations SET consumed_at = now() WHERE id = $1', [parts[0]])
        await audit(tx, authAccountId, invitation.organization_id, 'invitation.accepted', userId)
        return { organizationId: invitation.organization_id }
      })
    },
    async invitations(authAccountId, organizationId) {
      return withTeamDbTransaction(db, async tx => {
        await owner(tx, authAccountId, organizationId, true)
        return tx.query(`SELECT id, provider_account_id AS "providerAccountId", role, project_access AS projects, expires_at AS "expiresAt", consumed_at AS "consumedAt", revoked_at AS "revokedAt"
          FROM organization_invitations WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100`, [organizationId])
      })
    },
    async revokeInvitation(authAccountId, organizationId, invitationId) {
      await withTeamDbTransaction(db, async tx => {
        await owner(tx, authAccountId, organizationId, true)
        const rows = await tx.query('UPDATE organization_invitations SET revoked_at = now() WHERE id = $1 AND organization_id = $2 AND consumed_at IS NULL RETURNING id', [invitationId, organizationId])
        if (!rows.length) throw new OrganizationAccessError(404, 'Invitation is unavailable')
        await audit(tx, authAccountId, organizationId, 'invitation.revoked', invitationId)
      })
    },
    async audit(authAccountId, organizationId) {
      return withTeamDbTransaction(db, async tx => {
        await owner(tx, authAccountId, organizationId, true)
        return tx.query('SELECT id, action, subject_id AS "subjectId", detail, created_at AS "createdAt" FROM organization_audit_events WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100', [organizationId])
      })
    },
  }
}
