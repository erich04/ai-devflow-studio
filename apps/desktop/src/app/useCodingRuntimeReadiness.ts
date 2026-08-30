import { useCallback, useEffect, useRef, useState } from 'react'
import type { CodingRuntimeReadiness } from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'

export function useCodingRuntimeReadiness(input: {
  desktopApi: DevFlowDesktopApi | null
  projectId: string | undefined
  runId: string | undefined
  nodeId: string | undefined
  requestedBy: string | undefined
  runtimeBudgetApprovalId: string
  refreshKey?: string
}) {
  const [readiness, setReadiness] = useState<CodingRuntimeReadiness | null>(null)
  const [error, setError] = useState('')
  const requestVersion = useRef(0)

  const refresh = useCallback(async (approvalId = input.runtimeBudgetApprovalId) => {
    if (
      !input.desktopApi ||
      !input.projectId ||
      !input.runId ||
      !input.nodeId ||
      !input.requestedBy
    ) {
      setReadiness(null)
      setError('')
      return null
    }
    const version = requestVersion.current + 1
    requestVersion.current = version
    try {
      const next = await input.desktopApi.getCodingRuntimeReadiness({
        projectId: input.projectId,
        runId: input.runId,
        nodeId: input.nodeId,
        requestedBy: input.requestedBy,
        ...(approvalId.trim() ? { runtimeBudgetApprovalId: approvalId.trim() } : {}),
      })
      if (requestVersion.current === version) {
        setReadiness(next)
        setError('')
      }
      return next
    } catch (caught) {
      if (requestVersion.current === version) {
        setReadiness(null)
        setError(caught instanceof Error ? caught.message : '无法读取 Coding Runtime Readiness')
      }
      return null
    }
  }, [
    input.desktopApi,
    input.nodeId,
    input.projectId,
    input.requestedBy,
    input.runId,
    input.runtimeBudgetApprovalId,
    input.refreshKey,
  ])

  useEffect(() => {
    void refresh()
    return () => {
      requestVersion.current += 1
    }
  }, [refresh])

  return { readiness, error, refresh }
}
