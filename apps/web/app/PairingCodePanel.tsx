'use client'

import { useEffect, useRef, useState } from 'react'
import type { DiagnosticRecord, DesktopPairingCode, Role } from '@ai-devflow/shared'
import { parseDesktopPairingCodePayload } from './lib/pairing-code'
import { pairingRequest } from './lib/pairing-diagnostics'
import { PairingDiagnosticHistory } from './PairingDiagnosticHistory'

type PairingPanelState = {
  projectId: string
  pairingCode: DesktopPairingCode | null
  status: 'idle' | 'creating' | 'ready' | 'revoking' | 'error' | 'expired'
  message: string
}

type PairingCopyState = {
  projectId: string
  status: 'idle' | 'copying' | 'copied' | 'error'
  message: string
}

function createIdleState(projectId: string): PairingPanelState {
  return {
    projectId,
    pairingCode: null,
    status: 'idle',
    message: '',
  }
}

function createIdleCopyState(projectId: string): PairingCopyState {
  return {
    projectId,
    status: 'idle',
    message: '',
  }
}

export type PairingSubject = {
  userId: string
  userName: string
  role: Role
}

type PairingCodePanelProps = {
  projectId: string
  projectName: string
  subject: PairingSubject | null
}

function issuedRoleFor(role: Role): Role {
  return role === 'owner' ? 'lead' : role
}

