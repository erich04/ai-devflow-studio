'use client'

import { useState } from 'react'

/** A long identifier shown short, with its full value one click away (plan §9.2). */
export function CopyValue({ value, label, short }: { value: string; label: string; short?: string }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <span className="copy-value">
      <code title={value}>{short ?? value}</code>
      <button
        type="button"
        className="copy-value__button"
        aria-label={`复制${label}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value)
            .then(() => setCopied('copied'), () => setCopied('failed'))
        }}
      >
        复制
      </button>
      {copied !== 'idle' ? (
        <small role="status">{copied === 'copied' ? '已复制' : '无法复制，请手动选择'}</small>
      ) : null}
    </span>
  )
}
