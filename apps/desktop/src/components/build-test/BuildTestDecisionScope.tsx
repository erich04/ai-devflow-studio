import { BuildTestText } from './BuildTestTerms'
import type { BuildTestChatPage } from '../../app/build-test/chat'
import { listKey } from '../../app/gate-decision/revision-list'
import type { DiscussionMaterial } from '../../app/discussion-reference'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BuildTestController } from '../../app/useBuildTestController'
import { projectBuildTestDecision } from '../../app/build-test/projection'
import { shownChangeVersion } from '../../app/build-test/versions'
import type { BuildTestDecisionView } from '../../app/build-test/material'
import { BUILD_TEST_MARGIN_ORDER, nextCardTarget } from '../../app/gate-decision/placement'
import type { ListTarget, RevisionListOp } from '../../app/gate-decision/revision-list'
import type { RevisionListsApi } from '../../app/useRevisionLists'
import { DecisionPageProvider } from '../gate-page/DecisionPageContext'
import { BuildTestCard } from './BuildTestCard'

export function BuildTestDecisionScope({ controller, stage, reading, revisionLists, showCurrent, showCurrentWork, openVersion, openReport, openSettings, onChatPage, revisionFocus, focusMessage, onDiscuss, children }: {
  onChatPage?: ((page: BuildTestChatPage | undefined) => void) | undefined; revisionFocus?: { serial: number; listKey?: string | undefined; itemId: string } | undefined; focusMessage?: ((id: string) => void) | undefined; onDiscuss?: ((material: DiscussionMaterial) => void) | undefined
  controller: BuildTestController; stage: 'build' | 'test'; reading?: string | undefined; revisionLists: RevisionListsApi
  showCurrent(): void; showCurrentWork(): void; openVersion(id: string): void; openReport(): void; openSettings(tab: 'models' | 'projects' | 'team'): void
  children(view: BuildTestDecisionView): ReactNode
}) {
  const f = controller.facts!
  const shown = shownChangeVersion(f, stage, reading)
  const target: ListTarget | undefined = shown?.record ? { kind: 'change', runId: f.run.id, codingRunId: shown.codingRunId, changeSetId: shown.id, changeSetDigest: shown.record.digest } : undefined
  const list = target ? revisionLists.listFor(target) : undefined
  const view = projectBuildTestDecision({ facts: { ...f, list }, stage, reading })
  const [armed, setArmed] = useState<string>()
  const [pendingFocus, setPendingFocus] = useState<{ serial: number; cardId: string }>()
  const [lastVisitedCardId, setLastVisitedCardId] = useState<string>()
  const [onlyUnhandled, setOnlyUnhandled] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [listExpanded, setListExpanded] = useState(false)
  const [flashItem, setFlashItem] = useState<{ itemId: string; serial: number }>()
  const identity = `${shown?.id ?? ''}:${shown?.request.status ?? ''}`
  useEffect(() => setArmed(undefined), [identity])
  useEffect(() => { onChatPage?.({ runId: f.run.id, stage, reading }); return () => onChatPage?.(undefined) }, [f.run.id, stage, reading, onChatPage])
  const serial = useRef(0)
  useEffect(() => { if (revisionFocus && target && revisionFocus.listKey === listKey(target)) { setListExpanded(true); setFlashItem({ itemId: revisionFocus.itemId, serial: revisionFocus.serial }) } }, [revisionFocus, target ? listKey(target) : ''])
  const focusCard = (cardId: string) => { showCurrentWork(); if (reading) showCurrent(); setPendingFocus({ cardId, serial: ++serial.current }) }
  const apply = (op: RevisionListOp) => target && view.bar.list.actionable ? revisionLists.apply(target, op) : { ok: false as const, message: '这份改动的修订清单当前只读。' }
  return <DecisionPageProvider value={{ renderText: (text, raw) => <BuildTestText text={text} raw={raw} />, view, apply, storageNotes: [revisionLists.droppedNotice, revisionLists.saveError].filter((x): x is string => Boolean(x)), armed, setArmed, pendingFocus, focusCard,
    clearPendingFocus: n => setPendingFocus(p => p?.serial === n ? undefined : p), lastVisitedCardId, setLastVisitedCardId,
    goNext: () => { const id = nextCardTarget(view.margin.navigationOrder, lastVisitedCardId, id => !['open', 'fixing', 'retesting'].includes(view.margin.cards.find(c => c.id === id)?.status ?? '')); if (id) focusCard(id) },
    onlyUnhandled, setOnlyUnhandled, drafts, setDraft: (key, value) => setDrafts(p => { const next = { ...p }; if (value === undefined) delete next[key]; else next[key] = value; return next }), listExpanded, setListExpanded, flashItem,
    showItem: itemId => { setListExpanded(true); setFlashItem({ itemId, serial: ++serial.current }) }, showCurrentVersion: showCurrent,
    dispatch: (button, extra) => { if (button.id === 'returnToCurrent') return showCurrent(); void controller.dispatch(button.id, view, extra).then(ok => {
      if (ok && target && ['reviseChange', 'reviseRepair'].includes(button.id)) revisionLists.apply(target, { type: 'markSubmitted', text: view.bar.list.composedText, proposals: [], itemCount: view.bar.list.count ?? 0 })
      if (ok && target && button.id === 'approveWithout') revisionLists.apply(target, { type: 'markConfirmedWithout', count: view.bar.list.count ?? 0 })
    }) },
    dispatchLink: link => { if (link.action === 'stopSelfCheck') void controller.stop('review'); else if (link.action === 'reload') controller.reload(); else if (link.action === 'openVersion') openVersion(link.artifactId); else openSettings(link.action === 'openTeamSettings' ? 'team' : link.action === 'openProjectSettings' ? 'projects' : 'models') },
    stop: target => { if (target === 'coding' || target === 'revision') void controller.stop(target) },
    renderCard: (card, props) => <BuildTestCard card={card} controller={controller} discuss={card.kind === 'finding' && onDiscuss ? () => onDiscuss({ materialId: `${shown?.id ?? ''}#${card.id}`, materialTitle: card.title, version: shown?.label ?? '当前改动', label: `${shown?.label ?? ''} · ${card.title}`, excerpt: card.text }) : undefined} {...props} />,
    markerLabel: card => { const label = card.kind === 'permission' ? `权限请求 ${card.number}` : card.kind === 'coding_question' ? `问题 ${card.number}` : card.kind === 'finding' ? `意见 ${card.number}` : card.kind === 'test_failure' ? `测试失败 ${card.number}` : '证据'; return { label, ariaLabel: card.title || label } },
    markerTone: card => ['permission', 'coding_question'].includes(card.kind) ? 'question' : card.kind === 'finding' && card.level !== 'important' ? 'suggestion' : 'important', marginOrder: BUILD_TEST_MARGIN_ORDER,
    actions: { onOpenReport: openReport, ...(focusMessage ? { onFocusChatMessage: focusMessage } : {}) },
  }}>{children(view)}</DecisionPageProvider>
}
