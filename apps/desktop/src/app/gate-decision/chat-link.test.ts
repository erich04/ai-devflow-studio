import { describe, expect, it } from 'vitest'
import type { Artifact } from '@ai-devflow/shared'
import { buildF1, buildF3, nodeIdsOf } from '../../testing/gate-fixtures'
import { draftMaterialVersion, revisionLinkForDraft, type ChatDraft, type ChatPageFacts } from './chat-link'
import { applyRevisionListOp, deriveChatItems, emptyRevisionList, numberItems, type StoredRevisionList } from './revision-list'
const ids = nodeIdsOf()
const digest = 'a'.repeat(64)
const proposal = (id: string, nodeId: string, updatedAt = '2026-10-30T08:30:00.000Z'): Artifact =>
  ({ id: `conversation-proposal-${id}`, runId: 'gate-run', nodeId, kind: 'log', title: '答疑提案', summary: '', content: '正文', redacted: true, updatedAt })
const message = { id: 'm1', createdAt: '2026-10-30T08:29:00.000Z' }
async function setup(extra: Artifact[] = []) {
  const f1 = await buildF1()
  const artifacts = [...f1.artifacts, ...extra]
  const list = emptyRevisionList({ kind: 'requirement', runId: 'gate-run', artifactId: f1.current.id, revision: 1, revisionDigest: f1.current.clarificationRevision!.revisionDigest }, '2026-10-30T09:00:00.000Z')
  const facts = (overrides: Partial<ChatPageFacts> = {}, current: StoredRevisionList = list): ChatPageFacts => {
    const chat = deriveChatItems({ kind: 'requirement', runId: 'gate-run', agentNodeId: ids.clarify, gateNodeId: ids.clarifyGate, artifacts, list: current, otherLists: [] })
    return { mode: 'current', current: { artifactId: f1.current.id, number: 1 }, generationRunning: false, listActionable: true, listKey: 'key',
      items: numberItems(current.items, chat), lists: [current], ...overrides }
  }
  const link = (draft: Partial<ChatDraft>, pageFacts: ChatPageFacts | undefined = facts(), linkArtifacts = artifacts, at = message) => revisionLinkForDraft({
    draft: { runId: 'gate-run', nodeId: ids.clarify, ...draft }, message: at, runs: [f1.run], artifacts: linkArtifacts, pageFacts: () => pageFacts })
  return { f1, artifacts, list, facts, link }
}
describe('revisionLinkForDraft (rows in order)', () => {
  it('offers nothing outside the clarify and design stages or before the stage has a version', async () => {
    const { f1, link } = await setup()
    const build = f1.run.nodes.find((node) => node.stage === 'build')!
    expect(link({ nodeId: build.id })).toEqual({ state: 'none' })
    expect(link({}, undefined, f1.artifacts.filter((artifact) => artifact.kind !== 'clarification'))).toEqual({ state: 'none' })
  })
  it('row 1 written and row 2 submitted come from the records', async () => {
    const saved = proposal('p', ids.clarify)
    const f3 = await buildF3()
    const identity = { artifactId: saved.id, updatedAt: saved.updatedAt, contentDigest: digest }
    const written = f3.artifacts.map((artifact) => artifact.id === f3.current.id ? { ...artifact, clarificationRevision: { ...artifact.clarificationRevision!, inputProposals: [identity] } } : artifact)
    const { link, facts } = await setup()
    expect(link({ publishedArtifactId: saved.id }, facts(), [...written, saved])).toEqual({ state: 'written', text: '已写进需求 v2' })
    const submitted = f3.artifacts.map((artifact) => artifact.kind === 'clarification_feedback' ? { ...artifact, clarificationFeedback: { ...artifact.clarificationFeedback!, proposals: [identity] } } : artifact)
    expect(link({ publishedArtifactId: saved.id }, facts({ mode: 'revision-pending' }), [...submitted, saved]))
      .toEqual({ state: 'submitted', text: '已随需求 v1 的修订请求提交，生成需求 v2 后会写进新版本。' })
  })
  it('row 3 disables the whole stage when finished, generating, revision-pending or stale', async () => {
    const { link, facts } = await setup()
    expect(link({}, facts({ mode: 'finished' }))).toMatchObject({ state: 'disabled', reason: '需求 v1 已确认，答疑建议不能再加入修订清单。' })
    expect(link({}, facts({ generationRunning: true }))).toMatchObject({ state: 'disabled', reason: '正在生成需求 v2，完成后可以加入新版本的修订清单。' })
    expect(link({}, facts({ mode: 'revision-pending' }))).toMatchObject({ state: 'disabled', reason: '需求 v1 的修订请求已提交，生成需求 v2 后可以加入新版本的修订清单。' })
    expect(link({ review: { status: 'stale' } })).toMatchObject({ state: 'disabled', reason: '原始需求或材料已更新，请重新生成提案后再保存。' })
  })
  it('row 4 added wins over the list and version checks', async () => {
    const saved = proposal('p', ids.clarifyGate)
    const { link, facts } = await setup([saved])
    // Not actionable and the draft message predates v1, yet the proposal is in the list: it shows its real status.
    expect(link({ publishedArtifactId: saved.id }, facts({ listActionable: false }), undefined, { id: 'm0', createdAt: '2026-10-30T08:00:00.000Z' })).toEqual({ state: 'added', text: '已加入修订清单（第 1 项）', itemId: `chat-${saved.id}`, number: 1, listKey: 'key' })
  })
  it('row 5 disables adding when the list is read-only or the draft targets another version', async () => {
    const { link, facts } = await setup()
    expect(link({}, facts({ listActionable: false }))).toMatchObject({ state: 'disabled', reason: '需要先审查需求 v1，审查后才能加入修订清单。' })
    expect(link({}, facts({ listActionable: false, listReadOnlyReason: '审查期间不能处理' }))).toMatchObject({ reason: '审查期间不能处理' })
    // A legacy or gate-node draft gets its version from the message time: earlier than v1 here.
    expect(link({ nodeId: ids.clarifyGate }, facts(), undefined, { id: 'm0', createdAt: '2026-10-30T08:00:00.000Z' })).toMatchObject({ state: 'disabled', reason: '这条建议早于需求 v1，请在答疑里针对需求 v1 重新生成。' })
    const f3 = await buildF3()
    const late = { id: 'm2', createdAt: '2026-10-30T08:10:00.000Z' }
    expect(revisionLinkForDraft({ draft: { runId: 'gate-run', nodeId: ids.clarify }, message: late, runs: [f3.run], artifacts: f3.artifacts,
      pageFacts: () => facts({ current: { artifactId: f3.current.id, number: 2 } }) })).toMatchObject({ state: 'disabled', reason: '这条建议基于需求 v1，当前是需求 v2；请在答疑里重新生成。' })
  })
  it('a native agent-node draft uses its receipt\'s formal document', async () => {
    const f3 = await buildF3()
    const draft: ChatDraft = { runId: 'gate-run', nodeId: ids.clarify, inputReceipt: { documents: [{ id: 'artifact-gate-run-raw-request' }, { id: f3.current.id }] } }
    expect(draftMaterialVersion({ kind: 'requirement', draft, message: { id: 'm', createdAt: '2000-01-01T00:00:00.000Z' }, artifacts: f3.artifacts })?.id).toBe(f3.current.id)
    expect(draftMaterialVersion({ kind: 'requirement', draft: { runId: 'gate-run', nodeId: ids.clarify }, message: { id: 'm', createdAt: '2026-10-30T08:10:00.000Z' }, artifacts: f3.artifacts })?.id).toBe(f3.previous!.id)
  })
  it('rows 6–8: re-add a removed proposal, say when an old generation may have used it, else add', async () => {
    const saved = proposal('p', ids.clarify, '2026-10-30T08:30:00.000Z')
    const { link, facts, list, f1 } = await setup([saved])
    const removed = applyRevisionListOp(list, { type: 'chatRemove', proposalId: saved.id }, '2026-10-30T09:01:00.000Z')
    if (!removed.ok) throw new Error(removed.message)
    const v1Message = { id: 'm', createdAt: '2026-10-30T08:31:00.000Z' }
    const readd = revisionLinkForDraft({ draft: { runId: 'gate-run', nodeId: ids.clarify, publishedArtifactId: saved.id }, message: v1Message, runs: [f1.run],
      artifacts: [...f1.artifacts, saved], pageFacts: () => facts({}, removed.list) })
    expect(readd).toEqual({ state: 'readd', label: '加入修订清单', proposalId: saved.id, listKey: 'key' })
    // A revision without inputProposals that started after the proposal was saved.
    const legacy = [...f1.artifacts.map((artifact) => artifact.id === f1.current.id
      ? { ...artifact, clarificationRevision: { ...artifact.clarificationRevision!, inputProposals: undefined, executor: { ...artifact.clarificationRevision!.executor, startedAt: '2026-10-30T09:00:00.000Z' } } } as unknown as Artifact : artifact), saved]
    expect(link({ publishedArtifactId: saved.id }, { ...facts(), items: [] }, legacy)).toEqual({ state: 'saved', text: '提案已保存；旧版本没有记录它是否写进了需求。' })
    expect(revisionLinkForDraft({ draft: { runId: 'gate-run', nodeId: ids.clarify }, message: v1Message, runs: [f1.run], artifacts: f1.artifacts, pageFacts: () => facts() }))
      .toEqual({ state: 'add', label: '加入修订清单', preview: '将作为「来自答疑」加入需求 v1 的修订清单。会保存为讨论提案；不会修改需求，也不会推进流程。' })
  })
})
