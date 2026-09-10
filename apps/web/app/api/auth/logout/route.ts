import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { resolveDevFlowApiBaseUrl } from '../../../lib/devflow-api'

export async function POST(_request: NextRequest) {
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

    // Next may expose its internal localhost origin here. Keep browser storage
    // and the return page on the user's current public origin, including proxies.
    const response = new NextResponse(null, { status: 303, headers: { location: '/' } })
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
