import { useState } from 'react'
import { gateCopy } from '../../app/gate-decision/copy'
import type { HistoryListView } from '../../app/gate-decision/projection'

/** A history version's stored list, read-only, with 「复制全部」 (design §5.5). */
export function HistoryList({ list, onCopy }: { list: HistoryListView; onCopy?: ((text: string) => Promise<void>) | undefined }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try {
      await (onCopy ?? ((text: string) => navigator.clipboard.writeText(text)))(list.text)
      setState('copied')
    } catch { setState('failed') }
  }
  return <details className="gate-history-list" data-testid="gate-history-list">
    <summary>{list.title}</summary>
    <pre>{list.text}</pre>
    <button type="button" className="text-button" onClick={() => void copy()}>{gateCopy.copyAll}</button>
    {state === 'copied' ? <span className="meta" role="status">已复制</span> : null}
    {state === 'failed' ? <p role="alert" className="gate-note gate-note--warn">{gateCopy.copyFailed}</p> : null}
  </details>
}
