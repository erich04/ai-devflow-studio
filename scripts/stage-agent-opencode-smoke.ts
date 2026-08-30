import { createWorkflowRunFromRequest, runWorkflowStageAgent } from '@ai-devflow/shared'
import { createOpencodeProcessManager } from '../apps/desktop/electron/opencode-process.js'
import { createReadOnlyLocalStageAgentExecutor } from '../apps/desktop/electron/stage-agent-executor.js'

async function main() {
  if (process.env.DEVFLOW_RUN_STAGE_AGENT_SMOKE !== '1') {
    console.log('SKIP: set DEVFLOW_RUN_STAGE_AGENT_SMOKE=1 for the real read-only local Stage Agent smoke.')
    return
  }

  const binaryPath = process.env.DEVFLOW_STAGE_AGENT_OPENCODE_BINARY
  const providerId = process.env.DEVFLOW_STAGE_AGENT_PROVIDER_ID
  const modelId = process.env.DEVFLOW_STAGE_AGENT_MODEL_ID
  if (!binaryPath || !providerId || !modelId) {
    throw new Error('Real smoke requires binary, provider ID, and model ID environment configuration')
  }

  const now = new Date().toISOString()
  const created = createWorkflowRunFromRequest({
  runId: `stage-agent-smoke-${Date.now()}`,
  title: 'Read-only repository clarification smoke',
  request: 'Identify one repository entrypoint and cite the exact repo-relative file without modifying anything.',
  projectId: 'stage-agent-smoke-project',
  creatorId: 'stage-agent-smoke-user',
  branchName: 'stage-agent-smoke',
  now,
  })
  const node = created.run.nodes.find((candidate) => candidate.kind === 'agent' && candidate.stage === 'clarify')!
  const processManager = createOpencodeProcessManager()

  try {
    const result = await runWorkflowStageAgent({
    run: created.run,
    node,
    artifacts: created.artifacts,
    executor: createReadOnlyLocalStageAgentExecutor({
      projectId: created.run.projectId,
      projectPath: process.cwd(),
      binaryPath,
      providerId,
      modelId,
      detectedVersion: 'smoke-configured',
      processManager,
      runtimeEnv: process.env,
    }),
    requestedBy: created.run.creatorId,
    runtime: 'electron',
    })
    console.log(JSON.stringify({
      status: 'passed',
      artifactId: result.artifact.id,
      revision: result.artifact.clarificationRevision?.revision,
      citationCount: result.artifact.clarificationRevision?.repositoryFindings?.citations.length ?? 0,
      terminalReason: result.terminalReason,
    }))
  } finally {
    await processManager.stopAll()
  }
}

void main()
