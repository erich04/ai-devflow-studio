import { useId, useMemo, useState, type ReactNode } from 'react'
import { hasSectionContent, partitionArtifact } from '../../app/artifact-sections'
import { gateCopy } from '../../app/gate-decision/copy'
import { gateGridStyle } from '../../app/gate-decision/layout'
import { useGateScope } from './GateDecisionScope'
import { HistoryList } from './HistoryList'
import { MarginColumn } from './MarginColumn'
import { MarginHeader } from './MarginHeader'
import { MaterialColumn } from './MaterialColumn'
import { useDecisionWorkspace } from './useDecisionWorkspace'

/**
 * The gate workspace (design §5.7, §5.8): material head, material column and the margin, as a
 * grid whose columns come from `gateGridStyle`. Wide or narrow is decided from the measured width
 * before the first paint, then by a `ResizeObserver`; every view state lives in the scope.
 */
export function GateWorkspace({ referenceLinks, revisionHistory }: {
  /** 原始需求 / 代码调查 / 团队规范 links for 阅读工具 (requirement). */
  referenceLinks?: ReactNode
  /** Content of 「版本与修订意见历史」. */
  revisionHistory?: ReactNode
}) {
  const scope = useGateScope()
  const { view, shown, page, kind, history } = scope
  const prefix = useId()
  const { workspaceRef, materialRef, marginRef, mode, narrow, cards, layout, markers, unlocated, onCardLink, onBlockLink, linkedIds, flashing, onBarActivate } = useDecisionWorkspace(shown.artifact.content, history)
  const [raw, setRaw] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const sections = useMemo(() => partitionArtifact(shown.artifact.content)
    .filter((section) => section.group !== 'evidence' && section.group !== 'records' && (section.group !== 'questions' || hasSectionContent(section))), [shown.artifact.content])
  const material = view.material
  const rawRequest = scope.input.rawRequest
  const versionLabel = kind === 'requirement' ? '阅读需求版本' : '阅读方案版本'
  return <div ref={workspaceRef} className="gate-workspace" data-layout={mode} style={gateGridStyle(mode)}>
    <div className="gate-margin-head">
      <MarginHeader narrow={narrow} unlocated={unlocated} />
    </div>
    <div className="gate-material-head">
      {material.readOnlyBanner ? <div className="gate-history-banner" role="status">
        <p><span>{material.readOnlyBanner}</span> <button type="button" className="text-button" onClick={scope.showCurrentVersion}>{gateCopy.returnButton(page.current.label)}</button></p>
        {material.historyList ? <HistoryList list={material.historyList} onCopy={scope.actions.onCopy} /> : null}
      </div> : null}
      <div className="gate-material-header">
        <strong>{material.header}</strong>
        <span className="meta">{material.recordedAt}</span>
        {scope.actions.onDiscuss ? <button type="button" className="text-button" onClick={() => scope.actions.onDiscuss?.({
          materialId: shown.artifact.id, materialTitle: shown.artifact.title, version: shown.label, label: shown.label,
        })}>讨论此材料</button> : null}
      </div>
      {material.rawRequest ? <p className="gate-raw-request">
        <span className="gate-raw-request-line">{material.rawRequest}</span>
        <button type="button" className="text-button" aria-expanded={requestOpen} onClick={() => setRequestOpen(!requestOpen)}>{gateCopy.expand}</button>
      </p> : null}
      {requestOpen && rawRequest ? <div className="message-plain gate-raw-request-full">{rawRequest}</div> : null}
      <details className="artifact-reading-tools" data-testid="artifact-reading-tools">
        <summary>阅读工具</summary>
        {page.versions.length > 1 ? <label>阅读版本<select aria-label={versionLabel} value={page.reading.artifact.id}
          onChange={(event) => (event.target.value === page.current.artifact.id ? scope.showCurrentVersion() : scope.actions.onOpenVersion(event.target.value))}>
          {page.versions.map((version) => <option key={version.artifact.id} value={version.artifact.id}>{version.label}</option>)}
        </select></label> : null}
        {referenceLinks}
        {!raw && sections.length > 4 ? <nav className="artifact-toc" aria-label="内容目录">
          {sections.map((section, index) => section.title ? <a key={index} href={`#${prefix}-section-${index}`}>{section.title}</a> : null)}
        </nav> : null}
        <button type="button" className="text-button message-format-toggle" onClick={() => setRaw(!raw)}>{raw ? '返回排版' : '查看原文'}</button>
      </details>
    </div>
    <MaterialColumn kind={kind} artifact={shown.artifact} blocks={shown.blocks} newBlocks={material.newBlocks} mode={mode} markers={markers} bars={material.bars}
      boxes={layout.boxes} raw={raw} materialRef={materialRef} sectionIdPrefix={prefix} onBlockLink={onBlockLink} onCardLink={onCardLink}
      onBarActivate={onBarActivate} revisionHistory={revisionHistory} />
    {narrow ? null : <MarginColumn cards={cards} tops={layout.tops} minHeight={layout.minHeight} linkedIds={linkedIds} flashing={flashing} marginRef={marginRef} onLink={onCardLink} />}
  </div>
}
