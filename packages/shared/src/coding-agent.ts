import type {
  Artifact,
  CodingAgentRun,
  CodingDiffArtifact,
  DependencyBootstrapDecision,
  DependencyBootstrapSnapshot,
  GateDecision,
  KnowledgeGovernanceCheck,
  KnowledgeReference,
  LocalProject,
  PackageManager,
  RemoteCodingAgentSummary,
  TestEvidence,
  WorkflowNode,
  WorkflowRun,
} from './domain'
import type { RemediationPlan, RetryAttempt } from './remediation'
import { detectPackageManager } from './local-execution'
import { redactSecrets } from './redaction'

export const MAX_DIFF_CHARS = 50_000
export const MAX_REMOTE_CHANGED_PATHS = 50

export type CodingBriefInput = {
  run: WorkflowRun
  node: WorkflowNode
  project: LocalProject
  upstreamArtifacts: Artifact[]
  knowledgeReferences: KnowledgeReference[]
  governanceChecks: KnowledgeGovernanceCheck[]
  gateDecisions: GateDecision[]
  testEvidence: TestEvidence[]
  remediationPlan?: RemediationPlan | undefined
  retryAttempt?: RetryAttempt | undefined
  userInstruction: string
  worktreePath: string
  branchName: string
}

export type CodingBrief = {
  runId: string
  nodeId: string
  projectId: string
  testCommand: string
  branchName: string
  worktreePath: string
  userInstruction: string
  prompt: string
}

export type RawCodingDiffArtifact = {
  id: string
  runId: string
  nodeId: string
  projectId: string
  changedPaths: string[]
  patch: string
  createdAt: string
}

export function canRunCodingAgentOnNode(node: WorkflowNode): boolean {
  // DevFlow models implementation work as build-stage task nodes.
  return node.stage === 'build' && node.kind === 'task'
}

export function buildCodingBrief(input: CodingBriefInput): CodingBrief {
  const userInstruction = input.userInstruction.trim()
  const artifactLines = input.upstreamArtifacts.length
    ? input.upstreamArtifacts.map((artifact) => {
        return `- ${artifact.title} (${artifact.kind}): ${artifact.summary}\n  ${artifact.content}`
      })
    : ['- No upstream artifacts are available.']
  const knowledgeLines = input.knowledgeReferences.length
    ? input.knowledgeReferences.map((reference) => {
        const section = reference.headingPath?.length ? ` section="${reference.headingPath.join(' > ')}"` : ''
        const score = typeof reference.score === 'number' ? ` score=${reference.score.toFixed(2)}` : ''
        return `- ${reference.documentId}${section}${score}: ${reference.reason}`
      })
    : ['- No knowledge references are attached.']
  const governanceLines = input.governanceChecks.length
    ? input.governanceChecks.map((check) => {
        return `- ${check.title} [${check.status}]: ${check.summary}`
      })
    : ['- No governance checks are attached.']
  const gateLines = input.gateDecisions.length
    ? input.gateDecisions.map((decision) => {
        return `- ${decision.decision} by ${decision.approverId}: ${decision.comment}`
      })
    : ['- No gate decisions have been recorded.']
  const testEvidenceLines = input.testEvidence.length
    ? input.testEvidence.map((evidence) => {
        return `- ${evidence.command} [${evidence.status}]: ${evidence.summary}`
      })
    : ['- No test evidence has been recorded.']
  const remediationLines =
    input.remediationPlan && input.retryAttempt
      ? [
          `Plan: ${input.remediationPlan.id} [${input.remediationPlan.status}] policyVersion=${input.remediationPlan.policyVersion}`,
          `Retry Attempt: ${input.retryAttempt.id} [${input.retryAttempt.status}]`,
          `Retry requested by: ${input.retryAttempt.requestedBy}`,
          ...input.remediationPlan.candidates
            .filter((candidate) => input.retryAttempt?.candidateIds.includes(candidate.id))
            .map((candidate) => {
              const reasons = candidate.sourceReasonIds.map((reasonId) => `Policy reason: ${reasonId}`).join('; ')
              return `- ${candidate.title} [${candidate.priority}]: ${candidate.summary}${reasons ? `\n  ${reasons}` : ''}`
            }),
        ]
      : []

  const prompt = [
    'You are the DevFlow managed coding adapter. Work only inside the managed worktree.',
    '',
    `Run: ${input.run.title}`,
    `Request: ${input.run.request}`,
    `Node: ${input.node.title}`,
    `Node details: ${input.node.subtitle}`,
    `Managed worktree: ${input.worktreePath}`,
    `Branch: ${input.branchName}`,
    `Test command: ${input.project.testCommand || '(none configured)'}`,
    '',
    'Upstream Artifacts',
    artifactLines.join('\n'),
    '',
    'Knowledge References',
    knowledgeLines.join('\n'),
    '',
    'Governance Checks',
    governanceLines.join('\n'),
    '',
    'Gate Decisions',
    gateLines.join('\n'),
    '',
    'Existing Test Evidence',
    testEvidenceLines.join('\n'),
    '',
    ...(remediationLines.length
      ? ['Remediation Plan', remediationLines.join('\n'), '']
      : []),
    'User Instruction',
    userInstruction || 'Implement the node using the upstream context. Keep changes minimal and testable.',
    '',
    'Constraints',
    '- Do not read or write outside the managed worktree.',
    '- Ask permission before bash, edit, install, patch, or external-directory actions.',
    '- Do not include secrets, raw local paths, stdout, stderr, or provider keys in summaries.',
    '- Produce a minimal diff and leave test evidence for the configured test command.',
  ].join('\n')

  return {
    runId: input.run.id,
    nodeId: input.node.id,
    projectId: input.project.id,
    testCommand: input.project.testCommand,
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    userInstruction,
    prompt,
  }
}

