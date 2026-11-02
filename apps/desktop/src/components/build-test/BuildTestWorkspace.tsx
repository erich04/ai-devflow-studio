import { BuildTestText } from './BuildTestTerms'
import { memo } from 'react'
import type { BuildTestMaterialView } from '../../app/build-test/material'
import { gateGridStyle } from '../../app/gate-decision/layout'
import { parseBlockKey, type BlockKey } from '../../app/gate-decision/material'
import { GateMarker } from '../gate-page/GateMarker'
import { MarginColumn } from '../gate-page/MarginColumn'
import { MarginHeader } from '../gate-page/MarginHeader'
import { MaterialFrame } from '../gate-page/MaterialFrame'
import { useDecisionWorkspace } from '../gate-page/useDecisionWorkspace'
export function BuildTestWorkspace({ material, reading, openVersion, showCurrent }: { material: BuildTestMaterialView; reading?: string | undefined; openVersion(id: string): void; showCurrent(): void }) {
  const layout = useDecisionWorkspace(material.signature, Boolean(reading))
  return <div ref={layout.workspaceRef} className="gate-workspace build-test-workspace" data-layout={layout.mode} style={gateGridStyle(layout.mode)}>
    <div className="gate-margin-head"><MarginHeader narrow={layout.narrow} unlocated={layout.unlocated} /></div>
    <div className="gate-material-head" data-first-layer>
      {material.banner ? <div className="gate-history-banner"><p>{material.banner} <button type="button" className="text-button" onClick={showCurrent}>返回当前材料</button></p></div> : null}
      <div className="gate-material-header"><strong>{material.header}</strong>{material.recordedAt ? <span className="meta">{material.recordedAt}</span> : null}</div>
      {material.subline ? <p className="meta"><BuildTestText text={material.subline} /></p> : null}
      {material.list.length > 1 ? <details className="artifact-reading-tools"><summary>阅读工具</summary><label>阅读版本<select aria-label="阅读改动或测试报告" value={reading ?? ''} onChange={e => e.target.value ? openVersion(e.target.value) : showCurrent()}><option value="">当前材料</option>{material.list.map(item => <option key={item.id} value={item.id}>{item.text}</option>)}</select></label></details> : null}
    </div>
    <MaterialFrame materialRef={layout.materialRef} testId="build-test-material" mode={layout.mode} boxes={layout.layout.boxes} newBlocks={material.newBlocks} bars={material.bars} onBlockLink={layout.onBlockLink} onCardLink={layout.onCardLink} onBarActivate={layout.onBarActivate}>
      <BuildTestMaterial material={material} markers={layout.markers} />
    </MaterialFrame>
    {layout.narrow ? null : <MarginColumn cards={layout.cards} tops={layout.layout.tops} minHeight={layout.layout.minHeight} linkedIds={layout.linkedIds} flashing={layout.flashing} marginRef={layout.marginRef} onLink={layout.onCardLink} />}
  </div>
}
const attributes = (key: BlockKey) => { const { start, end } = parseBlockKey(key); return { 'data-block-start': start, 'data-block-end': end } }
const BuildTestMaterial = memo(function BuildTestMaterial({ material, markers }: { material: BuildTestMaterialView; markers: Readonly<Record<string, readonly string[]>> }) {
  const mark = (key: BlockKey) => markers[key]?.length ? <span className="gate-markers">{markers[key]!.map(id => <GateMarker key={id} cardId={id} />)}</span> : null
  return <>
    {material.placeholder ? <p role="status" className="test-report-placeholder">{material.placeholder}</p> : null}
    {material.progress ? <><p><BuildTestText text={material.progress.intro} /></p><ol className="coding-progress">{material.progress.steps.map(step => <li key={step.key} {...attributes(step.key)}>{step.state === 'done' ? '✓ ' : step.state === 'paused' ? '暂停 · ' : '正在 · '}{step.text}{mark(step.key)}</li>)}</ol></> : null}
    {material.change ? <section className="change-material">
      {material.change.unverified ? <p className="gate-note gate-note--block">{material.change.unverified}</p> : null}
      {material.change.sameAsNote ? <p>{material.change.sameAsNote}</p> : null}
      {material.change.files.map(file => <section className="change-file" key={file.path}>
        <header><code data-raw-material>{file.path}</code> <span className="meta">{file.counts} 行</span></header>
        {file.note ? <p className="meta">{file.note}</p> : null}
        <div className="change-file-lines">{file.rows.map(row => <div key={row.key} {...attributes(row.key)} className={`change-row change-row--${row.kind}${row.isNew ? ' is-new' : ''}`} aria-description={row.aria || undefined}>
          <span className="change-line-number" aria-hidden="true">{row.oldLine ?? row.newLine ?? ''}</span><span className="change-line-sign" aria-hidden="true">{row.kind === 'del' ? '−' : row.kind === 'add' ? '+' : ''}</span>
          {row.kind === 'add' || row.kind === 'del' ? <code data-raw-material>{row.text || ' '}</code> : <span className="meta">{row.text}</span>}{mark(row.key)}
        </div>)}</div>
      </section>)}
    </section> : null}
    {material.reports.map(report => <section className="test-report" key={report.id}>
      <h3>{report.title}</h3><p className="meta">{report.recordedAt}</p><p>{report.result}</p>
      <dl>{report.facts.map((fact, i) => <div key={i}><dd {...(fact.raw ? { 'data-raw-material': true } : {})}><BuildTestText text={fact.text} raw={fact.raw ? [fact.text] : []} /></dd></div>)}</dl>
      {report.reusedNote ? <p className="meta">{report.reusedNote}</p> : null}
      <strong>{report.keyLinesLabel}</strong>
      <div className="test-key-lines">{report.keyLines.map(line => <div {...attributes(line.key)} key={line.key}><code data-raw-material>{line.text}</code>{mark(line.key)}</div>)}</div>
      <details><summary>{report.fullLogLabel}</summary><pre data-raw-material>{report.fullLog}</pre></details>
    </section>)}
  </>
})
