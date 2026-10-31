import { Fragment, memo, Profiler, useCallback, useMemo, type ReactNode, type RefObject } from 'react'
import type { Artifact } from '@ai-devflow/shared'
import { ConversationBody, type DecorateBlock } from '../../ConversationBody'
import { hasSectionContent, partitionArtifact, sectionTitles } from '../../app/artifact-sections'
import { gateCopy, type GateKind } from '../../app/gate-decision/copy'
import type { GateLayoutMode } from '../../app/gate-decision/layout'
import { blockKey, parseBlockKey, type BlockIndex, type BlockKey, type Range } from '../../app/gate-decision/material'
import type { BarView } from '../../app/gate-decision/projection'
import { GateMarker } from './GateMarker'
import { MaterialOverlay, type BlockBoxes } from './MaterialOverlay'
import { MaterialSection, onGateMaterialCommit } from './MaterialSection'

export { observeGateMaterialCommitsForTests } from './MaterialSection'
const headingLabel = (label: string) => sectionTitles[label] ?? label
const DESIGN_VERIFICATION_NOTE = '以下是验证计划。实际执行结果在测试步骤的「当前工作」中查看，历史证据在「材料与版本」中，计划不等于测试已通过。'

/**
 * The material column (design §5.8): the generated sections in order, the bottom disclosures and
 * the overlay. It does not read the gate scope, so hover in the workspace never re-renders it.
 */
export const MaterialColumn = memo(function MaterialColumn({ kind, artifact, blocks, newBlocks, mode, markers, bars, boxes, raw, materialRef, sectionIdPrefix,
  onBlockLink, onCardLink, onBarActivate, revisionHistory }: {
  kind: GateKind
  artifact: Artifact
  blocks: BlockIndex
  newBlocks: readonly BlockKey[]
  mode: GateLayoutMode
  /** Narrow layout: card ids per anchor block, in display order. */
  markers: Readonly<Record<string, readonly string[]>>
  bars: readonly BarView[]
  boxes: BlockBoxes
  /** 查看原文: the raw source instead of the formatted sections. */
  raw: boolean
  materialRef: RefObject<HTMLDivElement | null>
  sectionIdPrefix: string
  onBlockLink(block: Range | undefined): void
  onCardLink(cardId: string | undefined): void
  onBarActivate(cardIds: readonly string[]): void
  revisionHistory?: ReactNode
}) {
  const sections = useMemo(() => partitionArtifact(artifact.content), [artifact.content])
  const main = sections.filter((section) => section.group !== 'evidence' && section.group !== 'records' && (section.group !== 'questions' || hasSectionContent(section)))
  const sources = sections.filter((section) => (section.group === 'evidence' || section.group === 'records') && hasSectionContent(section))
  const blockSet = useMemo(() => new Set(blocks.blocks.map(blockKey)), [blocks])
  const newKey = newBlocks.join('|')
  const newSet = useMemo(() => new Set(newKey ? newKey.split('|') : []), [newKey])
  // Depends only on the content, the new blocks, the layout and the visible markers (§5.7).
  const decorate = useCallback<DecorateBlock>((start, end) => {
    const key: BlockKey = `${start}:${end}`
    if (!blockSet.has(key)) return undefined
    const ids = mode === 'narrow' ? markers[key] : undefined
    return {
      ...(newSet.has(key) ? { className: 'is-new', description: gateCopy.newContent } : {}),
      ...(ids?.length ? { after: <span className="gate-markers">{ids.map((id) => <GateMarker key={id} cardId={id} />)}</span> } : {}),
    }
  }, [blockSet, newSet, mode, markers])
  const linkFrom = (target: EventTarget | null) => {
    const element = (target as Element | null)?.closest?.('[data-block-start]')
    if (!element || !materialRef.current?.contains(element)) return onBlockLink(undefined)
    onBlockLink(parseBlockKey(`${element.getAttribute('data-block-start')}:${element.getAttribute('data-block-end')}` as BlockKey))
  }
  const firstVerification = main.findIndex((section) => section.group === 'verification')
  return <Profiler id="gate-material" onRender={onGateMaterialCommit}>
    <div ref={materialRef} className="gate-material material-document" data-testid={kind === 'requirement' ? 'clarification-current-revision' : 'design-current-material'}
      onMouseOver={(event) => linkFrom(event.target)} onMouseLeave={() => onBlockLink(undefined)} onFocus={(event) => linkFrom(event.target)}>
        {raw ? <div className="message-plain">{artifact.content}</div> : main.map((section, index) => <Fragment key={`${section.start}:${index}`}>
          {kind === 'design' && index === firstVerification ? <p className="meta">{DESIGN_VERIFICATION_NOTE}</p> : null}
          <section className="artifact-reading-section" id={`${sectionIdPrefix}-section-${index}`}>
            <MaterialSection markdown={section.markdown} start={section.start} decorate={decorate} />
          </section>
        </Fragment>)}
        {!raw && !main.length ? <p className="meta">本产物未提供此部分内容。</p> : null}
      {sources.length ? <details className="material-source"><summary>来源与执行记录</summary>
        {sources.map((section, index) => <section key={`${section.start}:${index}`}>
          <ConversationBody showFormatToggle={false} headingLabel={headingLabel} message={{ id: 'gate-source', role: 'assistant', text: section.markdown, format: 'markdown', createdAt: '' }} />
        </section>)}
      </details> : null}
      {revisionHistory ? <details className="material-source" data-testid="clarification-revision-history"><summary>版本与修订意见历史</summary>{revisionHistory}</details> : null}
      <MaterialOverlay mode={mode} boxes={boxes} newBlocks={newBlocks} bars={bars} onActivate={onBarActivate} onLink={onCardLink} />
    </div>
  </Profiler>
})