export function PairingCodePanel({ projectId, projectName, subject }: PairingCodePanelProps) {
  const [state, setState] = useState<PairingPanelState>(() => createIdleState(projectId))
  const [copyState, setCopyState] = useState<PairingCopyState>(() => createIdleCopyState(projectId))
  const [diagnostics, setDiagnostics] = useState<DiagnosticRecord[]>([])
  const activeRequests = useRef(new Set<string>())
  const requestVersion = useRef(0)
  const currentProjectId = useRef(projectId)
  const currentSubjectKey = useRef(subject ? `${subject.userId}:${subject.role}` : '')
  const initializedScope = useRef({ projectId, subjectKey: currentSubjectKey.current })
  const copyFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  currentProjectId.current = projectId
  currentSubjectKey.current = subject ? `${subject.userId}:${subject.role}` : ''

  useEffect(() => {
    const subjectKey = subject ? `${subject.userId}:${subject.role}` : ''
    if (
      initializedScope.current.projectId === projectId &&
      initializedScope.current.subjectKey === subjectKey
    ) {
      // A hydration-time click may precede this initial passive effect.
      return
    }
    initializedScope.current = { projectId, subjectKey }
    requestVersion.current += 1
    if (copyFeedbackTimer.current) {
      clearTimeout(copyFeedbackTimer.current)
      copyFeedbackTimer.current = null
    }
    setDiagnostics([])
    setState(createIdleState(projectId))
    setCopyState(createIdleCopyState(projectId))
  }, [projectId, subject?.userId, subject?.role])

  useEffect(() => () => {
    if (copyFeedbackTimer.current) {
      clearTimeout(copyFeedbackTimer.current)
    }
  }, [])

  const matchesSubject = initializedScope.current.subjectKey === currentSubjectKey.current
  const visibleState = state.projectId === projectId && matchesSubject ? state : createIdleState(projectId)
  const visibleCopyState = copyState.projectId === projectId && matchesSubject
    ? copyState
    : createIdleCopyState(projectId)

  useEffect(() => {
    if (!visibleState.pairingCode || visibleState.status !== 'ready') return
    const codeId = visibleState.pairingCode.id
    const expire = () => setState((current) => current.pairingCode?.id === codeId && current.status === 'ready'
      ? { ...current, status: 'expired', message: '配对码已过期，请重新生成。' } : current)
    const remaining = Date.parse(visibleState.pairingCode.expiresAt) - Date.now()
    if (remaining <= 0) { expire(); return }
    const timer = setTimeout(expire, Math.min(remaining, 2_147_483_647))
    return () => clearTimeout(timer)
  }, [visibleState.pairingCode, visibleState.status])

  async function createPairingCode() {
    if (!subject) {
      return
    }
    const requestKey = `${projectId}:${subject.userId}:${subject.role}`
    if (activeRequests.current.has(requestKey)) return
    activeRequests.current.add(requestKey)
    const requestProjectId = projectId
    const requestSubjectKey = `${subject.userId}:${subject.role}`
    const currentRequestVersion = requestVersion.current + 1
    requestVersion.current = currentRequestVersion
    if (copyFeedbackTimer.current) {
      clearTimeout(copyFeedbackTimer.current)
      copyFeedbackTimer.current = null
    }
    setCopyState(createIdleCopyState(requestProjectId))
    setState({
      projectId: requestProjectId,
      pairingCode: null,
      status: 'creating',
      message: '',
    })

    try {
      const nextPairingCode = await pairingRequest({
        method: 'POST', projectId: requestProjectId,
        record: (record) => { if (currentProjectId.current === requestProjectId && currentSubjectKey.current === requestSubjectKey) setDiagnostics((items) => [record, ...items].slice(0, 100)) },
        validate: async (response) => {
          const parsed = parseDesktopPairingCodePayload(await response.json(), requestProjectId)
          if (parsed.createdByUserId !== subject.userId || parsed.issuedRole !== issuedRoleFor(subject.role)) throw new Error('Invalid pairing subject')
          return parsed
        },
      })
      if (
        currentProjectId.current !== requestProjectId ||
        currentSubjectKey.current !== requestSubjectKey ||
        requestVersion.current !== currentRequestVersion
      ) {
        return
      }
      setState({
        projectId: requestProjectId,
        pairingCode: nextPairingCode,
        status: 'ready',
        message: `Expires ${new Date(nextPairingCode.expiresAt).toLocaleTimeString()}`,
      })
    } catch (error) {
      if (
        currentProjectId.current !== requestProjectId ||
        currentSubjectKey.current !== requestSubjectKey ||
        requestVersion.current !== currentRequestVersion
      ) {
        return
      }
      setState({
        projectId: requestProjectId,
        pairingCode: null,
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to create desktop pairing code',
      })
    } finally { activeRequests.current.delete(requestKey) }
  }

  async function revokePairingCode() {
    if (!subject || !visibleState.pairingCode || visibleState.status !== 'ready') {
      return
    }
    const requestKey = `${projectId}:${subject.userId}:${subject.role}`
    if (activeRequests.current.has(requestKey)) return
    activeRequests.current.add(requestKey)
    const requestSubjectKey = `${subject.userId}:${subject.role}`
    const pairingCodeId = visibleState.pairingCode.id
    const requestProjectId = projectId
    const currentRequestVersion = requestVersion.current
    setState((current) => ({ ...current, status: 'revoking', message: '' }))
    try {
      await pairingRequest({
        method: 'DELETE', projectId: requestProjectId, pairingCodeId,
        validate: async () => undefined,
        record: (record) => { if (currentProjectId.current === requestProjectId && currentSubjectKey.current === requestSubjectKey) setDiagnostics((items) => [record, ...items].slice(0, 100)) },
      })
      if (
        currentProjectId.current !== requestProjectId ||
        currentSubjectKey.current !== requestSubjectKey ||
        requestVersion.current !== currentRequestVersion
      ) {
        return
      }
      setState({
        ...createIdleState(requestProjectId),
        message: '配对码已撤销。',
      })
      setCopyState(createIdleCopyState(requestProjectId))
    } catch (error) {
      if (
        currentProjectId.current !== requestProjectId ||
        currentSubjectKey.current !== requestSubjectKey ||
        requestVersion.current !== currentRequestVersion
      ) {
        return
      }
      setState((current) => ({
        ...current,
        status: 'ready',
        message: error instanceof Error ? error.message : '无法撤销配对码。',
      }))
    } finally { activeRequests.current.delete(requestKey) }
  }

  async function copyPairingCode() {
    if (!visibleState.pairingCode || visibleState.status !== 'ready' || Date.parse(visibleState.pairingCode.expiresAt) <= Date.now()) {
      return
    }

    const requestSubjectKey = currentSubjectKey.current
    const requestProjectId = projectId
    const currentRequestVersion = requestVersion.current
    const code = visibleState.pairingCode.code
    if (copyFeedbackTimer.current) {
      clearTimeout(copyFeedbackTimer.current)
      copyFeedbackTimer.current = null
    }
    setCopyState({
      projectId: requestProjectId,
      status: 'copying',
      message: '',
    })

    try {
      const writeText = globalThis.navigator?.clipboard?.writeText
      if (!writeText) {
        throw new Error('Clipboard API unavailable')
      }
      await writeText.call(globalThis.navigator.clipboard, code)
      if (
        currentProjectId.current !== requestProjectId ||
        currentSubjectKey.current !== requestSubjectKey ||
        requestVersion.current !== currentRequestVersion
      ) {
        return
      }
      setCopyState({
        projectId: requestProjectId,
        status: 'copied',
        message: '已复制',
      })
      copyFeedbackTimer.current = setTimeout(() => {
        if (
          currentProjectId.current === requestProjectId &&
          currentSubjectKey.current === requestSubjectKey &&
          requestVersion.current === currentRequestVersion
        ) {
          setCopyState(createIdleCopyState(requestProjectId))
        }
      }, 2_000)
    } catch {
      if (
        currentProjectId.current !== requestProjectId ||
        currentSubjectKey.current !== requestSubjectKey ||
        requestVersion.current !== currentRequestVersion
      ) {
        return
      }
      setCopyState({
        projectId: requestProjectId,
        status: 'error',
        message: '复制失败，请重试或手动复制。',
      })
    }
  }

  return (
    <div className="pairing-code-panel">
      {subject ? (
        <p className="pairing-subject">
          将以 <strong>{subject.userName}</strong> / {subject.role} 绑定到{' '}
          <strong>{projectName}</strong>；Desktop 有效权限上限为 {issuedRoleFor(subject.role)}。
        </p>
      ) : (
        <p className="pairing-subject">登录并成为当前项目成员后，才能为自己创建配对码。</p>
      )}
      <button
        type="button"
        onClick={createPairingCode}
        disabled={!subject || visibleState.status === 'creating' || visibleState.status === 'revoking'}
      >
        {visibleState.status === 'creating' ? 'Creating code...' : visibleState.status === 'expired' ? '重新生成配对码' : 'Create desktop pairing code'}
      </button>
      {visibleState.pairingCode ? (
        <div className="pairing-code-result">
          {visibleState.status === 'expired' ? <strong role="status">配对码已过期</strong> : <code aria-label={`Desktop pairing code for ${projectId}`}>{visibleState.pairingCode.code}</code>}
          <div className="pairing-code-actions">
            <button
              type="button"
              onClick={() => void copyPairingCode()}
              disabled={visibleCopyState.status === 'copying' || visibleState.status !== 'ready'}
            >
              {visibleCopyState.status === 'copying'
                ? '复制中...'
                : visibleCopyState.status === 'copied'
                  ? '已复制'
                  : '复制配对码'}
            </button>
            <button
              type="button"
              className="pairing-code-revoke"
              onClick={() => void revokePairingCode()}
              disabled={visibleState.status !== 'ready'}
            >
              {visibleState.status === 'revoking' ? '撤销中...' : '撤销配对码'}
            </button>
          </div>
        </div>
      ) : null}
      {visibleState.message ? <small>{visibleState.message}</small> : null}
      {visibleCopyState.message ? (
        <small role={visibleCopyState.status === 'error' ? 'alert' : 'status'}>
          {visibleCopyState.message}
        </small>
      ) : null}
      <PairingDiagnosticHistory key={`${projectId}:${subject?.userId}:${subject?.role}`} records={initializedScope.current.subjectKey === currentSubjectKey.current ? diagnostics.filter((record) => record.projectId === projectId) : []} />
    </div>
  )
}
