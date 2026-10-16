// @vitest-environment node
import { access, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import type { ModelCostRecord } from '@ai-devflow/shared'
import { codingHarnessFixture, codingToolReply } from './native-coding-test-fixture'
import { cleanupCodingScratch, cleanupNativeCodingSession } from './native-coding-retention'
import { codingHarnessSnapshot } from './native-coding-projection'

it('retains review and unbilled work, then cleans only reconstructible terminal scratch', async () => {
  const fixture = await codingHarnessFixture(async () => codingToolReply('freeze', 'propose_changeset', { summary: 'No changes required' }))
  try {
    await fixture.authorize(); await fixture.executor.settled('coding')
    let session = (await fixture.store.getNativeCodingSession('native-coding'))!
    await expect(cleanupCodingScratch(session, [])).rejects.toThrow(/待审批/)
    const review = (await fixture.get()).snapshot
    await fixture.executor.harness!.command({ protocolVersion: 2, type: 'approve', codingRunId: 'coding', commandId: 'review', expectedVersion: review.version, objectiveVersion: review.objectiveVersion, revisionDigest: review.revision!.digest }, async () => {})
    session = (await fixture.store.getNativeCodingSession('native-coding'))!
    await expect(cleanupCodingScratch(session, [])).rejects.toThrow(/费用未确认/)
    const ledger: ModelCostRecord[] = session.attempts.map(attempt => ({ projectId: session.localProjectId, sourceKind: 'model_call', sourceId: attempt.id, originalUserId: 'user', model: session.model, providerId: session.providerId, createdAt: attempt.createdAt, version: 'v1', originalState: 'known', originalCostUsd: 0.01, costUsd: 0.01, budgetCostUsd: 0.01, usageKnown: true, isReservation: false, status: 'settled', affectsCurrentBudget: true, canReconcile: false, events: [], unresolvedConflictIds: [] }))
    const command = { protocolVersion: 2 as const, type: 'cleanup_scratch' as const, codingRunId: 'coding', commandId: 'clean-once', expectedVersion: session.version }
    const [first, repeated] = await Promise.all([cleanupNativeCodingSession(fixture.store, command, async () => ledger), cleanupNativeCodingSession(fixture.store, command, async () => ledger)])
    expect(first.version).toBe(repeated.version)
    expect(repeated.commands.filter(item => item.id === command.commandId)).toHaveLength(1)
    await expect(access(path.join(session.binding!.workspaceRoot, 'candidate'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toContain('value = 1')
    const history = await codingHarnessSnapshot(session, { store: fixture.store })
    expect(history.revision!.digest).toBe(review.revision!.digest)
    expect(history.evidence[0]!.status).toBe('verified_no_change')
    await cleanupCodingScratch(session, [], ledger)
    await expect(cleanupNativeCodingSession(fixture.store, { ...command, expectedVersion: command.expectedVersion + 1 }, async () => ledger)).rejects.toThrow(/Conflicting/)
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})
