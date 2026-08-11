import type {
  Artifact,
  CodingAgentRun,
  CodingDiffArtifact,
  ManagedCodingWorkspace,
  TestEvidence,
  WorkflowRun,
} from './domain'

export type GitHubDeliveryStatus =
  | 'approval_required'
  | 'approved'
  | 'publishing_branch'
  | 'branch_published'
  | 'creating_pr'
  | 'completed'
  | 'failed'
  | 'recovery_required'
  | 'revoked'

export type GitHubDeliveryOperatorOutcomeCode =
  | 'invalid_delivery_source'
  | 'operation_cancelled'
  | 'publisher_cleanup_failed'
  | 'remote_branch_diverged'
  | 'remote_unavailable'
  | 'repository_mismatch'
  | 'push_result_unknown'
  | 'workspace_dirty'
  | 'workspace_mismatch'

export type GitHubDeliveryOperatorOutcome = {
  stateVersion: 1
  intentId: string
  intentUpdatedAt: string
  outcomeCode: GitHubDeliveryOperatorOutcomeCode
  recordedAt: string
  redacted: true
}

const terminalGitHubDeliveryStatuses: ReadonlySet<GitHubDeliveryStatus> = new Set([
  'completed',
  'failed',
  'revoked',
])

export function isTerminalGitHubDeliveryStatus(status: GitHubDeliveryStatus): boolean {
  return terminalGitHubDeliveryStatuses.has(status)
}

export type GitHubRepositoryBindingStatus = 'active' | 'stale' | 'revoked'

export type GitHubDeliveryCompletion = {
  stateVersion: 1
  remoteRequestId: string
  publicationId: string
  pullRequestOutcomeId: string
  pullRequestId: string
  pullRequestNumber: number
  pullRequestUrl: string
  providerCreatedAt: string
  recordedAt: string
  draft: true
  redacted: true
}

export type GitHubRepositoryBinding = {
  stateVersion: 1
  id: string
  version: number
  organizationId: string
  teamProjectId: string
  installationId: string
  repositoryId: string
  repository: string
  defaultBranch: string
  status: GitHubRepositoryBindingStatus
  validatedAt: string
  updatedAt: string
  redacted: true
}

export type GitHubDeliveryIntent = {
  stateVersion: 1
  id: string
  organizationId: string
  teamProjectId: string
  localProjectId: string
  runId: string
  runVersion: number
  nodeId: string
  repositoryBindingId: string
  repositoryBindingVersion: number
  installationId: string
  repositoryId: string
  codingRunId: string
  codingRunCompletedAt: string
  workspaceId: string
  deliverySeriesKey: string
  deliveryAttempt: number
  repository: string
  baseBranch: string
  headBranch: string
  baseCommitSha: string
  expectedCommitSha: string
  diffArtifactId: string
  diffSourceDigest: string
  testEvidenceId: string
  testEvidenceCreatedAt: string
  testEvidenceDigest: string
  prPackageArtifactId: string
  prPackageUpdatedAt: string
  prPackageDigest: string
  changedPaths: string[]
  intentDigest: string
  idempotencyKey: string
  status: GitHubDeliveryStatus
  completion?: GitHubDeliveryCompletion
  createdAt: string
  updatedAt: string
  redacted: true
}

export type CreateGitHubDeliveryIntentInput = {
  id: string
  repositoryBinding: GitHubRepositoryBinding
  run: WorkflowRun
  prNodeId: string
  codingRun: CodingAgentRun
  workspace: ManagedCodingWorkspace
  diffArtifact: CodingDiffArtifact
  prPackage: Artifact
  testEvidence: TestEvidence & { sourceCommitSha: string }
  baseCommitSha: string
  expectedCommitSha: string
  deliveryAttempt?: number
  now: string
}

type IntentDigestMaterial = Omit<
  GitHubDeliveryIntent,
  | 'id'
  | 'intentDigest'
  | 'idempotencyKey'
  | 'status'
  | 'completion'
  | 'createdAt'
  | 'updatedAt'
  | 'redacted'
>

type DeliverySeriesMaterial = Omit<
  IntentDigestMaterial,
  'deliverySeriesKey' | 'deliveryAttempt'
>

