import { describe, expect, it } from 'vitest'
import type {
  Artifact,
  CodingAgentRun,
  CodingDiffArtifact,
  DependencyBootstrapSnapshot,
  GateDecision,
  KnowledgeGovernanceCheck,
  KnowledgeReference,
  LocalProject,
  TestEvidence,
  WorkflowNode,
  WorkflowRun,
} from './domain'
import {
  MAX_DIFF_CHARS,
  buildCodingBrief,
  canRunCodingAgentOnNode,
  createRemoteCodingAgentSummary,
  sanitizeCodingDiffArtifact,
  selectDependencyBootstrap,
} from './coding-agent'
import { runs } from './fixtures'

const run: WorkflowRun = {
  id: 'run-1',
  title: 'Add audit export',
  request: 'Design and build a CSV export for audit events.',
  projectId: 'project-1',
  creatorId: 'user-1',
  status: 'building',
  currentNodeId: 'node-build',
  branchName: 'ai/audit-export',
  createdAt: '2026-06-17T00:00:00.000Z',
  updatedAt: '2026-06-17T00:05:00.000Z',
  nodes: [],
  edges: [],
}

const buildNode: WorkflowNode = {
  id: 'node-build',
  stage: 'build',
  title: 'Build audit export',
  subtitle: 'Implement the approved design in a managed worktree.',
  kind: 'task',
  status: 'pending',
  ownerId: 'user-1',
  retryCount: 0,
  artifactIds: ['artifact-design'],
}

const designArtifact: Artifact = {
  id: 'artifact-design',
  runId: run.id,
  nodeId: 'node-design',
  kind: 'design',
  title: 'Audit export design',
  summary: 'Add a paginated CSV endpoint and preserve redaction.',
  content: 'The endpoint must not include raw secrets or local filesystem paths.',
  redacted: false,
  updatedAt: '2026-06-17T00:03:00.000Z',
}

const knowledgeReference: KnowledgeReference = {
  id: 'ref-1',
  runId: run.id,
  targetType: 'node',
  nodeId: buildNode.id,
  documentId: 'doc-api',
  relation: 'cites',
  reason: 'API changes should follow the API health standard.',
  chunkId: 'chunk-api-health',
  score: 0.88,
  strategy: 'lexical',
  contentHash: 'hash-api',
  headingPath: ['API Health Endpoint Standard', 'Evidence'],
}

const governanceCheck: KnowledgeGovernanceCheck = {
  id: 'check-1',
  runId: run.id,
  nodeId: buildNode.id,
  documentId: 'doc-testing',
  title: 'Testing Evidence Standard',
  category: 'testing_standard',
  status: 'needs_evidence',
  summary: 'A test report is required before approval.',
  referenceIds: [knowledgeReference.id],
}

const gateDecision: GateDecision = {
  id: 'gate-1',
  runId: run.id,
  nodeId: 'node-gate',
  approverId: 'lead-1',
  decision: 'approved',
  comment: 'Approved with test evidence required after implementation.',
  decidedAt: '2026-06-17T00:04:00.000Z',
}

const testEvidence: TestEvidence = {
  id: 'evidence-1',
  runId: run.id,
  nodeId: buildNode.id,
  projectId: 'project-1',
  command: 'corepack pnpm test -- --run',
  cwd: '/tmp/devflow-worktrees/run-1',
  status: 'passed',
  exitCode: 0,
  durationMs: 1280,
  stdout: 'tests passed',
  stderr: '',
  summary: 'Local tests passed with redacted output.',
  redacted: true,
  createdAt: '2026-06-17T00:05:00.000Z',
}

const project: LocalProject = {
  id: 'project-1',
  name: 'Audit API',
  path: '/Users/erich/dev/audit-api',
  packageManager: 'pnpm',
  detectedTestCommand: 'corepack pnpm test',
  testCommand: 'corepack pnpm test -- --run',
  createdAt: '2026-06-17T00:00:00.000Z',
  updatedAt: '2026-06-17T00:00:00.000Z',
}

