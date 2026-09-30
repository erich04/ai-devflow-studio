/** Explicitly invoked, paid-provider acceptance. Never runs in default CI. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import { createOpenAiCompatibleAgentProvider, createRemoteCodingAgentSummary, type AgentProvider, type LocalProject, type WorkflowRun } from '../packages/shared/src/index.ts'
import { createLocalStore } from '../apps/desktop/electron/local-store.js'
import { createCodingRuntime } from '../apps/desktop/electron/coding-runtime.js'
import { createNativeCodingExecutorV2, createAgentProviderNativeCodingV2DecisionProvider } from '../apps/desktop/electron/native-coding-executor-v2.js'
import { createDesktopAgentRuntime } from '../apps/desktop/electron/agent-runtime-runtime.js'
import { createAgentMemoryHumanActions } from '../apps/desktop/electron/agent-memory-human-actions.js'
import { evaluateCurrentWorkflowEvidence } from '../apps/desktop/electron/workflow-evaluation.js'
import { runLocalTestCommand } from '../apps/desktop/electron/test-runner.js'

export { createOpenAiCompatibleAgentProvider }
const exec = promisify(execFile)

type LiveProviderCallObservation = {
  phase: string
  containsMemory: boolean
  containsInstruction: boolean
  chars: number
  systemPromptDigest: string
  systemPromptChars: number
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheMissTokens?: number; cacheStatus?: string }
}

type CacheTotals = { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheMissTokens: number; cacheHitRate: number | null; completeCacheReports: boolean }

/** Provider-reported prompt cache use; cacheHitRate matches the runtime cost summary definition. */
export function summarizePromptCache(calls: readonly LiveProviderCallObservation[]): CacheTotals {
  const totals = calls.reduce((sum, call) => ({
    inputTokens: sum.inputTokens + (call.usage?.inputTokens ?? 0),
    outputTokens: sum.outputTokens + (call.usage?.outputTokens ?? 0),
    cacheReadTokens: sum.cacheReadTokens + (call.usage?.cacheReadTokens ?? 0),
    cacheMissTokens: sum.cacheMissTokens + (call.usage?.cacheMissTokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheMissTokens: 0 })
  const completeCacheReports = calls.length > 0 && calls.every((call) => call.usage?.cacheStatus === 'complete')
  return {
    calls: calls.length, ...totals,
    cacheHitRate: completeCacheReports && totals.inputTokens > 0 ? totals.cacheReadTokens / totals.inputTokens : null,
    completeCacheReports,
  }
}

export async function runMemoryContextLiveSmoke(input: { provider: AgentProvider; outputDirectory: string }) {
  const output = path.resolve(input.outputDirectory)
  await mkdir(path.dirname(output), { recursive: true })
  // Refuse to overwrite an earlier report or a user-owned repository.
  await mkdir(output)
  const repository = path.join(output, 'repository')
  await mkdir(path.join(repository, 'src'), { recursive: true })
  const original = 'export const greeting = "Old greeting";\n'
  await writeFile(path.join(repository, 'src/greeting.js'), original)
  await writeFile(path.join(repository, 'package.json'), JSON.stringify({ name: 'memory-context-live', version: '1.0.0', type: 'module', scripts: { test: 'node --test test.mjs' } }))
  await writeFile(path.join(repository, 'test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greeting } from './src/greeting.js';\ntest('greeting remains a nonempty string', () => { assert.equal(typeof greeting, 'string'); assert.ok(greeting.length > 0); });\ntest('greeting stays on one line', () => assert.ok(!greeting.includes('\\n')));\n")
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'DevFlow Live QA'], ['config', 'user.email', 'live-qa@example.invalid'], ['add', '.'], ['commit', '-m', 'Isolated memory validation fixture']]) {
    await exec('git', ['-C', repository, ...args])
  }
  const store = await createLocalStore({ dbPath: path.join(output, 'devflow.sqlite') })
  const now = () => new Date().toISOString()
  const project: LocalProject = { id: 'memory-live-project', name: 'Memory live acceptance', path: repository, packageManager: 'npm', detectedTestCommand: 'npm test', testCommand: 'npm test', createdAt: now(), updatedAt: now() }
  await store.upsertProject(project)
  const expectedMemoryGreeting = 'Welcome to the remembered workspace'
  const memoryStatement = `Project greeting preference: use exactly "${expectedMemoryGreeting}" as the greeting in src/greeting.js. Preserve its export name.`
  const request = 'Update only the greeting string in src/greeting.js. Use the exact project greeting wording in recalled Memory when available; otherwise use exactly "Standard greeting". Preserve all other bytes, including the export name and tests.'
  const observations: LiveProviderCallObservation[] = []
  const wrapped: AgentProvider = {
    ...input.provider,
    completeStructuredJson: async (call) => {
      // Native v2 shares one system prompt across phases; the user JSON names the phase.
      const payload = JSON.parse(call.userPrompt) as { brief?: string; phase?: string }
      const observation: LiveProviderCallObservation = {
        phase: payload.phase ?? 'unknown',
        containsMemory: payload.brief?.includes(expectedMemoryGreeting) ?? false,
        containsInstruction: payload.brief?.includes(request) ?? false,
        chars: call.userPrompt.length,
        // Digests only: shows whether calls shared a system prompt without storing prompts.
        systemPromptDigest: createHash('sha256').update(call.systemPrompt).digest('hex').slice(0, 16),
        systemPromptChars: call.systemPrompt.length,
      }
      observations.push(observation)
      const result = await input.provider.completeStructuredJson!(call)
      if (result.usage) {
        const { inputTokens, outputTokens, cacheReadTokens, cacheMissTokens, cacheStatus } = result.usage
        observation.usage = {
          ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}),
          ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}), ...(cacheMissTokens !== undefined ? { cacheMissTokens } : {}),
          ...(cacheStatus !== undefined ? { cacheStatus } : {}),
        }
      }
      return result
    },
  }
  const executor = createNativeCodingExecutorV2({ store, decisionProvider: createAgentProviderNativeCodingV2DecisionProvider(wrapped), configVersion: 1 })
  const coding = createCodingRuntime({
    store, executor, worktreeRoot: path.join(output, 'worktrees'), runTestCommand: runLocalTestCommand,
    budgetGuard: async () => ({ status: 'allowed', blocksRun: false, currentSpendUsd: 0, projectedCostUsd: 0.02, limitUsd: 0.20, reason: 'Explicit bounded live acceptance budget.' }),
  })
  const results: Record<string, unknown>[] = []
  async function executeCase(label: string, expected: string) {
    const id = `memory-live-${label}`
    const run: WorkflowRun = {
      id, version: 1, title: `Memory comparison ${label}`, request, projectId: project.id, creatorId: 'live-qa-owner',
      status: 'building', currentNodeId: `${id}-build`, branchName: `devflow/${label}`, createdAt: now(), updatedAt: now(),
      nodes: [
        { id: `${id}-design`, stage: 'design', title: 'Fixture acceptance plan', subtitle: 'A supplied test plan', kind: 'task', status: 'success', ownerId: 'live-qa-owner', retryCount: 0, artifactIds: [`${id}-design-artifact`] },
        { id: `${id}-build`, stage: 'build', title: 'Update greeting', subtitle: 'Preserve public export', kind: 'task', status: 'running', ownerId: 'live-qa-owner', retryCount: 0, artifactIds: [] },
      ], edges: [],
    }
    await store.saveRun(run)
    await store.saveArtifact({ id: `${id}-design-artifact`, runId: id, nodeId: `${id}-design`, kind: 'design', title: 'Supplied live acceptance context', summary: 'Change the greeting string only.', content: `${'Historical fixture note: this project exposes a greeting.\n'.repeat(1600)}Acceptance: preserve the greeting export and all tests.`, redacted: true, updatedAt: now() })
    const callsBefore = observations.length
    const waiting = await coding.runCodingAgent({ runId: id, nodeId: run.currentNodeId, projectId: project.id, requestedBy: run.creatorId, userInstruction: request })
    assert.equal(waiting.codingRun.status, 'waiting_permission')
    assert.equal(waiting.codingRun.contextReceipt?.compaction.compacted, true)
    const permission = (await store.listCodingPermissionRequests(waiting.codingRun.id)).find((item) => item.status === 'pending' && item.origin === 'coding_executor')
    assert.ok(permission)
    const [changeSet] = await store.listCodingChangeSets(waiting.codingRun.id)
    assert.ok(changeSet)
    assert.deepEqual(changeSet.changes.map((change) => change.path), ['src/greeting.js'])
    await coding.replyCodingPermission({ requestId: permission.id, codingRunId: permission.codingRunId, decidedBy: run.creatorId, decision: 'approved', comment: 'Accept the exact isolated fixture Change Set for the authorized live test.' })
    const completed = (await store.listCodingAgentRuns(id))[0]!
    assert.equal(completed.status, 'completed')
    const recordedEvaluation = (await store.listCodingAgentEvents(completed.id))
      .find((event) => event.metadata?.workflowEvaluation)?.metadata?.workflowEvaluation
    assert.ok(recordedEvaluation && typeof recordedEvaluation === 'object')
    assert.equal((recordedEvaluation as { passed: boolean }).passed, true)
    const workspace = (await store.listManagedCodingWorkspaces(project.id)).find((item) => item.id === completed.managedWorkspaceId)!
    const actual = await readFile(path.join(workspace.worktreePath, 'src/greeting.js'), 'utf8')
    assert.equal(actual, original.replace('Old greeting', expected))
    const evaluation = await evaluateCurrentWorkflowEvidence(store, { runId: id, nodeId: run.currentNodeId, runVersion: 1, localProjectId: project.id })
    assert.equal(evaluation.passed, true)
    assert.equal((await store.listTestEvidence(id))[0]?.status, 'passed')
    assert.ok(!JSON.stringify(createRemoteCodingAgentSummary(completed)).includes(memoryStatement))
    assert.equal(await readFile(path.join(repository, 'src/greeting.js'), 'utf8'), original)
    results.push({ label, runId: id, codingRunId: completed.id, greeting: expected, providerCalls: observations.slice(callsBefore), context: completed.contextReceipt, recordedEvaluation, evaluation, cost: completed.runtimeCostSummary })
    console.log(JSON.stringify({ liveProgress: label, status: 'passed', codingRunId: completed.id }))
    return run
  }
  try {
    const baseline = await executeCase('without-memory', 'Standard greeting')
    // Propose Memory from an actual read-only evaluation of executed code/tests, then
    // use the same explicit human promotion/revision services as Desktop.
    const runtime = createDesktopAgentRuntime({ store })
    let state = await runtime.start({ runId: baseline.id, nodeId: baseline.currentNodeId, localProjectId: project.id })
    for (let step = 0; step < 3; step += 1) state = await runtime.advance({ runtimeId: state.runtime.id, runId: baseline.id, localProjectId: project.id, expectedVersion: state.runtime.version, expectedCheckpointVersion: state.runtime.checkpointVersion })
    assert.equal(state.runtime.stopReason, 'success')
    const candidate = (await store.listAgentMemoryCandidates(project.id)).find((item) => item.provenance.runtimeId === state.runtime.id)!
    const actions = createAgentMemoryHumanActions({ store })
    const target = { runtimeId: state.runtime.id, runId: baseline.id, localProjectId: project.id }
    const memory = await actions.promote({ ...target, candidateId: candidate.id, expectedContentDigest: candidate.contentDigest, expectedProvenanceDigest: candidate.provenanceDigest })
    const revision = await actions.revise({ ...target, memoryId: memory.id, expectedRevision: 1, expectedHeadVersion: 1, expectedContentDigest: memory.contentDigest, expectedProvenanceDigest: memory.provenanceDigest, statement: memoryStatement })
    await executeCase('with-memory', expectedMemoryGreeting)
    await actions.delete({ ...target, memoryId: revision.id, expectedRevision: revision.revision, expectedHeadVersion: 2, expectedContentDigest: revision.contentDigest, expectedProvenanceDigest: revision.provenanceDigest })
    await executeCase('after-delete', 'Standard greeting')
    assert.ok(observations.slice(0, 2).every((entry) => !entry.containsMemory))
    assert.ok(observations.slice(2, 4).every((entry) => entry.containsMemory))
    assert.ok(observations.slice(4).every((entry) => !entry.containsMemory))
    assert.ok(observations.every((entry) => entry.containsInstruction))
    const phases = [...new Set(observations.map((entry) => entry.phase))]
    const promptCache = {
      total: summarizePromptCache(observations),
      byPhase: Object.fromEntries(phases.map((phase) => [phase, summarizePromptCache(observations.filter((entry) => entry.phase === phase))])),
      distinctSystemPrompts: new Set(observations.map((entry) => entry.systemPromptDigest)).size,
      note: 'Provider-reported cache use. DeepSeek caching is best-effort, so one run is indicative, not a guarantee.',
    }
    const report = { passed: true, provider: { id: input.provider.id, model: input.provider.model }, results, promptCache, completedAt: now(), scope: 'Real DevFlow Native Provider, local Store, managed worktrees, saved tests, Memory promotion/revision/deletion and evidence evaluation. No cloud deployment or UI acceptance claimed.' }
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    return report
  } finally { store.close() }
}
