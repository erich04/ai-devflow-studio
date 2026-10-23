// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { AgentProviderRequestError, createFakeAgentProvider, type AgentProvider } from '@ai-devflow/shared'
import { pauseWithInvestigationSummary } from './investigation-summary'
import { beginInvestigationBatch } from './investigation-policy'
import type { ConversationCheckpoint, WorkbenchConversation } from './workbench-conversation-contract'

function harness(complete: NonNullable<AgentProvider['completeStructuredJson']>) {
  const date = new Date().toISOString()
  const checkpoint: ConversationCheckpoint = { version: 1, turnId: 'user-1', step: 2, cycle: 1, recoveries: 0, group: 'group', providerId: 'test', observations: [{ sourceId: 'source-1', name: 'repo_read', args: { path: 'app.js' }, result: { content: 'verified source' } }], citations: [{ id: 'source-1', label: 'repo_read · app.js', excerpt: 'verified source', observedAt: date }], requirementRunIds: [], investigation: beginInvestigationBatch(undefined, { maxSteps: 1 }) }
  checkpoint.investigation!.stopReason = 'step_limit'
  checkpoint.investigation!.batch.steps = 1
  let session: WorkbenchConversation = { id: 'summary-chat', localProjectId: 'local', version: 1, title: 'fixture', isOpen: true, status: 'running', inputDraft: '', messages: [{ id: 'user-1', role: 'user', text: '调查具体行为', createdAt: date }], createdAt: date, updatedAt: date, checkpoint, failure: { phase: 'provider_request', code: 'old_error' } }
  const controller = new AbortController()
  const completeStructuredJson = vi.fn(complete)
  const host = { provider: { ...createFakeAgentProvider(), completeStructuredJson }, checkpoint, signal: controller.signal,
    read: async () => session, update: async (fn: (value: WorkbenchConversation) => WorkbenchConversation) => (session = fn(session)),
    failure: (error: unknown, phase: string) => ({ phase, code: error instanceof AgentProviderRequestError ? error.code : 'unknown' }),
  }
  return { host, controller, completeStructuredJson, read: () => session }
}
describe('bounded investigation summary', () => {
  it('stores a cited partial summary, usage and paused checkpoint without business actions', async () => {
    const h = harness(async input => {
      expect(input.nativeTools).toBeUndefined()
      expect(input.maxOutputTokens).toBe(2048)
      return { value: { text: 'app.js 已读取；仍需核实测试。', citationIds: ['source-1'] }, usage: { inputTokens: 4, outputTokens: 5 } }
    })
    await pauseWithInvestigationSummary(h.host)
    expect(h.read().status).toBe('paused')
    expect(h.read().failure).toBeUndefined()
    expect(h.read().messages.at(-1)).toMatchObject({ role: 'assistant', citations: [{ id: 'source-1' }] })
    expect(h.read().messages.at(-1)?.text).toContain('调查尚未完成')
    expect(h.read().messages.find(m => m.usage)?.usage).toEqual({ inputTokens: 4, outputTokens: 5 })
    expect(h.read().investigationProgress?.totals.summaryRequests).toBe(1)
  })

  it('retries a malformed summary only once and preserves usage from both responses', async () => {
    let attempt = 0
    const h = harness(async () => ++attempt === 1
      ? { value: { text: '调用工具', tool: { name: 'repo_read' } }, usage: { inputTokens: 6, outputTokens: 2 } }
      : { value: { text: '已有来源，但仍未完成调查。', citationIds: ['source-1'] }, usage: { inputTokens: 8, outputTokens: 3 } })
    await pauseWithInvestigationSummary(h.host)
    expect(h.completeStructuredJson).toHaveBeenCalledTimes(2)
    expect(h.read().messages.filter(m => m.usage).map(m => m.usage!.inputTokens)).toEqual([6, 8])
    expect(h.read().messages.filter(m => m.attempt).map(m => m.attempt!.status)).toEqual(['failed', 'completed'])
    expect(h.read().investigationProgress?.totals).toMatchObject({ requests: 2, recoveries: 1, summaryRequests: 2 })
  })

  it('falls back locally after two bad summaries without trusting their tool actions or fabricated citations', async () => {
    const h = harness(async () => ({ value: { text: '已完成', citationIds: ['fabricated'] }, usage: { inputTokens: 1, outputTokens: 1 } }))
    await pauseWithInvestigationSummary(h.host)
    expect(h.completeStructuredJson).toHaveBeenCalledTimes(2)
    expect(h.read().messages.at(-1)?.text).toContain('尚未生成模型总结')
    expect(h.read().messages.at(-1)?.text).not.toContain('fabricated')
    expect(h.read().messages.at(-1)?.text).toContain('累计 2 次请求尝试')
  })

  it('stops after a nonretryable budget refusal and retains its attempt without treating unknown usage as zero', async () => {
    const h = harness(async () => { throw new AgentProviderRequestError({ code: 'unknown_provider_failure', sanitizedCause: 'budget_exceeded', retryable: false, deliveryState: 'not_sent', billingState: 'not_incurred' }) })
    await pauseWithInvestigationSummary(h.host)
    expect(h.completeStructuredJson).toHaveBeenCalledTimes(1)
    expect(h.read().messages.filter(m => m.attempt)).toHaveLength(1)
    expect(h.read().messages.find(m => m.attempt)?.usage).toBeUndefined()
    expect(h.read().messages.at(-1)?.text).toContain('尚未生成模型总结')
  })

  it('does not dispatch at the hard request boundary or when the user already cancelled', async () => {
    const h = harness(async () => { throw new Error('Must not call') })
    h.host.checkpoint.investigation!.totals.requests = 238
    h.host.checkpoint.investigation!.stopReason = 'request_limit'
    await pauseWithInvestigationSummary(h.host)
    expect(h.completeStructuredJson).not.toHaveBeenCalled()
    expect(h.read().messages.at(-1)?.text).toContain('新问题')
    const cancelled = harness(async () => { throw new Error('Must not call') })
    cancelled.controller.abort(new Error('user cancelled'))
    await expect(pauseWithInvestigationSummary(cancelled.host)).rejects.toThrow('user cancelled')
    expect(cancelled.completeStructuredJson).not.toHaveBeenCalled()
  })

  it('keeps response usage when cancellation arrives during summary and starts no recovery', async () => {
    const h = harness(async () => {
      h.controller.abort(new Error('user cancelled'))
      return { value: { text: 'late summary' }, usage: { inputTokens: 10, outputTokens: 7 } }
    })
    await expect(pauseWithInvestigationSummary(h.host)).rejects.toThrow('user cancelled')
    expect(h.completeStructuredJson).toHaveBeenCalledTimes(1)
    expect(h.read().messages.find(m => m.usage)?.usage).toEqual({ inputTokens: 10, outputTokens: 7 })
    expect(h.read().messages.filter(m => m.role === 'assistant')).toHaveLength(0)
  })

  it('checks cancellation again after saving the attempt and before provider dispatch', async () => {
    const h = harness(async () => ({ value: { text: 'Must not call' } }))
    const update = h.host.update
    h.host.update = async transform => {
      const saved = await update(transform)
      if (saved.messages.some(message => message.attempt?.status === 'running')) h.controller.abort(new Error('cancelled before dispatch'))
      return saved
    }
    await expect(pauseWithInvestigationSummary(h.host)).rejects.toThrow('cancelled before dispatch')
    expect(h.completeStructuredJson).not.toHaveBeenCalled()
  })

  it('does not run another tool-enabled OpenCode harness for a partial summary', async () => {
    const h = harness(async () => { throw new Error('Must not call') })
    await h.host.update(current => ({ ...current, executor: 'opencode' }))
    await pauseWithInvestigationSummary(h.host)
    expect(h.completeStructuredJson).not.toHaveBeenCalled()
    expect(h.read().messages.at(-1)?.text).toContain('尚未生成模型总结')
  })
})
