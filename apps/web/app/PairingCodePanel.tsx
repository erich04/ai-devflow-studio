'use client'

import { useState } from 'react'
import type { DesktopPairingCode } from '@ai-devflow/shared'

export function PairingCodePanel({ projectId }: { projectId: string }) {
  const [pairingCode, setPairingCode] = useState<DesktopPairingCode | null>(null)
  const [status, setStatus] = useState<'idle' | 'creating' | 'ready' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function createPairingCode() {
    setStatus('creating')
    setMessage('')

    try {
      const response = await fetch('/api/pairing-code', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ projectId }),
      })

      if (!response.ok) {
        throw new Error(`Pairing code request failed with ${response.status}`)
      }

      const nextPairingCode = (await response.json()) as DesktopPairingCode
      setPairingCode(nextPairingCode)
      setStatus('ready')
      setMessage(`Expires ${new Date(nextPairingCode.expiresAt).toLocaleTimeString()}`)
    } catch (error) {
      setPairingCode(null)
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Failed to create desktop pairing code')
    }
  }

  return (
    <div className="pairing-code-panel">
      <button type="button" onClick={createPairingCode} disabled={status === 'creating'}>
        {status === 'creating' ? 'Creating code...' : 'Create desktop pairing code'}
      </button>
      {pairingCode ? (
        <code aria-label={`Desktop pairing code for ${projectId}`}>{pairingCode.code}</code>
      ) : null}
      {message ? <small>{message}</small> : null}
    </div>
  )
}
