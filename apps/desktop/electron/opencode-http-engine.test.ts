import { describe, expect, it, vi } from 'vitest'
import { projects, runs, type LocalProject, type ManagedCodingWorkspace } from '@ai-devflow/shared'
import type { CodingEngineApprovePermissionResult } from './coding-engine'
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

  it('records a redacted coding tool_call event from opencode permission metadata', async () => {
    const fetcher = sequenceFetcher([
      { id: 'ses-1' },
      {},
      [
        {
          id: 'perm-1',
          sessionID: 'ses-1',
          permission: 'bash',
          metadata: {
            skillName: 'shell-runner',
            tool: 'bash',
            command: 'ANTHROPIC_API_KEY=sk-ant-1234567890abcdefghijklmnop npm test',
            filepath: '/tmp/worktree/src/app.ts',
            stdout: 'raw output should not be stored',
          },
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

    const result = await engine.start(startInput({ run, node, project, workspace }))
    const toolCall = result.events.find((event) => event.kind === 'tool_call')

    expect(result.permissionRequest.filePath).toBe('src/app.ts')
    expect(toolCall).toMatchObject({
      message: 'opencode requested bash via bash.',
      redacted: true,
      metadata: {
        source: 'opencode_metadata',
        permissionRequestId: 'perm-1',
        permission: 'bash',
        toolName: 'bash',
        skillName: 'shell-runner',
        commandSummary: '[REDACTED:env_secret_assignment] npm test',
        filePath: 'src/app.ts',
        inputSummary: 'bash: [REDACTED:env_secret_assignment] npm test',
        redactionApplied: true,
      },
    })
    expect(JSON.stringify(toolCall?.metadata)).not.toContain('sk-ant')
    expect(JSON.stringify(toolCall?.metadata)).not.toContain('/tmp/worktree')
    expect(JSON.stringify(toolCall?.metadata)).not.toContain('raw output should not be stored')
  })

  it('redacts local absolute paths embedded in opencode tool command metadata', async () => {
    const fetcher = sequenceFetcher([
      { id: 'ses-1' },
      {},
      [
        {
          id: 'perm-1',
          sessionID: 'ses-1',
          permission: 'bash',
          metadata: {
            tool: 'bash',
            command: 'cd /tmp/worktree && cat /tmp/worktree/package.json && ls /tmp/repo',
          },
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

    const result = await engine.start(startInput({ run, node, project, workspace }))
    const toolCall = result.events.find((event) => event.kind === 'tool_call')
    const metadataBlob = JSON.stringify(toolCall?.metadata)

    expect(metadataBlob).not.toContain('/tmp/worktree')
    expect(metadataBlob).not.toContain('/tmp/repo')
    expect(toolCall?.metadata).toMatchObject({
      commandSummary:
        'cd [REDACTED:worktree_path] && cat [REDACTED:worktree_path]/package.json && ls [REDACTED:project_path]',
      inputSummary:
        'bash: cd [REDACTED:worktree_path] && cat [REDACTED:worktree_path]/package.json && ls [REDACTED:project_path]',
      redactionApplied: true,
    })
    expect(result.permissionRequest.command).toBe(
      'cd [REDACTED:worktree_path] && cat [REDACTED:worktree_path]/package.json && ls [REDACTED:project_path]',
    )
  })

  it('marks tool_call metadata as inferred when opencode permission metadata is empty', async () => {
    const fetcher = sequenceFetcher([
      { id: 'ses-1' },
      {},
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit' }],
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
    const toolCall = result.events.find((event) => event.kind === 'tool_call')

    expect(toolCall?.metadata).toMatchObject({
      source: 'inferred',
      permissionRequestId: 'perm-1',
      permission: 'edit',
      toolName: 'edit',
      inputSummary: 'edit permission requested',
      redactionApplied: false,
    })
  })

  it('normalizes relative metadata paths to portable separators', async () => {
    const fetcher = sequenceFetcher([
      { id: 'ses-1' },
      {},
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src\\app.ts' } }],
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
    const toolCall = result.events.find((event) => event.kind === 'tool_call')

    expect(result.permissionRequest.filePath).toBe('src/app.ts')
    expect(toolCall?.metadata?.filePath).toBe('src/app.ts')
  })

  it('surfaces provider errors while waiting for the first permission request', async () => {
    const fetcher = sequenceFetcher([
      { id: 'ses-1' },
      new Error('provider subscription expired'),
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 100,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    await expect(engine.start(startInput({ run, node, project, workspace }))).rejects.toThrow(
      'provider subscription expired',
    )
  })

  it('replies to approved permissions and captures a redacted opencode diff', async () => {
    const fetcher = sequenceFetcher([
      { id: 'ses-1' },
      {},
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' } }],
      true,
      [],
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
    const completedResult = expectCompletedResult(completed)

    expect(fetcher.urls).toContain('http://127.0.0.1:4097/permission/perm-1/reply')
    expect(fetcher.urls).toContain('http://127.0.0.1:4097/session/ses-1/diff?directory=%2Ftmp%2Fworktree')
    expect(fetcher.bodies).toContain(
      JSON.stringify({
        directory: '/tmp/worktree',
        reply: 'once',
        message: 'Approved by DevFlow.',
      }),
    )
    expect(completedResult.codingRun.status).toBe('completed')
    expect(completedResult.diff.changedPaths).toEqual(['src/app.ts'])
    expect(completedResult.diff.patch).not.toContain('sk-live-secret')
    expect(completedResult.bootstrapEvidence).toBeUndefined()
    expect(completedResult.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_result',
          message: 'DevFlow approved opencode edit permission.',
          metadata: expect.objectContaining({
            permissionRequestId: 'perm-1',
            permission: 'edit',
            decision: 'approved',
            status: 'completed',
            outputSummary: 'DevFlow relay approved edit permission; opencode completed after the tool action.',
            redactionApplied: false,
          }),
        }),
      ]),
    )
  })

  it('falls back to managed worktree diff capture when opencode returns no diff files', async () => {
    const fetcher = sequenceFetcher([
      { id: 'ses-1' },
      {},
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'new-file.txt' } }],
      true,
      [],
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
    const completedResult = expectCompletedResult(completed)

    expect(completedResult.diff.changedPaths).toEqual(['new-file.txt'])
    expect(completedResult.diff.patch).toContain('+hello')
  })

  it('uses managed worktree diff when the opencode message stream closes after applying changes', async () => {
    const fetcher = sequenceFetcher([
      { id: 'ses-1' },
      new TypeError('fetch failed'),
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'new-file.txt' } }],
      true,
      [],
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
    const completedResult = expectCompletedResult(completed)

    expect(completedResult.codingRun.status).toBe('completed')
    expect(completedResult.diff.changedPaths).toEqual(['new-file.txt'])
  })

  it('returns the next opencode permission instead of completing when a second request appears', async () => {
    const fetcher = sequenceFetcher([
      { id: 'ses-1' },
      {},
      [{ id: 'perm-bash', sessionID: 'ses-1', permission: 'bash', metadata: { command: 'pwd' } }],
      true,
      [{ id: 'perm-edit', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'new-file.txt' } }],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      fetcher,
      captureWorktreeDiff: async () => ({
        changedPaths: [],
        patch: '',
      }),
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = await engine.start(startInput({ run, node, project, workspace }))

    const continued = await engine.approvePermission({
      codingRun: started.codingRun,
      workspace,
      project,
      request: started.permissionRequest,
      now: '2026-06-17T00:00:01.000Z',
    })

    expect(continued).toMatchObject({
      codingRun: { status: 'waiting_permission' },
      permissionRequest: {
        id: 'perm-edit',
        permission: 'edit',
        filePath: 'new-file.txt',
        status: 'pending',
      },
    })
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

function expectCompletedResult(result: CodingEngineApprovePermissionResult) {
  if ('permissionRequest' in result) {
    throw new Error(`Expected completed result, got permission request ${result.permissionRequest.id}`)
  }
  return result
}

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
