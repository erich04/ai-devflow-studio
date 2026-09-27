import { Component, createContext, useContext, useState, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
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

const FormattingContext = createContext<{ annotateBlock?: ((start: number, end: number) => ReactNode) | undefined; headingLabel?: ((label: string) => string) | undefined }>({})
const markdownComponents: Components = {
  p: function Paragraph({ node, children }) {
    const { annotateBlock } = useContext(FormattingContext)
    return <p>{children}{annotateBlock && node?.position ? annotateBlock(node.position.start.offset ?? 0, node.position.end.offset ?? 0) : null}</p>
  },
  li: function ListItem({ node, children }) {
    const { annotateBlock } = useContext(FormattingContext)
    return <li>{children}{annotateBlock && node?.position && !node.children.some((child) => child.type === 'element' && child.tagName === 'p') ? annotateBlock(node.position.start.offset ?? 0, node.children.find((child) => child.type === 'element' && ['ul', 'ol'].includes(child.tagName))?.position?.start.offset ?? node.position.end.offset ?? 0) : null}</li>
  },
  table: function Table({ node, children }) { const { annotateBlock } = useContext(FormattingContext); return <><table>{children}</table>{annotateBlock && node?.position ? annotateBlock(node.position.start.offset ?? 0, node.position.end.offset ?? 0) : null}</> },
  h1: function Heading1({ children }) { const { headingLabel } = useContext(FormattingContext); return <h1>{typeof children === 'string' && headingLabel ? headingLabel(children) : children}</h1> },
  h2: function Heading2({ children }) { const { headingLabel } = useContext(FormattingContext); return <h2>{typeof children === 'string' && headingLabel ? headingLabel(children) : children}</h2> },
  h3: function Heading3({ children }) { const { headingLabel } = useContext(FormattingContext); return <h3>{typeof children === 'string' && headingLabel ? headingLabel(children) : children}</h3> },
  a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
  img: ({ src, alt }) => typeof src === 'string' && safeLink(src)
    ? <a href={safeLink(src)} target="_blank" rel="noopener noreferrer">图片：{alt || '查看链接'}</a>
    : <span>{alt || '图片链接不可用'}</span>,
}

/** Only the body is formatted. Workflow actions are validated and rendered separately. */
export function ConversationBody({ message, showFormatToggle = true, annotateBlock, headingLabel }: { message: ConversationMessage; showFormatToggle?: boolean; annotateBlock?: ((start: number, end: number) => ReactNode) | undefined; headingLabel?: ((label: string) => string) | undefined }) {
  const [raw, setRaw] = useState(false)
  // Deterministic legacy policy: old assistant bodies use Markdown, user input stays literal.
  const format = message.role === 'assistant' ? message.format ?? 'markdown' : 'plain_text'
  const unsupported = format !== 'markdown' && format !== 'plain_text'
  return <div className="message-body">
    {showFormatToggle && message.role === 'assistant' && format !== 'plain_text' && <button className="text-button message-format-toggle" onClick={() => setRaw(!raw)}>{raw ? '返回排版' : '查看原文'}</button>}
    {unsupported && <p className="meta">暂不支持该内容格式，已按原文显示。</p>}
    {raw || format !== 'markdown' ? <div className="message-plain">{message.text}</div> :
      <ReadableFallback key={message.text} text={message.text}>
        <div className="message-markdown">
          <FormattingContext.Provider value={{ annotateBlock, headingLabel }}><Markdown remarkPlugins={[remarkGfm]} urlTransform={safeLink} components={markdownComponents}>{message.text}</Markdown></FormattingContext.Provider>
        </div>
      </ReadableFallback>}
  </div>
}
