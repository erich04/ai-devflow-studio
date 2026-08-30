import { describe, expect, it, vi } from 'vitest'
import {
  buildCodingBrief,
  type CodingAgentRun,
  type LocalProject,
  type ManagedCodingWorkspace,
} from '@ai-devflow/shared'
import { projects, runs } from '@ai-devflow/shared/fixtures'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CodingEngineAdapter, CodingEngineApprovePermissionResult } from './coding-engine'
import {
  CodingEngineContinuationCleanupError,
  CodingEnginePermissionDiscoveryError,
  CodingEngineStartupCleanupError,
} from './coding-engine-lifecycle'
import {
  createOpencodeHttpCodingEngineAdapter,
  resolveManagedOpencodeDirectory,
  type OpencodeHttpProcessManager,
} from './opencode-http-engine'
import {
  createDefaultOpencodePermissionRules,
  OpencodeHttpRequestError,
  OpencodeMessageResponseError,
  type Fetcher,
  type OpencodeSession,
} from './opencode-http-adapter'

describe('opencode HTTP coding engine', () => {
  it('pins existing managed directories to real paths and rejects invalid targets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devflow-opencode-directory-test-'))
    const worktree = join(root, 'worktree')
    const alias = join(root, 'worktree-alias')
    const file = join(root, 'not-a-directory.txt')
    try {
      await mkdir(worktree)
      await symlink(worktree, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await writeFile(file, 'not a directory')
      const canonical = await realpath(worktree)

      expect(resolveManagedOpencodeDirectory(worktree)).toBe(canonical)
      expect(resolveManagedOpencodeDirectory(alias)).toBe(canonical)
      expect(() => resolveManagedOpencodeDirectory(file)).toThrow(
        'managed opencode worktree directory could not be resolved',
      )
      expect(() => resolveManagedOpencodeDirectory(join(root, 'missing'))).toThrow(
        'managed opencode worktree directory could not be resolved',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses the pinned real worktree path for every initial OpenCode request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devflow-opencode-pinned-session-test-'))
    const worktree = join(root, 'worktree')
    const alias = join(root, 'worktree-alias')
    try {
      await mkdir(worktree)
      await symlink(worktree, alias, process.platform === 'win32' ? 'junction' : 'dir')
      const canonical = await realpath(worktree)
      const fetcher = sequenceFetcher([
        managedOpencodeSession({ directory: canonical }),
        successfulOpencodeMessage(),
        [
          {
            id: 'perm-1',
            sessionID: 'ses-1',
            permission: 'edit',
            metadata: { filepath: join(canonical, 'src', 'app.ts') },
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
      const workspace = { ...managedWorkspace(project.id, run.id, node.id), worktreePath: alias }

      const result = expectPermissionResult(
        await engine.start(startInput({ run, node, project, workspace })),
      )
      const directoryQuery = `directory=${encodeURIComponent(canonical)}`

      expect(fetcher.urls).toEqual([
        `http://127.0.0.1:4097/session?${directoryQuery}`,
        `http://127.0.0.1:4097/session/ses-1/message?${directoryQuery}`,
        `http://127.0.0.1:4097/session/ses-1/message?${directoryQuery}`,
        `http://127.0.0.1:4097/permission?${directoryQuery}`,
        `http://127.0.0.1:4097/session/ses-1/message?${directoryQuery}`,
      ])
      expect(result.permissionRequest.filePath).toBe('src/app.ts')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('creates a session, sends the DevFlow brief, and returns a relay permission request', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      successfulOpencodeMessage(),
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' } }],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const input = startInput({ run, node, project, workspace })
    input.brief = {
      ...input.brief,
      prompt: `${input.brief.prompt}\nUNIQUE_KNOWLEDGE_CONTENT source=docs/standards/api-health.md`,
    }
    const result = expectPermissionResult(await engine.start(input))

    expect(result.codingRun.engine).toBe('opencode-http')
    expect(result.codingRun.status).toBe('waiting_permission')
    expect(result.permissionRequest).toMatchObject({
      id: 'perm-1',
      permission: 'edit',
      filePath: 'src/app.ts',
      title: 'opencode requested edit permission',
    })
    expect(fetcher.urls).toEqual([
      'http://127.0.0.1:4097/session?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/session/ses-1/message?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/session/ses-1/message?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/session/ses-1/message?directory=%2Ftmp%2Fworktree',
    ])
    expect(fetcher.bodies.join('\n')).toContain('Implement the build node.')
    expect(fetcher.bodies.join('\n')).toContain('DevFlow Coding Brief')
    expect(fetcher.bodies.join('\n')).toContain('UNIQUE_KNOWLEDGE_CONTENT source=docs/standards/api-health.md')
    expect(result.codingRun.prompt).toBe(input.brief.prompt)
    const messageBody = JSON.parse(fetcher.bodies[1]!) as { parts: Array<{ text: string }> }
    expect(messageBody.parts[0]?.text).toBe(input.brief.prompt)
  })

  it('does not start OpenCode or contact its Provider until Execution Authorization is approved', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      deferredOpencodeMessage(successfulOpencodeMessage()),
      [{ id: 'perm-bash', sessionID: 'ses-1', permission: 'bash', metadata: { command: 'npm test' } }],
    ])
    const ensure = vi.fn(async ({ projectId }: { projectId: string }) => ({
      baseUrl: 'http://127.0.0.1:4097',
      child: {} as never,
      projectId,
    }))
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: { ensure },
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
      requireExecutionAuthorization: true,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const authorizedStart = startInput({ run, node, project, workspace })

    await engine.ensure({ project })
    const authorization = expectPermissionResult(await engine.start(authorizedStart))

    expect(authorization.permissionRequest).toMatchObject({
      origin: 'execution_authorization',
      permission: 'write',
      status: 'pending',
    })
    expect(ensure).not.toHaveBeenCalled()
    expect(fetcher.urls).toEqual([])

    const started = await engine.approvePermission({
      codingRun: authorization.codingRun,
      workspace,
      project,
      request: authorization.permissionRequest,
      authorizedStart,
      now: '2026-06-17T00:00:01.000Z',
    })

    expect(ensure).toHaveBeenCalledOnce()
    expect(fetcher.urls.some((url) => url.includes('/session?'))).toBe(true)
    expect(started).toMatchObject({
      codingRun: { status: 'waiting_permission' },
      permissionRequest: { id: 'perm-bash', permission: 'bash' },
    })
  })

  it('can finish an authorized OpenCode run without inventing a tool permission', async () => {
    const patch = 'diff --git a/src/app.ts b/src/app.ts\n+export const ready = true\n'
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      immediateSuccessfulOpencodeMessage(),
      [],
      { 'ses-1': { type: 'idle' } },
      [{ file: 'src/app.ts', patch }],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      captureWorktreeDiff: async () => ({ changedPaths: ['src/app.ts'], patch }),
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
      requireExecutionAuthorization: true,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const authorizedStart = startInput({ run, node, project, workspace })
    const authorization = expectPermissionResult(await engine.start(authorizedStart))

    const completed = await engine.approvePermission({
      codingRun: authorization.codingRun,
      workspace,
      project,
      request: authorization.permissionRequest,
      authorizedStart,
      now: '2026-06-17T00:00:01.000Z',
    })

    const result = expectCompletedResult(completed)
    expect(result.codingRun).toMatchObject({ status: 'completed', changedPaths: ['src/app.ts'] })
    expect(result.events.some((event) => event.kind === 'permission')).toBe(false)
    expect(result.diff.patch).toBe(patch)
  })

  it('fails closed before sending a message when opencode resolves the session outside the managed worktree', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession({ directory: '/tmp/candidate-repository' }),
      true,
      [],
      [],
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    await expect(engine.start(startInput({ run, node, project, workspace }))).rejects.toThrow(
      'opencode session directory did not match the managed worktree',
    )
    expect(fetcher.urls).toEqual([
      'http://127.0.0.1:4097/session?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
    ])
  })

  it('retains startup cleanup ownership when opencode does not acknowledge abort', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession({ directory: '/tmp/candidate-repository' }),
      false,
      true,
      [],
      [],
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const failure = engine.start(startInput({ run, node, project, workspace }))
    await expect(failure).rejects.toBeInstanceOf(CodingEngineStartupCleanupError)
    await expect(failure).rejects.toThrow('coding engine startup failed and cleanup did not complete')
    const retainedRun: CodingAgentRun = {
      id: 'coding-run-1',
      runId: run.id,
      nodeId: node.id,
      projectId: project.id,
      requestedBy: 'u-erich',
      providerId: 'openai',
      engine: 'opencode-http',
      status: 'preparing',
      branchName: workspace.branchName,
      userInstruction: 'Implement the build node.',
      prompt: startInput({ run, node, project, workspace }).brief.prompt,
      summary: 'Preparing a managed Coding Agent run.',
      changedPaths: [],
      startedAt: '2026-06-17T00:00:00.000Z',
      redacted: true,
    }
    await expect(engine.cancel({ codingRun: retainedRun })).resolves.toBeUndefined()
    expect(fetcher.urls).toEqual([
      'http://127.0.0.1:4097/session?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
    ])
  })

  it('fails closed before sending a message when opencode does not preserve permission relay rules', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession({
        permission: [
          ...createDefaultOpencodePermissionRules(),
          { permission: 'edit', pattern: '*', action: 'allow' },
        ],
      }),
      true,
      [],
      [],
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    await expect(engine.start(startInput({ run, node, project, workspace }))).rejects.toThrow(
      'opencode session did not preserve DevFlow permission relay rules',
    )
    expect(fetcher.urls).toEqual([
      'http://127.0.0.1:4097/session?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
    ])
  })

  it('records a redacted coding tool_call event from opencode permission metadata', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      successfulOpencodeMessage(),
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
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const result = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )
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
      managedOpencodeSession(),
      successfulOpencodeMessage(),
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
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const result = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )
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
      managedOpencodeSession(),
      successfulOpencodeMessage(),
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit' }],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const result = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )
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
      managedOpencodeSession(),
      successfulOpencodeMessage(),
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src\\app.ts' } }],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const result = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )
    const toolCall = result.events.find((event) => event.kind === 'tool_call')

    expect(result.permissionRequest.filePath).toBe('src/app.ts')
    expect(toolCall?.metadata?.filePath).toBe('src/app.ts')
  })

  it('surfaces provider errors while waiting for the first permission request', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      new Error('provider subscription expired'),
      [],
      true,
      [],
      [],
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 100,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const error = await engine
      .start(startInput({ run, node, project, workspace }))
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(OpencodeHttpRequestError)
    expect(error).toMatchObject({
      code: 'transport_error',
      message: 'opencode request failed',
    })
    expect(fetcher.urls).toContain(
      'http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree',
    )
  })

  it('surfaces provider errors embedded in successful OpenCode message responses', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      {
        info: {
          error: {
            name: 'ProviderAuthError',
            data: { providerID: 'openai', message: 'RAW_AUTH_MESSAGE provider-key-value' },
          },
        },
        parts: [],
      },
      [],
      true,
      [],
      [],
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 10_000,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const failure = engine.start(startInput({ run, node, project, workspace }))

    await expect(failure).rejects.toBeInstanceOf(OpencodeMessageResponseError)
    await expect(failure).rejects.toMatchObject({
      code: 'provider_auth_error',
      message: 'opencode provider message failed',
    })
    const caught = await failure.catch((error: unknown) => error)
    expect(JSON.stringify(caught)).not.toContain('RAW_AUTH_MESSAGE')
    expect(JSON.stringify(caught)).not.toContain('provider-key-value')
    expect(fetcher.urls).toContain(
      'http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree',
    )
  })

  it('fails immediately when opencode completes without requesting permission', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      immediateSuccessfulOpencodeMessage(),
      [],
      true,
      [],
      [],
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 10_000,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const startedAt = Date.now()
    const failure = engine.start(startInput({ run, node, project, workspace }))

    await expect(failure).rejects.toBeInstanceOf(CodingEnginePermissionDiscoveryError)
    await expect(failure).rejects.toMatchObject({
      code: 'message_completed_without_permission',
      message: 'opencode completed without requesting a managed permission',
    })
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(fetcher.urls).toEqual([
      'http://127.0.0.1:4097/session?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/session/ses-1/message?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/session/ses-1/message?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
    ])
  })

  it('aborts on the first provider retry status without retaining raw retry details', async () => {
    let resolveMessage: ((response: Response) => void) | undefined
    const pendingMessage = new Promise<Response>((resolve) => {
      resolveMessage = resolve
    })
    let abortCount = 0
    let statusCount = 0
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
      const requestUrl = String(input)
      if (requestUrl.includes('/message?') && init?.method !== 'POST') return new Response('[]')
      if (requestUrl.includes('/message?')) {
        return pendingMessage
      }
      if (requestUrl.includes('/session/status?')) {
        statusCount += 1
        return new Response(JSON.stringify({
          'ses-1': {
            type: 'retry',
            attempt: 0,
            next: Date.now() + 2_000,
            message: 'RAW_RETRY_SECRET /private/tmp/secret-worktree',
            action: { message: 'RAW_ACTION_SECRET' },
          },
        }), { status: 200 })
      }
      if (requestUrl.includes('/abort?')) {
        abortCount += 1
        resolveMessage?.(new Response(JSON.stringify(successfulOpencodeMessage()), { status: 200 }))
        return new Response('true', { status: 200 })
      }
      if (requestUrl.includes('/permission?')) {
        return new Response('[]', { status: 200 })
      }
      return new Response(JSON.stringify(managedOpencodeSession()), { status: 200 })
    }) as unknown as Fetcher
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'double',
      modelID: 'ark-code-latest',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 500,
      startupCleanupTimeoutMs: 100,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const failure = engine.start(startInput({ run, node, project, workspace }))

    await expect(failure).rejects.toBeInstanceOf(CodingEnginePermissionDiscoveryError)
    const caught = await failure.catch((error: unknown) => error)
    expect(caught).toMatchObject({
      code: 'provider_retry_observed',
      message: 'opencode reported a provider retry during managed permission discovery',
    })
    expect(JSON.stringify(caught)).not.toContain('RAW_RETRY_SECRET')
    expect(JSON.stringify(caught)).not.toContain('RAW_ACTION_SECRET')
    expect(JSON.stringify(caught)).not.toContain('/private/tmp/secret-worktree')
    expect(statusCount).toBe(1)
    expect(abortCount).toBe(1)
  })

  it('continues through a busy target status and ignores an unrelated session retry', async () => {
    let permissionPollCount = 0
    let statusPollCount = 0
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
      const requestUrl = String(input)
      if (requestUrl.includes('/message?') && init?.method !== 'POST') return new Response('[]')
      if (requestUrl.includes('/message?')) {
        return new Promise<Response>(() => undefined)
      }
      if (requestUrl.includes('/permission?')) {
        permissionPollCount += 1
        return new Response(JSON.stringify(permissionPollCount <= 2
          ? []
          : [{ id: 'perm-1', sessionID: 'ses-1', permission: 'bash', metadata: { command: 'pwd' } }]), {
          status: 200,
        })
      }
      if (requestUrl.includes('/session/status?')) {
        statusPollCount += 1
        return new Response(JSON.stringify(statusPollCount === 1
          ? { 'ses-1': { type: 'busy' } }
          : {
              'ses-other': {
                type: 'retry',
                attempt: 1,
                next: Date.now() + 1_000,
                message: 'UNRELATED_RETRY_SENTINEL',
              },
            }), { status: 200 })
      }
      return new Response(JSON.stringify(managedOpencodeSession()), { status: 200 })
    }) as unknown as Fetcher
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'double',
      modelID: 'ark-code-latest',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 100,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

    expect(started.permissionRequest).toMatchObject({ id: 'perm-1', permission: 'bash' })
    expect(permissionPollCount).toBe(3)
    expect(statusPollCount).toBe(2)
  })

  it('times out a pending provider message and completes bounded startup cleanup', async () => {
    let abortCount = 0
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
      const requestUrl = String(input)
      if (requestUrl.includes('/message?') && init?.method !== 'POST') return new Response('[]')
      if (requestUrl.includes('/message?')) {
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
        return new Response(JSON.stringify(successfulOpencodeMessage()), { status: 200 })
      }
      if (requestUrl.includes('/permission?')) {
        return new Response('[]', { status: 200 })
      }
      if (requestUrl.includes('/abort?')) {
        abortCount += 1
        return new Response('true', { status: 200 })
      }
      return new Response(JSON.stringify(managedOpencodeSession()), { status: 200 })
    }) as unknown as Fetcher
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 5,
      startupCleanupTimeoutMs: 100,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const failure = engine.start(startInput({ run, node, project, workspace }))

    await expect(failure).rejects.toBeInstanceOf(CodingEnginePermissionDiscoveryError)
    await expect(failure).rejects.toMatchObject({ code: 'permission_discovery_timed_out' })
    expect(abortCount).toBe(1)
  })

  it('enforces the absolute discovery deadline when a permission poll ignores abort', async () => {
    let resolveMessage: ((response: Response) => void) | undefined
    const pendingMessage = new Promise<Response>((resolve) => {
      resolveMessage = resolve
    })
    let aborted = false
    let abortCount = 0
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
      const requestUrl = String(input)
      if (requestUrl.includes('/message?') && init?.method !== 'POST') return new Response('[]')
      if (requestUrl.includes('/message?')) {
        return pendingMessage
      }
      if (requestUrl.includes('/permission?')) {
        if (!aborted) {
          return new Promise<Response>(() => undefined)
        }
        return new Response('[]', { status: 200 })
      }
      if (requestUrl.includes('/abort?')) {
        aborted = true
        abortCount += 1
        resolveMessage?.(new Response(JSON.stringify(successfulOpencodeMessage()), { status: 200 }))
        return new Response('true', { status: 200 })
      }
      return new Response(JSON.stringify(managedOpencodeSession()), { status: 200 })
    }) as unknown as Fetcher
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'double',
      modelID: 'ark-code-latest',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 10,
      startupCleanupTimeoutMs: 100,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const startedAt = Date.now()
    await expect(engine.start(startInput({ run, node, project, workspace }))).rejects.toMatchObject({
      code: 'permission_discovery_timed_out',
    })
    expect(Date.now() - startedAt).toBeLessThan(500)
    expect(abortCount).toBe(1)
  }, 1_000)

  it('enforces the absolute discovery deadline when a status poll ignores abort', async () => {
    let resolveMessage: ((response: Response) => void) | undefined
    const pendingMessage = new Promise<Response>((resolve) => {
      resolveMessage = resolve
    })
    let aborted = false
    let abortCount = 0
    let statusSignal: AbortSignal | undefined
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
      const requestUrl = String(input)
      if (requestUrl.includes('/message?') && init?.method !== 'POST') return new Response('[]')
      if (requestUrl.includes('/message?')) {
        return pendingMessage
      }
      if (requestUrl.includes('/session/status?')) {
        statusSignal = init?.signal ?? undefined
        return new Promise<Response>(() => undefined)
      }
      if (requestUrl.includes('/permission?')) {
        return new Response('[]', { status: 200 })
      }
      if (requestUrl.includes('/abort?')) {
        aborted = true
        abortCount += 1
        resolveMessage?.(new Response(JSON.stringify(immediateSuccessfulOpencodeMessage()), { status: 200 }))
        return new Response('true', { status: 200 })
      }
      return new Response(JSON.stringify(managedOpencodeSession()), { status: 200 })
    }) as unknown as Fetcher
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'double',
      modelID: 'ark-code-latest',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 100,
      startupCleanupTimeoutMs: 500,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const startedAt = Date.now()
    await expect(engine.start(startInput({ run, node, project, workspace }))).rejects.toMatchObject({
      code: 'permission_discovery_timed_out',
    })
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(aborted).toBe(true)
    expect(abortCount).toBe(1)
    expect(statusSignal?.aborted).toBe(true)
  }, 2_000)

  it('rejects only residual permissions from the failed startup session after abort', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      immediateSuccessfulOpencodeMessage(),
      [],
      true,
      [
        { id: 'perm-other', sessionID: 'ses-other', permission: 'bash' },
        { id: 'perm-residual', sessionID: 'ses-1', permission: 'bash', metadata: { command: 'pwd' } },
      ],
      true,
      [{ id: 'perm-other', sessionID: 'ses-other', permission: 'bash' }],
      [{ id: 'perm-other', sessionID: 'ses-other', permission: 'bash' }],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 10_000,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    await expect(engine.start(startInput({ run, node, project, workspace }))).rejects.toMatchObject({
      code: 'message_completed_without_permission',
    })

    expect(fetcher.urls.filter((url) => url.includes('/permission?'))).toHaveLength(4)
    expect(fetcher.urls).toContain(
      'http://127.0.0.1:4097/permission/perm-residual/reply?directory=%2Ftmp%2Fworktree',
    )
    expect(fetcher.urls).not.toContain(
      'http://127.0.0.1:4097/permission/perm-other/reply?directory=%2Ftmp%2Fworktree',
    )
    expect(fetcher.bodies).toContain(JSON.stringify({
      reply: 'reject',
      message: 'Rejected during DevFlow session cleanup.',
    }))
  })

  it('retains startup cleanup ownership when an aborted provider message never settles', async () => {
    const urls: string[] = []
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
      const requestUrl = String(input)
      urls.push(requestUrl)
      if (requestUrl.includes('/message?') && init?.method !== 'POST') return new Response('[]')
      if (requestUrl.includes('/message?')) {
        return new Promise<Response>(() => undefined)
      }
      if (requestUrl.includes('/permission?')) {
        return new Response('[]', { status: 200 })
      }
      if (requestUrl.includes('/abort?')) {
        return new Response('true', { status: 200 })
      }
      return new Response(JSON.stringify(managedOpencodeSession()), { status: 200 })
    }) as unknown as Fetcher
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 15,
      startupCleanupTimeoutMs: 15,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const failure = engine.start(startInput({ run, node, project, workspace }))

    await expect(failure).rejects.toBeInstanceOf(CodingEngineStartupCleanupError)
    const caught = await failure.catch((error: unknown) => error) as CodingEngineStartupCleanupError
    expect(caught.errors[0]).toMatchObject({ code: 'permission_discovery_timed_out' })
    expect(caught.errors[1]).toMatchObject({
      message: 'opencode startup cleanup timed out',
    })
    expect(urls).toContain(
      'http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree',
    )
  })

  it('bounds cleanup when the abort request ignores cancellation', async () => {
    let abortCount = 0
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
      const requestUrl = String(input)
      if (requestUrl.includes('/message?') && init?.method !== 'POST') return new Response('[]')
      if (requestUrl.includes('/message?')) {
        return new Promise<Response>(() => undefined)
      }
      if (requestUrl.includes('/permission?')) {
        return new Response('[]', { status: 200 })
      }
      if (requestUrl.includes('/abort?')) {
        abortCount += 1
        return new Promise<Response>(() => undefined)
      }
      return new Response(JSON.stringify(managedOpencodeSession()), { status: 200 })
    }) as unknown as Fetcher
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'double',
      modelID: 'ark-code-latest',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 10,
      startupCleanupTimeoutMs: 15,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    const startedAt = Date.now()
    const failure = engine.start(startInput({ run, node, project, workspace }))

    await expect(failure).rejects.toBeInstanceOf(CodingEngineStartupCleanupError)
    const caught = await failure.catch((error: unknown) => error) as CodingEngineStartupCleanupError
    expect(caught.errors[0]).toMatchObject({ code: 'permission_discovery_timed_out' })
    expect(caught.errors[1]).toMatchObject({ message: 'opencode startup cleanup timed out' })
    expect(Date.now() - startedAt).toBeLessThan(500)
    expect(abortCount).toBe(1)
  }, 1_000)

  it('coalesces cancellation with startup while permission discovery is still polling', async () => {
    let resolveMessage: ((response: Response) => void) | undefined
    const pendingMessage = new Promise<Response>((resolve) => {
      resolveMessage = resolve
    })
    let markPermissionPollStarted: (() => void) | undefined
    const permissionPollStarted = new Promise<void>((resolve) => {
      markPermissionPollStarted = resolve
    })
    let abortCount = 0
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
      const requestUrl = String(input)
      if (requestUrl.includes('/message?') && init?.method !== 'POST') return new Response('[]')
      if (requestUrl.includes('/message?')) {
        return pendingMessage
      }
      if (requestUrl.includes('/abort?')) {
        abortCount += 1
        resolveMessage?.(new Response(JSON.stringify(successfulOpencodeMessage()), { status: 200 }))
        return new Response('true', { status: 200 })
      }
      if (requestUrl.includes('/permission?')) {
        markPermissionPollStarted?.()
        return new Response('[]', { status: 200 })
      }
      return new Response(JSON.stringify(managedOpencodeSession()), { status: 200 })
    }) as unknown as Fetcher
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 500,
      startupCleanupTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const retainedRun: CodingAgentRun = {
      id: 'coding-run-1',
      runId: run.id,
      nodeId: node.id,
      projectId: project.id,
      requestedBy: 'u-erich',
      providerId: 'openai',
      engine: 'opencode-http',
      status: 'preparing',
      branchName: workspace.branchName,
      userInstruction: 'Implement the build node.',
      prompt: startInput({ run, node, project, workspace }).brief.prompt,
      summary: 'Preparing a managed Coding Agent run.',
      changedPaths: [],
      startedAt: '2026-06-17T00:00:00.000Z',
      redacted: true,
    }

    const start = engine.start(startInput({ run, node, project, workspace }))
    await permissionPollStarted
    await expect(engine.cancel({ codingRun: retainedRun })).resolves.toBeUndefined()
    await expect(start).rejects.toMatchObject({ code: 'message_completed_without_permission' })
    const requestCountAfterCleanup = (fetcher as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    await expect(engine.cancel({ codingRun: retainedRun })).resolves.toBeUndefined()

    expect(abortCount).toBe(1)
    expect((fetcher as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(requestCountAfterCleanup)
  })

  it('waits for session creation and cancels before sending a startup message', async () => {
    let resolveSession: ((response: Response) => void) | undefined
    const pendingSession = new Promise<Response>((resolve) => {
      resolveSession = resolve
    })
    let markSessionRequestStarted: (() => void) | undefined
    const sessionRequestStarted = new Promise<void>((resolve) => {
      markSessionRequestStarted = resolve
    })
    const urls: string[] = []
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
      const requestUrl = String(input)
      urls.push(requestUrl)
      if (requestUrl.endsWith('/session?directory=%2Ftmp%2Fworktree')) {
        markSessionRequestStarted?.()
        return pendingSession
      }
      if (requestUrl.includes('/abort?')) {
        return new Response('true', { status: 200 })
      }
      if (requestUrl.includes('/permission?')) {
        return new Response('[]', { status: 200 })
      }
      if (requestUrl.includes('/message?') && init?.method !== 'POST') return new Response('[]')
      if (requestUrl.includes('/message?')) {
        return new Response(JSON.stringify(successfulOpencodeMessage()), { status: 200 })
      }
      throw new Error('unexpected opencode test request')
    }) as unknown as Fetcher
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const retainedRun: CodingAgentRun = {
      id: 'coding-run-1',
      runId: run.id,
      nodeId: node.id,
      projectId: project.id,
      requestedBy: 'u-erich',
      providerId: 'openai',
      engine: 'opencode-http',
      status: 'preparing',
      branchName: workspace.branchName,
      userInstruction: 'Implement the build node.',
      prompt: startInput({ run, node, project, workspace }).brief.prompt,
      summary: 'Preparing a managed Coding Agent run.',
      changedPaths: [],
      startedAt: '2026-06-17T00:00:00.000Z',
      redacted: true,
    }

    const start = engine.start(startInput({ run, node, project, workspace }))
    await sessionRequestStarted
    let cancellationSettled = false
    const cancellation = engine.cancel({ codingRun: retainedRun }).finally(() => {
      cancellationSettled = true
    })
    await Promise.resolve()
    expect(cancellationSettled).toBe(false)

    resolveSession?.(new Response(JSON.stringify(managedOpencodeSession()), { status: 200 }))
    await expect(cancellation).resolves.toBeUndefined()
    await expect(start).rejects.toThrow('opencode session was cancelled during permission continuation')
    expect(urls.some((url) => url.includes('/message?'))).toBe(false)
    expect(urls.filter((url) => url.includes('/abort?'))).toHaveLength(1)
  })

  it('replies to approved permissions and uses the managed Git diff as authority', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      successfulOpencodeMessage(),
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' } }],
      true,
      [],
      [
        {
          file: 'src/app.ts',
          patch: 'diff --git a/src/app.ts b/src/app.ts\n+export const ready = true\n',
        },
      ],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      captureWorktreeDiff: async () => ({
        changedPaths: ['src/app.ts'],
        patch: 'diff --git a/src/app.ts b/src/app.ts\n+export const ready = true\n',
      }),
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

    const completed = await engine.approvePermission({
      codingRun: started.codingRun,
      workspace,
      project,
      request: started.permissionRequest,
      now: '2026-06-17T00:00:01.000Z',
    })
    const completedResult = expectCompletedResult(completed)

    expect(fetcher.urls).toContain(
      'http://127.0.0.1:4097/permission/perm-1/reply?directory=%2Ftmp%2Fworktree',
    )
    expect(fetcher.urls).toContain('http://127.0.0.1:4097/session/ses-1/diff?directory=%2Ftmp%2Fworktree')
    expect(fetcher.bodies).toContain(
      JSON.stringify({
        reply: 'once',
        message: 'Approved by DevFlow.',
      }),
    )
    expect(completedResult.codingRun.status).toBe('completed')
    expect(completedResult.diff.changedPaths).toEqual(['src/app.ts'])
    expect(completedResult.diff.patch).toContain('export const ready = true')
    expect(completedResult.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'diff',
        metadata: expect.objectContaining({
          diffSource: 'managed_worktree_git',
          opencodeDiffStatus: 'matched',
        }),
      }),
    ]))
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

  it('fails closed and rejects the OpenCode session before relaying a dangerous command', async () => {
    const permission = {
      id: 'perm-dangerous',
      sessionID: 'ses-1',
      permission: 'bash',
      metadata: { command: 'git push origin main' },
    }
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      successfulOpencodeMessage(),
      [permission],
      true,
      [permission],
      true,
      [],
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

    await expect(engine.approvePermission({
      codingRun: started.codingRun,
      workspace,
      project,
      request: started.permissionRequest,
      now: '2026-06-17T00:00:01.000Z',
    })).rejects.toThrow('git_write_disabled')

    expect(fetcher.bodies.some((body) => body.includes('"reply":"once"'))).toBe(false)
    expect(fetcher.bodies.some((body) => body.includes('"reply":"reject"'))).toBe(true)
    expect(fetcher.urls).toContain(
      'http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree',
    )
  })

  it('aborts the session when the configured OpenCode tool-turn limit is exceeded', async () => {
    const firstPermission = {
      id: 'perm-turn-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' },
    }
    const secondPermission = {
      id: 'perm-turn-2', sessionID: 'ses-1', permission: 'bash', metadata: { command: 'pnpm test' },
    }
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      successfulOpencodeMessage(),
      [firstPermission],
      true,
      [secondPermission],
      true,
      [secondPermission],
      true,
      [],
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode', providerID: 'openai', modelID: 'gpt-4.1-mini',
      processManager: readyServer(), resolveManagedDirectory: identityManagedDirectory,
      fetcher, maxToolTurns: 1, permissionPollMs: 1, permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = expectPermissionResult(await engine.start(startInput({ run, node, project, workspace })))

    await expect(engine.approvePermission({
      codingRun: started.codingRun, workspace, project, request: started.permissionRequest,
      now: '2026-06-17T00:00:01.000Z',
    })).rejects.toThrow('opencode_tool_turn_limit_exceeded')
    expect(fetcher.urls).toContain(
      'http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree',
    )
  })

  it('counts auto-allowed OpenCode tool parts and aborts before they can bypass the tool-turn limit', async () => {
    const autoAllowedTools = ['read', 'glob', 'grep', 'list', 'edit', 'write', 'patch']
    const fetcher = sequenceFetcher(
      [
        managedOpencodeSession(),
        successfulOpencodeMessage(),
        true,
        [],
        [],
        [],
      ],
      [{
        info: { id: 'msg-assistant-1', role: 'assistant' },
        parts: autoAllowedTools.map((tool, index) => ({
            id: `prt-${tool}-1`,
            sessionID: 'ses-1',
            messageID: 'msg-assistant-1',
            type: 'tool',
            callID: `call-${tool}-${index + 1}`,
            tool,
            state: { status: 'completed' },
          })),
      }],
    )
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode', providerID: 'openai', modelID: 'gpt-4.1-mini',
      processManager: readyServer(), resolveManagedDirectory: identityManagedDirectory,
      fetcher, maxToolTurns: 6, permissionPollMs: 1, permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)

    await expect(engine.start(startInput({ run, node, project, workspace })))
      .rejects.toThrow('opencode_tool_turn_limit_exceeded')

    expect(fetcher.urls).toContain(
      'http://127.0.0.1:4097/session/ses-1/message?directory=%2Ftmp%2Fworktree',
    )
    expect(fetcher.urls).toContain(
      'http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree',
    )
  })

  it('aborts the session when the OpenCode wall-clock limit expires', async () => {
    let clock = 1_000
    const permission = {
      id: 'perm-wall-clock', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' },
    }
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      successfulOpencodeMessage(),
      [permission],
      true,
      [permission],
      true,
      [],
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode', providerID: 'openai', modelID: 'gpt-4.1-mini',
      processManager: readyServer(), resolveManagedDirectory: identityManagedDirectory,
      fetcher, maxWallClockMs: 10, nowMs: () => clock,
      permissionPollMs: 1, permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = expectPermissionResult(await engine.start(startInput({ run, node, project, workspace })))
    clock = 1_011

    await expect(engine.approvePermission({
      codingRun: started.codingRun, workspace, project, request: started.permissionRequest,
      now: '2026-06-17T00:00:01.000Z',
    })).rejects.toThrow('opencode_wall_clock_limit_exceeded')
    expect(fetcher.urls).toContain(
      'http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree',
    )
  })

  it('falls back to managed worktree diff capture when opencode returns no diff files', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      successfulOpencodeMessage(),
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
      resolveManagedDirectory: identityManagedDirectory,
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
    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

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
    expect(completedResult.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'diff',
        metadata: expect.objectContaining({
          diffSource: 'managed_worktree_git',
          opencodeDiffStatus: 'mismatch',
        }),
      }),
    ]))
  })

  it('aborts a continuation on the first provider retry without reading a diff', async () => {
    let resolveMessage: ((response: Response) => void) | undefined
    const pendingMessage = new Promise<Response>((resolve) => {
      resolveMessage = resolve
    })
    let permissionPollCount = 0
    let abortCount = 0
    let diffCount = 0
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
      const requestUrl = String(input)
      if (requestUrl.includes('/message?') && init?.method !== 'POST') return new Response('[]')
      if (requestUrl.includes('/message?')) {
        return pendingMessage
      }
      if (requestUrl.includes('/permission/perm-1/reply?')) {
        return new Response('true', { status: 200 })
      }
      if (requestUrl.includes('/permission?')) {
        permissionPollCount += 1
        return new Response(JSON.stringify(permissionPollCount === 1
          ? [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' } }]
          : []), { status: 200 })
      }
      if (requestUrl.includes('/session/status?')) {
        return new Response(JSON.stringify({
          'ses-1': {
            type: 'retry',
            attempt: 1,
            next: Date.now() + 2_000,
            message: 'CONTINUATION_RETRY_SENTINEL',
          },
        }), { status: 200 })
      }
      if (requestUrl.includes('/abort?')) {
        abortCount += 1
        resolveMessage?.(new Response(JSON.stringify(immediateSuccessfulOpencodeMessage()), { status: 200 }))
        return new Response('true', { status: 200 })
      }
      if (requestUrl.includes('/diff?')) {
        diffCount += 1
        return new Response('[]', { status: 200 })
      }
      return new Response(JSON.stringify(managedOpencodeSession()), { status: 200 })
    }) as unknown as Fetcher
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'double',
      modelID: 'ark-code-latest',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 100,
      startupCleanupTimeoutMs: 100,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

    const failure = engine.approvePermission({
      codingRun: started.codingRun,
      workspace,
      project,
      request: started.permissionRequest,
      now: '2026-06-17T00:00:01.000Z',
    })

    await expect(failure).rejects.toMatchObject({ code: 'provider_retry_observed' })
    expect(abortCount).toBe(1)
    expect(diffCount).toBe(0)
  })

  it('prefers a terminal provider error over a residual permission returned by the same poll', async () => {
    let resolveMessage: ((response: Response) => void) | undefined
    const pendingMessage = new Promise<Response>((resolve) => {
      resolveMessage = resolve
    })
    const initialPermission = {
      id: 'perm-1',
      sessionID: 'ses-1',
      permission: 'edit',
      metadata: { filepath: 'src/app.ts' },
    }
    const residualPermission = {
      id: 'perm-2',
      sessionID: 'ses-1',
      permission: 'bash',
      metadata: { command: 'pwd' },
    }
    let permissionPollCount = 0
    let abortCount = 0
    let diffCount = 0
    let residualRejectCount = 0
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
      const requestUrl = String(input)
      if (requestUrl.includes('/message?') && init?.method !== 'POST') return new Response('[]')
      if (requestUrl.includes('/message?')) {
        return pendingMessage
      }
      if (requestUrl.includes('/permission/perm-1/reply?')) {
        return new Response('true', { status: 200 })
      }
      if (requestUrl.includes('/permission/perm-2/reply?')) {
        residualRejectCount += 1
        return new Response('true', { status: 200 })
      }
      if (requestUrl.includes('/permission?')) {
        permissionPollCount += 1
        if (permissionPollCount === 1) {
          return new Response(JSON.stringify([initialPermission]), { status: 200 })
        }
        if (permissionPollCount === 2) {
          resolveMessage?.(new Response(JSON.stringify(providerErrorMessage(429)), { status: 200 }))
          return new Response(JSON.stringify([residualPermission]), { status: 200 })
        }
        return new Response(JSON.stringify(permissionPollCount === 3 ? [residualPermission] : []), { status: 200 })
      }
      if (requestUrl.includes('/abort?')) {
        abortCount += 1
        return new Response('true', { status: 200 })
      }
      if (requestUrl.includes('/diff?')) {
        diffCount += 1
        return new Response('[]', { status: 200 })
      }
      return new Response(JSON.stringify(managedOpencodeSession()), { status: 200 })
    }) as unknown as Fetcher
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'double',
      modelID: 'ark-code-latest',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 100,
      startupCleanupTimeoutMs: 100,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

    const failure = engine.approvePermission({
      codingRun: started.codingRun,
      workspace,
      project,
      request: started.permissionRequest,
      now: '2026-06-17T00:00:01.000Z',
    })

    await expect(failure).rejects.toMatchObject({ code: 'provider_api_error', statusCode: 429 })
    expect(abortCount).toBe(1)
    expect(residualRejectCount).toBe(1)
    expect(diffCount).toBe(0)
  })

  it('prefers a terminal provider error over a retry status returned by the same poll', async () => {
    let resolveMessage: ((response: Response) => void) | undefined
    const pendingMessage = new Promise<Response>((resolve) => {
      resolveMessage = resolve
    })
    let permissionPollCount = 0
    let abortCount = 0
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
      const requestUrl = String(input)
      if (requestUrl.includes('/message?') && init?.method !== 'POST') return new Response('[]')
      if (requestUrl.includes('/message?')) {
        return pendingMessage
      }
      if (requestUrl.includes('/permission/perm-1/reply?')) {
        return new Response('true', { status: 200 })
      }
      if (requestUrl.includes('/permission?')) {
        permissionPollCount += 1
        return new Response(JSON.stringify(permissionPollCount === 1
          ? [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' } }]
          : []), { status: 200 })
      }
      if (requestUrl.includes('/session/status?')) {
        resolveMessage?.(new Response(JSON.stringify(providerErrorMessage(503)), { status: 200 }))
        return new Response(JSON.stringify({
          'ses-1': {
            type: 'retry',
            attempt: 1,
            next: Date.now() + 2_000,
            message: 'RETRY_STATUS_MUST_NOT_WIN',
          },
        }), { status: 200 })
      }
      if (requestUrl.includes('/abort?')) {
        abortCount += 1
        return new Response('true', { status: 200 })
      }
      return new Response(JSON.stringify(managedOpencodeSession()), { status: 200 })
    }) as unknown as Fetcher
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'double',
      modelID: 'ark-code-latest',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 100,
      startupCleanupTimeoutMs: 100,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

    const failure = engine.approvePermission({
      codingRun: started.codingRun,
      workspace,
      project,
      request: started.permissionRequest,
      now: '2026-06-17T00:00:01.000Z',
    })

    await expect(failure).rejects.toMatchObject({ code: 'provider_api_error', statusCode: 503 })
    expect(abortCount).toBe(1)
  })

  it('uses managed worktree diff when the opencode message stream closes after applying changes', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      deferredOpencodeMessage(new TypeError('fetch failed')),
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
      resolveManagedDirectory: identityManagedDirectory,
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
    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

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

  it('does not treat a semantic provider failure as completion even when a partial diff exists', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      deferredOpencodeMessage({
        info: {
          error: {
            name: 'APIError',
            data: {
              message: 'RAW_PROVIDER_MESSAGE',
              statusCode: 429,
              isRetryable: true,
            },
          },
        },
        parts: [],
      }),
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'new-file.txt' } }],
      true,
      [],
      true,
      [],
      [],
      [],
    ])
    const captureWorktreeDiff = vi.fn(async () => ({
      changedPaths: ['new-file.txt'],
      patch: 'diff --git a/new-file.txt b/new-file.txt\n+partial\n',
    }))
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      captureWorktreeDiff,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

    const failure = engine.approvePermission({
      codingRun: started.codingRun,
      workspace,
      project,
      request: started.permissionRequest,
      now: '2026-06-17T00:00:01.000Z',
    })

    await expect(failure).rejects.toBeInstanceOf(OpencodeMessageResponseError)
    await expect(failure).rejects.toMatchObject({ code: 'provider_api_error', statusCode: 429 })
    await engine.cancel({ codingRun: started.codingRun })
    expect(captureWorktreeDiff).not.toHaveBeenCalled()
    expect(fetcher.urls.filter((url) => url.includes('/abort?'))).toHaveLength(1)
    expect(fetcher.urls.some((url) => url.includes('/diff?'))).toBe(false)
  })

  it('keeps a failed continuation session registered until cleanup can be retried', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      deferredOpencodeMessage({
        info: {
          error: {
            name: 'APIError',
            data: { statusCode: 429, isRetryable: true },
          },
        },
        parts: [],
      }),
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' } }],
      true,
      [],
      false,
      true,
      [],
      [],
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

    const failure = engine.approvePermission({
      codingRun: started.codingRun,
      workspace,
      project,
      request: started.permissionRequest,
      now: '2026-06-17T00:00:01.000Z',
    })

    await expect(failure).rejects.toBeInstanceOf(CodingEngineContinuationCleanupError)
    const caught = await failure.catch((error: unknown) => error) as CodingEngineContinuationCleanupError
    expect(caught.errors[0]).toMatchObject({ code: 'provider_api_error', statusCode: 429 })
    await engine.cancel({ codingRun: started.codingRun })
    expect(fetcher.urls.filter((url) => url.includes('/abort?'))).toHaveLength(2)
  })

  it('retries residual permission cleanup before forgetting a cancelled session', async () => {
    const residualPermission = {
      id: 'perm-1',
      sessionID: 'ses-1',
      permission: 'edit',
      metadata: { filepath: 'src/app.ts' },
    }
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      successfulOpencodeMessage(),
      [residualPermission],
      true,
      [residualPermission],
      false,
      true,
      [residualPermission],
      true,
      [],
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

    await expect(engine.cancel({ codingRun: started.codingRun })).rejects.toThrow(
      'opencode session permission rejection was not acknowledged',
    )
    await expect(engine.cancel({ codingRun: started.codingRun })).resolves.toBeUndefined()
    const requestCountAfterCleanup = fetcher.urls.length
    await expect(engine.cancel({ codingRun: started.codingRun })).resolves.toBeUndefined()

    expect(fetcher.urls.filter((url) => url.includes('/abort?'))).toHaveLength(2)
    expect(fetcher.urls.filter((url) => url.includes('/permission/perm-1/reply?'))).toHaveLength(2)
    expect(fetcher.urls).toHaveLength(requestCountAfterCleanup)
  })

  it('coalesces concurrent cancellation cleanup for the same session', async () => {
    const residualPermission = {
      id: 'perm-1',
      sessionID: 'ses-1',
      permission: 'edit',
      metadata: { filepath: 'src/app.ts' },
    }
    let permissionListCount = 0
    let abortCount = 0
    let replyCount = 0
    let resolveMessage: ((response: Response) => void) | undefined
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
      const requestUrl = String(input)
      if (requestUrl.includes('/message?') && init?.method !== 'POST') return new Response('[]')
      if (requestUrl.includes('/message?')) {
        return await new Promise<Response>((resolve) => {
          resolveMessage = resolve
        })
      }
      if (requestUrl.includes('/abort?')) {
        abortCount += 1
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        resolveMessage?.(new Response(JSON.stringify(immediateSuccessfulOpencodeMessage()), { status: 200 }))
        resolveMessage = undefined
        return new Response('true', { status: 200 })
      }
      if (requestUrl.includes('/permission/perm-1/reply?')) {
        replyCount += 1
        return new Response(replyCount === 1 ? 'true' : 'false', { status: 200 })
      }
      if (requestUrl.includes('/permission?')) {
        permissionListCount += 1
        return new Response(JSON.stringify(permissionListCount <= 2 ? [residualPermission] : []), { status: 200 })
      }
      return new Response(JSON.stringify(managedOpencodeSession()), { status: 200 })
    }) as unknown as Fetcher
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

    await expect(Promise.all([
      engine.cancel({ codingRun: started.codingRun }),
      engine.cancel({ codingRun: started.codingRun }),
    ])).resolves.toEqual([undefined, undefined])

    expect(abortCount).toBe(1)
    expect(replyCount).toBe(1)
  })

  it('does not complete approval when cancellation starts while the result is being assembled', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      successfulOpencodeMessage(),
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' } }],
      true,
      [],
      [],
      false,
      true,
      [],
      [],
      [],
    ])
    let cancellation: Promise<void> | undefined
    let startedRun: ReturnType<typeof expectPermissionResult> | undefined
    let engine: ReturnType<typeof createOpencodeHttpCodingEngineAdapter>
    engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      captureWorktreeDiff: async () => {
        const diff: { changedPaths: string[]; patch: string } = { changedPaths: [], patch: '' }
        Object.defineProperty(diff, 'changedPaths', {
          enumerable: true,
          get() {
            if (!cancellation && startedRun) {
              cancellation = engine.cancel({ codingRun: startedRun.codingRun })
              void cancellation.catch(() => undefined)
            }
            return []
          },
        })
        return diff
      },
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    startedRun = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

    await expect(engine.approvePermission({
      codingRun: startedRun.codingRun,
      workspace,
      project,
      request: startedRun.permissionRequest,
      now: '2026-06-17T00:00:01.000Z',
    })).rejects.toBeInstanceOf(CodingEngineContinuationCleanupError)
    await expect(cancellation).rejects.toThrow('opencode session abort was not acknowledged')
    await expect(engine.cancel({ codingRun: startedRun.codingRun })).resolves.toBeUndefined()
    expect(fetcher.urls.filter((url) => url.includes('/abort?'))).toHaveLength(2)
  })

  it('returns the next opencode permission instead of completing when a second request appears', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      successfulOpencodeMessage(),
      [{ id: 'perm-bash', sessionID: 'ses-1', permission: 'bash', metadata: { command: 'pwd' } }],
      true,
      [{ id: 'perm-edit', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'new-file.txt' } }],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
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
    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

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
      managedOpencodeSession(),
      successfulOpencodeMessage(),
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' } }],
      true,
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' } }],
      true,
      [],
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

    await engine.cancel({ codingRun: started.codingRun })

    expect(fetcher.urls).toContain('http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree')
    expect(fetcher.urls).toContain(
      'http://127.0.0.1:4097/permission/perm-1/reply?directory=%2Ftmp%2Fworktree',
    )
  })

  it('keeps the session registered until opencode acknowledges cancellation', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      successfulOpencodeMessage(),
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' } }],
      {},
      true,
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' } }],
      true,
      [],
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

    await expect(engine.cancel({ codingRun: started.codingRun })).rejects.toThrow(
      'opencode session abort was not acknowledged',
    )
    await expect(engine.cancel({ codingRun: started.codingRun })).resolves.toBeUndefined()

    expect(fetcher.urls.filter((url) => url.includes('/abort?'))).toHaveLength(2)
  })

  it('does not advance a permission when opencode rejects the reply acknowledgement', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      successfulOpencodeMessage(),
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit', metadata: { filepath: 'src/app.ts' } }],
      'false',
      true,
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit' }],
      true,
      [],
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'openai',
      modelID: 'gpt-4.1-mini',
      processManager: readyServer(),
      resolveManagedDirectory: identityManagedDirectory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    const run = runs[0]!
    const node = run.nodes.find((candidate) => candidate.id === 'n-build')!
    const project = localProject(projects[0]!)
    const workspace = managedWorkspace(project.id, run.id, node.id)
    const started = expectPermissionResult(
      await engine.start(startInput({ run, node, project, workspace })),
    )

    await expect(engine.approvePermission({
      codingRun: started.codingRun,
      workspace,
      project,
      request: started.permissionRequest,
      now: '2026-06-17T00:00:01.000Z',
    })).rejects.toThrow('opencode permission reply was not acknowledged')
    await expect(engine.cancel({ codingRun: started.codingRun })).resolves.toBeUndefined()

    expect(fetcher.urls).toContain(
      'http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree',
    )
  })
})

