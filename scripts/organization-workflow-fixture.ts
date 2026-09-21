import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  canApproveGate, createTestEvidenceArtifact, createTestEvidenceEvent, createWorkflowRunFromRequest,
  type Artifact, type DesktopPairingCredential, type GitHubDeliveryIntent,
  type LocalProject, type TestEvidence, type WorkflowRun,
} from '../packages/shared/src/index'
import { createLocalStore } from '../apps/desktop/electron/local-store'
import { createManagedCodingWorkspace, createFakeCodingRunBundle, completeFakeCodingRun } from '../apps/desktop/electron/coding-runner'
import { runLocalTestCommand } from '../apps/desktop/electron/test-runner'
import { createWorkflowRuntime, resolveTrustedWorkflowActor, type ExecuteWorkflowCommandInput } from '../apps/desktop/electron/workflow-runtime'

const exec = promisify(execFile)

/** Deterministic external-provider fixtures; real Git, SQLite and workflow commands.
 * This is tenancy regression evidence, not a live LLM or GitHub publication test.
 */
export async function completeOrganizationWorkflow(input: {
  root: string; runId: string; pairing: DesktopPairingCredential
  onTransition: (run: WorkflowRun) => Promise<void>
}) {
  const { root, runId, pairing } = input
  const source = path.join(root, 'source')
  await mkdir(source, { recursive: true })
  await writeFile(path.join(source, 'verify.cjs'), [
    "const assert = require('node:assert/strict');",
    "const { readFileSync } = require('node:fs');",
    `assert.ok(readFileSync('devflow-fake-change.txt', 'utf8').includes(${JSON.stringify(`Run: ${runId}`)}));`,
    "console.log('isolated managed-worktree change verified');",
  ].join('\n'))
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Tenancy Test'], ['config', 'user.email', 'tenancy@example.invalid'], ['add', '.'], ['-c', 'commit.gpgsign=false', 'commit', '-m', 'Isolated test project']]) {
    await exec('git', args, { cwd: source })
  }
  let step = 0
  const timestamp = () => new Date(Date.UTC(2026, 8, 21, 0, 0, step++)).toISOString()
  const now = timestamp()
  const project: LocalProject = { id: pairing.localProjectId!, name: 'Isolated workflow', path: source, packageManager: 'unknown', testCommand: 'node verify.cjs', detectedTestCommand: 'node verify.cjs', createdAt: now, updatedAt: now }
  const dbPath = path.join(root, 'devflow.sqlite')
  const store = await createLocalStore({ dbPath })
  try {
    await store.upsertProject(project)
    await store.saveDesktopPairingCredential(pairing, 'test-only-encrypted-pairing')
    const created = createWorkflowRunFromRequest({ runId, projectId: project.id, creatorId: pairing.userId, title: `Workflow ${runId}`, request: `Create a test marker owned only by ${runId}.`, branchName: `ai/${runId}`, now })
    await store.saveRun(created.run)
    for (const artifact of created.artifacts) await store.saveArtifact(artifact)
    // Only the external GitHub outcome is substituted. Workflow admission, local
    // transitions and all candidate/evidence persistence use production functions.
    let deliveries: GitHubDeliveryIntent[] = []
    const runtime = createWorkflowRuntime({
      getRun: store.getRun.bind(store), listArtifacts: store.listArtifacts.bind(store),
      listCodingAgentRuns: store.listCodingAgentRuns.bind(store), listCodingDiffArtifacts: store.listCodingDiffArtifacts.bind(store),
      listTestEvidence: store.listTestEvidence.bind(store), listAgentReviews: store.listAgentReviews.bind(store),
      listGitHubDeliveryIntents: async id => deliveries.filter(d => !id || d.runId === id),
      commitWorkflowMutation: store.commitWorkflowMutation.bind(store),
    })
    const actor = resolveTrustedWorkflowActor(created.run, pairing)
    async function apply(command: ExecuteWorkflowCommandInput['command'], candidates?: ExecuteWorkflowCommandInput['candidates']) {
      const node = created.run.nodes.find(node => node.id === command.nodeId)!
      const approval = { roleAllowed: canApproveGate(actor.role, node), policy: { blocksApproval: false }, review: 'not_required' as const, budget: 'not_required' as const }
      const result = await runtime.execute({ runId, command, ...(candidates ? { candidates } : {}), approval, now: timestamp() })
      if (!result.applied) throw new Error(`${command.type}: ${JSON.stringify(result.blockers)}`)
      await input.onTransition(result.run)
      return result.run
    }
    function artifact(stage: string, kind: Artifact['kind']): Artifact {
      return { id: `artifact-${runId}-${stage}`, runId, nodeId: `${runId}-${stage}`, kind, title: `Test ${kind}`, summary: `Only ${runId}`, content: `Deterministic test ${kind} for ${runId}.`, redacted: true, updatedAt: timestamp() }
    }
    for (const [stage, kind] of [['clarify', 'clarification'], ['design', 'design']] as const) {
      const output = artifact(stage, kind)
      await apply({ type: 'complete_agent', nodeId: output.nodeId, artifactId: output.id }, { artifacts: [output] })
      await apply({ type: 'approve_gate', nodeId: `${runId}-${stage}-gate` })
    }
    const codingId = `coding-${runId}`
    const workspace = await createManagedCodingWorkspace({ project, runId, nodeId: `${runId}-build`, codingRunId: codingId, worktreeRoot: path.join(root, 'worktrees') })
    await store.saveManagedCodingWorkspace(workspace)
    const bundle = createFakeCodingRunBundle({ id: codingId, runId, nodeId: `${runId}-build`, project, workspace, requestedBy: actor.userId, userInstruction: `Only ${runId}`, now: timestamp() })
    await store.saveCodingPermissionRequest({ ...bundle.permissionRequest, status: 'approved' })
    await store.saveCodingPermissionDecision({ id: `decision-${runId}`, requestId: bundle.permissionRequest.id, codingRunId: codingId, decidedBy: actor.userId, decision: 'approved', comment: 'Approve isolated test marker', decidedAt: timestamp() })
    const coding = await completeFakeCodingRun({ codingRun: bundle.codingRun, workspace, project, now: timestamp() })
    await store.saveCodingAgentRun(coding.codingRun)
    await store.saveCodingDiffArtifact(coding.diff)
    await store.saveDependencyBootstrapEvidence(coding.bootstrapEvidence)
    await apply({ type: 'complete_build', nodeId: `${runId}-build`, codingRunId: codingId, diffId: coding.diff.id })
    const tested = await runLocalTestCommand({ command: project.testCommand, cwd: workspace.worktreePath, timeoutMs: 10_000 })
    if (tested.status !== 'passed') throw new Error(`Managed-worktree test failed: ${tested.stderr}`)
    const evidence: TestEvidence = { ...tested, id: `evidence-${runId}`, runId, nodeId: `${runId}-test`, projectId: project.id, command: project.testCommand, cwd: workspace.worktreePath, createdAt: timestamp() }
    const report = createTestEvidenceArtifact(evidence)
    await apply({ type: 'record_test_result', nodeId: evidence.nodeId, evidenceId: evidence.id, artifactId: report.id }, { artifacts: [report], testEvidence: [evidence], events: [createTestEvidenceEvent(evidence, 2)] })
    const pr = artifact('pr', 'pr')
    const ready = await apply({ type: 'attach_pr_package', nodeId: pr.nodeId, artifactId: pr.id }, { artifacts: [pr] })
    // An explicitly synthetic provider result, never sent to GitHub.
    deliveries = [{
      stateVersion: 1, id: `delivery-${runId}`, organizationId: pairing.organizationId,
      teamProjectId: pairing.projectId, localProjectId: project.id, runId, runVersion: ready.version, nodeId: pr.nodeId,
      repositoryBindingId: `binding-${runId}`, repositoryBindingVersion: 1, installationId: '123', repositoryId: '456',
      codingRunId: codingId, codingRunCompletedAt: coding.codingRun.completedAt!, workspaceId: workspace.id,
      deliverySeriesKey: `github-delivery:${'7'.repeat(64)}`, deliveryAttempt: 1, repository: 'example/tenancy-test',
      baseBranch: 'main', headBranch: workspace.branchName, baseCommitSha: workspace.baseCommitSha!, expectedCommitSha: '1'.repeat(40),
      diffArtifactId: coding.diff.id, diffSourceDigest: coding.diff.sourceDigest!, testEvidenceId: evidence.id,
      testEvidenceCreatedAt: evidence.createdAt, testEvidenceDigest: '3'.repeat(64),
      prPackageArtifactId: pr.id, prPackageUpdatedAt: pr.updatedAt, prPackageDigest: '4'.repeat(64),
      changedPaths: coding.diff.changedPaths, intentDigest: '5'.repeat(64), idempotencyKey: `github-delivery:${'6'.repeat(64)}`,
      status: 'completed', completion: { stateVersion: 1, remoteRequestId: `remote-${runId}`, publicationId: `publication-${runId}`,
        pullRequestOutcomeId: `outcome-${runId}`, pullRequestId: '789', pullRequestNumber: 42,
        pullRequestUrl: 'https://github.com/example/tenancy-test/pull/42', providerCreatedAt: timestamp(), recordedAt: timestamp(), draft: true, redacted: true },
      createdAt: timestamp(), updatedAt: timestamp(), redacted: true,
    }]
    await apply({ type: 'complete_pr', nodeId: pr.nodeId, artifactId: pr.id })
    const acceptance = artifact('accept', 'acceptance')
    await apply({ type: 'attach_acceptance_bundle', nodeId: acceptance.nodeId, artifactId: acceptance.id }, { artifacts: [acceptance] })
    const completed = await apply({ type: 'approve_acceptance', nodeId: acceptance.nodeId })
    const sourceStatus = await exec('git', ['status', '--porcelain'], { cwd: source })
    return { dbPath, completed, sourceStatus: sourceStatus.stdout, marker: await readFile(path.join(workspace.worktreePath, 'devflow-fake-change.txt'), 'utf8'), evidence, permissionId: bundle.permissionRequest.id }
  } finally { store.close() }
}
