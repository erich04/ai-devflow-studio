import type { CodingActionCosts } from '../../../electron/build-test-contract'
export function formatDecisionTime(value: string, now: string): string {
  const date = new Date(value), current = new Date(now)
  if (!Number.isFinite(+date)) return '时间未知'
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (date.toDateString() === current.toDateString()) return time
  return `${date.getFullYear() === current.getFullYear() ? '' : `${date.getFullYear()} 年 `}${date.getMonth() + 1} 月 ${date.getDate()} 日 ${time}`
}
export function deadlineMeta(expiresAt: string, now: string, what: '改动' | '修复' | '问题' | '权限' | '暂停权限', cost: string) {
  const minutes = (Date.parse(expiresAt) - Date.parse(now)) / 60_000, time = formatDecisionTime(expiresAt, now)
  if (minutes <= 0) return { text: '批准期限已过，正在更新记录。', tone: 'warn' as const }
  if (what === '暂停权限') return { text: `${minutes <= 5 ? `${minutes < 1 ? '不到 1 分钟' : `还剩 ${Math.ceil(minutes)} 分钟`}（${time} 前处理）` : `${time} 前处理`}：过期后开发暂停，受管工作区保留；重新核验并审批后才能继续。`, tone: minutes <= 5 ? 'warn' as const : 'neutral' as const }
  const consequence = what === '问题' ? `过期后开发停止，要重新开发（${cost}）` : `过期后这份${what}作废，${what === '修复' ? '要交给 AI 重新修复' : '要重新开发'}（${cost}）`
  return minutes <= 5 ? { text: `${minutes < 1 ? '不到 1 分钟' : `还剩 ${Math.ceil(minutes)} 分钟`}（${time} 前${what === '问题' ? '回答' : '处理'}）：${consequence}。`, tone: 'warn' as const } : { text: `${time} 前${what === '问题' ? '回答，过期后开发停止' : '处理，过期算拒绝'}`, tone: 'neutral' as const }
}
export function costText(costs: CodingActionCosts | undefined, action: 'start' | 'revise' | 'selfCheck' | 'repair' | 'repairRevise') {
  const cost = costs?.[action]
  return cost === undefined || cost === null || cost === 0 && costs?.billing !== 'no_cost' ? '费用未知' : costs?.billing === 'no_cost' ? '不调用付费模型' : cost < 0.001 ? '最多不到 $0.001' : `最多约 $${cost.toFixed(3)}`
}
export const executorText = (costs?: CodingActionCosts) => [costs?.executorLabel ?? '所选执行器', costs?.modelLabel].filter(Boolean).join(' · ')
export const countsText = (add: number, del: number) => [add ? `+${add}` : '', del ? `−${del}` : ''].filter(Boolean).join(' ') || '没有行数变化'
export function versionSpacing(text: string): string { return text.replace(/(v\d+)(?=[\p{Script=Han}])/gu, '$1 ') }
