'use client'

import { useEffect, useRef, useState } from 'react'
import { createRecommendedEnforcementPreset, createWarnOnlyDefaultPolicy, type EffectiveEnforcementPolicy, type OrganizationEnforcementPolicy, type OrganizationEnforcementRule } from '@ai-devflow/shared'
import type { TeamPolicyResult } from './team-policy-actions'
import { policyChanges, policyContent, policyRevision, policyValidationError } from './team-policy-view'

type Source = 'default' | 'persisted' | undefined
export function TeamPolicyEditor({ initialPolicy, initialSource, effectivePolicy, canEdit, readAction, saveAction }: {
  initialPolicy: OrganizationEnforcementPolicy
  initialSource: Source
  effectivePolicy?: EffectiveEnforcementPolicy | undefined
  canEdit: boolean
  readAction: (organizationId: string) => Promise<TeamPolicyResult>
  saveAction: (input: { policy: OrganizationEnforcementPolicy; expectedRevision: string }) => Promise<TeamPolicyResult>
}) {
  const [policy, setPolicy] = useState(initialPolicy)
  const [draft, setDraft] = useState(initialPolicy)
  const [source, setSource] = useState(initialSource)
  const [preview, setPreview] = useState(false)
  const [pending, setPending] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])
  const [result, setResult] = useState<TeamPolicyResult | null>(null)
  const inFlight = useRef(false)
  const dirty = policyContent(policy) !== policyContent(draft)
  const validation = policyValidationError(draft)
  const refreshRequired = result?.ok === false && result.refreshRequired
  const editable = ready && canEdit && !pending && !preview && !refreshRequired
  const changes = policyChanges(policy, draft)

  function changeRule(index: number, changes: Partial<OrganizationEnforcementRule>) {
    setDraft((current) => ({ ...current, rules: current.rules.map((rule, i) => i === index ? { ...rule, ...changes } : rule) }))
    setResult(null)
  }
  function preset(kind: 'warn' | 'recommended') {
    const create = kind === 'warn' ? createWarnOnlyDefaultPolicy : createRecommendedEnforcementPreset
    setDraft({ ...create({ organizationId: policy.organizationId }), id: policy.id })
    setResult(null)
  }
  async function submit(operation: 'save' | 'read') {
    if (inFlight.current || (operation === 'save' && (!canEdit || !preview || validation || refreshRequired))) return
    inFlight.current = true
    setPending(true)
    try {
      const next = operation === 'read' ? await readAction(policy.organizationId) : await saveAction({ policy: draft, expectedRevision: policyRevision(policy) })
      setResult(next)
      if (next.ok) {
        setPolicy(next.policy); setDraft(next.policy); setSource(next.source); setPreview(false)
      }
    } catch { setResult({ ok: false, refreshRequired: true, error: '结果暂时无法确认，请重新读取云端策略。' }) }
    finally { inFlight.current = false; setPending(false) }
  }

  return <div className="team-policy-editor" aria-busy={pending}>
    <dl className="team-policy-summary">
      <div><dt>团队</dt><dd>{policy.organizationId}</dd></div>
      <div><dt>策略来源</dt><dd>{source === 'default' ? '默认回退 · 尚未保存到 Team' : source === 'persisted' ? 'Team 已保存' : '来源待确认，请重新读取'}</dd></div>
      <div><dt>云端版本</dt><dd>v{policy.version}</dd></div>
      <div><dt>更新时间</dt><dd><time dateTime={policy.updatedAt}>{policy.updatedAt}</time></dd></div>
    </dl>
    <p>Team Policy 适用于整个团队。Desktop 使用最近同步的策略快照；保存后请在 Desktop 点击“同步团队”，核对策略版本。Web 无法确认 Desktop 是否已同步。</p>
    {!canEdit ? <p>当前为只读模式，只有组织 Owner 可以修改 Team Policy。</p> : null}
    <label>策略名称{canEdit ? <input value={draft.name} disabled={!editable} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setResult(null) }} /> : <strong>{policy.name}</strong>}</label>
    {canEdit ? <div className="studio-management-actions"><button disabled={!editable} onClick={() => preset('warn')}>使用 Warn-only 预设</button><button disabled={!editable} onClick={() => preset('recommended')}>使用 Recommended 预设</button></div> : null}
    <p>动作：ignore 忽略、warn 提示、block 阻断。最终动作受团队最低要求约束；“允许例外”仍需符合 Lead 审批和职责分离规则。</p>
    <div className="team-policy-table-wrap" tabIndex={0} aria-label="可滚动的策略规则">
      <table className="team-policy-table" aria-label="Team Policy 规则">
        <thead><tr><th>规则</th><th>动作</th><th>最低要求</th><th>允许例外</th><th>修复指引</th><th>当前项目生效动作</th></tr></thead>
        <tbody>{draft.rules.map((rule, index) => {
          const effective = effectivePolicy?.rules.find((item) => item.ruleKey === rule.ruleKey)
          const currentSnapshot = policyRevision(policy) === policyRevision(initialPolicy)
          return <tr key={rule.ruleKey}>
            <th scope="row"><code>{rule.ruleKey}</code><small>目标：{rule.target}<br />分类：{rule.category}<br />条件：{rule.statusOrSeverity}</small></th>
            <td>{canEdit ? <select aria-label={`规则 ${index + 1} 动作`} value={rule.defaultAction} disabled={!editable} onChange={(event) => changeRule(index, { defaultAction: event.target.value as OrganizationEnforcementRule['defaultAction'] })}>{['ignore', 'warn', 'block'].map((value) => <option key={value}>{value}</option>)}</select> : rule.defaultAction}</td>
            <td>{canEdit ? <select aria-label={`规则 ${index + 1} 最低要求`} value={rule.floorAction} disabled={!editable} onChange={(event) => changeRule(index, { floorAction: event.target.value as OrganizationEnforcementRule['floorAction'] })}>{['ignore', 'warn', 'block'].map((value) => <option key={value}>{value}</option>)}</select> : rule.floorAction}</td>
            <td>{canEdit ? <input aria-label={`规则 ${index + 1} 允许例外`} type="checkbox" checked={rule.overridable} disabled={!editable} onChange={(event) => changeRule(index, { overridable: event.target.checked })} /> : rule.overridable ? '是' : '否'}</td>
            <td>{canEdit ? <textarea aria-label={`规则 ${index + 1} 修复指引`} value={rule.remediation ?? ''} disabled={!editable} onChange={(event) => changeRule(index, { remediation: event.target.value })} /> : rule.remediation || '无'}</td>
            <td>{currentSnapshot ? effective ? <>{effective.action}<small>{effective.source}</small></> : '未选择项目' : '刷新页面后核对'}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    <p>项目覆盖策略仅显示当前结果，暂不支持在此创建或编辑。</p>
    {validation ? <p role="alert">{validation}</p> : null}
    {canEdit && !preview ? <button disabled={!editable || !!validation || (!dirty && source !== 'default')} onClick={() => setPreview(true)}>预览变更</button> : null}
    {canEdit && preview ? <section className="team-policy-preview" aria-label="Policy 变更预览"><h3>保存前确认</h3>
      <p>以下修改将保存为 Team Policy v{policy.version + 1}，Desktop 同步后生效。</p>
      {changes.length ? <ul>{changes.map((change) => <li key={change}>{change}</li>)}</ul> : <p>将当前默认规则首次保存到 Team，规则内容不变。</p>}
      <div className="studio-management-actions"><button disabled={pending || !!refreshRequired} onClick={() => void submit('save')}>{pending ? '正在保存并读取…' : '确认保存'}</button><button disabled={pending} onClick={() => setPreview(false)}>返回编辑</button></div>
    </section> : null}
    <button disabled={!ready || pending} onClick={() => void submit('read')}>{pending ? '处理中…' : dirty ? '重新读取云端策略（放弃未保存修改）' : '重新读取云端策略'}</button>
    {result ? <p role={result.ok ? 'status' : 'alert'}>{result.ok ? `已读取云端策略 v${result.policy.version}。请在 Desktop 同步团队后核对。` : result.error}</p> : null}
  </div>
}
