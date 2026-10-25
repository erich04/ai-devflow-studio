// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  advanceInvestigationStep, beginInvestigationBatch, canStartInvestigationRequest, investigationBoundary,
  investigationProgress, investigationResultsEqual, localInvestigationSummary, normalizeInvestigationPolicy,
  recordInvestigationQuery, recordInvestigationRequest, boundInvestigationResult, investigationObservationCurrent, investigationCanRevalidate,
} from './investigation-policy'

const started = Date.parse('2026-10-23T10:00:00.000Z')
const read = (path: string, content = path) => ({ name: 'repo_read', args: { path }, result: { content }, sourceId: `source-${path}`, evidenceAvailable: true })

describe('bounded investigation execution policy', () => {
  it('keeps the compatible defaults and permits a useful run beyond twelve steps', () => {
    expect(normalizeInvestigationPolicy()).toMatchObject({ maxSteps: 12, maxDurationMs: 180000, source: 'default' })
    const state = beginInvestigationBatch(undefined, { maxSteps: 30, maxDurationMs: 600000 }, started)
    for (let step = 0; step < 29; step++) {
      recordInvestigationRequest(state)
      recordInvestigationQuery(state, read(`file-${step}`))
      advanceInvestigationStep(state)
    }
    expect(investigationBoundary(state, started + 1000)).toBeUndefined()
    advanceInvestigationStep(state)
    expect(investigationBoundary(state, started + 1000)).toEqual({ reason: 'step_limit', resumable: true })
    expect(state.policy.maxToolCalls).toBe(30 * 16)
  })

  it.each([{ maxSteps: 0 }, { maxSteps: 61 }, { maxSteps: 3.5 }, { maxSteps: null }, { maxSteps: '30' }, { maxDurationMs: null }, { maxDurationMs: 29999 }, { maxDurationMs: 600001 }, { maxDurationMs: NaN }, { maxRequests: 9999 }, null, [], '30'])('rejects invalid or hidden execution settings: %j', value => {
    expect(() => normalizeInvestigationPolicy(value)).toThrow()
  })

  it('starts a new user-authorized batch while retaining cumulative requests and recoveries', () => {
    const first = beginInvestigationBatch(undefined, undefined, started)
    recordInvestigationRequest(first)
    recordInvestigationRequest(first, { recovery: true })
    recordInvestigationQuery(first, read('store.js'))
    advanceInvestigationStep(first)
    const second = beginInvestigationBatch(first, undefined, started + 300000)
    expect(second.totals).toEqual(first.totals)
    expect(second.batch).toMatchObject({ steps: 0, requests: 0, recoveries: 0, toolCalls: 0, summaryRequests: 0, noProgress: 0 })
    expect(second.batch.id).not.toBe(first.batch.id)
    expect(second.queries).toEqual(first.queries)
    recordInvestigationRequest(second)
    expect(first.totals.requests).toBe(2)
  })

  it('preserves hard cumulative limits through continuation and reserves requests for bounded summary', () => {
    const state = beginInvestigationBatch(undefined, undefined, started)
    state.totals.requests = state.policy.maxRequests - 2
    expect(investigationBoundary(state, started)).toEqual({ reason: 'request_limit', resumable: false })
    expect(canStartInvestigationRequest(state, { summary: true }, started)).toBeUndefined()
    recordInvestigationRequest(state, { summary: true })
    recordInvestigationRequest(state, { summary: true, recovery: true })
    expect(canStartInvestigationRequest(state, { summary: true }, started)).toMatchObject({ resumable: false })
    const next = beginInvestigationBatch(state, undefined, started + 1)
    expect(canStartInvestigationRequest(next, {}, started + 1)).toEqual({ reason: 'request_limit', resumable: false })
    expect(() => recordInvestigationRequest(next)).toThrow()
  })

  it('stops cumulative automatic recoveries without confusing them with successful steps', () => {
    const state = beginInvestigationBatch(undefined, undefined, started)
    state.totals.recoveries = state.policy.maxRecoveries
    expect(canStartInvestigationRequest(state, { recovery: true }, started)).toEqual({ reason: 'recovery_limit', resumable: false })
    expect(canStartInvestigationRequest(state, {}, started)).toBeUndefined()
    expect(state.batch.steps).toBe(0)
  })

  it('separates elapsed batch time from summary allowance and never silently extends it on continue', () => {
    const state = beginInvestigationBatch(undefined, { maxDurationMs: 30000 }, started)
    expect(investigationBoundary(state, started + 30000)).toEqual({ reason: 'time_limit', resumable: true })
    expect(canStartInvestigationRequest(state, { summary: true }, started + 30001)).toBeUndefined()
    expect(canStartInvestigationRequest(state, { summary: true }, started + 60000)).toEqual({ reason: 'summary_limit', resumable: true })
    expect(investigationBoundary(beginInvestigationBatch(state, undefined, started + 60001), started + 60001)).toBeUndefined()
  })

  it('detects alternating repeated evidence, not just identical adjacent calls', () => {
    const state = beginInvestigationBatch(undefined, undefined, started)
    recordInvestigationQuery(state, read('store.js'))
    recordInvestigationQuery(state, read('dom.js'))
    for (const path of ['store.js', 'dom.js', 'store.js', 'dom.js']) expect(recordInvestigationQuery(state, read(path)).repeated).toBe(true)
    expect(investigationBoundary(state, started)).toEqual({ reason: 'no_progress', resumable: true })
    expect(state.batch.noProgress).toBe(4)
    expect(state.batch.toolCalls).toBe(6)
  })

  it('normalizes object key order, optional defaults and safe dot segments but preserves query semantics', () => {
    const state = beginInvestigationBatch(undefined, undefined, started)
    recordInvestigationQuery(state, { ...read('src/store.js'), args: { path: './src/store.js' } })
    expect(recordInvestigationQuery(state, read('src/store.js')).repeated).toBe(true)
    recordInvestigationQuery(state, { ...read('doc'), name: 'artifact', args: { runId: 'r', artifactId: 'a' } })
    expect(recordInvestigationQuery(state, { ...read('doc'), name: 'artifact', args: { limit: 6000, offset: 0, artifactId: 'a', runId: 'r' } }).repeated).toBe(true)
    expect(recordInvestigationQuery(state, { ...read('doc'), name: 'artifact', args: { runId: 'r', artifactId: 'a', offset: 6000 } }).repeated).toBe(false)
    expect(recordInvestigationQuery(state, { ...read('store.js'), args: { path: 'store.js', unexpected: true } }).repeated).toBe(false)
  })

  it('allows revised evidence, failed reads and necessary retrieval after prompt omission', () => {
    const state = beginInvestigationBatch(undefined, undefined, started)
    recordInvestigationQuery(state, read('store.js'))
    recordInvestigationQuery(state, read('store.js'))
    expect(recordInvestigationQuery(state, { ...read('store.js'), evidenceAvailable: false }).repeated).toBe(false)
    expect(state.batch.noProgress).toBe(0)
    expect(recordInvestigationQuery(state, read('store.js', 'changed')).repeated).toBe(false)
    expect(recordInvestigationQuery(state, { ...read('store.js'), result: { error: 'missing' }, outcome: 'failed' }).repeated).toBe(false)
    expect(recordInvestigationQuery(state, read('store.js', 'changed again')).repeated).toBe(false)
  })

  it('records evidence progress without recounting requests already persisted before dispatch', () => {
    const state = beginInvestigationBatch(undefined, undefined, started)
    state.batch.toolCalls = state.totals.toolCalls = 2
    recordInvestigationQuery(state, { ...read('store.js'), countRequest: false })
    recordInvestigationQuery(state, { ...read('store.js'), countRequest: false, reused: true })
    expect(state.totals.toolCalls).toBe(2)
    expect(state.batch).toMatchObject({ toolCalls: 2, repeatedQueries: 1, reusedQueries: 1, noProgress: 1 })
    expect(state.queries).toHaveLength(1)
  })

  it('counts freshness reads even when evidence is reused and retains no raw query content', () => {
    const state = beginInvestigationBatch(undefined, undefined, started)
    recordInvestigationQuery(state, { ...read('private-filename', 'PRIVATE FILE BODY'), sourceId: 'source-1' })
    recordInvestigationQuery(state, { ...read('private-filename', 'PRIVATE FILE BODY'), sourceId: 'source-1', reused: true })
    expect(state.batch).toMatchObject({ toolCalls: 2, reusedQueries: 1, repeatedQueries: 1 })
    expect(JSON.stringify(state.queries)).not.toContain('PRIVATE FILE BODY')
    expect(JSON.stringify(state.queries)).not.toContain('private-filename')
    expect(JSON.stringify(investigationProgress(state))).not.toContain('queries')
  })

  it('compares only host timestamp envelopes as volatile, preserving business dates and bounded results', () => {
    const a = { sourceId: 's', observedAt: 'old', result: { content: 'Business observedAt: yesterday', updatedAt: 'v1', nested: { observedAt: 'one' } } }
    expect(investigationResultsEqual(a, { ...a, observedAt: 'new' }, true)).toBe(true)
    expect(investigationResultsEqual(a, { ...a, result: { ...a.result, nested: { observedAt: 'two' } } }, true)).toBe(false)
    expect(investigationResultsEqual({ content: 'a', updatedAt: 'v1' }, { content: 'a', updatedAt: 'v2' })).toBe(false)
    expect(investigationResultsEqual({ truncated: true, excerpt: '{"content":"abc' }, { content: 'abcdef' })).toBe(false)
  })

  it('does not silently reset damaged persisted counters into a fresh allowance', () => {
    const state = beginInvestigationBatch(undefined, undefined, started)
    expect(() => beginInvestigationBatch({ ...state, totals: { ...state.totals, requests: -1 } }, undefined, started)).toThrow()
    expect(() => beginInvestigationBatch(JSON.parse(JSON.stringify({ ...state, version: 999 })), undefined, started)).toThrow()
  })

  it('revalidates bounded local evidence without erasing nested business timestamps', () => {
    const observed = { name: 'workflow', result: { observedAt: 'old', runs: [{ id: 'r', updatedAt: 'v1', observedAt: 'business date' }] } }
    expect(investigationObservationCurrent(observed, { ...observed.result, observedAt: 'new' })).toBe(true)
    expect(investigationObservationCurrent(observed, { observedAt: 'new', runs: [{ id: 'r', updatedAt: 'v2', observedAt: 'business date' }] })).toBe(false)
    expect(investigationObservationCurrent({ ...observed, degraded: true }, observed.result)).toBe(false)
    expect(investigationObservationCurrent({ name: 'repo_read', result: { error: 'missing' } }, { error: 'missing' })).toBe(false)
    expect(investigationObservationCurrent({ name: 'artifact', result: { observedAt: 'business old' } }, { observedAt: 'business new' })).toBe(false)
    const large = { content: 'verified text '.repeat(3000) }
    expect(investigationObservationCurrent({ name: 'repo_read', result: boundInvestigationResult(large) }, large)).toBe(true)
    expect(boundInvestigationResult(boundInvestigationResult(large))).toEqual(boundInvestigationResult(large))
  })

  it('does not replay remote retrieval as a freshness check and hashes only stable host result envelopes', () => {
    expect(investigationCanRevalidate('knowledge_read')).toBe(true)
    expect(investigationCanRevalidate('knowledge_search')).toBe(false)
    expect(investigationObservationCurrent({ name: 'knowledge_search', result: { matches: [] } }, { matches: [] })).toBe(false)
    const state = beginInvestigationBatch(undefined, undefined, started)
    recordInvestigationQuery(state, { name: 'workflow', args: {}, result: { observedAt: 'old', runs: [{ id: 'r', version: 1 }] }, sourceId: 's1', evidenceAvailable: true })
    expect(recordInvestigationQuery(state, { name: 'workflow', args: {}, result: { observedAt: 'new', runs: [{ id: 'r', version: 1 }] }, sourceId: 's2', evidenceAvailable: true }).repeated).toBe(true)
  })

  it('offers an honest local fallback with evidence references and no invented answer or copied source body', () => {
    const state = beginInvestigationBatch(undefined, { maxSteps: 1 }, started)
    recordInvestigationQuery(state, read('store.js'))
    advanceInvestigationStep(state)
    const summary = localInvestigationSummary(state, [{ id: 'source-1', label: 'repo_read · store.js', excerpt: 'SECRET FULL BODY' }], 'step_limit')
    expect(summary).toContain('尚未生成模型总结')
    expect(summary).toContain('source-1')
    expect(summary).toContain('store.js')
    expect(summary).not.toContain('SECRET FULL BODY')
    expect(summary).toContain('继续')
  })
})
