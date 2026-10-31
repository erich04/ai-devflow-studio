import { describe, expect, it } from 'vitest'
import { GATE_LAYOUT, GATE_WIDE_MIN_WIDTH, REFERENCE_WORK_WIDTHS, gateGridStyle, isNarrowWidth } from './layout'
describe('gate layout', () => {
  it('keeps at least 4 px of slack below every measured reference width (772 ≤ 773)', () => {
    expect(GATE_WIDE_MIN_WIDTH).toBeLessThanOrEqual(Math.min(...REFERENCE_WORK_WIDTHS) - 4)
    expect(GATE_WIDE_MIN_WIDTH).toBe(GATE_LAYOUT.textMin + GATE_LAYOUT.gap + GATE_LAYOUT.marginMin)
  })
  it('switches at one threshold, with an unknown width treated as wide', () => {
    expect(isNarrowWidth(0)).toBe(false)
    expect(isNarrowWidth(771.5)).toBe(true)
    expect(isNarrowWidth(772)).toBe(false)
  })
  it('builds the grid from the layout constants', () => {
    expect(gateGridStyle('wide')).toEqual({ display: 'grid', gridTemplateColumns: 'minmax(520px, 1fr) minmax(240px, 270px)',
      gridTemplateAreas: '"mhead marginhead" "material margin"', columnGap: '12px', alignItems: 'start' })
    expect(gateGridStyle('narrow').gridTemplateAreas).toBe('"marginhead" "mhead" "material"')
  })
})
