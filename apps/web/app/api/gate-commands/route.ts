import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import {
  GATE_COMMAND_ID_MAX_LENGTH,
  parseGateCommandCreate,
  parseGateCommandRecord,
} from '@ai-devflow/shared'
import {
  DevFlowApiError,
  createGateCommand,
  fetchGateCommands,
} from '../../lib/devflow-api'

const safeUpstreamStatuses = new Set([400, 401, 403, 404, 409, 410, 503])

async function getDevFlowCookieHeader(): Promise<string | undefined> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('devflow_session')?.value
  return sessionCookie ? `devflow_session=${sessionCookie}` : undefined
}

function isProjectId(value: string | null): value is string {
  return Boolean(
    value &&
      value.length <= GATE_COMMAND_ID_MAX_LENGTH &&
      value.trim() === value,
  )
}

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId')
  if (!isProjectId(projectId)) {
    return NextResponse.json(
      { message: '审批查询范围无效。' },
      { status: 400 },
    )
  }
  const cookieHeader = await getDevFlowCookieHeader()
  if (!cookieHeader) {
    return NextResponse.json(
      { message: '审批请求被拒绝。' },
      { status: 401 },
    )
  }
  try {
    const commands = await fetchGateCommands({ projectId, cookieHeader })
    return NextResponse.json({ commands }, { status: 200 })
  } catch (error) {
    const status =
      error instanceof DevFlowApiError && safeUpstreamStatuses.has(error.status)
        ? error.status
        : 502
    return NextResponse.json(
      {
        message:
          status === 502
            ? '审批服务暂时不可用。'
            : '审批请求被拒绝。',
      },
      { status },
    )
  }
}

export async function POST(request: NextRequest) {
  let input
  try {
    input = parseGateCommandCreate(await request.json())
  } catch {
    return NextResponse.json(
      { message: '审批请求的输入无效。' },
      { status: 400 },
    )
  }

  const cookieHeader = await getDevFlowCookieHeader()
  if (!cookieHeader) {
    return NextResponse.json(
      { message: '审批请求被拒绝。' },
      { status: 401 },
    )
  }

  try {
    const result = await createGateCommand({ ...input, cookieHeader })
    const command = parseGateCommandRecord(result.command)
    if (
      command.projectId !== input.projectId ||
      command.runId !== input.runId ||
      command.nodeId !== input.nodeId
    ) {
      throw new Error('scope mismatch')
    }
    return NextResponse.json(
      {
        command,
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
            ? '审批服务暂时不可用。'
            : '审批请求被拒绝。',
      },
      { status },
    )
  }
}
