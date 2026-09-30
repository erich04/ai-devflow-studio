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
    return NextResponse.json({ message: '缺少项目标识（projectId）。' }, { status: 400, headers })
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
            ? '配对码服务暂时不可用。'
            : '配对码请求被拒绝。',
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
      { message: '缺少项目标识（projectId）或配对码标识（pairingCodeId）。' },
      { status: 400, headers },
    )
  }
  try {
    const cookieHeader = await getDevFlowCookieHeader()
    if (!cookieHeader) {
      return NextResponse.json({ message: '需要先登录。' }, { status: 401, headers })
    }
    await revokeDesktopPairingCode({ projectId, pairingCodeId, cookieHeader, diagnosticId })
    return NextResponse.json({ revoked: true }, { status: 200, headers })
  } catch (error) {
    const status =
      error instanceof DevFlowApiError && safeUpstreamStatuses.has(error.status)
        ? error.status
        : 502
    return NextResponse.json(
      { message: status === 502 ? '配对码服务暂时不可用。' : '撤销配对码的请求被拒绝。' },
      { status, headers },
    )
  }
}
