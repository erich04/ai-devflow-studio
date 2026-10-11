import { createFakeAgentProvider, approveClarificationRevision, buildDesignRevisionIdentity, runWorkflowStageAgent, createWorkflowRunFromRequest, completeWorkflowAgentNode, advanceWorkflowAfterGateApproval, type Artifact } from '@ai-devflow/shared'

export async function designRevisionFixture() {
  const created = createWorkflowRunFromRequest({ runId: 'revision-run', title: 'Task search',
    request: 'Add search. Preserve status filters and saved tasks. No new dependencies.',
    projectId: 'project-1', creatorId: 'user-1', branchName: 'feature/search', now: '2026-10-10T00:00:00.000Z' })
  const provider = createFakeAgentProvider()
  const clarification = await runWorkflowStageAgent({ ...created, node: created.run.nodes[0]!, provider,
    requestedBy: 'user-1', runtime: 'electron' })
  const completed = completeWorkflowAgentNode({ ...created, nodeId: created.run.currentNodeId,
    generatedArtifact: clarification.artifact, existingEvents: created.events, actorName: 'User', now: '2026-10-10T00:01:00.000Z' })
  const approved = approveClarificationRevision({ artifact: clarification.artifact, actorId: 'user-1',
    gateNodeId: completed.run.currentNodeId, sequence: 3, now: '2026-10-10T00:02:00.000Z' })
  const advanced = advanceWorkflowAfterGateApproval({ run: completed.run, approvedNodeId: completed.run.currentNodeId, now: '2026-10-10T00:02:00.000Z' })
  const node = advanced.run.nodes.find((item) => item.id === advanced.run.currentNodeId)!
  const artifacts = [created.artifacts[0]!, approved.artifact]
  const design = await runWorkflowStageAgent({ run: advanced.run, node, artifacts, provider, requestedBy: 'user-1', runtime: 'electron' })
  design.artifact.content += '\nKEEP_THIS_UNTOUCHED_SECTION: clear completed acts on all tasks, including hidden ones.'
  const atGate = completeWorkflowAgentNode({ run: advanced.run, artifacts, nodeId: node.id, generatedArtifact: design.artifact,
    existingEvents: [], actorName: 'User', now: '2026-10-10T00:03:00.000Z' })
  const proposal: Artifact = { id: 'conversation-proposal-search', runId: atGate.run.id, nodeId: node.id,
    kind: 'log', title: 'Search amendments', summary: 'Two amendments',
    content: 'Show 暂无匹配任务 for a nonempty query even when total tasks is zero. Run npm test before and after editing.',
    redacted: true, updatedAt: '2026-10-10T01:00:00.000Z' }
  artifacts.push(design.artifact, proposal)
  // Publishing a conversation proposal saves Artifact.nodeId without changing WorkflowNode.artifactIds.
  const run = atGate.run
  return { run, node: run.nodes.find((item) => item.id === node.id)!, artifacts, design: design.artifact, proposal,
    selection: { expectedRunVersion: run.version, previous: await buildDesignRevisionIdentity(design.artifact),
      proposals: [await buildDesignRevisionIdentity(proposal)] } }
}
