import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_STAGE_AGENT_EXECUTION_BOUNDS,
  READ_ONLY_STAGE_AGENT_CAPABILITY,
} from '@ai-devflow/shared'
import {
  buildReadOnlyStageAgentRuntimeEnv,
  createReadOnlyLocalStageAgentExecutor,
} from './stage-agent-executor'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'devflow-stage-agent-'))
  roots.push(root)
  await writeFile(path.join(root, 'package.json'), '{"name":"fixture"}\n')
  execFileSync('git', ['init'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root })
  execFileSync('git', ['add', 'package.json'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root })
  return root
}

function executor(root: string, runner: Parameters<typeof createReadOnlyLocalStageAgentExecutor>[0]['runner']) {
  return createReadOnlyLocalStageAgentExecutor({
    projectId: 'project-1',
    projectPath: root,
    binaryPath: '/not-used/opencode',
    providerId: 'provider-1',
    modelId: 'model-1',
    detectedVersion: '1.0.0',
    processManager: { ensure: async () => { throw new Error('not used') } },
    runtimeEnv: {},
    ...(runner ? { runner } : {}),
  })
}

function executionInput() {
  return {
    request: {
      id: 'request-1', runId: 'run-1', nodeId: 'node-1', projectId: 'project-1',
      requestedBy: 'user-1', runtime: 'electron' as const, stage: 'clarify' as const,
      providerId: 'provider-1',
    },
    context: {
      run: { id: 'run-1', title: 'Run', request: 'Clarify', projectId: 'project-1', status: 'clarifying' as const, branchName: 'main' },
      node: { id: 'node-1', stage: 'clarify' as const, title: 'Clarify', subtitle: '', kind: 'agent' as const, status: 'running' as const },
      artifacts: [],
    },
    prompt: 'Return JSON',
    capability: READ_ONLY_STAGE_AGENT_CAPABILITY,
    bounds: DEFAULT_STAGE_AGENT_EXECUTION_BOUNDS,
  }
}

describe('read-only local stage Agent executor', () => {
  it('passes only the bounded runtime environment allowlist to the managed CLI', () => {
    expect(buildReadOnlyStageAgentRuntimeEnv({
      PATH: '/usr/bin', LANG: 'en_US.UTF-8', SECRET_TOKEN: 'do-not-forward',
      OPENAI_API_KEY: 'do-not-forward', OPENCODE_CONFIG: '/safe/config.json',
    })).toEqual({
      PATH: '/usr/bin', LANG: 'en_US.UTF-8', OPENCODE_CONFIG: '/safe/config.json',
    })
  })

  it('binds citations to repo-relative paths and actual content digests', async () => {
    const root = await repository()
    const value = await executor(root, async () => ({
      toolCalls: 2,
      pendingPermissionCount: 0,
      diffCount: 0,
      value: {
        model: 'model-1', title: 'Clarification', summary: 'Repository verified.',
        goals: ['Goal'], acceptanceCriteria: ['Acceptance'], nonGoals: ['Non-goal'],
        openQuestions: [], assumptions: [], risks: [],
        repositoryFindings: {
          version: 1, repositoryDigest: '0'.repeat(64),
          verifiedFacts: [{ id: 'fact-1', statement: 'Package exists.', citationIds: ['c1'] }],
          citations: [{ id: 'c1', path: 'package.json', contentDigest: '' }],
          assumptions: [], openQuestions: [], uncheckedScopes: [],
        },
      },
    })).execute(executionInput())
    const bytes = await readFile(path.join(root, 'package.json'))
    expect(value.value.repositoryFindings?.citations[0]).toEqual({
      id: 'c1',
      path: 'package.json',
      contentDigest: createHash('sha256').update(bytes).digest('hex'),
    })
    expect(value.value.repositoryFindings?.repositoryDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('fails closed when the fake CLI changes the repository', async () => {
    const root = await repository()
    const localExecutor = executor(root, async () => {
      await writeFile(path.join(root, 'package.json'), '{"name":"changed"}\n')
      return {
        toolCalls: 1, pendingPermissionCount: 0, diffCount: 1,
        value: {
          model: 'model-1', title: 'Clarification', summary: 'Changed.', goals: ['Goal'],
          acceptanceCriteria: ['Acceptance'], nonGoals: ['Non-goal'], openQuestions: [], assumptions: [], risks: [],
        },
      }
    })
    await expect(localExecutor.execute(executionInput())).rejects.toThrow('produced a repository diff')
  })

  it('fails closed on permission escalation', async () => {
    const root = await repository()
    const localExecutor = executor(root, async () => ({
      toolCalls: 1, pendingPermissionCount: 1, diffCount: 0,
      value: {
        model: 'model-1', title: 'Clarification', summary: 'Permission requested.', goals: ['Goal'],
        acceptanceCriteria: ['Acceptance'], nonGoals: ['Non-goal'], openQuestions: [], assumptions: [], risks: [],
      },
    }))
    await expect(localExecutor.execute(executionInput())).rejects.toThrow('requested additional permission')
  })
})
