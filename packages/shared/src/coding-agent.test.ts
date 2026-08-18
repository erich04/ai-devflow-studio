import { describe, expect, it } from 'vitest'
import type {
  Artifact,
  CodingAgentRun,
  CodingDiffArtifact,
  DependencyBootstrapSnapshot,
  GateDecision,
  KnowledgeChunk,
  KnowledgeGovernanceCheck,
  KnowledgeReference,
  LocalProject,
  TestEvidence,
  WorkflowNode,
  WorkflowRun,
} from './domain'
import {
  MAX_DIFF_CHARS,
  MAX_CODING_KNOWLEDGE_EXCERPT_CHARS,
  MAX_CODING_KNOWLEDGE_REFERENCES,
  MAX_CODING_KNOWLEDGE_TOTAL_EXCERPT_CHARS,
  buildCodingBrief,
  canRunCodingAgentOnNode,
  createRemoteCodingAgentSummary,
  hasSupportedCodingDiffSanitization,
  redactRemoteCodingAgentSummaryForSync,
  sanitizeCodingDiffArtifact,
  selectDependencyBootstrap,
} from './coding-agent'
import { runs } from './fixtures'
import type { RemediationPlan, RetryAttempt } from './remediation'

const run: WorkflowRun = {
  id: 'run-1',
  version: 1,
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
  sourcePath: 'docs/standards/api-health.md',
}

