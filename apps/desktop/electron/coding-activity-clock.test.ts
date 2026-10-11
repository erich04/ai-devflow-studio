import { expect, it } from 'vitest'
import { codingActiveMilliseconds } from './coding-activity-clock'
it('charges the union of parent, child and command activity, excluding human waiting gaps', () => {
  expect(codingActiveMilliseconds([{ unitId: 'parent', startedAt: 100, endedAt: 200 }, { unitId: 'child', startedAt: 150, endedAt: 400 }, { unitId: 'command', startedAt: 600 }, { unitId: 'child2', startedAt: 610, endedAt: 700 }], 800)).toBe(500)
})
