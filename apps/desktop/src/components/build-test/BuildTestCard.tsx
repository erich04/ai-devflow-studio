import { useEffect, useState } from 'react'
import { DISCUSSED_CARDS_CHANGED, readDiscussedCards, discussedCardKey } from '../../app/discussed-cards'
import { BuildTestText } from './BuildTestTerms'
import { codingSessionPermissionRule, validateCodingQuestionReply } from '@ai-devflow/shared'
import type { CardView } from '../../app/gate-decision/projection'
import type { BuildTestController } from '../../app/useBuildTestController'
import { effectiveCodingRun } from '../../app/build-test/facts'
import { CodingQuestionForm } from '../CodingQuestionForm'
import { useDecisionPage } from '../gate-page/DecisionPageContext'
import { cardClass, FindingCardBody, type CardLinkProps } from '../gate-page/FindingCard'
export function RawSegments({ segments }: { segments: NonNullable<CardView['segments']> }) { return <>{segments.map((s, i) => s.raw ? <code key={i} data-raw-material>{s.text}</code> : <span key={i}><BuildTestText text={s.text} /></span>)}</> }
export function BuildTestCard({ card, controller, discuss, linked, flashing, style, onLink }: { card: CardView; controller: BuildTestController; discuss?: (() => void) | undefined } & CardLinkProps) {
  const [discussed, setDiscussed] = useState(readDiscussedCards)
  useEffect(() => { const update = () => setDiscussed(readDiscussedCards()); window.addEventListener(DISCUSSED_CARDS_CHANGED, update); return () => window.removeEventListener(DISCUSSED_CARDS_CHANGED, update) }, [])
  const scope = useDecisionPage(), p = card.permission
  const review = controller.facts?.history?.reviews.find(r => r.id === card.finding?.reviewId)
  const messageId = review ? discussed[discussedCardKey(controller.facts!.run.projectId, `${review.changeSetId}#${card.id}`)] : undefined
  const rule = p ? codingSessionPermissionRule(p) : undefined
  const run = controller.facts && effectiveCodingRun(controller.facts)
  return <article className={cardClass(card, linked, flashing)} data-card-id={card.id} data-first-layer tabIndex={-1} style={style} aria-label={card.title} onMouseEnter={() => onLink?.(card.id)} onMouseLeave={() => onLink?.(undefined)} onFocus={() => onLink?.(card.id)} onBlur={() => onLink?.(undefined)}>
    {card.kind === 'finding' ? <FindingCardBody card={card} apply={scope.apply} discuss={discuss} body={card.segments ? <RawSegments segments={card.segments} /> : undefined} /> : <>
      <strong className="gate-card-title">{card.title}</strong>
      <p className="gate-card-text">{card.segments ? <RawSegments segments={card.segments} /> : <BuildTestText text={card.text} />}</p>
      {card.quote ? <pre data-raw-material>{card.quote}</pre> : null}
      {p ? <>
        <p>{p.origin === 'execution_authorization' ? '只在这次的受管工作区里；不提交、不推送，也不改你的项目目录。运行命令、安装依赖和联网会另外请求。' : p.origin === 'dependency_bootstrap' ? '项目里没有锁文件，依赖版本不固定，所以要你确认一次。' : run?.engine === 'opencode-http' ? '这是 OpenCode 在这次的受管工作区里发出的请求。' : '这是本地兼容执行器发出的请求，不调用模型。'}</p>
        {card.actionable ? run?.permissionPause?.requestId === p.id ? <button type="button" className="ghost-button" onClick={() => void controller.renew(p)}>重新核验并请求审批</button> : <>
          <div className="button-row"><button type="button" className="primary-button" onClick={() => void controller.permission(p, 'approved')}>允许一次</button><button type="button" className="ghost-button danger-button" onClick={() => void controller.permission(p, 'rejected')}>拒绝</button></div>
          <p className="meta">允许一次：{p.origin === 'execution_authorization' ? 'OpenCode 开始开发。' : p.origin === 'dependency_bootstrap' ? '运行这条安装命令一次，再继续开发。' : p.permission === 'bash' ? 'OpenCode 运行这条命令一次。' : p.permission === 'external_directory' ? 'OpenCode 访问这个目录一次。' : '执行器改这些文件一次。'}</p>
          <p className="meta">拒绝：这次开发停止，受管工作区{p.origin === 'execution_authorization' ? '保留' : '会被清理'}。</p>
          {rule ? <details><summary>{rule.kind === 'command' ? '在这次开发里都允许这条命令' : '在这次开发里都允许改这些文件'}</summary>
            <pre data-raw-material>{rule.kind === 'command' ? rule.command : rule.paths.join('\n')}</pre>
            <p>只在这次开发和这个受管工作区里有效，最长两小时；开发结束、配置变化、撤销或退出应用后失效。</p>
            <button type="button" className="ghost-button" onClick={() => void controller.permission(p, 'approved', 'session')}>允许，并在这次开发里复用</button>
            <p className="meta">这一次照样执行；之后同样的请求自动允许，可以在「执行记录」里撤销。</p>
          </details> : null}
        </> : null}
        <details><summary>技术详情</summary><pre data-raw-material>{JSON.stringify({ title: p.title, reasons: p.reasons, permission: p.permission, expiresAt: p.expiresAt }, null, 2)}</pre></details>
      </> : null}
      {card.codingQuestion && card.actionable ? <QuestionForm card={card} controller={controller} /> : null}
      {card.statusText ? <p className="gate-card-status" data-raw-material={card.kind === 'coding_question' ? true : undefined}>{card.statusText}</p> : null}
      {card.readOnlyReason ? <p className="meta">{card.readOnlyReason}</p> : null}
    </>}
    {messageId ? <p className="meta">答疑里讨论过 · <button type="button" className="text-button" onClick={() => scope.actions.onFocusChatMessage?.(messageId)}>查看</button></p> : null}
  </article>
}
function QuestionForm({ card, controller }: { card: CardView; controller: BuildTestController }) {
  const scope = useDecisionPage(), { request, codingRunId, index } = card.codingQuestion!
  const key = `question:${request.id}:${request.revision}`
  const values: Array<{ selected: string[]; custom: string }> = scope.drafts[key] ? JSON.parse(scope.drafts[key]!) : request.questions.map(() => ({ selected: [], custom: '' }))
  const answers = values.map((v, i) => v.custom.trim() ? request.questions[i]!.multiple ? [...v.selected, v.custom.trim()] : [v.custom.trim()] : v.selected)
  const unanswered = answers.flatMap((a, i) => a.length ? [] : [i + 1])
  let valid = false
  try { validateCodingQuestionReply(request.questions, { kind: 'answer', answers }); valid = true } catch { /* show the unanswered questions below */ }
  return <form onSubmit={e => { e.preventDefault(); if (valid) void controller.question(codingRunId, request.id, request.revision, { kind: 'answer', answers }) }}>
    <CodingQuestionForm question={request.questions[index]!} name={`${request.id}-${index}`} selected={values[index]!.selected} custom={values[index]!.custom} disabled={!card.actionable} onChange={(selected, custom) => scope.setDraft(key, JSON.stringify(values.map((v, i) => i === index ? { selected, custom } : v)))} />
    {unanswered.length ? <p>问题 {unanswered.join('、')} 还没有回答，提交时会算作跳过。</p> : null}
    <button type="submit" className="primary-button" disabled={!valid || !card.actionable}>提交回答</button>
    <button type="button" className="text-button" disabled={!card.actionable} onClick={() => void controller.question(codingRunId, request.id, request.revision, { kind: 'dismiss' })}>跳过这些问题</button>
  </form>
}
