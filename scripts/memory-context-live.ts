/** Paid acceptance is opt-in; importing the harness itself never starts a Provider. */
import path from 'node:path'

async function main() {
  if (process.env.DEVFLOW_MEMORY_LIVE !== '1') {
    console.log('Skipped paid Memory/Context acceptance. Set DEVFLOW_MEMORY_LIVE=1 to opt in.')
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
  const { createOpenAiCompatibleAgentProvider, runMemoryContextLiveSmoke } = await import('./memory-context-live-smoke.ts')
  const outputDirectory = process.env.DEVFLOW_MEMORY_LIVE_OUTPUT ??
    path.resolve('out', `memory-context-live-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await runMemoryContextLiveSmoke({
    provider: createOpenAiCompatibleAgentProvider({
      id: 'memory-live-provider', name: 'Memory live acceptance', apiKey, baseUrl, model,
    }),
    outputDirectory,
  })
  console.log(`Memory/Context acceptance passed. Report: ${path.join(outputDirectory, 'report.json')}`)
}

main().catch(() => {
  // Provider and filesystem errors can carry private request data. Keep this CLI
  // boundary concise; the local Store contains the sanitized execution trace.
  console.error('Memory/Context live acceptance failed; inspect the local run evidence in the output directory.')
  process.exitCode = 1
})
