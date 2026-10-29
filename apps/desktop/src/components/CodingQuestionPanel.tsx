import { useEffect, useRef, useState } from 'react'
import { validateCodingQuestionReply, type CodingQuestionRequest, type CodingQuestionReply } from '@ai-devflow/shared'

const statusText: Record<CodingQuestionRequest['status'], string> = {
  pending: '等待你补充需求', sending: '正在发送回答并继续执行', answered: '已回答', dismissed: '已跳过',
  expired: '回答等待已超时，无法继续回答', invalidated: '原问题已失效，请查看记录后重新开始',
  delivery_unknown: '无法确认回答是否送达；不会自动重发，请查看运行记录',
}

export function CodingQuestionPanel({ question, active, busy, onReply }: {
  question: CodingQuestionRequest; active: boolean; busy: boolean; onReply: (reply: CodingQuestionReply) => void
}) {
  const [selections, setSelections] = useState<string[][]>(() => question.questions.map(() => []))
  const [custom, setCustom] = useState<string[]>(() => question.questions.map(() => ''))
  const [now, setNow] = useState(Date.now)
  const submitting = useRef(false)
  useEffect(() => { if (!busy) submitting.current = false }, [busy])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const pending = active && question.status === 'pending' && Date.parse(question.expiresAt) > now
  const answers = selections.map((selected, index) => custom[index]?.trim()
    ? question.questions[index]?.multiple ? [...selected, custom[index]!.trim()] : [custom[index]!.trim()] : selected)
  let valid = false
  try { validateCodingQuestionReply(question.questions, { kind: 'answer', answers }); valid = true } catch { /* incomplete input */ }
  function send(reply: CodingQuestionReply) {
    if (!pending || busy || submitting.current) return
    submitting.current = true
    onReply(reply)
  }
  return <section className="task-work-panel coding-question-panel" aria-label="编码问题" data-testid="coding-question-panel">
    <strong>{question.status === 'pending' && !pending ? '问题已过期或会话已结束' : statusText[question.status]}</strong>
    <p>回答用于补充需求。命令执行和最终变更仍需单独审批。</p>
    {pending ? <form onSubmit={(event) => { event.preventDefault(); if (valid) send({ kind: 'answer', answers }) }}>
      {question.questions.map((item, index) => <fieldset key={index} disabled={busy}>
        <legend>{item.question}</legend>
        {item.options.map((option) => <label className="coding-question-option" key={option.label}>
          <input type={item.multiple ? 'checkbox' : 'radio'} name={`${question.id}-${index}`} checked={selections[index]?.includes(option.label) ?? false}
            onChange={(event) => {
              setSelections((previous) => previous.map((selected, i) => i !== index ? selected : item.multiple
                ? event.target.checked ? [...selected, option.label] : selected.filter((value) => value !== option.label)
                : [option.label]))
              if (!item.multiple) setCustom((previous) => previous.map((value, i) => i === index ? '' : value))
            }} />
          <span><b>{option.label}</b> — {option.description}</span>
        </label>)}
        {item.custom !== false && <label className="coding-question-custom">{item.header}：自定义回答
          <input type="text" maxLength={4000} value={custom[index]} onChange={(event) => {
            setCustom((previous) => previous.map((value, i) => i === index ? event.target.value : value))
            if (!item.multiple) setSelections((previous) => previous.map((value, i) => i === index ? [] : value))
          }} />
        </label>}
      </fieldset>)}
      <div className="button-row">
        <button type="submit" className="primary-button" disabled={busy || !valid}>发送回答</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => send({ kind: 'dismiss' })}>跳过这些问题</button>
      </div>
    </form> : <ul>{question.questions.map((item, index) => <li key={index}>{item.question}</li>)}</ul>}
  </section>
}
