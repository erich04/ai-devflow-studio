/** No credentials or network: exercise the real governance boundary in another process. */
import { governedModelCall } from '../../packages/shared/src/governed-provider.ts'
import { openInteractiveRound } from '../native-coding-round-budget.ts'

const [root, scope, hold] = process.argv.slice(2)
const ledger = await openInteractiveRound(root!, scope!)
process.send?.({ event: 'ready' })
process.once('message', async () => {
  let providerCalls = 0
  try {
    await governedModelCall({
      governance: ledger, projectId: 'interactive',
      provider: { id: 'deepseek-interactive', model: 'deepseek-flash', billingProvider: 'deepseek' },
      prompt: 'Local fixture only', boundBasis: 'deepseek-context-v1', maxOutputTokens: 65536,
      action: async () => {
        providerCalls++
        if (hold === 'hold') {
          process.send?.({ event: 'dispatched' })
          await new Promise(() => {})
        }
        return {} // Unknown usage retains the entire reservation.
      },
    })
    process.send?.({ event: 'result', accepted: true, providerCalls })
  } catch {
    process.send?.({ event: 'result', accepted: false, providerCalls })
  } finally {
    ledger.close()
    process.disconnect?.()
  }
})