const knowledgeChunk: KnowledgeChunk = {
  id: 'chunk-api-health',
  documentId: 'doc-api',
  sourcePath: 'docs/standards/api-health.md',
  headingPath: ['API Health Endpoint Standard', 'Evidence'],
  content: 'UNIQUE_KNOWLEDGE_CONTENT requires contract tests. API_TOKEN=super-secret-value',
  contentHash: 'hash-api',
  tokenCount: 12,
  tags: ['api', 'testing'],
  updatedAt: '2026-06-17T00:02:00.000Z',
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

const remediationPlan: RemediationPlan = {
  id: 'remediation-run-1-node-build-7',
  runId: run.id,
  nodeId: buildNode.id,
  status: 'blocked',
  policyVersion: 7,
  blockingReasonIds: ['governance_check:api_contract:violated:check-api'],
  warningReasonIds: [],
  remainingEvidenceGaps: ['API contract'],
  candidates: [
    {
      id: 'remediation-candidate-1',
      kind: 'fix_api_contract',
      title: 'Fix API contract violation',
      summary: 'Update the endpoint response to satisfy the documented API contract.',
      priority: 'high',
      sourceReasonIds: ['governance_check:api_contract:violated:check-api'],
      governanceCheckIds: ['check-api'],
      agentFindingIds: [],
      evidenceIds: [],
      knowledgeReferenceIds: ['ref-1'],
      requiresHumanApproval: true,
      eligibleForCodingRetry: true,
    },
  ],
  createdAt: '2026-06-18T12:00:00.000Z',
}

const retryAttempt: RetryAttempt = {
  id: 'retry-1',
  runId: run.id,
  nodeId: buildNode.id,
  projectId: 'project-1',
  remediationPlanId: remediationPlan.id,
  candidateIds: ['remediation-candidate-1'],
  requestedBy: 'lead-1',
  userInstruction: 'Apply the remediation candidate only.',
  status: 'approved',
  createdAt: '2026-06-18T12:01:00.000Z',
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
      knowledgeChunks: [knowledgeChunk],
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
    expect(brief.prompt).toContain('source=docs/standards/api-health.md')
    expect(brief.prompt).toContain('section="API Health Endpoint Standard > Evidence"')
    expect(brief.prompt).toContain('strategy=lexical')
    expect(brief.prompt).toContain('contentHash=hash-api')
    expect(brief.prompt).toContain('UNIQUE_KNOWLEDGE_CONTENT requires contract tests.')
    expect(brief.prompt).toContain('[REDACTED:env_secret_assignment]')
    expect(brief.prompt).not.toContain('super-secret-value')
    expect(brief.prompt).toContain('Testing Evidence Standard')
    expect(brief.prompt).toContain('Approved with test evidence required')
    expect(brief.prompt).toContain('Existing Test Evidence')
    expect(brief.prompt).toContain('corepack pnpm test -- --run [passed]: Local tests passed with redacted output.')
    expect(brief.prompt).toContain('Managed worktree: /tmp/devflow-worktrees/run-1')
  })

  it('includes remediation context only when a human-approved retry supplies it', () => {
    const baseBrief = buildCodingBrief({
      run,
      node: buildNode,
      project,
      upstreamArtifacts: [designArtifact],
      knowledgeReferences: [knowledgeReference],
      governanceChecks: [governanceCheck],
      gateDecisions: [],
      testEvidence: [testEvidence],
      userInstruction: 'Implement the build node.',
      worktreePath: '/tmp/devflow-worktrees/run-1',
      branchName: 'devflow/run-1-node-build',
    })
    const retryBrief = buildCodingBrief({
      run,
      node: buildNode,
      project,
      upstreamArtifacts: [designArtifact],
      knowledgeReferences: [knowledgeReference],
      governanceChecks: [governanceCheck],
      gateDecisions: [],
      testEvidence: [testEvidence],
      remediationPlan,
      retryAttempt,
      userInstruction: 'Apply the remediation candidate only.',
      worktreePath: '/tmp/devflow-worktrees/run-1',
      branchName: 'devflow/run-1-node-build',
    })

    expect(baseBrief.prompt).not.toContain('Remediation Plan')
    expect(baseBrief.prompt).not.toContain(remediationPlan.id)
    expect(retryBrief.prompt).toContain('Remediation Plan')
    expect(retryBrief.prompt).toContain('Retry Attempt')
    expect(retryBrief.prompt).toContain(remediationPlan.id)
    expect(retryBrief.prompt).toContain('Fix API contract violation')
    expect(retryBrief.prompt).toContain('Policy reason: governance_check:api_contract:violated:check-api')
    expect(retryBrief.prompt).toContain('Retry requested by: lead-1')
  })

  it('bounds referenced repository knowledge by count, per-excerpt size, and total excerpt size', () => {
    const references: KnowledgeReference[] = Array.from({ length: 9 }, (_, index) => ({
      ...knowledgeReference,
      id: `ref-${index}`,
      documentId: `doc-${index}`,
      chunkId: `chunk-${index}`,
      contentHash: `hash-${index}`,
      sourcePath: `docs/standards/standard-${index}.md`,
    }))
    const chunks: KnowledgeChunk[] = references.map((reference, index) => ({
      ...knowledgeChunk,
      id: reference.chunkId!,
      documentId: reference.documentId,
      sourcePath: reference.sourcePath!,
      contentHash: reference.contentHash!,
      content: `UNIQUE_KNOWLEDGE_${index}_${'x'.repeat(2_000)}`,
    }))

    const brief = buildCodingBrief({
      run,
      node: buildNode,
      project,
      upstreamArtifacts: [],
      knowledgeReferences: references,
      knowledgeChunks: chunks,
      governanceChecks: [],
      gateDecisions: [],
      testEvidence: [],
      userInstruction: 'Apply the referenced standards.',
      worktreePath: '<managed-worktree>',
      branchName: '<managed-branch>',
    })

    const knowledgeSection = brief.prompt.split('Knowledge References\n')[1]!.split('\n\nGovernance Checks')[0]!
    const referenceLines = knowledgeSection.match(/^- doc-\d+/gm) ?? []
    const excerpts = Array.from(knowledgeSection.matchAll(/^  Excerpt: (.*)$/gm), (match) => match[1] ?? '')

    expect(referenceLines).toHaveLength(MAX_CODING_KNOWLEDGE_REFERENCES)
    expect(knowledgeSection).not.toContain('doc-8 ')
    expect(excerpts.every((excerpt) => excerpt.length <= MAX_CODING_KNOWLEDGE_EXCERPT_CHARS)).toBe(true)
    expect(excerpts.reduce((total, excerpt) => total + excerpt.length, 0)).toBeLessThanOrEqual(
      MAX_CODING_KNOWLEDGE_TOTAL_EXCERPT_CHARS,
    )
    expect(knowledgeSection).toContain('UNIQUE_KNOWLEDGE_4_')
    expect(knowledgeSection).not.toContain('UNIQUE_KNOWLEDGE_5_')
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
  it('keeps replacement state separate from supported sanitizer provenance', () => {
    const safePatch = [
      'diff --git a/devflow-fake-change.txt b/devflow-fake-change.txt',
      '+DevFlow fake coding adapter was approved.',
    ].join('\n')
    const artifact = sanitizeCodingDiffArtifact({
      id: 'diff-safe',
      runId: run.id,
      nodeId: buildNode.id,
      projectId: project.id,
      changedPaths: ['devflow-fake-change.txt'],
      patch: safePatch,
      createdAt: '2026-06-17T00:06:00.000Z',
    })

    expect(artifact.patch).toBe(safePatch)
    expect(artifact.redacted).toBe(false)
    expect(artifact.secretReplacementCount).toBe(0)
    expect(hasSupportedCodingDiffSanitization(artifact)).toBe(true)
  })

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

    const resanitized = sanitizeCodingDiffArtifact({
      id: artifact.id,
      runId: artifact.runId,
      nodeId: artifact.nodeId,
      projectId: artifact.projectId,
      changedPaths: artifact.changedPaths,
      patch: artifact.patch,
      ...(artifact.sourceDigest ? { sourceDigest: artifact.sourceDigest } : {}),
      sanitizedAt: artifact.sanitizedAt!,
      createdAt: artifact.createdAt,
    })
    expect(resanitized).toEqual(artifact)
  })

  it('sanitizes every diff line and records versioned replacement provenance', () => {
    const artifact = sanitizeCodingDiffArtifact({
      id: 'diff-all-lines',
      runId: run.id,
      nodeId: buildNode.id,
      projectId: project.id,
      changedPaths: ['src/config.ts'],
      patch: [
        'diff --git a/src/config.ts b/src/config.ts',
        ' const existing = "ghp_1234567890abcdefghijklmnop";',
        '-const removed = "sk-oldsecret1234567890";',
        '+const added = "sk-newsecret1234567890";',
      ].join('\n'),
      createdAt: '2026-08-17T10:00:00.000Z',
    })

    expect(artifact.patch).not.toContain('ghp_1234567890abcdefghijklmnop')
    expect(artifact.patch).not.toContain('sk-oldsecret1234567890')
    expect(artifact.patch).not.toContain('sk-newsecret1234567890')
    expect(artifact.patch).toContain('[REDACTED:github_token]')
    expect(artifact.patch.match(/\[REDACTED:openai_api_key\]/g)).toHaveLength(2)
    expect(artifact.sanitizerVersion).toBe(2)
    expect(artifact.sanitizedAt).toBe('2026-08-17T10:00:00.000Z')
    expect(artifact.secretReplacementCount).toBe(3)
    expect(hasSupportedCodingDiffSanitization(artifact)).toBe(true)
    expect(hasSupportedCodingDiffSanitization({ ...artifact, redacted: false })).toBe(true)
    expect(hasSupportedCodingDiffSanitization({ ...artifact, sanitizerVersion: 3 })).toBe(false)
    const {
      sanitizerVersion: _sanitizerVersion,
      sanitizedAt: _sanitizedAt,
      secretReplacementCount: _secretReplacementCount,
      ...legacyArtifact
    } = artifact
    expect(hasSupportedCodingDiffSanitization(legacyArtifact)).toBe(false)

    const resanitized = sanitizeCodingDiffArtifact({
      id: artifact.id,
      runId: artifact.runId,
      nodeId: artifact.nodeId,
      projectId: artifact.projectId,
      changedPaths: artifact.changedPaths,
      patch: artifact.patch,
      sanitizedAt: artifact.sanitizedAt!,
      createdAt: artifact.createdAt,
    })
    expect(resanitized.patch).toBe(artifact.patch)
    expect(resanitized.secretReplacementCount).toBe(artifact.secretReplacementCount)
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

  it('redacts local paths and secrets from outbound branch and summary strings', () => {
    const codingRun: CodingAgentRun = {
      id: 'coding-run-hostile-metadata',
      runId: run.id,
      nodeId: buildNode.id,
      projectId: project.id,
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      engine: 'fake',
      status: 'completed',
      managedWorkspaceId: 'workspace-hostile',
      branchName: 'C:\\Users\\Alice\\private\\branch API_TOKEN=branch-secret',
      userInstruction: 'Do it safely.',
      prompt: 'raw prompt stays local',
      summary: 'Changed /Users/Alice/private/repo API_TOKEN=summary-secret',
      changedPaths: ['src/export.ts'],
      startedAt: '2026-06-17T00:05:00.000Z',
      completedAt: '2026-06-17T00:07:00.000Z',
      budgetDecision: {
        status: 'allowed',
        blocksRun: false,
        currentSpendUsd: 1,
        projectedCostUsd: 2,
        reason: 'Approved from /Users/Alice/private/repo API_TOKEN=budget-secret',
      },
      tokenUsageId: 'tokens-hostile',
      diffArtifactId: 'diff-hostile',
      testEvidenceId: 'evidence-hostile',
      redacted: true,
    }

    const summary = createRemoteCodingAgentSummary(codingRun)

    expect(summary.branchName).toBe(
      '[REDACTED:local_absolute_path] [REDACTED:env_secret_assignment]',
    )
    expect(summary.summary).toBe(
      'Changed [REDACTED:local_absolute_path] [REDACTED:env_secret_assignment]',
    )
    expect(summary.budgetDecision?.reason).toBe(
      'Approved from [REDACTED:local_absolute_path] [REDACTED:env_secret_assignment]',
    )
    expect(JSON.stringify(summary)).not.toContain('branch-secret')
    expect(JSON.stringify(summary)).not.toContain('summary-secret')
    expect(JSON.stringify(summary)).not.toContain('budget-secret')
    expect(JSON.stringify(summary)).not.toContain('/Users/Alice')
    expect(JSON.stringify(summary)).not.toMatch(/C:[\\/]Users[\\/]Alice/)
  })

  it('preserves an unavailable budget decision while redacting its hostile reason', () => {
    const codingRun: CodingAgentRun = {
      id: 'coding-run-budget-unavailable',
      runId: run.id,
      nodeId: buildNode.id,
      projectId: project.id,
      requestedBy: 'user-1',
      providerId: 'paid-coding-engine',
      engine: 'opencode-http',
      status: 'failed',
      branchName: 'devflow/run-1-node-build',
      userInstruction: 'Do it safely.',
      prompt: 'raw prompt stays local',
      summary: 'Coding run blocked before the managed workspace was created.',
      changedPaths: [],
      startedAt: '2026-06-17T00:05:00.000Z',
      completedAt: '2026-06-17T00:05:00.000Z',
      budgetDecision: {
        status: 'unavailable',
        blocksRun: true,
        currentSpendUsd: 0,
        projectedCostUsd: 0.02,
        reason:
          'Budget service failed at /Users/Alice/private/repo with Authorization: Bearer opaque-budget-token',
      },
      redacted: true,
    }

    const summary = createRemoteCodingAgentSummary(codingRun)
    const serialized = JSON.stringify(summary)

    expect(summary.budgetDecision).toEqual({
      status: 'unavailable',
      blocksRun: true,
      currentSpendUsd: 0,
      projectedCostUsd: 0.02,
      reason:
        'Budget service failed at [REDACTED:local_absolute_path] with [REDACTED:authorization_secret]',
    })
    expect(serialized).not.toContain('/Users/Alice')
    expect(serialized).not.toContain('opaque-budget-token')
    expect(serialized).not.toContain('raw prompt')
  })

  it('projects nested cost and budget metadata and redacts the cost model', () => {
    const summary = redactRemoteCodingAgentSummaryForSync({
      id: 'coding-run-hostile-nested-metadata',
      runId: run.id,
      nodeId: buildNode.id,
      projectId: project.id,
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      engine: 'fake',
      status: 'completed',
      branchName: 'devflow/run-1-node-build',
      summary: 'Implemented audit export.',
      changedPaths: ['src/export.ts'],
      startedAt: '2026-06-17T00:05:00.000Z',
      costSummary: {
        id: 'cost-hostile',
        runId: run.id,
        nodeId: buildNode.id,
        userId: 'user-1',
        projectId: project.id,
        provider: 'openai',
        providerId: 'fake-coding-engine',
        model: 'model from /Users/Alice/private API_TOKEN=model-secret',
        inputTokens: 12,
        outputTokens: 3,
        cacheReadTokens: 1,
        costUsd: 0.02,
        timestamp: '2026-06-17T00:07:00.000Z',
        source: 'estimated',
        redacted: true,
        apiKey: 'nested-api-key-secret',
      },
      budgetDecision: {
        status: 'approved_over_budget',
        blocksRun: false,
        currentSpendUsd: 1,
        projectedCostUsd: 2,
        limitUsd: 1.5,
        approvalRequiredRole: 'lead',
        approvalId: 'approval-1',
        reason: 'Approved from C:\\Users\\Alice\\private API_TOKEN=budget-secret',
        token: 'nested-budget-token-secret',
      },
      redacted: true,
    } as Parameters<typeof redactRemoteCodingAgentSummaryForSync>[0])

    expect(summary.costSummary).toEqual({
      id: 'cost-hostile',
      runId: run.id,
      nodeId: buildNode.id,
      userId: 'user-1',
      projectId: project.id,
      provider: 'openai',
      providerId: 'fake-coding-engine',
      model: 'model from [REDACTED:local_absolute_path] [REDACTED:env_secret_assignment]',
      inputTokens: 12,
      outputTokens: 3,
      cacheReadTokens: 1,
      costUsd: 0.02,
      timestamp: '2026-06-17T00:07:00.000Z',
      source: 'estimated',
      redacted: true,
    })
    expect(summary.budgetDecision).toEqual({
      status: 'approved_over_budget',
      blocksRun: false,
      currentSpendUsd: 1,
      projectedCostUsd: 2,
      limitUsd: 1.5,
      approvalRequiredRole: 'lead',
      approvalId: 'approval-1',
      reason: 'Approved from [REDACTED:local_absolute_path] [REDACTED:env_secret_assignment]',
    })
    expect(JSON.stringify(summary)).not.toContain('nested-api-key-secret')
    expect(JSON.stringify(summary)).not.toContain('nested-budget-token-secret')
    expect(JSON.stringify(summary)).not.toContain('model-secret')
    expect(JSON.stringify(summary)).not.toContain('budget-secret')
    expect(() =>
      redactRemoteCodingAgentSummaryForSync({
        ...summary,
        nodeId: `${summary.runId}:${summary.nodeId}`,
      }),
    ).toThrow(/reserved Team node namespace/)
    expect(() =>
      redactRemoteCodingAgentSummaryForSync({
        ...summary,
        costSummary: {
          ...summary.costSummary!,
          nodeId: 'node-other',
        },
      }),
    ).toThrow('Remote coding cost scope must match its coding summary.')
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
