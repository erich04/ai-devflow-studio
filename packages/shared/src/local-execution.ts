import type {
  AgentEvent,
  Artifact,
  DetectedTestCommand,
  PackageManager,
  ProjectFileSnapshot,
  TestEvidence,
  WorkflowRun,
} from './domain'
import { redactLocalAbsolutePaths, redactSecrets } from './redaction'

function hasFile(files: ProjectFileSnapshot, fileName: string): boolean {
  return Object.prototype.hasOwnProperty.call(files, fileName)
}

export function detectPackageManager(files: ProjectFileSnapshot): PackageManager {
  if (hasFile(files, 'pnpm-lock.yaml')) {
    return 'pnpm'
  }

  if (hasFile(files, 'package-lock.json') || hasFile(files, 'npm-shrinkwrap.json')) {
    return 'npm'
  }

  if (hasFile(files, 'yarn.lock')) {
    return 'yarn'
  }

  if (hasFile(files, 'bun.lockb') || hasFile(files, 'bun.lock')) {
    return 'bun'
  }

  return 'npm'
}

function packageManagerTestCommand(packageManager: PackageManager): string {
  if (packageManager === 'pnpm' || packageManager === 'yarn') {
    return `corepack ${packageManager} test`
  }

  return `${packageManager} test`
}

export function detectTestCommand(files: ProjectFileSnapshot): DetectedTestCommand | null {
  const packageJson = files['package.json']
  if (!packageJson) {
    return null
  }

  try {
    const parsed = JSON.parse(packageJson) as { scripts?: Record<string, unknown> }
    const testScript = parsed.scripts?.['test']

    if (typeof testScript !== 'string' || testScript.trim().length === 0) {
      return null
    }

    const packageManager = detectPackageManager(files)

    return {
      command: packageManagerTestCommand(packageManager),
      packageManager,
      source: 'package.json',
      reason: 'package.json scripts.test',
    }
  } catch {
    return null
  }
}

export function resolveTestCommand(
  detected: DetectedTestCommand | null,
  manualOverride: string | undefined,
): string {
  const trimmedOverride = manualOverride?.trim()
  if (trimmedOverride) {
    return trimmedOverride
  }

  return detected?.command ?? ''
}

function statusLabel(evidence: TestEvidence): string {
  if (evidence.status === 'passed') {
    return `passed, exit ${evidence.exitCode ?? 0}`
  }

  if (evidence.status === 'timed_out') {
    return 'timed out'
  }

  return `failed, exit ${evidence.exitCode ?? 'unknown'}`
}

