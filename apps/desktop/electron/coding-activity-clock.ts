export type CodingActivity = { unitId: string; startedAt: number; endedAt?: number }
/** A minute shared by three children is one minute of root active time. */
export function codingActiveMilliseconds(intervals: CodingActivity[], now = Date.now()): number {
  let total = 0, start = 0, end = 0
  for (const interval of intervals.map(item => [item.startedAt, item.endedAt ?? now] as const).sort((a, b) => a[0] - b[0])) {
    if (!Number.isFinite(interval[0]) || interval[1] < interval[0]) throw new Error('Invalid coding activity interval')
    if (interval[0] > end) { total += end - start; start = interval[0]; end = interval[1] }
    else end = Math.max(end, interval[1])
  }
  return total + end - start
}
