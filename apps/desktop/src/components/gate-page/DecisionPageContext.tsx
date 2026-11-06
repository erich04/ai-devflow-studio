import { createContext, useContext, type ReactNode } from 'react'
import type { CardView, CostLineLink, GateButton, GateDecisionView, NoteLink } from '../../app/gate-decision/projection'
import type { MarginOrder } from '../../app/gate-decision/placement'
import type { GateScopeValue } from './GateDecisionScope'
import type { CardLinkProps } from './FindingCard'

export type DecisionPageValue = Pick<GateScopeValue, 'apply' | 'storageNotes' | 'armed' | 'setArmed' | 'pendingFocus' | 'focusCard' | 'clearPendingFocus' | 'lastVisitedCardId' | 'setLastVisitedCardId' | 'goNext' | 'onlyUnhandled' | 'setOnlyUnhandled' | 'drafts' | 'setDraft' | 'listExpanded' | 'setListExpanded' | 'flashItem' | 'showItem' | 'showCurrentVersion'> & {
  view: Omit<GateDecisionView, 'material'>
  dispatch(button: GateButton, extra?: { reason?: string }): void
  dispatchLink(link: NoteLink | CostLineLink): void
  stop(target: NonNullable<GateDecisionView['bar']['stop']>['target']): void
  renderCard(card: CardView, props: CardLinkProps): ReactNode
  markerLabel(card: CardView): { label: string; ariaLabel: string }
  markerTone(card: CardView): string
  renderText?: (text: string, raw?: readonly string[]) => ReactNode
  marginOrder: MarginOrder
  actions: Pick<GateScopeValue['actions'], 'onOpenReport' | 'onCopy' | 'onFocusChatItem' | 'renderStageSettings'> & { onFocusChatMessage?: (id: string) => void }
}
const Context = createContext<DecisionPageValue | null>(null)
export const DecisionPageProvider = Context.Provider
export function useDecisionPage(): DecisionPageValue {
  const value = useContext(Context)
  if (!value) throw new Error('Decision page is not mounted')
  return value
}
