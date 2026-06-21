import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { createDesktopPairingCode } from '../../lib/devflow-api'

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

    return NextResponse.json(pairingCode, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to create desktop pairing code' },
      { status: 502 },
    )
  }
}
