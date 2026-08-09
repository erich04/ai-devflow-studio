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

      const result = await engine.start(startInput({ run, node, project, workspace }))
      const directoryQuery = `directory=${encodeURIComponent(canonical)}`

      expect(fetcher.urls).toEqual([
        `http://127.0.0.1:4097/session?${directoryQuery}`,
        `http://127.0.0.1:4097/session/ses-1/message?${directoryQuery}`,
        `http://127.0.0.1:4097/permission?${directoryQuery}`,
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
    const result = await engine.start(input)

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
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
    ])
    expect(fetcher.bodies.join('\n')).toContain('Implement the build node.')
    expect(fetcher.bodies.join('\n')).toContain('DevFlow Coding Brief')
    expect(fetcher.bodies.join('\n')).toContain('UNIQUE_KNOWLEDGE_CONTENT source=docs/standards/api-health.md')
    expect(result.codingRun.prompt).toBe(input.brief.prompt)
    const messageBody = JSON.parse(fetcher.bodies[1]!) as { parts: Array<{ text: string }> }
    expect(messageBody.parts[0]?.text).toBe(input.brief.prompt)
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

    const result = await engine.start(startInput({ run, node, project, workspace }))
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
      successfulOpencodeMessage(),
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
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
      'http://127.0.0.1:4097/permission?directory=%2Ftmp%2Fworktree',
    ])
  })

  it('times out a pending provider message and completes bounded startup cleanup', async () => {
    let abortCount = 0
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0]) => {
      const requestUrl = String(input)
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

  it('rejects only residual permissions from the failed startup session after abort', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      successfulOpencodeMessage(),
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
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0]) => {
      const requestUrl = String(input)
      urls.push(requestUrl)
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
      message: 'opencode startup message cleanup did not complete',
    })
    expect(urls).toContain(
      'http://127.0.0.1:4097/session/ses-1/abort?directory=%2Ftmp%2Fworktree',
    )
  })

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
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0]) => {
      const requestUrl = String(input)
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
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0]) => {
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

  it('replies to approved permissions and captures a redacted opencode diff', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      successfulOpencodeMessage(),
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
      resolveManagedDirectory: identityManagedDirectory,
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
      managedOpencodeSession(),
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

  it('does not treat a semantic provider failure as completion even when a partial diff exists', async () => {
    const fetcher = sequenceFetcher([
      managedOpencodeSession(),
      {
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
      },
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
    const started = await engine.start(startInput({ run, node, project, workspace }))

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
      {
        info: {
          error: {
            name: 'APIError',
            data: { statusCode: 429, isRetryable: true },
          },
        },
        parts: [],
      },
      [{ id: 'perm-1', sessionID: 'ses-1', permission: 'edit' }],
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
    const started = await engine.start(startInput({ run, node, project, workspace }))

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
    const started = await engine.start(startInput({ run, node, project, workspace }))

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
    const fetcher = vi.fn(async (input: Parameters<Fetcher>[0]) => {
      const requestUrl = String(input)
      if (requestUrl.includes('/message?')) {
        return new Response(JSON.stringify(successfulOpencodeMessage()), { status: 200 })
      }
      if (requestUrl.includes('/abort?')) {
        abortCount += 1
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
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
    const started = await engine.start(startInput({ run, node, project, workspace }))

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
    let startedRun: Awaited<ReturnType<CodingEngineAdapter['start']>> | undefined
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
    startedRun = await engine.start(startInput({ run, node, project, workspace }))

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
    const started = await engine.start(startInput({ run, node, project, workspace }))

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
    const started = await engine.start(startInput({ run, node, project, workspace }))

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
    const started = await engine.start(startInput({ run, node, project, workspace }))

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

function managedOpencodeSession(overrides: Partial<OpencodeSession> = {}): OpencodeSession {
  return {
    id: 'ses-1',
    directory: '/tmp/worktree',
    permission: createDefaultOpencodePermissionRules(),
    ...overrides,
  }
}

function successfulOpencodeMessage() {
  return { info: {}, parts: [] }
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
