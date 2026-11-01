import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * Confirms another paid Gate Review when the step already has one. It names what this review covers
 * and which version the kept result belongs to (#251).
 */
export function ReviewRerunDialog({ target, context, provider, reviewedAt, reviewedLabel, appliesToCurrent, onCancel, onConfirm }: {
  /** What this review covers, e.g. “需求 v2”. */
  target: string
  /** The task and step, for orientation. */
  context: string
  provider: string
  /** Formatted time of the saved review. */
  reviewedAt: string
  /** The older version the saved review covered, e.g. “需求 v1”; shown only when it is not current. */
  reviewedLabel: string | undefined
  /** False when the saved review covered an older version. */
  appliesToCurrent: boolean
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
  // Only an older version is named; a re-run of the same version keeps the plain time.
  const previous = appliesToCurrent ? '' : reviewedLabel ?? '之前的版本'

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
        <h2 id="review-rerun-title">{appliesToCurrent ? '确认重新审查' : `确认审查${target}`}</h2>
        <p><strong>将审查{target}</strong></p>
        <p className="meta">{context}</p>
        <p>上次审查：{previous ? `${previous} · ` : ''}{reviewedAt}{appliesToCurrent ? '' : '，当前版本已更新'}</p>
        <p>本次 Provider：{provider}</p>
        <p id="review-rerun-impact">{appliesToCurrent
          ? '继续会再次调用 Provider，新增审查记录和 token 用量，并可能产生 Provider 费用。上次结果会保留在历史记录中。'
          : `继续会调用 Provider 审查${target}，新增审查记录和 token 用量，并可能产生 Provider 费用。${previous}的审查结果保留在历史记录中，不作为${target}的结果。`}
        </p>
        <div className="modal-actions">
          <button ref={cancelRef} className="ghost-button" onClick={onCancel}>取消</button>
          <button ref={confirmRef} className="primary-button" onClick={onConfirm}>{appliesToCurrent ? '继续并重新审查' : `开始审查${target}`}</button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
