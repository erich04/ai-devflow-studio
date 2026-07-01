import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDevFlowRuntimeFlags } from '@ai-devflow/shared'
import {
  artifacts,
  events,
  mcpServers,
  members,
  projects,
  runs,
  skills,
  tokenUsage,
} from '@ai-devflow/shared/fixtures'
import { resolveTeamDbConfig } from './client'
import { createPostgresPoolClient } from './postgres-client'
import type { TeamDbClient } from './client'

const DEMO_ORGANIZATION_ID = 'org-demo'
const DEMO_ORGANIZATION_NAME = 'DevFlow Demo Team'
const DEMO_ORGANIZATION_SLUG = 'devflow-demo'

export type SeedDemoResult = {
  organizations: number
  users: number
  authAccounts: number
  projects: number
  projectMembers: number
  runs: number
  nodes: number
  edges: number
  artifacts: number
  events: number
  skills: number
  mcpServers: number
  tokenUsage: number
}

function remoteNodeId(runId: string, nodeId: string): string {
  return `${runId}:${nodeId}`
}

function projectMemberRole(memberId: string): string {
  const member = members.find((candidate) => candidate.id === memberId)
  return member?.role ?? 'member'
}

export async function seedDemoTeamData(db: TeamDbClient): Promise<SeedDemoResult> {
  const result: SeedDemoResult = {
    organizations: 0,
    users: 0,
    authAccounts: 0,
    projects: 0,
    projectMembers: 0,
    runs: 0,
    nodes: 0,
    edges: 0,
    artifacts: 0,
    events: 0,
    skills: 0,
    mcpServers: 0,
    tokenUsage: 0,
  }

  await db.query(
    `
      INSERT INTO organizations (id, name, slug)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE
      SET name = excluded.name,
          slug = excluded.slug,
          updated_at = now()
    `,
    [DEMO_ORGANIZATION_ID, DEMO_ORGANIZATION_NAME, DEMO_ORGANIZATION_SLUG],
  )
  result.organizations += 1

  for (const member of members) {
    await db.query(
      `
        INSERT INTO users (id, organization_id, name, email, avatar_url, role, avatar_initials, focus)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE
        SET name = excluded.name,
            email = excluded.email,
            avatar_url = excluded.avatar_url,
            role = excluded.role,
            avatar_initials = excluded.avatar_initials,
            focus = excluded.focus,
            updated_at = now()
      `,
      [
        member.id,
        DEMO_ORGANIZATION_ID,
        member.name,
        null,
        null,
        member.role,
        member.avatarInitials,
        member.focus,
      ],
    )
    result.users += 1

    await db.query(
      `
        INSERT INTO auth_accounts (id, user_id, provider, provider_account_id, username, email)
        VALUES ($1, $2, 'github', $3, $4, $5)
        ON CONFLICT (provider, provider_account_id) DO UPDATE
        SET user_id = excluded.user_id,
            username = excluded.username,
            email = excluded.email,
            updated_at = now()
      `,
      [
        `acct-demo-${member.id}`,
        member.id,
        `demo:${member.id}`,
        member.id,
        null,
      ],
    )
    result.authAccounts += 1
  }

  for (const project of projects) {
    await db.query(
      `
        INSERT INTO projects (
          id,
          organization_id,
          name,
          slug,
          description,
          repository,
          default_branch,
          health,
          knowledge_base_path,
          test_command
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE
        SET name = excluded.name,
            slug = excluded.slug,
            description = excluded.description,
            repository = excluded.repository,
            default_branch = excluded.default_branch,
            health = excluded.health,
            knowledge_base_path = excluded.knowledge_base_path,
            test_command = excluded.test_command,
            updated_at = now()
      `,
      [
        project.id,
        DEMO_ORGANIZATION_ID,
        project.name,
        project.slug,
        project.description,
        project.repository,
        project.defaultBranch,
        project.health,
        project.knowledgeBasePath,
        project.testCommand,
      ],
    )
    result.projects += 1

    for (const member of members) {
      await db.query(
        `
          INSERT INTO project_members (project_id, user_id, role)
          VALUES ($1, $2, $3)
          ON CONFLICT (project_id, user_id) DO UPDATE
          SET role = excluded.role
        `,
        [project.id, member.id, projectMemberRole(member.id)],
      )
      result.projectMembers += 1
    }
  }

  for (const run of runs) {
    await db.query(
      `
        INSERT INTO workflow_runs (
          id,
          organization_id,
          project_id,
          creator_id,
          data_origin,
          title,
          request,
          status,
          current_node_id,
          branch_name,
          pull_request_url,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, 'seed', $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE
        SET title = excluded.title,
            request = excluded.request,
            status = excluded.status,
            current_node_id = excluded.current_node_id,
            branch_name = excluded.branch_name,
            pull_request_url = excluded.pull_request_url,
            updated_at = excluded.updated_at
      `,
      [
        run.id,
        DEMO_ORGANIZATION_ID,
        run.projectId,
        run.creatorId,
        run.title,
        run.request,
        run.status,
        remoteNodeId(run.id, run.currentNodeId),
        run.branchName,
        run.pullRequestUrl ?? null,
        run.createdAt,
        run.updatedAt,
      ],
    )
    result.runs += 1

    for (const [position, node] of run.nodes.entries()) {
      await db.query(
        `
          INSERT INTO workflow_nodes (
            id,
            run_id,
            stage,
            title,
            subtitle,
            kind,
            status,
            owner_id,
            required_role,
            retry_count,
            token_usage_id,
            position,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
          ON CONFLICT (id) DO UPDATE
          SET title = excluded.title,
              subtitle = excluded.subtitle,
              status = excluded.status,
              retry_count = excluded.retry_count,
              token_usage_id = excluded.token_usage_id,
              position = excluded.position,
              updated_at = excluded.updated_at
        `,
        [
          remoteNodeId(run.id, node.id),
          run.id,
          node.stage,
          node.title,
          node.subtitle,
          node.kind,
          node.status,
          node.ownerId,
          node.requiredRole ?? null,
          node.retryCount,
          node.tokenUsageId ?? null,
          position,
          run.updatedAt,
        ],
      )
      result.nodes += 1
    }

    for (const edge of run.edges) {
      await db.query(
        `
          INSERT INTO workflow_edges (id, run_id, source_node_id, target_node_id, kind)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO UPDATE
          SET source_node_id = excluded.source_node_id,
              target_node_id = excluded.target_node_id,
              kind = excluded.kind
        `,
        [
          `${run.id}:${edge.id}`,
          run.id,
          remoteNodeId(run.id, edge.source),
          remoteNodeId(run.id, edge.target),
          edge.kind,
        ],
      )
      result.edges += 1
    }
  }

  for (const artifact of artifacts) {
    await db.query(
      `
        INSERT INTO artifacts (id, run_id, node_id, kind, title, summary, content, redacted, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE
        SET title = excluded.title,
            summary = excluded.summary,
            content = excluded.content,
            redacted = excluded.redacted,
            updated_at = excluded.updated_at
      `,
      [
        artifact.id,
        artifact.runId,
        remoteNodeId(artifact.runId, artifact.nodeId),
        artifact.kind,
        artifact.title,
        artifact.summary,
        artifact.content,
        artifact.redacted,
        artifact.updatedAt,
      ],
    )
    result.artifacts += 1
  }

  for (const event of events) {
    await db.query(
      `
        INSERT INTO agent_events (id, run_id, node_id, sequence, kind, message, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (run_id, sequence) DO UPDATE
        SET node_id = excluded.node_id,
            kind = excluded.kind,
            message = excluded.message,
            timestamp = excluded.timestamp
      `,
      [
        event.id,
        event.runId,
        event.nodeId ? remoteNodeId(event.runId, event.nodeId) : null,
        event.sequence,
        event.kind,
        event.message,
        event.timestamp,
      ],
    )
    result.events += 1
  }

  for (const skill of skills) {
    await db.query(
      `
        INSERT INTO skills (id, organization_id, name, stage, description, version, enabled, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE
        SET name = excluded.name,
            stage = excluded.stage,
            description = excluded.description,
            version = excluded.version,
            enabled = excluded.enabled,
            source = excluded.source,
            updated_at = now()
      `,
      [
        skill.id,
        DEMO_ORGANIZATION_ID,
        skill.name,
        skill.stage,
        skill.description,
        skill.version,
        skill.enabled,
        skill.source,
      ],
    )
    result.skills += 1
  }

  for (const server of mcpServers) {
    await db.query(
      `
        INSERT INTO mcp_server_definitions (
          id,
          organization_id,
          name,
          command,
          permission,
          enabled_by_default,
          last_audit_event
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE
        SET name = excluded.name,
            command = excluded.command,
            permission = excluded.permission,
            enabled_by_default = excluded.enabled_by_default,
            last_audit_event = excluded.last_audit_event,
            updated_at = now()
      `,
      [
        server.id,
        DEMO_ORGANIZATION_ID,
        server.name,
        server.command,
        server.permission,
        server.enabledLocally,
        server.lastAuditEvent,
      ],
    )
    result.mcpServers += 1
  }

  for (const usage of tokenUsage) {
    await db.query(
      `
        INSERT INTO token_usage (
          id,
          run_id,
          node_id,
          user_id,
          project_id,
          provider,
          model,
          input_tokens,
          output_tokens,
          cache_read_tokens,
          cost_usd,
          timestamp
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE
        SET input_tokens = excluded.input_tokens,
            output_tokens = excluded.output_tokens,
            cache_read_tokens = excluded.cache_read_tokens,
            cost_usd = excluded.cost_usd,
            timestamp = excluded.timestamp
      `,
      [
        usage.id,
        usage.runId,
        remoteNodeId(usage.runId, usage.nodeId),
        usage.userId,
        usage.projectId,
        usage.provider,
        usage.model,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheReadTokens,
        usage.costUsd,
        usage.timestamp,
      ],
    )
    result.tokenUsage += 1
  }

  return result
}

async function main() {
  const flags = resolveDevFlowRuntimeFlags(process.env)
  if (!flags.demoDataEnabled) {
    throw new Error('Set DEVFLOW_ENABLE_DEMO_DATA=true before running db:seed.')
  }

  const config = resolveTeamDbConfig()
  if (!config) {
    throw new Error('Set DEVFLOW_DATABASE_URL or DATABASE_URL before running db:seed.')
  }

  const db = createPostgresPoolClient(config)
  try {
    const result = await seedDemoTeamData(db)
    console.log(`Seeded DevFlow demo team data: ${JSON.stringify(result)}`)
  } finally {
    await db.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
