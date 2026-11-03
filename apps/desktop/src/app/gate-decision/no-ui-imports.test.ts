import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// The gate decision modules are pure (design §3.1): no React, no Electron, no .tsx, no components.
const folder = 'apps/desktop/src/app/gate-decision'
const forbidden = (specifier: string) =>
  /^(react|react-dom|electron)(\/|$)/u.test(specifier) || /\.tsx$/u.test(specifier) || /(^|\/)components(\/|$)/u.test(specifier)
describe('gate-decision imports', () => {
  it('has no file that imports react, react-dom, electron, a .tsx module or components/', () => {
    const files = readdirSync(folder).filter((name) => name.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(10)
    const offending = files.flatMap((name) => {
      const source = readFileSync(`${folder}/${name}`, 'utf8')
      const specifiers = Array.from(source.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gmu))
        .map((match) => match[1] ?? match[2] ?? match[3]!)
      return specifiers.filter(forbidden).map((specifier) => `${name}: ${specifier}`)
    })
    expect(offending).toEqual([])
    expect(readdirSync(folder).filter((name) => name.endsWith('.tsx'))).toEqual([])
  })
  it('recognises the forbidden forms', () => {
    expect(['react', 'react-dom/client', 'electron', '../ConversationBody.tsx', '../../components/ArtifactBody'].every(forbidden)).toBe(true)
    expect(['@ai-devflow/shared', './material', 'mdast-util-from-markdown', 'remark-gfm'].some(forbidden)).toBe(false)
  })
})
