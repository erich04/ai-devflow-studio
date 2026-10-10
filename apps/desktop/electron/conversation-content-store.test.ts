// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConversationContentStore } from './conversation-content-store'

describe('private conversation content', () => {
  it('persists escape-heavy long text separately, restores exactly, and rejects modified content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devflow-content-'))
    try {
      const store = new ConversationContentStore(join(dir, 'private'))
      const body = '中文😀\\\n'.repeat(60_000)
      const source = { id: 'conversation', messages: [{ text: body }], untrusted: { blob: '../../secret' } }
      const saved = await store.encode('conversation', source)
      expect(JSON.stringify(saved).length).toBeLessThan(2000)
      expect(await store.decode(saved)).toEqual(source)
      const manifest = saved.strings[0]!
      expect((await readFile(store.contentPath(saved.scope, manifest.hash), 'utf8'))).toBe(body)
      await expect(store.decode({ ...saved, scope: '../../outside' })).rejects.toThrow()
      expect(await new ConversationContentStore(join(dir, 'private')).decode(saved)).toEqual(source)
      await writeFile(store.contentPath(saved.scope, manifest.hash), 'corrupted')
      await expect(store.decode(saved)).rejects.toThrow('integrity')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})

it('recovers all received reasoning from private stream files after reopening', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devflow-stream-content-'))
  try {
    const first = new ConversationContentStore(dir)
    const text = '中文🧠'.repeat(12000)
    await first.appendStream('c1', 'r1', 'reasoning', text)
    await first.appendStream('c1', 'r1', 'reasoning', 'tail')
    await first.appendStream('c1', 'r1', 'content', 'partial document')
    const reopened = new ConversationContentStore(dir)
    expect(await reopened.readStreamReasoning('c1', 'r1')).toBe(text + 'tail')
    expect(await reopened.readStreamReasoning('c2', 'r1')).toBeUndefined()
    expect(await reopened.readStreamReasoning('c1', 'r2')).toBeUndefined()
    expect((await stat(dir)).isDirectory()).toBe(true)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
