import { NextResponse } from 'next/server'
import { resolveDevFlowApiBaseUrl } from '../lib/devflow-api'

export const dynamic = 'force-dynamic'

const webReady = Object.freeze({
  status: 'ready',
  service: '@ai-devflow/web',
})
const webUnavailable = Object.freeze({
  status: 'unavailable',
  service: '@ai-devflow/web',
})

export async function GET() {
  try {
    const response = await fetch(`${resolveDevFlowApiBaseUrl()}/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    })
    const body = response.ok
      ? await response.json().catch(() => null) as {
          status?: unknown
          service?: unknown
        } | null
      : null

    if (body?.status === 'ready' && body.service === '@ai-devflow/api') {
      return NextResponse.json(webReady)
    }
  } catch {
    // Readiness is intentionally fail-closed and never exposes upstream details.
  }

  return NextResponse.json(webUnavailable, { status: 503 })
}
