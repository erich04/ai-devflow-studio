import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatUsd, type RuntimeBudgetPolicy } from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'

type BudgetState = {
  policy: RuntimeBudgetPolicy | null
  status: 'loading' | 'loaded' | 'unavailable' | 'unpaired'
  error: string
}

export function useProjectRuntimeBudget(input: {
  desktopApi: Pick<DevFlowDesktopApi, 'getCodingRuntimeBudgetPolicy' | 'saveCodingRuntimeBudgetPolicy'> | null
  projectId: string | undefined
  bindingKey: string
}) {
  const scope = useMemo(() => ({ ...input }), [input.desktopApi, input.projectId, input.bindingKey])
  const currentScope = useRef(scope)
  currentScope.current = scope
  const requestVersion = useRef(0)
  const [result, setResult] = useState<{ scope: typeof scope; state: BudgetState } | null>(null)
  const available = Boolean(scope.desktopApi && scope.projectId && scope.bindingKey)
  const state: BudgetState = result?.scope === scope ? result.state : {
    policy: null, status: available ? 'loading' : 'unpaired', error: '',
  }

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    if (!scope.desktopApi || !scope.projectId || !scope.bindingKey) return
    setResult({ scope, state: { policy: null, status: 'loading', error: '' } })
    try {
      const policy = await scope.desktopApi.getCodingRuntimeBudgetPolicy({ projectId: scope.projectId })
      if (currentScope.current === scope && requestVersion.current === version) {
        setResult({ scope, state: { policy, status: 'loaded', error: '' } })
      }
    } catch (error) {
      if (currentScope.current === scope && requestVersion.current === version) {
        setResult({ scope, state: {
          policy: null, status: 'unavailable',
          error: error instanceof Error ? error.message : '无法读取 Team 预算策略',
        } })
      }
    }
  }, [scope])

  useEffect(() => {
    void refresh()
    return () => { requestVersion.current += 1 }
  }, [refresh])

  const save = useCallback(async (values: Omit<Parameters<DevFlowDesktopApi['saveCodingRuntimeBudgetPolicy']>[0], 'projectId'>) => {
    if (!scope.desktopApi || !scope.projectId || !scope.bindingKey) throw new Error('请先配对 Team Project')
    const version = ++requestVersion.current
    try {
      const policy = await scope.desktopApi.saveCodingRuntimeBudgetPolicy({ ...values, projectId: scope.projectId })
      if (currentScope.current === scope && requestVersion.current === version) {
        setResult({ scope, state: { policy, status: 'loaded', error: '' } })
      }
      return policy
    } catch (error) {
      if (currentScope.current === scope && requestVersion.current === version) {
        setResult((previous) => previous?.scope === scope && previous.state.status === 'loaded'
          ? previous
          : { scope, state: {
              policy: null, status: 'unavailable',
              error: error instanceof Error ? error.message : '无法保存 Team 预算策略',
            } })
      }
      throw error
    }
  }, [scope])

  const label = state.status === 'loaded'
    ? state.policy
      ? state.policy.enabled
        ? `已配置 · ${formatUsd(state.policy.monthlyLimitUsd)} / 月 · 预警 ${formatUsd(state.policy.warningThresholdUsd)}`
        : '已禁用'
      : '未配置'
    : state.status === 'loading' ? '加载中' : state.status === 'unpaired' ? '未配对' : '不可用'
  return { ...state, label, refresh, save }
}

export type ProjectRuntimeBudget = ReturnType<typeof useProjectRuntimeBudget>
