import type { TeamRepository } from '../repositories/team-repository'

export type ApiRouteResult = {
  status: number
  body: unknown
}

export async function resolveTeamRoute(
  method: string,
  pathname: string,
  repository: TeamRepository,
): Promise<ApiRouteResult | null> {
  if (method !== 'GET') {
    return null
  }

  if (pathname === '/api/runs') {
    return {
      status: 200,
      body: await repository.getRunsBundle(),
    }
  }

  if (pathname === '/api/team/overview') {
    return {
      status: 200,
      body: await repository.getTeamOverview(),
    }
  }

  if (pathname === '/api/skills') {
    return {
      status: 200,
      body: { skills: await repository.getSkills() },
    }
  }

  if (pathname === '/api/mcp') {
    return {
      status: 200,
      body: { servers: await repository.getMcpServers() },
    }
  }

  return null
}
