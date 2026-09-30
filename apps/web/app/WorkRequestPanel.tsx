'use client'

import { useEffect, useRef, useState } from 'react'
import {
  parseWorkRequestRecord,
  type WorkRequest,
} from '@ai-devflow/shared'

type PanelState = {
  projectId: string
  workRequests: WorkRequest[]
  status: 'idle' | 'creating' | 'ready' | 'error'
  message: string
}

type WorkRequestPanelProps = {
  projectId: string
  initialWorkRequests: WorkRequest[]
  createIdempotencyKey?: () => string
}

const INVALID_RESPONSE_MESSAGE = '团队请求服务返回了无法核对的结果，请刷新后确认是否已创建。'
const CREATION_FAILED_MESSAGE = '团队请求创建失败，请重试。'

/** Display only; the stored status values stay unchanged. */
const statusLabels: Record<WorkRequest['status'], string> = {
  open: '待领取',
  claim_pending: '领取中',
  materialized: '已生成开发任务',
  cancelled: '已取消',
  expired: '已过期',
}

function defaultIdempotencyKey(): string {
  return `work-request:${globalThis.crypto.randomUUID()}`
}

function initialState(
  projectId: string,
  workRequests: WorkRequest[],
): PanelState {
  return {
    projectId,
    workRequests: workRequests.filter((item) => item.projectId === projectId),
    status: 'idle',
    message: '',
  }
}

function parseCreateResponse(value: unknown, projectId: string): WorkRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(INVALID_RESPONSE_MESSAGE)
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (
    keys.length !== 3 ||
    keys[0] !== 'outcomeCode' ||
    keys[1] !== 'replayed' ||
    keys[2] !== 'workRequest' ||
    record.outcomeCode !== 'created' ||
    typeof record.replayed !== 'boolean'
  ) {
    throw new Error(INVALID_RESPONSE_MESSAGE)
  }

  try {
    const workRequest = parseWorkRequestRecord(record.workRequest)
    if (workRequest.projectId !== projectId) {
      throw new Error('project mismatch')
    }
    return workRequest
  } catch {
    throw new Error(INVALID_RESPONSE_MESSAGE)
  }
}

export function WorkRequestPanel({
  projectId,
  initialWorkRequests,
  createIdempotencyKey = defaultIdempotencyKey,
}: WorkRequestPanelProps) {
  const [state, setState] = useState(() => initialState(projectId, initialWorkRequests))
  const [title, setTitle] = useState('')
  const [request, setRequest] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey)
  const currentProjectId = useRef(projectId)
  const requestVersion = useRef(0)
  const idFactory = useRef(createIdempotencyKey)
  currentProjectId.current = projectId
  idFactory.current = createIdempotencyKey

  useEffect(() => {
    requestVersion.current += 1
    setState(initialState(projectId, initialWorkRequests))
    setTitle('')
    setRequest('')
    setIdempotencyKey(idFactory.current())
  }, [projectId, initialWorkRequests])

  const visibleState =
    state.projectId === projectId
      ? state
      : initialState(projectId, initialWorkRequests)

  async function submitWorkRequest() {
    if (visibleState.status === 'creating' || !title.trim() || !request.trim()) {
      return
    }

    const requestProjectId = projectId
    const currentRequestVersion = requestVersion.current + 1
    requestVersion.current = currentRequestVersion
    setState((current) => ({
      ...current,
      projectId: requestProjectId,
      status: 'creating',
      message: '',
    }))

    try {
      const response = await fetch('/api/work-requests', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          projectId: requestProjectId,
          title,
          request,
          idempotencyKey,
          expiresAt: null,
        }),
      })
      if (!response.ok) {
        throw new Error(CREATION_FAILED_MESSAGE)
      }
      const workRequest = parseCreateResponse(
        await response.json().catch(() => {
          throw new Error(INVALID_RESPONSE_MESSAGE)
        }),
        requestProjectId,
      )
      if (
        currentProjectId.current !== requestProjectId ||
        requestVersion.current !== currentRequestVersion
      ) {
        return
      }

      setState((current) => ({
        projectId: requestProjectId,
        workRequests: [
          workRequest,
          ...current.workRequests.filter((item) => item.id !== workRequest.id),
        ],
        status: 'ready',
        message: '团队请求已创建。已配对的桌面端现在可以领取。',
      }))
      setTitle('')
      setRequest('')
      setIdempotencyKey(idFactory.current())
    } catch (error) {
      if (
        currentProjectId.current !== requestProjectId ||
        requestVersion.current !== currentRequestVersion
      ) {
        return
      }
      setState((current) => ({
        ...current,
        projectId: requestProjectId,
        status: 'error',
        // Only this panel's own copy is shown; transport errors (e.g. a failed fetch) are not.
        message:
          error instanceof Error && error.message === INVALID_RESPONSE_MESSAGE
            ? INVALID_RESPONSE_MESSAGE
            : CREATION_FAILED_MESSAGE,
      }))
    }
  }

  return (
    <section className={`work-request-panel${visibleState.workRequests.length === 0 ? ' work-request-panel--empty' : ''}`} id="work-request" aria-label="团队请求">
      <div>
        <span>需求入口</span>
        <h2>团队请求</h2>
        <p>这里只创建团队请求；已配对的桌面端明确领取后，才会在本地生成开发任务。</p>
      </div>
      <div className="work-request-intake">
        <form onSubmit={(event) => {
          event.preventDefault()
          void submitWorkRequest()
        }}>
          <label>
            <span>标题</span>
            <input
              aria-label="团队请求标题"
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            <span>需求说明</span>
            <textarea
              aria-label="团队请求需求说明"
              maxLength={8_000}
              value={request}
              onChange={(event) => setRequest(event.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={
              visibleState.status === 'creating' ||
              title.trim().length === 0 ||
              request.trim().length === 0
            }
          >
            {visibleState.status === 'creating' ? '创建中…' : '创建团队请求'}
          </button>
        </form>
        {visibleState.message ? <small role="status">{visibleState.message}</small> : null}
        {visibleState.workRequests.length === 0 ? <p className="work-request-empty">当前项目还没有团队请求。</p> : null}
      </div>
      {visibleState.workRequests.length > 0 ? (
        <div className="work-request-list">
          {visibleState.workRequests.map((item) => (
            <article key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{statusLabels[item.status] ?? item.status}</span>
              </div>
              <p>{item.request}</p>
              <small>v{item.version} · {item.id}</small>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