export function selectDependencyBootstrap(
  snapshot: DependencyBootstrapSnapshot,
): DependencyBootstrapDecision {
  const packageManager = detectPackageManager(snapshot.files)
  const dependencyHash = hashDependencyInputs(snapshot.files)

  if (
    snapshot.nodeModulesPresent &&
    snapshot.previousDependencyHash &&
    snapshot.previousDependencyHash === dependencyHash
  ) {
    return {
      status: 'skipped',
      packageManager,
      command: '',
      dependencyHash,
      risk: 'safe',
      reason: 'node_modules exists and dependency manifest hash is unchanged.',
    }
  }

  const command = frozenInstallCommand(snapshot.files, packageManager)
  if (command) {
    return {
      status: 'required',
      packageManager,
      command,
      dependencyHash,
      risk: 'safe',
      reason: 'Dependency lockfile requires a frozen bootstrap before tests run in the managed worktree.',
    }
  }

  return {
    status: 'needs_approval',
    packageManager,
    command: packageManager === 'bun' ? 'bun install' : 'npm install',
    dependencyHash,
    risk: 'warn',
    reason: 'No package-manager lockfile found; non-frozen dependency install requires human approval.',
  }
}

export function sanitizeCodingDiffArtifact(input: RawCodingDiffArtifact): CodingDiffArtifact {
  const filteredPaths = input.changedPaths.filter(isRepoRelativePath).slice(0, MAX_REMOTE_CHANGED_PATHS)
  const redactedPatch = redactDiffAddedLines(input.patch)
  const truncated = redactedPatch.value.length > MAX_DIFF_CHARS
  const truncationMarker = `\n[TRUNCATED:diff_exceeded_${MAX_DIFF_CHARS}_chars]`
  const patch = truncated
    ? `${redactedPatch.value.slice(0, Math.max(0, MAX_DIFF_CHARS - truncationMarker.length))}${truncationMarker}`
    : redactedPatch.value

  return {
    id: input.id,
    runId: input.runId,
    nodeId: input.nodeId,
    projectId: input.projectId,
    changedPaths: filteredPaths,
    patch,
    truncated,
    redacted: redactedPatch.redacted,
    createdAt: input.createdAt,
  }
}

export function createRemoteCodingAgentSummary(
  run: CodingAgentRun,
  diff?: CodingDiffArtifact,
): RemoteCodingAgentSummary {
  const changedPaths = (diff?.changedPaths ?? run.changedPaths).filter(isRepoRelativePath).slice(0, MAX_REMOTE_CHANGED_PATHS)

  return {
    id: run.id,
    runId: run.runId,
    nodeId: run.nodeId,
    projectId: run.projectId,
    requestedBy: run.requestedBy,
    providerId: run.providerId,
    engine: run.engine,
    status: run.status,
    branchName: run.branchName,
    summary: redactSecrets(run.summary).value,
    changedPaths,
    startedAt: run.startedAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    redacted: true,
  }
}

function frozenInstallCommand(files: Record<string, string>, packageManager: PackageManager): string {
  if ('pnpm-lock.yaml' in files) {
    return 'corepack pnpm install --frozen-lockfile'
  }
  if ('package-lock.json' in files || 'npm-shrinkwrap.json' in files) {
    return 'npm ci'
  }
  if ('yarn.lock' in files) {
    return 'corepack yarn install --immutable'
  }
  if ('bun.lock' in files || 'bun.lockb' in files) {
    return 'bun install --frozen-lockfile'
  }
  return packageManager === 'unknown' ? '' : ''
}

function hashDependencyInputs(files: Record<string, string>): string {
  const relevant = [
    'package.json',
    'pnpm-lock.yaml',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
  ]
  let hash = 2166136261
  for (const fileName of relevant) {
    const content = files[fileName]
    if (content === undefined) {
      continue
    }
    const line = `${fileName}\0${content}\0`
    for (let index = 0; index < line.length; index += 1) {
      hash ^= line.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`
}

function redactDiffAddedLines(patch: string): { value: string; redacted: boolean } {
  let redacted = false
  const lines = patch.split('\n').map((line) => {
    if (!line.startsWith('+') || line.startsWith('+++')) {
      return line
    }
    const result = redactSecrets(line)
    redacted ||= result.redacted
    return result.value
  })

  return {
    value: lines.join('\n'),
    redacted,
  }
}

function isRepoRelativePath(value: string): boolean {
  const normalized = value.replace(/\\/g, '/').trim()
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('../') || normalized.includes('/../')) {
    return false
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return false
  }
  return true
}
