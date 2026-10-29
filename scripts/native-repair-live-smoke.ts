/** Explicitly invoked, paid-provider acceptance of the Native v2 repair phase. Never runs in default CI. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import { createOpenAiCompatibleAgentProvider, type AgentProvider, type LocalProject, type WorkflowRun } from '../packages/shared/src/index.ts'
import { createLocalStore } from '../apps/desktop/electron/local-store.js'
import { createCodingRuntime } from '../apps/desktop/electron/coding-runtime.js'
import { createNativeCodingExecutorV2, createAgentProviderNativeCodingV2DecisionProvider } from '../apps/desktop/electron/native-coding-executor-v2.js'
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
