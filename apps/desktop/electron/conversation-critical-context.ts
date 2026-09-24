import { createHash } from 'node:crypto'
import { redactSensitiveText, type Artifact, type WorkflowRun } from '@ai-devflow/shared'

const digest = (text: string) => createHash('sha256').update(text).digest('hex')
export type CriticalContext = {
  projectId: string
  runId: string
  nodeId: string
  documents: Array<{ id: string; updatedAt: string; digest: string; content: string }>
  criteria: Array<{ id: string; documentId: string; text: string }>
}
export type CriticalContextReceipt = {
  version: 1
  projectId: string
  runId: string
  nodeId: string
  documents: Array<{ id: string; updatedAt: string; digest: string }>
  coverage: Array<{ criterionId: string; sourceQuote: string; proposalQuote: string }>
}

/** Critical text is protected in the final request; indexes and tool excerpts are not proof. */
export function buildCriticalContext(run: WorkflowRun, nodeId: string, artifacts: Artifact[]): CriticalContext {
  if (!run.nodes.some((node) => node.id === nodeId)) throw new Error('提案目标节点已不存在。')
  const raw = artifacts.find((item) => item.runId === run.id && item.kind === 'raw_request')
  const documents = [
    { id: raw?.id ?? `run-request:${run.id}`, updatedAt: raw?.updatedAt ?? run.updatedAt, content: raw?.content ?? run.request },
    ...artifacts.filter((item) => item.runId === run.id && item.nodeId === nodeId && item.kind === 'log' && item.id.startsWith('conversation-proposal-')),
  ].map(({ id, updatedAt, content }) => ({ id, updatedAt, digest: digest(content), content: redactSensitiveText(content).value }))
  if (!documents[0]?.content.trim()) throw new Error('原始需求正文不可用，暂不能生成完整提案。')
  // Clauses, including the first/middle/last of a long single line, must each be
  // linked to the proposal. This is an auditable coverage mapping, not a claim
  // that receiving text proves the model understood it.
  const criteria = documents.flatMap((document) => {
    // Repeated wording needs one coverage mapping, not hundreds of identical
    // entries. The complete source (including repetitions) still travels above.
    // Keep heading text too: a requirement can be written as a Markdown heading.
    const clauses = [...new Set(document.content.split(/\n+|(?<=[。！？；])\s*/u)
      .map((text) => text.trim()).filter(Boolean))]
    return clauses.map((text, index) => ({ id: `${document.id}:${index}`, documentId: document.id, text }))
  })
  return { projectId: run.projectId, runId: run.id, nodeId, documents, criteria }
}

export function criticalContextSent(prompt: string, expected: CriticalContext): boolean {
  try {
    const actual = JSON.parse(prompt).criticalProposalInput
    return JSON.stringify(actual) === JSON.stringify(expected)
  } catch { return false }
}

export function criticalReceipt(context: CriticalContext, proposal: string, value: unknown): CriticalContextReceipt | null {
  if (!Array.isArray(value) || value.length !== context.criteria.length) return null
  const used = new Set<string>()
  const coverage: CriticalContextReceipt['coverage'] = []
  for (const row of value) {
    if (!row || typeof row !== 'object' || typeof row.criterionId !== 'string' || typeof row.sourceQuote !== 'string' || typeof row.proposalQuote !== 'string' || used.has(row.criterionId)) return null
    const criterion = context.criteria.find((item) => item.id === row.criterionId)
    if (!criterion || row.sourceQuote !== criterion.text || row.proposalQuote.trim().length < 2 || !proposal.includes(row.proposalQuote)) return null
    used.add(row.criterionId)
    coverage.push({ criterionId: row.criterionId, sourceQuote: row.sourceQuote, proposalQuote: row.proposalQuote })
  }
  return { version: 1, projectId: context.projectId, runId: context.runId, nodeId: context.nodeId,
    documents: context.documents.map(({ id, updatedAt, digest }) => ({ id, updatedAt, digest })), coverage }
}

export function receiptIsCurrent(receipt: CriticalContextReceipt, context: CriticalContext): boolean {
  return receipt.projectId === context.projectId && receipt.runId === context.runId && receipt.nodeId === context.nodeId &&
    JSON.stringify(receipt.documents) === JSON.stringify(context.documents.map(({ id, updatedAt, digest }) => ({ id, updatedAt, digest })))
}

/** A second, bounded semantic check is separate from transport coverage. */
export function proposalSemanticsPass(context: CriticalContext, value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== context.criteria.length) return false
  const ids = new Set<string>()
  return value.every((row) => {
    if (!row || typeof row !== 'object' || typeof row.criterionId !== 'string' || ids.has(row.criterionId) || row.status !== 'covered' || typeof row.reason !== 'string' || !row.reason.trim()) return false
    ids.add(row.criterionId)
    return context.criteria.some((criterion) => criterion.id === row.criterionId)
  })
}
