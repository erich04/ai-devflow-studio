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

    const result = await engine.start({
      id: 'coding-run-1',
      run,
      node,
      project,
      workspace,
      requestedBy: 'u-erich',
      userInstruction: 'Implement the build node.',
      now: '2026-06-17T00:00:00.000Z',
      upstreamArtifacts: [],
      knowledgeReferences: [],
      governanceChecks: [],
      gateDecisions: [],
      testEvidence: [],
    })

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
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as Fetcher & { urls: string[]; bodies: string[] }
  fetcher.urls = urls
  fetcher.bodies = bodies
  return fetcher
}

function managedWorkspace(projectId: string, runId: string, nodeId: string): ManagedCodingWorkspace {
  return {
    id: 'workspace-1',
    projectId,
    codingRunId: 'coding-run-1',
    runId,
    nodeId,
    sourcePath: '/tmp/repo',
    worktreePath: '/tmp/worktree',
    branchName: 'devflow/coding-run-1',
    baseBranch: 'main',
    createdAt: '2026-06-17T00:00:00.000Z',
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
