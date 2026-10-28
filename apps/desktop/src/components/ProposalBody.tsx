import { fromMarkdown } from 'mdast-util-from-markdown'
import { ConversationBody } from '../ConversationBody'

type TextNode = { type: string; value?: string; children?: TextNode[] }
function headingText(node: TextNode): string {
  return node.value ?? node.children?.map(headingText).join('') ?? ''
}

function startsWithTitle(content: string, title: string): boolean {
  try {
    const first = fromMarkdown(content).children[0]
    return first?.type === 'heading' && first.depth === 1 && headingText(first).trim() === title.trim()
  } catch { return false }
}

/** Display-only: both Markdown and raw views receive the original, unmodified proposal. */
export function ProposalBody({ content, title }: { content: string; title?: string }) {
  return <section className="proposal-body" aria-label="提案正文">
    {title && !startsWithTitle(content, title) && <strong className="proposal-body-title">{title}</strong>}
    <div className="proposal-body-content" tabIndex={0} aria-label="提案正文滚动区域">
      <ConversationBody message={{ id: 'proposal-body', role: 'assistant', text: content, format: 'markdown', createdAt: '' }} />
    </div>
  </section>
}
