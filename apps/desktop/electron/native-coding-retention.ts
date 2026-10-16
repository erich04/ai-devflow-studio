import { lstat, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { atomicCodingFile, codingDigest, CodingCandidateWorkspace } from './coding-candidate-workspace'
import { mutateNativeCodingSession, type NativeCodingSession } from './native-coding-session'
import type { CodingHarnessCommand, ModelCostRecord } from '@ai-devflow/shared'
import type { LocalStore } from './local-store'

const cleanupQueues = new WeakMap<LocalStore, Map<string, Promise<NativeCodingSession>>>()
/** Same command identity remains a replay even after cleanup advanced the checkpoint. */
export function cleanupNativeCodingSession(store: LocalStore, command: Extract<CodingHarnessCommand, { type: 'cleanup_scratch' }>, costRecords: (projectId: string) => Promise<ModelCostRecord[]>): Promise<NativeCodingSession> {
  let queues = cleanupQueues.get(store)
  if (!queues) { queues = new Map(); cleanupQueues.set(store, queues) }
  const queue = queues, id = `native-${command.codingRunId}`, fingerprint = codingDigest(JSON.stringify(command))
  const next = (queue.get(id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const session = await store.getNativeCodingSession(id)
    if (!session) throw new Error('Native v3 session not found')
    const replay = session.commands.find(item => item.id === command.commandId)
    if (replay) { if (replay.digest !== fingerprint) throw new Error('Conflicting coding command'); return session }
    if (session.version !== command.expectedVersion) throw new Error('任务已更新，请刷新后重试。')
    const children = await Promise.all(session.children.map(async child => { const found = await store.getNativeCodingSession(child.sessionId); if (!found) throw new Error('Missing child record'); return found }))
    await cleanupCodingScratch(session, children, await costRecords(session.localProjectId))
    return mutateNativeCodingSession(store, id, draft => {
      if (draft.version !== session.version) throw new Error('任务已更新；清理收据已保留，请刷新后重试。')
      draft.commands.push({ id: command.commandId, digest: fingerprint })
    })
  })
  queue.set(id, next)
  void next.finally(() => { if (queue.get(id) === next) queue.delete(id) }).catch(() => undefined)
  return next
}

export function codingRetentionPolicy(root: NativeCodingSession, children: NativeCodingSession[], ledger?: ModelCostRecord[]) {
  const sessions = [root, ...children]
  const blocked = root.parent || !['completed', 'cancelled', 'failed'].includes(root.status) || root.children.some(child => child.state === 'active' && !children.some(session => session.id === child.sessionId && ['completed', 'cancelled', 'failed'].includes(session.status))) || sessions.some(session => session.writer || session.activity.some(interval => interval.endedAt === undefined))
  if (blocked) return { cleanupAllowed: false, reason: '活跃、待审批或待恢复的任务保留全部资料。' }
  if (sessions.flatMap(session => session.attempts).filter(attempt => attempt.status !== 'not_sent').some(attempt => attempt.status !== 'completed' || !ledger?.some(row => row.sourceKind === 'model_call' && row.sourceId === attempt.id && row.status === 'settled' && row.usageKnown && row.costUsd !== null))) return { cleanupAllowed: false, reason: '存在用量未知或费用未确认的调用，暂不清理工作副本。' }
  return { cleanupAllowed: true, reason: '仅清理候选与验证工作副本及其依赖。保留文件内容、修订、对话、命令日志和事务证据；终态任务不能继续执行。' }
}

/** Only host-owned, terminal scratch directories are removed; evidence and D are retained. */
export async function cleanupCodingScratch(root: NativeCodingSession, children: NativeCodingSession[], ledger?: ModelCostRecord[]): Promise<void> {
  const policy = codingRetentionPolicy(root, children, ledger)
  if (!policy.cleanupAllowed) throw new Error(policy.reason)
  for (const session of [root, ...children]) {
    if (!session.binding?.executionGranted) continue
    const workspace = await CodingCandidateWorkspace.open(session.binding.workspaceRoot)
    const receipt = path.join(workspace.root, 'scratch-retention.json')
    try {
      const previous = JSON.parse(await readFile(receipt, 'utf8')) as { schemaVersion: number; sessionId: string }
      if (previous.schemaVersion !== 1 || previous.sessionId !== session.id) throw new Error('Invalid retention receipt')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // Preserve even unfinished product edits before deleting a cancelled C.
      const candidate = await workspace.capture()
      await atomicCodingFile(receipt, Buffer.from(JSON.stringify({ schemaVersion: 1, sessionId: session.id, candidate, createdAt: new Date().toISOString() })))
    }
    for (const name of (await readdir(workspace.root)).filter(name => name === 'candidate' || /^verify-[a-f0-9]{64}$/u.test(name))) {
      const directory = path.join(workspace.root, name), stat = await lstat(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unexpected scratch directory type')
      await rm(directory, { recursive: true, force: true })
    }
  }
}
