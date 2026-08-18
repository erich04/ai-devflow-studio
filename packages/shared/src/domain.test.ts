import { describe, expect, it } from 'vitest'
import { TEAM_ROLES } from './domain'

describe('team role vocabulary', () => {
  it('keeps the product role set exact and excludes an implicit viewer authority', () => {
    expect(TEAM_ROLES).toEqual(['owner', 'lead', 'member'])
    expect(TEAM_ROLES).not.toContain('viewer')
  })
})
