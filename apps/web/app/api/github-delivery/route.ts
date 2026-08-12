import type { GitHubRepositoryBinding } from '@ai-devflow/shared'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import {
  GitHubDeliveryApiError,
  configureGitHubRepositoryBinding,
  decideGitHubDeliveryRequest,
  parseGitHubDeliveryRequestView,
  revokeGitHubRepositoryBinding,
  type GitHubDeliveryFeedbackCode,
  type GitHubDeliveryRequestView,
} from '../../lib/devflow-api'

type ConfigureInput = {
  action: 'configure'
  projectId: string
  installationId: string
  repositoryId: string
  expectedStateVersion: number
}

type DecisionInput = {
  action: 'approve' | 'reject'
  projectId: string
  requestId: string
  expectedStateVersion: number
}

type RevokeInput = {
  action: 'revoke'
  projectId: string
  expectedStateVersion: number
}

const safeStatuses = new Set([400, 401, 403, 404, 409, 410, 503])

async function getDevFlowCookieHeader(): Promise<string | undefined> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('devflow_session')?.value
  return sessionCookie ? `devflow_session=${sessionCookie}` : undefined
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000')
  )
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    !value.includes('/') &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  )
}

function isNumericGitHubId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value)
}

function isVersion(value: unknown, allowZero = false): value is number {
  return (
    Number.isSafeInteger(value) &&
    (allowZero ? (value as number) >= 0 : (value as number) >= 1)
  )
}

function parseConfigureInput(value: unknown): ConfigureInput | null {
  if (
    !isExactRecord(value, [
      'action',
      'projectId',
      'installationId',
      'repositoryId',
      'expectedStateVersion',
    ]) ||
    value.action !== 'configure' ||
    !isIdentifier(value.projectId) ||
    !isNumericGitHubId(value.installationId) ||
    !isNumericGitHubId(value.repositoryId) ||
    !isVersion(value.expectedStateVersion, true)
  ) {
    return null
  }
  return value as ConfigureInput
}

function parsePostInput(value: unknown): DecisionInput | RevokeInput | null {
  if (
    isExactRecord(value, ['action', 'projectId', 'expectedStateVersion']) &&
    value.action === 'revoke' &&
    isIdentifier(value.projectId) &&
    isVersion(value.expectedStateVersion)
  ) {
    return value as RevokeInput
  }
  if (
    isExactRecord(value, [
      'action',
      'projectId',
      'requestId',
      'expectedStateVersion',
    ]) &&
    (value.action === 'approve' || value.action === 'reject') &&
    isIdentifier(value.projectId) &&
    isIdentifier(value.requestId) &&
    isVersion(value.expectedStateVersion)
  ) {
    return value as DecisionInput
  }
  return null
}

function projectBinding(
  binding: GitHubRepositoryBinding,
  projectId: string,
): GitHubRepositoryBinding | null {
  if (
    binding.teamProjectId !== projectId ||
    binding.redacted !== true ||
    binding.stateVersion !== 1 ||
    !Number.isSafeInteger(binding.version) ||
    binding.version < 1 ||
    !['active', 'stale', 'revoked'].includes(binding.status)
  ) {
    return null
  }
  return {
    stateVersion: binding.stateVersion,
    id: binding.id,
    version: binding.version,
    organizationId: binding.organizationId,
    teamProjectId: binding.teamProjectId,
    installationId: binding.installationId,
    repositoryId: binding.repositoryId,
    repository: binding.repository,
    defaultBranch: binding.defaultBranch,
    status: binding.status,
    validatedAt: binding.validatedAt,
    updatedAt: binding.updatedAt,
    redacted: true,
  }
}

function projectDelivery(
  request: GitHubDeliveryRequestView,
  projectId: string,
  requestId: string,
): GitHubDeliveryRequestView | null {
  let parsed: GitHubDeliveryRequestView
  try {
    parsed = parseGitHubDeliveryRequestView(request, projectId)
  } catch {
    return null
  }
  return parsed.id === requestId ? parsed : null
}

function feedbackMessage(code: GitHubDeliveryFeedbackCode): string {
  if (code === 'provider_unavailable') {
    return 'GitHub provider is unavailable. No operation was applied.'
  }
  if (code === 'authority_required') return 'Required project authority was not verified.'
  if (code === 'state_conflict') return 'GitHub Delivery state changed. Reload before retrying.'
  if (code === 'not_found') return 'GitHub Delivery resource was not found.'
  if (code === 'expired') return 'GitHub Delivery authority has expired.'
  return 'GitHub Delivery service is unavailable.'
}

function failureResponse(error: unknown) {
  if (error instanceof GitHubDeliveryApiError && safeStatuses.has(error.status)) {
    return NextResponse.json(
      {
        code: error.feedbackCode,
        message: feedbackMessage(error.feedbackCode),
      },
      { status: error.status },
    )
  }
  return NextResponse.json(
    {
      code: 'service_unavailable',
      message: 'GitHub Delivery service is unavailable.',
    },
    { status: 502 },
  )
}

