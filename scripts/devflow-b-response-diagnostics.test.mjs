import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import diagnostics from './devflow-b-response-diagnostics.cjs'
test('shape records structure without source text, arbitrary keys or malformed payloads', () => {
  const source = '{"tool":{"name":"repo_read","args":{"path":"private-secret"}},"secret-key":"secret-value"}'
  const result = diagnostics.shape(source)
  assert.equal(result.json, 'valid'); assert.equal(result.tool, 'repo_read')
  assert.deepEqual(result.argumentKeys, ['path']); assert.deepEqual(result.keys, ['tool', '<other>'])
  assert(!JSON.stringify(result).includes('secret'))
  const malformed = diagnostics.shape('{"secret-key":"secret-value"}{"second":"more-secret"}')
  assert.equal(malformed.json, 'invalid'); assert.equal(malformed.completeObjects, 2)
  assert(!JSON.stringify(malformed).includes('secret'))
})
test('fragmented SSE remains readable by product while diagnostic stores only safe shape', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'b-shape-'))
  try {
    const payload = '{"tool":{"name":"repo_read","args":{"path":"private-secret"}}}'
    const wire = `data: ${JSON.stringify({id:'safe-id',choices:[{delta:{content:payload.slice(0,17)},finish_reason:null}]})}\n\ndata: ${JSON.stringify({id:'safe-id',choices:[{delta:{content:payload.slice(17)},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`
    const response = new Response(wire, {headers:{'content-type':'text/event-stream'}})
    const output = path.join(directory,'result.jsonl')
    await diagnostics.diagnoseResponse(response.clone(), output)
    assert.equal(await response.text(), wire)
    const text = await readFile(output,'utf8'), result = JSON.parse(text)
    assert.equal(result.tool,'repo_read');assert.equal(result.finishReason,'stop');assert.equal(result.responseId,'safe-id')
    assert(!text.includes('private-secret'))
  } finally { await rm(directory,{recursive:true,force:true}) }
})
