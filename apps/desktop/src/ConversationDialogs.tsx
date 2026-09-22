import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp, X } from 'lucide-react'

function ConversationDialog({ title, onClose, busy = false, children }: {
  title: string; onClose: () => void; busy?: boolean; children: ReactNode
}) {
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    const previousFocus = document.activeElement
    dialog.current?.focus()
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])
  return createPortal(<div className="modal-backdrop">
    <section ref={dialog} className="conversation-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onClose() }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), [href], [tabindex="0"]') ?? [])
      const first = controls[0]; const last = controls.at(-1)
      if (!first) { event.preventDefault(); dialog.current?.focus() }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus() }
    }}>
      <header className="conversation-dialog-header"><h2 id={titleId}>{title}</h2><button type="button" className="workspace-icon" aria-label={`关闭${title}`} disabled={busy} onClick={onClose}><X size={18} /></button></header>
      {children}
    </section>
  </div>, document.body)
}

export function NewConversationDialog({ prompt, providerName, creating, error, onClose, onCreate }: {
  prompt: string; providerName: string; creating: boolean; error: string; onClose: () => void
  onCreate: (executor: 'direct-provider' | 'opencode') => void
}) {
  const [executor, setExecutor] = useState<'direct-provider' | 'opencode'>('direct-provider')
  return <ConversationDialog title="新建对话" onClose={onClose} busy={creating}>
    <div className="conversation-dialog-body">
      <label className="conversation-executor-field">执行方式<select aria-label="新对话执行方式" value={executor} disabled={creating} onChange={(event) => setExecutor(event.target.value as typeof executor)}>
        <option value="direct-provider">Direct Provider</option><option value="opencode">OpenCode</option>
      </select></label>
      <p>{executor === 'opencode' ? '通过本机 OpenCode 查询资料和分析问题；需要已安装 OpenCode。' : '由 DevFlow 直接调用模型，查询资料和分析问题。'}</p>
      <p>模型：{providerName || '尚未选择，请在 Agents 中配置'}。创建后，这段聊天将保持所选执行方式；需要更换时可另建对话。</p>
      {prompt && <div className="conversation-prefill"><strong>预填问题</strong><p>{prompt}</p></div>}
      <p className="meta">创建只会准备好对话和输入草稿，由你点击发送后才调用模型。已有聊天保持不变。</p>
      {error && <p className="conversation-error" role="alert">{error}</p>}
    </div>
    <footer className="conversation-dialog-actions"><button type="button" className="ghost-button" disabled={creating} onClick={onClose}>取消</button><button type="button" className="primary-button" disabled={creating} onClick={() => onCreate(executor)}>{creating ? '正在创建…' : '创建对话'}</button></footer>
  </ConversationDialog>
}

export function ConversationHelpButton() {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="workspace-icon conversation-help-button" aria-label="了解会话信息" title="了解会话信息" aria-haspopup="dialog" onClick={() => setOpen(true)}><CircleHelp size={18} /></button>
    {open && <ConversationDialog title="会话说明" onClose={() => setOpen(false)}>
      <div className="conversation-dialog-body conversation-help-content">
        <section><h3>哪些资料共用，哪些只属于这段聊天？</h3>
          <p>同一个项目里的聊天，都可以按需查询同一份流程进度、已保存产物与证据、项目代码和知识。「共享」是共用项目资料，不是把完整聊天公开给团队或其他用户，也不是每次都把所有资料发给模型。</p>
          <p>每段聊天有自己的记录、待回答问题和未保存草稿，其他会话不会自动读到。例如，你在 A 聊天里确认「筛选状态不持久化」，B 聊天不会自动知道。</p>
          <p>明确点击「保存为节点提案」后，展示的那份提案才成为可查询的项目资料。保存提案不会共享整段聊天，也不代表正式阶段产物已经生成或 Gate 已通过。</p>
        </section>
        <section><h3>这个聊天可以查询什么？</h3>
          <p>可以查询项目流程和节点进度、读取已保存产物与证据、只读检索当前项目代码，以及检索已配置的项目知识。是否查询、查询哪些资料，取决于你的问题和实际工具调用。</p>
          <p>目前没有接入你所开发系统的业务数据库，例如直接查询订单或客户数据。DevFlow 自身保存的流程、节点与产物记录仍然可以查询。</p>
        </section>
        <section><h3>执行方式有什么区别？如何切换？</h3>
          <p>Direct Provider 由 DevFlow 直接调用所选模型并组织查询；OpenCode 则通过本机 OpenCode 和受限查询工具进行调查。</p>
          <p>执行方式在新建时确定并保存在该会话中。想换一种方式，请点击「＋」新建对话；原会话保持原来的方式，历史也会保留。</p>
        </section>
        <section><h3>聊天会直接改代码或推进流程吗？</h3>
          <p>这个入口用于查资料、分析和提出建议，不能直接修改代码、执行任意命令或批准 Gate。Gate 就是流程中需要人工确认的审批关卡。</p>
          <p>OpenCode 本身具备编码能力，但聊天入口与「开发实现」节点的权限不同。实际改代码应走开发实现流程。</p>
        </section>
      </div>
      <footer className="conversation-dialog-actions"><button type="button" className="primary-button" onClick={() => setOpen(false)}>关闭说明</button></footer>
    </ConversationDialog>}
  </>
}
