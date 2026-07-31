import type { IncomingHttpHeaders } from 'node:http'
import { readBearerToken, resolveRequestSession } from './auth/session'
import {
  parseCookieHeader,
  resolveSessionCookie,
  SESSION_COOKIE_NAME,
} from './auth/session-cookie'
import type { GitHubOAuthClient } from './auth/github-oauth'
import type { TeamRepository } from './repositories/team-repository'
import { resolveTeamRoute, type ApiRouteResult } from './routes/team-routes'

export type ApiRouteRequest = {
  method: string
  pathname: string
  headers: IncomingHttpHeaders
  body?: unknown
  searchParams?: URLSearchParams
}

export type ApiRouteRequestOptions = {
  repository: TeamRepository
  sessionSecret: string
  devAuthEnabled?: boolean
  githubOAuth?: GitHubOAuthClient
}

export function createCorsPreflightHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
  }
}

export async function resolveApiRouteRequest(
  request: ApiRouteRequest,
  options: ApiRouteRequestOptions,
): Promise<ApiRouteResult | null> {
  const cookies = parseCookieHeader(request.headers.cookie)
  const bearerToken = readBearerToken(request.headers)
  const session = bearerToken
    ? await options.repository.resolveDesktopTokenSession(bearerToken)
    : resolveSessionCookie(cookies[SESSION_COOKIE_NAME], options.sessionSecret) ??
      resolveRequestSession(request.headers, {
        devAuthEnabled: options.devAuthEnabled === true,
      })

  return resolveTeamRoute(request.method, request.pathname, options.repository, {
    auth: { sessionSecret: options.sessionSecret },
    body: request.body,
    cookies,
    session,
    searchParams: request.searchParams ?? new URLSearchParams(),
    ...(options.githubOAuth ? { githubOAuth: options.githubOAuth } : {}),
  })
}
