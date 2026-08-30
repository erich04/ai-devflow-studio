'use client'

import { useEffect, useRef, useState } from 'react'
import type { DesktopPairingCode } from '@ai-devflow/shared'
import { parseDesktopPairingCodePayload } from './lib/pairing-code'

type PairingPanelState = {
  projectId: string
  pairingCode: DesktopPairingCode | null
  status: 'idle' | 'creating' | 'ready' | 'error'
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

export function PairingCodePanel({ projectId }: { projectId: string }) {
  const [state, setState] = useState<PairingPanelState>(() => createIdleState(projectId))
  const [copyState, setCopyState] = useState<PairingCopyState>(() => createIdleCopyState(projectId))
  const requestVersion = useRef(0)
  const currentProjectId = useRef(projectId)
  const copyFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  currentProjectId.current = projectId

  useEffect(() => {
    requestVersion.current += 1
    if (copyFeedbackTimer.current) {
      clearTimeout(copyFeedbackTimer.current)
      copyFeedbackTimer.current = null
    }
    setState(createIdleState(projectId))
    setCopyState(createIdleCopyState(projectId))
  }, [projectId])

  useEffect(() => () => {
    if (copyFeedbackTimer.current) {
      clearTimeout(copyFeedbackTimer.current)
    }
  }, [])

  const visibleState = state.projectId === projectId ? state : createIdleState(projectId)
  const visibleCopyState = copyState.projectId === projectId
    ? copyState
    : createIdleCopyState(projectId)

  async function createPairingCode() {
    const requestProjectId = projectId
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
      const response = await fetch('/api/pairing-code', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ projectId: requestProjectId }),
      })

      if (!response.ok) {
        throw new Error(`Pairing code request failed with ${response.status}`)
      }

      const nextPairingCode = parseDesktopPairingCodePayload(
        await response.json().catch(() => {
          throw new Error('Pairing code response was invalid.')
        }),
        requestProjectId,
      )
      if (
        currentProjectId.current !== requestProjectId ||
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
    }
  }

  async function copyPairingCode() {
    if (!visibleState.pairingCode || visibleState.status !== 'ready') {
      return
    }

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
          requestVersion.current === currentRequestVersion
        ) {
          setCopyState(createIdleCopyState(requestProjectId))
        }
      }, 2_000)
    } catch {
      if (
        currentProjectId.current !== requestProjectId ||
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
      <button type="button" onClick={createPairingCode} disabled={visibleState.status === 'creating'}>
        {visibleState.status === 'creating' ? 'Creating code...' : 'Create desktop pairing code'}
      </button>
      {visibleState.pairingCode ? (
        <div className="pairing-code-result">
          <code aria-label={`Desktop pairing code for ${projectId}`}>{visibleState.pairingCode.code}</code>
          <button
            type="button"
            onClick={() => void copyPairingCode()}
            disabled={visibleCopyState.status === 'copying'}
          >
            {visibleCopyState.status === 'copying'
              ? '复制中...'
              : visibleCopyState.status === 'copied'
                ? '已复制'
                : '复制配对码'}
          </button>
        </div>
      ) : null}
      {visibleState.message ? <small>{visibleState.message}</small> : null}
      {visibleCopyState.message ? (
        <small role={visibleCopyState.status === 'error' ? 'alert' : 'status'}>
          {visibleCopyState.message}
        </small>
      ) : null}
    </div>
  )
}
