import { evaluateOpencodeSmokePreflight } from './opencode-smoke-preflight'

const preflight = evaluateOpencodeSmokePreflight(process.env)

if (preflight.mode === 'skip') {
  console.log(preflight.message)
  process.exit(0)
}

if (preflight.mode === 'blocked') {
  console.error(preflight.message)
  process.exit(1)
}

async function main() {
  const { execFile } = await import('node:child_process')
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const { promisify } = await import('node:util')
  const {
    createOpencodeHttpCodingEngineAdapter,
  } = await import('../apps/desktop/electron/opencode-http-engine.ts')
  const { createOpencodeProcessManager } = await import('../apps/desktop/electron/opencode-process.ts')
  const { createManagedCodingWorkspace } = await import('../apps/desktop/electron/coding-runner.ts')
  const { runDependencyBootstrap } = await import('../apps/desktop/electron/dependency-bootstrap-runner.ts')
  const { runLocalTestCommand } = await import('../apps/desktop/electron/test-runner.ts')

  const execFileAsync = promisify(execFile)
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'devflow-opencode-smoke-'))
  const repoDir = path.join(tempRoot, 'repo')
  const worktreeRoot = path.join(tempRoot, 'worktrees')
  const now = new Date().toISOString()
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
  await setupRepository()
  const run = {
    id: 'run-opencode-smoke',
    title: 'opencode smoke run',
    request: 'Create a tiny smoke marker file and keep the change minimal.',
    projectId: 'project-opencode-smoke',
    status: 'running' as const,
    branchName: 'devflow/opencode-smoke',
    nodes: [
      {
        id: 'n-build',
        stage: 'build' as const,
        title: 'Implement smoke marker',
        subtitle: 'Create a marker file in the managed worktree.',
        kind: 'task' as const,
        status: 'running' as const,
      },
    ],
    artifacts: [],
    events: [],
    createdAt: now,
    updatedAt: now,
  }
  const node = run.nodes[0]!
  const project = {
    id: 'project-opencode-smoke',
    name: 'opencode-smoke',
    path: repoDir,
    packageManager: 'npm' as const,
    testCommand: 'npm test',
    createdAt: now,
    updatedAt: now,
  }
  const workspace = await createManagedCodingWorkspace({
    project,
    codingRunId: 'coding-run-opencode-smoke',
    runId: run.id,
    nodeId: node.id,
    worktreeRoot,
  })
  const processManager = createOpencodeProcessManager()
  const engine = createOpencodeHttpCodingEngineAdapter({
    binaryPath: preflight.binaryPath,
    providerID: preflight.providerID,
    modelID: preflight.modelID,
    apiKeyEnvName: preflight.apiKeyEnvName,
    processManager,
    runtimeEnv: process.env,
    permissionDiscoveryTimeoutMs: 120_000,
  })

  const started = await engine.start({
    id: 'coding-run-opencode-smoke',
    run,
    node,
    project,
    workspace,
    requestedBy: 'devflow-smoke',
    providerId: preflight.providerID,
    userInstruction:
      'Create devflow-opencode-smoke.txt with a short success message. Use the edit tool directly; do not run bash, shell commands, package commands, or repository inspection.',
    now,
    upstreamArtifacts: [],
    knowledgeReferences: [],
    governanceChecks: [],
    gateDecisions: [],
    testEvidence: [],
  })
  console.log(`opencode requested ${started.permissionRequest.permission}; approving once.`)
  const completed = await engine.approvePermission({
    codingRun: started.codingRun,
    workspace,
    project,
    request: started.permissionRequest,
    now: new Date().toISOString(),
  })

  if (!completed.diff.changedPaths.length) {
    throw new Error('opencode smoke did not produce a changed path.')
  }

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

  const tests = await runLocalTestCommand({
    command: project.testCommand,
    cwd: workspace.worktreePath,
    timeoutMs: 120_000,
  })
  if (tests.status !== 'passed') {
    throw new Error(`opencode smoke tests did not pass: ${tests.summary}`)
  }

  await processManager.stopAll()
  console.log(`opencode smoke passed; changed paths: ${completed.diff.changedPaths.join(', ')}`)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
