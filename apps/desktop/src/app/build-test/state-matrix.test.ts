import { expect, it } from 'vitest'
import { addChange, addCoding, addReport, approve, buildTestFacts, NOW } from '../../testing/build-test-fixtures'
import { scanFirstLayerText } from '../first-layer-scan'
import type { BuildTestFacts } from './facts'
import { projectBuildTestDecision, buildTestStageLabels } from './projection'

type Scenario = { name: string; row: string; stage: 'build' | 'test'; prepare(f: BuildTestFacts): string | void }
const scenarios: Scenario[] = [
  { name: 'not started', row: 'B3', stage: 'build', prepare() {} },
  { name: 'generating', row: 'B4', stage: 'build', prepare: f => { addCoding(f) } },
  { name: 'waiting for answers', row: 'B5', stage: 'build', prepare: f => { const r = addCoding(f, { engine: 'opencode-http', status: 'waiting_input' }); r.question = { version: 1, id: 'question', revision: 'one', codingRunId: r.id, projectId: f.run.projectId, managedWorkspaceId: 'workspace', sessionId: 'session', questions: [{ header: '范围', question: '是否保留？', options: [{ label: '保留', description: '' }] }], status: 'pending', requestedAt: NOW, expiresAt: '2026-11-02T12:15:00.000Z' } } },
  { name: 'dependency approval', row: 'B6', stage: 'build', prepare: f => { const r = addCoding(f), p = addChange(f, r); delete p.changeSetId; delete p.changeSetDigest; p.origin = 'dependency_bootstrap'; p.permission = 'install' } },
  { name: 'expired tool permission', row: 'B7', stage: 'build', prepare: f => { const r = addCoding(f, { engine: 'opencode-http' }), p = addChange(f, r); delete p.changeSetId; p.status = 'expired'; r.permissionPause = { requestId: p.id, pausedAt: NOW } } },
  { name: 'pending exact change', row: 'B8', stage: 'build', prepare: f => { addChange(f, addCoding(f)) } },
  { name: 'revising', row: 'B9', stage: 'build', prepare: f => { const r = addCoding(f), p = addChange(f, r); r.status = 'running'; r.revisionInFlight = { previousRequestId: p.id, previousChangeSetId: p.changeSetId!, previousChangeSetDigest: p.changeSetDigest!, requestedAt: NOW, itemCount: 1 } } },
  { name: 'OpenCode final acceptance', row: 'B10', stage: 'build', prepare: f => { const r = addCoding(f, { engine: 'opencode-http' }), p = addChange(f, r); delete p.changeSetId; delete p.changeSetDigest; p.origin = 'change_acceptance'; p.diffArtifactId = 'diff'; p.diffSourceDigest = 'd'.repeat(64); f.codingDiffArtifacts.push({ id: 'diff', runId: f.run.id, nodeId: f.buildNode.id, projectId: f.run.projectId, changedPaths: ['src/search.ts'], patch: 'diff --git a/src/search.ts b/src/search.ts\n--- a/src/search.ts\n+++ b/src/search.ts\n@@ -1 +1 @@\n-const search = false\n+const search = true\n', sourceDigest: p.diffSourceDigest, truncated: false, redacted: true, createdAt: NOW }); addReport(f, r) } },
  ...(['cancelled', 'failed', 'timed_out', 'interrupted'] as const).map(status => ({ name: `ended ${status}`, row: 'B11', stage: 'build' as const, prepare: (f: BuildTestFacts) => { addCoding(f, { status }) } })),
  { name: 'completed build', row: 'B1', stage: 'build', prepare: f => { f.run.currentNodeId = f.testNode.id } },
  { name: 'old change', row: 'B2', stage: 'build', prepare: f => addChange(f, addCoding(f)).changeSetId! },
  { name: 'initial test', row: 'T3', stage: 'test', prepare: f => { const r = addCoding(f), p = addChange(f, r); approve(f, p); r.status = 'testing' } },
  { name: 'automatic repair', row: 'T4', stage: 'test', prepare: f => { const r = addCoding(f), p = addChange(f, r); approve(f, p); r.status = 'running'; addReport(f, r, 'failed') } },
  { name: 'pending repair', row: 'T5', stage: 'test', prepare: f => { const r = addCoding(f), p = addChange(f, r); approve(f, p); addReport(f, r, 'failed'); addChange(f, r, 'repair') } },
  { name: 'testing repair', row: 'T6', stage: 'test', prepare: f => { const r = addCoding(f), p = addChange(f, r); approve(f, p); addReport(f, r, 'failed'); approve(f, addChange(f, r, 'repair')); r.status = 'testing' } },
  { name: 'failed tests', row: 'T7', stage: 'test', prepare: f => { f.run.currentNodeId = f.testNode.id; addReport(f, undefined, 'failed') } },
  ...(['current', 'stale', 'unavailable', 'unrecorded'] as const).map(freshness => ({ name: `${freshness} evidence`, row: freshness === 'current' ? 'T8' : freshness === 'stale' ? 'T9' : 'T10', stage: 'test' as const, prepare: (f: BuildTestFacts) => { f.run.currentNodeId = f.testNode.id; const e = addReport(f, undefined); f.freshness.states = { [e.id]: freshness } } })),
  { name: 'no report', row: 'T11', stage: 'test', prepare: f => { f.run.currentNodeId = f.testNode.id } },
  { name: 'manual retest', row: 'T12', stage: 'test', prepare: f => { f.run.currentNodeId = f.testNode.id; f.writes = [{ id: 'write', action: 'runTests', target: f.run.id, startedAt: NOW }] } },
  { name: 'confirmed test', row: 'T1', stage: 'test', prepare: f => { f.run.currentNodeId = f.testNode.id; f.testNode.status = 'success'; addReport(f, undefined) } },
  { name: 'old report', row: 'T2', stage: 'test', prepare: f => { f.run.currentNodeId = f.testNode.id; return addReport(f, undefined).id } },
]

