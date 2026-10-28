// Opt-in acceptance instrumentation; never loaded by the shipped application.
// Preserve the official request and response. Only bounded metadata is written.
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')
if (process.env.DEVFLOW_GATE_ACCEPTANCE !== '1' || !process.env.DEVFLOW_GATE_ACCEPTANCE_DIR) {
  throw new Error('Explicit gate acceptance opt-in and an isolated directory are required')
}
const directory = path.resolve(process.env.DEVFLOW_GATE_ACCEPTANCE_DIR)
fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
const ledgerPath = path.join(directory, 'official-budget.json')
const lifecyclePath = path.join(directory, 'lifecycle.jsonl')
const phasePath = path.join(directory, 'phase.txt')
const limit = 2_000_000
const initial = { version: 1, budgetMicroyuan: limit, closed: false, calls: [] }
try { fs.writeFileSync(ledgerPath, JSON.stringify(initial), { flag: 'wx', mode: 0o600 }) }
catch (error) { if (error.code !== 'EEXIST') throw error }
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
if (ledger.version !== 1 || ledger.budgetMicroyuan !== limit || typeof ledger.closed !== 'boolean' || !Array.isArray(ledger.calls) || ledger.calls.some(call =>
  !Number.isSafeInteger(call.reservedMicroyuan) || call.reservedMicroyuan <= 0 ||
  (call.committedMicroyuan != null && (!Number.isSafeInteger(call.committedMicroyuan) || call.committedMicroyuan < 0)))) {
  throw new Error('Invalid immutable gate acceptance budget')
}
const save = () => {
  const temporary = `${ledgerPath}.tmp`
  const fd = fs.openSync(temporary, 'w', 0o600)
  try { fs.writeFileSync(fd, JSON.stringify(ledger, null, 2) + '\n'); fs.fsyncSync(fd) }
  finally { fs.closeSync(fd) }
  fs.renameSync(temporary, ledgerPath)
}
const phase = () => {
  try { const value = fs.readFileSync(phasePath, 'utf8').trim(); return /^[a-z0-9_-]{1,80}$/.test(value) ? value : 'unspecified' }
  catch { return 'setup' }
}
const record = (event, fields = {}) => {
  try { fs.appendFileSync(lifecyclePath, JSON.stringify({
    at: new Date().toISOString(), monotonicNs: process.hrtime.bigint().toString(), pid: process.pid,
    phase: phase(), event, ...fields,
  }) + '\n', { mode: 0o600 }) }
  catch { ledger.blocked = true }
}
record('bootstrap-start', { authorizationClosed: ledger.closed })
app.setName(require('../apps/desktop/package.json').name)
app.on('browser-window-created', (_, window) => {
  const identity = { windowId: window.id, webContentsId: window.webContents.id }
  record('window-created', identity)
  for (const event of ['close', 'closed', 'unresponsive', 'responsive']) window.on(event, () => record(`window-${event}`, identity))
  window.webContents.on('render-process-gone', (_, details) => record('render-process-gone', { ...identity, reason: details.reason, exitCode: details.exitCode }))
  window.webContents.on('destroyed', () => record('webcontents-destroyed', identity))
  window.webContents.on('did-fail-load', (_, code, _description, _url, isMainFrame) => record('did-fail-load', { ...identity, code, isMainFrame }))
  // Distinguish explicit JavaScript close/destroy from a native close or renderer exit.
  for (const method of ['close', 'destroy']) {
    const original = window[method]
    window[method] = function (...args) {
      record(`window-${method}-called`, { ...identity, stack: String(new Error().stack).split('\n').slice(2, 9).map(line => line.replaceAll(path.resolve(__dirname, '..'), '<workspace>')) })
      return Reflect.apply(original, this, args)
    }
  }
})
app.on('child-process-gone', (_, details) => record('child-process-gone', { type: details.type, reason: details.reason, exitCode: details.exitCode }))
for (const event of ['before-quit', 'will-quit', 'window-all-closed']) app.on(event, () => record(event))
process.on('exit', code => record('main-exit', { code }))
process.on('uncaughtExceptionMonitor', error => record('uncaught-exception', { name: error instanceof TypeError ? 'TypeError' : 'Error' }))
const pending = new Set()
let shuttingDown = false
const closeAuthorization = () => {
  ledger.closed = true
  try { save() } catch { ledger.blocked = true; record('budget-close-write-failed') }
}
// Electron may handle SIGTERM natively before Node dispatches its signal handler.
app.on('before-quit', closeAuthorization)
process.on('SIGTERM', () => {
  if (shuttingDown) return
  shuttingDown = true
  closeAuthorization()
  record('operator-sigterm', { observationsPending: pending.size })
  void Promise.race([Promise.allSettled([...pending]), new Promise(resolve => setTimeout(resolve, 3000))]).finally(() => app.quit())
})
const originalFetch = globalThis.fetch
const hash = value => createHash('sha256').update(value).digest('hex')
async function observe(response, body, call) {
  try {
    // Observation consumes its own tee concurrently, never before returning the original.
    const text = await response.text()
    let content = ''
    let reasoningCharacters = 0
    let usage
    const envelopes = body.stream
      ? text.split(/\r?\n/u).filter(line => line.startsWith('data:') && !line.includes('[DONE]')).map(line => { try { return JSON.parse(line.slice(5).trim()) } catch { return null } }).filter(Boolean)
      : [JSON.parse(text)]
    for (const envelope of envelopes) {
      const choice = envelope.choices?.[0]
      content += choice?.message?.content ?? choice?.delta?.content ?? ''
      reasoningCharacters += (choice?.message?.reasoning_content ?? choice?.delta?.reasoning_content ?? '').length
      if (choice?.finish_reason) call.finishReason = ['stop', 'length', 'tool_calls', 'content_filter'].includes(choice.finish_reason) ? choice.finish_reason : 'other'
      if (typeof envelope.id === 'string') call.responseIdDigest = hash(envelope.id)
      if (envelope.usage) usage = envelope.usage
    }
    call.contentBytes = Buffer.byteLength(content)
    call.contentDigest = hash(content)
    call.reasoningCharacters = reasoningCharacters
    call.streamDone = body.stream ? text.includes('data: [DONE]') : null
    try { const value = JSON.parse(content); call.jsonObject = value !== null && typeof value === 'object' && !Array.isArray(value) }
    catch { call.jsonObject = false }
    if (usage && ['prompt_tokens', 'completion_tokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)) {
      call.usage = { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
      // Peak CNY prices, ignoring cache discounts: input 2 / output 8 per million.
      call.committedMicroyuan = usage.prompt_tokens * 2 + usage.completion_tokens * 8
      if (call.committedMicroyuan > call.reservedMicroyuan) ledger.blocked = true
      call.status = 'usage_observed'
    } else call.status = 'usage_unknown'
  } catch { call.status = 'observer_read_failed'; record('observer-read-failed', { callId: call.id }) }
  finally { call.finishedAt = new Date().toISOString(); save(); record('model-observation-finished', { callId: call.id, status: call.status }) }
}
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    const settlement = url.pathname === '/api/runtime/model-calls/settle'
    if (settlement) record('settlement-start')
    try { const response = await originalFetch(input, options); if (settlement) record('settlement-response', { status: response.status }); return response }
    catch (error) { if (settlement) record('settlement-network-failure'); throw error }
  }
  if (url.origin !== 'https://api.deepseek.com' || !['/chat/completions', '/v1/chat/completions'].includes(url.pathname)) throw new Error('Acceptance external destination denied')
  const text = String(options?.body)
  const body = JSON.parse(text)
  if (body.model !== 'deepseek-flash' || (body.n ?? 1) !== 1 || !Array.isArray(body.messages) || body.messages.length > 128 || Buffer.byteLength(text) > 262144) throw new Error('Acceptance request outside authorized bounds')
  const outputLimit = body.max_tokens ?? 393216
  if (!Number.isSafeInteger(outputLimit) || outputLimit < 1 || outputLimit > 393216) throw new Error('Invalid output reservation')
  const reservedMicroyuan = (Buffer.byteLength(text) + 4096) * 2 + outputLimit * 8
  const used = ledger.calls.reduce((sum, call) => sum + (call.committedMicroyuan ?? call.reservedMicroyuan), 0)
  if (ledger.closed || ledger.blocked || ledger.calls.length >= 18 || used + reservedMicroyuan > limit) throw new Error('Acceptance cumulative CNY 2 budget or request limit reached')
  const call = { id: ledger.calls.length + 1, phase: phase(), startedAt: new Date().toISOString(), status: 'reserved_unknown',
    reservedMicroyuan, outputLimit, requestBytes: Buffer.byteLength(text), requestDigest: hash(text),
    thinking: body.thinking ?? null, reasoningEffort: body.reasoning_effort ?? null, stream: body.stream === true,
    responseFormat: body.response_format?.type ?? null }
  ledger.calls.push(call)
  save()
  record('model-dispatch', { callId: call.id })
  try {
    const response = await originalFetch(input, { ...options, redirect: 'error' })
    call.httpStatus = response.status
    record('model-response-headers', { callId: call.id, status: response.status })
    try {
      const observation = observe(response.clone(), body, call).catch(() => { ledger.blocked = true })
      pending.add(observation)
      void observation.finally(() => pending.delete(observation))
    } catch {
      call.status = 'observer_clone_failed'
      try { save() } catch { ledger.blocked = true }
      record('observer-clone-failed', { callId: call.id })
    }
    return response
  } catch (error) { call.status = 'network_unknown'; call.finishedAt = new Date().toISOString(); try { save() } catch { ledger.blocked = true }; record('model-network-failure', { callId: call.id }); throw error }
}
import(pathToFileURL(path.resolve(__dirname, '../apps/desktop/dist-electron/main.js')).href)
