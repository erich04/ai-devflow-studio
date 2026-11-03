import { gateCopy } from '../../app/gate-decision/copy'
import { useGateScope } from './GateDecisionScope'
import { GateMarker } from './GateMarker'

/**
 * The margin header (design §5.7, §5.9): count, merge links, 「全部采纳建议」, 「只看还没处理的」,
 * 「完整报告」 and the margin note. In the narrow layout it is the overview row above the material
 * and also holds the markers of unlocated cards.
 */
export function MarginHeader({ narrow, unlocated }: { narrow: boolean; unlocated: readonly string[] }) {
  const scope = useGateScope()
  const { header, note, cards } = scope.view.margin
  const adoptAll = () => {
    if (!header) return
    const findings = header.adoptAll.findingIndexes.flatMap((index) => {
      const finding = cards.find((card) => card.kind === 'finding' && card.finding?.index === index)?.finding
      return finding ? [{ reviewId: finding.reviewId, index: finding.index, text: finding.text, ...(finding.level ? { level: finding.level } : {}) }] : []
    })
    scope.apply({ type: 'adoptAllSuggestions', findings })
  }
  const merges = header?.merges ?? []
  const mergeButton = (merge: { text: string; cardId: string }) =>
    <button key={merge.cardId + merge.text} type="button" className="text-button" onClick={() => scope.focusCard(merge.cardId)}>{merge.text}</button>
  return <div className={`gate-margin-header${narrow ? ' is-narrow' : ''}`}>
    {header ? <>
      <strong>{header.text}</strong>
      {merges.length ? <p className="gate-margin-merges">{merges.slice(0, 2).map(mergeButton)}</p> : null}
      {header.moreText ? <details className="gate-margin-more"><summary>{header.moreText}</summary>{merges.slice(2).map(mergeButton)}</details> : null}
      <p className="gate-margin-tools">
        <button type="button" className="text-button" disabled={!header.adoptAll.enabled}
          {...(header.adoptAll.disabledReason ? { title: header.adoptAll.disabledReason, 'aria-description': header.adoptAll.disabledReason } : {})}
          onClick={adoptAll}>{gateCopy.adoptAllButton}</button>
        <button type="button" className="text-button" aria-pressed={scope.onlyUnhandled} onClick={() => scope.setOnlyUnhandled(!scope.onlyUnhandled)}>{gateCopy.onlyUnhandledButton}</button>
        <button type="button" className="text-button" onClick={scope.actions.onOpenReport}>{gateCopy.fullReportButton}</button>
      </p>
    </> : null}
    {note ? <p className="meta gate-margin-note">{note}</p> : null}
    {narrow && unlocated.length ? <p className="gate-markers gate-markers--unlocated">{unlocated.map((id) => <GateMarker key={id} cardId={id} />)}</p> : null}
  </div>
}
