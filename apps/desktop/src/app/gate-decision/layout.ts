/**
 * Gate page grid (design §3.13, §5.7). The values are applied as inline styles, so CSS and code
 * cannot drift. The 16 px tag gutter sits inside the 520 px text track.
 */
export const GATE_LAYOUT = { textMin: 520, gap: 12, marginMin: 240, marginMax: 270, gutter: 16 } as const
/** textMin + gap + marginMin. */
export const GATE_WIDE_MIN_WIDTH = 772
/** Measured content widths of `.inspector-document-scroll` at 1440×900 with the 480 px panel: overlay, classic 15 px, derived 17 px scrollbars. */
export const REFERENCE_WORK_WIDTHS = [794, 779, 777] as const
export type GateLayoutMode = 'wide' | 'narrow'
/** Narrow below 772 px; an unknown width (0) is wide. No hysteresis (§3.13). */
export function isNarrowWidth(width: number): boolean {
  return width > 0 && width < GATE_WIDE_MIN_WIDTH
}
export type GateGridStyle = {
  display: 'grid'
  gridTemplateColumns: string
  gridTemplateAreas: string
  columnGap: string
  alignItems: 'start'
}
export function gateGridStyle(mode: GateLayoutMode = 'wide'): GateGridStyle {
  if (mode === 'narrow') {
    return { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateAreas: '"marginhead" "mhead" "material"', columnGap: '0px', alignItems: 'start' }
  }
  return {
    display: 'grid',
    gridTemplateColumns: `minmax(${GATE_LAYOUT.textMin}px, 1fr) minmax(${GATE_LAYOUT.marginMin}px, ${GATE_LAYOUT.marginMax}px)`,
    gridTemplateAreas: '"mhead marginhead" "material margin"',
    columnGap: `${GATE_LAYOUT.gap}px`,
    alignItems: 'start',
  }
}
