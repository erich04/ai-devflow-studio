import {
  buildCodingBrief,
} from '../packages/shared/src/coding-agent.ts'
import type {
  LocalProject,
  WorkflowNode,
  WorkflowRun,
} from '../packages/shared/src/domain.ts'
import type { CodingEngineApprovePermissionCompletedResult } from '../apps/desktop/electron/coding-engine.ts'
import type {
  OpencodeProviderEgressGate,
  OpencodeProviderEgressGateSnapshot,
} from './opencode-provider-egress-gate.ts'
import {
  evaluateOpencodeSmokePreflight,
  resolveOpencodeSmokeConfigContent,
} from './opencode-smoke-preflight'
import {
  assertCandidateIdentity,
  assertCleanCandidateStatus,
  assertCleanFixtureStatus,
  assertOpencodeSmokeChangedPaths,
  assertOpencodeSmokePermission,
  buildIsolatedOpencodeSmokeRuntimeEnv,
  combineOpencodeSmokeFailures,
  createOpencodeSmokeStageError,
  opencodeSmokeErrorMessages,
  OPENCODE_SMOKE_MARKER,
  type CandidateGitIdentity,
  type OpencodeSmokeStage,
} from './opencode-smoke-policy.ts'

type ReadyOpencodeSmokePreflight = Extract<
  ReturnType<typeof evaluateOpencodeSmokePreflight>,
  { mode: 'ready' }
>

const preflight = evaluateOpencodeSmokePreflight(process.env)

if (preflight.mode === 'skip') {
  console.log(preflight.message)
  process.exit(0)
}

if (preflight.mode === 'blocked') {
  console.error(preflight.message)
  process.exit(1)
}

