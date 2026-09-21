import { randomUUID } from 'node:crypto'
import { DIAGNOSTIC_HEADER, safeDiagnosticId } from '@ai-devflow/shared'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import {
  DevFlowApiError,
  createDesktopPairingCode,
  revokeDesktopPairingCode,
} from '../../lib/devflow-api'
import { parseDesktopPairingCodePayload } from '../../lib/pairing-code'

const safeUpstreamStatuses = new Set([400, 401, 403, 404, 409])

async function getDevFlowCookieHeader(): Promise<string | undefined> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('devflow_session')?.value
  return sessionCookie ? `devflow_session=${sessionCookie}` : undefined
}

export async function POST(request: NextRequest) {
  const diagnosticId = safeDiagnosticId(request.headers.get(DIAGNOSTIC_HEADER)) ?? randomUUID()
  const headers = { [DIAGNOSTIC_HEADER]: diagnosticId }
  const body = await request.json().catch(() => null)
  const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : ''

  if (!projectId) {
    return NextResponse.json({ message: 'projectId is required' }, { status: 400, headers })
  }

  try {
    const cookieHeader = await getDevFlowCookieHeader()
    const pairingCode = await createDesktopPairingCode({
      projectId, diagnosticId,
      ...(cookieHeader ? { cookieHeader } : {}),
    })

    return NextResponse.json(
      parseDesktopPairingCodePayload(pairingCode, projectId),
      { status: 201, headers },
    )
  } catch (error) {
    const status =
      error instanceof DevFlowApiError && safeUpstreamStatuses.has(error.status)
        ? error.status
        : 502
    return NextResponse.json(
      {
        message:
          status === 502
            ? 'Pairing code service is unavailable.'
            : 'Pairing code request was rejected.',
      },
      { status, headers },
    )
  }
}

export async function DELETE(request: NextRequest) {
  const diagnosticId = safeDiagnosticId(request.headers.get(DIAGNOSTIC_HEADER)) ?? randomUUID()
  const headers = { [DIAGNOSTIC_HEADER]: diagnosticId }
  const body = await request.json().catch(() => null)
  const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : ''
  const pairingCodeId =
    typeof body?.pairingCodeId === 'string' ? body.pairingCodeId.trim() : ''
  if (!projectId || !pairingCodeId) {
    return NextResponse.json(
      { message: 'projectId and pairingCodeId are required' },
      { status: 400, headers },
    )
  }
  try {
    const cookieHeader = await getDevFlowCookieHeader()
    if (!cookieHeader) {
      return NextResponse.json({ message: 'Authentication required.' }, { status: 401, headers })
    }
    await revokeDesktopPairingCode({ projectId, pairingCodeId, cookieHeader, diagnosticId })
    return NextResponse.json({ revoked: true }, { status: 200, headers })
  } catch (error) {
    const status =
      error instanceof DevFlowApiError && safeUpstreamStatuses.has(error.status)
        ? error.status
        : 502
    return NextResponse.json(
      { message: status === 502 ? 'Pairing code service is unavailable.' : 'Revoke was rejected.' },
      { status, headers },
    )
  }
}
