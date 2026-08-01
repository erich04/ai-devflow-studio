import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkRequest } from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'

type WorkRequestDesktopApi = Pick<
  DevFlowDesktopApi,
  'listWorkRequests' | 'materializeWorkRequest'
>

const listErrorMessage = 'Work Requests 暂时不可用，请稍后重试。'
const materializeErrorMessage = '无法创建本地 Run，请稍后重试。'

function isExactIdentifier(value: string): boolean {
  return value.length > 0 && value.trim() === value
}

export function useWorkRequestInbox({
  desktopApi,
  localProjectId,
  isPaired,
  onMaterialized,
}: {
  desktopApi: WorkRequestDesktopApi | null
  localProjectId: string
  isPaired: boolean
  onMaterialized: (
    result: Awaited<ReturnType<WorkRequestDesktopApi['materializeWorkRequest']>>,
  ) => void | Promise<void>
}) {
  const [workRequests, setWorkRequests] = useState<WorkRequest[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [materializingId, setMaterializingId] = useState<string | null>(null)
  const materializationRef = useRef<object | null>(null)
  const requestSequenceByProjectRef = useRef<Record<string, number>>({})
  const activeContextRef = useRef({ desktopApi, isPaired, localProjectId })
  activeContextRef.current = { desktopApi, isPaired, localProjectId }

  const requestWorkRequests = useCallback(
    async (
      requestedDesktopApi: WorkRequestDesktopApi,
      requestedLocalProjectId: string,
    ): Promise<void> => {
      const sequence =
        (requestSequenceByProjectRef.current[requestedLocalProjectId] ?? 0) + 1
      requestSequenceByProjectRef.current[requestedLocalProjectId] = sequence
      const isCurrentRequest = () => {
        const activeContext = activeContextRef.current
        return (
          activeContext.desktopApi === requestedDesktopApi &&
          activeContext.isPaired &&
          activeContext.localProjectId === requestedLocalProjectId &&
          requestSequenceByProjectRef.current[requestedLocalProjectId] === sequence
        )
      }

      if (isCurrentRequest()) {
        setIsLoading(true)
        setError(null)
      }

      try {
        const nextWorkRequests = await requestedDesktopApi.listWorkRequests({
          localProjectId: requestedLocalProjectId,
        })
        if (isCurrentRequest()) {
          setWorkRequests(nextWorkRequests)
        }
      } catch {
        if (isCurrentRequest()) {
          setError(listErrorMessage)
        }
      } finally {
        if (isCurrentRequest()) {
          setIsLoading(false)
        }
      }
    },
    [],
  )

  useEffect(() => {
    materializationRef.current = null
    setMaterializingId(null)

    if (!desktopApi || !isPaired || !isExactIdentifier(localProjectId)) {
      setWorkRequests([])
      setIsLoading(false)
      setError(null)
      return undefined
    }

    setWorkRequests([])
    void requestWorkRequests(desktopApi, localProjectId)

    return () => {
      requestSequenceByProjectRef.current[localProjectId] =
        (requestSequenceByProjectRef.current[localProjectId] ?? 0) + 1
    }
  }, [desktopApi, isPaired, localProjectId, requestWorkRequests])

  const refresh = useCallback(async (): Promise<void> => {
    if (!desktopApi || !isPaired || !isExactIdentifier(localProjectId)) {
      return
    }

    await requestWorkRequests(desktopApi, localProjectId)
  }, [desktopApi, isPaired, localProjectId, requestWorkRequests])

  const materialize = useCallback(
    async (workRequest: Pick<WorkRequest, 'id' | 'version'>): Promise<void> => {
      if (
        !desktopApi ||
        !isPaired ||
        !isExactIdentifier(localProjectId) ||
        materializationRef.current
      ) {
        return
      }

      const operation = { desktopApi, localProjectId }
      const isCurrentOperation = () => {
        const activeContext = activeContextRef.current
        return (
          materializationRef.current === operation &&
          activeContext.desktopApi === desktopApi &&
          activeContext.isPaired &&
          activeContext.localProjectId === localProjectId
        )
      }
      materializationRef.current = operation
      setMaterializingId(workRequest.id)
      setError(null)
      try {
        const result = await desktopApi.materializeWorkRequest({
          localProjectId,
          workRequestId: workRequest.id,
          expectedVersion: workRequest.version,
        })
        if (!isCurrentOperation()) {
          return
        }
        await onMaterialized(result)
        if (!isCurrentOperation()) {
          return
        }
        await refresh()
      } catch {
        if (isCurrentOperation()) {
          setError(materializeErrorMessage)
        }
      } finally {
        if (materializationRef.current === operation) {
          materializationRef.current = null
          setMaterializingId(null)
        }
      }
    },
    [desktopApi, isPaired, localProjectId, onMaterialized, refresh],
  )

  return {
    workRequests,
    isLoading,
    error,
    materializingId,
    refresh,
    materialize,
  }
}
