import { formatUsd, type RemoteRunSummary, type RemoteTestEvidenceSummary, type TeamSession } from '@ai-devflow/shared'
import { canAccessProject, canSyncProject } from '../auth/session'
import type { RunsBundle, TeamOverviewPayload, TeamRepository } from '../repositories/team-repository'

export type ApiRouteResult = {
  status: number
  body: unknown
}

export type ResolveTeamRouteOptions = {
  body?: unknown
  session?: TeamSession | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasLocalOnlyEvidenceField(value: Record<string, unknown>): boolean {
  return 'cwd' in value || 'stdout' in value || 'stderr' in value
}

function isRemoteRunSummary(value: unknown): value is RemoteRunSummary {
  return (
    isRecord(value) &&
    (value['kind'] === 'run' || value['kind'] === 'approval' || value['kind'] === 'event') &&
    typeof value['runId'] === 'string' &&
    typeof value['projectId'] === 'string' &&
    typeof value['title'] === 'string' &&
    typeof value['status'] === 'string' &&
    typeof value['currentNodeId'] === 'string' &&
    typeof value['branchName'] === 'string' &&
    typeof value['updatedAt'] === 'string'
  )
}

function isRemoteTestEvidenceStatus(value: unknown): value is RemoteTestEvidenceSummary['status'] {
  return value === 'running' || value === 'passed' || value === 'failed' || value === 'timed_out'
}

function isRemoteTestEvidenceSummary(value: unknown): value is RemoteTestEvidenceSummary {
  return (
    isRecord(value) &&
    !hasLocalOnlyEvidenceField(value) &&
    typeof value['id'] === 'string' &&
    typeof value['runId'] === 'string' &&
    typeof value['nodeId'] === 'string' &&
    typeof value['projectId'] === 'string' &&
    typeof value['command'] === 'string' &&
    isRemoteTestEvidenceStatus(value['status']) &&
    (typeof value['exitCode'] === 'number' || value['exitCode'] === null) &&
    typeof value['durationMs'] === 'number' &&
    typeof value['summary'] === 'string' &&
    typeof value['redacted'] === 'boolean' &&
    typeof value['createdAt'] === 'string'
  )
}

function parseRemoteRunSummary(value: unknown): RemoteRunSummary {
  if (!isRemoteRunSummary(value)) {
    throw new Error('Invalid remote run summary payload')
  }

  return value
}

function parseRemoteTestEvidenceSummary(value: unknown): RemoteTestEvidenceSummary {
  if (isRecord(value) && hasLocalOnlyEvidenceField(value)) {
    throw new Error('Remote test evidence summary contains local-only fields')
  }

  if (!isRemoteTestEvidenceSummary(value)) {
    throw new Error('Invalid remote test evidence summary payload')
  }

  return value
}

function badRequest(message: string): ApiRouteResult {
  return {
    status: 400,
    body: {
      error: 'bad_request',
      message,
    },
  }
}

function unauthorized(): ApiRouteResult {
  return {
    status: 401,
    body: {
      error: 'unauthorized',
      message: 'Authentication required',
    },
  }
}

function forbidden(message: string): ApiRouteResult {
  return {
    status: 403,
    body: {
      error: 'forbidden',
      message,
    },
  }
}

function filterRunsBundleForSession(bundle: RunsBundle, session: TeamSession): RunsBundle {
  const runs = bundle.runs.filter((run) => canAccessProject(session, run.projectId))
  const runIds = new Set(runs.map((run) => run.id))

  return {
    runs,
    artifacts: bundle.artifacts.filter((artifact) => runIds.has(artifact.runId)),
    events: bundle.events.filter((event) => runIds.has(event.runId)),
  }
}

function filterOverviewForSession(
  overview: TeamOverviewPayload,
  session: TeamSession,
): TeamOverviewPayload {
  const projects = overview.projects.filter((project) => canAccessProject(session, project.id))
  const projectIds = new Set(projects.map((project) => project.id))
  const projectCost = overview.projectCost.filter((rollup) => projectIds.has(rollup.key))

  return {
    ...overview,
    projects,
    runs: overview.runs.filter((run) => projectIds.has(run.projectId)),
    projectCost,
    totalCost: formatUsd(projectCost.reduce((sum, rollup) => sum + rollup.costUsd, 0)),
  }
}

export async function resolveTeamRoute(
  method: string,
  pathname: string,
  repository: TeamRepository,
  options: ResolveTeamRouteOptions = {},
): Promise<ApiRouteResult | null> {
  if (method === 'GET' && pathname === '/api/runs') {
    if (!options.session) {
      return unauthorized()
    }

    return {
      status: 200,
      body: filterRunsBundleForSession(await repository.getRunsBundle(), options.session),
    }
  }

  if (method === 'GET' && pathname === '/api/team/overview') {
    if (!options.session) {
      return unauthorized()
    }

    return {
      status: 200,
      body: filterOverviewForSession(await repository.getTeamOverview(), options.session),
    }
  }

  if (method === 'GET' && pathname === '/api/skills') {
    if (!options.session) {
      return unauthorized()
    }

    return {
      status: 200,
      body: { skills: await repository.getSkills() },
    }
  }

  if (method === 'GET' && pathname === '/api/mcp') {
    if (!options.session) {
      return unauthorized()
    }

    return {
      status: 200,
      body: { servers: await repository.getMcpServers() },
    }
  }

  if (method === 'POST' && pathname === '/api/sync/run-summary') {
    if (!options.session) {
      return unauthorized()
    }

    try {
      const summary = parseRemoteRunSummary(options.body)
      const requiredRole = summary.kind === 'approval' ? 'lead' : 'member'
      if (!canSyncProject(options.session, summary.projectId, requiredRole)) {
        return forbidden(`Project role ${requiredRole} required`)
      }

      return {
        status: 202,
        body: await repository.uploadRunSummary(summary),
      }
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid sync payload')
    }
  }

  if (method === 'POST' && pathname === '/api/sync/test-evidence-summary') {
    if (!options.session) {
      return unauthorized()
    }

    try {
      const summary = parseRemoteTestEvidenceSummary(options.body)
      if (!canSyncProject(options.session, summary.projectId, 'member')) {
        return forbidden('Project role member required')
      }

      return {
        status: 202,
        body: await repository.uploadTestEvidenceSummary(summary),
      }
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid sync payload')
    }
  }

  return null
}
