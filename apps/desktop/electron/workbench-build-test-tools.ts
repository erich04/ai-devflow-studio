import { buildChangeSetDiffView, numberCodingChangeVersions, redactSensitiveText, type CodingChangeSet } from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'
import type { ConversationFocus } from './workbench-conversation-contract.js'
import { readWorkbenchRepository } from './workbench-repository.js'
import { verifyCodingChangeSetDisplay } from './coding-change-set.js'
import { conversationContentPage } from './workbench-requirement-context.js'
type Store = Pick<LocalStore, 'loadState'> & Partial<Pick<LocalStore, 'listCodingChangeSets'>>

async function materials(store: Store, projectId: string, runId: string) {
  const state = await store.loadState(), run = state.runs.find(r => r.id === runId && r.projectId === projectId)
  if (!run) throw new Error('这次任务不属于当前项目。')
  const runs = state.codingRuns.filter(r => r.runId === runId && r.projectId === projectId && run.nodes.some(n => n.id === r.nodeId && n.stage === 'build')).sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
  const changes: CodingChangeSet[] = store.listCodingChangeSets ? (await Promise.all(runs.map(r => store.listCodingChangeSets!(r.id)))).flat() : []
  const requests = state.codingPermissionRequests.filter(p => runs.some(r => r.id === p.codingRunId))
  const diffs = state.codingDiffArtifacts.filter(d => d.runId === runId && d.projectId === projectId && requests.some(r => r.origin === 'change_acceptance' && r.diffArtifactId === d.id))
  return { state, run, runs, changes, requests, diffs }
}
export async function validateBuildTestRead(store: Store, projectId: string, args: Record<string, unknown>) {
  const m = await materials(store, projectId, String(args.runId))
  if (args.changeSetId !== undefined) return m.changes.some(c => c.id === args.changeSetId && c.projectId === projectId && c.changeSetDigest === args.changeSetDigest && m.requests.some(r => r.changeSetId === c.id && r.changeSetDigest === c.changeSetDigest))
  if (args.diffArtifactId !== undefined) return m.diffs.some(d => d.id === args.diffArtifactId && d.sourceDigest === args.diffSourceDigest && m.requests.some(r => r.origin === 'change_acceptance' && r.diffArtifactId === d.id && r.diffSourceDigest === d.sourceDigest))
  return true
}
export async function readBuildTestTool(store: Store, projectId: string, name: string, args: Record<string, unknown>, signal: AbortSignal) {
  const m = await materials(store, projectId, String(args.runId))
  if (name.startsWith('workspace_')) {
    const latest = m.runs.at(-1), workspace = m.state.managedCodingWorkspaces.find(w => w.id === latest?.managedWorkspaceId && w.projectId === projectId && w.codingRunId === latest?.id)
    if (!workspace) return { error: 'workspace_unavailable', reason: 'none' }
    if (workspace.deletedAt || workspace.cleanupStatus !== 'active') return { error: 'workspace_unavailable', reason: 'deleted' }
    return readWorkbenchRepository(workspace.worktreePath, { operation: name === 'workspace_list' ? 'list' : name === 'workspace_read' ? 'read' : 'search', ...(args.path === undefined ? {} : { path: String(args.path) }), ...(args.query === undefined ? {} : { query: String(args.query) }) }, signal)
  }
  if (!(await validateBuildTestRead(store, projectId, args))) return { error: 'change_identity_mismatch' }
  const versions = numberCodingChangeVersions({ codingRuns: m.runs, changeSets: m.changes, acceptanceDiffs: m.diffs, permissionRequests: m.requests })
  const change = m.changes.find(c => c.id === args.changeSetId), diff = m.diffs.find(d => d.id === args.diffArtifactId)
  if (!change && !diff) return { error: 'change_identity_mismatch' }
  const id = change?.id ?? diff!.id
  const status = m.requests.find(r => r.changeSetId === id || r.diffArtifactId === id)?.status ?? 'pending'
  if (change) {
    let files
    try { files = buildChangeSetDiffView(verifyCodingChangeSetDisplay(change)).files } catch { return { error: 'change_unverifiable' } }
    const content = JSON.stringify({ files: files.filter(f => args.path === undefined || f.path === args.path).map(f => ({ path: f.path, lines: f.rows.flatMap(r => r.kind === 'add' || r.kind === 'del' ? [`${r.kind === 'add' ? r.newLine : r.oldLine} ${r.kind === 'add' ? '+' : '-'}${r.text}`] : []) })) })
    return { changeSetId: id, label: versions.get(id)?.label, status, ...conversationContentPage(redactSensitiveText(content).value, args.offset, args.limit) }
  }
  const patch = args.path === undefined ? diff!.patch : diff!.patch.split(/(?=^diff --git )/mu).filter(section => section.split('\n')[0] === `diff --git a/${args.path} b/${args.path}`).join('')
  return { diffArtifactId: id, label: versions.get(id)?.label, status, patch: conversationContentPage(patch, args.offset, args.limit) }
}
export async function resolveConversationFocus(store: Store, projectId: string, focus?: ConversationFocus): Promise<ConversationFocus | undefined> {
  if (!focus) return undefined
  try {
    const m = await materials(store, projectId, focus.runId)
    if (!m.run.nodes.some(n => n.id === focus.nodeId && ['build', 'test'].includes(n.stage)) || !(await validateBuildTestRead(store, projectId, focus))) return undefined
    return focus
  } catch { return undefined }
}
export async function conversationViewing(store: Store, projectId: string, focus?: ConversationFocus) {
  if (!(await resolveConversationFocus(store, projectId, focus)) || !focus) return undefined
  const m = await materials(store, projectId, focus.runId)
  const label = numberCodingChangeVersions({ codingRuns: m.runs, changeSets: m.changes, acceptanceDiffs: m.diffs, permissionRequests: m.requests }).get(focus.changeSetId ?? focus.diffArtifactId ?? '')?.label
  return { runId: focus.runId, stage: m.run.nodes.find(n => n.id === focus.nodeId)?.stage, ...(label ? { changeLabel: label } : {}), note: '用户发送时正在看的步骤，只作参考' }
}
