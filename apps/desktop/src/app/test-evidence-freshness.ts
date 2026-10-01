import { useEffect, useState } from 'react'
import type { TestEvidence, TestEvidenceFreshness } from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'
import { formatLocalTime } from './desktop-view-model'

export type TestEvidenceFreshnessState = TestEvidenceFreshness['state']
export type TestEvidenceFreshnessMap = Readonly<Record<string, TestEvidenceFreshnessState>>
const empty: TestEvidenceFreshnessMap = Object.freeze({})

/**
 * What a passed result says about the current code (plan §6.4, hardening H3). Only a matching
 * fingerprint is shown as current; anything unknown stays "适用性无法核实".
 */
export function passedEvidenceApplicability(
  evidence: Pick<TestEvidence, 'createdAt'>,
  state: TestEvidenceFreshnessState | undefined,
): { text: string; stale: boolean } {
  const at = `执行于 ${formatLocalTime(evidence.createdAt)}。`
  if (state === 'current') return { text: `${at}结果对应当前代码。`, stale: false }
  if (state === 'stale') return { text: `${at}所测代码之后有改动，结果已过期，请重新运行检查。`, stale: true }
  if (state === 'unavailable') return { text: `${at}所测工作区已不存在或无法读取，适用性无法核实。`, stale: false }
  return { text: `${at}证据没有记录所测代码的提交，适用性无法核实。`, stale: false }
}

/**
 * Reads freshness for a run's test evidence from the main process. Re-reads when the evidence or
 * `refreshKey` (for example the latest coding run) changes and when the window regains focus.
 */
export function useTestEvidenceFreshness(
  api: Pick<DevFlowDesktopApi, 'getTestEvidenceFreshness'> | null | undefined,
  runId: string | undefined,
  evidence: readonly Pick<TestEvidence, 'id' | 'createdAt' | 'runId'>[],
  refreshKey = '',
): TestEvidenceFreshnessMap {
  const [freshness, setFreshness] = useState<TestEvidenceFreshnessMap>(empty)
  const [focusCount, setFocusCount] = useState(0)
  const evidenceKey = evidence.filter((item) => item.runId === runId).map((item) => `${item.id}@${item.createdAt}`).join('|')
  useEffect(() => {
    const onFocus = () => setFocusCount((count) => count + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  const read = api?.getTestEvidenceFreshness
  useEffect(() => {
    // Keep the same object when already empty so an unchanged answer never re-renders.
    const clear = () => setFreshness((current) => (Object.keys(current).length === 0 ? current : empty))
    if (!read || !runId || !evidenceKey) {
      clear()
      return
    }
    let active = true
    Promise.resolve()
      .then(() => read({ runId }))
      .then((items) => {
        if (active) setFreshness(Object.fromEntries(items.map((item) => [item.evidenceId, item.state])))
      })
      .catch(() => {
        // Unknown freshness is shown as "适用性无法核实", never as current.
        if (active) clear()
      })
    return () => { active = false }
  }, [read, runId, evidenceKey, refreshKey, focusCount])
  return freshness
}

