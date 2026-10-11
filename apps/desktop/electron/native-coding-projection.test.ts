// @vitest-environment node
import { rm } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { codingHarnessFixture } from './native-coding-test-fixture'
import { mutateNativeCodingSession } from './native-coding-session'
import { codingHarnessSnapshot } from './native-coding-projection'

it('reads complete paged history without a configured executor or model credential', async () => {
  const fixture = await codingHarnessFixture(async () => { throw new Error('A historical read must never call the model') })
  try {
    const text = 'A human constraint with spaces. '.repeat(1800)
    const session = await mutateNativeCodingSession(fixture.store, 'native-coding', draft => { draft.transcript.push({ role: 'user', content: text }) })
    const view = await codingHarnessSnapshot(session, { store: fixture.store })
    expect(view.messages.at(-1)?.truncated).toBe(true)
    let result = '', offset: number | null = 0
    while (offset !== null) {
      const page = await codingHarnessSnapshot(session, { store: fixture.store }, { detail: { kind: 'message', id: 'message-1', offset } })
      result += page.detail!.text; offset = page.detail!.next
    }
    expect(result).toBe(text)
    expect((await fixture.store.getNativeCodingSession(session.id))!.version).toBe(session.version)
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})
