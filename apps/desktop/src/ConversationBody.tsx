import { Component, createContext, useContext, useState, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ConversationMessage } from '../electron/workbench-conversation-contract'
import { remarkKeepListParagraphs } from './app/gate-decision/material'

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

/** Gate pages only: attributes for the one element that shows a reading block (design §3.25, §5.7). */
export type BlockDecoration = { className?: string | undefined; description?: string | undefined; after?: ReactNode }
export type DecorateBlock = (start: number, end: number) => BlockDecoration | undefined
const FormattingContext = createContext<{ annotateBlock?: ((start: number, end: number) => ReactNode) | undefined; headingLabel?: ((label: string) => string) | undefined
  decorateBlock?: DecorateBlock | undefined; blockOffset?: number | undefined }>({})
type Positioned = { position?: { start: { offset?: number | undefined }; end: { offset?: number | undefined } } | undefined } | undefined
const rangeOf = (node: Positioned) => (node?.position ? [node.position.start.offset ?? 0, node.position.end.offset ?? 0] as const : undefined)
/** The decorated range: the node's source range plus the body's offset in the full material. */
function useDecoration(node: Positioned) {
  const { decorateBlock, blockOffset = 0 } = useContext(FormattingContext)
  const local = rangeOf(node)
  if (!decorateBlock || !local) return undefined
  const range = [blockOffset + local[0], blockOffset + local[1]] as const
  const decoration = decorateBlock(range[0], range[1])
  return decoration ? { range, decoration } : undefined
}
const blockAttributes = (range: readonly [number, number], decoration: BlockDecoration) => ({
  'data-block-start': range[0], 'data-block-end': range[1],
  ...(decoration.description ? { 'aria-description': decoration.description } : {}),
})
/** A table or code block cannot hold a marker, so the decorated element is a wrapper around it. */
function DecoratedBlock({ range, decoration, children }: { range: readonly [number, number]; decoration: BlockDecoration; children: ReactNode }) {
  return <div className={['gate-block', decoration.className].filter(Boolean).join(' ')} {...blockAttributes(range, decoration)} {...(decoration.description ? { role: 'group' } : {})}>
    {children}{decoration.after}
  </div>
}
const markdownComponents: Components = {
  p: function Paragraph({ node, children }) {
    const { annotateBlock } = useContext(FormattingContext)
    const range = rangeOf(node)
    const decorated = useDecoration(node)
    const annotation = annotateBlock && range ? annotateBlock(range[0], range[1]) : null
    if (decorated) return <p className={decorated.decoration.className} {...blockAttributes(decorated.range, decorated.decoration)}>{children}{decorated.decoration.after}{annotation}</p>
    return <p>{children}{annotation}</p>
  },
  pre: function Preformatted({ node, children, ...rest }) {
    const decorated = useDecoration(node)
    return decorated ? <DecoratedBlock range={decorated.range} decoration={decorated.decoration}><pre {...rest}>{children}</pre></DecoratedBlock> : <pre {...rest}>{children}</pre>
  },
  li: function ListItem({ node, children }) {
    const { annotateBlock } = useContext(FormattingContext)
    return <li>{children}{annotateBlock && node?.position && !node.children.some((child) => child.type === 'element' && child.tagName === 'p') ? annotateBlock(node.position.start.offset ?? 0, node.children.find((child) => child.type === 'element' && ['ul', 'ol'].includes(child.tagName))?.position?.start.offset ?? node.position.end.offset ?? 0) : null}</li>
  },
  table: function Table({ node, children }) {
    const { annotateBlock } = useContext(FormattingContext)
    const range = rangeOf(node)
    const decorated = useDecoration(node)
    if (decorated) return <DecoratedBlock range={decorated.range} decoration={decorated.decoration}><table>{children}</table></DecoratedBlock>
    return <><table>{children}</table>{annotateBlock && range ? annotateBlock(range[0], range[1]) : null}</>
  },
  h1: function Heading1({ children }) { const { headingLabel } = useContext(FormattingContext); return <h1>{typeof children === 'string' && headingLabel ? headingLabel(children) : children}</h1> },
  h2: function Heading2({ children }) { const { headingLabel } = useContext(FormattingContext); return <h2>{typeof children === 'string' && headingLabel ? headingLabel(children) : children}</h2> },
  h3: function Heading3({ children }) { const { headingLabel } = useContext(FormattingContext); return <h3>{typeof children === 'string' && headingLabel ? headingLabel(children) : children}</h3> },
  a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
  img: ({ src, alt }) => typeof src === 'string' && safeLink(src)
    ? <a href={safeLink(src)} target="_blank" rel="noopener noreferrer">图片：{alt || '查看链接'}</a>
    : <span>{alt || '图片链接不可用'}</span>,
}

const defaultPlugins = [remarkGfm]
const gatePlugins = [remarkGfm, remarkKeepListParagraphs]

/** Only the body is formatted. Workflow actions are validated and rendered separately. */
export function ConversationBody({ message, showFormatToggle = true, annotateBlock, headingLabel, decorateBlock, blockOffset }: { message: ConversationMessage; showFormatToggle?: boolean; annotateBlock?: ((start: number, end: number) => ReactNode) | undefined; headingLabel?: ((label: string) => string) | undefined
  /** Gate material only: every paragraph keeps its own `p`; only `p`, `table` and `pre` are decorated, never `li` (§3.25). */
  decorateBlock?: DecorateBlock | undefined
  /** Added to every decorated range and its data attributes (a section's start in the full material). */
  blockOffset?: number | undefined }) {
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
          <FormattingContext.Provider value={{ annotateBlock, headingLabel, decorateBlock, blockOffset }}><Markdown remarkPlugins={decorateBlock ? gatePlugins : defaultPlugins} urlTransform={safeLink} components={markdownComponents}>{message.text}</Markdown></FormattingContext.Provider>
        </div>
      </ReadableFallback>}
  </div>
}
