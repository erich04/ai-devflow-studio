/**
 * Test harness for the gate page components: a fixture rendered through `GateDecisionScope` with
 * the real `useRevisionLists` (jsdom localStorage), spied actions and the Inspector's tab and
 * reading switches. Not used by the app.
 */
import { useCallback, useMemo, useState } from 'react'
import { vi } from 'vitest'
import { resolveGatePage } from '../app/gate-decision/page'
import { listKey, REVISION_LISTS_STORAGE_KEY, type StoredRevisionList } from '../app/gate-decision/revision-list'
import { useRevisionLists } from '../app/useRevisionLists'
import { GateDecisionBar } from '../components/gate-page/GateDecisionBar'
import { GateDecisionScope, type GateActions, type GateScopeFacts } from '../components/gate-page/GateDecisionScope'
import { GateWorkspace } from '../components/gate-page/GateWorkspace'
import { policyDecision, type GateFixture } from './gate-fixtures'

export const defaultGateFacts: GateScopeFacts = {
  policy: { decision: policyDecision(), isLoading: false, enabled: true, teamBinding: true },
  permission: { roleCanApprove: true, role: 'lead' },
  runFacts: { reviewRunning: false, generationRunning: false, writeLock: false },
  generation: { executorLabel: 'Direct Provider', modelLabel: 'fake-model', modelSelected: true },
  reviewProviderLabel: 'Fake · fake-model',
}
export const gateFacts = (overrides: Partial<GateScopeFacts> = {}): GateScopeFacts => ({ ...defaultGateFacts, rawRequest: '给任务列表加搜索。\n保留状态筛选，不新增依赖。', ...overrides })
export type GateActionSpies = { [K in keyof GateActions]-?: ReturnType<typeof vi.fn> } & { showCurrentWork: ReturnType<typeof vi.fn>; showCurrentVersion: ReturnType<typeof vi.fn> }
export function gateActionSpies(): GateActionSpies {
  return {
    onRequestReview: vi.fn(), onStop: vi.fn(), onSubmit: vi.fn(), onConfirm: vi.fn(), onRegenerate: vi.fn(), onSyncTeam: vi.fn(),
    onReloadPolicy: vi.fn(), onOpenModelSettings: vi.fn(), onOpenVersion: vi.fn(), onOpenReport: vi.fn(), onDiscuss: vi.fn(),
    onFeedback: vi.fn(), onFocusChatItem: vi.fn(), renderStageSettings: vi.fn(() => <p>执行方式与模型选择</p>), onCopy: vi.fn(async () => {}),
    showCurrentWork: vi.fn(), showCurrentVersion: vi.fn(),
  }
}
/** Writes lists to `devflow-revision-lists` before the harness mounts. */
export function storeRevisionLists(lists: readonly StoredRevisionList[]) {
  localStorage.setItem(REVISION_LISTS_STORAGE_KEY, JSON.stringify({ version: 1, lists: Object.fromEntries(lists.map((list) => [listKey(list.target), list])) }))
}
export function GateHarness({ fixture, spies, facts = defaultGateFacts, nodeId, readingArtifactId, tab: initialTab = 'work', bar = true, workspace = true }: {
  fixture: GateFixture
  spies: GateActionSpies
  facts?: GateScopeFacts
  nodeId?: string
  readingArtifactId?: string
  tab?: 'work' | 'materials'
  bar?: boolean
  workspace?: boolean
}) {
  const lists = useRevisionLists()
  const [reading, setReading] = useState(readingArtifactId)
  const [tab, setTab] = useState(initialTab)
  const node = fixture.run.nodes.find((item) => item.id === (nodeId ?? fixture.gateNode.id))!
  const page = useMemo(() => resolveGatePage({ run: fixture.run, node, artifacts: fixture.artifacts, reviews: fixture.reviews, events: fixture.events,
    ...(reading ? { readingArtifactId: reading } : {}) }), [fixture, node, reading])
  const showCurrentWork = useCallback(() => { spies.showCurrentWork(); setTab('work') }, [spies])
  const showCurrentVersion = useCallback(() => { spies.showCurrentVersion(); setReading(undefined) }, [spies])
  const actions = useMemo((): GateActions => ({ ...(spies as unknown as GateActions),
    onOpenVersion: (id: string) => { spies.onOpenVersion(id); setReading(id) } }), [spies])
  if (!page) throw new Error('not a gate page')
  return <GateDecisionScope page={page} run={fixture.run} artifacts={fixture.artifacts} reviews={fixture.reviews} revisionLists={lists} facts={facts}
    actions={actions} currentWorkVisible={tab === 'work'} showCurrentWork={showCurrentWork} showCurrentVersion={showCurrentVersion}>
    {bar ? <GateDecisionBar /> : null}
    <div className="inspector-document-scroll" data-tab={tab}>{tab === 'work' && workspace ? <GateWorkspace /> : <p>材料与版本</p>}</div>
  </GateDecisionScope>
}