function encodeFileUrlPath(pathValue: string): string {
  return pathValue
    .split('/')
    .map((segment) => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/')
}

function redactKnownWorkspaceRoot(input: string, workspaceRoot: string): {
  value: string
  redacted: boolean
} {
  if (!workspaceRoot) {
    return { value: input, redacted: false }
  }

  const normalizedWorkspaceRoot = workspaceRoot.replace(/[\\/]+$/, '') || workspaceRoot
  const slashNormalizedRoot = normalizedWorkspaceRoot.replace(/\\/g, '/')
  const isWindowsWorkspace = /^[A-Za-z]:[\\/]/.test(workspaceRoot) || /^\\\\/.test(workspaceRoot)
  const workspaceRootVariants = Array.from(new Set([
    normalizedWorkspaceRoot,
    slashNormalizedRoot,
    encodeURI(normalizedWorkspaceRoot),
    encodeURI(slashNormalizedRoot),
    encodeFileUrlPath(slashNormalizedRoot),
  ]))
  let value = input
  let redacted = false
  for (const variant of workspaceRootVariants) {
    const escapedVariant = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const workspaceRootPattern = new RegExp(
      `${escapedVariant}(?=$|[\\\\/\\s,;:!?\\)\\]\\}"']|\\.(?=$|\\s))`,
      isWindowsWorkspace ? 'gi' : 'g',
    )
    if (!workspaceRootPattern.test(value)) {
      continue
    }
    workspaceRootPattern.lastIndex = 0
    value = value.replace(workspaceRootPattern, '<workspace>')
    redacted = true
  }

  return {
    value,
    redacted,
  }
}

export function redactTestEvidenceForStorage(evidence: TestEvidence): TestEvidence {
  const commandWorkspace = redactKnownWorkspaceRoot(evidence.command, evidence.cwd)
  const stdoutWorkspace = redactKnownWorkspaceRoot(evidence.stdout, evidence.cwd)
  const stderrWorkspace = redactKnownWorkspaceRoot(evidence.stderr, evidence.cwd)
  const summaryWorkspace = redactKnownWorkspaceRoot(evidence.summary, evidence.cwd)
  const commandPath = redactLocalAbsolutePaths(commandWorkspace.value)
  const stdoutPath = redactLocalAbsolutePaths(stdoutWorkspace.value)
  const stderrPath = redactLocalAbsolutePaths(stderrWorkspace.value)
  const summaryPath = redactLocalAbsolutePaths(summaryWorkspace.value)
  const command = redactSecrets(commandPath.value)
  const stdout = redactSecrets(stdoutPath.value)
  const stderr = redactSecrets(stderrPath.value)
  const summary = redactSecrets(summaryPath.value)

  return {
    ...evidence,
    command: command.value,
    cwd: evidence.cwd ? '<workspace>' : '',
    stdout: stdout.value,
    stderr: stderr.value,
    summary: summary.value,
    redacted:
      evidence.redacted ||
      Boolean(evidence.cwd) ||
      commandWorkspace.redacted ||
      stdoutWorkspace.redacted ||
      stderrWorkspace.redacted ||
      summaryWorkspace.redacted ||
      commandPath.redacted ||
      stdoutPath.redacted ||
      stderrPath.redacted ||
      summaryPath.redacted ||
      command.redacted ||
      stdout.redacted ||
      stderr.redacted ||
      summary.redacted,
  }
}

export function createTestEvidenceArtifact(evidence: TestEvidence): Artifact {
  const safeEvidence = redactTestEvidenceForStorage(evidence)
  const content = [
    `Command: ${safeEvidence.command}`,
    `CWD: ${safeEvidence.cwd}`,
    `Status: ${statusLabel(safeEvidence)}`,
    `Duration: ${safeEvidence.durationMs}ms`,
    '',
    'STDOUT',
    safeEvidence.stdout || '(empty)',
    '',
    'STDERR',
    safeEvidence.stderr || '(empty)',
  ].join('\n')

  return {
    id: `artifact-${safeEvidence.id}`,
    runId: safeEvidence.runId,
    nodeId: safeEvidence.nodeId,
    kind: 'test_report',
    title: 'Local test evidence',
    summary: safeEvidence.summary,
    content,
    redacted: safeEvidence.redacted,
    updatedAt: safeEvidence.createdAt,
  }
}

export function createTestEvidenceEvent(evidence: TestEvidence, sequence = 1): AgentEvent {
  const safeEvidence = redactTestEvidenceForStorage(evidence)

  return {
    id: `event-${safeEvidence.id}`,
    runId: safeEvidence.runId,
    nodeId: safeEvidence.nodeId,
    sequence,
    kind: 'test_result',
    message: safeEvidence.summary,
    timestamp: safeEvidence.createdAt,
  }
}

export function applyTestEvidenceToRun(
  run: WorkflowRun,
  evidence: TestEvidence,
  artifactId: string,
): WorkflowRun {
  const nodeStatus = evidence.status === 'passed' ? 'success' : 'failed'
  const runStatus = evidence.status === 'passed' ? 'testing' : 'failed'

  return {
    ...run,
    status: runStatus,
    currentNodeId: evidence.nodeId,
    updatedAt: evidence.createdAt,
    nodes: run.nodes.map((node) => {
      if (node.id !== evidence.nodeId) {
        return node
      }

      return {
        ...node,
        status: nodeStatus,
        artifactIds: Array.from(new Set([...node.artifactIds, artifactId])),
      }
    }),
  }
}