describe('canRunCodingAgentOnNode', () => {
  it('allows only build task nodes, including the seeded implementation node', () => {
    const seededBuildNode = runs[0]!.nodes.find((node) => node.id === 'n-build')

    expect(seededBuildNode).toMatchObject({ stage: 'build', kind: 'task' })
    expect(canRunCodingAgentOnNode(buildNode)).toBe(true)
    expect(canRunCodingAgentOnNode(seededBuildNode!)).toBe(true)
  })

  it('rejects non-build-task nodes even when either stage or kind partially matches', () => {
    expect(canRunCodingAgentOnNode({ ...buildNode, kind: 'agent' })).toBe(false)
    expect(canRunCodingAgentOnNode({ ...buildNode, kind: 'gate' })).toBe(false)
    expect(canRunCodingAgentOnNode({ ...buildNode, stage: 'clarify' })).toBe(false)
    expect(canRunCodingAgentOnNode({ ...buildNode, stage: 'design' })).toBe(false)
    expect(canRunCodingAgentOnNode({ ...buildNode, stage: 'test' })).toBe(false)
  })
})

describe('buildCodingBrief', () => {
  it('assembles a DevFlow-native coding brief from run, node, artifacts, knowledge, gates, and tests', () => {
    const brief = buildCodingBrief({
      run,
      node: buildNode,
      project,
      upstreamArtifacts: [designArtifact],
      knowledgeReferences: [knowledgeReference],
      governanceChecks: [governanceCheck],
      gateDecisions: [gateDecision],
      testEvidence: [testEvidence],
      userInstruction: 'Keep the endpoint behind the existing auth middleware.',
      worktreePath: '/tmp/devflow-worktrees/run-1',
      branchName: 'devflow/run-1-node-build',
    })

    expect(brief.runId).toBe(run.id)
    expect(brief.nodeId).toBe(buildNode.id)
    expect(brief.testCommand).toBe(project.testCommand)
    expect(brief.userInstruction).toBe('Keep the endpoint behind the existing auth middleware.')
    expect(brief.prompt).toContain('Run: Add audit export')
    expect(brief.prompt).toContain('Node: Build audit export')
    expect(brief.prompt).toContain('Audit export design')
    expect(brief.prompt).toContain('Knowledge References')
    expect(brief.prompt).toContain('Testing Evidence Standard')
    expect(brief.prompt).toContain('Approved with test evidence required')
    expect(brief.prompt).toContain('Existing Test Evidence')
    expect(brief.prompt).toContain('corepack pnpm test -- --run [passed]: Local tests passed with redacted output.')
    expect(brief.prompt).toContain('Managed worktree: /tmp/devflow-worktrees/run-1')
  })
})

describe('selectDependencyBootstrap', () => {
  it('uses frozen install commands for package-manager lockfiles', () => {
    expect(selectDependencyBootstrap(snapshot({ 'pnpm-lock.yaml': 'lock' })).command).toBe(
      'corepack pnpm install --frozen-lockfile',
    )
    expect(selectDependencyBootstrap(snapshot({ 'package-lock.json': 'lock' })).command).toBe('npm ci')
    expect(selectDependencyBootstrap(snapshot({ 'yarn.lock': 'lock' })).command).toBe(
      'corepack yarn install --immutable',
    )
    expect(selectDependencyBootstrap(snapshot({ 'bun.lock': 'lock' })).command).toBe(
      'bun install --frozen-lockfile',
    )
  })

  it('requires approval for non-frozen installs when package.json exists without a lockfile', () => {
    const decision = selectDependencyBootstrap(snapshot({}))

    expect(decision.status).toBe('needs_approval')
    expect(decision.risk).toBe('warn')
    expect(decision.command).toBe('npm install')
    expect(decision.reason).toContain('No package-manager lockfile')
  })

  it('skips bootstrap when node_modules exists and dependency hash is unchanged', () => {
    const files = { 'pnpm-lock.yaml': 'same-lock' }
    const first = selectDependencyBootstrap(snapshot(files))
    const second = selectDependencyBootstrap(snapshot(files, true, first.dependencyHash))

    expect(first.status).toBe('required')
    expect(second.status).toBe('skipped')
    expect(second.command).toBe('')
  })
})

