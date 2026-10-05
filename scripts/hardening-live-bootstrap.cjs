// Opt-in H7 instrumentation in the isolated Electron process. Never logs a credential or body.
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
if (process.env.DEVFLOW_H7_LIVE !== '1' || !process.env.DEVFLOW_H7_LEDGER) throw new Error('H7 live opt-in required')
app.commandLine.removeSwitch('use-mock-keychain')
app.commandLine.removeSwitch('password-store')
// Match the source development app's Keychain service name (not the packaged product label).
app.setName(require('../apps/desktop/package.json').name)
const ledgerPath = process.env.DEVFLOW_H7_LEDGER
const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : { calls: [], limitUsd: 1 }
if (ledger.limitUsd !== 1 || !Array.isArray(ledger.calls)) throw new Error('Invalid H7 budget ledger')
globalThis.h7Ledger = ledger
globalThis.h7Lifecycle = []
app.on('browser-window-created', (_, window) => {
  window.on('close', () => globalThis.h7Lifecycle.push({ at: Date.now(), event: 'window-close' }))
  window.on('closed', () => globalThis.h7Lifecycle.push({ at: Date.now(), event: 'window-closed' }))
  window.webContents.on('render-process-gone', (_, details) => globalThis.h7Lifecycle.push({ at: Date.now(), event: 'render-process-gone', ...details }))
})
app.on('child-process-gone', (_, details) => globalThis.h7Lifecycle.push({ at: Date.now(), event: 'child-process-gone', type: details.type, reason: details.reason, exitCode: details.exitCode }))
const save = () => fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', { mode: 0o600 })
const original = globalThis.fetch
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  if (['127.0.0.1', 'localhost'].includes(url.hostname)) return original(input, options)
  if (url.origin !== 'https://api.deepseek.com' || !['/chat/completions', '/v1/chat/completions'].includes(url.pathname)) throw new Error('H7 external destination blocked')
  const body = JSON.parse(String(options?.body))
  if (body.model !== 'deepseek-flash') throw new Error('H7 model not authorized')
  // UTF-8 bytes plus overhead overestimate input tokens. Without an explicit cap, reserve
  // the full documented model maximum (384 Ki tokens), not an assumed provider default.
  const bound = ((Buffer.byteLength(String(options.body)) + 4096) * 0.3 + (body.max_tokens ?? 393216) * 1.2) / 1e6
  const committed = ledger.calls.reduce((sum, call) => sum + (call.peakCostUsd ?? call.reservedUsd), 0)
  if (committed + bound > 1 || ledger.calls.length >= 12) throw new Error('H7 cumulative $1 budget or request cap reached')
  let nativePhase
  try { nativePhase = JSON.parse(body.messages.at(-1).content).phase } catch {}
  const call = { number: ledger.calls.length + 1, phase: globalThis.h7Phase, nativePhase,
    startedAt: new Date().toISOString(), model: body.model, outputLimit: body.max_tokens ?? null,
    thinking: body.thinking, reasoningEffort: body.reasoning_effort, stream: body.stream === true, reservedUsd: bound }
  ledger.calls.push(call)
  save()
  try {
    const response = await original(input, { ...options, redirect: 'error' })
    call.httpStatus = response.status
    // Observe a clone. The original response is returned unchanged to the real adapter.
    const text = await response.clone().text()
    let content = ''
    let reasoningCharacters = 0
    let usage
    const envelopes = body.stream
      ? text.split('\n').filter(line => line.startsWith('data: ') && !line.includes('[DONE]')).map(line => { try { return JSON.parse(line.slice(6)) } catch { return null } }).filter(Boolean)
      : [JSON.parse(text)]
    for (const envelope of envelopes) {
      const choice = envelope.choices?.[0]
      content += choice?.message?.content ?? choice?.delta?.content ?? ''
      reasoningCharacters += (choice?.message?.reasoning_content ?? choice?.delta?.reasoning_content ?? '').length
      if (choice?.finish_reason) call.finishReason = choice.finish_reason
      if (envelope.usage) usage = envelope.usage
    }
    call.contentCharacters = content.length
    call.reasoningCharacters = reasoningCharacters
    try { const parsed = JSON.parse(content); call.jsonObject = parsed !== null && !Array.isArray(parsed) && typeof parsed === 'object' } catch { call.jsonObject = false }
    if (usage && Number.isSafeInteger(usage.prompt_tokens) && usage.prompt_tokens >= 0 && Number.isSafeInteger(usage.completion_tokens) && usage.completion_tokens >= 0) {
      call.usage = { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens,
        cacheReadTokens: usage.prompt_cache_hit_tokens ?? 0, cacheMissTokens: usage.prompt_cache_miss_tokens ?? usage.prompt_tokens }
      call.peakCostUsd = (call.usage.cacheReadTokens * 0.006 + call.usage.cacheMissTokens * 0.3 + call.usage.outputTokens * 1.2) / 1e6
    }
    return response
  } finally { call.finishedAt = new Date().toISOString(); save() }
}
import(pathToFileURL(path.resolve(__dirname, '../apps/desktop/dist-electron/main.js')).href)
