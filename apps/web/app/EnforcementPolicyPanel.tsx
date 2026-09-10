'use client'

import { useEffect, useRef, useState } from 'react'
import type { OrganizationEnforcementPolicy } from '@ai-devflow/shared'
import type { EnforcementPolicyResult } from './enforcement-policy-actions'
import { isRecommendedPolicy } from './enforcement-policy-view'

export function EnforcementPolicyPanel({ initialPolicy, updateAction }: {
  initialPolicy: OrganizationEnforcementPolicy
  updateAction: (organizationId: string, operation: 'apply' | 'refresh') => Promise<EnforcementPolicyResult>
}) {
  const [policy, setPolicy] = useState(initialPolicy)
  const [result, setResult] = useState<EnforcementPolicyResult | null>(null)
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  const currentOrganization = useRef(initialPolicy.organizationId)
  currentOrganization.current = initialPolicy.organizationId
  useEffect(() => { setPolicy(initialPolicy) }, [initialPolicy])
  const applied = isRecommendedPolicy(policy)
  const refreshRequired = result?.ok === false && result.refreshRequired

  async function submit() {
    if (inFlight.current || (applied && !refreshRequired)) return
    const organizationId = initialPolicy.organizationId
    inFlight.current = true
    setPending(true)
    try {
      const next = await updateAction(organizationId, refreshRequired ? 'refresh' : 'apply')
      if (currentOrganization.current !== organizationId) return
      setResult(next)
      if (next.ok) setPolicy(next.policy)
    } catch {
      if (currentOrganization.current !== organizationId) return
      setResult({ ok: false, refreshRequired: true, error: '结果暂时无法确认，请重新读取云端策略。' })
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <div className="enforcement-policy-panel" aria-busy={pending}>
      <strong>{policy.name}</strong>
      <dl>
        <div><dt>来源</dt><dd>团队 API · 组织策略</dd></div>
        <div><dt>策略版本</dt><dd>v{policy.version}</dd></div>
        <div><dt>阻断规则</dt><dd>{policy.rules.filter((rule) => rule.defaultAction === 'block').length} 条</dd></div>
        <div><dt>更新时间</dt><dd><time dateTime={policy.updatedAt}>{policy.updatedAt}</time></dd></div>
      </dl>
      <p>Desktop 同步团队后会更新本地策略快照。</p>
      <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <button type="submit" disabled={pending || (applied && !refreshRequired)}>
          {pending ? '正在读取并确认…' : refreshRequired ? '重新读取云端策略' : applied ? '推荐策略已应用' : 'Apply recommended enforcement'}
        </button>
      </form>
      {result ? (
        <p role={result.ok ? 'status' : 'alert'}>
          {result.ok ? '已读取云端最新策略。' : result.error}
        </p>
      ) : null}
    </div>
  )
}
