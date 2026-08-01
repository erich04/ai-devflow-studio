import { describe, expect, it } from 'vitest'
import type { WorkflowRun } from './domain'
import {
  applyTestEvidenceToRun,
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  detectTestCommand,
  redactTestEvidenceForStorage,
  resolveTestCommand,
} from './local-execution'

const baseRun: WorkflowRun = {
  id: 'run-1',
  version: 1,
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
  it('redacts the workspace root before Test Evidence is persisted or rendered', () => {
    const evidence = redactTestEvidenceForStorage({
      id: 'evidence-storage-redaction',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'node /Users/alice/work/devflow/scripts/test.mjs',
      cwd: '/Users/alice/work/devflow',
      status: 'failed',
      exitCode: 1,
      durationMs: 800,
      stdout: 'FAIL /Users/alice/work/devflow/src/workflow.test.ts:42',
      stderr: 'API_TOKEN=secret-token-value',
      summary: 'Tests failed in /Users/alice/work/devflow',
      redacted: false,
      createdAt: '2026-06-15T00:02:00.000Z',
    })

    expect(evidence).toMatchObject({
      command: 'node <workspace>/scripts/test.mjs',
      cwd: '<workspace>',
      stdout: 'FAIL <workspace>/src/workflow.test.ts:42',
      stderr: '[REDACTED:env_secret_assignment]',
      summary: 'Tests failed in <workspace>',
      redacted: true,
    })
    expect(JSON.stringify(evidence)).not.toContain('/Users/alice/work/devflow')
    expect(JSON.stringify(evidence)).not.toContain('secret-token-value')
  })

  it('redacts Windows workspace paths case-insensitively when cwd has a trailing separator', () => {
    const evidence = redactTestEvidenceForStorage({
      id: 'evidence-windows-storage-redaction',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'node C:\\Users\\Alice\\Work\\DevFlow\\scripts\\test.mjs',
      cwd: 'C:\\Users\\Alice\\Work\\DevFlow\\',
      status: 'failed',
      exitCode: 1,
      durationMs: 800,
      stdout: 'FAIL c:/users/alice/work/devflow/src/workflow.test.ts:42',
      stderr: '',
      summary: 'Tests failed in c:\\users\\alice\\work\\devflow',
      redacted: false,
      createdAt: '2026-06-15T00:02:00.000Z',
    })

    expect(evidence).toMatchObject({
      command: 'node <workspace>\\scripts\\test.mjs',
      cwd: '<workspace>',
      stdout: 'FAIL <workspace>/src/workflow.test.ts:42',
      summary: 'Tests failed in <workspace>',
      redacted: true,
    })
  })

  it('redacts file URL workspace roots whose spaces, hash, and question mark are encoded', () => {
    const evidence = redactTestEvidenceForStorage({
      id: 'evidence-encoded-file-url-storage-redaction',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'node file:///Users/alice/work/My%20%23Plan%3F/scripts/test.mjs',
      cwd: '/Users/alice/work/My #Plan?',
      status: 'failed',
      exitCode: 1,
      durationMs: 800,
      stdout: 'FAIL file:///Users/alice/work/My%20%23Plan%3F/src/workflow.test.ts:42',
      stderr: '',
      summary: 'Tests failed in /Users/alice/work/My%20%23Plan%3F',
      redacted: false,
      createdAt: '2026-06-15T00:02:00.000Z',
    })

    expect(evidence).toMatchObject({
      command: 'node file://<workspace>/scripts/test.mjs',
      cwd: '<workspace>',
      stdout: 'FAIL file://<workspace>/src/workflow.test.ts:42',
      summary: 'Tests failed in <workspace>',
      redacted: true,
    })
  })

  it('sanitizes raw Test Evidence before building the archived artifact', () => {
    const artifact = createTestEvidenceArtifact({
      id: 'evidence-raw-artifact-boundary',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'node /Users/alice/work/devflow/scripts/test.mjs',
      cwd: '/Users/alice/work/devflow',
      status: 'failed',
      exitCode: 1,
      durationMs: 800,
      stdout: 'FAIL /Users/alice/work/devflow/src/workflow.test.ts:42',
      stderr: 'API_TOKEN=super-secret-token',
      summary: 'Tests failed in /Users/alice/work/devflow with API_TOKEN=super-secret-token',
      redacted: false,
      createdAt: '2026-06-15T00:02:00.000Z',
    })

    expect(artifact.summary).toBe(
      'Tests failed in <workspace> with [REDACTED:env_secret_assignment]',
    )
    expect(JSON.stringify(artifact)).not.toContain('/Users/alice/work/devflow')
    expect(JSON.stringify(artifact)).not.toContain('super-secret-token')
    expect(artifact.redacted).toBe(true)
  })

  it('sanitizes raw Test Evidence before building the test result event', () => {
    const event = createTestEvidenceEvent({
      id: 'evidence-raw-event-boundary',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'pnpm test',
      cwd: '/Users/alice/work/devflow',
      status: 'failed',
      exitCode: 1,
      durationMs: 800,
      stdout: '',
      stderr: '',
      summary: 'Tests failed in /Users/alice/work/devflow with API_TOKEN=super-secret-token',
      redacted: false,
      createdAt: '2026-06-15T00:02:00.000Z',
    })

    expect(event.message).toBe(
      'Tests failed in <workspace> with [REDACTED:env_secret_assignment]',
    )
    expect(JSON.stringify(event)).not.toContain('/Users/alice/work/devflow')
    expect(JSON.stringify(event)).not.toContain('super-secret-token')
  })

  it('redacts Windows and file URL workspace variants without mutating the candidate', () => {
    const candidate = {
      id: 'evidence-windows-storage-redaction',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'node C:\\Users\\alice\\work\\devflow\\scripts\\test.mjs',
      cwd: 'C:\\Users\\alice\\work\\devflow',
      status: 'failed' as const,
      exitCode: 1,
      durationMs: 800,
      stdout: 'FAIL file:///C:/Users/alice/work/devflow/src/workflow.test.ts:42',
      stderr: '',
      summary: 'Tests failed in C:/Users/alice/work/devflow',
      redacted: false,
      createdAt: '2026-06-15T00:02:00.000Z',
    }

    const evidence = redactTestEvidenceForStorage(candidate)

    expect(candidate.cwd).toBe('C:\\Users\\alice\\work\\devflow')
    expect(evidence).toMatchObject({
      command: 'node <workspace>\\scripts\\test.mjs',
      cwd: '<workspace>',
      stdout: 'FAIL file:///<workspace>/src/workflow.test.ts:42',
      summary: 'Tests failed in <workspace>',
      redacted: true,
    })
    expect(JSON.stringify(evidence)).not.toMatch(/C:[\\/]Users[\\/]alice/)
  })

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

  it('replaces the known POSIX workspace root before archiving local test output', () => {
    const evidence = {
      id: 'evidence-posix-path',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'pnpm test',
      cwd: '/Users/alice/work/devflow',
      status: 'failed' as const,
      exitCode: 1,
      durationMs: 800,
      stdout: 'FAIL /Users/alice/work/devflow/src/workflow.test.ts:42',
      stderr: '',
      summary: 'Tests failed with exit code 1',
      redacted: false,
      createdAt: '2026-06-15T00:02:00.000Z',
    }

    const artifact = createTestEvidenceArtifact(evidence)

    expect(artifact.content).toContain('CWD: <workspace>')
    expect(artifact.content).toContain('FAIL <workspace>/src/workflow.test.ts:42')
    expect(artifact.content).not.toContain(evidence.cwd)
    expect(artifact.redacted).toBe(true)
  })

  it('replaces a known Windows workspace root when test output uses forward slashes', () => {
    const evidence = {
      id: 'evidence-windows-path',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'pnpm test',
      cwd: 'C:\\Users\\alice\\work\\devflow',
      status: 'failed' as const,
      exitCode: 1,
      durationMs: 800,
      stdout: 'FAIL C:/Users/alice/work/devflow/src/workflow.test.ts:42',
      stderr: '',
      summary: 'Tests failed with exit code 1',
      redacted: false,
      createdAt: '2026-06-15T00:02:00.000Z',
    }

    const artifact = createTestEvidenceArtifact(evidence)

    expect(artifact.content).toContain('FAIL <workspace>/src/workflow.test.ts:42')
    expect(artifact.content).not.toContain('C:/Users/alice/work/devflow')
  })

  it('replaces an encoded workspace root in file URLs before redacting secrets', () => {
    const evidence = {
      id: 'evidence-file-url',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'pnpm test',
      cwd: '/Users/alice/work/My Project',
      status: 'failed' as const,
      exitCode: 1,
      durationMs: 800,
      stdout:
        'at file:///Users/alice/work/My%20Project/src/workflow.test.ts:42 ANTHROPIC_API_KEY=sk-ant-1234567890abcdefghijklmnop',
      stderr: '',
      summary: 'Tests failed with exit code 1',
      redacted: false,
      createdAt: '2026-06-15T00:02:00.000Z',
    }

    const artifact = createTestEvidenceArtifact(evidence)

    expect(artifact.content).toContain('file://<workspace>/src/workflow.test.ts:42')
    expect(artifact.content).toContain('[REDACTED:env_secret_assignment]')
    expect(artifact.content).not.toContain('/Users/alice/work/My%20Project')
    expect(artifact.content).not.toContain('sk-ant-1234567890abcdefghijklmnop')
  })

  it('does not label a sibling path as the workspace while still redacting it', () => {
    const evidence = {
      id: 'evidence-path-boundary',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'pnpm test',
      cwd: '/Users/alice/work/devflow',
      status: 'failed' as const,
      exitCode: 1,
      durationMs: 800,
      stdout:
        'workspace=/Users/alice/work/devflow/src sibling=/Users/alice/work/devflow-copy/src',
      stderr: '',
      summary: 'Tests failed with exit code 1',
      redacted: false,
      createdAt: '2026-06-15T00:02:00.000Z',
    }

    const artifact = createTestEvidenceArtifact(evidence)

    expect(artifact.content).toContain('workspace=<workspace>/src')
    expect(artifact.content).toContain('sibling=[REDACTED:local_absolute_path]')
    expect(artifact.content).not.toContain('sibling=<workspace>-copy')
  })

  it('redacts the workspace root and secrets from the archived test command', () => {
    const evidence = {
      id: 'evidence-command-path',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command:
        'node /Users/alice/work/devflow/scripts/test.mjs API_TOKEN=secret-token-value',
      cwd: '/Users/alice/work/devflow',
      status: 'failed' as const,
      exitCode: 1,
      durationMs: 800,
      stdout: '',
      stderr: '',
      summary: 'Tests failed with exit code 1',
      redacted: false,
      createdAt: '2026-06-15T00:02:00.000Z',
    }

    const artifact = createTestEvidenceArtifact(evidence)

    expect(artifact.content).toContain(
      'Command: node <workspace>/scripts/test.mjs [REDACTED:env_secret_assignment]',
    )
    expect(artifact.content).not.toContain(evidence.cwd)
    expect(artifact.content).not.toContain('secret-token-value')
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
