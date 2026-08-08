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
    throw new Error('Work Request response was invalid.')
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
    throw new Error('Work Request response was invalid.')
  }

  try {
    const workRequest = parseWorkRequestRecord(record.workRequest)
    if (workRequest.projectId !== projectId) {
      throw new Error('project mismatch')
    }
    return workRequest
  } catch {
    throw new Error('Work Request response was invalid.')
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
        throw new Error('Work Request creation failed.')
      }
      const workRequest = parseCreateResponse(
        await response.json().catch(() => {
          throw new Error('Work Request response was invalid.')
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
        message: 'Work Request created. A paired Desktop can now claim it.',
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
        message:
          error instanceof Error ? error.message : 'Work Request creation failed.',
      }))
    }
  }

  return (
    <section className="work-request-panel" id="work-request" aria-label="Work Requests">
      <div>
        <span>Team intake</span>
        <h2>工作请求</h2>
        <p>这里只创建团队请求；本地 Run 会在已配对的 Desktop 明确认领后生成。</p>
      </div>
      <form onSubmit={(event) => {
        event.preventDefault()
        void submitWorkRequest()
      }}>
        <label>
          <span>标题</span>
          <input
            aria-label="Work Request title"
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          <span>需求说明</span>
          <textarea
            aria-label="Work Request details"
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
          {visibleState.status === 'creating' ? 'Creating...' : 'Create Work Request'}
        </button>
      </form>
      {visibleState.message ? <small role="status">{visibleState.message}</small> : null}
      <div className="work-request-list">
        {visibleState.workRequests.length > 0 ? (
          visibleState.workRequests.map((item) => (
            <article key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.status.replace('_', ' ')}</span>
              </div>
              <p>{item.request}</p>
              <small>v{item.version} · {item.id}</small>
            </article>
          ))
        ) : (
          <p>当前项目还没有工作请求。</p>
        )}
      </div>
    </section>
  )
}