function badInput() {
  return NextResponse.json(
    { code: 'invalid_input', message: 'Invalid GitHub Delivery input.' },
    { status: 400 },
  )
}

function missingAuthority() {
  return NextResponse.json(
    { code: 'authority_required', message: 'Signed project authority is required.' },
    { status: 401 },
  )
}

function hasJsonContentType(request: NextRequest): boolean {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json'
}

function unsupportedMediaType() {
  return NextResponse.json(
    { code: 'unsupported_media_type', message: 'GitHub Delivery mutations require application/json.' },
    { status: 415 },
  )
}

function hasAllowedMutationOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (origin === null) {
    // Same-server programmatic callers (including route tests) omit both browser headers.
    // A browser-shaped request may not bypass the exact Origin comparison by omitting Origin.
    return request.headers.get('sec-fetch-site') === null
  }

  const configuredWebAppUrl = process.env['DEVFLOW_WEB_APP_URL']?.trim()
  if (!configuredWebAppUrl) return false
  try {
    const configuredOrigin = new URL(configuredWebAppUrl)
    const requestOrigin = new URL(origin)
    return (
      (configuredOrigin.protocol === 'http:' || configuredOrigin.protocol === 'https:') &&
      configuredOrigin.username === '' &&
      configuredOrigin.password === '' &&
      requestOrigin.origin === origin &&
      requestOrigin.origin === configuredOrigin.origin
    )
  } catch {
    return false
  }
}

function forbiddenOrigin() {
  return NextResponse.json(
    { code: 'origin_forbidden', message: 'GitHub Delivery mutation origin was rejected.' },
    { status: 403 },
  )
}

export async function PUT(request: NextRequest) {
  if (!hasJsonContentType(request)) return unsupportedMediaType()
  const cookieHeader = await getDevFlowCookieHeader()
  if (!cookieHeader) return missingAuthority()
  if (!hasAllowedMutationOrigin(request)) return forbiddenOrigin()
  const input = parseConfigureInput(await request.json().catch(() => null))
  if (!input) return badInput()

  try {
    const result = await configureGitHubRepositoryBinding({
      projectId: input.projectId,
      installationId: input.installationId,
      repositoryId: input.repositoryId,
      expectedStateVersion: input.expectedStateVersion,
      cookieHeader,
    })
    const binding = projectBinding(result.binding, input.projectId)
    const expectedOutcome = input.expectedStateVersion === 0
      ? 'binding_created'
      : 'binding_updated'
    if (
      !binding ||
      binding.status !== 'active' ||
      binding.version <= input.expectedStateVersion ||
      result.outcomeCode !== expectedOutcome
    ) {
      throw new Error('Invalid GitHub repository binding result.')
    }
    return NextResponse.json(
      { binding, outcomeCode: result.outcomeCode },
      { status: result.outcomeCode === 'binding_created' ? 201 : 200 },
    )
  } catch (error) {
    return failureResponse(error)
  }
}

export async function POST(request: NextRequest) {
  if (!hasJsonContentType(request)) return unsupportedMediaType()
  const cookieHeader = await getDevFlowCookieHeader()
  if (!cookieHeader) return missingAuthority()
  if (!hasAllowedMutationOrigin(request)) return forbiddenOrigin()
  const input = parsePostInput(await request.json().catch(() => null))
  if (!input) return badInput()

  try {
    if (input.action === 'revoke') {
      const result = await revokeGitHubRepositoryBinding({
        projectId: input.projectId,
        expectedStateVersion: input.expectedStateVersion,
        cookieHeader,
      })
      const binding = projectBinding(result.binding, input.projectId)
      if (
        !binding ||
        binding.status !== 'revoked' ||
        binding.version <= input.expectedStateVersion ||
        result.outcomeCode !== 'binding_revoked'
      ) {
        throw new Error('Invalid GitHub repository revocation result.')
      }
      return NextResponse.json({ binding, outcomeCode: result.outcomeCode }, { status: 200 })
    }

    const result = await decideGitHubDeliveryRequest({
      projectId: input.projectId,
      requestId: input.requestId,
      decision: input.action,
      expectedStateVersion: input.expectedStateVersion,
      cookieHeader,
    })
    const delivery = projectDelivery(result.request, input.projectId, input.requestId)
    const expectedOutcome = input.action === 'approve'
      ? 'delivery_approved'
      : 'delivery_rejected'
    const expectedStatus = input.action === 'approve' ? 'approved' : 'revoked'
    if (
      !delivery ||
      delivery.stateVersion <= input.expectedStateVersion ||
      delivery.status !== expectedStatus ||
      (input.action === 'reject' && delivery.outcomeCode !== 'approval_rejected') ||
      result.outcomeCode !== expectedOutcome
    ) {
      throw new Error('Invalid GitHub Delivery decision result.')
    }
    return NextResponse.json(
      { request: delivery, outcomeCode: result.outcomeCode },
      { status: 200 },
    )
  } catch (error) {
    return failureResponse(error)
  }
}
