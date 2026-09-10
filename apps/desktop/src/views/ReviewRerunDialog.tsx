import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export function ReviewRerunDialog({ target, provider, reviewedAt, onCancel, onConfirm }: {
  target: string
  provider: string
  reviewedAt: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previousFocus = document.activeElement
    cancelRef.current?.focus()
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-rerun-title"
        aria-describedby="review-rerun-impact"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          } else if (event.key === 'Tab') {
            if (event.shiftKey && document.activeElement === cancelRef.current) {
              event.preventDefault()
              confirmRef.current?.focus()
            } else if (!event.shiftKey && document.activeElement === confirmRef.current) {
              event.preventDefault()
              cancelRef.current?.focus()
            }
          }
        }}
      >
        <h2 id="review-rerun-title">确认重新审查</h2>
        <p><strong>{target}</strong></p>
        <p>上次审查：{reviewedAt}</p>
        <p>本次 Provider：{provider}</p>
        <p id="review-rerun-impact">继续会再次调用 Provider，新增审查记录和 token 用量，并可能产生 Provider 费用。上次结果会保留在历史记录中。</p>
        <div className="modal-actions">
          <button ref={cancelRef} className="ghost-button" onClick={onCancel}>取消</button>
          <button ref={confirmRef} className="primary-button" onClick={onConfirm}>继续并重新审查</button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
