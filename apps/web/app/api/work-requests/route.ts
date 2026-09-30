import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import {
  parseWorkRequestCreate,
  parseWorkRequestRecord,
} from '@ai-devflow/shared'
import { DevFlowApiError, createWorkRequest } from '../../lib/devflow-api'

const safeUpstreamStatuses = new Set([400, 401, 403, 404, 409, 410])

async function getDevFlowCookieHeader(): Promise<string | undefined> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('devflow_session')?.value
  return sessionCookie ? `devflow_session=${sessionCookie}` : undefined
}

export async function POST(request: NextRequest) {
  let input
  try {
    input = parseWorkRequestCreate(await request.json())
  } catch {
    return NextResponse.json(
      { message: '团队请求的输入无效。' },
      { status: 400 },
    )
  }

  const cookieHeader = await getDevFlowCookieHeader()
  if (!cookieHeader) {
    return NextResponse.json(
      { message: '团队请求被拒绝。' },
      { status: 401 },
    )
  }

  try {
    const result = await createWorkRequest({
      ...input,
      cookieHeader,
    })
    const workRequest = parseWorkRequestRecord(result.workRequest)
    if (workRequest.projectId !== input.projectId) {
      throw new Error('project mismatch')
    }

    return NextResponse.json(
      {
        workRequest,
        replayed: result.replayed,
        outcomeCode: result.outcomeCode,
      },
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
            ? '团队请求服务暂时不可用。'
            : '团队请求被拒绝。',
      },
      { status },
    )
  }
}
