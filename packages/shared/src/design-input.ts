import type { Artifact, DesignClarificationInput, WorkflowRun } from './domain'
import { createClarificationRevisionDigest, sha256Text } from './clarification'

/** Resolve the approved Gate subject, never the most recently edited draft. */
export async function resolveDesignClarificationInput(run: WorkflowRun, artifacts: readonly Artifact[]): Promise<{
  artifact: Artifact
  binding: DesignClarificationInput
}> {
  const gates = run.nodes.filter((node) => node.kind === 'gate' && node.stage === 'clarify')
  const clarificationNodes = run.nodes.filter((node) => node.kind === 'agent' && node.stage === 'clarify')
  const gate = gates[0]
  if (gates.length !== 1 || !gate || gate.status !== 'success' || clarificationNodes.length !== 1) {
    throw new Error('方案设计需要先完成需求确认 Gate。')
  }
  const linked = artifacts.filter((artifact) => artifact.runId === run.id && artifact.kind === 'clarification'
    && gate.artifactIds.includes(artifact.id))
  const artifact = linked[0]
  if (linked.length !== 1 || !artifact || artifact.nodeId !== clarificationNodes[0]!.id || !artifact.content.trim()) {
    throw new Error('需求确认 Gate 未唯一关联本 Run 的有效澄清正文，请先核对需求审批。')
  }
  const revision = artifact.clarificationRevision
  if (revision) {
    const raw = artifacts.filter((item) => item.runId === run.id && item.kind === 'raw_request')
    if (revision.status !== 'approved' || raw.length !== 1 || raw[0]!.id !== revision.rawRequestArtifactId) {
      throw new Error('方案设计只能使用已批准且绑定原始需求的澄清版本。')
    }
    const digest = await createClarificationRevisionDigest({
      title: artifact.title, summary: artifact.summary, goals: revision.goals,
      acceptanceCriteria: revision.acceptanceCriteria, nonGoals: revision.nonGoals,
      assumptions: revision.assumptions, risks: revision.risks, openQuestions: revision.openQuestions,
      ...(revision.repositoryFindings ? { repositoryFindings: revision.repositoryFindings } : {}),
    })
    if (digest !== revision.revisionDigest) throw new Error('已批准澄清的内容摘要不匹配，请先核对需求审批。')
  }
  return {
    artifact,
    binding: {
      gateNodeId: gate.id, artifactId: artifact.id,
      contentDigest: await sha256Text(artifact.content),
      ...(revision ? { revision: revision.revision, revisionDigest: revision.revisionDigest } : {}),
      legacy: !revision,
    },
  }
}
