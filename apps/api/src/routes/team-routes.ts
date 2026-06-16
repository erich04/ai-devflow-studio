import type { RemoteRunSummary, RemoteTestEvidenceSummary } from '@ai-devflow/shared'
import type { TeamRepository } from '../repositories/team-repository'

export type ApiRouteResult = {
  status: number
  body: unknown
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

export async function resolveTeamRoute(
  method: string,
  pathname: string,
  repository: TeamRepository,
  body?: unknown,
): Promise<ApiRouteResult | null> {
  if (method === 'GET' && pathname === '/api/runs') {
    return {
      status: 200,
      body: await repository.getRunsBundle(),
    }
  }

  if (method === 'GET' && pathname === '/api/team/overview') {
    return {
      status: 200,
      body: await repository.getTeamOverview(),
    }
  }

  if (method === 'GET' && pathname === '/api/skills') {
    return {
      status: 200,
      body: { skills: await repository.getSkills() },
    }
  }

  if (method === 'GET' && pathname === '/api/mcp') {
    return {
      status: 200,
      body: { servers: await repository.getMcpServers() },
    }
  }

  if (method === 'POST' && pathname === '/api/sync/run-summary') {
    try {
      return {
        status: 202,
        body: await repository.uploadRunSummary(parseRemoteRunSummary(body)),
      }
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid sync payload')
    }
  }

  if (method === 'POST' && pathname === '/api/sync/test-evidence-summary') {
    try {
      return {
        status: 202,
        body: await repository.uploadTestEvidenceSummary(parseRemoteTestEvidenceSummary(body)),
      }
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid sync payload')
    }
  }

  return null
}
