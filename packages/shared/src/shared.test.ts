import { describe, expect, it } from 'vitest'
import { runs, tokenUsage } from './fixtures'
import { canApproveGate } from './gates'
import { findEntityNeighborhood } from './knowledge'
import { redactSecrets } from './redaction'
import { parseThemePreference, resolveThemePreference } from './theme'
import { rollupTokenUsage } from './cost'

describe('redactSecrets', () => {
  it('redacts common API keys before evidence upload', () => {
    const result = redactSecrets('ANTHROPIC_API_KEY=sk-ant-1234567890abcdefghijklmnop ghp_1234567890abcdefghijklmnop')

    expect(result.redacted).toBe(true)
    expect(result.value).toContain('[REDACTED:env_secret_assignment]')
    expect(result.value).toContain('[REDACTED:github_token]')
  })
})

describe('rollupTokenUsage', () => {
  it('aggregates cost and tokens by project', () => {
    const [project] = rollupTokenUsage(tokenUsage, 'projectId')

    expect(project?.key).toBe('p-payments')
    expect(project?.totalTokens).toBe(31_980)
    expect(project?.costUsd).toBeCloseTo(0.109)
  })
})

describe('canApproveGate', () => {
  it('allows lead to approve a lead gate but blocks members', () => {
    const gate = runs[0]?.nodes.find((node) => node.id === 'n-design-gate')

    expect(gate).toBeDefined()
    expect(canApproveGate('lead', gate!)).toBe(true)
    expect(canApproveGate('member', gate!)).toBe(false)
  })
})

describe('theme helpers', () => {
  it('parses invalid preferences as system and resolves against system theme', () => {
    expect(parseThemePreference('neon')).toBe('system')
    expect(resolveThemePreference('system', 'dark')).toBe('dark')
  })
})

describe('findEntityNeighborhood', () => {
  it('returns immediate graph relations for an entity', () => {
    const neighborhood = findEntityNeighborhood(
      {
        entities: [
          { id: 'a', label: 'A', kind: 'term', sourcePath: 'a.md' },
          { id: 'b', label: 'B', kind: 'term', sourcePath: 'b.md' },
          { id: 'c', label: 'C', kind: 'term', sourcePath: 'c.md' },
        ],
        relations: [
          { id: 'ab', source: 'a', target: 'b', label: 'uses' },
          { id: 'bc', source: 'b', target: 'c', label: 'depends_on' },
        ],
      },
      'b',
    )

    expect(neighborhood.entities.map((entity) => entity.id).sort()).toEqual(['a', 'b', 'c'])
    expect(neighborhood.relations).toHaveLength(2)
  })
})
