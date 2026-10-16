import { redactSensitiveText, type CodingHarnessSnapshot, type CodingHarnessPage, type ModelCostRecord } from '@ai-devflow/shared'
import type { LocalStore } from './local-store'
import type { NativeCodingSession } from './native-coding-session'
import { CodingCandidateWorkspace, snapshotCodingTree } from './coding-candidate-workspace'
import { codingActiveMilliseconds } from './coding-activity-clock'
import { pendingCodingPermission } from './native-coding-permissions'
import type { CodingExecutionProfile } from './coding-command-runner'
import { codingRetentionPolicy } from './native-coding-retention'

export function markCodingDeliveryConflict(view: CodingHarnessSnapshot): void {
  view.status = 'delivery_conflict'
  view.controlUnavailableReason = '结算前无法确认交付内容仍与验收时一致，工作流尚未推进。原验收记录保留；请核对外部改动或不可访问的工作区，恢复已批准的内容后重新检查运行或重启应用结算，系统不会覆盖外部改动。'
}

export async function currentCodingDeliveryDigest(directory: string, excludedPaths: string[]): Promise<string | null> {
  try { return (await snapshotCodingTree(directory, excludedPaths)).digest }
  catch { return null } // Unavailable live files never erase readable historical evidence.
}

/** Historical records never need a model, API key or the project's current executor. */
export async function codingHarnessSnapshot(session: NativeCodingSession, host: {
  store: LocalStore; containerProfile?: Extract<CodingExecutionProfile, { kind: 'container' }>; runtimeUnavailableReason?: string
  costRecords?(projectId: string): Promise<ModelCostRecord[]>
}, page?: CodingHarnessPage): Promise<CodingHarnessSnapshot> {
    const binding = session.binding!
    const childSessions = await Promise.all(session.children.map(async child => { const found = await host.store.getNativeCodingSession(child.sessionId); if (!found) throw new Error('Missing delegated session'); return found }))
    const attempts = [...session.attempts, ...childSessions.flatMap(child => child.attempts)].filter(attempt => attempt.status !== 'not_sent')
    const sum = (field: 'inputTokens' | 'outputTokens') => attempts.every(attempt => typeof attempt.usage?.[field] === 'number') ? attempts.reduce((total, attempt) => total + attempt.usage![field]!, 0) : null
    const ledger = await host.costRecords?.(session.localProjectId).catch(() => undefined)
    const costs = attempts.map(attempt => ledger?.find(row => row.sourceKind === 'model_call' && row.sourceId === attempt.id)?.costUsd ?? null)
    const historyOffset = Math.min(page?.historyOffset ?? Math.max(0, session.transcript.length - 40), Math.max(0, session.transcript.length - 1))
    const messageText = (message: NativeCodingSession['transcript'][number]) => redactSensitiveText(message.role === 'assistant' ? [message.content ?? '', ...(message.tool_calls ?? []).map(call => `${call.function.name} ${call.function.arguments}`)].filter(Boolean).join('\n') : message.content).value
    const result: CodingHarnessSnapshot = { protocolVersion: 2, sessionId: session.id, codingRunId: session.codingRunId, status: session.status, version: session.version,
      objectiveVersion: session.objectiveVersion, ...(session.pauseReason ? { pauseReason: session.pauseReason } : {}), steps: session.rootStepAttempts?.length ?? session.steps, activeMilliseconds: session.parent ? session.activeMilliseconds : codingActiveMilliseconds(session.activity),
      ...(session.parent ? { parent: { codingRunId: session.parent.codingRunId, mode: session.parent.mode } } : {}),
      messages: session.transcript.slice(historyOffset, historyOffset + 40).map((message, index) => ({ id: `message-${historyOffset + index}`, role: message.role, text: messageText(message).slice(0, 16000), truncated: messageText(message).length > 16000 })),
      historyPage: { offset: historyOffset, total: session.transcript.length, previous: historyOffset > 0 ? Math.max(0, historyOffset - 40) : null, next: historyOffset + 40 < session.transcript.length ? historyOffset + 40 : null },
      limits: { maxSteps: session.limits.maxSteps, maxActiveMilliseconds: session.limits.maxActiveMilliseconds },
      acceptance: session.acceptance.map(({ id, text, sourceRef, resolution }) => ({ id, text, sourceRef, resolution })),
      ...(binding.manualValidationPlan ? { manualValidationPlan: binding.manualValidationPlan } : {}),
      ...(session.question ? { question: { id: session.question.id, text: session.question.text, options: session.question.options } } : {}),
      ...(pendingCodingPermission(session) ? { permission: { id: pendingCodingPermission(session)!.id, title: '需要额外执行授权', details: pendingCodingPermission(session)!.details } } : {}),
      execution: { testCommand: binding.context.project.testCommand, dependencyCommand: binding.dependencyPlan?.command ?? '', baseline: binding.context.workspace.baseCommitSha ?? 'unknown', ...(binding.input ? { inputDigest: binding.input.digest, dirtyPaths: binding.input.dirtyPaths } : {}), ...(session.taskBudget ? { maxTokens: session.taskBudget.maxTokens, maxCostUsd: session.taskBudget.maxCostUsd } : {}), profiles: [
        { kind: 'trusted_local', available: true, reason: '在独立候选/验证目录中以当前用户权限执行，非操作系统沙箱。' },
        { kind: 'container', available: Boolean(host.containerProfile), reason: host.containerProfile ? '使用已配置且固定镜像摘要的容器，启动前检查镜像。' : '尚未配置受管容器镜像。' },
      ] },
      evidence: session.deliveryEvidence.map(item => ({ id: item.id, status: item.status, summary: item.error ?? item.status })),
      cost: { inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), costUsd: costs.every(cost => cost !== null) ? costs.reduce<number>((sum, cost) => sum + cost!, 0) : null,
        knownCostUsd: costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0), unknownCostCount: costs.filter(cost => cost === null).length,
        unknownAttempts: attempts.filter(attempt => !attempt.usage || attempt.status === 'unknown' || attempt.status === 'started').length,
        pendingSettlements: attempts.filter(attempt => attempt.usage?.settlementStatus === 'pending').length }, children: childSessions.map(child => ({ id: child.codingRunId, title: session.children.find(entry => entry.codingRunId === child.codingRunId)!.title, status: child.status })) }
    const setDetail = (text: string) => { const detail = page!.detail!; const offset = Math.min(detail.offset, text.length); result.detail = { ...detail, offset, text: text.slice(offset, offset + 16000), total: text.length, previous: offset > 0 ? Math.max(0, offset - 16000) : null, next: offset + 16000 < text.length ? offset + 16000 : null } }
    if (page?.detail?.kind === 'message') { const message = session.transcript[Number(page.detail.id.slice(8))]; if (!message) throw new Error('Message not found'); setDetail(messageText(message)) }
    const revision = session.revisions.filter(revision => revision.objectiveVersion === session.objectiveVersion).at(-1)
    if (revision) {
      const workspace = await CodingCandidateWorkspace.open(binding.workspaceRoot)
      const renames = revision.renames ?? [], operations = revision.operations.filter(operation => !renames.some(rename => rename.sourcePath === operation.path && operation.kind === 'delete'))
      const offset = Math.min(page?.revisionOffset ?? 0, Math.max(0, operations.length - 1))
      result.revisionPage = { offset, total: operations.length, previous: offset ? Math.max(0, offset - 30) : null, next: offset + 30 < operations.length ? offset + 30 : null }
      result.revision = { id: revision.id, digest: revision.digest, summary: revision.summary, files: await Promise.all(operations.slice(offset, offset + 30).map(async operation => {
        const rename = renames.find(rename => rename.path === operation.path), beforeHash = rename?.hash ?? operation.before?.hash
        const before = beforeHash ? await workspace.blob(beforeHash) : Buffer.alloc(0), after = operation.after ? await workspace.blob(operation.after.hash) : Buffer.alloc(0)
        const binary = before.includes(0) || after.includes(0)
        const text = binary ? `二进制：${before.length} → ${after.length} 字节` : redactSensitiveText(`--- ${operation.path}\n${before.toString().split('\n').map(line => `-${line}`).join('\n')}\n+++ ${operation.path}\n${after.toString().split('\n').map(line => `+${line}`).join('\n')}`).value
        if (page?.detail?.kind === 'diff' && page.detail.id === operation.path) { if (page.detail.revisionDigest !== revision.digest) throw new Error('Revision changed'); setDetail(text) }
        return { path: operation.path, kind: rename ? 'rename' : operation.kind, ...(rename ? { sourcePath: rename.sourcePath } : {}), beforeHash: beforeHash ?? null, afterHash: operation.after?.hash ?? null, binary,
          diff: text.slice(0, 64000), truncated: text.length > 64000 }
      })) }
    }
    if (page?.detail && !result.detail) throw new Error('Content not in selected revision page')
    const codingRun = (await host.store.listCodingAgentRuns()).find(run => run.id === (session.parent?.codingRunId ?? session.codingRunId))
    const pendingSettlement = Boolean(codingRun && !['completed', 'cancelled', 'failed', 'timed_out'].includes(codingRun.status))
    const accepted = session.deliveryEvidence.at(-1)
    if (!session.parent && session.status === 'completed' && revision && accepted) {
      const currentDigest = await currentCodingDeliveryDigest(binding.context.workspace.worktreePath, revision.base.excludedPaths)
      if (currentDigest !== accepted.targetDigest) {
        result.evidence.push({ id: `${accepted.id}-historical`, status: currentDigest === null ? 'historical_content_unavailable' : 'historical_content_changed', summary: '当前交付内容已变化或无法读取；原验收仅作为历史证据，不能据此推进当前工作流。' })
        if (pendingSettlement) markCodingDeliveryConflict(result)
      }
    }
    if (pendingSettlement && host.runtimeUnavailableReason) {
      result.controlUnavailableReason = [result.controlUnavailableReason, host.runtimeUnavailableReason].filter(Boolean).join('\n')
      if (result.status !== 'delivery_conflict') result.status = 'paused'
    }
    const uncertain = [...session.attempts.filter(item => ['started', 'unknown'].includes(item.status)).map(item => ({ id: item.id, kind: '模型请求', status: item.status })), ...session.toolReceipts.filter(item => item.status !== 'completed').map(item => ({ id: item.id, kind: item.name, status: item.status }))]
    result.diagnostics = { checkpoint: session.version, objectiveVersion: session.objectiveVersion, writerActive: Boolean(session.writer), uncertainOperations: uncertain.slice(0, 50), uncertainTotal: uncertain.length, profile: binding.profile.kind }
    result.storage = codingRetentionPolicy(session, childSessions, ledger)
    return result
}
