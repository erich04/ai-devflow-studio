import { Component, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ConversationMessage } from '../electron/workbench-conversation-contract'

function safeLink(value: string): string {
  try {
    const url = new URL(value)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : ''
  } catch { return '' }
}

class ReadableFallback extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  override render() {
    return this.state.failed
      ? <><p className="meta">排版暂不可用，以下是完整原文。</p><div className="message-plain">{this.props.text}</div></>
      : this.props.children
  }
}

/** Only the body is formatted. Workflow actions are validated and rendered separately. */
export function ConversationBody({ message }: { message: ConversationMessage }) {
  const [raw, setRaw] = useState(false)
  // Deterministic legacy policy: old assistant bodies use Markdown, user input stays literal.
  const format = message.role === 'assistant' ? message.format ?? 'markdown' : 'plain_text'
  const unsupported = format !== 'markdown' && format !== 'plain_text'
  return <div className="message-body">
    {message.role === 'assistant' && format !== 'plain_text' && <button className="text-button message-format-toggle" onClick={() => setRaw(!raw)}>{raw ? '返回排版' : '查看原文'}</button>}
    {unsupported && <p className="meta">暂不支持该内容格式，已按原文显示。</p>}
    {raw || format !== 'markdown' ? <div className="message-plain">{message.text}</div> :
      <ReadableFallback key={message.text} text={message.text}>
        <div className="message-markdown">
          <Markdown remarkPlugins={[remarkGfm]} urlTransform={safeLink} components={{
            a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
            // Do not automatically load remote images or local files supplied by a model.
            img: ({ src, alt }) => typeof src === 'string' && safeLink(src)
              ? <a href={safeLink(src)} target="_blank" rel="noopener noreferrer">图片：{alt || '查看链接'}</a>
              : <span>{alt || '图片链接不可用'}</span>,
          }}>{message.text}</Markdown>
        </div>
      </ReadableFallback>}
  </div>
}
