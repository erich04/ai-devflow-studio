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
import { createAgentMemoryRendererAccess } from '../apps/desktop/electron/agent-memory-renderer-access.js'
import { learnFromCompletedCodingRun, type CodingRunMemoryLearningResult } from '../apps/desktop/electron/coding-run-memory-learning.js'
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
    const candidate = (await store.listAgentMemoryCandidates(project.id)).find((item) =>
      item.provenance.kind === 'agent_observation' && item.provenance.runtimeId === state.runtime.id)!
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

type RepairPromptShape = {
  failureLocations: Array<{ path: string; line: number }>
  readOnlyExcerptPaths: string[]
  initialChangeSetReplacements: number | null
  initialChangeSetBodyOmitted: boolean
  editableExcerptStartLines: number[]
}

/**
 * Paid acceptance of the Native v2 repair phase (ADR 0024 §6). The exact expected wording
 * lives only in a test under `build/`, which the repository manifest skips, so the initial
 * proposal has to guess and the saved test fails. Only the test output reveals the wording.
 */
export async function runNativeRepairLiveSmoke(input: { provider: AgentProvider; outputDirectory: string }) {
  const output = path.resolve(input.outputDirectory)
  await mkdir(path.dirname(output), { recursive: true })
  // Refuse to overwrite an earlier report or a user-owned repository.
  await mkdir(output)
  const repository = path.join(output, 'repository')
  await mkdir(path.join(repository, 'src'), { recursive: true })
  await mkdir(path.join(repository, 'build'), { recursive: true })
  const expectedGreeting = 'Welcome aboard, crew 7!'
  const original = 'export const greeting = "Old greeting";\n'
  await writeFile(path.join(repository, 'src/greeting.js'), original)
  await writeFile(path.join(repository, 'package.json'), JSON.stringify({ name: 'native-repair-live', version: '1.0.0', type: 'module', scripts: { test: 'node --test build/acceptance.test.mjs' } }))
  await writeFile(path.join(repository, 'build/acceptance.test.mjs'), `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greeting } from '../src/greeting.js';\n\ntest('greeting uses the approved crew wording', () => {\n  assert.equal(greeting, ${JSON.stringify(expectedGreeting)});\n});\n`)
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'DevFlow Live QA'], ['config', 'user.email', 'live-qa@example.invalid'], ['add', '-f', '.'], ['commit', '-m', 'Isolated repair validation fixture']]) {
    await exec('git', ['-C', repository, ...args])
  }
  const store = await createLocalStore({ dbPath: path.join(output, 'devflow.sqlite') })
  const now = () => new Date().toISOString()
  const project: LocalProject = { id: 'native-repair-live-project', name: 'Native repair live acceptance', path: repository, packageManager: 'npm', detectedTestCommand: 'npm test', testCommand: 'npm test', createdAt: now(), updatedAt: now() }
  await store.upsertProject(project)
  const request = 'Change the greeting string in src/greeting.js so it welcomes new crew members. The saved acceptance test defines the exact wording. Keep the export name and change nothing else.'
  const observations: LiveProviderCallObservation[] = []
  let repairShape: RepairPromptShape | undefined
  const wrapped: AgentProvider = {
    ...input.provider,
    completeStructuredJson: async (call) => {
      const payload = JSON.parse(call.userPrompt) as {
        brief?: string; phase?: string
        failureLocations?: Array<{ path: string; line: number }>
        readOnlyExcerpts?: Array<{ path: string }>
        initialChangeSet?: { changes?: Array<{ replacements: unknown[] }>; bodyOmitted?: boolean }
        excerpts?: Array<{ startLine?: number }>
      }
      const observation: LiveProviderCallObservation = {
        phase: payload.phase ?? 'unknown', containsMemory: false,
        containsInstruction: payload.brief?.includes(request) ?? false, chars: call.userPrompt.length,
        systemPromptDigest: createHash('sha256').update(call.systemPrompt).digest('hex').slice(0, 16),
        systemPromptChars: call.systemPrompt.length,
      }
      if (payload.phase === 'repair') {
        // Structure only; no prompt text is kept in the report.
        repairShape = {
          failureLocations: (payload.failureLocations ?? []).map(({ path: filePath, line }) => ({ path: filePath, line })),
          readOnlyExcerptPaths: (payload.readOnlyExcerpts ?? []).map((excerpt) => excerpt.path),
          initialChangeSetReplacements: payload.initialChangeSet?.changes
            ? payload.initialChangeSet.changes.reduce((sum, change) => sum + change.replacements.length, 0) : null,
          initialChangeSetBodyOmitted: payload.initialChangeSet?.bodyOmitted === true,
          editableExcerptStartLines: (payload.excerpts ?? []).map((excerpt) => excerpt.startLine ?? 1),
        }
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
  const id = 'native-repair-live'
  const run: WorkflowRun = {
    id, version: 1, title: 'Native repair acceptance', request, projectId: project.id, creatorId: 'live-qa-owner',
    status: 'building', currentNodeId: `${id}-build`, branchName: 'devflow/native-repair', createdAt: now(), updatedAt: now(),
    nodes: [
      { id: `${id}-design`, stage: 'design', title: 'Fixture acceptance plan', subtitle: 'A supplied test plan', kind: 'task', status: 'success', ownerId: 'live-qa-owner', retryCount: 0, artifactIds: [`${id}-design-artifact`] },
      { id: `${id}-build`, stage: 'build', title: 'Update greeting', subtitle: 'Preserve public export', kind: 'task', status: 'running', ownerId: 'live-qa-owner', retryCount: 0, artifactIds: [] },
    ], edges: [],
  }
  try {
    await store.saveRun(run)
    await store.saveArtifact({ id: `${id}-design-artifact`, runId: id, nodeId: `${id}-design`, kind: 'design', title: 'Supplied repair acceptance context', summary: 'Change the greeting string only.', content: 'Acceptance: the saved acceptance test must pass; keep the greeting export.', redacted: true, updatedAt: now() })
    const waiting = await coding.runCodingAgent({ runId: id, nodeId: run.currentNodeId, projectId: project.id, requestedBy: run.creatorId, userInstruction: request })
    assert.equal(waiting.codingRun.status, 'waiting_permission')
    const approvedPhases: string[] = []
    // At most the initial and one repair approval (the executor allows one repair round).
    for (let round = 0; round < 2; round += 1) {
      const current = (await store.listCodingAgentRuns(id))[0]!
      if (current.status !== 'waiting_permission') break
      const permission = (await store.listCodingPermissionRequests(current.id)).find((item) => item.status === 'pending' && item.origin === 'coding_executor')
      assert.ok(permission)
      const changeSet = (await store.listCodingChangeSets(current.id)).find((item) => item.id === current.changeSetId)
      assert.ok(changeSet)
      assert.deepEqual(changeSet.changes.map((change) => change.path), ['src/greeting.js'])
      approvedPhases.push(changeSet.phase)
      await coding.replyCodingPermission({ requestId: permission.id, codingRunId: permission.codingRunId, decidedBy: run.creatorId, decision: 'approved', comment: 'Accept the exact isolated fixture Change Set for the authorized live test.' })
    }
    const finished = (await store.listCodingAgentRuns(id))[0]!
    const workspace = (await store.listManagedCodingWorkspaces(project.id)).find((item) => item.id === finished.managedWorkspaceId)
    const actual = workspace ? await readFile(path.join(workspace.worktreePath, 'src/greeting.js'), 'utf8') : null
    const evidence = (await store.listTestEvidence(id)).map((item) => item.status)
    const repairTriggered = observations.some((entry) => entry.phase === 'repair')
    const phases = [...new Set(observations.map((entry) => entry.phase))]
    const report = {
      passed: repairTriggered && finished.status === 'completed' && (actual?.includes(expectedGreeting) ?? false),
      provider: { id: input.provider.id, model: input.provider.model },
      codingRunId: finished.id, status: finished.status, repairTriggered, approvedPhases,
      testEvidenceStatuses: evidence, greetingMatches: actual?.includes(expectedGreeting) ?? false,
      repairPrompt: repairShape ?? null,
      providerCalls: observations,
      promptCache: {
        total: summarizePromptCache(observations),
        byPhase: Object.fromEntries(phases.map((phase) => [phase, summarizePromptCache(observations.filter((entry) => entry.phase === phase))])),
        distinctSystemPrompts: new Set(observations.map((entry) => entry.systemPromptDigest)).size,
      },
      cost: finished.runtimeCostSummary,
      completedAt: now(),
      scope: 'Real DevFlow Native v2 Provider, local Store, managed worktree, saved test failure, repair proposal and second exact approval. No UI acceptance claimed.',
    }
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    // The original repository is never changed by managed worktrees.
    assert.equal(await readFile(path.join(repository, 'src/greeting.js'), 'utf8'), original)
    assert.ok(observations.every((entry) => entry.containsInstruction))
    assert.ok(repairTriggered, 'The initial proposal passed the saved test; the repair phase was not exercised.')
    assert.equal(finished.status, 'completed')
    assert.equal(report.greetingMatches, true)
    assert.deepEqual(evidence.sort(), ['failed', 'passed'])
    return report
  } finally { store.close() }
}

type LearningCallObservation = LiveProviderCallObservation & {
  runLabel: string
  briefHasTestCommandMemory: boolean
  briefHasChangeMapMemory: boolean
}

const LEARNED_TEST_COMMAND = 'Verified test command for this project: npm test.'

/**
 * Paid acceptance of learning from accepted Coding Runs (ADR 0024 §4–5). Two sequential
 * Coding Runs in one isolated project, each with its own local session:
 *
 * 1. The first run learns the saved test command (bounded policy, 30 days) and proposes a
 *    change map, which a person saves.
 * 2. The second run's brief recalls both; its learning recognizes the test command as
 *    already known, and a person dismisses its new change map, which is then not proposed
 *    again when learning is retried.
 */
export async function runMemoryLearningLiveSmoke(input: { provider: AgentProvider; outputDirectory: string }) {
  const output = path.resolve(input.outputDirectory)
  await mkdir(path.dirname(output), { recursive: true })
  // Refuse to overwrite an earlier report or a user-owned repository.
  await mkdir(output)
  const repository = path.join(output, 'repository')
  await mkdir(path.join(repository, 'src'), { recursive: true })
  const original = 'export const greeting = "Old greeting";\n'
  await writeFile(path.join(repository, 'src/greeting.js'), original)
  await writeFile(path.join(repository, 'package.json'), JSON.stringify({ name: 'memory-learning-live', version: '1.0.0', type: 'module', scripts: { test: 'node --test test.mjs' } }))
  await writeFile(path.join(repository, 'test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greeting } from './src/greeting.js';\ntest('greeting remains a nonempty string', () => { assert.equal(typeof greeting, 'string'); assert.ok(greeting.length > 0); });\ntest('greeting stays on one line', () => assert.ok(!greeting.includes('\\n')));\n")
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'DevFlow Live QA'], ['config', 'user.email', 'live-qa@example.invalid'], ['add', '.'], ['commit', '-m', 'Isolated memory learning fixture']]) {
    await exec('git', ['-C', repository, ...args])
  }
  const store = await createLocalStore({ dbPath: path.join(output, 'devflow.sqlite') })
  const now = () => new Date().toISOString()
  const project: LocalProject = { id: 'memory-learning-live-project', name: 'Memory learning live acceptance', path: repository, packageManager: 'npm', detectedTestCommand: 'npm test', testCommand: 'npm test', createdAt: now(), updatedAt: now() }
  await store.upsertProject(project)
  const observations: LearningCallObservation[] = []
  let currentRunLabel = 'none'
  let currentRequest = ''
  let firstChangeMapStatement: string | null = null
  const wrapped: AgentProvider = {
    ...input.provider,
    completeStructuredJson: async (call) => {
      const payload = JSON.parse(call.userPrompt) as { brief?: string; phase?: string }
      const observation: LearningCallObservation = {
        runLabel: currentRunLabel,
        phase: payload.phase ?? 'unknown',
        containsMemory: false,
        containsInstruction: currentRequest.length > 0 && (payload.brief?.includes(currentRequest) ?? false),
        briefHasTestCommandMemory: payload.brief?.includes(LEARNED_TEST_COMMAND) ?? false,
        briefHasChangeMapMemory: firstChangeMapStatement !== null && (payload.brief?.includes(firstChangeMapStatement) ?? false),
        chars: call.userPrompt.length,
        // Digests only: no prompt text is kept in the report.
        systemPromptDigest: createHash('sha256').update(call.systemPrompt).digest('hex').slice(0, 16),
        systemPromptChars: call.systemPrompt.length,
      }
      observation.containsMemory = observation.briefHasTestCommandMemory || observation.briefHasChangeMapMemory
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
    // The same wiring as Desktop Main: learning runs after the saved test passes.
    learnCodingRunMemory: ({ codingRun, evaluationPassed }) => learnFromCompletedCodingRun({ store, codingRun, evaluationPassed }),
  })
  const actions = createAgentMemoryHumanActions({ store })

  async function executeRun(label: string, title: string, greeting: string) {
    currentRunLabel = label
    const id = `memory-learning-${label}`
    const request = `Update only the greeting string in src/greeting.js to exactly "${greeting}". Keep the export name, change nothing else, and keep npm test passing.`
    currentRequest = request
    const run: WorkflowRun = {
      id, version: 1, title, request, projectId: project.id, creatorId: 'live-qa-owner',
      status: 'building', currentNodeId: `${id}-build`, branchName: `devflow/${label}`, createdAt: now(), updatedAt: now(),
      nodes: [
        { id: `${id}-design`, stage: 'design', title: 'Fixture acceptance plan', subtitle: 'A supplied test plan', kind: 'task', status: 'success', ownerId: 'live-qa-owner', retryCount: 0, artifactIds: [`${id}-design-artifact`] },
        { id: `${id}-build`, stage: 'build', title: 'Update greeting', subtitle: 'Preserve public export', kind: 'task', status: 'running', ownerId: 'live-qa-owner', retryCount: 0, artifactIds: [] },
      ], edges: [],
    }
    await store.saveRun(run)
    await store.saveArtifact({ id: `${id}-design-artifact`, runId: id, nodeId: `${id}-design`, kind: 'design', title: 'Supplied learning acceptance context', summary: 'Change the greeting string only.', content: 'Acceptance: preserve the greeting export and keep the saved tests passing.', redacted: true, updatedAt: now() })
    const waiting = await coding.runCodingAgent({ runId: id, nodeId: run.currentNodeId, projectId: project.id, requestedBy: run.creatorId, userInstruction: request })
    assert.equal(waiting.codingRun.status, 'waiting_permission')
    const permission = (await store.listCodingPermissionRequests(waiting.codingRun.id)).find((item) => item.status === 'pending' && item.origin === 'coding_executor')
    assert.ok(permission)
    const [changeSet] = await store.listCodingChangeSets(waiting.codingRun.id)
    assert.ok(changeSet)
    assert.deepEqual(changeSet.changes.map((change) => change.path), ['src/greeting.js'])
    await coding.replyCodingPermission({ requestId: permission.id, codingRunId: permission.codingRunId, decidedBy: run.creatorId, decision: 'approved', comment: 'Accept the exact isolated fixture Change Set for the authorized live test.' })
    const completed = (await store.listCodingAgentRuns(id))[0]!
    assert.equal(completed.status, 'completed')
    const workspace = (await store.listManagedCodingWorkspaces(project.id)).find((item) => item.id === completed.managedWorkspaceId)!
    assert.equal(await readFile(path.join(workspace.worktreePath, 'src/greeting.js'), 'utf8'), original.replace('Old greeting', greeting))
    const learning = (await store.listCodingAgentEvents(completed.id))
      .map((event) => event.metadata?.memoryLearning)
      .find((value) => value !== undefined) as Pick<CodingRunMemoryLearningResult, 'candidates' | 'promoted' | 'notPromoted'> | undefined
    assert.ok(learning, `${label}: the Coding Run trace has no Memory learning result`)
    console.log(JSON.stringify({ liveProgress: label, status: 'passed', codingRunId: completed.id }))
    return { run, codingRun: completed, learning }
  }

  const kindsAndOutcomes = (learning: Pick<CodingRunMemoryLearningResult, 'candidates'>) =>
    learning.candidates.map(({ kind, outcome }) => [kind, outcome])
  const selectionFor = (run: WorkflowRun) => ({ runId: run.id, localProjectId: project.id })

  try {
    // Run 1: nothing is known yet.
    const first = await executeRun('first', 'Greeting for the onboarding page', 'Welcome to onboarding')
    assert.deepEqual(kindsAndOutcomes(first.learning), [['test_command', 'proposed'], ['change_map', 'proposed']])
    assert.equal(first.learning.promoted.length, 1)
    assert.deepEqual(first.learning.notPromoted.map(({ reason }) => reason), ['human_review_required'])
    const policyMemoryId = first.learning.promoted[0]!.memoryId
    const [policyRevision] = await store.listAgentMemoryRevisions(policyMemoryId)
    assert.ok(policyRevision)
    assert.equal(policyRevision.statement, LEARNED_TEST_COMMAND)
    assert.equal(policyRevision.promotionActorKind, 'policy')
    assert.equal(policyRevision.visibility, 'user_project')
    assert.equal(policyRevision.retentionClass, 'thirty_days')

    // A person reviews and saves the first change map.
    const access = createAgentMemoryRendererAccess(store)
    const afterFirst = await access.list(selectionFor(first.run))
    const firstChangeMap = afterFirst.candidates.find((candidate) => candidate.lifecycleStatus === 'pending')
    assert.ok(firstChangeMap)
    firstChangeMapStatement = firstChangeMap.statement
    const humanMemory = await actions.promote({
      ...selectionFor(first.run), candidateId: firstChangeMap.id,
      expectedContentDigest: firstChangeMap.contentDigest, expectedProvenanceDigest: firstChangeMap.provenanceDigest,
    })

    // Run 2: a different task in the same project, in its own local session.
    const second = await executeRun('second', 'Greeting for the settings page', 'Welcome to settings')
    assert.notEqual(second.codingRun.contextReceipt?.scope.sessionId, first.codingRun.contextReceipt?.scope.sessionId)
    const recalledIds = (second.codingRun.contextReceipt?.memories ?? []).map((memory) => memory.id).sort()
    assert.deepEqual(recalledIds, [humanMemory.id, policyMemoryId].sort())
    assert.deepEqual(kindsAndOutcomes(second.learning), [['test_command', 'duplicate'], ['change_map', 'proposed']])
    assert.deepEqual(second.learning.promoted, [])

    // A person dismisses the second change map; retried learning does not propose it again.
    const afterSecond = await access.list(selectionFor(second.run))
    const secondChangeMap = afterSecond.candidates.find((candidate) => candidate.lifecycleStatus === 'pending')
    assert.ok(secondChangeMap)
    const dismissal = await actions.dismiss({
      ...selectionFor(second.run), candidateId: secondChangeMap.id,
      expectedContentDigest: secondChangeMap.contentDigest, expectedProvenanceDigest: secondChangeMap.provenanceDigest,
    })
    const retried = await learnFromCompletedCodingRun({ store, codingRun: second.codingRun, evaluationPassed: true })
    assert.deepEqual(kindsAndOutcomes(retried), [['test_command', 'duplicate'], ['change_map', 'dismissed']])
    const final = await access.list(selectionFor(second.run))
    assert.equal(final.candidates.filter((candidate) => candidate.lifecycleStatus === 'pending').length, 0)
    assert.deepEqual(final.memories.map((memory) => memory.lifecycleStatus), ['active', 'active'])

    // Run 1 had nothing to recall; every Run 2 call carried both learned Memories.
    const firstCalls = observations.filter((entry) => entry.runLabel === 'first')
    const secondCalls = observations.filter((entry) => entry.runLabel === 'second')
    assert.ok(firstCalls.length > 0 && firstCalls.every((entry) => !entry.containsMemory))
    assert.ok(secondCalls.length > 0 && secondCalls.every((entry) => entry.briefHasTestCommandMemory && entry.briefHasChangeMapMemory))
    assert.ok(observations.every((entry) => entry.containsInstruction))
    // Coding Run Memory stays local.
    for (const codingRun of [first.codingRun, second.codingRun]) {
      const summary = JSON.stringify(createRemoteCodingAgentSummary(codingRun))
      assert.ok(!summary.includes(LEARNED_TEST_COMMAND) && !summary.includes(firstChangeMapStatement))
    }
    assert.equal(await readFile(path.join(repository, 'src/greeting.js'), 'utf8'), original)

    const report = {
      passed: true,
      provider: { id: input.provider.id, model: input.provider.model },
      runs: [first, second].map(({ run, codingRun, learning }) => ({
        runId: run.id, codingRunId: codingRun.id, title: run.title,
        recalledMemoryIds: (codingRun.contextReceipt?.memories ?? []).map((memory) => memory.id),
        learning, cost: codingRun.runtimeCostSummary,
      })),
      memories: {
        policy: { memoryId: policyMemoryId, statement: policyRevision.statement, visibility: policyRevision.visibility, retentionClass: policyRevision.retentionClass, expiresAt: policyRevision.expiresAt },
        human: { memoryId: humanMemory.id, statement: humanMemory.statement },
      },
      dismissal: { candidateId: dismissal.candidateId, provenanceKind: dismissal.provenanceKind, retriedLearning: kindsAndOutcomes(retried) },
      providerCalls: observations,
      promptCache: {
        total: summarizePromptCache(observations),
        byRun: Object.fromEntries(['first', 'second'].map((label) => [label, summarizePromptCache(observations.filter((entry) => entry.runLabel === label))])),
        distinctSystemPrompts: new Set(observations.map((entry) => entry.systemPromptDigest)).size,
      },
      completedAt: now(),
      scope: 'Real DevFlow Native v2 Provider, local Store, managed worktrees, saved tests, automatic learning after evaluation, bounded policy promotion, human promotion and dismissal, recall in a later Coding Run. No UI acceptance claimed.',
    }
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    return report
  } finally { store.close() }
}
