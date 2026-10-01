/** Paid OpenCode Memory learning acceptance is opt-in; importing the harness never starts OpenCode. */
import path from 'node:path'

async function main() {
  if (process.env.DEVFLOW_OPENCODE_MEMORY_LEARNING_LIVE !== '1') {
    console.log('Skipped paid OpenCode Memory learning acceptance. Set DEVFLOW_OPENCODE_MEMORY_LEARNING_LIVE=1 to opt in.')
    return
  }
  const apiKey = process.env.DEVFLOW_AGENT_OPENAI_API_KEY
  const baseUrl = process.env.DEVFLOW_AGENT_OPENAI_BASE_URL
  const model = process.env.DEVFLOW_AGENT_OPENAI_MODEL
  if (!apiKey || !baseUrl || !model) {
    console.error('Set DEVFLOW_AGENT_OPENAI_API_KEY, DEVFLOW_AGENT_OPENAI_BASE_URL and DEVFLOW_AGENT_OPENAI_MODEL through your local credential environment.')
    process.exitCode = 1
    return
  }
  const { runOpencodeMemoryLearningLiveSmoke } = await import('./opencode-memory-learning-live-smoke.ts')
  const outputDirectory = process.env.DEVFLOW_OPENCODE_MEMORY_LEARNING_LIVE_OUTPUT ??
    path.resolve('out', `opencode-memory-learning-live-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await runOpencodeMemoryLearningLiveSmoke({
    binaryPath: process.env.DEVFLOW_OPENCODE_BIN ?? 'opencode',
    providerId: process.env.DEVFLOW_OPENCODE_PROVIDER_ID ?? 'devflow-live',
    modelId: model,
    baseUrl,
    apiKey,
    outputDirectory,
  })
  console.log(`OpenCode Memory learning acceptance passed. Report: ${path.join(outputDirectory, 'report.json')}`)
}

main().catch((error: unknown) => {
  // Provider, OpenCode and filesystem errors can carry private request data. Assertion
  // messages are written by this harness and are safe to show.
  const message = error instanceof Error && error.name === 'AssertionError' ? `: ${error.message.split('\n')[0]}` : ''
  console.error(`OpenCode Memory learning live acceptance failed${message}; inspect the local run evidence in the output directory.`)
  process.exitCode = 1
})
