import { stripVTControlCharacters } from 'node:util'
import { redactSensitiveText } from '@ai-devflow/shared'
import type { CodingCommandReceipt, CodingCommandRunner } from './coding-command-runner'

export type CodingCommandFeedback = {
  logId: string; status: 'passed' | 'failed' | 'timed_out' | 'cancelled'; exitCode: number | null; outputBytes: number
  diagnostics?: { head: string; tail: string; tailOffset: number; truncated: boolean }
}

/** Describe an already finished public command. Never execute a command again
 * just to obtain diagnostics, or expose the host's private acceptance logs. */
export async function codingCommandFeedback(runner: CodingCommandRunner, receipt: CodingCommandReceipt): Promise<CodingCommandFeedback> {
  const status = receipt.status === 'passed' ? 'passed' : receipt.status === 'timed_out' ? 'timed_out' : receipt.status === 'cancelled' ? 'cancelled' : 'failed'
  const feedback: CodingCommandFeedback = { logId: receipt.id, status, exitCode: receipt.exitCode, outputBytes: receipt.outputBytes }
  if (status === 'passed') return feedback
  const headLimit = 2000, tailLimit = 14000
  const head = await runner.read(receipt.id, 0, headLimit)
  const tailOffset = Math.max(headLimit, receipt.outputBytes - tailLimit)
  const tail = head.nextOffset === null ? '' : (await runner.read(receipt.id, tailOffset, tailLimit)).output
  const clean = (value: string, limit: number) => redactSensitiveText(stripVTControlCharacters(value)).value.slice(0, limit)
  feedback.diagnostics = {
    head: clean(head.output, headLimit), tail: clean(tail, tailLimit), tailOffset,
    truncated: tailOffset > headLimit && head.nextOffset !== null,
  }
  return feedback
}
