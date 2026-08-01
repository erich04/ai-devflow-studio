import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { DevFlowApiError, createDesktopPairingCode } from '../../lib/devflow-api'
import { parseDesktopPairingCodePayload } from '../../lib/pairing-code'

const safeUpstreamStatuses = new Set([400, 401, 403, 404, 409])

async function getDevFlowCookieHeader(): Promise<string | undefined> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('devflow_session')?.value
  return sessionCookie ? `devflow_session=${sessionCookie}` : undefined
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : ''

  if (!projectId) {
    return NextResponse.json({ message: 'projectId is required' }, { status: 400 })
  }

  try {
    const cookieHeader = await getDevFlowCookieHeader()
    const pairingCode = await createDesktopPairingCode({
      projectId,
      ...(cookieHeader ? { cookieHeader } : {}),
    })

    return NextResponse.json(
      parseDesktopPairingCodePayload(pairingCode, projectId),
      { status: 201 },
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
      { status },
    )
  }
}
