import { useEffect, useRef, useState } from 'react'
import { describeProviderThinking, resolveProviderThinking, supportsProviderThinking, type AgentProviderConfig, type ProviderCredentialMetadata, type ProviderThinkingConfiguration } from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'

export function ProviderThinkingFields({ model, baseUrl, value, onChange, disabled = false }: {
  model: string; baseUrl?: string | undefined; value: ProviderThinkingConfiguration
  onChange(value: ProviderThinkingConfiguration): void; disabled?: boolean
}) {
  const supported = supportsProviderThinking({ model, baseUrl })
  let effective: string
  try { effective = describeProviderThinking(resolveProviderThinking({ model, baseUrl, thinking: value })) }
  catch { effective = '当前模型不支持已选参数，请改用默认值。' }
  return <div className="provider-thinking-fields">
    <label>思考模式<select aria-label="思考模式" disabled={disabled} value={value.mode} onChange={(event) => {
      const mode = event.target.value as ProviderThinkingConfiguration['mode']
      onChange({ mode, ...(mode === 'enabled' ? { effort: value.effort ?? 'low' } : {}) })
    }}>
      <option value="default">使用默认值</option>
      <option value="enabled" disabled={!supported}>开启</option>
      <option value="disabled" disabled={!supported}>关闭</option>
    </select></label>
    {supported && value.mode === 'enabled' ? <label>推理强度<select aria-label="推理强度" disabled={disabled} value={value.effort ?? 'low'} onChange={(event) => onChange({ mode: 'enabled', effort: event.target.value as NonNullable<ProviderThinkingConfiguration['effort']> })}>
      <option value="low">低 · low</option><option value="high">高 · high</option><option value="max">最高 · max</option>
    </select></label> : null}
    <p>保存后使用：{effective}</p>
    {!supported ? <p>此接口或模型尚未接入思考参数配置；使用模型默认行为，不发送 DeepSeek 专用参数。</p> : null}
    <p>聊天、需求澄清、方案设计、审查和 DevFlow Native 共用此设置。高强度通常消耗更多时间与 token，现有输出和超时上限仍有效。</p>
    <p>展开或折叠推理只改变显示。OpenCode 等外部执行器由自身配置控制。</p>
  </div>
}

export function SavedProviderThinkingSettings({ provider, api, onUpdated }: {
  provider: AgentProviderConfig; api: Pick<DevFlowDesktopApi, 'updateProviderThinking'>
  onUpdated?: ((metadata: ProviderCredentialMetadata) => void) | undefined
}) {
  const [saved, setSaved] = useState(provider)
  const [value, setValue] = useState<ProviderThinkingConfiguration>(provider.thinking ?? { mode: 'default' })
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const observedVersion = useRef(provider.updatedAt)
  useEffect(() => {
    if (provider.updatedAt === observedVersion.current) return
    observedVersion.current = provider.updatedAt
    setSaved(provider)
    setValue(provider.thinking ?? { mode: 'default' })
  }, [provider])
  return <details className="provider-thinking-settings"><summary>思考模式与推理强度</summary>
    <ProviderThinkingFields model={saved.model} baseUrl={saved.baseUrl} value={value} onChange={(next) => { setValue(next); setStatus('尚未保存；保存后对新调用生效。') }} disabled={busy} />
    <button className="ghost-button" disabled={busy || !api.updateProviderThinking} onClick={async () => {
      if (!api.updateProviderThinking) return
      setBusy(true); setStatus('')
      try {
        const metadata = await api.updateProviderThinking({ providerId: saved.id, expectedUpdatedAt: saved.updatedAt, thinking: value })
        setSaved({ ...saved, ...metadata }); onUpdated?.(metadata)
        setStatus('已保存；新发起的调用使用此设置，正在运行的调用保持原配置。')
      } catch (error) { setStatus(error instanceof Error ? error.message : '保存失败，请重试。') }
      finally { setBusy(false) }
    }}>保存思考设置</button>
    <p role="status">{status}</p>
  </details>
}