it.each(scenarios)('$name uses truthful first-layer prose and keeps unsafe decisions unavailable', ({ row, stage, prepare }) => {
  const f = buildTestFacts(), reading = prepare(f) || undefined
  const view = projectBuildTestDecision({ facts: f, stage, reading })
  expect(view.bar.row).toBe(row)
  if (row === 'B10') {
    expect(view.material.kind).toBe('change')
    expect(view.material.change?.files[0]?.rows.some(r => r.text === 'const search = true')).toBe(true)
    expect(view.identity.request?.diffSourceDigest).toBe('d'.repeat(64))
    expect(view.bar.buttons.filter(b => ['approveChange', 'rejectChange'].includes(b.id)).map(b => b.enabled)).toEqual([true, true])
    expect(view.bar.list.actionable).toBe(false)
    expect(view.margin.cards.some(c => c.kind === 'finding')).toBe(false)
  }
  const { bar, margin, material } = view
  const prose = [bar.title, bar.progress?.text, bar.meta.deadline?.text, bar.meta.freshness,
    ...bar.notes.filter(n => !n.raw?.length).map(n => n.text), ...bar.buttons.flatMap(b => [b.label, b.disabledReason, b.confirmBefore]),
    ...bar.costLines.map(c => c.text), material.header, material.banner, material.recordedAt,
    ...margin.cards.flatMap(c => [c.title, c.segments ? c.segments.filter(s => !s.raw).map(s => s.text).join('') : c.text, c.readOnlyReason]),
    ...Object.values(buildTestStageLabels(f)),
  ].filter(Boolean).join('\n')
  expect(scanFirstLayerText(prose, ['deepseek-v4-flash'])).toEqual([])
  expect(prose).not.toMatch(/\$0(?:\.0+)?(?=\s|$|[，。；）·])/u)
  if (bar.progress) expect(bar.progress.text).toMatch(/^(还剩|✓)/u)
  if (['T9', 'T10'].includes(row)) expect(bar.buttons.find(b => b.id === 'confirmEvidence')?.enabled).toBe(false)
  if (['B1', 'T1'].includes(row)) expect(bar.buttons).toEqual([])
  if (reading) expect(bar.buttons.map(b => b.id)).toEqual(['returnToCurrent'])
})

it('keeps unloaded final acceptance disabled until its exact diff arrives', () => {
  const f = buildTestFacts()
  scenarios.find(s => s.row === 'B10')!.prepare(f)
  f.codingDiffArtifacts = []
  const view = projectBuildTestDecision({ facts: f, stage: 'build' })
  expect(view.bar.buttons.filter(b => ['approveChange', 'rejectChange'].includes(b.id)).map(b => b.enabled)).toEqual([false, false])
})
