import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { resolveDevFlowApiBaseUrl } from '../../../lib/devflow-api'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('devflow_session')?.value

  try {
    const upstream = await fetch(`${resolveDevFlowApiBaseUrl()}/api/auth/logout`, {
      method: 'POST',
      cache: 'no-store',
      redirect: 'manual',
      ...(sessionCookie
        ? { headers: { cookie: `devflow_session=${sessionCookie}` } }
        : {}),
    })
    if (!upstream.ok) {
      return NextResponse.json(
        { message: 'Logout service is unavailable.' },
        { status: 502 },
      )
    }

    const response = NextResponse.redirect(new URL('/', request.url), 303)
    const clearCookie = upstream.headers.get('set-cookie')
    if (clearCookie) {
      response.headers.set('set-cookie', clearCookie)
    }
    return response
  } catch {
    return NextResponse.json(
      { message: 'Logout service is unavailable.' },
      { status: 502 },
    )
  }
}