async function main(preflight: ReadyOpencodeSmokePreflight) {
  const { execFile } = await import('node:child_process')
  const { access, mkdir, mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const { promisify } = await import('node:util')
  const {
    createOpencodeHttpCodingEngineAdapter,
  } = await import('../apps/desktop/electron/opencode-http-engine.ts')
  const { createOpencodeProcessManager } = await import('../apps/desktop/electron/opencode-process.ts')
  const { createReleaseSmokeOpencodePermissionRules } = await import('../apps/desktop/electron/opencode-http-adapter.ts')
  const { createManagedCodingWorkspace, deleteManagedCodingWorkspace } = await import('../apps/desktop/electron/coding-runner.ts')
  const { runDependencyBootstrap } = await import('../apps/desktop/electron/dependency-bootstrap-runner.ts')
  const { runLocalTestCommand } = await import('../apps/desktop/electron/test-runner.ts')
  const { createOpencodeProviderEgressGate } = await import('./opencode-provider-egress-gate.ts')

  const execFileAsync = promisify(execFile)
  const candidateRoot = process.cwd()
  const readGitOutput = async (cwd: string, args: string[], failureMessage: string) => {
    try {
      const result = await execFileAsync('git', args, { cwd })
      return String(result.stdout)
    } catch {
      throw new Error(failureMessage)
    }
  }
  const readGitStatus = (cwd: string) =>
    readGitOutput(
      cwd,
      ['status', '--porcelain=v1', '--untracked-files=all'],
      'opencode smoke could not verify Git worktree cleanliness',
    )
  const readCandidateIdentity = async (): Promise<CandidateGitIdentity> => ({
    head: (
      await readGitOutput(
        candidateRoot,
        ['rev-parse', 'HEAD'],
        'opencode smoke could not verify candidate Git identity',
      )
    ).trim(),
    branch: (
      await readGitOutput(
        candidateRoot,
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        'opencode smoke could not verify candidate Git identity',
      )
    ).trim(),
  })
  assertCleanCandidateStatus(await readGitStatus(candidateRoot))
  const initialCandidateIdentity = await readCandidateIdentity()
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'devflow-opencode-smoke-'))
  const repoDir = path.join(tempRoot, 'repo')
  const worktreeRoot = path.join(tempRoot, 'worktrees')
  const opencodeRuntimeRoot = path.join(tempRoot, 'opencode-runtime')
  const opencodeRuntimeEnv = buildIsolatedOpencodeSmokeRuntimeEnv(
    process.env,
    preflight.apiKeyEnvName,
    opencodeRuntimeRoot,
    { includeApiKey: preflight.releaseProfile !== 'v1.4' },
  )
  const now = new Date().toISOString()
  let activeStage: OpencodeSmokeStage = 'setup'
  let processManager: ReturnType<typeof createOpencodeProcessManager> | undefined
  let providerEgressGate: OpencodeProviderEgressGate | undefined
  let fixtureRepositoryReady = false
  let hasPrimaryError = false
  let primaryError: unknown
  let successChangedPaths: string[] | undefined
  let successfulProviderEgress: OpencodeProviderEgressGateSnapshot | undefined
  const setupRepository = async () => {
    await execFileAsync('git', ['init', repoDir])
    await execFileAsync('git', ['config', 'user.email', 'devflow@example.com'], { cwd: repoDir })
    await execFileAsync('git', ['config', 'user.name', 'DevFlow Smoke'], { cwd: repoDir })
    await writeFile(
      path.join(repoDir, 'package.json'),
      JSON.stringify({
        name: 'opencode-smoke',
        scripts: {
          test: 'node test.js',
        },
      }),
    )
    await writeFile(path.join(repoDir, 'test.js'), "console.log('opencode smoke tests passed')\n")
    await execFileAsync('npm', ['install', '--package-lock-only', '--ignore-scripts'], { cwd: repoDir })
    await execFileAsync('git', ['add', '.'], { cwd: repoDir })
    await execFileAsync('git', ['commit', '-m', 'fixture'], { cwd: repoDir })
  }

  try {
    await Promise.all(
      ['home', 'tmp', 'config', 'data', 'cache', 'state'].map((name) =>
        mkdir(path.join(opencodeRuntimeRoot, name), { recursive: true }),
      ),
    )
    if (preflight.releaseProfile === 'v1.4') {
      providerEgressGate = await createOpencodeProviderEgressGate({
        providerApiKey: process.env[preflight.apiKeyEnvName]!,
      })
      providerEgressGate.installClientCredential(
        opencodeRuntimeEnv,
        preflight.apiKeyEnvName,
      )
    }
    const resolvedConfigContent = resolveOpencodeSmokeConfigContent(
      preflight,
      process.env.OPENCODE_CONFIG_CONTENT,
      providerEgressGate?.baseUrl,
    )
    if (resolvedConfigContent) {
      opencodeRuntimeEnv.OPENCODE_CONFIG_CONTENT = resolvedConfigContent
    } else {
      delete opencodeRuntimeEnv.OPENCODE_CONFIG_CONTENT
    }
    await setupRepository()
    fixtureRepositoryReady = true
    const userInstruction =
      'Execute this task now and do not answer with prose before invoking tools. First invoke bash with exactly `pwd` once. After that tool is approved, invoke edit to create only devflow-opencode-smoke.txt with a short success message. Do not change any other path. After the edit, stop using tools and complete.'
    const node: WorkflowNode = {
      id: 'n-build',
      stage: 'build',
      title: 'Implement smoke marker',
      subtitle: 'Create a marker file in the managed worktree.',
      kind: 'task',
      status: 'running',
      ownerId: 'devflow-smoke',
      retryCount: 0,
      artifactIds: [],
    }
    const run: WorkflowRun = {
      id: 'run-opencode-smoke',
      version: 1,
      title: 'opencode smoke run',
      request: 'Create a tiny smoke marker file and keep the change minimal.',
      projectId: 'project-opencode-smoke',
      creatorId: 'devflow-smoke',
      status: 'building',
      currentNodeId: node.id,
      branchName: 'devflow/opencode-smoke',
      nodes: [node],
      edges: [],
      createdAt: now,
      updatedAt: now,
    }
    const project: LocalProject = {
      id: 'project-opencode-smoke',
      name: 'opencode-smoke',
      path: repoDir,
      packageManager: 'npm',
      testCommand: 'npm test',
      createdAt: now,
      updatedAt: now,
    }
    activeStage = 'workspace_create'
    const workspace = await createManagedCodingWorkspace({
      project,
      codingRunId: 'coding-run-opencode-smoke',
      runId: run.id,
      nodeId: node.id,
      worktreeRoot,
    })
    const briefContext = {
      upstreamArtifacts: [],
      knowledgeReferences: [],
      governanceChecks: [],
      gateDecisions: [],
      testEvidence: [],
    }
    const brief = buildCodingBrief({
      run,
      node,
      project,
      ...briefContext,
      userInstruction,
      worktreePath: '<managed-worktree-created-after-budget-approval>',
      branchName: '<managed-branch-created-after-budget-approval>',
    })
    activeStage = 'engine_start'
    processManager = createOpencodeProcessManager()
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: preflight.binaryPath,
      providerID: preflight.providerID,
      modelID: preflight.modelID,
      apiKeyEnvName: preflight.apiKeyEnvName,
      processManager,
      runtimeEnv: opencodeRuntimeEnv,
      permissionDiscoveryTimeoutMs: 240_000,
      ...(preflight.releaseProfile === 'v1.4'
        ? { permissionRules: createReleaseSmokeOpencodePermissionRules() }
        : {}),
    })

    providerEgressGate?.allowInitialProviderStep()
    const started = await engine.start({
      id: 'coding-run-opencode-smoke',
      run,
      node,
      project,
      workspace,
      requestedBy: 'devflow-smoke',
      providerId: preflight.providerID,
      userInstruction,
      now,
      ...briefContext,
      brief,
    })
    activeStage = 'permission_relay'
    let codingRun = started.codingRun
    let permissionRequest = started.permissionRequest
    const codingEvents = [...started.events]
    let completed: CodingEngineApprovePermissionCompletedResult | undefined
    for (let approvalCount = 0; approvalCount < 4; approvalCount += 1) {
      assertOpencodeSmokePermission(permissionRequest)
      const releasePermission = permissionRequest.permission
      if (releasePermission !== 'bash' && releasePermission !== 'edit') {
        throw new Error('opencode smoke blocked an unexpected permission request')
      }
      await providerEgressGate?.allowNextProviderStep(permissionRequest.id, releasePermission)
      console.log(`opencode requested ${permissionRequest.permission}; approving once.`)
      const result = await engine.approvePermission({
        codingRun,
        workspace,
        project,
        request: permissionRequest,
        now: new Date().toISOString(),
      })
      codingEvents.push(...result.events)
      if ('permissionRequest' in result) {
        codingRun = result.codingRun
        permissionRequest = result.permissionRequest
        continue
      }
      completed = result
      break
    }

    if (!completed) {
      throw new Error('opencode smoke exceeded the permission approval limit.')
    }
    providerEgressGate?.assertPassingState()

    activeStage = 'diff_validation'
    assertOpencodeSmokeChangedPaths(completed.diff.changedPaths)
    const markerPath = path.join(workspace.worktreePath, OPENCODE_SMOKE_MARKER)
    const markerContents = await readFile(markerPath, 'utf8')
    if (!markerContents.trim() || Buffer.byteLength(markerContents, 'utf8') > 256) {
      throw new Error('opencode smoke marker contents were missing or unexpectedly large')
    }
    try {
      await access(path.join(repoDir, OPENCODE_SMOKE_MARKER))
      throw new Error('opencode smoke wrote the marker outside the managed worktree')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
    if (!codingEvents.some((event) => event.kind === 'tool_call')) {
      throw new Error('opencode smoke did not record a tool_call coding event.')
    }
    if (!codingEvents.some((event) => event.kind === 'tool_result')) {
      throw new Error('opencode smoke did not record a tool_result coding event.')
    }
    const metadataBlob = JSON.stringify(codingEvents.map((event) => event.metadata ?? {}))
    const providerKey = process.env[preflight.apiKeyEnvName]
    if (
      providerKey &&
      [metadataBlob, markerContents, completed.diff.patch].some((value) => value.includes(providerKey))
    ) {
      throw new Error('opencode smoke leaked the provider key into managed evidence')
    }
    for (const forbidden of ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'raw stdout', 'raw stderr']) {
      if (metadataBlob.includes(forbidden)) {
        throw new Error(`opencode smoke leaked forbidden metadata marker: ${forbidden}`)
      }
    }
    if (metadataBlob.includes(workspace.worktreePath) || metadataBlob.includes(repoDir)) {
      throw new Error('opencode smoke leaked an absolute workspace path in tool metadata.')
    }

    activeStage = 'dependency_bootstrap'
    const bootstrap = await runDependencyBootstrap({
      codingRunId: completed.codingRun.id,
      runId: completed.codingRun.runId,
      nodeId: completed.codingRun.nodeId,
      projectId: completed.codingRun.projectId,
      worktreePath: workspace.worktreePath,
      runCommand: runLocalTestCommand,
      timeoutMs: 120_000,
      now: new Date().toISOString(),
    })
    if (bootstrap.status !== 'passed' && bootstrap.status !== 'skipped') {
      throw new Error(`Dependency bootstrap did not pass: ${bootstrap.status} ${bootstrap.summary}`)
    }

    activeStage = 'test_execution'
    const tests = await runLocalTestCommand({
      command: project.testCommand,
      cwd: workspace.worktreePath,
      timeoutMs: 120_000,
    })
    if (tests.status !== 'passed') {
      throw new Error(`opencode smoke tests did not pass: ${tests.summary}`)
    }

    activeStage = 'runtime_cleanup'
    await processManager.stopAll()
    await providerEgressGate?.close()
    successfulProviderEgress = providerEgressGate?.snapshot()
    activeStage = 'workspace_cleanup'
    const deletedWorkspace = await deleteManagedCodingWorkspace(workspace)
    if (deletedWorkspace.cleanupStatus !== 'deleted') {
      throw new Error(`Managed worktree cleanup did not complete: ${deletedWorkspace.cleanupStatus}`)
    }
    successChangedPaths = completed.diff.changedPaths
  } catch (error) {
    primaryError = createOpencodeSmokeStageError(activeStage, error)
    hasPrimaryError = true
  }

  const safetyErrors: unknown[] = []
  try {
    await processManager?.stopAll()
  } catch (cause) {
    safetyErrors.push(new Error('opencode smoke could not stop the managed runtime', { cause }))
  }
  try {
    await providerEgressGate?.close()
    const egressSnapshot = providerEgressGate?.snapshot()
    if (
      egressSnapshot &&
      (egressSnapshot.blockedUncreditedRequestCount !== 0 ||
        egressSnapshot.blockedInvalidCount !== 0 ||
        egressSnapshot.failedSegmentCount !== 0 ||
        egressSnapshot.activeRequestCount !== 0 ||
        !egressSnapshot.closed)
    ) {
      throw new Error('opencode smoke provider egress integrity check failed')
    }
  } catch (cause) {
    safetyErrors.push(new Error('opencode smoke could not close its provider egress gate', { cause }))
  }
  try {
    assertCleanCandidateStatus(await readGitStatus(candidateRoot))
  } catch (error) {
    safetyErrors.push(error)
  }
  try {
    assertCandidateIdentity(initialCandidateIdentity, await readCandidateIdentity())
  } catch (error) {
    safetyErrors.push(error)
  }
  if (fixtureRepositoryReady) {
    try {
      assertCleanFixtureStatus(await readGitStatus(repoDir))
    } catch (error) {
      safetyErrors.push(error)
    }
  }
  try {
    await rm(tempRoot, { recursive: true, force: true })
  } catch (cause) {
    safetyErrors.push(new Error('opencode smoke could not remove its temporary fixture', { cause }))
  }

  const failure = combineOpencodeSmokeFailures(
    hasPrimaryError ? primaryError : undefined,
    safetyErrors,
  )
  if (failure !== undefined) {
    throw failure
  }
  if (!successChangedPaths) {
    throw new Error('opencode smoke finished without a result')
  }
  if (preflight.releaseProfile === 'v1.4') {
    if (!successfulProviderEgress) {
      throw new Error('opencode smoke finished without provider egress evidence')
    }
    console.log(
      [
        'opencode provider egress passed',
        `armed=${successfulProviderEgress.armedSegmentCount}`,
        `forwarded=${successfulProviderEgress.forwardedRequestCount}`,
        `completed=${successfulProviderEgress.completedResponseCount}`,
        `blocked_uncredited=${successfulProviderEgress.blockedUncreditedRequestCount}`,
        `blocked_invalid=${successfulProviderEgress.blockedInvalidCount}`,
        `failed=${successfulProviderEgress.failedSegmentCount}`,
        `active=${successfulProviderEgress.activeRequestCount}`,
        `closed=${String(successfulProviderEgress.closed)}`,
      ].join('; '),
    )
  }
  console.log(`opencode smoke passed; changed paths: ${successChangedPaths.join(', ')}`)
}

if (preflight.mode === 'ready') {
  main(preflight).catch((error) => {
    for (const message of opencodeSmokeErrorMessages(error, process.env[preflight.apiKeyEnvName])) {
      console.error(message)
    }
    process.exit(1)
  })
}
