import { describe, expect, it } from 'vitest'
import { buildConversationDiagnostics, retainConversationDiagnostics } from './conversation-diagnostics'
import type { WorkbenchConversation } from './workbench-conversation-contract'
const time = '2026-10-23T12:00:00.000Z'
const fixture = (): WorkbenchConversation => ({id:'chat',localProjectId:'p',version:1,title:'PRIVATE_TITLE',isOpen:true,inputDraft:'PRIVATE_DRAFT',status:'failed',createdAt:time,updatedAt:time,messages:[]})
describe('bounded private conversation diagnostics', () => {
  it('exports allowlisted calls without bodies, prompts, paths or reasoning', () => {
    const session = fixture()
    session.messages = [{id:'c1',role:'notice',text:'PRIVATE_TEXT',createdAt:time,reasoning:{text:'PRIVATE_REASONING',status:'completed'},provider:{id:'provider',model:'model'},failure:{phase:'provider_request',code:'invalid_model_output',reason:'invalid_json',httpStatus:200},usage:{inputTokens:12,outputTokens:3},attempt:{turnId:'turn',step:3,cycle:1,recovery:1,group:'group',startedAt:time,status:'failed'}}]
    const report = buildConversationDiagnostics(session, Date.parse(time))
    expect(report.calls).toHaveLength(1)
    expect(report.calls[0]).toMatchObject({id:'c1',attempt:{step:3,recovery:1},usage:{inputTokens:12,outputTokens:3}})
    expect(JSON.stringify(report)).not.toContain('PRIVATE_')
    expect(report.replay.available).toBe(false)
  })
  it('rotates metadata while preserving original messages, usage and memory receipts', () => {
    const session = fixture()
    session.messages = Array.from({length:250},(_,i)=>({id:`call-${i}`,role:'notice' as const,text:'original',createdAt:time,provider:{id:'p',model:'m'},responseMetadata:{httpStatus:200,contentLength:i},usage:{inputTokens:1,outputTokens:1}}))
    const next=retainConversationDiagnostics(session,Date.parse(time))
    expect(next.messages).toHaveLength(250)
    expect(next.messages.filter(m=>m.responseMetadata)).toHaveLength(200)
    expect(next.messages.every(m=>m.usage?.inputTokens===1 && m.text==='original')).toBe(true)
    const report=buildConversationDiagnostics(next,Date.parse(time))
    expect(report.calls).toHaveLength(200)
    expect(report.omittedCalls).toBe(50)
    expect(new TextEncoder().encode(JSON.stringify(report)).length).toBeLessThanOrEqual(524288)
  })
  it('revalidates forged enum and nested progress fields instead of spreading runtime JSON', () => {
    const session = JSON.parse(JSON.stringify({ ...fixture(), status: 'PRIVATE_STATUS', investigationProgress: {
      version: 1, stopReason: 'PRIVATE_REASON', privateContext: 'PRIVATE_TOP',
      policy: { source: 'PRIVATE_POLICY_SOURCE', maxSteps: 12, maxDurationMs: 180000, secret: 'PRIVATE_POLICY' },
      totals: { requests: 2, recoveries: 0, toolCalls: 1, summaryRequests: 0, privateBody: 'PRIVATE_TOTALS' },
      batch: { id: 'batch', startedAt: Date.parse(time), steps: 1, requests: 2, recoveries: 0, toolCalls: 1, summaryRequests: 0, noProgress: 0, repeatedQueries: 0, reusedQueries: 0, raw: 'PRIVATE_BATCH' },
      queries: [{ key: 'PRIVATE_QUERY', resultDigest: 'PRIVATE_DIGEST' }],
    }, messages: [{ id: 'c1', role: 'notice', text: 'PRIVATE_TEXT', createdAt: time, provider: { id: 'p', model: 'model', executor: 'PRIVATE_EXECUTOR' },
      attempt: { turnId: 'turn', step: 1, cycle: 1, recovery: 0, group: 'group', startedAt: time, status: 'PRIVATE_ATTEMPT' },
      failure: { phase: 'PRIVATE_PHASE', code: 'PRIVATE_CODE', reason: 'PRIVATE_CAUSE' }, memoryReceipt: { state: 'PRIVATE_DELIVERY' },
    }] }))
    const report = buildConversationDiagnostics(session, Date.parse(time))
    expect(JSON.stringify(report)).not.toContain('PRIVATE_')
    expect(report.status).toBe('unknown')
    expect(report.calls[0]?.failure).toMatchObject({ phase: 'unknown', code: 'unknown' })
    expect(report.investigation).toMatchObject({ totals: { requests: 2 }, batch: { steps: 1 } })
  })
  it('excludes credential-shaped identifiers and malformed nested diagnostic objects', () => {
    const session = JSON.parse(JSON.stringify({ ...fixture(), messages: [{ id: 'sk-privatecredential1234567890', role: 'notice', text: 'text', createdAt: time, provider: { id: 'p', model: 'model' }, failure: { phase: { secret: 'PRIVATE_PHASE' }, code: ['PRIVATE_CODE'], reason: { raw: 'PRIVATE_CAUSE' } }, memoryReceipt: { state: { raw: 'PRIVATE_DELIVERY' } } }] }))
    const serialized = JSON.stringify(buildConversationDiagnostics(session, Date.parse(time)))
    expect(serialized).not.toContain('PRIVATE_')
    expect(serialized).not.toContain('sk-privatecredential')
  })
})
