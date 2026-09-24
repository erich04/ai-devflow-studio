import type { IncomingHttpHeaders } from 'node:http'
import { readBearerToken, resolveRequestSession } from './auth/session'
import type { RequestPrincipal } from './auth/request-auth'
import {
  parseCookieHeader,
  resolveSessionCookie,
  SESSION_COOKIE_NAME,
} from './auth/session-cookie'
import type { GitHubOAuthClient } from './auth/github-oauth'
import {
  GitHubDeliveryServiceError,
  type GitHubDeliveryService,
} from './github-delivery-service'
import type { TeamRepository } from './repositories/team-repository'
import { resolveGitHubDeliveryRoute } from './routes/github-delivery-routes'
import { resolveTeamRoute, type ApiRouteResult } from './routes/team-routes'
import { resolveOrganizationRoute } from './routes/organization-routes'

export type ApiRouteRequest = {
  signal?: AbortSignal

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
  githubDeliveryService?: GitHubDeliveryService
  localAuthEnabled?: boolean
  postAuthRedirectUrl?: string
  secureCookies?: boolean
  multiOrganizationEnabled?: boolean
}

export function createCorsPreflightHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-devflow-diagnostic-id',
  }
}

export function createInternalErrorResponse(_error?: unknown): ApiRouteResult {
  return {
    status: 500,
    body: {
      error: 'internal_error',
      message: 'Unexpected API error',
    },
  }
}

function authenticationUnavailable(): ApiRouteResult {
  return {
    status: 503,
    body: {
      error: 'service_unavailable',
      message: 'Authentication service is temporarily unavailable',
    },
  }
}

function hasHeader(headers: IncomingHttpHeaders, name: string): boolean {
  return Object.keys(headers).some((headerName) => headerName.toLowerCase() === name)
}

function unavailableGitHubDelivery(
  phase: GitHubDeliveryServiceError['phase'],
): never {
  throw new GitHubDeliveryServiceError({
    code: 'github_delivery_unavailable',
    retryable: true,
    phase,
  })
}

const unavailableGitHubDeliveryService: GitHubDeliveryService = {
  async configureRepositoryBinding() {
    return unavailableGitHubDelivery('binding')
  },
  async issueCredentialGrant() {
    return unavailableGitHubDelivery('credential')
  },
  async verifyBranchPublication() {
    return unavailableGitHubDelivery('publication')
  },
  async adoptVerifiedBranchPublication() {
    return unavailableGitHubDelivery('publication')
  },
  async createDraftPullRequest() {
    return unavailableGitHubDelivery('pull_request')
  },
}

export async function resolveApiRouteRequest(
  request: ApiRouteRequest,
  options: ApiRouteRequestOptions,
): Promise<ApiRouteResult | null> {
  const cookies = parseCookieHeader(request.headers.cookie)
  const bearerToken = readBearerToken(request.headers)
  let principal: RequestPrincipal | null = null
  if (hasHeader(request.headers, 'authorization')) {
    if (!bearerToken) {
      principal = null
    } else {
      try {
        const resolved = await options.repository.resolveDesktopTokenSession(bearerToken)
        principal = resolved
          ? {
              session: resolved.session,
              authentication: {
                kind: 'desktop_bearer',
                tokenRecordId: resolved.tokenRecordId,
              },
            }
          : null
      } catch {
        return authenticationUnavailable()
      }
    }
  } else if (Object.prototype.hasOwnProperty.call(cookies, SESSION_COOKIE_NAME)) {
    const claims = resolveSessionCookie(cookies[SESSION_COOKIE_NAME], options.sessionSecret)
    if (claims) {
      try {
        const session = claims.v === 2
          ? await options.repository.resolveBrowserSession(claims.authAccountId, claims.organizationId)
          : await options.repository.resolveBrowserSession(claims.authAccountId)
        principal = session && (claims.v === 1 || session.organizationId === claims.organizationId)
          ? {
              session,
              authentication: { kind: 'session_cookie', tokenRecordId: null },
            }
          : null
      } catch {
        return authenticationUnavailable()
      }
    }
  } else {
    const session = resolveRequestSession(request.headers, {
      devAuthEnabled: options.devAuthEnabled === true,
    })
    principal = session
      ? {
          session,
          authentication: { kind: 'development_header', tokenRecordId: null },
        }
      : null
  }

  if ((request.pathname === '/api/organizations' || request.pathname.startsWith('/api/organizations/')) && request.method !== 'GET') {
    const mediaType = String(request.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
    if (mediaType !== 'application/json') return { status: 415, body: { message: 'Organization mutations require application/json' } }
    const origin = request.headers.origin
    const expectedOrigin = options.postAuthRedirectUrl ? new URL(options.postAuthRedirectUrl).origin : null
    if ((origin !== undefined && origin !== expectedOrigin) || (origin === undefined && request.headers['sec-fetch-site'] !== undefined)) {
      return { status: 403, body: { message: 'Organization mutation origin was rejected' } }
    }
  }

  const organizationResult = await resolveOrganizationRoute({
    ...request, principal, repository: options.repository,
    enabled: options.multiOrganizationEnabled === true,
    sessionSecret: options.sessionSecret, secureCookies: options.secureCookies === true,
  })
  if (organizationResult) return organizationResult

  if (principal?.session.source === 'authenticated' && principal.session.organizationStatus === 'archived' && !request.pathname.startsWith('/api/auth/')) {
    return { status: 403, body: { error: 'organization_archived', message: 'This organization is archived. Restore it in organization settings.' } }
  }

  const githubDeliveryResult = await resolveGitHubDeliveryRoute(
    request.method,
    request.pathname,
    options.repository,
    options.githubDeliveryService ?? unavailableGitHubDeliveryService,
    {
      body: request.body,
      principal,
    },
  )
  if (githubDeliveryResult) return githubDeliveryResult

  return resolveTeamRoute(request.method, request.pathname, options.repository, {
    ...(request.signal ? { signal: request.signal } : {}),
    auth: {
      sessionSecret: options.sessionSecret,
      secureCookies: options.secureCookies === true,
    },
    body: request.body,
    cookies,
    principal,
    session: principal?.session ?? null,
    searchParams: request.searchParams ?? new URLSearchParams(),
    ...(options.githubOAuth ? { githubOAuth: options.githubOAuth } : {}),
    ...(options.postAuthRedirectUrl
      ? { postAuthRedirectUrl: options.postAuthRedirectUrl }
      : {}),
    ...(options.postAuthRedirectUrl
      ? {
          localAuth: {
            enabled: options.localAuthEnabled === true,
            webAppUrl: options.postAuthRedirectUrl,
            ...(typeof request.headers['content-type'] === 'string'
              ? { requestContentType: request.headers['content-type'] }
              : {}),
            ...(typeof request.headers.host === 'string'
              ? { requestHost: request.headers.host }
              : {}),
            ...(typeof request.headers.origin === 'string'
              ? { requestOrigin: request.headers.origin }
              : {}),
          },
        }
      : {}),
  })
}
