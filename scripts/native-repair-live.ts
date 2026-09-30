/** Paid Native v2 repair acceptance is opt-in; importing the harness never starts a Provider. */
import path from 'node:path'

async function main() {
  if (process.env.DEVFLOW_NATIVE_REPAIR_LIVE !== '1') {
    console.log('Skipped paid Native v2 repair acceptance. Set DEVFLOW_NATIVE_REPAIR_LIVE=1 to opt in.')
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
  const { createOpenAiCompatibleAgentProvider, runNativeRepairLiveSmoke } = await import('./memory-context-live-smoke.ts')
  const outputDirectory = process.env.DEVFLOW_NATIVE_REPAIR_LIVE_OUTPUT ??
    path.resolve('out', `native-repair-live-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await runNativeRepairLiveSmoke({
    provider: createOpenAiCompatibleAgentProvider({
      id: 'native-repair-live-provider', name: 'Native repair live acceptance', apiKey, baseUrl, model,
    }),
    outputDirectory,
  })
  console.log(`Native v2 repair acceptance passed. Report: ${path.join(outputDirectory, 'report.json')}`)
}

main().catch((error: unknown) => {
  // Provider and filesystem errors can carry private request data. Assertion messages are
  // written by this harness and are safe to show; everything else stays in the local report.
  const message = error instanceof Error && error.name === 'AssertionError' ? `: ${error.message.split('\n')[0]}` : ''
  console.error(`Native v2 repair live acceptance failed${message}; inspect report.json and the local run evidence in the output directory.`)
  process.exitCode = 1
})
