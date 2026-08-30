import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync('apps/desktop/src/styles.css', 'utf8')

function ruleBodies(selector: string): string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return Array.from(styles.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g')))
    .map((match) => match[1] ?? '')
}

describe('Desktop Workbench layout CSS', () => {
  it('gives the Board its own overflow and the Inspector one vertical scroll owner', () => {
    expect(ruleBodies('.stage-grid').some((body) => (
      body.includes('overflow-x: auto') && body.includes('overscroll-behavior: contain')
    ))).toBe(true)
    expect(ruleBodies('.inspector').some((body) => (
      body.includes('grid-template-rows:') && body.includes('overflow: hidden')
    ))).toBe(true)
    expect(ruleBodies('.inspector-scroll').some((body) => (
      body.includes('overflow-x: hidden') &&
      body.includes('overflow-y: auto') &&
      body.includes('scrollbar-gutter: stable')
    ))).toBe(true)
  })

  it('keeps long Gate enforcement identifiers and explanations readable', () => {
    expect(styles).toMatch(
      /\.enforcement-reason code,[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;[\s\S]*?word-break:\s*break-word;/,
    )
  })
})