function expectCompletedResult(result: CodingEngineApprovePermissionResult) {
  if ('permissionRequest' in result) {
    throw new Error(`Expected completed result, got permission request ${result.permissionRequest.id}`)
  }
  return result
}

function expectPermissionResult(
  result: Awaited<ReturnType<CodingEngineAdapter['start']>>,
) {
  if (!('permissionRequest' in result)) {
    throw new Error('Expected a permission result, got a completed result')
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

function sequenceFetcher(
  responses: unknown[],
  messageHistory: unknown[] = [],
): Fetcher & { urls: string[]; bodies: string[] } {
  const queue = [...responses]
  const urls: string[] = []
  const bodies: string[] = []
  let pendingMessage:
    | {
        body: unknown
        reject: (error: unknown) => void
        resolve: (response: Response) => void
      }
    | undefined
  const fetcher = vi.fn(async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
    const requestUrl = String(input)
    urls.push(requestUrl)
    if (init?.body) {
      bodies.push(String(init.body))
    }
    if (requestUrl.includes('/message?') && init?.method !== 'POST') {
      return new Response(JSON.stringify(messageHistory), { status: 200 })
    }
    const body = queue.shift()
    if (requestUrl.includes('/message?') && isDeferredOpencodeMessage(body)) {
      return await new Promise<Response>((resolve, reject) => {
        pendingMessage = { body, reject, resolve }
      })
    }
    if (body instanceof Error) {
      throw body
    }
    const acknowledgedReply = requestUrl.includes('/permission/') && requestUrl.includes('/reply?') && body === true
    const continuationWillComplete = acknowledgedReply && Array.isArray(queue[0]) && queue[0].length === 0
    const acknowledgedAbort = requestUrl.includes('/abort?') && body === true
    if (pendingMessage && (continuationWillComplete || acknowledgedAbort)) {
      const current = pendingMessage
      pendingMessage = undefined
      if (current.body instanceof Error) {
        current.reject(current.body)
      } else {
        current.resolve(new Response(JSON.stringify(current.body), { status: 200 }))
      }
    }
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as Fetcher & { urls: string[]; bodies: string[] }
  fetcher.urls = urls
  fetcher.bodies = bodies
  return fetcher
}

function managedOpencodeSession(overrides: Partial<OpencodeSession> = {}): OpencodeSession {
  return {
    id: 'ses-1',
    directory: '/tmp/worktree',
    permission: createDefaultOpencodePermissionRules(),
    ...overrides,
  }
}

const deferredSuccessfulMessages = new WeakSet<object>()

function successfulOpencodeMessage() {
  return deferredOpencodeMessage(immediateSuccessfulOpencodeMessage())
}

function immediateSuccessfulOpencodeMessage() {
  return { info: {}, parts: [] }
}

function providerErrorMessage(statusCode: number) {
  return {
    info: {
      error: {
        name: 'APIError',
        data: { statusCode, isRetryable: statusCode >= 429 },
      },
    },
    parts: [],
  }
}

function deferredOpencodeMessage<T extends object>(response: T): T {
  deferredSuccessfulMessages.add(response)
  return response
}

function isDeferredOpencodeMessage(value: unknown): value is object {
  return typeof value === 'object' && value !== null && deferredSuccessfulMessages.has(value)
}

function identityManagedDirectory(directory: string): string {
  return directory
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
  const context = {
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
  return {
    ...context,
    brief: buildCodingBrief({
      run: input.run,
      node: input.node,
      project: input.project,
      upstreamArtifacts: context.upstreamArtifacts,
      knowledgeReferences: context.knowledgeReferences,
      governanceChecks: context.governanceChecks,
      gateDecisions: context.gateDecisions,
      testEvidence: context.testEvidence,
      userInstruction: context.userInstruction,
      worktreePath: '<managed-worktree-created-after-budget-approval>',
      branchName: '<managed-branch-created-after-budget-approval>',
    }),
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
