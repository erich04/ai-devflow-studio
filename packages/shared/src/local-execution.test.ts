import { describe, expect, it } from 'vitest'
import type { WorkflowRun } from './domain'
import {
  applyTestEvidenceToRun,
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  detectTestCommand,
  resolveTestCommand,
} from './local-execution'

const baseRun: WorkflowRun = {
  id: 'run-1',
  title: 'Add test evidence',
  request: 'Run local tests and archive evidence.',
  projectId: 'project-1',
  creatorId: 'user-1',
  status: 'testing',
  currentNodeId: 'node-test',
  branchName: 'ai/test-evidence',
  createdAt: '2026-06-15T00:00:00.000Z',
  updatedAt: '2026-06-15T00:00:00.000Z',
  nodes: [
    {
      id: 'node-test',
      stage: 'test',
      title: '开发自测',
      subtitle: '执行本地测试命令',
      kind: 'test',
      status: 'running',
      ownerId: 'user-1',
      retryCount: 0,
      artifactIds: [],
    },
  ],
  edges: [],
}

describe('detectTestCommand', () => {
  it('uses corepack pnpm test when package.json has a test script and pnpm-lock.yaml exists', () => {
    const detected = detectTestCommand({
      'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
      'pnpm-lock.yaml': 'lockfileVersion: 9.0',
    })

    expect(detected).toEqual({
      command: 'corepack pnpm test',
      packageManager: 'pnpm',
      source: 'package.json',
      reason: 'package.json scripts.test',
    })
  })

  it('falls back to npm test when package.json has a test script but no package-manager lockfile exists', () => {
    const detected = detectTestCommand({
      'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    })

    expect(detected?.command).toBe('npm test')
    expect(detected?.packageManager).toBe('npm')
  })

  it('returns null when no package.json test script can be found', () => {
    expect(detectTestCommand({ 'README.md': '# no scripts here' })).toBeNull()
  })
})

describe('resolveTestCommand', () => {
  it('uses a non-empty manual override before the detected command', () => {
    const detected = detectTestCommand({
      'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
      'yarn.lock': '',
    })

    expect(resolveTestCommand(detected, 'corepack pnpm test -- --run')).toBe('corepack pnpm test -- --run')
  })

  it('uses the detected command when the manual override is empty', () => {
    const detected = detectTestCommand({
      'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
      'bun.lockb': '',
    })

    expect(resolveTestCommand(detected, '   ')).toBe('bun test')
  })
})

describe('test evidence helpers', () => {
  it('marks the test node successful and links the generated test artifact when tests pass', () => {
    const evidence = {
      id: 'evidence-1',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'pnpm test',
      cwd: '/tmp/project',
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 1240,
      stdout: '8 tests passed',
      stderr: '',
      summary: 'Tests passed in 1.2s',
      redacted: false,
      createdAt: '2026-06-15T00:01:00.000Z',
    }

    const artifact = createTestEvidenceArtifact(evidence)
    const event = createTestEvidenceEvent(evidence)
    const updated = applyTestEvidenceToRun(baseRun, evidence, artifact.id)

    expect(artifact.kind).toBe('test_report')
    expect(artifact.content).toContain('8 tests passed')
    expect(event.kind).toBe('test_result')
    expect(updated.nodes[0]?.status).toBe('success')
    expect(updated.nodes[0]?.artifactIds).toContain('artifact-evidence-1')
  })

  it('marks the test node failed and redacts secrets before creating artifacts', () => {
    const evidence = {
      id: 'evidence-2',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'pnpm test',
      cwd: '/tmp/project',
      status: 'failed' as const,
      exitCode: 1,
      durationMs: 800,
      stdout: 'ANTHROPIC_API_KEY=sk-ant-1234567890abcdefghijklmnop',
      stderr: 'failure',
      summary: 'Tests failed with exit code 1',
      redacted: true,
      createdAt: '2026-06-15T00:02:00.000Z',
    }

    const artifact = createTestEvidenceArtifact(evidence)
    const updated = applyTestEvidenceToRun(baseRun, evidence, artifact.id)

    expect(artifact.content).toContain('[REDACTED:env_secret_assignment]')
    expect(artifact.content).not.toContain('sk-ant-1234567890abcdefghijklmnop')
    expect(updated.status).toBe('failed')
    expect(updated.nodes[0]?.status).toBe('failed')
  })
})
