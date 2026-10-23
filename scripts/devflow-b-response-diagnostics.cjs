// Optional verification-only shape diagnostics: never persist prompts, response text or credentials.
const fs = require('node:fs/promises')
const allowedKeys = new Set(['tool', 'name', 'args', 'path', 'query', 'conclusion', 'summary', 'risks',
  'missingEvidence', 'missingEvidenceDetails', 'suggestedTests', 'confidence', 'repositoryFindings',
  'version', 'repositoryDigest', 'verifiedFacts', 'citations', 'assumptions', 'openQuestions',
  'uncheckedScopes', 'id', 'statement', 'citationIds', 'contentDigest', 'lineStart', 'lineEnd'])
const allowedTools = new Set(['repo_list', 'repo_read', 'repo_search'])
function shape(raw) {
  const text = raw.trim()
  const result = { contentBytes: Buffer.byteLength(raw), prefixKind: !text ? 'empty' : text.startsWith('```')
    ? 'fence' : text.startsWith('{') ? 'object' : text.startsWith('[') ? 'array' : 'other' }
  let value
  try { value = JSON.parse(raw); result.json = 'valid' } catch (error) {
    result.json = 'invalid'
    const match = /position (\d+)/.exec(String(error.message))
    if (match) result.parserPosition = Number(match[1])
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
    try { if (start < 0 || end <= start) throw Error(); value = JSON.parse(raw.slice(start, end + 1)); result.wrapperJson = 'valid' }
    catch { result.wrapperJson = 'invalid' }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    result.keys = Object.keys(value).slice(0, 40).map(key => allowedKeys.has(key) ? key : '<other>')
    if (value.tool && typeof value.tool === 'object') {
      result.tool = allowedTools.has(value.tool.name) ? value.tool.name : '<other>'
      result.argumentKeys = Object.keys(value.tool.args ?? {}).slice(0, 20).map(key => allowedKeys.has(key) ? key : '<other>')
    }
    if (value.repositoryFindings && typeof value.repositoryFindings === 'object') {
      result.findingKeys = Object.keys(value.repositoryFindings).slice(0, 20).map(key => allowedKeys.has(key) ? key : '<other>')
      result.citationCount = Array.isArray(value.repositoryFindings.citations) ? value.repositoryFindings.citations.length : null
    }
  }
  // Syntax shape only. Literal contents are never retained, even on a JSON error.
  let depth = 0, inString = false, escape = false, completeObjects = 0
  for (const character of text) {
    if (escape) { escape = false; continue }
    if (inString && character === '\\') { escape = true; continue }
    if (character === '"') { inString = !inString; continue }
    if (inString) continue
    if (character === '{') depth++
    if (character === '}' && --depth === 0) completeObjects++
  }
  return { ...result, completeObjects, finalBraceDepth: depth, unterminatedString: inString }
}
async function diagnoseResponse(response, output) {
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  const streamed = response.headers.get('content-type')?.includes('text/event-stream') === true
  let pending = '', content = '', wireBytes = 0, stopped = false, finishReason, responseId, envelopeError = false
  const take = value => {
    if (typeof value?.id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value.id)) responseId = value.id
    const choice = value?.choices?.[0]
    if (['stop', 'length', 'tool_calls', 'content_filter'].includes(choice?.finish_reason)) finishReason = choice.finish_reason
    const next = streamed ? choice?.delta?.content : choice?.message?.content
    if (typeof next === 'string') content += next
  }
  try {
    while (!stopped) {
      const item = await reader.read(); if (item.done) break
      wireBytes += item.value.byteLength
      if (wireBytes > 2 * 1024 * 1024) { stopped = true; break }
      pending += decoder.decode(item.value, { stream: true })
      if (streamed) {
        let separator
        while ((separator = /\r?\n\r?\n/.exec(pending))) {
          const frame = pending.slice(0, separator.index); pending = pending.slice(separator.index + separator[0].length)
          const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
          if (data === '[DONE]') { stopped = true; break }
          if (data) { try { take(JSON.parse(data)) } catch { envelopeError = true } }
        }
      }
      if (Buffer.byteLength(content) > 128 * 1024) { content = ''; stopped = true; break }
    }
    if (!streamed) { try { take(JSON.parse(pending)) } catch { envelopeError = true } }
    const record = { recordedAt: new Date().toISOString(), httpStatus: response.status, responseId,
      finishReason, wireBytes, envelopeError, ...shape(content) }
    let previous = ''
    try { previous = await fs.readFile(output, 'utf8') } catch {}
    if (Buffer.byteLength(previous) < 256 * 1024) await fs.appendFile(output, JSON.stringify(record) + '\n', { mode: 0o600 })
  } catch {
    // Shape diagnostics must not change product request behavior or save an error payload.
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
}
module.exports = { shape, diagnoseResponse }
