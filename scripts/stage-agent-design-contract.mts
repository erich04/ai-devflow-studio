// Real OpenCode / local synthetic Provider; never loads a user's credentials or repository.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import {
  createWorkflowRunFromRequest, createFakeAgentProvider, runWorkflowStageAgent,
  completeWorkflowAgentNode, advanceWorkflowAfterGateApproval, approveClarificationRevision,
} from '../packages/shared/src/index.ts'
import { createReadOnlyLocalStageAgentExecutor } from '../apps/desktop/electron/stage-agent-executor.ts'
import { createOpencodeProcessManager } from '../apps/desktop/electron/opencode-process.ts'
import { createLocalStore } from '../apps/desktop/electron/local-store.ts'

const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-design-contract-'))
const repository = path.join(root, 'repository')
const manager = createOpencodeProcessManager()
const requests: Array<{ prompt: string; tools: string[] }> = []
let hold = false
let releaseHeld!: () => void
const held = new Promise<void>((resolve) => { releaseHeld = resolve })
const server = createServer((request, response) => {
  void (async () => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const tools = (body.tools ?? []).map((tool: { function: { name: string } }) => tool.function.name)
    const prompt = JSON.stringify(body.messages)
    requests.push({ prompt, tools })
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (hold) { response.write(': held\n\n'); releaseHeld(); return }
    const read = tools.find((name: string) => name === 'read')
    const readCompleted = body.messages.some((message: { role: string }) => message.role === 'tool')
    const design = {
      title: 'Task filter design', summary: 'Read verified implementation; plan changes only.',
      content: '# Implementation\nUpdate task.ts filters after review.\n## Verification\nRun npm test during implementation; expect unchanged task data.\n## Delivery and rollback\nReview the diff and revert the filter change if needed.',
      goals: ['Status filters'], acceptanceCriteria: ['Reset filter; preserve tasks'], nonGoals: ['Search'],
      openQuestions: [], assumptions: [], risks: ['UI regression'],
      repositoryFindings: { version: 1, repositoryDigest: '', verifiedFacts: [
        { id: 'fact', statement: 'task.ts contains the task store.', citationIds: ['task-source'] },
      ], citations: [{ id: 'task-source', path: 'task.ts', contentDigest: '', lineStart: 1, lineEnd: 1 }],
      assumptions: [], openQuestions: [], uncheckedScopes: ['Browser presentation'] },
    }
    const delta = read && !readCompleted
      ? { role: 'assistant', tool_calls: [{ index: 0, id: 'read-source', type: 'function', function: {
        name: read, arguments: JSON.stringify({ filePath: path.join(repository, 'task.ts') }),
      } }] }
      : { role: 'assistant', content: JSON.stringify(design) }
    for (const [value, reason] of [[delta, null], [{}, read && !readCompleted ? 'tool_calls' : 'stop']] as const) {
      response.write(`data: ${JSON.stringify({ id: 'contract', object: 'chat.completion.chunk', model: body.model,
        choices: [{ index: 0, delta: value, finish_reason: reason }],
        ...(reason ? { usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 } } : {}),
      })}\n\n`)
    }
    response.end('data: [DONE]\n\n')
  })().catch((error) => { response.end(); console.error(String(error)) })
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
try {
  await mkdir(repository)
  await writeFile(path.join(repository, 'task.ts'), 'export const tasks = []\n')
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture']]) {
    execFileSync('git', args, { cwd: repository, stdio: 'ignore' })
  }
  const created = createWorkflowRunFromRequest({ runId: 'design-contract', title: 'Filters',
    request: 'RAW_BODY_MARKER: three filters; reset filter on refresh and preserve task data.',
    projectId: 'contract-project', creatorId: 'fixture', branchName: 'fixture', now: '2026-09-22T00:00:00.000Z' })
  const clarification = await runWorkflowStageAgent({ ...created, node: created.run.nodes[0]!,
    provider: createFakeAgentProvider(), requestedBy: 'fixture', runtime: 'electron' })
  const clarified = completeWorkflowAgentNode({ ...created, nodeId: created.run.currentNodeId,
    generatedArtifact: clarification.artifact, existingEvents: created.events, actorName: 'Fixture', now: '2026-09-22T00:01:00.000Z' })
  const approved = approveClarificationRevision({ artifact: clarification.artifact, actorId: 'fixture',
    gateNodeId: clarified.run.currentNodeId, sequence: 3, now: '2026-09-22T00:02:00.000Z' })
  const { run } = advanceWorkflowAfterGateApproval({ run: clarified.run, approvedNodeId: clarified.run.currentNodeId, now: '2026-09-22T00:02:00.000Z' })
  const node = run.nodes.find((item) => item.id === run.currentNodeId)!
  const artifacts = [...created.artifacts, approved.artifact, { ...created.artifacts[0]!,
    id: 'conversation-proposal-design-contract', nodeId: node.id, kind: 'log' as const, content: 'DESIGN_PROPOSAL_MARKER: no counts.' }]
  const address = server.address()
  assert(address && typeof address !== 'string')
  const executor = createReadOnlyLocalStageAgentExecutor({ projectId: run.projectId, projectPath: repository,
    binaryPath: process.env.DEVFLOW_OPENCODE_BIN || 'opencode', providerId: 'design-fixture', modelId: 'contract-model',
    detectedVersion: 'contract', processManager: manager,
    runtimeEnv: { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'config'),
      XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'), OPENCODE_DISABLE_AUTOUPDATE: 'true' },
    providerBinding: { providerId: 'design-fixture', modelId: 'contract-model', apiKey: 'synthetic-not-billed', fingerprint: 'design-contract', baseUrl: `http://127.0.0.1:${address.port}/v1` },
  })
  const result = await runWorkflowStageAgent({ run, node, artifacts, executor, requestedBy: 'fixture', runtime: 'electron' })
  assert(requests.some((item) => item.tools.includes('read')))
  for (const marker of ['RAW_BODY_MARKER', 'DESIGN_PROPOSAL_MARKER', 'APPROVED_CLARIFICATION_INPUT']) {
    assert(requests.some((item) => item.prompt.includes(marker)), `Missing ${marker} in real Provider request`)
  }
  assert.equal(result.artifact.designEvidence?.repositoryFindings?.citations[0]?.path, 'task.ts')
  assert(result.artifact.designEvidence?.repositoryFindings?.citations[0]?.contentDigest.match(/^[a-f0-9]{64}$/u))
  assert.equal(await readFile(path.join(repository, 'task.ts'), 'utf8'), 'export const tasks = []\n')
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }), '')
  const completed = completeWorkflowAgentNode({ run, nodeId: node.id, artifacts, generatedArtifact: result.artifact,
    existingEvents: created.events, actorName: 'Fixture', now: result.artifact.updatedAt })
  assert.equal(completed.nextNode.kind, 'gate')
  assert.equal(completed.nextNode.status, 'running')
  const dbPath = path.join(root, 'devflow.sqlite')
  const store = await createLocalStore({ dbPath })
  await store.saveRun(completed.run)
  for (const artifact of completed.artifacts) await store.saveArtifact(artifact)
  const restarted = await createLocalStore({ dbPath })
  assert.deepEqual((await restarted.listArtifacts(run.id)).find((item) => item.id === result.artifact.id)?.designEvidence, result.artifact.designEvidence)
  assert.equal(await restarted.getCodingRuntimeConfiguration(run.projectId), null)

  hold = true
  const controller = new AbortController()
  const pending = runWorkflowStageAgent({ run, node, artifacts, executor, requestedBy: 'fixture', runtime: 'electron', signal: controller.signal })
  await Promise.race([held, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Cancel fixture never reached Provider')), 30_000); timer.unref() })])
  controller.abort()
  await assert.rejects(pending, { terminalReason: 'cancelled' })
  assert.equal((await restarted.getRun(run.id))?.currentNodeId, completed.nextNode.id)
  if (process.argv.includes('--electron')) {
    await manager.stopAll()
    const { verifyDesignInElectron } = await import('./stage-agent-design-electron.mts')
    await verifyDesignInElectron({ root, repository, run, artifacts, endpoint: `http://127.0.0.1:${address.port}/v1`,
      setHold: (value) => { hold = value }, requestCount: () => requests.length })
  }
  console.log(JSON.stringify({ passed: true, realOpenCode: true, provider: 'local synthetic / no paid model',
    providerRequests: requests.length, readCitations: result.artifact.designEvidence?.repositoryFindings?.citations.length,
    repositoryUnchanged: true, restartEvidencePreserved: true, codingConfigurationUnchanged: true,
    stoppedAtReviewGate: true, cancellation: 'cancelled without artifact or workflow transition' }, null, 2))
} finally {
  await manager.stopAll()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}
