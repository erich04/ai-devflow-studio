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

function createIdleState(projectId: string): PairingPanelState {
  return {
    projectId,
    pairingCode: null,
    status: 'idle',
    message: '',
  }
}

export function PairingCodePanel({ projectId }: { projectId: string }) {
  const [state, setState] = useState<PairingPanelState>(() => createIdleState(projectId))
  const requestVersion = useRef(0)
  const currentProjectId = useRef(projectId)
  currentProjectId.current = projectId

  useEffect(() => {
    requestVersion.current += 1
    setState(createIdleState(projectId))
  }, [projectId])

  const visibleState = state.projectId === projectId ? state : createIdleState(projectId)

  async function createPairingCode() {
    const requestProjectId = projectId
    const currentRequestVersion = requestVersion.current + 1
    requestVersion.current = currentRequestVersion
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

  return (
    <div className="pairing-code-panel">
      <button type="button" onClick={createPairingCode} disabled={visibleState.status === 'creating'}>
        {visibleState.status === 'creating' ? 'Creating code...' : 'Create desktop pairing code'}
      </button>
      {visibleState.pairingCode ? (
        <code aria-label={`Desktop pairing code for ${projectId}`}>{visibleState.pairingCode.code}</code>
      ) : null}
      {visibleState.message ? <small>{visibleState.message}</small> : null}
    </div>
  )
}
