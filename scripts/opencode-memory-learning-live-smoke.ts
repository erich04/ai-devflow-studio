/**
 * Paid acceptance of learning from accepted OpenCode Coding Runs (ADR 0024 §4–5).
 * Explicitly invoked; never runs in default CI.
 *
 * Two sequential OpenCode Coding Runs in one isolated project, each with its own local
 * session, wired exactly like Desktop Main: learning runs after Change Acceptance and the
 * saved test. The first run learns the test command (bounded policy) and proposes a change
 * map; the second run's Context receipt recalls the test command Memory, and its learning
 * recognizes the test command as already known.
 *
 * The Provider credential reaches only the OpenCode child process, through the same
 * binding shape Main uses (`OPENCODE_CONFIG_CONTENT` + one env var), with an isolated
 * OpenCode profile. Desktop's default OpenCode rules allow edits inside the managed
 * worktree without a prompt and ask for shell commands; this harness rejects every shell
 * request, and the run must change only the one fixture file.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import { createRemoteCodingAgentSummary, type CodingPermissionRequest, type LocalProject, type WorkflowRun } from '../packages/shared/src/index.ts'
import { createLocalStore } from '../apps/desktop/electron/local-store.js'
import { createCodingRuntime } from '../apps/desktop/electron/coding-runtime.js'
import { createOpencodeHttpCodingEngineAdapter } from '../apps/desktop/electron/opencode-http-engine.js'
import { createOpencodeProcessManager } from '../apps/desktop/electron/opencode-process.js'
import { buildOpencodeRuntimeEnv } from '../apps/desktop/electron/coding-engine.js'
import { isolatedOpencodeProfileEnv } from '../apps/desktop/electron/opencode-profile-isolation.js'
import { learnFromCompletedCodingRun, type CodingRunMemoryLearningResult } from '../apps/desktop/electron/coding-run-memory-learning.js'
import { runLocalTestCommand } from '../apps/desktop/electron/test-runner.js'
import { createGovernedOpencodeProxy } from '../apps/desktop/electron/governed-opencode-proxy.js'
import { classifyOpencodeFailure } from '../apps/desktop/electron/opencode-failure.js'
import { createMemoryLearningBudget } from './memory-learning-budget.js'
import { createWorkflowRuntime } from '../apps/desktop/electron/workflow-runtime.js'

const exec = promisify(execFile)
const LEARNED_TEST_COMMAND = 'Verified test command for this project: npm test.'
const FIXTURE_PATH = 'src/greeting.js'
const MAX_APPROVAL_ROUNDS = 12

export type OpencodeMemoryLearningLiveInput = {
  binaryPath: string
  providerId: string
  modelId: string
  baseUrl: string
  apiKey: string
  outputDirectory: string
  maxCostUsd: number
  maxCalls?: number
}

type PermissionDecisionRecord = {
  run: string
  origin: string
  permission: string
  decision: 'approved' | 'rejected'
  filePath?: string
}

export async function runOpencodeMemoryLearningLiveSmoke(input: OpencodeMemoryLearningLiveInput) {
  const output = path.resolve(input.outputDirectory)
  await mkdir(path.dirname(output), { recursive: true })
  // Refuse to overwrite an earlier report or a user-owned repository.
  await mkdir(output)
  const repository = path.join(output, 'repository')
  await mkdir(path.join(repository, 'src'), { recursive: true })
  const original = 'export const greeting = "Old greeting";\n'
  await writeFile(path.join(repository, FIXTURE_PATH), original)
  await writeFile(path.join(repository, 'package.json'), JSON.stringify({ name: 'opencode-memory-learning-live', version: '1.0.0', type: 'module', scripts: { test: 'node --test test.mjs' } }))
  await writeFile(path.join(repository, 'test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greeting } from './src/greeting.js';\ntest('greeting remains a nonempty string', () => { assert.equal(typeof greeting, 'string'); assert.ok(greeting.length > 0); });\ntest('greeting stays on one line', () => assert.ok(!greeting.includes('\\n')));\n")
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'DevFlow Live QA'], ['config', 'user.email', 'live-qa@example.invalid'], ['add', '.'], ['commit', '-m', 'Isolated OpenCode memory learning fixture']]) {
    await exec('git', ['-C', repository, ...args])
  }

  const store = await createLocalStore({ dbPath: path.join(output, 'devflow.sqlite') })
  const now = () => new Date().toISOString()
  const project: LocalProject = { id: 'opencode-memory-learning-live-project', name: 'OpenCode memory learning live acceptance', path: repository, packageManager: 'npm', detectedTestCommand: 'npm test', testCommand: 'npm test', createdAt: now(), updatedAt: now() }
  await store.upsertProject(project)

  const processManager = createOpencodeProcessManager()
  const providerBinding = {
    providerId: input.providerId, modelId: input.modelId, baseUrl: input.baseUrl, apiKey: input.apiKey,
    fingerprint: createHash('sha256').update(JSON.stringify([input.providerId, input.modelId, input.baseUrl, 'live-acceptance'])).digest('hex'),
  }
  const budget = await createMemoryLearningBudget({ path: path.join(output, 'model-calls.json'), projectId: project.id, maxCostUsd: input.maxCostUsd, maxCalls: input.maxCalls ?? 12 })
  const relay = await createGovernedOpencodeProxy({ binding: providerBinding, projectId: project.id, governance: budget, maxOutputTokens: 4096 })
  const runtimeEnv = buildOpencodeRuntimeEnv({ baseEnv: process.env, apiKeyEnvName: 'OPENCODE_API_KEY', providerBinding: relay.binding })
  const configuration = JSON.parse(runtimeEnv.OPENCODE_CONFIG_CONTENT!)
  configuration.provider[input.providerId].models[input.modelId].limit = { context: 32768, output: 4096 }
  runtimeEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify(configuration)
  const engine = createOpencodeHttpCodingEngineAdapter({
    binaryPath: input.binaryPath,
    providerID: input.providerId,
    modelID: input.modelId,
    processManager,
    configurationFingerprint: 'opencode-memory-learning-live:1',
    requireExecutionAuthorization: true,
    permissionDiscoveryTimeoutMs: 240_000,
    runtimeEnv: {
      ...runtimeEnv,
      // Same isolation as Desktop coding runs: no personal instructions, plugins or skills.
      ...isolatedOpencodeProfileEnv(path.join(output, 'opencode-profile')),
    },
  })
  const workflowRuntime = createWorkflowRuntime(store)
  const coding = createCodingRuntime({
    store, engine, worktreeRoot: path.join(output, 'worktrees'), runTestCommand: runLocalTestCommand,
    // Change Acceptance advances the exact Workflow build once, as Desktop Main does.
    completeWorkflowBuild: async ({ runId, nodeId, codingRunId, diffId, now: at }) => {
      const existingEvents = await store.listEvents(runId)
      const result = await workflowRuntime.execute({
        runId,
        command: { type: 'complete_build', nodeId, codingRunId, diffId },
        candidates: { events: [{
          id: `event-build-complete-${codingRunId}`, runId, nodeId, sequence: existingEvents.length + 1,
          kind: 'file_change', message: `Coding Agent run ${codingRunId} completed with diff ${diffId}.`, timestamp: at,
        }] },
        now: at,
      })
      if (!result.applied) throw new Error(`Workflow command rejected: ${result.blockers.map((blocker) => blocker.code).join(',')}`)
    },
    budgetGuard: async () => ({ status: 'allowed', blocksRun: false, currentSpendUsd: budget.records().reduce((sum, row) => sum + (row.costUsd ?? row.projectedCostUsd), 0), projectedCostUsd: 0, limitUsd: input.maxCostUsd, reason: 'Each actual request must also pass the governed relay and persistent acceptance budget.' }),
    // The same wiring as Desktop Main: learning runs after Change Acceptance and the saved test.
    learnCodingRunMemory: ({ codingRun, evaluationPassed }) => learnFromCompletedCodingRun({ store, codingRun, evaluationPassed }),
  })

  const decisions: PermissionDecisionRecord[] = []
  function decide(request: CodingPermissionRequest): { decision: 'approved' | 'rejected'; comment: string } {
    const origin = request.origin ?? 'coding_executor'
    if (origin === 'execution_authorization') {
      return { decision: 'approved', comment: 'Authorize the managed OpenCode execution for the authorized live test.' }
    }
    if (origin === 'change_acceptance') {
      return { decision: 'approved', comment: 'Accept the exact final Git diff of the isolated fixture.' }
    }
    if (
      origin === 'coding_executor' &&
      (request.permission === 'edit' || request.permission === 'write' || request.permission === 'patch') &&
      typeof request.filePath === 'string' &&
      request.filePath.replaceAll('\\', '/').endsWith(FIXTURE_PATH)
    ) {
      return { decision: 'approved', comment: 'Approve the edit to the one fixture file.' }
    }
    return { decision: 'rejected', comment: 'Only edits to src/greeting.js are allowed; DevFlow runs the saved test.' }
  }

  async function executeRun(label: string, title: string, greeting: string) {
    const checkpoint = relay.checkpoint()
    const id = `opencode-memory-learning-${label}`
    const request = `Change only the greeting string in src/greeting.js to exactly "${greeting}". Keep the export name and change nothing else. Do not run shell commands; DevFlow runs the saved test after your edit.`
    const run: WorkflowRun = {
      id, version: 1, title, request, projectId: project.id, creatorId: 'live-qa-owner',
      status: 'building', currentNodeId: `${id}-build`, branchName: `devflow/${label}`, createdAt: now(), updatedAt: now(),
      nodes: [
        { id: `${id}-design`, stage: 'design', title: 'Fixture acceptance plan', subtitle: 'A supplied test plan', kind: 'task', status: 'success', ownerId: 'live-qa-owner', retryCount: 0, artifactIds: [`${id}-design-artifact`] },
        { id: `${id}-build`, stage: 'build', title: 'Update greeting', subtitle: 'Preserve public export', kind: 'task', status: 'running', ownerId: 'live-qa-owner', retryCount: 0, artifactIds: [] },
        { id: `${id}-test`, stage: 'test', title: 'Test', subtitle: 'Saved test', kind: 'test', status: 'pending', ownerId: 'live-qa-owner', retryCount: 0, artifactIds: [] },
      ], edges: [{ id: `${id}-build-to-test`, source: `${id}-build`, target: `${id}-test`, kind: 'normal' }],
    }
    await store.saveRun(run)
    await store.saveArtifact({ id: `${id}-design-artifact`, runId: id, nodeId: `${id}-design`, kind: 'design', title: 'Supplied learning acceptance context', summary: 'Change the greeting string only.', content: 'Acceptance: preserve the greeting export and keep the saved tests passing.', redacted: true, updatedAt: now() })
    const started = await coding.runCodingAgent({ runId: id, nodeId: run.currentNodeId, projectId: project.id, requestedBy: run.creatorId, userInstruction: request })
    const codingRunId = started.codingRun.id
    for (let round = 0; round < MAX_APPROVAL_ROUNDS; round += 1) {
      const current = (await store.listCodingAgentRuns(id)).find((entry) => entry.id === codingRunId)!
      if (current.status !== 'waiting_permission') break
      const pending = (await store.listCodingPermissionRequests(codingRunId)).filter((entry) => entry.status === 'pending')
      assert.equal(pending.length, 1, `${label}: expected exactly one pending permission request`)
      const permission = pending[0]!
      const { decision, comment } = decide(permission)
      decisions.push({
        run: label, origin: permission.origin ?? 'coding_executor', permission: permission.permission, decision,
        ...(permission.filePath ? { filePath: path.basename(permission.filePath) } : {}),
      })
      await coding.replyCodingPermission({ requestId: permission.id, codingRunId, decidedBy: run.creatorId, decision, comment })
    }
    const completed = (await store.listCodingAgentRuns(id)).find((entry) => entry.id === codingRunId)!
    assert.equal(completed.status, 'completed', `${label}: the OpenCode Coding Run did not complete (${completed.status})`)
    assert.equal(completed.engine, 'opencode-http')
    assert.deepEqual(completed.changedPaths, [FIXTURE_PATH], `${label}: OpenCode changed paths other than the fixture`)
    const workspace = (await store.listManagedCodingWorkspaces(project.id)).find((item) => item.id === completed.managedWorkspaceId)!
    assert.equal(await readFile(path.join(workspace.worktreePath, FIXTURE_PATH), 'utf8'), original.replace('Old greeting', greeting))
    const events = await store.listCodingAgentEvents(completed.id)
    const learning = events
      .map((event) => event.metadata?.memoryLearning)
      .find((value) => value !== undefined) as Pick<CodingRunMemoryLearningResult, 'candidates' | 'promoted' | 'notPromoted'> | undefined
    assert.ok(learning && 'candidates' in learning, `${label}: the Coding Run trace has no Memory learning result`)
    const evidenceText = JSON.stringify(events.map((event) => event.metadata ?? {}))
    assert.ok(!evidenceText.includes(input.apiKey), `${label}: the Provider key appeared in Coding Run evidence`)
    console.log(JSON.stringify({ liveProgress: label, status: 'passed', codingRunId: completed.id }))
    const governedUsage = relay.usageAfter(checkpoint)
    assert.ok(governedUsage?.budgetAttemptIds?.length, `${label}: no governed model call recorded`)
    assert.equal(governedUsage.missingUsageCount, 0, `${label}: provider usage is incomplete`)
    return { run, codingRun: completed, learning, governedUsage }
  }

  const kindsAndOutcomes = (learning: Pick<CodingRunMemoryLearningResult, 'candidates'>) =>
    learning.candidates.map(({ kind, outcome }) => [kind, outcome])

  try {
    // Run 1: nothing is known yet.
    const first = await executeRun('first', 'Greeting for the onboarding page', 'Welcome to onboarding')
    assert.deepEqual(first.codingRun.contextReceipt?.memories ?? [], [])
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

    // Run 2: a different task in the same project, in its own local session.
    const second = await executeRun('second', 'Greeting for the settings page', 'Welcome to settings')
    assert.notEqual(second.codingRun.contextReceipt?.scope.sessionId, first.codingRun.contextReceipt?.scope.sessionId)
    assert.deepEqual((second.codingRun.contextReceipt?.memories ?? []).map((memory) => memory.id), [policyMemoryId])
    assert.deepEqual(kindsAndOutcomes(second.learning), [['test_command', 'duplicate'], ['change_map', 'proposed']])
    assert.deepEqual(second.learning.promoted, [])

    // Coding Run Memory stays local, and the original repository is untouched.
    for (const codingRun of [first.codingRun, second.codingRun]) {
      assert.ok(!JSON.stringify(createRemoteCodingAgentSummary(codingRun)).includes(LEARNED_TEST_COMMAND))
    }
    assert.equal(await readFile(path.join(repository, FIXTURE_PATH), 'utf8'), original)
    assert.ok(!JSON.stringify(decisions).includes(input.apiKey))

    const report = {
      passed: true,
      provider: { id: input.providerId, model: input.modelId, baseUrl: input.baseUrl },
      runs: [first, second].map(({ run, codingRun, learning, governedUsage }) => ({
        governedUsage,
        runId: run.id, codingRunId: codingRun.id, title: run.title, engine: codingRun.engine,
        recalledMemoryIds: (codingRun.contextReceipt?.memories ?? []).map((memory) => memory.id),
        learning, changedPaths: codingRun.changedPaths, cost: codingRun.runtimeCostSummary ?? null,
        budgetReason: codingRun.budgetDecision?.reason ?? null,
      })),
      policyMemory: { memoryId: policyMemoryId, statement: policyRevision.statement, visibility: policyRevision.visibility, retentionClass: policyRevision.retentionClass, expiresAt: policyRevision.expiresAt },
      permissionDecisions: decisions,
      modelCalls: budget.records(),
      maxCostUsd: input.maxCostUsd,
      completedAt: now(),
      scope: 'OpenCode with an explicitly configured Provider, local Store, managed worktrees, execution authorization, Change Acceptance, saved tests, Workflow build advance, automatic learning, bounded policy promotion, recall in a later Coding Run. No UI acceptance claimed.',
    }
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    return report
  } catch (error) {
    const details = classifyOpencodeFailure(error, { relayFailure: (id) => relay.failureForRequest(id, 0) }).failureDetails
    await writeFile(path.join(output, 'failure.json'), JSON.stringify({ passed: false, failure: details, modelCalls: budget.records(), usage: relay.usageAfter(0), completedAt: now() }, null, 2))
    throw error
  } finally {
    try { await processManager.stopAll() } finally {
      try { await relay.close() } finally { store.close() }
    }
  }
}
