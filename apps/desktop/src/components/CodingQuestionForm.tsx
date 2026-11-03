import type { CodingQuestionInfo } from '@ai-devflow/shared'
/** One controlled question. Answers live above cards so changing layout never loses them. */
export function CodingQuestionForm({ question, name, selected, custom, disabled, onChange }: {
  question: CodingQuestionInfo; name: string; selected: string[]; custom: string; disabled: boolean
  onChange(selected: string[], custom: string): void
}) {
  return <fieldset disabled={disabled} data-raw-material>
    <legend>{question.question}</legend>
    {question.options.map(option => <label className="coding-question-option" key={option.label}>
      <input type={question.multiple ? 'checkbox' : 'radio'} name={name} checked={selected.includes(option.label)} onChange={e => onChange(question.multiple ? e.target.checked ? [...selected, option.label] : selected.filter(v => v !== option.label) : [option.label], question.multiple ? custom : '')} />
      <span><b>{option.label}</b> — {option.description}</span>
    </label>)}
    {question.custom !== false ? <label className="coding-question-custom">{question.header}：自定义回答
      <input type="text" maxLength={4000} value={custom} onChange={e => onChange(question.multiple ? selected : [], e.target.value)} />
    </label> : null}
  </fieldset>
}