export type CreateGitHubDeliveryCompletionInput = {
  intent: GitHubDeliveryIntent
  remoteRequestId: string
  publicationId: string
  pullRequestOutcomeId: string
  pullRequestId: string
  pullRequestNumber: number
  pullRequestUrl: string
  repository: string
  baseBranch: string
  headBranch: string
  headSha: string
  draft: true
  providerCreatedAt: string
  recordedAt: string
}

const gitShaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const safeRefCharacters = /^[A-Za-z0-9._/-]+$/u

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 200 || normalized !== value) {
    throw new Error(`${label} is invalid`)
  }
  return normalized
}

function requirePositiveVersion(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function requireTimestamp(value: string, label: string): string {
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function requireGitHubNumericId(value: string, label: string): string {
  if (!/^[1-9][0-9]{0,19}$/u.test(value)) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

export function normalizeGitHubRepository(value: string): string {
  if (!repositoryPattern.test(value)) {
    throw new Error('GitHub repository must use owner/name format')
  }
  const [owner, repository] = value.split('/')
  if (!owner || !repository || owner === '.' || owner === '..' || repository === '.' || repository === '..') {
    throw new Error('GitHub repository must use owner/name format')
  }
  return `${owner.toLowerCase()}/${repository.toLowerCase()}`
}

export function assertSafeGitHubBranch(value: string, options: { requireDeliveryNamespace?: boolean } = {}): string {
  if (
    !value ||
    value.length > 200 ||
    !safeRefCharacters.test(value) ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.startsWith('.') ||
    value.endsWith('.') ||
    value.endsWith('.lock') ||
    value.includes('..') ||
    value.includes('//') ||
    value.includes('@{')
  ) {
    throw new Error('GitHub branch is invalid')
  }
  if (options.requireDeliveryNamespace && !value.startsWith('devflow/')) {
    throw new Error('GitHub delivery branch must use the devflow/ namespace')
  }
  return value
}

export function createGitHubDeliveryCompletion(
  input: CreateGitHubDeliveryCompletionInput,
): GitHubDeliveryCompletion {
  if (
    input.intent.status !== 'creating_pr' &&
    input.intent.status !== 'recovery_required'
  ) {
    throw new Error('GitHub Delivery completion requires a PR creation state')
  }
  const repository = normalizeGitHubRepository(input.repository)
  const baseBranch = assertSafeGitHubBranch(input.baseBranch)
  const headBranch = assertSafeGitHubBranch(input.headBranch, {
    requireDeliveryNamespace: true,
  })
  const headSha = assertFullGitCommitSha(input.headSha, 'GitHub pull request head')
  if (
    repository !== input.intent.repository ||
    baseBranch !== input.intent.baseBranch ||
    headBranch !== input.intent.headBranch ||
    headSha !== input.intent.expectedCommitSha ||
    input.draft !== true
  ) {
    throw new Error('GitHub Delivery completion does not match the approved intent')
  }
  const pullRequestNumber = requirePositiveVersion(
    input.pullRequestNumber,
    'GitHub pull request number',
  )
  const pullRequestId = requireGitHubNumericId(input.pullRequestId, 'GitHub pull request id')
  let pullRequestUrl: URL
  try {
    pullRequestUrl = new URL(input.pullRequestUrl)
  } catch {
    throw new Error('GitHub pull request URL is invalid')
  }
  const expectedPath = `/${repository}/pull/${pullRequestNumber}`
  if (
    pullRequestUrl.protocol !== 'https:' ||
    pullRequestUrl.hostname.toLowerCase() !== 'github.com' ||
    pullRequestUrl.port !== '' ||
    pullRequestUrl.username !== '' ||
    pullRequestUrl.password !== '' ||
    pullRequestUrl.search !== '' ||
    pullRequestUrl.hash !== '' ||
    pullRequestUrl.pathname.toLowerCase() !== expectedPath.toLowerCase()
  ) {
    throw new Error('GitHub pull request URL is invalid')
  }
  const providerCreatedAt = requireTimestamp(
    input.providerCreatedAt,
    'GitHub pull request creation timestamp',
  )
  const recordedAt = requireTimestamp(input.recordedAt, 'GitHub Delivery completion timestamp')
  if (recordedAt < providerCreatedAt || recordedAt <= input.intent.updatedAt) {
    throw new Error('GitHub Delivery completion timestamp is invalid')
  }
  return {
    stateVersion: 1,
    remoteRequestId: requireIdentifier(input.remoteRequestId, 'GitHub Delivery request id'),
    publicationId: requireIdentifier(input.publicationId, 'GitHub branch publication id'),
    pullRequestOutcomeId: requireIdentifier(
      input.pullRequestOutcomeId,
      'GitHub pull request outcome id',
    ),
    pullRequestId,
    pullRequestNumber,
    pullRequestUrl: pullRequestUrl.toString(),
    providerCreatedAt,
    recordedAt,
    draft: true,
    redacted: true,
  }
}

export function assertFullGitCommitSha(value: string, label: string): string {
  const normalized = value.toLowerCase()
  if (!gitShaPattern.test(normalized)) {
    throw new Error(`${label} must be a full Git commit SHA`)
  }
  return normalized
}

function normalizeChangedPaths(paths: string[]): string[] {
  const normalized = new Set<string>()
  for (const value of paths) {
    const path = value.trim()
    if (
      !path ||
      path !== value ||
      path.length > 500 ||
      path.startsWith('/') ||
      path.startsWith('~') ||
      path.includes('\\') ||
      path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw new Error('GitHub delivery changed path is unsafe')
    }
    normalized.add(path)
  }
  if (normalized.size === 0 || normalized.size > 200) {
    throw new Error('GitHub delivery requires bounded changed paths')
  }
  return [...normalized].sort((left, right) => left.localeCompare(right))
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function canonicalIntentMaterial(material: IntentDigestMaterial): string {
  return JSON.stringify({
    stateVersion: material.stateVersion,
    organizationId: material.organizationId,
    teamProjectId: material.teamProjectId,
    localProjectId: material.localProjectId,
    runId: material.runId,
    runVersion: material.runVersion,
    nodeId: material.nodeId,
    repositoryBindingId: material.repositoryBindingId,
    repositoryBindingVersion: material.repositoryBindingVersion,
    installationId: material.installationId,
    repositoryId: material.repositoryId,
    codingRunId: material.codingRunId,
    codingRunCompletedAt: material.codingRunCompletedAt,
    workspaceId: material.workspaceId,
    deliverySeriesKey: material.deliverySeriesKey,
    deliveryAttempt: material.deliveryAttempt,
    repository: material.repository,
    baseBranch: material.baseBranch,
    headBranch: material.headBranch,
    baseCommitSha: material.baseCommitSha,
    expectedCommitSha: material.expectedCommitSha,
    diffArtifactId: material.diffArtifactId,
    diffSourceDigest: material.diffSourceDigest,
    testEvidenceId: material.testEvidenceId,
    testEvidenceCreatedAt: material.testEvidenceCreatedAt,
    testEvidenceDigest: material.testEvidenceDigest,
    prPackageArtifactId: material.prPackageArtifactId,
    prPackageUpdatedAt: material.prPackageUpdatedAt,
    prPackageDigest: material.prPackageDigest,
    changedPaths: material.changedPaths,
  })
}

function canonicalDeliverySeriesMaterial(material: DeliverySeriesMaterial): string {
  return JSON.stringify({
    organizationId: material.organizationId,
    teamProjectId: material.teamProjectId,
    localProjectId: material.localProjectId,
    runId: material.runId,
    nodeId: material.nodeId,
    repositoryBindingId: material.repositoryBindingId,
    repositoryBindingVersion: material.repositoryBindingVersion,
    workspaceId: material.workspaceId,
  })
}

export async function createGitHubDeliveryIntent(
  input: CreateGitHubDeliveryIntentInput,
): Promise<GitHubDeliveryIntent> {
  const id = requireIdentifier(input.id, 'GitHub Delivery Intent id')
  const organizationId = requireIdentifier(
    input.repositoryBinding.organizationId,
    'Organization id',
  )
  const teamProjectId = requireIdentifier(
    input.repositoryBinding.teamProjectId,
    'Team Project id',
  )
  const repositoryBindingId = requireIdentifier(
    input.repositoryBinding.id,
    'GitHub repository binding id',
  )
  const repositoryBindingVersion = requirePositiveVersion(
    input.repositoryBinding.version,
    'GitHub repository binding version',
  )
  const installationId = requireGitHubNumericId(
    input.repositoryBinding.installationId,
    'GitHub App installation id',
  )
  const repositoryId = requireGitHubNumericId(
    input.repositoryBinding.repositoryId,
    'GitHub repository id',
  )
  if (
    input.repositoryBinding.stateVersion !== 1 ||
    input.repositoryBinding.status !== 'active' ||
    input.repositoryBinding.redacted !== true
  ) {
    throw new Error('GitHub repository binding must be active and redacted')
  }
  const repository = normalizeGitHubRepository(input.repositoryBinding.repository)
  const baseBranch = assertSafeGitHubBranch(input.repositoryBinding.defaultBranch)
  const baseCommitSha = assertFullGitCommitSha(input.baseCommitSha, 'Base commit')
  const expectedCommitSha = assertFullGitCommitSha(input.expectedCommitSha, 'Expected commit')
  if (baseCommitSha === expectedCommitSha) {
    throw new Error('GitHub delivery expected commit must differ from its base')
  }

  const node = input.run.nodes.find((candidate) => candidate.id === input.prNodeId)
  const buildNode = input.run.nodes.find((candidate) => candidate.id === input.codingRun.nodeId)
  if (
    !node ||
    input.run.currentNodeId !== node.id ||
    node.kind !== 'pr' ||
    node.stage !== 'pr' ||
    node.status !== 'running'
  ) {
    throw new Error('GitHub delivery requires the current running PR node')
  }
  if (input.codingRun.runId !== input.run.id || input.codingRun.projectId !== input.run.projectId) {
    throw new Error('Coding Agent run does not belong to the delivery Run')
  }
  if (!buildNode || buildNode.kind !== 'task' || buildNode.stage !== 'build' || buildNode.status !== 'success') {
    throw new Error('GitHub delivery requires a successful build task for the Coding Agent run')
  }
  if (
    input.codingRun.status !== 'completed' ||
    !input.codingRun.managedWorkspaceId ||
    !input.codingRun.diffArtifactId ||
    !input.codingRun.testEvidenceId ||
    !input.codingRun.completedAt
  ) {
    throw new Error('GitHub delivery requires a completed Coding Agent run with diff and Test Evidence')
  }
  if (
    input.workspace.id !== input.codingRun.managedWorkspaceId ||
    input.workspace.projectId !== input.run.projectId ||
    input.workspace.codingRunId !== input.codingRun.id ||
    input.workspace.baseBranch !== baseBranch ||
    input.workspace.baseCommitSha?.toLowerCase() !== baseCommitSha ||
    input.workspace.headCommitSha?.toLowerCase() !== expectedCommitSha ||
    input.workspace.cleanupStatus !== 'active' ||
    input.workspace.deletedAt
  ) {
    throw new Error('GitHub delivery requires the active managed workspace for the Coding Agent run')
  }
  const headBranch = assertSafeGitHubBranch(input.workspace.branchName, {
    requireDeliveryNamespace: true,
  })
  if (input.codingRun.branchName !== headBranch) {
    throw new Error('Coding Agent run and managed workspace branch do not match')
  }
  const codingChangedPaths = normalizeChangedPaths(input.codingRun.changedPaths)
  const diffChangedPaths = normalizeChangedPaths(input.diffArtifact.changedPaths)
  if (
    input.diffArtifact.id !== input.codingRun.diffArtifactId ||
    input.diffArtifact.runId !== input.run.id ||
    input.diffArtifact.nodeId !== input.codingRun.nodeId ||
    input.diffArtifact.projectId !== input.run.projectId ||
    input.diffArtifact.redacted !== true ||
    input.diffArtifact.truncated ||
    !input.diffArtifact.sourceDigest ||
    !/^[a-f0-9]{64}$/.test(input.diffArtifact.sourceDigest) ||
    codingChangedPaths.length !== diffChangedPaths.length ||
    codingChangedPaths.some((value, index) => value !== diffChangedPaths[index])
  ) {
    throw new Error('Coding Diff Artifact does not match the completed Coding Agent run')
  }
  if (
    input.testEvidence.runId !== input.run.id ||
    input.testEvidence.nodeId !== input.codingRun.nodeId ||
    input.testEvidence.projectId !== input.run.projectId ||
    input.testEvidence.status !== 'passed' ||
    input.testEvidence.exitCode !== 0 ||
    input.testEvidence.redacted !== true
  ) {
    throw new Error('GitHub delivery requires passing Coding Agent Test Evidence')
  }
  if (input.testEvidence.sourceCommitSha.toLowerCase() !== expectedCommitSha) {
    throw new Error('Test Evidence is not bound to the expected commit')
  }
  if (
    input.prPackage.runId !== input.run.id ||
    input.prPackage.nodeId !== node.id ||
    input.prPackage.kind !== 'pr' ||
    input.prPackage.redacted !== true ||
    !node.artifactIds.includes(input.prPackage.id)
  ) {
    throw new Error('GitHub delivery requires the current redacted PR Delivery Package')
  }
  const packageSource = input.prPackage.githubDeliverySource
  if (
    !packageSource ||
    packageSource.stateVersion !== 1 ||
    packageSource.codingRunId !== input.codingRun.id ||
    packageSource.workspaceId !== input.workspace.id ||
    packageSource.diffArtifactId !== input.diffArtifact.id ||
    packageSource.diffSourceDigest !== input.diffArtifact.sourceDigest ||
    packageSource.testEvidenceId !== input.codingRun.testEvidenceId ||
    packageSource.headBranch !== headBranch
  ) {
    throw new Error('PR Delivery Package does not match the managed coding source')
  }
  const changedPaths = diffChangedPaths
  const testEvidenceDigest = await sha256Hex(JSON.stringify({
    id: input.testEvidence.id,
    runId: input.testEvidence.runId,
    nodeId: input.testEvidence.nodeId,
    projectId: input.testEvidence.projectId,
    command: input.testEvidence.command,
    status: input.testEvidence.status,
    exitCode: input.testEvidence.exitCode,
    durationMs: input.testEvidence.durationMs,
    summary: input.testEvidence.summary,
    redacted: input.testEvidence.redacted,
    sourceCommitSha: input.testEvidence.sourceCommitSha.toLowerCase(),
    createdAt: input.testEvidence.createdAt,
  }))
  const prPackageDigest = await sha256Hex(JSON.stringify({
    id: input.prPackage.id,
    title: input.prPackage.title,
    summary: input.prPackage.summary,
    content: input.prPackage.content,
    githubDeliverySource: packageSource,
    updatedAt: input.prPackage.updatedAt,
  }))
  const seriesMaterial: DeliverySeriesMaterial = {
    stateVersion: 1,
    organizationId,
    teamProjectId,
    localProjectId: input.run.projectId,
    runId: input.run.id,
    runVersion: input.run.version,
    nodeId: node.id,
    repositoryBindingId,
    repositoryBindingVersion,
    installationId,
    repositoryId,
    codingRunId: input.codingRun.id,
    codingRunCompletedAt: input.codingRun.completedAt,
    workspaceId: input.workspace.id,
    repository,
    baseBranch,
    headBranch,
    baseCommitSha,
    expectedCommitSha,
    diffArtifactId: input.diffArtifact.id,
    diffSourceDigest: input.diffArtifact.sourceDigest,
    testEvidenceId: input.testEvidence.id,
    testEvidenceCreatedAt: input.testEvidence.createdAt,
    testEvidenceDigest,
    prPackageArtifactId: input.prPackage.id,
    prPackageUpdatedAt: input.prPackage.updatedAt,
    prPackageDigest,
    changedPaths,
  }
  const deliverySeriesDigest = await sha256Hex(
    canonicalDeliverySeriesMaterial(seriesMaterial),
  )
  const deliverySeriesKey = `github-delivery:${deliverySeriesDigest}`
  const deliveryAttempt = requirePositiveVersion(
    input.deliveryAttempt ?? 1,
    'GitHub Delivery attempt',
  )
  const material: IntentDigestMaterial = {
    ...seriesMaterial,
    deliverySeriesKey,
    deliveryAttempt,
  }
  const intentDigest = await sha256Hex(canonicalIntentMaterial(material))
  const attemptIdempotencyDigest = await sha256Hex(
    JSON.stringify({ deliverySeriesKey, deliveryAttempt }),
  )

  return {
    id,
    ...material,
    intentDigest,
    idempotencyKey: `github-delivery:${attemptIdempotencyDigest}`,
    status: 'approval_required',
    createdAt: input.now,
    updatedAt: input.now,
    redacted: true,
  }
}