describe('sanitizeCodingDiffArtifact', () => {
  it('redacts secrets in added diff lines, drops non-relative paths, and caps large patches', () => {
    const huge = '+'.repeat(MAX_DIFF_CHARS + 120)
    const artifact = sanitizeCodingDiffArtifact({
      id: 'diff-1',
      runId: run.id,
      nodeId: buildNode.id,
      projectId: project.id,
      changedPaths: ['src/export.ts', '/Users/erich/.ssh/id_rsa', '../outside.txt'],
      patch: [
        'diff --git a/src/export.ts b/src/export.ts',
        '+const apiKey = "sk-live-1234567890abcdefghijklmnopqrstuv";',
        '+const safe = true;',
        huge,
      ].join('\n'),
      createdAt: '2026-06-17T00:06:00.000Z',
    })

    expect(artifact.changedPaths).toEqual(['src/export.ts'])
    expect(artifact.patch).toContain('[REDACTED:openai_api_key]')
    expect(artifact.patch).not.toContain('sk-live-1234567890abcdefghijklmnopqrstuv')
    expect(artifact.patch.length).toBeLessThanOrEqual(MAX_DIFF_CHARS + 32)
    expect(artifact.truncated).toBe(true)
    expect(artifact.redacted).toBe(true)
  })
})

describe('createRemoteCodingAgentSummary', () => {
  it('syncs only redacted coding metadata and caps changed paths', () => {
    const changedPaths = Array.from({ length: 60 }, (_, index) => `src/file-${index}.ts`)
    const codingRun: CodingAgentRun = {
      id: 'coding-run-1',
      runId: run.id,
      nodeId: buildNode.id,
      projectId: project.id,
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      engine: 'fake',
      status: 'completed',
      managedWorkspaceId: 'workspace-1',
      branchName: 'devflow/run-1-node-build',
      userInstruction: 'Do it safely.',
      prompt: 'raw prompt stays local',
      summary: 'Implemented audit export in a managed worktree.',
      changedPaths,
      startedAt: '2026-06-17T00:05:00.000Z',
      completedAt: '2026-06-17T00:07:00.000Z',
      tokenUsageId: 'tokens-1',
      diffArtifactId: 'diff-1',
      bootstrapEvidenceId: 'bootstrap-1',
      testEvidenceId: 'evidence-1',
      redacted: true,
    }
    const diff: CodingDiffArtifact = {
      id: 'diff-1',
      runId: run.id,
      nodeId: buildNode.id,
      projectId: project.id,
      changedPaths,
      patch: '+secret=sk-live-1234567890abcdefghijklmnopqrstuv',
      truncated: false,
      redacted: true,
      createdAt: '2026-06-17T00:06:00.000Z',
    }

    const summary = createRemoteCodingAgentSummary(codingRun, diff)
    const serialized = JSON.stringify(summary)

    expect(summary.changedPaths).toHaveLength(50)
    expect(summary.redacted).toBe(true)
    expect(serialized).not.toContain('raw prompt')
    expect(serialized).not.toContain('patch')
    expect(serialized).not.toContain('cwd')
    expect(serialized).not.toContain('stdout')
    expect(serialized).not.toContain('stderr')
    expect(serialized).not.toContain('sk-live')
  })
})

function snapshot(
  files: Record<string, string>,
  nodeModulesPresent = false,
  previousDependencyHash?: string,
): DependencyBootstrapSnapshot {
  return {
    files: {
      'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
      ...files,
    },
    nodeModulesPresent,
    ...(previousDependencyHash ? { previousDependencyHash } : {}),
  }
}
