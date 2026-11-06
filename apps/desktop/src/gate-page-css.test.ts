import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync('apps/desktop/src/gate-page.css', 'utf8')

function ruleBodies(selector: string): string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return Array.from(styles.matchAll(new RegExp(`(?:^|[},]\\s*)${escapedSelector}\\s*\\{([^}]*)\\}`, 'gm')))
    .map((match) => match[1] ?? '')
}
const declares = (selector: string, declaration: RegExp) => ruleBodies(selector).some((body) => declaration.test(body))

describe('Gate page CSS', () => {
  it('defines its own question blue for both themes and never uses the brand tokens (3.27)', () => {
    expect(declares('.inspector--gate-page', /--gate-question:\s*#2563eb;/)).toBe(true)
    expect(declares(":root[data-theme='dark'] .inspector--gate-page", /--gate-question:\s*#7fb5ff;/)).toBe(true)
    // Marker popovers render in document.body, outside the aside (review finding 2).
    expect(styles).toMatch(/(?:^|\})\s*\.detail-popover, \.inspector--gate-page \{[^}]*--gate-question:\s*#2563eb;[^}]*--gate-important:\s*var\(--amber\);/m)
    expect(styles).toMatch(/:root\[data-theme='dark'\] \.detail-popover, :root\[data-theme='dark'\] \.inspector--gate-page \{ --gate-question: #7fb5ff; \}/)
    expect(styles).not.toContain('var(--blue)')
    expect(styles).not.toContain('var(--accent)')
  })
  it('drops the aside gutter and keeps a stable one on the scroll container (3.13)', () => {
    expect(declares('.node-reader > .inspector.inspector--gate-page', /scrollbar-gutter:\s*auto;/)).toBe(true)
    expect(declares('.inspector--gate-page .inspector-document-scroll', /scrollbar-gutter:\s*stable;/)).toBe(true)
  })
  it('keeps tags, bars and markers out of the text and the selection (3.23)', () => {
    for (const selector of ['.gate-new-tag', '.gate-change-bar', '.gate-marker']) expect(declares(selector, /user-select:\s*none;/), selector).toBe(true)
    expect(declares('.gate-new-tag::before', /content:\s*'新';/)).toBe(true)
    expect(declares('.gate-marker::before', /content:\s*attr\(data-label\);/)).toBe(true)
  })
  it('resets tight-list paragraph margins and lets only the bars take pointer events (3.25, §5.7)', () => {
    expect(declares('.gate-material [data-gate-tight] > li > p', /margin:\s*0;/)).toBe(true)
    expect(declares('.gate-overlay', /position:\s*absolute;/) && declares('.gate-overlay', /inset:\s*0;/) && declares('.gate-overlay', /pointer-events:\s*none;/)).toBe(true)
    expect(declares('.gate-change-bar', /pointer-events:\s*auto;/)).toBe(true)
  })
  it('marks new content with a 3 px inset rule, links with an outline and bounds the list panel', () => {
    expect(declares('.gate-material .is-new', /box-shadow:\s*inset 3px 0 0 0 var\(--gate-new\);/)).toBe(true)
    expect(declares('.gate-material .is-linked', /outline:\s*2px solid/)).toBe(true)
    expect(declares('.gate-list-panel', /max-height:\s*45vh;/)).toBe(true)
  })
  it('uses only the existing size tokens for text', () => {
    const sizes = Array.from(styles.matchAll(/font-size:\s*([^;]+);/g)).map((match) => match[1]!.trim())
    expect(sizes.every((value) => /^var\(--font-size-(xs|body)\)$/.test(value)), sizes.join(', ')).toBe(true)
  })
  it('is imported after task-workspace.css', () => {
    const main = readFileSync('apps/desktop/src/main.tsx', 'utf8')
    expect(main.indexOf("import './gate-page.css'")).toBeGreaterThan(main.indexOf("import './task-workspace.css'"))
  })
})
