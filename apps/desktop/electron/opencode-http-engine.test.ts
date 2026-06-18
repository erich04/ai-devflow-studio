import { describe, expect, it, vi } from 'vitest'
import { projects, runs, type LocalProject, type ManagedCodingWorkspace } from '@ai-devflow/shared'
import { createOpencodeHttpCodingEngineAdapter, type OpencodeHttpProcessManager } from './opencode-http-engine'
import type { Fetcher } from './opencode-http-adapter'

describe('opencode HTTP coding engine', () => {
  it('creates a session, sends the DevFlow brief, and returns a relay permission request', async () => {
    const fetcher = sequenceFetcher([
      { id: 'ses-1' },
      {},
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' } }],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const result = await engine.start(startInput({ run, node, project, workspace }))

    expect(result.codingRun.engine).toBe('opencode-http')
    expect(result.codingRun.status).toBe('waiting_permission')
    expect(result.permissionRequest).toMatchObject({
      id: 'perm-1',
      permission: 'edit',
      filePath: 'src/app.ts',
      title: 'opencode requested edit permission',
    })
    expect(fetcher.urls).toEqual([
      'http://127.0.0.1:4097/session',
      'http://127.0.0.1:4097/session/ses-1/message',
      'http://127.0.0.1:4097/permission',
    ])
    expect(fetcher.bodies.join('\n')).toContain('Implement the build node.')
    expect(fetcher.bodies.join('\n')).toContain('DevFlow Coding Brief')
  })

  it('replies to approved permissions and captures a redacted opencode diff', async () => {
    const fetcher = sequenceFetcher([
      { id: 'ses-1' },
      {},
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' } }],
      true,
      [
        {
          file: 'src/app.ts',
          patch: "diff --git a/src/app.ts b/src/app.ts\n+const key = 'sk-live-secret'\n",
        },
      ],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = await engine.start(startInput({ run, node, project, workspace }))

    const completed = await engine.approvePermission({
      codingRun: started.codingRun,
      workspace,
      project,
      request: started.permissionRequest,
      now: '2026-06-17T00:00:01.000Z',
    })

    expect(fetcher.urls).toContain('http://127.0.0.1:4097/permission/perm-1/reply')
    expect(fetcher.urls).toContain('http://127.0.0.1:4097/session/ses-1/diff?directory=%2Ftmp%2Fworktree')
    expect(fetcher.bodies).toContain(
      JSON.stringify({
        directory: '/tmp/worktree',
        reply: 'once',
        message: 'Approved by DevFlow.',
      }),
    )
    expect(completed.codingRun.status).toBe('completed')
    expect(completed.diff.changedPaths).toEqual(['src/app.ts'])
    expect(completed.diff.patch).not.toContain('sk-live-secret')
    expect(completed.bootstrapEvidence).toBeUndefined()
  })

  it('falls back to managed worktree diff capture when opencode returns no diff files', async () => {
    const fetcher = sequenceFetcher([
      { id: 'ses-1' },
      {},
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'new-file.txt' } }],
      true,
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      fetcher,
      captureWorktreeDiff: async () => ({
        changedPaths: ['new-file.txt'],
        patch: 'diff --git a/new-file.txt b/new-file.txt\n+hello\n',
      }),
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = await engine.start(startInput({ run, node, project, workspace }))

    const completed = await engine.approvePermission({
      codingRun: started.codingRun,
      workspace,
      project,
      request: started.permissionRequest,
      now: '2026-06-17T00:00:01.000Z',
    })

    expect(completed.diff.changedPaths).toEqual(['new-file.txt'])
    expect(completed.diff.patch).toContain('+hello')
  })

  it('uses managed worktree diff when the opencode message stream closes after applying changes', async () => {
    const fetcher = sequenceFetcher([
      { id: 'ses-1' },
      new TypeError('fetch failed'),
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'new-file.txt' } }],
      true,
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      fetcher,
      captureWorktreeDiff: async () => ({
        changedPaths: ['new-file.txt'],
        patch: 'diff --git a/new-file.txt b/new-file.txt\n+hello\n',
      }),
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = await engine.start(startInput({ run, node, project, workspace }))

    const completed = await engine.approvePermission({
      codingRun: started.codingRun,
      workspace,
      project,
      request: started.permissionRequest,
      now: '2026-06-17T00:00:01.000Z',
    })

    expect(completed.codingRun.status).toBe('completed')
    expect(completed.diff.changedPaths).toEqual(['new-file.txt'])
  })

  it('aborts the matching opencode session when cancelled', async () => {
    const fetcher = sequenceFetcher([
      { id: 'ses-1' },
      {},
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' } }],
      true,
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = await engine.start(startInput({ run, node, project, workspace }))

    await engine.cancel({ codingRun: started.codingRun })

    expect(fetcher.urls).toContain('http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree')
  })
})

function readyServer(): OpencodeHttpProcessManager {
  return {
    ensure: vi.fn(async () => ({
      baseUrl: 'http://127.0.0.1:4097',
      child: {} as never,
      projectId: 'local-1',
    })),
  }
}

function sequenceFetcher(responses: unknown[]): Fetcher & { urls: string[]; bodies: string[] } {
  const queue = [...responses]
  const urls: string[] = []
  const bodies: string[] = []
  const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
    urls.push(String(input))
    if (init?.body) {
      bodies.push(String(init.body))
    }
    const body = queue.shift()
    if (body instanceof Error) {
      throw body
    }
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as Fetcher & { urls: string[]; bodies: string[] }
  fetcher.urls = urls
  fetcher.bodies = bodies
  return fetcher
}

function managedWorkspace(projectId: string, runId: string, nodeId: string): ManagedCodingWorkspace {
  void runId
  void nodeId
  return {
    id: 'workspace-1',
    projectId,
    codingRunId: 'coding-run-1',
    sourcePath: '/tmp/repo',
    worktreePath: '/tmp/worktree',
    branchName: 'devflow/coding-run-1',
    baseBranch: 'main',
    createdAt: '2026-06-17T00:00:00.000Z',
  }
}

function startInput(input: {
  run: typeof runs[number]
  node: typeof runs[number]['nodes'][number]
  project: ReturnType<typeof localProject>
  workspace: ManagedCodingWorkspace
}) {
  return {
    id: 'coding-run-1',
    run: input.run,
    node: input.node,
    project: input.project,
    workspace: input.workspace,
    requestedBy: 'u-erich',
    providerId: 'openai',
    userInstruction: 'Implement the build node.',
    now: '2026-06-17T00:00:00.000Z',
    upstreamArtifacts: [],
    knowledgeReferences: [],
    governanceChecks: [],
    gateDecisions: [],
    testEvidence: [],
  }
}

function localProject(project: { id: string; name: string }): LocalProject {
  return {
    id: project.id,
    name: project.name,
    path: '/tmp/repo',
    packageManager: 'npm',
    testCommand: 'npm test',
    createdAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:00.000Z',
  }
}
