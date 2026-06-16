import type {
  AgentEvent,
  Artifact,
  DetectedTestCommand,
  PackageManager,
  TestEvidence,
  WorkflowRun,
} from './domain'
import { redactSecrets } from './redaction'

export type ProjectFileSnapshot = Record<string, string>

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
      command: `${packageManager} test`,
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

export function createTestEvidenceArtifact(evidence: TestEvidence): Artifact {
  const stdout = redactSecrets(evidence.stdout)
  const stderr = redactSecrets(evidence.stderr)
  const content = [
    `Command: ${evidence.command}`,
    `CWD: ${evidence.cwd}`,
    `Status: ${statusLabel(evidence)}`,
    `Duration: ${evidence.durationMs}ms`,
    '',
    'STDOUT',
    stdout.value || '(empty)',
    '',
    'STDERR',
    stderr.value || '(empty)',
  ].join('\n')

  return {
    id: `artifact-${evidence.id}`,
    runId: evidence.runId,
    nodeId: evidence.nodeId,
    kind: 'test_report',
    title: 'Local test evidence',
    summary: evidence.summary,
    content,
    redacted: evidence.redacted || stdout.redacted || stderr.redacted,
    updatedAt: evidence.createdAt,
  }
}

export function createTestEvidenceEvent(evidence: TestEvidence, sequence = 1): AgentEvent {
  return {
    id: `event-${evidence.id}`,
    runId: evidence.runId,
    nodeId: evidence.nodeId,
    sequence,
    kind: 'test_result',
    message: evidence.summary,
    timestamp: evidence.createdAt,
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
