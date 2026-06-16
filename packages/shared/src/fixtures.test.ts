import { describe, expect, it } from 'vitest'
import { projects, runs } from './fixtures'

describe('fixtures product narrative', () => {
  it('does not expose HoneyAI or opencode as active DevFlow product fixtures', () => {
    const serialized = JSON.stringify({ projects, runs })

    expect(serialized).not.toMatch(/HoneyAI/)
    expect(serialized).not.toMatch(/xiaohanarch\/HoneyAI/)
    expect(serialized).not.toMatch(/opencode adapter/)
  })
})
